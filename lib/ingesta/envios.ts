import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { ShipmentDetail, WaygoClient } from "@/lib/waygo/client";
import { mapearEstadoCon } from "@/lib/waygo/estados";

// Ingesta de envíos de Waygo a la tabla `envios` (upsert por waygo_shipment_id).
// Solo hace validación básica. Riesgo, prioridad y grupo de control quedan en null
// para los workers de la Fase 4 (ver docs/ARQUITECTURA_DEMO.md → puntos de extensión).

/** Normaliza un celular colombiano a E.164 (+573XXXXXXXXX). Devuelve null si no es un celular válido. */
export function normalizarTelefonoCO(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  let d = crudo.replace(/\D/g, "");
  if (d.startsWith("0057")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("57")) d = d.slice(2);
  return /^3\d{9}$/.test(d) ? `+57${d}` : null;
}

export type Validacion = { ok: boolean; problemas: string[] };

/** Validador básico: teléfono E.164 colombiano, dirección presente y COD > 0 (si es COD). */
export function validarEnvio(d: Pick<ShipmentDetail, "recipient_phone" | "recipient_address" | "is_cod" | "cod_amount">): Validacion {
  const problemas: string[] = [];
  if (!normalizarTelefonoCO(d.recipient_phone)) problemas.push("telefono_invalido");
  if (!d.recipient_address || d.recipient_address.trim().length < 5) problemas.push("direccion_faltante");
  if (d.is_cod && !(Number(d.cod_amount) > 0)) problemas.push("cod_no_positivo");
  return { ok: problemas.length === 0, problemas };
}

/** Heurística: "Cl 38 Sur # 72D-15, Timiza, Bogotá" → zona "Timiza", ciudad "Bogotá". */
export function zonaYCiudad(direccion: string | undefined): { zona: string | null; ciudad: string | null } {
  const partes = (direccion || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (partes.length < 2) return { zona: null, ciudad: null };
  return { ciudad: partes[partes.length - 1], zona: partes.length >= 3 ? partes[partes.length - 2] : null };
}

// Estados de la intención que "pertenecen" al validador: solo estos se recalculan en cada upsert.
const ESTADOS_DEL_VALIDADOR = new Set(["PENDIENTE_CONTACTO", "NUMERO_INVALIDO"]);

export type ResultadoUpsert = { envio_id: string; nuevo: boolean; cambio_estado: boolean; estado_buffer: string; validacion: Validacion };

/** Inserta o actualiza un envío a partir del detalle de GET /v1/shipments/{id}. Idempotente. */
export async function upsertEnvio(
  cliente: WaygoClient,
  d: ShipmentDetail,
  extra: { fuente: "webhook" | "sync"; client_id?: string | null; novedad?: Record<string, unknown> | null },
): Promise<ResultadoUpsert> {
  const db = supabaseServer();
  const { data: previo } = await db
    .from("envios")
    .select("id, estado_buffer, waygo_status_code")
    .eq("waygo_shipment_id", d.id)
    .maybeSingle();

  const estado = await mapearEstadoCon(cliente, d.current_state);
  const validacion = validarEnvio(d);
  const estadoValidador = validacion.problemas.includes("telefono_invalido") ? "NUMERO_INVALIDO" : "PENDIENTE_CONTACTO";
  const estadoBuffer = !previo || ESTADOS_DEL_VALIDADOR.has(previo.estado_buffer) ? estadoValidador : previo.estado_buffer;
  const { zona, ciudad } = zonaYCiudad(d.recipient_address);

  const fila: Record<string, unknown> = {
    waygo_shipment_id: d.id,
    tracking_number: d.tracking_number,
    order_number: d.order_number ?? null,
    tienda: d.sender_name ?? null,
    comprador_nombre: d.recipient_name,
    telefono: d.recipient_phone ?? null,
    telefono_e164: normalizarTelefonoCO(d.recipient_phone),
    direccion: d.recipient_address,
    direccion_linea2: d.recipient_address_line2 ?? null,
    referencia: d.recipient_reference ?? null,
    zona,
    ciudad,
    notas: d.notes ?? null,
    es_cod: d.is_cod,
    payment_type: d.payment_type ?? null,
    cod_monto: d.is_cod ? d.cod_amount ?? null : null,
    shipping_price: d.shipping_price ?? null,
    pieces_count: d.pieces_count,
    weight: d.weight ?? null,
    shipment_type_code: d.shipment_type_code ?? null,
    shipment_type_name: d.shipment_type_name ?? null,
    delivery_attempts: d.delivery_attempts,
    tracking_url: d.tracking_url ?? null,
    label_url: d.label_url ?? null,
    waygo_status_code: estado.code,
    waygo_status_name: estado.name ?? d.current_state_name ?? null,
    waygo_is_initial: estado.is_initial,
    waygo_is_final: estado.is_final,
    waygo_is_novelty: estado.is_novelty,
    waygo_is_return: estado.is_return,
    waygo_outcome: estado.outcome,
    waygo_fase: estado.fase,
    waygo_created_at: d.created_at,
    waygo_updated_at: d.updated_at,
    estado_buffer: estadoBuffer,
    validacion,
    fuente: extra.fuente,
    sincronizado_at: new Date().toISOString(),
  };
  if (extra.client_id) fila.waygo_client_id = extra.client_id;
  if (extra.novedad) fila.ultima_novedad = extra.novedad;

  const { data, error } = await db.from("envios").upsert(fila, { onConflict: "waygo_shipment_id" }).select("id").single();
  if (error) throw new Error(`upsert envios: ${error.message}`);
  return {
    envio_id: data.id,
    nuevo: !previo,
    cambio_estado: !!previo && previo.waygo_status_code !== estado.code,
    estado_buffer: estadoBuffer,
    validacion,
  };
}

/** Registra una fila en `eventos` (auditoría + feed). No lanza errores. */
export async function registrarEvento(e: {
  componente: string;
  herramienta?: string | null;
  envio_id?: string | null;
  entrada?: unknown;
  resultado?: unknown;
  nivel?: "debug" | "info" | "ok" | "aviso" | "error";
  mensaje?: string;
}): Promise<void> {
  const { error } = await supabaseServer()
    .from("eventos")
    .insert({ nivel: "info", ...e });
  if (error) console.error("[eventos] no se pudo registrar:", error.message);
}
