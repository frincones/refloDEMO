import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { ErrorApi, limpio, rfc3339, type Cliente, type Ctx } from "./http";
import { emitirEventosEnvio, type DatosEvento, type EventoEnvio } from "./webhooks";

// ---------------------------------------------------------------------
// Tipos de filas (tablas wg_*)
// ---------------------------------------------------------------------
export type Estado = {
  code: string;
  name: string;
  color: string | null;
  is_initial: boolean;
  is_final: boolean;
  is_novelty: boolean;
  is_return: boolean;
  outcome: string | null;
  orden: number;
};

export type FilaEnvio = {
  id: string;
  client_id: string;
  tracking_number: string;
  order_number: string;
  label_token: string;
  warehouse_id: string;
  is_pickup: boolean;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_address: string;
  recipient_address_line2: string | null;
  recipient_reference: string | null;
  recipient_city_id: string;
  payment_type: "prepaid" | "cod";
  payment_method_id: string | null;
  cod_amount: number | null;
  declared_value: number | null;
  weight: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  pieces_count: number;
  notes: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  shipment_type_id: string | null;
  shipment_type_code: string | null;
  shipment_type_name: string | null;
  shipping_price: number | null;
  chargeable_weight_kg: number | null;
  current_state: string;
  delivery_attempts: number;
  current_attempt: number | null;
  courier_id: string | null;
  route_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FilaEventoEnvio = {
  id: number;
  shipment_id: string;
  from_state: string;
  state: string;
  state_name: string | null;
  occurred_at: string;
  notes: string | null;
  attempt_number: number | null;
  novelty: Record<string, unknown> | null;
  courier_id: string | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  signature_url: string | null;
};

// ---------------------------------------------------------------------
// Catálogos con caché corta en memoria (se invalida al sembrar)
// ---------------------------------------------------------------------
let cacheEstados: { t: number; mapa: Map<string, Estado> } | null = null;

export function invalidarCaches(): void {
  cacheEstados = null;
}

export async function estados(): Promise<Map<string, Estado>> {
  if (cacheEstados && Date.now() - cacheEstados.t < 15000) return cacheEstados.mapa;
  const { data, error } = await supabaseServer().from("wg_statuses").select("*").order("orden");
  if (error) throw new ErrorApi(500, "internal error");
  const mapa = new Map<string, Estado>((data || []).map((e) => [e.code, e as Estado]));
  cacheEstados = { t: Date.now(), mapa };
  return mapa;
}

/** Código del estado inicial y del de "en bodega" según las banderas sembradas. */
export async function codigoInicial(): Promise<string> {
  for (const e of (await estados()).values()) if (e.is_initial) return e.code;
  throw new ErrorApi(500, "no initial status configured");
}

// Códigos propios del emulador (el emulador es "la operación"; los clientes deben usar banderas).
export const EN_BODEGA = "in_warehouse";
export const EN_RUTA = "in_route";
export const ENTREGADO = "delivered";
export const NOVEDAD = "novelty";
export const CANCELADO = "cancelled";
export const EN_DEVOLUCION = "return_in_transit";
export const DEVUELTO = "returned";
export const EXTRAVIADO = "lost";

// ---------------------------------------------------------------------
// Representaciones del spec
// ---------------------------------------------------------------------
export function urls(ctx: Ctx, f: FilaEnvio) {
  return {
    label_url: `${ctx.origen}/api/waygo-emu/publico/guia/${f.label_token}`,
    tracking_url: `${ctx.origen}/api/waygo-emu/publico/seguimiento/${f.label_token}`,
  };
}

const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));

/** ShipmentDetail */
export function aDetalle(ctx: Ctx, f: FilaEnvio, mapa: Map<string, Estado>): Record<string, unknown> {
  return limpio({
    id: f.id,
    tracking_number: f.tracking_number,
    order_number: f.order_number,
    current_state: f.current_state,
    current_state_name: mapa.get(f.current_state)?.name,
    delivery_attempts: f.delivery_attempts,
    is_pickup: f.is_pickup,
    is_cod: f.payment_type === "cod",
    payment_type: f.payment_type,
    cod_amount: f.payment_type === "cod" ? num(f.cod_amount) : undefined,
    declared_value: num(f.declared_value),
    recipient_name: f.recipient_name,
    recipient_phone: f.recipient_phone,
    recipient_address: f.recipient_address,
    recipient_address_line2: f.recipient_address_line2,
    recipient_reference: f.recipient_reference,
    notes: f.notes,
    sender_name: f.sender_name,
    sender_phone: f.sender_phone,
    pieces_count: f.pieces_count,
    weight: num(f.weight),
    length_cm: num(f.length_cm),
    width_cm: num(f.width_cm),
    height_cm: num(f.height_cm),
    shipment_type_code: f.shipment_type_code,
    shipment_type_name: f.shipment_type_name,
    shipping_price: num(f.shipping_price),
    ...urls(ctx, f),
    created_at: rfc3339(f.created_at),
    updated_at: rfc3339(f.updated_at),
  });
}

/** ShipmentSummary (listado) */
export function aResumen(ctx: Ctx, f: FilaEnvio, mapa: Map<string, Estado>): Record<string, unknown> {
  return limpio({
    id: f.id,
    tracking_number: f.tracking_number,
    order_number: f.order_number,
    current_state: f.current_state,
    current_state_name: mapa.get(f.current_state)?.name,
    is_cod: f.payment_type === "cod",
    cod_amount: f.payment_type === "cod" ? num(f.cod_amount) : undefined,
    recipient_name: f.recipient_name,
    recipient_phone: f.recipient_phone,
    recipient_address: f.recipient_address,
    pieces_count: f.pieces_count,
    weight: num(f.weight),
    shipment_type_code: f.shipment_type_code,
    shipment_type_name: f.shipment_type_name,
    shipping_price: num(f.shipping_price),
    ...urls(ctx, f),
    created_at: rfc3339(f.created_at),
    updated_at: rfc3339(f.updated_at),
  });
}

/** ShipmentEvent */
export function aEvento(e: FilaEventoEnvio): Record<string, unknown> {
  return limpio({
    state: e.state,
    state_name: e.state_name,
    from_state: e.from_state,
    occurred_at: rfc3339(e.occurred_at),
    notes: e.notes,
    attempt_number: e.attempt_number,
    novelty: e.novelty ? limpio(e.novelty) : undefined,
    photo_url: e.photo_url,
    photo_urls: e.photo_urls,
    signature_url: e.signature_url,
  });
}

// ---------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------
export async function envioDelCliente(clienteId: string, id: string): Promise<FilaEnvio> {
  const { data, error } = await supabaseServer().from("wg_shipments").select("*").eq("id", id).eq("client_id", clienteId).maybeSingle();
  if (error) throw new ErrorApi(500, "internal error");
  // Envío de otro cliente → 404, nunca 403
  if (!data) throw new ErrorApi(404, "shipment not found");
  return data as FilaEnvio;
}

export async function eventosDe(id: string): Promise<FilaEventoEnvio[]> {
  const { data } = await supabaseServer()
    .from("wg_shipment_events")
    .select("*")
    .eq("shipment_id", id)
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true });
  return (data || []) as FilaEventoEnvio[];
}

// ---------------------------------------------------------------------
// Tipo de servicio por horario de corte y precio
// ---------------------------------------------------------------------
type TipoServicio = { id: string; code: string; name: string };

/** Hora local de Bogotá (UTC−5, sin horario de verano) en minutos desde medianoche. */
function minutosBogota(d: Date): number {
  const local = new Date(d.getTime() - 5 * 3600 * 1000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Same Day si se crea antes del corte del cliente; Next Day si después (hora Bogotá). */
export async function tipoServicio(cliente: Cliente, ahora = new Date()): Promise<TipoServicio | null> {
  const { data } = await supabaseServer().from("wg_catalogs").select("id, code, name").eq("tipo", "shipment_type").eq("activo", true);
  const tipos = (data || []) as TipoServicio[];
  const [h, m] = String(cliente.service_cutoff || "13:00").split(":").map(Number);
  const corte = h * 60 + (m || 0);
  const code = minutosBogota(ahora) < corte ? "SAME_DAY" : "NEXT_DAY";
  return tipos.find((t) => t.code === code) || null;
}

export type DatosPrecio = {
  payment_type: "prepaid" | "cod";
  cod_amount?: number;
  declared_value?: number;
  weight?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
};

/** Reglas de pago comunes a quotes y shipments (422). */
export function validarPago(d: DatosPrecio): number | undefined {
  if (d.payment_type === "cod") {
    if (d.cod_amount === undefined || d.cod_amount === null)
      throw new ErrorApi(422, "cod_amount is required when payment_type is cod", [{ location: "body.cod_amount", message: "required for cod" }]);
    if (d.cod_amount <= 0)
      throw new ErrorApi(422, "cod_amount must be greater than 0", [{ location: "body.cod_amount", message: "must be > 0", value: d.cod_amount }]);
    if (d.declared_value !== undefined && d.declared_value !== d.cod_amount)
      throw new ErrorApi(422, "declared_value must equal cod_amount for cod", [{ location: "body.declared_value", message: "must equal cod_amount", value: d.declared_value }]);
    return d.cod_amount;
  }
  if (d.cod_amount !== undefined && d.cod_amount !== null)
    throw new ErrorApi(422, "cod_amount must not be sent when payment_type is prepaid", [{ location: "body.cod_amount", message: "not allowed for prepaid", value: d.cod_amount }]);
  return d.declared_value;
}

/** Precio con la lista del cliente: base + recargo Same Day + $/kg cobrable + % del COD. Impuestos incluidos. */
export function precio(cliente: Cliente, d: DatosPrecio, tipo: TipoServicio | null): { total_price: number; chargeable_weight_kg: number } {
  if (!cliente.tiene_lista_precios) throw new ErrorApi(422, "your account has no price list");
  const volumetrico =
    d.length_cm && d.width_cm && d.height_cm ? (d.length_cm * d.width_cm * d.height_cm) / 5000 : 0;
  const cobrable = Math.round(Math.max(d.weight || 0, volumetrico) * 1000) / 1000;
  const recargo = tipo?.code === "SAME_DAY" ? 2500 : 0;
  const cod = d.payment_type === "cod" ? (d.cod_amount || 0) * cliente.cod_fee_pct : 0;
  const total = cliente.tarifa_base + recargo + cliente.tarifa_kg * Math.ceil(cobrable) + cod;
  return { total_price: Math.round(total), chargeable_weight_kg: cobrable };
}

// ---------------------------------------------------------------------
// Crear envío
// ---------------------------------------------------------------------
export type CrearEnvio = DatosPrecio & {
  warehouse_id: string;
  is_pickup: boolean;
  recipient_name: string;
  recipient_address: string;
  recipient_address_line2?: string;
  recipient_city_id: string;
  recipient_phone?: string;
  recipient_reference?: string;
  payment_method_id?: string;
  pieces_count?: number;
  notes?: string;
  order_number?: string;
  sender_name?: string;
  sender_phone?: string;
};

export async function crearEnvio(
  ctx: Ctx,
  cliente: Cliente,
  b: CrearEnvio,
  opciones: { ahora?: Date; emitir?: boolean } = {},
): Promise<FilaEnvio> {
  const db = supabaseServer();
  const ahora = opciones.ahora || new Date();

  // Bodega: de la operación o sucursal propia; otra cosa → 422 con el mismo mensaje
  const { data: bodega } = await db.from("wg_warehouses").select("id, client_id, activa").eq("id", b.warehouse_id).maybeSingle();
  if (!bodega || !bodega.activa || (bodega.client_id && bodega.client_id !== cliente.id))
    throw new ErrorApi(422, "warehouse_id does not exist or is not available to you", [{ location: "body.warehouse_id", message: "unknown warehouse", value: b.warehouse_id }]);
  if (bodega.client_id && b.is_pickup)
    throw new ErrorApi(422, "is_pickup must be false for a sucursal", [{ location: "body.is_pickup", message: "a sucursal only accepts is_pickup=false", value: b.is_pickup }]);

  // Ciudad: debe existir y ser de nivel city
  const { data: ciudad } = await db.from("wg_locations").select("id, level").eq("id", b.recipient_city_id).maybeSingle();
  if (!ciudad || ciudad.level !== "city")
    throw new ErrorApi(422, "recipient_city_id does not exist or is not a city", [{ location: "body.recipient_city_id", message: "unknown city", value: b.recipient_city_id }]);

  if (b.payment_method_id) {
    const { data: pm } = await db.from("wg_catalogs").select("id, activo").eq("tipo", "payment_method").eq("id", b.payment_method_id).maybeSingle();
    if (!pm || !pm.activo)
      throw new ErrorApi(422, "payment_method_id is unknown or inactive", [{ location: "body.payment_method_id", message: "unknown payment method", value: b.payment_method_id }]);
  }

  const declarado = validarPago(b);
  const tipo = await tipoServicio(cliente, ahora);
  const p = precio(cliente, b, tipo);

  // order_number único entre envíos vivos de toda la operación
  const orderNumber = b.order_number || `ORD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
  await verificarOrderNumber(cliente, orderNumber);

  const { data: tracking, error: errTr } = await db.rpc("wg_next_tracking");
  if (errTr || !tracking) throw new ErrorApi(500, "could not generate tracking number");

  const inicial = await codigoInicial();
  const fila = {
    id: randomUUID(),
    client_id: cliente.id,
    tracking_number: String(tracking),
    order_number: orderNumber,
    warehouse_id: b.warehouse_id,
    is_pickup: b.is_pickup,
    recipient_name: b.recipient_name,
    recipient_phone: b.recipient_phone ?? null,
    recipient_address: b.recipient_address,
    recipient_address_line2: b.recipient_address_line2 ?? null,
    recipient_reference: b.recipient_reference ?? null,
    recipient_city_id: b.recipient_city_id,
    payment_type: b.payment_type,
    payment_method_id: b.payment_method_id ?? null,
    cod_amount: b.payment_type === "cod" ? b.cod_amount : null,
    declared_value: declarado ?? null,
    weight: b.weight ?? null,
    length_cm: b.length_cm ?? null,
    width_cm: b.width_cm ?? null,
    height_cm: b.height_cm ?? null,
    pieces_count: b.pieces_count ?? 1,
    notes: b.notes ?? null,
    sender_name: b.sender_name ?? cliente.nombre,
    sender_phone: b.sender_phone ?? cliente.telefono_contacto,
    shipment_type_id: tipo?.id ?? null,
    shipment_type_code: tipo?.code ?? null,
    shipment_type_name: tipo?.name ?? null,
    shipping_price: p.total_price,
    chargeable_weight_kg: p.chargeable_weight_kg,
    current_state: inicial,
    created_at: ahora.toISOString(),
    updated_at: ahora.toISOString(),
  };
  const { data: creada, error } = await db.from("wg_shipments").insert(fila).select("*").single();
  if (error) {
    if (error.code === "23505" && /order/.test(error.message)) await verificarOrderNumber(cliente, orderNumber);
    throw new ErrorApi(500, "could not create shipment");
  }
  const mapa = await estados();
  await db.from("wg_shipment_events").insert({
    shipment_id: creada.id,
    from_state: "",
    state: inicial,
    state_name: mapa.get(inicial)?.name,
    occurred_at: ahora.toISOString(),
  });
  const eventos: Parameters<typeof emitirEventosEnvio>[1] = [
    { event: "shipment.created", from_state: "", to_state: inicial, timestamp: ahora.toISOString(), data: datosBase(creada as FilaEnvio) },
  ];

  let final = creada as FilaEnvio;
  // Sin recogida: pasa a "en bodega" apenas se crea
  if (!b.is_pickup) {
    const r = await aplicarTransicion(final, EN_BODEGA, { emitir: false, ahora: new Date(ahora.getTime() + 1000) });
    final = r.fila;
    eventos.push(...r.eventos);
  }
  if (opciones.emitir !== false) await emitirEventosEnvio(final, eventos);
  return final;
}

async function verificarOrderNumber(cliente: Cliente, orderNumber: string): Promise<void> {
  const { data: existente } = await supabaseServer()
    .from("wg_shipments")
    .select("id, client_id, tracking_number")
    .eq("order_number", orderNumber)
    .is("cancelled_at", null)
    .maybeSingle();
  if (!existente) return;
  if (existente.client_id === cliente.id)
    throw new ErrorApi(409, `order_number is already in use by one of your shipments: ${existente.tracking_number}`, [
      { location: "body.order_number", value: { shipment_id: existente.id, tracking_number: existente.tracking_number } },
    ]);
  throw new ErrorApi(409, "order_number is already in use", [{ location: "body.order_number", value: orderNumber }]);
}

function datosBase(f: FilaEnvio): DatosEvento {
  return { recipient_name: f.recipient_name, recipient_address: f.recipient_address };
}

// ---------------------------------------------------------------------
// Transiciones de estado (operador del emulador y cancelación del cliente)
// ---------------------------------------------------------------------
export type OpcionesTransicion = {
  courier_id?: string | null;
  notes?: string | null;
  novelty_type_id?: string | null;
  novelty_description?: string | null;
  reschedule_date?: string | null;
  emitir?: boolean;
  ahora?: Date;
  origen?: Ctx | null; // para URLs de evidencia
};

/** Qué estados acepta el panel del operador desde cada estado. */
export const TRANSICIONES: Record<string, string[]> = {
  created: [EN_BODEGA, CANCELADO, EXTRAVIADO],
  in_warehouse: [EN_RUTA, CANCELADO, EN_DEVOLUCION, EXTRAVIADO],
  in_route: [ENTREGADO, NOVEDAD, EN_BODEGA, EXTRAVIADO],
  novelty: [EN_RUTA, EN_BODEGA, EN_DEVOLUCION, CANCELADO, EXTRAVIADO],
  return_in_transit: [DEVUELTO, EXTRAVIADO],
};

export async function aplicarTransicion(
  f: FilaEnvio,
  destino: string,
  o: OpcionesTransicion = {},
): Promise<{ fila: FilaEnvio; eventos: { event: EventoEnvio; from_state: string; to_state: string; timestamp: string; data: DatosEvento }[] }> {
  const db = supabaseServer();
  const mapa = await estados();
  const est = mapa.get(destino);
  if (!est) throw new ErrorApi(422, `unknown state ${destino}`);
  const ahora = o.ahora || new Date();
  const cambios: Partial<FilaEnvio> = { current_state: destino, updated_at: ahora.toISOString() };
  let attempt: number | null = null;
  let novelty: Record<string, unknown> | null = null;
  let fotos: { photo_url?: string; photo_urls?: string[]; signature_url?: string } = {};
  let courier = f.courier_id;

  if (destino === EN_RUTA) {
    courier = o.courier_id || f.courier_id;
    if (!courier) throw new ErrorApi(422, "courier_id is required to put a shipment on a route");
    cambios.courier_id = courier;
    cambios.route_id = randomUUID();
    attempt = (f.delivery_attempts || 0) + 1;
    cambios.current_attempt = attempt;
  } else if (destino === ENTREGADO || destino === NOVEDAD) {
    attempt = f.current_attempt || (f.delivery_attempts || 0) + 1;
    cambios.delivery_attempts = attempt;
    cambios.current_attempt = null;
    cambios.route_id = null;
    if (destino === NOVEDAD) {
      if (!o.novelty_type_id) throw new ErrorApi(422, "novelty_type_id is required for a failed attempt");
      const { data: nt } = await db.from("wg_novelty_types").select("id, name").eq("id", o.novelty_type_id).maybeSingle();
      if (!nt) throw new ErrorApi(422, "unknown novelty_type_id");
      novelty = limpio({ type_id: nt.id, type_name: nt.name, description: o.novelty_description || undefined, reschedule_date: o.reschedule_date || undefined });
    } else if (o.origen) {
      const base = `${o.origen.origen}/api/waygo-emu/publico/evidencia/${f.label_token}`;
      fotos = { photo_url: `${base}/fachada.svg`, photo_urls: [`${base}/fachada.svg`, `${base}/paquete.svg`], signature_url: `${base}/firma.svg` };
    }
  } else if (destino === EN_BODEGA) {
    cambios.route_id = null;
    cambios.current_attempt = null;
  }
  if (destino === CANCELADO) {
    cambios.cancelled_at = ahora.toISOString(); // libera el order_number
    cambios.route_id = null;
  }

  const { data: nueva, error } = await db.from("wg_shipments").update(cambios).eq("id", f.id).select("*").single();
  if (error) throw new ErrorApi(500, "could not update shipment");
  await db.from("wg_shipment_events").insert({
    shipment_id: f.id,
    from_state: f.current_state,
    state: destino,
    state_name: est.name,
    occurred_at: ahora.toISOString(),
    notes: o.notes || (novelty ? (novelty.description as string | undefined) : undefined) || null,
    attempt_number: attempt,
    novelty,
    courier_id: courier,
    photo_url: fotos.photo_url ?? null,
    photo_urls: fotos.photo_urls ?? null,
    signature_url: fotos.signature_url ?? null,
  });

  const data: DatosEvento = {
    ...datosBase(f),
    attempt_number: attempt,
    courier_id: courier,
    notes: o.notes || (novelty?.description as string | undefined) || null,
    novelty,
    ...fotos,
  };
  const eventos: { event: EventoEnvio; from_state: string; to_state: string; timestamp: string; data: DatosEvento }[] = [
    { event: "shipment.state_changed", from_state: f.current_state, to_state: destino, timestamp: ahora.toISOString(), data },
  ];
  if (destino === ENTREGADO) eventos.push({ event: "shipment.delivered", from_state: f.current_state, to_state: destino, timestamp: ahora.toISOString(), data });
  if (destino === CANCELADO) eventos.push({ event: "shipment.cancelled", from_state: f.current_state, to_state: destino, timestamp: ahora.toISOString(), data });

  if (o.emitir !== false) await emitirEventosEnvio(nueva as FilaEnvio, eventos);
  return { fila: nueva as FilaEnvio, eventos };
}

/** Cancelación del cliente: solo antes de salir a reparto. */
export async function cancelarPorCliente(f: FilaEnvio, reasonId: string, comment?: string): Promise<FilaEnvio> {
  const { data: motivo } = await supabaseServer()
    .from("wg_catalogs")
    .select("id, name, data, activo")
    .eq("tipo", "cancel_reason")
    .eq("id", reasonId)
    .maybeSingle();
  const permitido = motivo && motivo.activo && (motivo.data as { client_allowed?: boolean })?.client_allowed !== false;
  if (!permitido) throw new ErrorApi(422, "reason_id is not one of your cancel reasons", [{ location: "body.reason_id", message: "unknown reason", value: reasonId }]);
  if ((motivo.data as { require_comment?: boolean })?.require_comment && !comment?.trim())
    throw new ErrorApi(422, "this reason requires a comment", [{ location: "body.comment", message: "required by the reason" }]);

  const est = (await estados()).get(f.current_state);
  const cancelable =
    !!est && !est.is_final && (est.is_initial || f.current_state === EN_BODEGA) && (f.delivery_attempts || 0) === 0 && !f.route_id;
  if (!cancelable)
    throw new ErrorApi(409, "the shipment can no longer be cancelled through the API: it is on a route, out for delivery, past a delivery attempt or in a final state. Ask your operator");
  const r = await aplicarTransicion(f, CANCELADO, { notes: comment ? `${motivo.name}: ${comment}` : motivo.name });
  return r.fila;
}
