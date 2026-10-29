import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ctxDesde, ErrorApi, igualSeguro, rfc3339, type Cliente } from "./http";
import { aplicarTransicion, crearEnvio, estados, TRANSICIONES, type FilaEnvio } from "./envios";
import { emitirEventoFormulario, entregar } from "./webhooks";
import { IDS, sembrarEmulador } from "./seed";

// API del panel "operador Waygo" (/emulador). Protegida con el header x-admin-token = DEMO_ADMIN_TOKEN.

export function exigirAdmin(req: Request): void {
  const token = req.headers.get("x-admin-token") || "";
  if (!token || !igualSeguro(token, env("DEMO_ADMIN_TOKEN"))) throw new ErrorApi(401, "token de administración inválido");
}

const NOMBRES = ["Laura Gómez", "Santiago Pineda", "Paola Restrepo", "Felipe Ramírez", "Catalina Rincón", "Mauricio Díaz", "Yuli Andrea Cruz", "Esteban Ocampo", "Tatiana Suárez", "Cristian Mora"];
const TIENDAS = ["Tienda Moda Andina", "Calzado Pacífico", "TecnoBarrio", "Hogar & Cocina Express", "Mascotas Felices", "Belleza Natural Co."];
const ZONAS = ["Timiza", "Patio Bonito", "Bosa Recreo", "Kennedy Central", "Tintal", "Castilla", "Venecia", "Marsella", "Meissen", "Olaya"];

async function clientePrincipal(): Promise<Cliente> {
  const { data } = await supabaseServer().from("wg_clients").select("*").eq("id", IDS.clientePrincipal).maybeSingle();
  if (!data) throw new ErrorApi(409, "El emulador no está sembrado: usa «Reiniciar y sembrar».");
  return { ...data, tarifa_base: Number(data.tarifa_base), tarifa_kg: Number(data.tarifa_kg), cod_fee_pct: Number(data.cod_fee_pct) } as Cliente;
}

export async function despacharAdmin(req: Request, segmentos: string[]): Promise<Response> {
  const ctx = ctxDesde(req);
  const accion = segmentos.join("/");
  const db = supabaseServer();
  try {
    exigirAdmin(req);
    const cuerpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (accion === "login" && req.method === "POST") return Response.json({ ok: true });

    if (accion === "seed" && req.method === "POST") {
      const r = await sembrarEmulador({ resetear: true });
      return Response.json({ ok: true, ...r });
    }

    if (accion === "resumen" && req.method === "GET") {
      const [env_, mapa, clientes, couriers, novedades, entregas] = await Promise.all([
        db.from("wg_shipments").select("*").order("created_at", { ascending: false }).limit(300),
        estados(),
        db.from("wg_clients").select("id, nombre"),
        db.from("wg_couriers").select("id, nombre, placa").eq("activo", true),
        db.from("wg_novelty_types").select("id, name").eq("activo", true).order("orden"),
        db.from("wg_webhook_deliveries").select("id, event, shipment_id, url, estado, intentos, ultimo_status, ultimo_error, created_at, entregado_at").order("created_at", { ascending: false }).limit(60),
      ]);
      const nombreCliente = new Map((clientes.data || []).map((c) => [c.id, c.nombre]));
      return Response.json({
        sembrado: (clientes.data || []).length > 0,
        estados: [...mapa.values()],
        transiciones: TRANSICIONES,
        mensajeros: couriers.data || [],
        novedades: novedades.data || [],
        envios: (env_.data || []).map((f) => ({
          id: f.id,
          cliente: nombreCliente.get(f.client_id) || "",
          es_principal: f.client_id === IDS.clientePrincipal,
          tracking_number: f.tracking_number,
          order_number: f.order_number,
          tienda: f.sender_name,
          comprador: f.recipient_name,
          telefono: f.recipient_phone,
          direccion: f.recipient_address,
          cod: f.payment_type === "cod" ? Number(f.cod_amount) : 0,
          estado: f.current_state,
          estado_nombre: mapa.get(f.current_state)?.name,
          intentos: f.delivery_attempts,
          servicio: f.shipment_type_name,
          creado: rfc3339(f.created_at),
          label_url: `${ctx.origen}/api/waygo-emu/publico/guia/${f.label_token}`,
          tracking_url: `${ctx.origen}/api/waygo-emu/publico/seguimiento/${f.label_token}`,
        })),
        entregas: entregas.data || [],
      });
    }

    if (accion === "lote" && req.method === "POST") {
      const cantidad = Math.min(Math.max(Number(cuerpo.cantidad) || 6, 1), 20);
      const conInvalido = !!cuerpo.incluir_invalido;
      const cliente = await clientePrincipal();
      const creados: string[] = [];
      for (let i = 0; i < cantidad; i++) {
        const nombre = NOMBRES[Math.floor(Math.random() * NOMBRES.length)];
        const zona = ZONAS[Math.floor(Math.random() * ZONAS.length)];
        const monto = Math.round((50000 + Math.random() * 450000) / 100) * 100 - 100;
        const cel = `3${["00", "01", "10", "12", "15", "20", "50"][i % 7]}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
        const f = await crearEnvio(ctx, cliente, {
          warehouse_id: IDS.bodegaBogotaSur,
          is_pickup: false,
          recipient_name: nombre,
          recipient_phone: conInvalido && i === cantidad - 1 ? "601 555" : `+57${cel}`,
          recipient_address: `Cra ${20 + i} Sur # ${40 + i}-${10 + i}, ${zona}, Bogotá`,
          recipient_city_id: IDS.bogota,
          payment_type: "cod",
          payment_method_id: IDS.efectivo,
          cod_amount: monto,
          weight: 1 + (i % 3),
          order_number: `${(TIENDAS[i % TIENDAS.length].match(/\b\w/g) || []).join("").toUpperCase()}-${Date.now().toString().slice(-6)}${i}`,
          sender_name: TIENDAS[i % TIENDAS.length],
          notes: "Envío de prueba creado desde el panel del emulador",
        });
        creados.push(f.tracking_number);
      }
      return Response.json({ ok: true, creados });
    }

    if (accion === "transicion" && req.method === "POST") {
      const { data: f } = await db.from("wg_shipments").select("*").eq("id", String(cuerpo.shipment_id || "")).maybeSingle();
      if (!f) throw new ErrorApi(404, "envío no encontrado");
      const destino = String(cuerpo.estado || "");
      const permitidos = TRANSICIONES[f.current_state] || [];
      if (!permitidos.includes(destino)) throw new ErrorApi(409, `No se puede pasar de ${f.current_state} a ${destino}`);
      const r = await aplicarTransicion(f as FilaEnvio, destino, {
        courier_id: cuerpo.courier_id || null,
        novelty_type_id: cuerpo.novelty_type_id || null,
        novelty_description: cuerpo.descripcion || null,
        reschedule_date: cuerpo.reschedule_date || null,
        notes: cuerpo.notas || null,
        origen: ctx,
      });
      return Response.json({ ok: true, estado: r.fila.current_state });
    }

    if (accion === "reintentar" && req.method === "POST") {
      const r = await entregar(String(cuerpo.delivery_id || ""));
      return Response.json(r);
    }

    if (accion === "formulario" && req.method === "POST") {
      // Simula que el conductor llenó el formulario de una asignación y emite form.run.submitted
      const { data: a } = await db.from("wg_forms_assignments").select("*").eq("id", String(cuerpo.assignment_id || "")).maybeSingle();
      if (!a) throw new ErrorApi(404, "asignación no encontrada");
      const { data: wf } = await db.from("wg_workflows").select("*").eq("id", a.workflow_id).single();
      const { data: sh } = await db.from("wg_shipments").select("tracking_number, cod_amount").eq("id", a.shipment_id).single();
      const runId = randomUUID();
      const ahora = new Date().toISOString();
      const outcome = cuerpo.outcome === "flagged" ? "flagged" : "pass";
      await db.from("wg_forms_runs").insert({
        id: runId,
        assignment_id: a.id,
        client_id: a.client_id,
        workflow_id: a.workflow_id,
        shipment_id: a.shipment_id,
        event: wf.evento,
        status: "completed",
        outcome,
        flags: outcome === "flagged" ? ["recaudo:diferencia"] : [],
        forms: (wf.forms || []).map((fm: Record<string, unknown>) => ({ ...fm, answers: { monto_recibido: Number(sh?.cod_amount) || 0, medio: "efectivo" } })),
        occurred_at: ahora,
        submitted_at: ahora,
      });
      await db.from("wg_forms_assignments").update({ status: "completed", run_id: runId, updated_at: ahora }).eq("id", a.id);
      await emitirEventoFormulario(a.client_id, a.shipment_id, {
        event: "form.run.submitted",
        tenant_id: IDS.clientePrincipal,
        timestamp: rfc3339(ahora),
        run: {
          id: runId,
          workflow_id: a.workflow_id,
          workflow_name: wf.nombre,
          event: wf.evento,
          outcome,
          status: "completed",
          flags: outcome === "flagged" ? ["recaudo:diferencia"] : [],
          shipment_id: a.shipment_id,
          tracking_number: sh?.tracking_number,
          occurred_at: rfc3339(ahora),
        },
      });
      return Response.json({ ok: true, run_id: runId });
    }

    throw new ErrorApi(404, `acción desconocida: ${req.method} ${accion}`);
  } catch (e) {
    if (e instanceof ErrorApi) return Response.json({ ok: false, error: e.detail }, { status: e.status });
    console.error("[emulador admin]", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
