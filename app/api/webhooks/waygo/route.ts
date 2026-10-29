// Receptor de webhooks de Waygo (emulador o real).
// 1) Verifica la firma HMAC (WAYGO_WEBHOOK_SECRET, ventana de 5 min)
// 2) Dedupe por X-Webhook-ID (tabla waygo_webhooks)
// 3) Responde 200 de inmediato y procesa después (after): GET /v1/shipments/{id} trae teléfono y COD,
//    que el webhook no incluye; upsert en `envios` y fila en `eventos` (componente "ingestor").
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { verificarFirma } from "@/lib/ingesta/firma";
import { registrarEvento, upsertEnvio } from "@/lib/ingesta/envios";
import { waygo, type PartnerFormWebhookEvent, type PartnerWebhookEvent } from "@/lib/waygo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const crudo = await req.text();
  const secreto = process.env.WAYGO_WEBHOOK_SECRET;
  if (!secreto) return Response.json({ ok: false, error: "WAYGO_WEBHOOK_SECRET no configurado" }, { status: 500 });

  const v = verificarFirma(crudo, req.headers.get("x-webhook-signature"), secreto);
  if (!v.ok) return Response.json({ ok: false, error: v.motivo }, { status: 401 });

  const webhookId = req.headers.get("x-webhook-id");
  if (!webhookId) return Response.json({ ok: false, error: "falta X-Webhook-ID" }, { status: 400 });

  let evento: PartnerWebhookEvent | PartnerFormWebhookEvent;
  try {
    evento = JSON.parse(crudo);
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const shipmentId =
    "shipment_id" in evento ? evento.shipment_id : (evento as PartnerFormWebhookEvent).run?.shipment_id ?? null;
  const { error } = await supabaseServer()
    .from("waygo_webhooks")
    .insert({
      webhook_id: webhookId,
      evento: evento.event,
      shipment_id: shipmentId || null,
      intento: Number(req.headers.get("x-webhook-attempt")) || null,
      payload: evento,
    });
  if (error) {
    // 23505 = ya lo recibimos (reintento): 200 para que no se reenvíe
    if (error.code === "23505") return Response.json({ ok: true, duplicado: true });
    return Response.json({ ok: false, error: "no se pudo registrar el webhook" }, { status: 500 });
  }

  after(() => procesar(webhookId, evento));
  return Response.json({ ok: true });
}

async function procesar(webhookId: string, evento: PartnerWebhookEvent | PartnerFormWebhookEvent): Promise<void> {
  const db = supabaseServer();
  try {
    if (evento.event.startsWith("shipment.") && "shipment_id" in evento) {
      const cliente = waygo();
      const detalle = await cliente.getShipment(evento.shipment_id);
      const r = await upsertEnvio(cliente, detalle, {
        fuente: "webhook",
        client_id: evento.client_id ?? null,
        novedad: (evento.data?.novelty as Record<string, unknown> | undefined) ?? null,
      });
      await registrarEvento({
        componente: "ingestor",
        herramienta: evento.event,
        envio_id: r.envio_id,
        entrada: { webhook_id: webhookId, event: evento.event, from_state: evento.from_state, to_state: evento.to_state, tracking_number: evento.tracking_number },
        resultado: { nuevo: r.nuevo, cambio_estado: r.cambio_estado, estado_buffer: r.estado_buffer, validacion: r.validacion },
        nivel: r.validacion.ok ? "ok" : "aviso",
        mensaje: `${evento.event} · ${detalle.tracking_number} · ${evento.from_state || "∅"} → ${evento.to_state}${r.validacion.ok ? "" : ` · ${r.validacion.problemas.join(", ")}`}`,
      });
    } else {
      // form.*, temperature.excursion: solo auditoría
      await registrarEvento({
        componente: "ingestor",
        herramienta: evento.event,
        entrada: { webhook_id: webhookId, ...evento },
        nivel: "info",
        mensaje: `${evento.event} recibido`,
      });
    }
    await db.from("waygo_webhooks").update({ procesado_at: new Date().toISOString(), error: null }).eq("webhook_id", webhookId);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[webhook waygo]", msg);
    await db.from("waygo_webhooks").update({ error: msg }).eq("webhook_id", webhookId);
    await registrarEvento({ componente: "ingestor", herramienta: evento.event, entrada: { webhook_id: webhookId }, nivel: "error", mensaje: `Error procesando ${evento.event}: ${msg}` });
  }
}
