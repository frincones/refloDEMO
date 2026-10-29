import "server-only";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento } from "@/lib/ingesta/envios";
import { env, envOpcional } from "@/lib/env";
import type { Boton, EventosChat, NombreEventoChat, TipoCaso } from "@/lib/contratos";
import { CATALOGO_BOTONES } from "@/lib/contratos";
import { construirContexto, definicionesOpenAI, ejecutarHerramienta } from "@/lib/herramientas";
import { asegurarCaso, leerEnvio, promesaVigente } from "@/lib/herramientas/comun";
import { decidirRuta } from "@/lib/workers/reglas";
import { horaBogota, leerConfig } from "@/lib/workers/util";
import { construirInstrucciones } from "./prompt";
import { clasificarIntencion, type Clasificacion } from "./clasificador";
import { planBoton } from "./rapido";

// Agente de contacto: un turno de conversación.
// OpenAI Responses API con function calling y streaming; ciclo de herramientas con previous_response_id.

export type Emitir = <K extends NombreEventoChat>(evento: K, datos: EventosChat[K]) => void;

const MAX_PASOS = 6;
const HERRAMIENTAS_PROMESA = new Set(["entrega_registrar_intencion", "entrega_proponer_cambio", "pago_generar_link"]);
/** Herramientas cuyo resultado el modelo necesita para redactar (exigen una segunda llamada). */
const HERRAMIENTAS_LECTURA = new Set(["pago_generar_link", "politicas_buscar", "envio_contexto"]);
const FALLBACK = "Disculpa, se me complicó responderte en este momento. Ya le pasé tu mensaje a una persona del equipo de Reflo, que te escribe en breve 🙏";

let cliente: OpenAI | null = null;
function openai(): OpenAI {
  if (!cliente) cliente = new OpenAI({ apiKey: env("OPENAI_API_KEY"), maxRetries: 0, timeout: 40_000 });
  return cliente;
}

/** ¿El agente debe callar? (interruptor de apagado o conversación tomada por una persona) */
export async function agenteSilenciado(envioId: string): Promise<"pausa" | "tomado" | null> {
  const [cfg, { count }] = await Promise.all([
    leerConfig(),
    supabaseServer().from("casos").select("id", { count: "exact", head: true }).eq("envio_id", envioId).eq("estado", "tomado"),
  ]);
  if (cfg.agentes_pausados) return "pausa";
  return (count || 0) > 0 ? "tomado" : null;
}

type MensajeHist = { rol: string; texto: string; botones: Boton[] | null; metadatos: { boton_id?: string; es_audio?: boolean } | null };

function textoComprador(m: { texto: string; metadatos: MensajeHist["metadatos"] }): string {
  const partes: string[] = [];
  if (m.metadatos?.boton_id) partes.push(`[botón: ${m.metadatos.boton_id}]`);
  if (m.metadatos?.es_audio) partes.push("[nota de voz transcrita]");
  partes.push(m.texto);
  return partes.join(" ");
}

function historial(mensajes: MensajeHist[]) {
  const input: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of mensajes) {
    if (m.rol === "comprador") input.push({ role: "user", content: textoComprador(m) });
    else if (m.rol === "agente" || m.rol === "persona") {
      const bot = m.botones?.length ? `\n[botones ofrecidos: ${m.botones.map((b) => `${b.id} = «${b.titulo}»`).join(", ")}]` : "";
      input.push({ role: "assistant", content: `${m.rol === "persona" ? "(persona de Reflo) " : ""}${m.texto}${bot}` });
    }
  }
  // La Responses API exige que el primer turno no sea vacío; si no hay plantilla previa, basta con el del comprador.
  return input;
}

async function emitirIntencion(emitir: Emitir, envioId: string, cita: string) {
  const [pv, e] = await Promise.all([promesaVigente(envioId), leerEnvio(envioId)]);
  if (!pv) return null;
  const conf = Number(pv.confianza) || 0;
  const ev = (pv.evidencia || {}) as { cita?: string; tipo?: string };
  const datos: EventosChat["intencion"] = {
    estado: pv.estado as EventosChat["intencion"]["estado"],
    confianza: conf,
    evidencia: ev.cita ? `${ev.tipo || "texto"}: «${ev.cita}»` : cita,
    accion_ruta: decidirRuta(pv.estado as EventosChat["intencion"]["estado"], conf, e?.riesgo).accion,
    version: pv.version,
  };
  const fi = horaBogota(pv.franja_inicio);
  const ff = horaBogota(pv.franja_fin);
  if (fi) datos.franja_inicio = fi;
  if (ff) datos.franja_fin = ff;
  if (pv.fecha_entrega) datos.fecha_entrega = pv.fecha_entrega;
  if (pv.preferencia_pago) datos.preferencia_pago = pv.preferencia_pago as EventosChat["intencion"]["preferencia_pago"];
  emitir("intencion", datos);
  return datos;
}

/** Turno de botón resuelto sin LLM: herramientas por el gateway + respuesta de plantilla. */
async function turnoDeterminista(
  plan: NonNullable<ReturnType<typeof planBoton>>,
  p: { envio_id: string; boton_id?: string; es_audio?: boolean },
  texto: string,
  emitir: Emitir,
  inicio: number,
): Promise<ResultadoTurno | null> {
  const db = supabaseServer();
  const usadas: string[] = [];
  const resultados: Record<string, unknown>[] = [];
  let botones: Boton[] | null = null;
  let intencion: EventosChat["intencion"] | null = null;
  const casos = new Map<string, TipoCaso>();
  for (const ll of plan.llamadas) {
    const r = await ejecutarHerramienta(ll.nombre, ll.args, { componente: "agente_contacto", envio_id: p.envio_id });
    usadas.push(ll.nombre);
    const { politica: _pol, mensajes: _m, ...resVisible } = r as Record<string, unknown>;
    emitir("herramienta", { nombre: ll.nombre, entrada: ll.args, resultado: resVisible });
    // Si una regla rechaza la acción, el modelo se encarga del turno (ve el historial y vuelve a intentar).
    if (!r.ok) return null;
    resultados.push(r as Record<string, unknown>);
    if (ll.nombre === "whatsapp_ofrecer_botones") botones = (r.botones as Boton[]) || null;
    for (const c of r.casos || []) {
      if (!casos.has(c.id)) {
        casos.set(c.id, c.tipo);
        emitir("caso", { id: c.id, tipo: c.tipo });
      }
    }
    if (HERRAMIENTAS_PROMESA.has(ll.nombre) && r.promesa) intencion = (await emitirIntencion(emitir, p.envio_id, texto)) || intencion;
  }
  const respuesta = plan.texto(resultados);
  emitir("delta", { texto: respuesta });
  const ms = Date.now() - inicio;
  const { data: ins, error } = await db
    .from("mensajes")
    .insert({ envio_id: p.envio_id, rol: "agente", texto: respuesta, botones, metadatos: { modelo: "determinista", herramientas: usadas, intencion, clasificacion: null, casos: [...casos.keys()], ms, response_id: null, fallo: null } })
    .select("id")
    .single();
  if (error) throw new Error(`mensajes (agente): ${error.message}`);
  if (botones) emitir("botones", { botones });
  await registrarEvento({
    componente: "agente_contacto",
    herramienta: "turno",
    envio_id: p.envio_id,
    entrada: { texto, boton_id: p.boton_id ?? null, es_audio: !!p.es_audio },
    resultado: { herramientas: usadas, intencion, ms, modelo: "determinista" },
    nivel: "ok",
    mensaje: `Agente respondió en ${(ms / 1000).toFixed(1)} s (botón ${p.boton_id}, sin LLM)${intencion ? ` · ${intencion.estado} (${intencion.confianza.toFixed(2)})` : ""}${usadas.length ? ` · ${usadas.join(", ")}` : ""}`,
  });
  return { mensaje_id: ins.id, texto: respuesta };
}

export type ResultadoTurno = { mensaje_id: string | null; texto: string; silenciado?: "pausa" | "tomado" };

/**
 * Corre un turno completo: guarda el mensaje del comprador, llama al modelo con herramientas,
 * emite eventos y guarda la respuesta del agente.
 */
export async function ejecutarTurno(
  p: { envio_id: string; texto: string; boton_id?: string; es_audio?: boolean },
  emitir: Emitir,
): Promise<ResultadoTurno> {
  const db = supabaseServer();
  const inicio = Date.now();
  const tituloBoton = p.boton_id ? CATALOGO_BOTONES[p.boton_id]?.titulo : undefined;
  const texto = (p.texto || tituloBoton || p.boton_id || "").trim();

  // 1–3) En paralelo (latencia): guardar el mensaje del comprador (siempre, aunque el agente esté en pausa),
  // revisar el interruptor / conversación tomada, armar el contexto y leer el historial.
  const metaComprador = { ...(p.boton_id ? { boton_id: p.boton_id } : {}), ...(p.es_audio ? { es_audio: true } : {}) };
  const [insComprador, silencio, ctx, { data: msgs }] = await Promise.all([
    db.from("mensajes").insert({ envio_id: p.envio_id, rol: "comprador", texto, metadatos: metaComprador }).select("id").single(),
    agenteSilenciado(p.envio_id),
    construirContexto(p.envio_id),
    db.from("mensajes").select("id, rol, texto, botones, metadatos, created_at").eq("envio_id", p.envio_id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (insComprador.error) throw new Error(`mensajes: ${insComprador.error.message}`);

  // 2) Interruptor de apagado / conversación tomada por una persona
  if (silencio) {
    await registrarEvento({
      componente: "agente_contacto",
      herramienta: "turno",
      envio_id: p.envio_id,
      entrada: { texto, boton_id: p.boton_id ?? null },
      resultado: { silenciado: silencio },
      nivel: "aviso",
      mensaje: silencio === "pausa" ? "Agente en pausa (interruptor de apagado): no responde" : "Conversación tomada por una persona: el agente no responde",
    });
    emitir("error", { mensaje: "agente_en_pausa" });
    return { mensaje_id: null, texto: "", silenciado: silencio };
  }

  // 3) Contexto e historial (sin el mensaje recién insertado, que se agrega al final: la lectura fue en paralelo)
  if (!ctx) throw new Error("envio_no_existe");
  const hist = ((msgs || []) as (MensajeHist & { id: string })[]).filter((m) => m.id !== insComprador.data.id).reverse().slice(-19);
  const ultimoAgente = [...hist].reverse().find((m) => m.rol === "agente")?.texto || "";
  hist.push({ id: insComprador.data.id, rol: "comprador", texto, botones: null, metadatos: metaComprador });

  // 3b) Botones con intención inequívoca → turno determinista, sin LLM
  const plan = planBoton(p.boton_id, ctx);
  if (plan) {
    const r = await turnoDeterminista(plan, p, texto, emitir, inicio);
    if (r) return r;
  }
  const instrucciones = construirInstrucciones(ctx);
  const tiempos: Record<string, number> = { preludio: Date.now() - inicio };
  const tools = definicionesOpenAI("agente_contacto");
  const modelo = envOpcional("OPENAI_MODEL_CONVERSA", "gpt-5.5");
  // Esfuerzo de razonamiento (none | low | medium | high). "low" equilibra calidad y latencia.
  const esfuerzo = envOpcional("OPENAI_REASONING_CONVERSA", "low") as "none" | "low" | "medium" | "high";
  const oa = openai();

  // 4) Pre-clasificación con el modelo pequeño, en paralelo
  const clasif: Promise<Clasificacion | null> = clasificarIntencion(oa, ultimoAgente, textoComprador({ texto, metadatos: metaComprador })).then((c) => {
    if (c) {
      emitir("herramienta", { nombre: "clasificar_intencion", entrada: { modelo: envOpcional("OPENAI_MODEL_CLASIFICA", "gpt-5.4-mini"), texto }, resultado: c });
      void registrarEvento({
        componente: "agente_contacto",
        herramienta: "clasificar_intencion",
        envio_id: p.envio_id,
        entrada: { texto },
        resultado: c,
        nivel: "info",
        mensaje: `Clasificador: ${c.intencion} (${c.confianza.toFixed(2)})${c.molesto ? " · molesto" : ""}`,
      });
    }
    return c;
  });

  // 5) Ciclo modelo ↔ herramientas
  let respuesta = "";
  let botones: Boton[] | null = null;
  const usadas: string[] = [];
  const casos = new Map<string, TipoCaso>();
  let intencion: EventosChat["intencion"] | null = null;
  let fallo: string | null = null;
  let responseId: string | undefined;
  let input: unknown[] = historial(hist);

  const delta = (t: string) => {
    respuesta += t;
    emitir("delta", { texto: t });
  };

  // "Hablar → actuar" (latencia percibida): el paso 0 corre sin herramientas y el texto empieza a llegar en ~2 s;
  // el paso 1 ejecuta en silencio las herramientas que corresponden a la conversación y a lo que ya se dijo.
  // Solo si una herramienta falla (o la reprogramación queda fuera de política) hay un paso visible de corrección.
  // OPENAI_TEXTO_PRIMERO=0 vuelve al ciclo clásico (herramientas primero, texto al final).
  const textoPrimero = envOpcional("OPENAI_TEXTO_PRIMERO", "1") !== "0";
  let fase: "hablar" | "actuar" | "normal" = textoPrimero ? "hablar" : "normal";
  let link: { link: string; monto_texto: string } | null = null;

  try {
    for (let paso = 0; paso < MAX_PASOS; paso++) {
      const silencioso = fase === "actuar";
      let llamadas: { name: string; arguments: string; call_id: string }[] = [];
      let intentos = 0;
      for (;;) {
        const textoAntes = respuesta.length;
        llamadas = [];
        try {
          const stream = await oa.responses.create({
            model: modelo,
            instructions: instrucciones,
            input: input as OpenAI.Responses.ResponseInput,
            tools,
            previous_response_id: responseId,
            reasoning: { effort: esfuerzo },
            prompt_cache_key: "reflo-agente-contacto",
            tool_choice: fase === "hablar" ? "none" : "auto",
            stream: true,
          });
          let separado = false;
          for await (const ev of stream) {
            if (tiempos[`p${paso}_primer_evento`] === undefined && ev.type !== "response.created" && ev.type !== "response.in_progress") tiempos[`p${paso}_primer_evento`] = Date.now() - inicio;
            if (ev.type === "response.output_text.delta") {
              if (silencioso) continue; // en la fase "actuar" el texto ya se envió
              if (tiempos.primer_delta === undefined) tiempos.primer_delta = Date.now() - inicio;
              if (!separado && respuesta.length > 0 && respuesta.length === textoAntes && !/\s$/.test(respuesta)) delta(" ");
              separado = true;
              delta(ev.delta);
            } else if (ev.type === "response.output_item.done" && ev.item.type === "function_call") {
              llamadas.push({ name: ev.item.name, arguments: ev.item.arguments, call_id: ev.item.call_id });
            } else if (ev.type === "response.completed") {
              responseId = ev.response.id;
            } else if (ev.type === "response.failed" || ev.type === "error") {
              throw new Error(`modelo: ${JSON.stringify((ev as { response?: { error?: unknown } }).response?.error ?? ev)}`);
            }
          }
          tiempos[`p${paso}_fin`] = Date.now() - inicio;
          break;
        } catch (e) {
          intentos += 1;
          // Un reintento, solo si todavía no se mostró texto de este paso
          if (intentos > 1 || respuesta.length !== textoAntes) throw e;
          console.error("[agente] reintento:", (e as Error).message);
        }
      }
      if (fase === "hablar") {
        fase = "actuar";
        input = [
          {
            role: "developer",
            content:
              "Tu mensaje ya se envió al comprador. Ahora, SIN escribir texto, llama las herramientas que correspondan a la conversación y a lo que acabas de decirle (entrega_registrar_intencion, entrega_proponer_cambio, caso_escalar_a_humano, whatsapp_ofrecer_botones, pago_generar_link), varias a la vez si hace falta. Si no corresponde ninguna, no llames nada.",
          },
        ];
        continue;
      }
      if (!llamadas.length) break;

      const textoEnEstePaso = respuesta.length > 0 && paso === 0;
      let necesitaSeguir = fase === "actuar" ? false : !textoEnEstePaso;
      let corregir = false;
      const salidas: unknown[] = [];
      for (const ll of llamadas) {
        let args: unknown = {};
        try {
          args = ll.arguments ? JSON.parse(ll.arguments) : {};
        } catch {
          args = {};
        }
        const r = await ejecutarHerramienta(ll.name, args, { componente: "agente_contacto", envio_id: p.envio_id });
        usadas.push(ll.name);
        const { politica: _pol, mensajes: _m, ...resVisible } = r as Record<string, unknown>;
        emitir("herramienta", { nombre: ll.name, entrada: args, resultado: resVisible });
        if (r.ok && ll.name === "whatsapp_ofrecer_botones") botones = (r.botones as Boton[]) || null;
        for (const c of r.casos || []) {
          if (!casos.has(c.id)) {
            casos.set(c.id, c.tipo);
            emitir("caso", { id: c.id, tipo: c.tipo });
          }
        }
        if (r.ok && HERRAMIENTAS_PROMESA.has(ll.name) && r.promesa) intencion = (await emitirIntencion(emitir, p.envio_id, texto)) || intencion;
        salidas.push({ type: "function_call_output", call_id: ll.call_id, output: JSON.stringify(r) });
        // Texto y herramientas en la misma respuesta: solo hace falta otra llamada si el modelo necesita
        // el resultado para redactar, si una herramienta falló o si la reprogramación quedó fuera de política.
        if (HERRAMIENTAS_LECTURA.has(ll.name) || !r.ok || (r as Record<string, unknown>).fuera_de_politica) necesitaSeguir = true;
        if (!r.ok || (r as Record<string, unknown>).fuera_de_politica) corregir = true;
        if (r.ok && ll.name === "pago_generar_link") link = { link: String(r.link), monto_texto: String(r.monto_texto) };
      }
      if (fase === "actuar") {
        // El enlace de pago lo agrega el sistema (el modelo no lo conocía al hablar)
        if (link && !respuesta.includes(link.link)) delta(`\n${link.link} (${link.monto_texto})`);
        tiempos[`p${paso}_herramientas_fin`] = Date.now() - inicio;
        if (!corregir) break;
        fase = "normal";
        input = [
          ...salidas,
          {
            role: "developer",
            content:
              "Tu mensaje anterior ya se envió. Según estos resultados, escribe SOLO una corrección o aclaración breve para el comprador (una herramienta falló, falta un dato o la reprogramación requiere aprobación de una persona). Puedes volver a llamar herramientas si hace falta.",
          },
        ];
        continue;
      }
      tiempos[`p${paso}_herramientas_fin`] = Date.now() - inicio;
      if (!necesitaSeguir) break;
      input = textoEnEstePaso
        ? [
            ...salidas,
            {
              role: "developer",
              content:
                "Ya enviaste tu mensaje al comprador. Escribe SOLO si hace falta corregir o completar algo según los resultados (una herramienta falló, falta un dato o requiere aprobación); si no, no escribas nada.",
            },
          ]
        : salidas;
    }
  } catch (e) {
    fallo = (e as Error).message;
    console.error("[agente] fallo:", fallo);
  }

  tiempos.modelo_fin = Date.now() - inicio;
  console.info(`[agente] tiempos ms ${JSON.stringify(tiempos)}`);

  // 6) Respaldo seguro si el modelo falló o no respondió texto
  if (fallo || !respuesta.trim()) {
    const extra = respuesta.trim() ? " " : "";
    if (fallo) {
      delta(extra + FALLBACK);
      const c = await asegurarCaso({
        envio_id: p.envio_id,
        tipo: "otro",
        resumen: `El agente no pudo responder (${fallo.slice(0, 160)}). Último mensaje del comprador: «${texto.slice(0, 200)}».`,
        recomendacion: "Responder manualmente al comprador.",
        confianza: 1,
        razonamiento: "Falló el modelo conversacional después de un reintento; se envió una respuesta de respaldo.",
      });
      if (!casos.has(c.id)) {
        casos.set(c.id, c.tipo);
        emitir("caso", { id: c.id, tipo: c.tipo });
      }
    } else {
      delta("Listo, quedó anotado. ¿Te ayudo con algo más?");
    }
  }

  // 7) Red de seguridad del clasificador (escalamiento en código)
  const c = await clasif;
  if (c && !fallo) {
    const tipos = new Set(casos.values());
    const red: { tipo: TipoCaso; resumen: string; recomendacion: string } | null =
      (c.molesto || c.intencion === "molesto") && c.confianza >= 0.6 && !tipos.has("cliente_molesto")
        ? { tipo: "cliente_molesto", resumen: `Comprador molesto: «${texto.slice(0, 200)}». ${c.resumen}`, recomendacion: "Contactar con empatía y resolver la queja." }
        : c.intencion === "no_reconoce" && c.confianza >= 0.7 && !tipos.has("fraude")
          ? { tipo: "fraude", resumen: `El comprador no reconoce el pedido: «${texto.slice(0, 200)}».`, recomendacion: "Retener y validar con la tienda." }
          : null;
    if (red) {
      const k = await asegurarCaso({
        envio_id: p.envio_id,
        ...red,
        confianza: c.confianza,
        razonamiento: `Red de seguridad: el clasificador (${envOpcional("OPENAI_MODEL_CLASIFICA", "gpt-5.4-mini")}) detectó «${c.intencion}» y el agente no escaló. ${c.resumen}`,
        datos: { origen: "red_de_seguridad_clasificador" },
      });
      if (!casos.has(k.id)) {
        casos.set(k.id, k.tipo);
        emitir("caso", { id: k.id, tipo: k.tipo });
      }
    }
  }

  // 8) Guardar la respuesta del agente (Realtime la entrega a la UI)
  const { data: ins, error: ea } = await db
    .from("mensajes")
    .insert({
      envio_id: p.envio_id,
      rol: "agente",
      texto: respuesta.trim(),
      botones,
      metadatos: { modelo, herramientas: usadas, intencion, clasificacion: c, casos: [...casos.keys()], ms: Date.now() - inicio, tiempos, response_id: responseId ?? null, fallo },
    })
    .select("id")
    .single();
  if (ea) throw new Error(`mensajes (agente): ${ea.message}`);
  if (botones) emitir("botones", { botones });

  await registrarEvento({
    componente: "agente_contacto",
    herramienta: "turno",
    envio_id: p.envio_id,
    entrada: { texto, boton_id: p.boton_id ?? null, es_audio: !!p.es_audio },
    resultado: { herramientas: usadas, intencion, casos: [...casos.entries()].map(([id, tipo]) => ({ id, tipo })), ms: Date.now() - inicio, modelo },
    nivel: fallo ? "error" : "ok",
    mensaje: fallo
      ? `Agente: fallo del modelo, respuesta de respaldo y caso abierto`
      : `Agente respondió en ${((Date.now() - inicio) / 1000).toFixed(1)} s${intencion ? ` · ${intencion.estado} (${intencion.confianza.toFixed(2)})` : ""}${usadas.length ? ` · ${usadas.join(", ")}` : ""}`,
  });
  return { mensaje_id: ins.id, texto: respuesta.trim() };
}
