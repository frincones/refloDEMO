import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { envOpcional } from "@/lib/env";
import { limpio, rfc3339 } from "./http";

// Emisor de webhooks del emulador, igual que la API real:
//  - body JSON PartnerWebhookEvent (sin teléfono ni monto COD)
//  - X-Webhook-ID (uuid, igual en todos los reintentos), X-Webhook-Event, X-Webhook-Attempt,
//    X-Webhook-Timestamp y X-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256 de "<t>.<body>">
//    con el secreto whsec_... completo como llave.
// Reintentos simplificados (el real hace 8 en ~5 h): 3 intentos con 0 s, 1 s y 3 s de espera.

export type EventoEnvio = "shipment.created" | "shipment.state_changed" | "shipment.delivered" | "shipment.cancelled";

export type DatosEvento = {
  recipient_name: string;
  recipient_address: string;
  attempt_number?: number | null;
  courier_id?: string | null;
  notes?: string | null;
  novelty?: Record<string, unknown> | null;
  photo_url?: string | null;
  photo_urls?: string[] | null;
  signature_url?: string | null;
};

export type EnvioParaWebhook = {
  id: string;
  client_id: string;
  tracking_number: string;
  order_number: string;
};

const ESPERAS_MS = [0, 1000, 3000];
const TIMEOUT_MS = 8000;

/** Firma: HMAC-SHA256(secret, `${t}.${body}`) en hex minúscula. */
export function firmar(secreto: string, t: number, body: string): string {
  return createHmac("sha256", secreto).update(`${t}.${body}`).digest("hex");
}

type Suscripcion = { id: string; url: string | null; secret: string | null; events: string[] };

async function suscripciones(clientId: string): Promise<Suscripcion[]> {
  const { data } = await supabaseServer()
    .from("wg_webhook_subscriptions")
    .select("id, url, secret, events")
    .eq("client_id", clientId)
    .eq("activa", true);
  return (data || []) as Suscripcion[];
}

/** Destino efectivo: la URL de la suscripción o, si es null, EMU_WAYGO_WEBHOOK_URL de esta instancia. */
function destino(s: Suscripcion): { url: string; secreto: string } | null {
  const url = s.url || envOpcional("EMU_WAYGO_WEBHOOK_URL");
  const secreto = s.secret || envOpcional("EMU_WAYGO_WEBHOOK_SECRET");
  if (!url || !secreto) return null;
  return { url, secreto };
}

/** Encola webhooks de envío (uno por evento y suscripción) y los entrega después de responder. */
export async function emitirEventosEnvio(
  envio: EnvioParaWebhook,
  eventos: { event: EventoEnvio; from_state: string; to_state: string; timestamp: string; data: DatosEvento }[],
): Promise<string[]> {
  const subs = await suscripciones(envio.client_id);
  const filas: Record<string, unknown>[] = [];
  for (const ev of eventos) {
    for (const s of subs) {
      if (!s.events.includes(ev.event)) continue;
      const d = destino(s);
      const body = JSON.stringify({
        event: ev.event,
        shipment_id: envio.id,
        tracking_number: envio.tracking_number,
        order_number: envio.order_number,
        client_id: envio.client_id,
        from_state: ev.from_state,
        to_state: ev.to_state,
        timestamp: rfc3339(ev.timestamp),
        data: limpio({ ...ev.data }),
      });
      filas.push({
        id: randomUUID(),
        subscription_id: s.id,
        client_id: envio.client_id,
        event: ev.event,
        shipment_id: envio.id,
        url: d?.url ?? null,
        body,
        estado: d ? "pendiente" : "fallido",
        ultimo_error: d ? null : "sin URL o secreto de destino (EMU_WAYGO_WEBHOOK_URL / EMU_WAYGO_WEBHOOK_SECRET)",
      });
    }
  }
  return encolar(filas);
}

/** Webhook form.* (cuerpo PartnerFormWebhookEvent). */
export async function emitirEventoFormulario(clientId: string, shipmentId: string | null, cuerpo: Record<string, unknown>): Promise<string[]> {
  const subs = await suscripciones(clientId);
  const filas: Record<string, unknown>[] = [];
  for (const s of subs) {
    if (!s.events.includes(String(cuerpo.event))) continue;
    const d = destino(s);
    filas.push({
      id: randomUUID(),
      subscription_id: s.id,
      client_id: clientId,
      event: cuerpo.event,
      shipment_id: shipmentId,
      url: d?.url ?? null,
      body: JSON.stringify(cuerpo),
      estado: d ? "pendiente" : "fallido",
      ultimo_error: d ? null : "sin URL o secreto de destino",
    });
  }
  return encolar(filas);
}

async function encolar(filas: Record<string, unknown>[]): Promise<string[]> {
  if (!filas.length) return [];
  await supabaseServer().from("wg_webhook_deliveries").insert(filas);
  const ids = filas.filter((f) => f.estado === "pendiente").map((f) => String(f.id));
  if (ids.length) programarEntrega(ids);
  return ids;
}

/** Entrega en segundo plano (after() mantiene viva la función en Vercel tras responder). */
export function programarEntrega(ids: string[]): void {
  try {
    after(() => entregarEnOrden(ids));
  } catch {
    // Fuera de un contexto de petición: entregar sin esperar
    void entregarEnOrden(ids);
  }
}

async function entregarEnOrden(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await entregar(id);
    } catch (e) {
      console.error("[emulador] error entregando webhook", id, (e as Error).message);
    }
  }
}

/** Entrega una fila de wg_webhook_deliveries con hasta 3 intentos. */
export async function entregar(id: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const db = supabaseServer();
  const { data: fila } = await db
    .from("wg_webhook_deliveries")
    .select("id, event, body, intentos, subscription_id, wg_webhook_subscriptions(url, secret)")
    .eq("id", id)
    .maybeSingle();
  if (!fila) return { ok: false, error: "no existe" };
  const sub = (fila.wg_webhook_subscriptions as unknown as { url: string | null; secret: string | null } | null) || { url: null, secret: null };
  const url = sub.url || envOpcional("EMU_WAYGO_WEBHOOK_URL");
  const secreto = sub.secret || envOpcional("EMU_WAYGO_WEBHOOK_SECRET");
  if (!url || !secreto) {
    await db.from("wg_webhook_deliveries").update({ estado: "fallido", ultimo_error: "sin URL o secreto" }).eq("id", id);
    return { ok: false, error: "sin URL o secreto" };
  }
  let intentos = Number(fila.intentos) || 0;
  let ultimo: { ok: boolean; status?: number; error?: string } = { ok: false };
  for (const espera of ESPERAS_MS) {
    if (espera) await new Promise((r) => setTimeout(r, espera));
    intentos += 1;
    const t = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Waygo-Webhooks/1.0 (emulador TDX)",
          "X-Webhook-ID": String(fila.id),
          "X-Webhook-Event": String(fila.event),
          "X-Webhook-Attempt": String(Math.min(intentos, 8)),
          "X-Webhook-Timestamp": String(t),
          "X-Webhook-Signature": `t=${t},v1=${firmar(secreto, t, String(fila.body))}`,
        },
        body: String(fila.body),
      });
      ultimo = { ok: res.status >= 200 && res.status < 300, status: res.status };
      if (!ultimo.ok) ultimo.error = (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}`;
    } catch (e) {
      ultimo = { ok: false, error: (e as Error).message };
    }
    await db
      .from("wg_webhook_deliveries")
      .update({
        intentos,
        url,
        ultimo_status: ultimo.status ?? null,
        ultimo_error: ultimo.ok ? null : ultimo.error ?? null,
        ultimo_intento_at: new Date().toISOString(),
        estado: ultimo.ok ? "entregado" : "pendiente",
        entregado_at: ultimo.ok ? new Date().toISOString() : null,
      })
      .eq("id", id);
    if (ultimo.ok) return ultimo;
  }
  await db.from("wg_webhook_deliveries").update({ estado: "fallido" }).eq("id", id);
  return ultimo;
}
