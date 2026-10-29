import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import {
  autenticar,
  ctxDesde,
  ErrorApi,
  exigirUuid,
  json,
  jsonCanonico,
  leerJson,
  limpio,
  problema,
  rfc3339,
  sha256,
  UUID_RE,
  type Cliente,
  type Ctx,
} from "./http";
import { queryEntero, validarCuerpo } from "./validacion";
import {
  aDetalle,
  aEvento,
  aResumen,
  cancelarPorCliente,
  crearEnvio,
  envioDelCliente,
  estados,
  eventosDe,
  precio,
  tipoServicio,
  validarPago,
  type CrearEnvio,
  type DatosPrecio,
  type FilaEnvio,
} from "./envios";
import { pdfGuia } from "./pdf";

// Enrutador del emulador de la Waygo TMS Partner API v1.0.0.
// Todas las rutas del spec viven bajo /api/waygo-emu/partner/v1/* (la "URL base" incluye /partner).

type Manejador = (req: Request, ctx: Ctx, cliente: Cliente, params: Record<string, string>) => Promise<Response>;
type Ruta = { metodo: string; patron: RegExp; nombres: string[]; manejar: Manejador };

const rutas: Ruta[] = [];
function ruta(metodo: string, plantilla: string, manejar: Manejador) {
  const nombres: string[] = [];
  const patron = new RegExp(
    "^" +
      plantilla.replace(/\{(\w+)\}/g, (_, n) => {
        nombres.push(n);
        return "([^/]+)";
      }) +
      "/?$",
  );
  rutas.push({ metodo, patron, nombres, manejar });
}

// ---------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------
ruta("GET", "/v1/catalogs/cancel-reasons", async (_req, ctx) => {
  const { data } = await supabaseServer().from("wg_catalogs").select("id, code, name, data").eq("tipo", "cancel_reason").eq("activo", true).order("orden");
  const lista = (data || [])
    .filter((r) => (r.data as { client_allowed?: boolean })?.client_allowed !== false)
    .map((r) => limpio({ id: r.id, code: r.code, name: r.name, require_comment: !!(r.data as { require_comment?: boolean })?.require_comment }));
  return json(ctx, "CancelReasonListResponseBody", { data: lista });
});

ruta("GET", "/v1/catalogs/locations", async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const level = sp.get("level");
  if (level && !["country", "state", "city"].includes(level))
    throw new ErrorApi(422, "validation failed", [{ message: 'expected value to be one of "country, state, city"', location: "query.level", value: level }]);
  const parent = sp.get("parent_id");
  if (parent && !UUID_RE.test(parent))
    throw new ErrorApi(422, "validation failed", [{ message: "expected string to be RFC 4122 uuid", location: "query.parent_id", value: parent }]);
  const page = queryEntero(sp, "page", 1, 1);
  const pageSize = queryEntero(sp, "page_size", 100, 1, 200);
  let q = supabaseServer().from("wg_locations").select("id, code, name, parent_id", { count: "exact" });
  if (level) q = q.eq("level", level);
  if (parent) q = q.eq("parent_id", parent);
  const search = sp.get("search");
  if (search) q = q.ilike("name", `%${search.replace(/[%_,()*]/g, "")}%`);
  const { data, count } = await q.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  const total = count || 0;
  return json(ctx, "LocationListResponseBody", {
    data: (data || []).map((l) => limpio(l)),
    meta: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
});

ruta("GET", "/v1/catalogs/novelty-types", async (_req, ctx) => {
  const { data } = await supabaseServer().from("wg_novelty_types").select("id, name").eq("activo", true).order("orden");
  return json(ctx, "NoveltyTypeListResponseBody", { data: data || [] });
});

ruta("GET", "/v1/catalogs/payment-methods", async (_req, ctx) => {
  const { data } = await supabaseServer().from("wg_catalogs").select("id, code, name").eq("tipo", "payment_method").eq("activo", true).order("orden");
  return json(ctx, "ListPaymentMethodsResponseBody", { data: data || [] });
});

ruta("GET", "/v1/catalogs/shipment-types", async (_req, ctx) => {
  const { data } = await supabaseServer().from("wg_catalogs").select("id, code, name").eq("tipo", "shipment_type").eq("activo", true).order("orden");
  return json(ctx, "ListShipmentTypesResponseBody", { data: data || [] });
});

ruta("GET", "/v1/catalogs/statuses", async (_req, ctx) => {
  const lista = [...(await estados()).values()].map((e) =>
    limpio({ code: e.code, name: e.name, color: e.color, is_initial: e.is_initial, is_final: e.is_final, is_novelty: e.is_novelty, is_return: e.is_return, outcome: e.outcome }),
  );
  return json(ctx, "ListStatusesResponseBody", { data: lista });
});

ruta("GET", "/v1/catalogs/warehouses", async (_req, ctx, cliente) => {
  const { data } = await supabaseServer()
    .from("wg_warehouses")
    .select("id, code, name, client_id")
    .eq("activa", true)
    .or(`client_id.is.null,client_id.eq.${cliente.id}`)
    .order("code");
  return json(ctx, "WarehouseListResponseBody", { data: (data || []).map((w) => limpio(w)) });
});

// ---------------------------------------------------------------------
// Cotizar
// ---------------------------------------------------------------------
ruta("POST", "/v1/quotes", async (req, ctx, cliente) => {
  const b = validarCuerpo<DatosPrecio & { recipient_city_id?: string }>("PartnerQuoteRequestBody", await leerJson(req));
  if (b.recipient_city_id) {
    const { data: c } = await supabaseServer().from("wg_locations").select("level").eq("id", b.recipient_city_id).maybeSingle();
    if (!c || c.level !== "city")
      throw new ErrorApi(422, "recipient_city_id does not exist or is not a city", [{ location: "body.recipient_city_id", message: "unknown city", value: b.recipient_city_id }]);
  }
  const declarado = validarPago(b);
  const p = precio(cliente, { ...b, declared_value: declarado }, await tipoServicio(cliente));
  return json(ctx, "PartnerQuoteResponseBody", p);
});

// ---------------------------------------------------------------------
// Envíos
// ---------------------------------------------------------------------
ruta("GET", "/v1/shipments", async (req, ctx, cliente) => {
  const sp = new URL(req.url).searchParams;
  const page = queryEntero(sp, "page", 1, 1);
  const pageSize = queryEntero(sp, "page_size", 25, 1, 100);
  let q = supabaseServer().from("wg_shipments").select("*", { count: "exact" }).eq("client_id", cliente.id);
  const estado = sp.get("current_state");
  if (estado) q = q.eq("current_state", estado);
  const search = (sp.get("search") || "").replace(/[%_,()*]/g, "").trim();
  if (search) q = q.or(`tracking_number.ilike.%${search}%,order_number.ilike.%${search}%`);
  const { data, count, error } = await q
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ErrorApi(500, "internal error");
  const mapa = await estados();
  const total = count || 0;
  return json(ctx, "ShipmentListResponseBody", {
    data: (data || []).map((f) => aResumen(ctx, f as FilaEnvio, mapa)),
    meta: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  });
});

ruta("POST", "/v1/shipments", async (req, ctx, cliente) => {
  const db = supabaseServer();
  const llave = req.headers.get("idempotency-key");
  if (llave !== null && (llave.length === 0 || llave.length > 255))
    throw new ErrorApi(422, "validation failed", [{ message: "expected length <= 255", location: "header.Idempotency-Key", value: llave }]);
  const cuerpo = await leerJson(req);

  // Idempotency-Key: 24 h por cliente
  if (llave) {
    const hash = sha256(jsonCanonico(cuerpo));
    await db.from("wg_idempotency").delete().eq("client_id", cliente.id).eq("key", llave).lt("expires_at", new Date().toISOString());
    const { error: errIns } = await db.from("wg_idempotency").insert({ client_id: cliente.id, key: llave, request_hash: hash, estado: "en_curso" });
    if (errIns) {
      const { data: previa } = await db.from("wg_idempotency").select("*").eq("client_id", cliente.id).eq("key", llave).maybeSingle();
      if (!previa) throw new ErrorApi(500, "internal error");
      if (previa.request_hash !== hash)
        throw new ErrorApi(422, "this Idempotency-Key was already used with a different request body: use a new key for a new shipment", [
          { location: "header.Idempotency-Key", value: llave },
        ]);
      if (previa.estado === "en_curso") {
        // Si quedó colgada más de 60 s (p. ej. la función murió), se libera
        if (Date.now() - new Date(previa.created_at).getTime() > 60000) {
          await db.from("wg_idempotency").delete().eq("client_id", cliente.id).eq("key", llave);
          throw new ErrorApi(409, "a previous request with this Idempotency-Key did not finish; retry");
        }
        throw new ErrorApi(409, "a request with this Idempotency-Key is still in progress; retry in a few seconds");
      }
      const f = await envioDelCliente(cliente.id, previa.shipment_id);
      return json(ctx, "ShipmentDetail", aDetalle(ctx, f, await estados()), 200, { "Idempotent-Replayed": "true" });
    }
    try {
      const b = validarCuerpo<CrearEnvio>("CreateShipmentRequestBody", cuerpo);
      const f = await crearEnvio(ctx, cliente, b);
      const detalle = aDetalle(ctx, f, await estados());
      await db
        .from("wg_idempotency")
        .update({ estado: "completada", response_status: 200, response_body: detalle, shipment_id: f.id })
        .eq("client_id", cliente.id)
        .eq("key", llave);
      return json(ctx, "ShipmentDetail", detalle);
    } catch (e) {
      // Una petición fallida no gasta la llave
      await db.from("wg_idempotency").delete().eq("client_id", cliente.id).eq("key", llave);
      throw e;
    }
  }
  const b = validarCuerpo<CrearEnvio>("CreateShipmentRequestBody", cuerpo);
  const f = await crearEnvio(ctx, cliente, b);
  return json(ctx, "ShipmentDetail", aDetalle(ctx, f, await estados()));
});

ruta("GET", "/v1/shipments/tracking/{tracking}", async (_req, ctx, cliente, p) => {
  const { data } = await supabaseServer()
    .from("wg_shipments")
    .select("*")
    .eq("client_id", cliente.id)
    .eq("tracking_number", decodeURIComponent(p.tracking))
    .maybeSingle();
  if (!data) throw new ErrorApi(404, "shipment not found");
  return json(ctx, "ShipmentDetail", aDetalle(ctx, data as FilaEnvio, await estados()));
});

ruta("GET", "/v1/shipments/{id}", async (_req, ctx, cliente, p) => {
  exigirUuid(p.id, "id");
  const f = await envioDelCliente(cliente.id, p.id);
  return json(ctx, "ShipmentDetail", aDetalle(ctx, f, await estados()));
});

ruta("POST", "/v1/shipments/{id}/cancel", async (req, ctx, cliente, p) => {
  exigirUuid(p.id, "id");
  const b = validarCuerpo<{ reason_id: string; comment?: string }>("CancelShipmentRequestBody", await leerJson(req));
  const f = await envioDelCliente(cliente.id, p.id);
  const cancelado = await cancelarPorCliente(f, b.reason_id, b.comment);
  return json(ctx, "ShipmentDetail", aDetalle(ctx, cancelado, await estados()));
});

ruta("GET", "/v1/shipments/{id}/events", async (_req, ctx, cliente, p) => {
  exigirUuid(p.id, "id");
  const f = await envioDelCliente(cliente.id, p.id);
  const evs = await eventosDe(f.id);
  return json(ctx, "ShipmentEventsResponseBody", { data: evs.map(aEvento) });
});

ruta("GET", "/v1/shipments/{id}/label", async (_req, _ctx, cliente, p) => {
  exigirUuid(p.id, "id");
  const f = await envioDelCliente(cliente.id, p.id);
  return respuestaGuia(f);
});

// ---------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------
type CrearAsignacion = {
  workflow_id: string;
  courier_id: string;
  shipment_id: string;
  blocking?: boolean;
  due_at?: string;
  external_ref?: string;
  note?: string;
  route_id?: string;
  stop_id?: string;
  vehicle_id?: string;
};

ruta("POST", "/v1/forms/assignments", async (req, ctx, cliente) => {
  const db = supabaseServer();
  const b = validarCuerpo<CrearAsignacion>("CreateFormAssignmentRequestBody", await leerJson(req));
  // Idempotente por external_ref: devuelve la existente con 200 (la nueva responde 201)
  if (b.external_ref) {
    const { data: previa } = await db.from("wg_forms_assignments").select("*").eq("client_id", cliente.id).eq("external_ref", b.external_ref).maybeSingle();
    if (previa) return json(ctx, "FormsAssignmentView", await vistaAsignacion(previa), 200);
  }
  const { data: wf } = UUID_RE.test(b.workflow_id)
    ? await db.from("wg_workflows").select("*").eq("id", b.workflow_id).maybeSingle()
    : { data: null };
  if (!wf || !wf.activo || wf.evento !== "office.assigned")
    throw new ErrorApi(422, "workflow_id must be an active workflow of your operator with the office.assigned event", [{ location: "body.workflow_id", value: b.workflow_id }]);
  const { data: cu } = UUID_RE.test(b.courier_id) ? await db.from("wg_couriers").select("id, activo").eq("id", b.courier_id).maybeSingle() : { data: null };
  if (!cu || !cu.activo) throw new ErrorApi(422, "courier_id is not an active driver of your operator", [{ location: "body.courier_id", value: b.courier_id }]);
  const { data: sh } = UUID_RE.test(b.shipment_id)
    ? await db.from("wg_shipments").select("id").eq("id", b.shipment_id).eq("client_id", cliente.id).maybeSingle()
    : { data: null };
  if (!sh) throw new ErrorApi(422, "shipment_id is not one of your shipments", [{ location: "body.shipment_id", value: b.shipment_id }]);
  const { data: nueva, error } = await db
    .from("wg_forms_assignments")
    .insert({
      client_id: cliente.id,
      workflow_id: b.workflow_id,
      courier_id: b.courier_id,
      shipment_id: b.shipment_id,
      route_id: b.route_id ?? null,
      stop_id: b.stop_id ?? null,
      vehicle_id: b.vehicle_id ?? null,
      due_at: b.due_at ?? null,
      note: b.note ?? null,
      blocking: b.blocking ?? false,
      external_ref: b.external_ref ?? null,
      created_by: `api:${cliente.nombre}`,
    })
    .select("*")
    .single();
  if (error) throw new ErrorApi(500, "could not create assignment");
  return json(ctx, "FormsAssignmentView", await vistaAsignacion(nueva), 201);
});

async function vistaAsignacion(a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const db = supabaseServer();
  const [{ data: wf }, { data: cu }, { data: sh }] = await Promise.all([
    db.from("wg_workflows").select("nombre").eq("id", a.workflow_id).maybeSingle(),
    db.from("wg_couriers").select("nombre").eq("id", a.courier_id).maybeSingle(),
    db.from("wg_shipments").select("tracking_number").eq("id", a.shipment_id).maybeSingle(),
  ]);
  return limpio({
    id: a.id,
    workflow_id: a.workflow_id,
    workflow_name: wf?.nombre ?? "",
    courier_id: a.courier_id,
    courier_name: cu?.nombre,
    shipment_id: a.shipment_id,
    tracking_number: sh?.tracking_number,
    route_id: a.route_id,
    stop_id: a.stop_id,
    vehicle_id: a.vehicle_id,
    due_at: rfc3339(a.due_at as string | null),
    note: a.note,
    blocking: a.blocking,
    status: a.status,
    source: a.source,
    source_ref: a.external_ref,
    created_by: a.created_by,
    run_id: a.run_id,
    created_at: rfc3339(a.created_at as string),
    updated_at: rfc3339(a.updated_at as string),
  });
}

ruta("GET", "/v1/forms/runs/{id}", async (_req, ctx, cliente, p) => {
  exigirUuid(p.id, "id");
  const db = supabaseServer();
  const { data: run } = await db.from("wg_forms_runs").select("*").eq("id", p.id).eq("client_id", cliente.id).maybeSingle();
  if (!run) throw new ErrorApi(404, "form run not found");
  const [{ data: wf }, { data: sh }] = await Promise.all([
    db.from("wg_workflows").select("nombre").eq("id", run.workflow_id).maybeSingle(),
    run.shipment_id ? db.from("wg_shipments").select("tracking_number").eq("id", run.shipment_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return json(
    ctx,
    "FormsPartnerRunView",
    limpio({
      id: run.id,
      assignment_id: run.assignment_id,
      workflow_id: run.workflow_id,
      workflow_name: wf?.nombre ?? "",
      event: run.event,
      status: run.status,
      outcome: run.outcome,
      flags: run.flags || [],
      occurred_at: rfc3339(run.occurred_at),
      submitted_at: rfc3339(run.submitted_at),
      forms: run.forms || [],
      file_urls: run.file_urls || {},
      incidents: run.incidents || [],
      latitude: run.latitude,
      longitude: run.longitude,
      route_id: run.route_id,
      shipment_id: run.shipment_id,
      tracking_number: (sh as { tracking_number?: string } | null)?.tracking_number,
    }),
  );
});

// ---------------------------------------------------------------------
// Guía PDF (con API key o pública por label_token)
// ---------------------------------------------------------------------
export async function respuestaGuia(f: FilaEnvio): Promise<Response> {
  const mapa = await estados();
  const pdf = pdfGuia({
    tracking: f.tracking_number,
    orden: f.order_number,
    remitente: f.sender_name || "",
    telefonoRemitente: f.sender_phone || undefined,
    destinatario: f.recipient_name,
    telefono: f.recipient_phone || undefined,
    direccion: f.recipient_address,
    direccion2: f.recipient_address_line2 || undefined,
    referencia: f.recipient_reference || undefined,
    piezas: f.pieces_count,
    peso: f.weight ? Number(f.weight) : undefined,
    cobrar: f.payment_type === "cod" ? Number(f.cod_amount) : 0,
    servicio: f.shipment_type_name || undefined,
    estado: mapa.get(f.current_state)?.name,
    notas: f.notes || undefined,
  });
  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="guia-${f.tracking_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------
export async function despachar(req: Request, segmentos: string[]): Promise<Response> {
  const ctx = ctxDesde(req);
  const ruta = "/" + segmentos.map(encodeURIComponent).join("/");
  try {
    const candidatas = rutas.filter((r) => r.patron.test(ruta));
    if (!candidatas.length) throw new ErrorApi(404, `no route for ${req.method} /partner${ruta}`);
    const r = candidatas.find((c) => c.metodo === req.method);
    if (!r) {
      const res = problema(ctx, 405, `method ${req.method} not allowed`);
      res.headers.set("Allow", candidatas.map((c) => c.metodo).join(", "));
      return res;
    }
    const m = ruta.match(r.patron)!;
    const params: Record<string, string> = {};
    r.nombres.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    const cliente = await autenticar(req);
    return await r.manejar(req, ctx, cliente, params);
  } catch (e) {
    if (e instanceof ErrorApi) return problema(ctx, e.status, e.detail, e.errors);
    console.error("[emulador] error no controlado", e);
    return problema(ctx, 500, "internal server error");
  }
}
