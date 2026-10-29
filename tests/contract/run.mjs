// Pruebas de contrato del emulador de Waygo contra spec/waygo-partner-openapi.yaml.
//   npm run test:contract                          → usa http://localhost:3000 o levanta `next dev` en :3123
//   CONTRACT_BASE_URL=https://<app>.vercel.app npm run test:contract
// Cada respuesta se valida contra el esquema del OpenAPI para su código (o `default`), con ajv (draft 2020-12).
// Usa el cliente "QA Contrato" (llave derivada de DEMO_ADMIN_TOKEN, sin webhooks) para no ensuciar el demo.
// Requiere el emulador sembrado (npm run emu:seed).
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { cargarEnv, requerir } from "../../scripts/_env.mjs";

const env = cargarEnv();
requerir(env, "DEMO_ADMIN_TOKEN", "EMU_WAYGO_API_KEY");
const spec = parse(readFileSync("spec/waygo-partner-openapi.yaml", "utf8"));

// ---------- ajv con los componentes del spec ----------
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addFormat("double", true);
ajv.addFormat("int64", true);
const SPEC_ID = "https://waygo-emu.local/spec";
ajv.addSchema({ $id: SPEC_ID, components: spec.components });
const compilados = new Map();
function validadorDe(schema) {
  const clave = JSON.stringify(schema);
  if (!compilados.has(clave)) {
    if (schema.$ref) compilados.set(clave, ajv.getSchema(SPEC_ID + schema.$ref));
    else compilados.set(clave, ajv.compile({ $id: `inline-${compilados.size}`, ...schema }));
  }
  return compilados.get(clave);
}

// ---------- utilidades ----------
const uuidDet = (nombre) => {
  const h = createHash("sha256").update(`reflo-demo:${nombre}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const LLAVE_QA = `tms_c_qa_${createHmac("sha256", env.DEMO_ADMIN_TOKEN).update("qa-contrato").digest("hex").slice(0, 32)}`;
const LLAVE_PRINCIPAL = env.EMU_WAYGO_API_KEY;

let ORIGEN = (process.env.CONTRACT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
let BASE = `${ORIGEN}/api/waygo-emu/partner`;
let servidor = null;

async function disponible(origen) {
  try {
    const r = await fetch(`${origen}/api/waygo-emu/partner/v1/catalogs/statuses`, { signal: AbortSignal.timeout(20000) });
    return r.status === 401 || r.status === 200;
  } catch {
    return false;
  }
}

async function asegurarServidor() {
  if (await disponible(ORIGEN)) return;
  if (process.env.CONTRACT_BASE_URL) throw new Error(`No responde ${ORIGEN}`);
  ORIGEN = "http://localhost:3123";
  BASE = `${ORIGEN}/api/waygo-emu/partner`;
  console.log("Levantando next dev en :3123 …");
  servidor = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "-p", "3123"], { stdio: "ignore", shell: process.platform === "win32" });
  for (let i = 0; i < 90; i++) {
    if (await disponible(ORIGEN)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("next dev no arrancó");
}

// ---------- operaciones del spec y cobertura ----------
const operaciones = [];
for (const [plantilla, metodos] of Object.entries(spec.paths)) {
  for (const [metodo, op] of Object.entries(metodos)) {
    const re = new RegExp("^" + plantilla.replace(/\{[^}]+\}/g, "[^/]+") + "$");
    operaciones.push({ plantilla, metodo: metodo.toUpperCase(), op, re, cubierta: false, exitos: 0 });
  }
}

let pasaron = 0;
const fallos = [];

/**
 * Llama al emulador y valida: código esperado, content-type y cuerpo contra el esquema del spec.
 * Devuelve { status, body, headers }.
 */
async function llamar(nombre, metodo, ruta, { body, headers = {}, llave = LLAVE_QA, esperado, crudo } = {}) {
  const sinQuery = ruta.split("?")[0];
  const op = operaciones.find((o) => o.metodo === metodo && o.re.test(sinQuery));
  const h = { ...(llave ? { Authorization: `Bearer ${llave}` } : {}), ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + ruta, { method: metodo, headers: h, body: crudo ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  let cuerpo = null;
  const problemas = [];
  if (esperado !== undefined && res.status !== esperado) problemas.push(`status ${res.status} ≠ ${esperado}`);
  if (op) {
    op.cubierta = true;
    if (res.status < 300) op.exitos += 1;
    // Nota: el spec solo documenta "200" en POST /v1/forms/assignments, pero su descripción dice 201 al crear;
    // el 201 se valida con el esquema del 200.
    const r = op.op.responses[String(res.status)] || (res.status === 201 ? op.op.responses["200"] : null) || op.op.responses.default;
    if (!r) problemas.push(`status ${res.status} no documentado`);
    else if (r.content) {
      const [tipo, media] = Object.entries(r.content)[0];
      if (!ct.startsWith(tipo)) problemas.push(`content-type "${ct}" ≠ "${tipo}"`);
      if (tipo === "application/pdf") {
        if (buf.subarray(0, 5).toString() !== "%PDF-") problemas.push("no es un PDF");
      } else {
        try {
          cuerpo = JSON.parse(buf.toString("utf8"));
        } catch {
          problemas.push("cuerpo no es JSON");
        }
        if (cuerpo !== null && media.schema) {
          const v = validadorDe(media.schema);
          if (!v(cuerpo)) problemas.push(`esquema: ${ajv.errorsText(v.errors, { separator: "; " })}`);
        }
      }
    }
  } else {
    try {
      cuerpo = JSON.parse(buf.toString("utf8"));
    } catch {
      /* no JSON */
    }
  }
  if (problemas.length) {
    fallos.push(`✗ ${nombre} [${metodo} ${ruta}]: ${problemas.join(" | ")}${cuerpo ? `\n    ${JSON.stringify(cuerpo).slice(0, 400)}` : ""}`);
    console.log(`  ✗ ${nombre}`);
  } else {
    pasaron += 1;
    console.log(`  ✓ ${nombre}`);
  }
  return { status: res.status, body: cuerpo, headers: res.headers, bytes: buf };
}

function afirmar(nombre, condicion, detalle = "") {
  if (condicion) {
    pasaron += 1;
    console.log(`  ✓ ${nombre}`);
  } else {
    fallos.push(`✗ ${nombre} ${detalle}`);
    console.log(`  ✗ ${nombre}`);
  }
}

async function admin(accion, cuerpo) {
  const r = await fetch(`${ORIGEN}/api/waygo-emu/admin/${accion}`, {
    method: "POST",
    headers: { "x-admin-token": env.DEMO_ADMIN_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo || {}),
  });
  return r.json();
}

// ---------- pruebas ----------
async function main() {
  await asegurarServidor();
  console.log(`Emulador: ${BASE}`);
  const pre = await fetch(`${BASE}/v1/catalogs/statuses`, { headers: { Authorization: `Bearer ${LLAVE_QA}` } });
  if (pre.status === 401) throw new Error("La llave QA no existe: siembra el emulador primero (npm run emu:seed)");

  const ids = {
    bogota: uuidDet("loc:city:11001"),
    colombia: uuidDet("loc:CO"),
    cundinamarca: uuidDet("loc:state:25"),
    bodega: uuidDet("wh:BOG-SUR"),
    bodegaCerrada: uuidDet("wh:BOG-OLD"),
    sucursalAjena: uuidDet("wh:SUC-TMA"),
    efectivo: uuidDet("pm:efectivo"),
    chequeInactivo: uuidDet("pm:cheque"),
    motivoCliente: uuidDet("cancel_reason:CLIENTE_CANCELA"),
    motivoOtro: uuidDet("cancel_reason:OTRO"),
    motivoOperacion: uuidDet("cancel_reason:OPERACION"),
    envioAjeno: uuidDet("ship:RF2610-48213"),
    runAjeno: uuidDet("run:recaudo-48240"),
    workflow: uuidDet("wf:recaudo"),
    workflowFrio: uuidDet("wf:frio"),
    courier: uuidDet("cour:carlos"),
  };

  console.log("\nAutenticación y rutas");
  await llamar("sin Authorization → 401", "GET", "/v1/shipments", { llave: null, esperado: 401 });
  await llamar("llave inválida → 401", "GET", "/v1/shipments", { llave: "tms_c_no_existe", esperado: 401 });
  await llamar("llave sin prefijo tms_c_ → 401", "GET", "/v1/catalogs/statuses", { llave: "abc", esperado: 401 });
  const r404 = await fetch(`${BASE}/v1/no-existe`, { headers: { Authorization: `Bearer ${LLAVE_QA}` } });
  afirmar("ruta desconocida → 404 problem+json", r404.status === 404 && (r404.headers.get("content-type") || "").startsWith("application/problem+json"));
  const r405 = await fetch(`${BASE}/v1/quotes`, { headers: { Authorization: `Bearer ${LLAVE_QA}` } });
  afirmar("método no permitido → 405", r405.status === 405);
  const sinPartner = await fetch(`${ORIGEN}/api/waygo-emu/v1/shipments`, { headers: { Authorization: `Bearer ${LLAVE_QA}` } });
  afirmar("sin /partner → 404", sinPartner.status === 404);

  console.log("\nCatálogos");
  const est = await llamar("statuses", "GET", "/v1/catalogs/statuses", { esperado: 200 });
  afirmar("statuses: exactamente un is_initial", est.body?.data?.filter((s) => s.is_initial).length === 1);
  afirmar("statuses: hay novedad con outcome failed_attempt", est.body?.data?.some((s) => s.is_novelty && s.outcome === "failed_attempt"));
  await llamar("cancel-reasons", "GET", "/v1/catalogs/cancel-reasons", { esperado: 200 });
  await llamar("novelty-types", "GET", "/v1/catalogs/novelty-types", { esperado: 200 });
  await llamar("payment-methods", "GET", "/v1/catalogs/payment-methods", { esperado: 200 });
  await llamar("shipment-types", "GET", "/v1/catalogs/shipment-types", { esperado: 200 });
  const wh = await llamar("warehouses (QA)", "GET", "/v1/catalogs/warehouses", { esperado: 200 });
  afirmar("warehouses: no muestra sucursales de otros clientes", !wh.body?.data?.some((w) => w.client_id));
  const whp = await llamar("warehouses (cliente principal)", "GET", "/v1/catalogs/warehouses", { llave: LLAVE_PRINCIPAL, esperado: 200 });
  afirmar("warehouses: el principal ve su sucursal", whp.body?.data?.some((w) => w.id === ids.sucursalAjena && w.client_id));
  await llamar("locations level=country", "GET", "/v1/catalogs/locations?level=country", { esperado: 200 });
  await llamar("locations states de Colombia", "GET", `/v1/catalogs/locations?level=state&parent_id=${ids.colombia}`, { esperado: 200 });
  const loc = await llamar("locations city search + paginación", "GET", "/v1/catalogs/locations?level=city&search=Bogot&page=1&page_size=1", { esperado: 200 });
  afirmar("locations: meta y resultado", loc.body?.meta?.page_size === 1 && loc.body?.data?.[0]?.id === ids.bogota);
  await llamar("locations page_size>200 → 422", "GET", "/v1/catalogs/locations?page_size=500", { esperado: 422 });
  await llamar("locations level inválido → 422", "GET", "/v1/catalogs/locations?level=planeta", { esperado: 422 });
  await llamar("locations parent_id no uuid → 422", "GET", "/v1/catalogs/locations?parent_id=abc", { esperado: 422 });

  console.log("\nCotizar");
  await llamar("quote prepaid", "POST", "/v1/quotes", { body: { payment_type: "prepaid", weight: 2.5 }, esperado: 200 });
  const q = await llamar("quote cod con medidas", "POST", "/v1/quotes", { body: { payment_type: "cod", cod_amount: 150000, weight: 1, length_cm: 40, width_cm: 30, height_cm: 20, recipient_city_id: ids.bogota }, esperado: 200 });
  afirmar("quote: peso cobrable = volumétrico (4.8)", q.body?.chargeable_weight_kg === 4.8);
  await llamar("quote cod sin cod_amount → 422", "POST", "/v1/quotes", { body: { payment_type: "cod" }, esperado: 422 });
  await llamar("quote prepaid con cod_amount → 422", "POST", "/v1/quotes", { body: { payment_type: "prepaid", cod_amount: 1000 }, esperado: 422 });
  await llamar("quote declared_value ≠ cod_amount → 422", "POST", "/v1/quotes", { body: { payment_type: "cod", cod_amount: 1000, declared_value: 2000 }, esperado: 422 });
  await llamar("quote propiedad desconocida → 422", "POST", "/v1/quotes", { body: { payment_type: "prepaid", foo: 1 }, esperado: 422 });
  await llamar("quote ciudad que no es ciudad → 422", "POST", "/v1/quotes", { body: { payment_type: "prepaid", recipient_city_id: ids.cundinamarca }, esperado: 422 });
  await llamar("quote sin auth → 401", "POST", "/v1/quotes", { llave: null, body: { payment_type: "prepaid" }, esperado: 401 });
  await llamar("quote JSON inválido → 422", "POST", "/v1/quotes", { crudo: "{no json", headers: { "Content-Type": "application/json" }, esperado: 422 });
  await llamar("crear sin body → 422", "POST", "/v1/shipments", { crudo: "", esperado: 422 });

  console.log("\nCrear envío");
  const sello = Date.now().toString(36).toUpperCase();
  const base = {
    warehouse_id: ids.bodega,
    is_pickup: false,
    recipient_name: "Comprador Contrato",
    recipient_phone: "+573001112233",
    recipient_address: "Cl 1 Sur # 2-3, Timiza, Bogotá",
    recipient_address_line2: "Apto 101",
    recipient_reference: "Frente al parque",
    recipient_city_id: ids.bogota,
    payment_type: "cod",
    payment_method_id: ids.efectivo,
    cod_amount: 99900,
    weight: 1.2,
    notes: "Llamar antes de llegar",
    sender_name: "Tienda QA",
  };
  const llave = randomUUID();
  const c1 = await llamar("crear con Idempotency-Key → 200", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-1` }, headers: { "Idempotency-Key": llave }, esperado: 200 });
  afirmar("crear: is_pickup=false queda en bodega (no inicial)", c1.body?.current_state && est.body.data.find((s) => s.code === c1.body.current_state)?.is_initial === false);
  afirmar("crear: trae label_url, tracking_url, shipping_price y tipo de servicio", !!(c1.body?.label_url && c1.body?.tracking_url && c1.body?.shipping_price && c1.body?.shipment_type_code));
  const c2 = await llamar("reintento misma llave y cuerpo → 200 replay", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-1` }, headers: { "Idempotency-Key": llave }, esperado: 200 });
  afirmar("replay: Idempotent-Replayed: true y mismo id", c2.headers.get("idempotent-replayed") === "true" && c2.body?.id === c1.body?.id);
  await llamar("misma llave, otro cuerpo → 422", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-1`, weight: 9 }, headers: { "Idempotency-Key": llave }, esperado: 422 });
  // En curso: dos peticiones simultáneas con la misma llave nueva → una crea y la otra recibe 409 o el replay
  const llave2 = randomUUID();
  const [p1, p2] = await Promise.all([1, 2].map(() => llamar("concurrencia misma llave", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-C` }, headers: { "Idempotency-Key": llave2 } })));
  const codigos = [p1.status, p2.status].sort().join(",");
  afirmar(`concurrencia: una crea, la otra 409 en curso o replay (${codigos})`, codigos === "200,409" || codigos === "200,200");
  // Una petición fallida no gasta la llave
  const llave3 = randomUUID();
  await llamar("falla con llave (422) …", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-3`, recipient_city_id: ids.cundinamarca }, headers: { "Idempotency-Key": llave3 }, esperado: 422 });
  await llamar("… y la misma llave sirve al corregir → 200", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-3` }, headers: { "Idempotency-Key": llave3 }, esperado: 200 });

  const dup = await llamar("order_number repetido (propio) → 409 con ids", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-1` }, esperado: 409 });
  afirmar("409 trae errors[0].value.shipment_id y tracking_number", dup.body?.errors?.[0]?.value?.shipment_id === c1.body?.id && !!dup.body?.errors?.[0]?.value?.tracking_number);
  const dupAjeno = await llamar("order_number de otro cliente → 409 sin ids", "POST", "/v1/shipments", { body: { ...base, order_number: "TMA-48213" }, esperado: 409 });
  afirmar("409 ajeno no trae shipment_id", !dupAjeno.body?.errors?.[0]?.value?.shipment_id);
  const sinWh = { ...base };
  delete sinWh.warehouse_id;
  await llamar("sin warehouse_id → 422", "POST", "/v1/shipments", { body: sinWh, esperado: 422 });
  const sinPickup = { ...base };
  delete sinPickup.is_pickup;
  await llamar("sin is_pickup → 422", "POST", "/v1/shipments", { body: sinPickup, esperado: 422 });
  await llamar("bodega inexistente → 422", "POST", "/v1/shipments", { body: { ...base, warehouse_id: randomUUID() }, esperado: 422 });
  await llamar("bodega inactiva → 422", "POST", "/v1/shipments", { body: { ...base, warehouse_id: ids.bodegaCerrada }, esperado: 422 });
  await llamar("sucursal de otro cliente → 422", "POST", "/v1/shipments", { body: { ...base, warehouse_id: ids.sucursalAjena }, esperado: 422 });
  await llamar("ciudad que es departamento → 422", "POST", "/v1/shipments", { body: { ...base, recipient_city_id: ids.cundinamarca }, esperado: 422 });
  await llamar("método de pago inactivo → 422", "POST", "/v1/shipments", { body: { ...base, payment_method_id: ids.chequeInactivo }, esperado: 422 });
  await llamar("cod sin cod_amount → 422", "POST", "/v1/shipments", { body: { ...base, cod_amount: undefined }, esperado: 422 });
  await llamar("prepaid con cod_amount → 422", "POST", "/v1/shipments", { body: { ...base, payment_type: "prepaid" }, esperado: 422 });
  await llamar("recipient_name vacío → 422", "POST", "/v1/shipments", { body: { ...base, recipient_name: "" }, esperado: 422 });
  await llamar("payment_type inválido → 422", "POST", "/v1/shipments", { body: { ...base, payment_type: "credito" }, esperado: 422 });
  await llamar("crear sin auth → 401", "POST", "/v1/shipments", { llave: null, body: base, esperado: 401 });
  const pickup = await llamar("crear con is_pickup=true (queda en estado inicial)", "POST", "/v1/shipments", { body: { ...base, is_pickup: true, order_number: `QA-${sello}-P`, payment_type: "prepaid", cod_amount: undefined, payment_method_id: undefined }, esperado: 200 });
  afirmar("is_pickup=true: estado inicial", est.body.data.find((s) => s.code === pickup.body?.current_state)?.is_initial === true);
  const sinOrden = await llamar("crear sin order_number (se genera ORD-…)", "POST", "/v1/shipments", { body: { ...base }, esperado: 200 });
  afirmar("order_number generado ORD-…", /^ORD-/.test(sinOrden.body?.order_number || ""));

  console.log("\nConsultar envíos");
  const lista = await llamar("listar (paginación)", "GET", "/v1/shipments?page=1&page_size=2", { esperado: 200 });
  afirmar("listar: meta coherente", lista.body?.meta?.page_size === 2 && lista.body?.data?.length <= 2 && lista.body?.meta?.total >= 4);
  const filtro = await llamar("listar filtro current_state", "GET", `/v1/shipments?current_state=${pickup.body?.current_state}`, { esperado: 200 });
  afirmar("filtro: todos en ese estado", filtro.body?.data?.every((s) => s.current_state === pickup.body?.current_state));
  const busq = await llamar("listar search por guía", "GET", `/v1/shipments?search=${c1.body?.tracking_number}`, { esperado: 200 });
  afirmar("search: encuentra la guía", busq.body?.data?.[0]?.id === c1.body?.id);
  await llamar("listar page_size>100 → 422", "GET", "/v1/shipments?page_size=101", { esperado: 422 });
  await llamar("listar page=0 → 422", "GET", "/v1/shipments?page=0", { esperado: 422 });
  const listaPrincipal = await llamar("listar (cliente principal)", "GET", "/v1/shipments?page_size=100", { llave: LLAVE_PRINCIPAL, esperado: 200 });
  afirmar("aislamiento: QA no ve envíos del principal", !lista.body?.data?.some((s) => listaPrincipal.body?.data?.some((p) => p.id === s.id)));
  await llamar("detalle por id", "GET", `/v1/shipments/${c1.body?.id}`, { esperado: 200 });
  await llamar("detalle por tracking", "GET", `/v1/shipments/tracking/${c1.body?.tracking_number}`, { esperado: 200 });
  await llamar("detalle inexistente → 404", "GET", `/v1/shipments/${randomUUID()}`, { esperado: 404 });
  await llamar("detalle id no uuid → 422", "GET", "/v1/shipments/no-es-uuid", { esperado: 422 });
  await llamar("detalle de otro cliente → 404 (nunca 403)", "GET", `/v1/shipments/${ids.envioAjeno}`, { esperado: 404 });
  await llamar("tracking de otro cliente → 404", "GET", "/v1/shipments/tracking/RF2610-48213", { esperado: 404 });
  await llamar("tracking sin auth → 401", "GET", "/v1/shipments/tracking/RF2610-48213", { llave: null, esperado: 401 });
  const evs = await llamar("eventos", "GET", `/v1/shipments/${c1.body?.id}/events`, { esperado: 200 });
  afirmar("eventos: del más antiguo al más reciente, primero con from_state vacío", evs.body?.data?.length === 2 && !evs.body.data[0].from_state && evs.body.data[1].state === c1.body?.current_state);
  await llamar("eventos de otro cliente → 404", "GET", `/v1/shipments/${ids.envioAjeno}/events`, { esperado: 404 });
  await llamar("eventos id no uuid → 422", "GET", "/v1/shipments/x/events", { esperado: 422 });
  await llamar("guía PDF", "GET", `/v1/shipments/${c1.body?.id}/label`, { esperado: 200 });
  await llamar("guía de otro cliente → 404", "GET", `/v1/shipments/${ids.envioAjeno}/label`, { esperado: 404 });
  await llamar("guía sin auth → 401", "GET", `/v1/shipments/${c1.body?.id}/label`, { llave: null, esperado: 401 });
  const pub = await fetch(c1.body.label_url);
  afirmar("label_url pública devuelve PDF sin auth", pub.status === 200 && (pub.headers.get("content-type") || "").startsWith("application/pdf"));
  const trk = await fetch(c1.body.tracking_url);
  afirmar("tracking_url pública devuelve HTML", trk.status === 200 && (trk.headers.get("content-type") || "").startsWith("text/html"));

  console.log("\nCancelar");
  await llamar("cancelar motivo que pide comentario, sin comentario → 422", "POST", `/v1/shipments/${c1.body?.id}/cancel`, { body: { reason_id: ids.motivoOtro }, esperado: 422 });
  await llamar("cancelar motivo no permitido al cliente → 422", "POST", `/v1/shipments/${c1.body?.id}/cancel`, { body: { reason_id: ids.motivoOperacion, comment: "x" }, esperado: 422 });
  await llamar("cancelar sin reason_id → 422", "POST", `/v1/shipments/${c1.body?.id}/cancel`, { body: {}, esperado: 422 });
  await llamar("cancelar envío de otro cliente → 404", "POST", `/v1/shipments/${ids.envioAjeno}/cancel`, { body: { reason_id: ids.motivoCliente }, esperado: 404 });
  await llamar("cancelar id no uuid → 422", "POST", "/v1/shipments/x/cancel", { body: { reason_id: ids.motivoCliente }, esperado: 422 });
  const can = await llamar("cancelar en bodega → 200", "POST", `/v1/shipments/${c1.body?.id}/cancel`, { body: { reason_id: ids.motivoOtro, comment: "Prueba de contrato" }, esperado: 200 });
  afirmar("cancelado: estado final con outcome cancelled", est.body.data.find((s) => s.code === can.body?.current_state)?.outcome === "cancelled");
  await llamar("cancelar de nuevo (final) → 409", "POST", `/v1/shipments/${c1.body?.id}/cancel`, { body: { reason_id: ids.motivoCliente }, esperado: 409 });
  await llamar("order_number liberado al cancelar → 200", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-1` }, esperado: 200 });
  const ruta = await llamar("envío para sacar a ruta", "POST", "/v1/shipments", { body: { ...base, order_number: `QA-${sello}-R` }, esperado: 200 });
  const t = await admin("transicion", { shipment_id: ruta.body?.id, estado: "in_route", courier_id: ids.courier });
  afirmar("operador: pasar a ruta", t.ok === true, JSON.stringify(t));
  await llamar("cancelar en ruta → 409", "POST", `/v1/shipments/${ruta.body?.id}/cancel`, { body: { reason_id: ids.motivoCliente }, esperado: 409 });
  const nov = await admin("transicion", { shipment_id: ruta.body?.id, estado: "novelty", novelty_type_id: uuidDet("nov:AUSENTE"), descripcion: "No estaba", reschedule_date: "2026-11-06" });
  afirmar("operador: registrar novedad", nov.ok === true, JSON.stringify(nov));
  const evsNov = await llamar("eventos con novedad", "GET", `/v1/shipments/${ruta.body?.id}/events`, { esperado: 200 });
  const ultimo = evsNov.body?.data?.at(-1);
  afirmar("novedad: attempt_number y novelty.type_id/reschedule_date", ultimo?.attempt_number === 1 && ultimo?.novelty?.type_id === uuidDet("nov:AUSENTE") && ultimo?.novelty?.reschedule_date === "2026-11-06");
  const detNov = await llamar("detalle tras novedad", "GET", `/v1/shipments/${ruta.body?.id}`, { esperado: 200 });
  afirmar("delivery_attempts = 1", detNov.body?.delivery_attempts === 1);
  await llamar("cancelar con intento previo → 409", "POST", `/v1/shipments/${ruta.body?.id}/cancel`, { body: { reason_id: ids.motivoCliente }, esperado: 409 });

  console.log("\nFormularios");
  const ref = `qa-${sello}`;
  const asg = await llamar("crear asignación → 201", "POST", "/v1/forms/assignments", {
    body: { workflow_id: ids.workflow, courier_id: ids.courier, shipment_id: ruta.body?.id, external_ref: ref, note: "Verifica el recaudo", blocking: true, due_at: "2026-11-06T22:00:00Z" },
    esperado: 201,
  });
  const asg2 = await llamar("misma external_ref → 200 existente", "POST", "/v1/forms/assignments", {
    body: { workflow_id: ids.workflow, courier_id: ids.courier, shipment_id: ruta.body?.id, external_ref: ref },
    esperado: 200,
  });
  afirmar("idempotente por external_ref (mismo id)", asg.body?.id && asg.body?.id === asg2.body?.id);
  await llamar("workflow sin office.assigned → 422", "POST", "/v1/forms/assignments", { body: { workflow_id: ids.workflowFrio, courier_id: ids.courier, shipment_id: ruta.body?.id }, esperado: 422 });
  await llamar("envío de otro cliente → 422", "POST", "/v1/forms/assignments", { body: { workflow_id: ids.workflow, courier_id: ids.courier, shipment_id: ids.envioAjeno }, esperado: 422 });
  await llamar("courier inexistente → 422", "POST", "/v1/forms/assignments", { body: { workflow_id: ids.workflow, courier_id: randomUUID(), shipment_id: ruta.body?.id }, esperado: 422 });
  await llamar("faltan requeridos → 422", "POST", "/v1/forms/assignments", { body: { workflow_id: ids.workflow }, esperado: 422 });
  await llamar("asignación sin auth → 401", "POST", "/v1/forms/assignments", { llave: null, body: { workflow_id: ids.workflow, courier_id: ids.courier, shipment_id: ruta.body?.id }, esperado: 401 });
  const run = await admin("formulario", { assignment_id: asg.body?.id, outcome: "flagged" });
  afirmar("operador: el conductor llena el formulario", !!run.run_id, JSON.stringify(run));
  const rv = await llamar("ver ejecución del formulario", "GET", `/v1/forms/runs/${run.run_id}`, { esperado: 200 });
  afirmar("run: outcome flagged y forms con answers", rv.body?.outcome === "flagged" && rv.body?.forms?.[0]?.answers);
  await llamar("run de otro cliente → 404", "GET", `/v1/forms/runs/${ids.runAjeno}`, { esperado: 404 });
  await llamar("run sembrado (cliente principal) → 200", "GET", `/v1/forms/runs/${ids.runAjeno}`, { llave: LLAVE_PRINCIPAL, esperado: 200 });
  await llamar("run id no uuid → 422", "GET", "/v1/forms/runs/abc", { esperado: 422 });

  // ---------- cobertura ----------
  console.log("\nCobertura de operaciones del spec");
  for (const o of operaciones) {
    const ok = o.cubierta && o.exitos > 0;
    afirmar(`${o.metodo} ${o.plantilla}`, ok, ok ? "" : "(sin respuesta 2xx probada)");
  }
}

try {
  await main();
} catch (e) {
  fallos.push(`✗ Error fatal: ${e.message}`);
} finally {
  if (servidor) servidor.kill();
}
console.log(`\n${pasaron} pasaron, ${fallos.length} fallaron`);
if (fallos.length) {
  console.log(fallos.join("\n"));
  process.exit(1);
}
process.exit(0);
