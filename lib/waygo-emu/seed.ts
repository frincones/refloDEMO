import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { sha256, type Cliente } from "./http";
import { invalidarCaches, precio } from "./envios";

// Semilla del emulador: catálogos colombianos, estados con banderas, mensajeros, clientes,
// API keys y 18 envíos COD de Bogotá Sur (los del mockup).
// Los ids de catálogos son deterministas (uuidDet) para que sean estables entre reinicios.

/** UUID determinista (estilo v5) a partir de un nombre. */
export function uuidDet(nombre: string): string {
  const h = createHash("sha256").update(`reflo-demo:${nombre}`).digest("hex");
  const v = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return v;
}

/** Llave del cliente de pruebas de contrato: derivada de DEMO_ADMIN_TOKEN (las pruebas la calculan igual). */
export function llaveQa(adminToken: string): string {
  return `tms_c_qa_${createHmac("sha256", adminToken).update("qa-contrato").digest("hex").slice(0, 32)}`;
}

export const IDS = {
  clientePrincipal: uuidDet("cliente:tienda-moda-andina"),
  clienteQa: uuidDet("cliente:qa-contrato"),
  colombia: uuidDet("loc:CO"),
  bogota: uuidDet("loc:city:11001"),
  medellin: uuidDet("loc:city:05001"),
  cali: uuidDet("loc:city:76001"),
  bodegaBogotaSur: uuidDet("wh:BOG-SUR"),
  sucursalModaAndina: uuidDet("wh:SUC-TMA"),
  efectivo: uuidDet("pm:efectivo"),
  workflowRecaudo: uuidDet("wf:recaudo"),
  runEjemplo: uuidDet("run:recaudo-48240"),
};

const ZONAS_BOGOTA_SUR = ["Timiza", "Patio Bonito", "Bosa Recreo", "Kennedy Central", "Tintal", "Castilla", "Venecia", "Marsella", "Meissen", "Santa Lucía", "Olaya", "Restrepo", "Carvajal", "Ciudad Montes"];

const PREFIJO_TIENDA: Record<string, string> = {
  "Tienda Moda Andina": "TMA",
  "Calzado Pacífico": "CPA",
  "Hogar & Cocina Express": "HCE",
  TecnoBarrio: "TBA",
  "Belleza Natural Co.": "BNC",
  "Deportes Cumbre": "DCU",
  "Mascotas Felices": "MFE",
  "Electro Hogar Sabana": "EHS",
  "Juguetería Arcoíris": "JAR",
  "Natural Vital": "NVI",
};

// [guía, tienda, comprador, zonaIdx, monto COD, hora de creación (Bogotá, "D-1 HH:MM" o "D HH:MM")]
const ENVIOS_MOCKUP: [string, string, string, number, number, string][] = [
  ["RF2610-48213", "Tienda Moda Andina", "Valentina Rodríguez", 0, 189900, "D-1 10:12"],
  ["RF2610-48227", "Calzado Pacífico", "Andrés Moreno", 1, 129000, "D-1 11:40"],
  ["RF2610-48231", "Hogar & Cocina Express", "Luz Dary Peña", 2, 349900, "D-1 14:05"],
  ["RF2610-48240", "TecnoBarrio", "Jhon Fredy Castaño", 3, 1249000, "D-1 15:22"],
  ["RF2610-48252", "Belleza Natural Co.", "Marcela Gómez", 4, 89900, "D-1 16:48"],
  ["RF2610-48266", "Deportes Cumbre", "Kevin Sánchez", 5, 219900, "D-1 18:30"],
  ["RF2610-48271", "Tienda Moda Andina", "Daniela Ortiz", 6, 159900, "D-1 20:15"],
  ["RF2610-48285", "Mascotas Felices", "Camilo Torres", 7, 74900, "D-1 21:02"],
  ["RF2610-48290", "Electro Hogar Sabana", "Yeimy Cárdenas", 8, 1089000, "D-1 22:47"],
  ["RF2610-48304", "Juguetería Arcoíris", "Brayan López", 9, 139900, "D 00:35"],
  ["RF2610-48317", "Tienda Moda Andina", "Sandra Vargas", 10, 199900, "D 02:14"],
  ["RF2610-48322", "Natural Vital", "Óscar Herrera", 11, 64900, "D 06:50"],
  ["RF2610-48336", "Calzado Pacífico", "Leidy Jiménez", 12, 179900, "D 07:31"],
  ["RF2610-48341", "Hogar & Cocina Express", "Wilson Arias", 13, 289900, "D 08:09"],
  ["RF2610-48358", "TecnoBarrio", "Natalia Espinosa", 0, 459900, "D 08:44"],
  ["RF2610-48362", "Belleza Natural Co.", "Diana Quintero", 1, 99900, "D 09:20"],
  ["RF2610-48377", "Deportes Cumbre", "Julián Benítez", 2, 249900, "D 09:58"],
  ["RF2610-48381", "Mascotas Felices", "Ana María Muñoz", 3, 54900, "D 10:26"],
];

/** Fecha UTC a partir de "D-1 HH:MM" / "D HH:MM" en hora de Bogotá (UTC−5), relativa a hoy. */
function fechaBogota(rel: string, ahora = new Date()): Date {
  const [dia, hm] = rel.split(" ");
  const [h, m] = hm.split(":").map(Number);
  const hoyBog = new Date(ahora.getTime() - 5 * 3600 * 1000); // "reloj" de Bogotá
  const base = Date.UTC(hoyBog.getUTCFullYear(), hoyBog.getUTCMonth(), hoyBog.getUTCDate(), h + 5, m);
  return new Date(base - (dia === "D-1" ? 24 * 3600 * 1000 : 0));
}

/** Teléfono celular colombiano determinista; algunos en formatos distintos para ejercitar la normalización. */
function telefono(i: number, guia: string): string {
  const n = parseInt(createHash("md5").update(guia).digest("hex").slice(0, 8), 16);
  const prefijos = ["300", "301", "304", "310", "311", "312", "313", "315", "316", "317", "318", "320", "321", "350"];
  const pre = prefijos[n % prefijos.length];
  const resto = String(n % 10000000).padStart(7, "0");
  if (i % 3 === 1) return `${pre}${resto}`; // sin indicativo
  if (i % 3 === 2) return `+57 ${pre} ${resto.slice(0, 3)} ${resto.slice(3)}`; // con espacios
  return `+57${pre}${resto}`; // E.164
}

function direccion(zi: number, zona: string): string {
  return `Cl ${20 + zi} Sur # ${30 + zi * 3}-${10 + zi}, ${zona}, Bogotá`;
}

export async function sembrarEmulador(opciones: { resetear?: boolean } = {}): Promise<Record<string, number>> {
  const db = supabaseServer();
  const q = async (p: PromiseLike<{ error: { message: string } | null }>, que: string) => {
    const { error } = await p;
    if (error) throw new Error(`Semilla (${que}): ${error.message}`);
  };
  if (opciones.resetear !== false) await q(db.rpc("wg_reset"), "wg_reset");

  // ---- Estados con banderas ----
  await q(
    db.from("wg_statuses").insert([
      { code: "created", name: "Creado", color: "#9CB3B7", is_initial: true, orden: 1 },
      { code: "in_warehouse", name: "En bodega", color: "#6FAEDB", orden: 2 },
      { code: "in_route", name: "En ruta", color: "#0E7C86", orden: 3 },
      { code: "delivered", name: "Entregado", color: "#2E9E5B", is_final: true, outcome: "delivered", orden: 4 },
      { code: "novelty", name: "Novedad", color: "#E59A1A", is_novelty: true, outcome: "failed_attempt", orden: 5 },
      { code: "return_in_transit", name: "En devolución", color: "#8C7CC9", is_return: true, orden: 6 },
      { code: "returned", name: "Devuelto al remitente", color: "#5B4BB8", is_final: true, is_return: true, outcome: "returned", orden: 7 },
      { code: "cancelled", name: "Cancelado", color: "#E5533D", is_final: true, outcome: "cancelled", orden: 8 },
      { code: "lost", name: "Extraviado", color: "#B8321F", is_final: true, outcome: "lost", orden: 9 },
    ], { defaultToNull: false }),
    "estados",
  );

  // ---- Ubicaciones ----
  const estadosGeo = [
    ["11", "Bogotá D.C."],
    ["05", "Antioquia"],
    ["76", "Valle del Cauca"],
    ["25", "Cundinamarca"],
  ];
  const ciudades = [
    ["11001", "Bogotá", "11"],
    ["05001", "Medellín", "05"],
    ["05266", "Envigado", "05"],
    ["05360", "Itagüí", "05"],
    ["05088", "Bello", "05"],
    ["76001", "Cali", "76"],
    ["76520", "Palmira", "76"],
    ["25754", "Soacha", "25"],
    ["25175", "Chía", "25"],
  ];
  await q(db.from("wg_locations").insert({ id: IDS.colombia, level: "country", code: "CO", name: "Colombia" }), "país");
  await q(
    db.from("wg_locations").insert(estadosGeo.map(([c, n]) => ({ id: uuidDet(`loc:state:${c}`), level: "state", code: c, name: n, parent_id: IDS.colombia }))),
    "departamentos",
  );
  await q(
    db.from("wg_locations").insert(ciudades.map(([c, n, s]) => ({ id: uuidDet(`loc:city:${c}`), level: "city", code: c, name: n, parent_id: uuidDet(`loc:state:${s}`) }))),
    "ciudades",
  );

  // ---- Clientes y llaves ----
  const clientes = [
    { id: IDS.clientePrincipal, nombre: "Tienda Moda Andina", telefono_contacto: "+576015550101", direccion: "Cra 68 # 5-30 Sur, Bogotá" },
    { id: uuidDet("cliente:calzado-pacifico"), nombre: "Calzado Pacífico", telefono_contacto: "+576025550102", direccion: "Cl 13 # 100-20, Cali" },
    { id: uuidDet("cliente:tecnobarrio"), nombre: "TecnoBarrio", telefono_contacto: "+576015550103", direccion: "Av 1 de Mayo # 40-12 Sur, Bogotá" },
    { id: uuidDet("cliente:hogar-cocina"), nombre: "Hogar & Cocina Express", telefono_contacto: "+576045550104", direccion: "Cra 70 # 30-15, Medellín" },
    { id: IDS.clienteQa, nombre: "QA Contrato (pruebas)", telefono_contacto: "+576015550199", direccion: "Cl 100 # 10-10, Bogotá" },
  ];
  await q(db.from("wg_clients").insert(clientes), "clientes");
  const llavePrincipal = env("EMU_WAYGO_API_KEY");
  const llaves = [
    { client_id: IDS.clientePrincipal, key_hash: sha256(llavePrincipal), key_prefix: llavePrincipal.slice(0, 10), nombre: "Integración TDX (demo)" },
    { client_id: IDS.clienteQa, key_hash: sha256(llaveQa(env("DEMO_ADMIN_TOKEN"))), key_prefix: "tms_c_qa_", nombre: "Pruebas de contrato" },
    // Las demás tiendas tienen llave propia aleatoria (no se usa en el demo; sirve para aislar datos)
    ...clientes.slice(1, 4).map((c) => {
      const k = `tms_c_${randomBytes(16).toString("hex")}`;
      return { client_id: c.id, key_hash: sha256(k), key_prefix: k.slice(0, 10), nombre: "Llave interna" };
    }),
  ];
  await q(db.from("wg_api_keys").insert(llaves), "llaves");
  await q(db.from("wg_webhook_subscriptions").insert({ client_id: IDS.clientePrincipal, url: null, secret: null }), "suscripción");

  // ---- Bodegas ----
  await q(
    db.from("wg_warehouses").insert([
      { id: IDS.bodegaBogotaSur, code: "BOG-SUR", name: "Bodega Bogotá Sur (Kennedy)", city_id: IDS.bogota },
      { id: uuidDet("wh:BOG-NTE"), code: "BOG-NTE", name: "Bodega Bogotá Norte (Toberín)", city_id: IDS.bogota },
      { id: uuidDet("wh:MED-01"), code: "MED-01", name: "Bodega Medellín Belén", city_id: IDS.medellin },
      { id: uuidDet("wh:CLO-01"), code: "CLO-01", name: "Bodega Cali Sur", city_id: IDS.cali },
      { id: IDS.sucursalModaAndina, code: "SUC-TMA", name: "Sucursal Tienda Moda Andina · Kennedy", client_id: IDS.clientePrincipal, city_id: IDS.bogota },
      { id: uuidDet("wh:SUC-TBA"), code: "SUC-TBA", name: "Sucursal TecnoBarrio · Américas", client_id: uuidDet("cliente:tecnobarrio"), city_id: IDS.bogota },
      { id: uuidDet("wh:BOG-OLD"), code: "BOG-OLD", name: "Bodega Puente Aranda (cerrada)", city_id: IDS.bogota, activa: false },
    ], { defaultToNull: false }),
    "bodegas",
  );

  // ---- Catálogos simples ----
  const cat = (tipo: string, code: string, name: string, orden: number, data: Record<string, unknown> = {}, activo = true) => ({
    tipo,
    id: uuidDet(`${tipo === "payment_method" ? "pm" : tipo}:${code}`),
    code,
    name,
    orden,
    data,
    activo,
  });
  await q(
    db.from("wg_catalogs").insert([
      cat("shipment_type", "SAME_DAY", "Same Day", 1, { franja: "antes del corte" }),
      cat("shipment_type", "NEXT_DAY", "Next Day", 2, { franja: "después del corte" }),
      cat("payment_method", "efectivo", "Efectivo (contraentrega)", 1),
      cat("payment_method", "nequi", "Nequi", 2),
      cat("payment_method", "daviplata", "Daviplata", 3),
      cat("payment_method", "datafono", "Datáfono", 4),
      cat("payment_method", "transferencia", "Transferencia / PSE", 5),
      cat("payment_method", "cheque", "Cheque (inactivo)", 9, {}, false),
      cat("cancel_reason", "CLIENTE_CANCELA", "El comprador canceló el pedido", 1, { require_comment: false }),
      cat("cancel_reason", "DUPLICADO", "Pedido duplicado", 2, { require_comment: false }),
      cat("cancel_reason", "DIRECCION_ERRADA", "Dirección errada: se creará de nuevo", 3, { require_comment: false }),
      cat("cancel_reason", "SIN_STOCK", "Sin inventario", 4, { require_comment: false }),
      cat("cancel_reason", "OTRO", "Otro motivo", 5, { require_comment: true }),
      cat("cancel_reason", "OPERACION", "Cancelación por la operación", 6, { require_comment: true, client_allowed: false }),
    ]),
    "catálogos",
  );

  await q(
    db.from("wg_novelty_types").insert(
      [
        ["AUSENTE", "Destinatario ausente (no estaba)"],
        ["SIN_DINERO", "Sin dinero para el pago contraentrega"],
        ["RECHAZA", "Rechaza el pedido"],
        ["DIRECCION", "Dirección errada o incompleta"],
        ["NO_CONTESTA", "Teléfono no contesta"],
        ["REPROGRAMA", "El comprador pidió otra fecha"],
        ["CERRADO", "Local o conjunto cerrado"],
        ["ZONA_RIESGO", "Zona de difícil acceso"],
      ].map(([code, name], i) => ({ id: uuidDet(`nov:${code}`), code, name, orden: i + 1 })),
    ),
    "novedades",
  );

  await q(
    db.from("wg_couriers").insert([
      { id: uuidDet("cour:carlos"), nombre: "Carlos Martínez", telefono: "+573105550201", placa: "BS-14 · XKL-482" },
      { id: uuidDet("cour:yamid"), nombre: "Yamid Rojas", telefono: "+573125550202", placa: "BS-09 · MJR-17F" },
      { id: uuidDet("cour:luz"), nombre: "Luz Ángela Pérez", telefono: "+573155550203", placa: "BS-21 · QTB-90E" },
    ]),
    "mensajeros",
  );

  const esquemaRecaudo = {
    type: "object",
    properties: {
      monto_recibido: { type: "number", title: "Monto recibido" },
      medio: { type: "string", enum: ["efectivo", "nequi", "daviplata"], title: "Medio de pago" },
      foto_recibo: { type: "string", format: "file", title: "Foto del recibo" },
    },
    required: ["monto_recibido", "medio"],
  };
  await q(
    db.from("wg_workflows").insert([
      {
        id: IDS.workflowRecaudo,
        nombre: "Verificación de recaudo COD",
        evento: "office.assigned",
        forms: [{ node_id: "n1", form_name: "recaudo_cod", title_text: "Confirma el recaudo", version: 3, schema: esquemaRecaudo }],
      },
      { id: uuidDet("wf:frio"), nombre: "Control de cadena de frío", evento: "shipment.before_transition", forms: [] },
    ], { defaultToNull: false }),
    "workflows",
  );

  // ---- Envíos del mockup (cliente principal; cada uno con la marca de su tienda en sender_name) ----
  const principal: Cliente = {
    id: IDS.clientePrincipal,
    nombre: "Tienda Moda Andina",
    telefono_contacto: "+576015550101",
    direccion: null,
    service_cutoff: "13:00",
    tarifa_base: 8900,
    tarifa_kg: 1200,
    cod_fee_pct: 0.02,
    tiene_lista_precios: true,
  };
  const tipos = { SAME_DAY: uuidDet("shipment_type:SAME_DAY"), NEXT_DAY: uuidDet("shipment_type:NEXT_DAY") };
  const envios: Record<string, unknown>[] = [];
  const eventos: Record<string, unknown>[] = [];
  const agregar = (clienteId: string, guia: string, tienda: string, comprador: string, zi: number, monto: number, cuando: string, i: number) => {
    const creado = fechaBogota(cuando);
    const minutos = ((creado.getUTCHours() + 19) % 24) * 60 + creado.getUTCMinutes(); // hora Bogotá
    const code = minutos < 13 * 60 ? "SAME_DAY" : "NEXT_DAY";
    const peso = Math.round((0.4 + ((i * 37) % 30) / 10) * 10) / 10;
    const p = precio(principal, { payment_type: "cod", cod_amount: monto, weight: peso }, { id: tipos[code], code, name: code === "SAME_DAY" ? "Same Day" : "Next Day" });
    const id = uuidDet(`ship:${guia}`);
    const zona = ZONAS_BOGOTA_SUR[zi % ZONAS_BOGOTA_SUR.length];
    envios.push({
      id,
      client_id: clienteId,
      tracking_number: guia,
      order_number: `${PREFIJO_TIENDA[tienda] || "PED"}-${guia.slice(-5)}`,
      warehouse_id: IDS.bodegaBogotaSur,
      is_pickup: false,
      recipient_name: comprador,
      recipient_phone: telefono(i, guia),
      recipient_address: direccion(zi, zona),
      recipient_address_line2: i % 4 === 0 ? `Torre ${1 + (i % 3)} Apto ${200 + i}` : null,
      recipient_reference: i % 5 === 0 ? "Frente al parque del barrio" : null,
      recipient_city_id: IDS.bogota,
      payment_type: "cod",
      payment_method_id: IDS.efectivo,
      cod_amount: monto,
      declared_value: monto,
      weight: peso,
      pieces_count: 1,
      notes: i % 6 === 0 ? "Llamar antes de llegar" : null,
      sender_name: tienda,
      sender_phone: "+576015550101",
      shipment_type_id: tipos[code],
      shipment_type_code: code,
      shipment_type_name: code === "SAME_DAY" ? "Same Day" : "Next Day",
      shipping_price: p.total_price,
      chargeable_weight_kg: p.chargeable_weight_kg,
      current_state: "in_warehouse",
      created_at: creado.toISOString(),
      updated_at: new Date(creado.getTime() + 60000).toISOString(),
    });
    eventos.push(
      { shipment_id: id, from_state: "", state: "created", state_name: "Creado", occurred_at: creado.toISOString() },
      { shipment_id: id, from_state: "created", state: "in_warehouse", state_name: "En bodega", occurred_at: new Date(creado.getTime() + 60000).toISOString() },
    );
  };
  ENVIOS_MOCKUP.forEach(([g, t, c, zi, m, cuando], i) => agregar(IDS.clientePrincipal, g, t, c, zi, m, cuando, i));
  // Envíos de otras tiendas (otros clientes): no los ve la llave del demo (sirven para probar aislamiento)
  const otros: [string, string, string, string, number, number][] = [
    [uuidDet("cliente:calzado-pacifico"), "RF2610-47001", "Calzado Pacífico", "María Fernanda Ruiz", 5, 145000],
    [uuidDet("cliente:calzado-pacifico"), "RF2610-47002", "Calzado Pacífico", "Jorge Iván Salazar", 6, 98000],
    [uuidDet("cliente:tecnobarrio"), "RF2610-47003", "TecnoBarrio", "Paula Andrea Gil", 7, 879000],
    [uuidDet("cliente:tecnobarrio"), "RF2610-47004", "TecnoBarrio", "Hernán Zapata", 8, 329000],
    [uuidDet("cliente:hogar-cocina"), "RF2610-47005", "Hogar & Cocina Express", "Gloria Patiño", 9, 159000],
    [uuidDet("cliente:hogar-cocina"), "RF2610-47006", "Hogar & Cocina Express", "Ricardo Mejía", 10, 239000],
  ];
  otros.forEach(([cid, g, t, c, zi, m], i) => agregar(cid, g, t, c, zi, m, `D-1 1${i}:00`, 20 + i));
  // Las tiendas con cliente propio usan su prefijo de pedido "-X" para no chocar con los del mockup
  envios.slice(ENVIOS_MOCKUP.length).forEach((e) => (e.order_number = `${e.order_number}-X`));

  await q(db.from("wg_shipments").insert(envios), "envíos");
  await q(db.from("wg_shipment_events").insert(eventos), "eventos");

  // ---- Un formulario de ejemplo ya respondido (para GET /v1/forms/runs/{id}) ----
  const envioCodAlto = uuidDet("ship:RF2610-48240");
  const asignacion = uuidDet("asg:recaudo-48240");
  await q(
    db.from("wg_forms_assignments").insert({
      id: asignacion,
      client_id: IDS.clientePrincipal,
      workflow_id: IDS.workflowRecaudo,
      courier_id: uuidDet("cour:carlos"),
      shipment_id: envioCodAlto,
      note: "Verificar recaudo de COD alto",
      status: "completed",
      external_ref: "seed-recaudo-48240",
      created_by: "semilla",
      run_id: IDS.runEjemplo,
    }),
    "asignación",
  );
  await q(
    db.from("wg_forms_runs").insert({
      id: IDS.runEjemplo,
      assignment_id: asignacion,
      client_id: IDS.clientePrincipal,
      workflow_id: IDS.workflowRecaudo,
      shipment_id: envioCodAlto,
      event: "office.assigned",
      status: "completed",
      outcome: "flagged",
      flags: ["recaudo:diferencia"],
      forms: [{ node_id: "n1", form_name: "recaudo_cod", title_text: "Confirma el recaudo", version: 3, schema: esquemaRecaudo, answers: { monto_recibido: 1200000, medio: "efectivo" } }],
      file_urls: {},
      incidents: [{ number: "INC-000042", title: "Diferencia en el recaudo", severity: "warning", status: "open" }],
      latitude: 4.6097,
      longitude: -74.1469,
    }),
    "formulario",
  );

  invalidarCaches();
  return { clientes: clientes.length, envios: envios.length, estados: 9, ciudades: ciudades.length };
}
