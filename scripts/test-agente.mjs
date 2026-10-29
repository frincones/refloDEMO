// Pruebas de punta a punta del Bloque 2A (workers + agente) contra un servidor corriendo.
//   npm run test:agente                         → http://localhost:3000
//   npm run test:agente -- https://<preview>.vercel.app
//   AGENTE_RONDAS=1 npm run test:agente         → una sola ronda de escenarios (por defecto 2, por no determinismo del LLM)
//   AGENTE_SIN_RESET=1                          → no reinicia el demo (¡el reset borra la base compartida!)
// Usa DEMO_ADMIN_TOKEN y las llaves de Supabase de .env.local. No imprime secretos.
import { createClient } from "@supabase/supabase-js";
import { cargarEnv, requerir } from "./_env.mjs";

const env = cargarEnv();
requerir(env, "DEMO_ADMIN_TOKEN", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
const BASE = (process.argv[2] || env.AGENTE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const RONDAS = Number(env.AGENTE_RONDAS || 2);
const H = { "content-type": "application/json", "x-admin-token": env.DEMO_ADMIN_TOKEN };
if (env.VERCEL_BYPASS) H["x-vercel-protection-bypass"] = env.VERCEL_BYPASS;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { transport: class {} } });

const resultados = [];
function check(nombre, ok, detalle = "") {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? "  ✔" : "  ✘"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  return !!ok;
}

async function post(ruta, cuerpo, headers = H) {
  const r = await fetch(BASE + ruta, { method: "POST", headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, body: j };
}

/** POST /api/chat y parseo del SSE */
async function chat(envio_id, texto, extra = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + "/api/chat", { method: "POST", headers: H, body: JSON.stringify({ envio_id, texto, ...extra }) });
  if (!r.ok) return { status: r.status, eventos: [], texto: "", ms: Date.now() - t0, error: await r.text() };
  const ct = r.headers.get("content-type") || "";
  const crudo = await r.text();
  const eventos = [];
  let primerDelta = null;
  for (const bloque of crudo.split("\n\n")) {
    const ev = bloque.match(/^event: (.+)$/m)?.[1];
    const data = bloque.match(/^data: (.+)$/m)?.[1];
    if (!ev || !data) continue;
    eventos.push({ ev, data: JSON.parse(data) });
  }
  const texto2 = eventos.filter((e) => e.ev === "delta").map((e) => e.data.texto).join("");
  return { status: r.status, ct, eventos, texto: texto2, ms: Date.now() - t0, primerDelta };
}

async function promesa(envio_id) {
  const { data } = await db.from("promesas").select("*").eq("envio_id", envio_id).eq("vigente", true).maybeSingle();
  return data;
}
async function casos(envio_id) {
  const { data } = await db.from("casos").select("id, tipo, estado").eq("envio_id", envio_id);
  return data || [];
}
const horaBog = (iso) => (iso ? new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(11, 16) : null);
const dow = (f) => new Date(f + "T12:00:00Z").getUTCDay();

const ESCENARIOS = [
  {
    nombre: "confirma con efectivo (botón)",
    turnos: [{ texto: "Sí, estaré y tengo el efectivo", boton_id: "si_efectivo" }],
    async verificar(id, out) {
      const p = await promesa(id);
      const intencion = out[0].eventos.find((e) => e.ev === "intencion");
      return [
        ["estado CONFIRMADO", p?.estado === "CONFIRMADO", p?.estado],
        ["confianza ≥ 0,75", Number(p?.confianza) >= 0.75, p?.confianza],
        ["evento intencion con accion_ruta INCLUIR", intencion?.data?.accion_ruta === "INCLUIR", intencion?.data?.accion_ruta],
        ["menciona el monto", /\$\s?\d{1,3}(\.\d{3})+/.test(out[0].texto), out[0].texto.slice(0, 120)],
      ];
    },
  },
  {
    nombre: "solo en la tarde → franja",
    turnos: [{ texto: "solo en la tarde" }],
    async verificar(id, out) {
      const p = await promesa(id);
      const ini = horaBog(p?.franja_inicio);
      return [
        ["estado CONFIRMADO_VENTANA", p?.estado === "CONFIRMADO_VENTANA", p?.estado],
        ["franja en la tarde", ini && ini >= "12:00", `${ini}–${horaBog(p?.franja_fin)}`],
        ["ofrece botones de franja", out[0].eventos.some((e) => e.ev === "botones"), ""],
      ];
    },
  },
  {
    nombre: "no tengo efectivo, ¿Nequi? → link (+ pago)",
    turnos: [{ texto: "no tengo efectivo, ¿puedo pagar por Nequi?" }],
    async verificar(id, out) {
      const p = await promesa(id);
      const tool = out[0].eventos.find((e) => e.ev === "herramienta" && e.data.nombre === "pago_generar_link");
      const r = [
        ["llamó pago_generar_link", !!tool, ""],
        ["link pago.reflo.demo en la respuesta", /pago\.reflo\.demo\/BRB-/.test(out[0].texto), out[0].texto.slice(0, 140)],
        ["sigue CONFIRMADO + preferencia link (sin prepago aún)", p?.estado === "CONFIRMADO" && p?.preferencia_pago === "link", `${p?.estado}/${p?.preferencia_pago}`],
      ];
      const { data: env_ } = await db.from("envios").select("cod_monto").eq("id", id).single();
      r.push(["monto del link = cod_monto de la base", tool?.data?.resultado?.monto === Number(env_.cod_monto), `${tool?.data?.resultado?.monto} vs ${env_.cod_monto}`]);
      const pago = await post("/api/demo/pago", { envio_id: id });
      r.push(["POST /api/demo/pago → CONFIRMADO_PREPAGO", pago.status === 200 && pago.body?.estado === "CONFIRMADO_PREPAGO", `${pago.status} ${pago.body?.estado}`]);
      const p2 = await promesa(id);
      r.push(["nueva versión vigente con 'PAGADO, no cobrar'", p2?.estado === "CONFIRMADO_PREPAGO" && p2?.version > (p?.version || 0) && /PAGADO/.test(p2?.nota_mensajero || ""), `v${p2?.version}`]);
      const repetido = await post("/api/demo/pago", { envio_id: id });
      r.push(["pago idempotente (misma versión)", repetido.body?.version === p2?.version, `v${repetido.body?.version}`]);
      return r;
    },
  },
  {
    nombre: "mejor el sábado → reprograma",
    turnos: [{ texto: "mañana no puedo, mejor el sábado" }],
    async verificar(id) {
      const p = await promesa(id);
      const cs = await casos(id);
      const okReprog = p?.estado === "REPROGRAMADO" && p?.fecha_entrega && dow(p.fecha_entrega) === 6;
      const okCaso = cs.some((c) => c.tipo === "reprogramacion");
      return [["REPROGRAMADO para un sábado (o caso por política)", okReprog || okCaso, `${p?.estado} ${p?.fecha_entrega || ""}`]];
    },
  },
  {
    nombre: "ya no lo quiero (+ confirmación)",
    turnos: [{ texto: "ya no lo quiero" }, { texto: "sí, cancélenlo por favor, ya lo compré en otro lado" }],
    async verificar(id, out, intermedio) {
      const p = await promesa(id);
      return [
        ["1er turno NO registra RECHAZADO (pregunta una vez)", intermedio?.[0] !== "RECHAZADO", intermedio?.[0] || "sin promesa"],
        ["2º turno → RECHAZADO", p?.estado === "RECHAZADO", p?.estado],
        ["con motivo", !!p?.evidencia?.motivo, p?.evidencia?.motivo],
      ];
    },
  },
  {
    nombre: "yo no pedí nada → fraude",
    turnos: [{ texto: "yo no pedí nada, ¿quién es usted?" }],
    async verificar(id, out) {
      const p = await promesa(id);
      const cs = await casos(id);
      const { data: e } = await db.from("envios").select("cod_monto, tienda").eq("id", id).single();
      const montoTxt = "$" + Math.round(e.cod_monto).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return [
        ["estado RIESGO_FRAUDE", p?.estado === "RIESGO_FRAUDE", p?.estado],
        ["caso fraude", cs.some((c) => c.tipo === "fraude"), cs.map((c) => c.tipo).join(",")],
        ["evento caso emitido", out[0].eventos.some((x) => x.ev === "caso"), ""],
        ["no revela el monto", !out[0].texto.includes(montoTxt), out[0].texto.slice(0, 140)],
      ];
    },
  },
  {
    nombre: "audio transcrito → confirma franja",
    turnos: [{ texto: "sí señor mañana estoy en la casa después de las 3 y tengo la plata", es_audio: true }],
    async verificar(id) {
      const p = await promesa(id);
      return [
        ["CONFIRMADO_VENTANA (o CONFIRMADO)", ["CONFIRMADO_VENTANA", "CONFIRMADO"].includes(p?.estado), p?.estado],
        ["franja desde las 15:00", p?.estado !== "CONFIRMADO_VENTANA" || horaBog(p?.franja_inicio) === "15:00", horaBog(p?.franja_inicio)],
        ["evidencia tipo audio", p?.evidencia?.tipo === "audio", p?.evidencia?.tipo],
      ];
    },
  },
  {
    nombre: "cliente molesto → escala",
    turnos: [{ texto: "Qué servicio tan malo, ya es la tercera vez que me escriben y nadie me resuelve nada. Estoy muy aburrido con ustedes" }],
    async verificar(id, out) {
      const cs = await casos(id);
      return [
        ["caso cliente_molesto", cs.some((c) => c.tipo === "cliente_molesto"), cs.map((c) => c.tipo).join(",")],
        ["sin lenguaje de cobranza", !/deuda|mora|obligaci/i.test(out[0].texto), ""],
      ];
    },
  },
];

async function correrEscenario(esc, envio, ronda) {
  const out = [];
  const intermedio = [];
  for (const t of esc.turnos) {
    const { texto, ...extra } = t;
    const r = await chat(envio.id, texto, extra);
    out.push(r);
    intermedio.push((await promesa(envio.id))?.estado);
  }
  const lineas = [`\n[ronda ${ronda}] ${esc.nombre} · ${envio.tracking_number} · ${out.map((o) => `${(o.ms / 1000).toFixed(1)} s`).join(" + ")}`];
  for (const o of out) lineas.push(`    agente: ${o.texto.replace(/\s+/g, " ").slice(0, 220)}`);
  console.log(lineas.join("\n"));
  check(`[r${ronda}] ${esc.nombre}: SSE 200 text/event-stream con fin`, out.every((o) => o.status === 200 && /text\/event-stream/.test(o.ct) && o.eventos.some((e) => e.ev === "fin")), out.map((o) => o.status).join(","));
  check(`[r${ronda}] ${esc.nombre}: mensaje del agente guardado`, out.every((o) => o.eventos.find((e) => e.ev === "fin")?.data?.mensaje_id), "");
  for (const [n, ok, d] of await esc.verificar(envio.id, out, intermedio)) check(`[r${ronda}] ${esc.nombre}: ${n}`, ok, d === undefined || d === null ? "" : String(d));
  return out;
}

const inicio = Date.now();
console.log(`Pruebas del agente contra ${BASE} (${RONDAS} ronda(s))`);

// ---- Seguridad ----
const sinToken = await post("/api/demo/ola", {}, { "content-type": "application/json" });
check("sin x-admin-token → 401", sinToken.status === 401, String(sinToken.status));
const chatSinToken = await fetch(BASE + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("/api/chat sin token → 401", chatSinToken.status === 401, String(chatSinToken.status));

// ---- Reset + preparar ----
if (!env.AGENTE_SIN_RESET) {
  const rs = await post("/api/demo/reset");
  check("POST /api/demo/reset", rs.status === 200 && rs.body.sincronizados >= 18, JSON.stringify(rs.body));
}
const prep = await post("/api/demo/preparar");
check("POST /api/demo/preparar", prep.status === 200 && typeof prep.body.procesados === "number", JSON.stringify(prep.body));
const { data: puntuados } = await db.from("envios").select("id, riesgo, prioridad, grupo_control, riesgo_motivos, tracking_number");
check("todos con riesgo, prioridad y sorteo", puntuados.every((e) => e.riesgo !== null && e.prioridad !== null && e.grupo_control !== null), `${puntuados.length} envíos`);
check("grupo de control con al menos 1 envío", puntuados.filter((e) => e.grupo_control).length >= 1, String(puntuados.filter((e) => e.grupo_control).length));
check("regla COD alto aplicada", puntuados.some((e) => e.riesgo_motivos?.motivos?.includes("cod_alto")), "");
check("regla madrugada aplicada", puntuados.some((e) => e.riesgo_motivos?.motivos?.includes("pedido_de_madrugada")), "");

// ---- Interruptor de apagado ----
await post("/api/demo/pausa", { pausado: true });
const olaPausada = await post("/api/demo/ola");
check("ola con agentes en pausa → 409 agentes_pausados", olaPausada.status === 409 && olaPausada.body?.error === "agentes_pausados", String(olaPausada.status));
const { data: unEnvio } = await db.from("envios").select("id").eq("grupo_control", false).limit(1).single();
const chatPausado = await chat(unEnvio.id, "hola");
check("chat en pausa → evento error agente_en_pausa", chatPausado.eventos.some((e) => e.ev === "error" && e.data.mensaje === "agente_en_pausa"), "");
await post("/api/demo/pausa", { pausado: false });

// ---- Ola ----
const o = await post("/api/demo/ola");
check("POST /api/demo/ola", o.status === 200 && o.body.enviados > 0, JSON.stringify(o.body));
const { data: plantilla } = await db.from("mensajes").select("texto, botones").eq("rol", "agente").limit(1).single();
check("plantilla con 4 botones {id,titulo} y monto COP", plantilla?.botones?.length === 4 && plantilla.botones[0].titulo && /\$\d{1,3}(\.\d{3})+/.test(plantilla.texto), plantilla?.texto?.slice(0, 100));
const { data: contactando } = await db.from("envios").select("id, tracking_number").eq("estado_buffer", "CONTACTANDO").order("prioridad", { ascending: false });
check("envíos en CONTACTANDO", contactando.length === o.body.enviados, String(contactando.length));

// ---- Escenarios (en paralelo dentro de cada ronda) ----
const necesarios = ESCENARIOS.length * RONDAS + 2;
if (contactando.length < necesarios) console.log(`  (aviso: ${contactando.length} envíos para ${necesarios} usos; se reutilizan)`);
let k = 0;
const siguiente = () => contactando[k++ % contactando.length];
const usados = [];
for (let ronda = 1; ronda <= RONDAS; ronda++) {
  const asignados = ESCENARIOS.map((esc) => ({ esc, envio: siguiente() }));
  usados.push(...asignados);
  await Promise.all(asignados.map(({ esc, envio }) => correrEscenario(esc, envio, ronda)));
}
const sinRespuesta = siguiente(); // queda sin responder para el recordatorio y el corte
const paraTomar = siguiente();

// ---- Recordatorio ----
const rec = await post("/api/demo/recordatorio");
check("POST /api/demo/recordatorio (solo sin respuesta)", rec.status === 200 && rec.body.enviados >= 1, JSON.stringify(rec.body));
const rec2 = await post("/api/demo/recordatorio");
check("recordatorio no se repite", rec2.status === 200 && rec2.body.enviados === 0, JSON.stringify(rec2.body));

// ---- Conversación tomada por una persona ----
const c0 = await chat(paraTomar.id, "quiero hablar con una persona");
const casoPersona = (await casos(paraTomar.id))[0];
check("pide persona → caso", !!casoPersona, casoPersona?.tipo);
if (casoPersona) {
  const tomar = await post(`/api/casos/${casoPersona.id}/resolver`, { accion: "tomar" });
  check("caso tomar → estado tomado", tomar.status === 200 && tomar.body.estado === "tomado", JSON.stringify(tomar.body?.estado));
  const silencio = await chat(paraTomar.id, "¿hola?");
  check("conversación tomada → agente_en_pausa", silencio.eventos.some((e) => e.ev === "error" && e.data.mensaje === "agente_en_pausa"), "");
  const dev = await post(`/api/casos/${casoPersona.id}/resolver`, { accion: "devolver" });
  check("caso devolver → cerrado", dev.status === 200 && dev.body.estado === "cerrado", dev.body?.estado);
}
// Aprobar un cambio de dirección
const dirEnvio = siguiente();
await chat(dirEnvio.id, "Cambiar dirección", { boton_id: "cambiar_direccion" });
const d2 = await chat(dirEnvio.id, "La nueva es Calle 45 Sur # 78-20, barrio Kennedy, Bogotá, casa de rejas verdes");
const pDir = await promesa(dirEnvio.id);
const casoDir = (await casos(dirEnvio.id)).find((c) => c.tipo === "cambio_direccion");
check("cambio de dirección → DIRECCION_EN_VALIDACION + caso", pDir?.estado === "DIRECCION_EN_VALIDACION" && !!casoDir, `${pDir?.estado} · ${d2.texto.slice(0, 100)}`);
if (casoDir) {
  const ap = await post(`/api/casos/${casoDir.id}/resolver`, { accion: "aprobar", nota: "cobertura OK" });
  const pAp = await promesa(dirEnvio.id);
  check("aprobar caso de dirección → CONFIRMADO", ap.status === 200 && ap.body.estado === "aprobado" && pAp?.estado === "CONFIRMADO", pAp?.estado);
}

// ---- Corte ----
const corte = await post("/api/demo/corte");
check("POST /api/demo/corte", corte.status === 200 && corte.body.corte_id && corte.body.version >= 1, JSON.stringify(corte.body?.resumen));
const esperado = (it) => {
  if (it.estado === "CONFIRMADO_PREPAGO") return ["INCLUIR"];
  if (it.estado === "GRUPO_CONTROL") return ["INCLUIR"];
  if (["RECHAZADO", "REPROGRAMADO", "SIN_PAGO_HOY"].includes(it.estado)) return ["EXCLUIR"];
  if (["RIESGO_FRAUDE", "NUMERO_INVALIDO", "DIRECCION_EN_VALIDACION"].includes(it.estado)) return ["RETENER"];
  if (it.estado === "NO_CONTACTADO") return ["INCLUIR_BAJA_PRIORIDAD", "RETENER"];
  return ["INCLUIR", "INCLUIR_BAJA_PRIORIDAD", "RETENER"];
};
const items = corte.body.items || [];
check("reglas de corte por estado", items.length > 0 && items.every((it) => esperado(it).includes(it.accion)), items.filter((it) => !esperado(it).includes(it.accion)).map((it) => `${it.guia}:${it.estado}->${it.accion}`).join(" "));
const conf = await db.from("promesas").select("envio_id, confianza, estado").eq("vigente", true);
const porId = new Map((conf.data || []).map((p) => [p.envio_id, p]));
const okConf = items
  .filter((it) => ["CONFIRMADO", "CONFIRMADO_VENTANA", "CONFIRMADO_TERCERO"].includes(it.estado))
  .every((it) => {
    const c = Number(porId.get(it.envio_id)?.confianza);
    return it.accion === (c >= 0.75 ? "INCLUIR" : c >= 0.5 ? "INCLUIR_BAJA_PRIORIDAD" : "RETENER");
  });
check("reglas de confianza (≥0,75 / 0,5–0,75 / <0,5)", okConf, "");
check("grupo de control → INCLUIR (ruteo como hoy)", items.some((i) => i.estado === "GRUPO_CONTROL") && items.filter((i) => i.estado === "GRUPO_CONTROL").every((i) => i.accion === "INCLUIR"), "");
check("prepago con nota 'PAGADO, no cobrar'", items.filter((i) => i.estado === "CONFIRMADO_PREPAGO").every((i) => /PAGADO, no cobrar/.test(i.nota || "")) && items.some((i) => i.estado === "CONFIRMADO_PREPAGO"), "");
const sr = items.find((i) => i.envio_id === sinRespuesta.id);
check("sin respuesta → NO_CONTACTADO por riesgo", sr?.estado === "NO_CONTACTADO" && ["INCLUIR_BAJA_PRIORIDAD", "RETENER"].includes(sr?.accion), `${sr?.estado} ${sr?.accion}`);
const suma = Object.values(corte.body.resumen).reduce((a, b) => a + b, 0);
check("resumen suma = items", suma === items.length, `${suma}/${items.length}`);
const corte2 = await post("/api/demo/corte");
check("corte versionado (v+1)", corte2.body.version === corte.body.version + 1, `v${corte2.body.version}`);
const csv = await fetch(`${BASE}/api/demo/corte/csv?corte_id=${corte.body.corte_id}`, { headers: H });
const csvTxt = await csv.text();
check("GET corte/csv text/csv", csv.status === 200 && /text\/csv/.test(csv.headers.get("content-type") || "") && csvTxt.split("\r\n").filter(Boolean).length === items.length + 1, `${csvTxt.split("\r\n").filter(Boolean).length - 1} filas`);
const csvSin = await fetch(`${BASE}/api/demo/corte/csv?corte_id=${corte.body.corte_id}`);
check("CSV sin token → 401", csvSin.status === 401, String(csvSin.status));

// ---- Día D ----
const dd = await post("/api/demo/dia-d");
check("POST /api/demo/dia-d", dd.status === 200 && dd.body.enviados >= 1, JSON.stringify(dd.body));
const confirmado = usados.find((u) => u.esc.nombre.startsWith("confirma con efectivo"));
if (confirmado) {
  const r = await chat(confirmado.envio.id, "Sí, estoy", { boton_id: "dia_d_si" });
  const p = await promesa(confirmado.envio.id);
  check("día D 'Sí, estoy' → CONFIRMADO reforzado", p?.estado === "CONFIRMADO" && Number(p?.confianza) >= 0.9, `${p?.estado} ${p?.confianza} · ${r.texto.slice(0, 80)}`);
}

// ---- Resumen ----
const fallas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallas.length}/${resultados.length} verificaciones OK en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
if (fallas.length) {
  console.log("Fallas:");
  for (const f of fallas) console.log(`  ✘ ${f.nombre} — ${f.detalle}`);
}
process.exit(fallas.length ? 1 : 0);
