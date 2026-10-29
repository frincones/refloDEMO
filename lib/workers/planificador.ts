import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento } from "@/lib/ingesta/envios";
import { BOTONES_CONFIRMACION, BOTONES_DIA_D } from "@/lib/contratos";
import { preparar } from "./riesgo";
import {
  ahoraDemo,
  direccionCorta,
  enHorarioLegal,
  fechaEntregaManana,
  fechaLarga,
  formatoCOP,
  leerConfig,
  primerNombre,
  registrarEventos,
} from "./util";

// Planificador de contacto (Fase 4): el ÚNICO componente que inicia contactos proactivos.
// Ola de confirmación, recordatorio a no respondedores y aviso del día D. Respeta el interruptor de apagado.

export class AgentesPausados extends Error {
  constructor() {
    super("agentes_pausados");
  }
}

type Envio = {
  id: string;
  tracking_number: string | null;
  tienda: string | null;
  comprador_nombre: string | null;
  direccion: string | null;
  zona: string | null;
  cod_monto: number | string | null;
  es_cod: boolean | null;
  estado_buffer: string;
  prioridad: number | null;
};

const CAMPOS = "id, tracking_number, tienda, comprador_nombre, direccion, zona, cod_monto, es_cod, estado_buffer, prioridad";

async function verificarPausa(accion: string) {
  const cfg = await leerConfig();
  if (cfg.agentes_pausados) {
    await registrarEvento({ componente: "planificador", herramienta: accion, nivel: "aviso", mensaje: `${accion}: bloqueado por el interruptor de apagado` });
    throw new AgentesPausados();
  }
  const ahora = ahoraDemo(cfg);
  if (!enHorarioLegal(ahora)) {
    // En el demo no bloquea: deja constancia (en producción, politica_evaluar lo impediría)
    await registrarEvento({
      componente: "planificador",
      herramienta: "politica_evaluar",
      nivel: "aviso",
      resultado: { en_horario_legal: false },
      mensaje: `${accion}: fuera del horario de contacto proactivo (Ley 2300). Se envía igual por ser demo.`,
    });
  }
  return ahora;
}

export function textoConfirmacion(e: Envio, fecha: string): string {
  const nombre = primerNombre(e.comprador_nombre);
  const pago = e.es_cod !== false && Number(e.cod_monto) > 0 ? `El pago contra entrega es de ${formatoCOP(e.cod_monto)}.` : "Tu pedido ya está pago.";
  return (
    `Hola ${nombre} 👋 Soy el asistente virtual de entregas de Reflo, a nombre de ${e.tienda || "tu tienda"}. ` +
    `Tu pedido llega mañana ${fechaLarga(fecha)} a ${direccionCorta(e.direccion, e.zona)}. ${pago} ` +
    `¿Nos confirmas que estarás y tendrás el efectivo? Si prefieres hablar con una persona, escríbenos.`
  );
}

/** Ola de confirmación a todos los PENDIENTE_CONTACTO que no son control. */
export async function ola(): Promise<{ enviados: number }> {
  const ahora = await verificarPausa("ola");
  // Los envíos sin sortear/puntuar se preparan antes de la ola
  const db = supabaseServer();
  const { count } = await db.from("envios").select("id", { count: "exact", head: true }).is("grupo_control", null);
  if (count) await preparar();

  const { data, error } = await db
    .from("envios")
    .select(CAMPOS)
    .eq("estado_buffer", "PENDIENTE_CONTACTO")
    .eq("grupo_control", false)
    .or("waygo_is_final.is.null,waygo_is_final.eq.false")
    .order("prioridad", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`ola: ${error.message}`);
  const envios = (data || []) as Envio[];
  if (!envios.length) {
    await registrarEvento({ componente: "planificador", herramienta: "ola", nivel: "info", mensaje: "Ola de confirmación: no hay envíos pendientes de contacto" });
    return { enviados: 0 };
  }
  const fecha = fechaEntregaManana(ahora);
  const mensajes = envios.map((e) => ({
    envio_id: e.id,
    rol: "agente",
    texto: textoConfirmacion(e, fecha),
    botones: BOTONES_CONFIRMACION,
    metadatos: { tipo: "plantilla_confirmacion", plantilla: "confirmacion_entrega_v1", fecha_entrega: fecha, origen: "planificador" },
  }));
  const { error: em } = await db.from("mensajes").insert(mensajes);
  if (em) throw new Error(`ola (mensajes): ${em.message}`);
  const ids = envios.map((e) => e.id);
  const { error: eu } = await db.from("envios").update({ estado_buffer: "CONTACTANDO" }).in("id", ids);
  if (eu) throw new Error(`ola (estado): ${eu.message}`);
  await registrarEventos(
    envios.map((e) => ({
      componente: "planificador",
      herramienta: "whatsapp_enviar_plantilla",
      envio_id: e.id,
      entrada: { plantilla: "confirmacion_entrega_v1", fecha_entrega: fecha },
      resultado: { estado_buffer: "CONTACTANDO" },
      nivel: "info",
      mensaje: `Plantilla de confirmación enviada · ${e.tracking_number || ""} · P ${Number(e.prioridad || 0).toFixed(2)}`,
    })),
  );
  await registrarEvento({ componente: "planificador", herramienta: "ola", nivel: "ok", resultado: { enviados: envios.length }, mensaje: `Ola de confirmación: ${envios.length} plantillas enviadas` });
  return { enviados: envios.length };
}

/** Recordatorio corto a los que recibieron la plantilla y no han respondido (máx. 1 por envío). */
export async function recordatorio(): Promise<{ enviados: number }> {
  await verificarPausa("recordatorio");
  const db = supabaseServer();
  const { data, error } = await db.from("envios").select(CAMPOS).eq("estado_buffer", "CONTACTANDO");
  if (error) throw new Error(`recordatorio: ${error.message}`);
  const candidatos = (data || []) as Envio[];
  if (!candidatos.length) return { enviados: 0 };
  const { data: msgs } = await db
    .from("mensajes")
    .select("envio_id, rol, metadatos")
    .in("envio_id", candidatos.map((e) => e.id));
  const respondio = new Set<string>();
  const yaRecordado = new Set<string>();
  for (const m of msgs || []) {
    if (m.rol === "comprador") respondio.add(m.envio_id);
    if ((m.metadatos as { tipo?: string } | null)?.tipo === "recordatorio") yaRecordado.add(m.envio_id);
  }
  const envios = candidatos.filter((e) => !respondio.has(e.id) && !yaRecordado.has(e.id));
  if (!envios.length) {
    await registrarEvento({ componente: "planificador", herramienta: "recordatorio", nivel: "info", mensaje: "Recordatorio: no hay envíos sin respuesta" });
    return { enviados: 0 };
  }
  const mensajes = envios.map((e) => ({
    envio_id: e.id,
    rol: "agente",
    texto:
      `Hola ${primerNombre(e.comprador_nombre)}, te recordamos que tu pedido de ${e.tienda || "tu tienda"} llega mañana` +
      (Number(e.cod_monto) > 0 ? ` (${formatoCOP(e.cod_monto)} contra entrega)` : "") +
      `. ¿Nos confirmas con un toque? 🙌`,
    botones: BOTONES_CONFIRMACION,
    metadatos: { tipo: "recordatorio", plantilla: "recordatorio_entrega_v1", origen: "planificador" },
  }));
  const { error: em } = await db.from("mensajes").insert(mensajes);
  if (em) throw new Error(`recordatorio (mensajes): ${em.message}`);
  await registrarEventos(
    envios.map((e) => ({
      componente: "planificador",
      herramienta: "whatsapp_enviar_plantilla",
      envio_id: e.id,
      entrada: { plantilla: "recordatorio_entrega_v1" },
      nivel: "info",
      mensaje: `Recordatorio enviado · ${e.tracking_number || ""}`,
    })),
  );
  await registrarEvento({ componente: "planificador", herramienta: "recordatorio", nivel: "ok", resultado: { enviados: envios.length }, mensaje: `Recordatorio: ${envios.length} enviados` });
  return { enviados: envios.length };
}

/** Día D: "tu mensajero llega en unos 30 min" a los confirmados. */
export async function diaD(): Promise<{ enviados: number }> {
  await verificarPausa("dia_d");
  const db = supabaseServer();
  const { data, error } = await db
    .from("envios")
    .select(CAMPOS)
    .in("estado_buffer", ["CONFIRMADO", "CONFIRMADO_VENTANA", "CONFIRMADO_PREPAGO", "CONFIRMADO_TERCERO"]);
  if (error) throw new Error(`dia-d: ${error.message}`);
  const envios = (data || []) as Envio[];
  if (!envios.length) {
    await registrarEvento({ componente: "planificador", herramienta: "dia_d", nivel: "info", mensaje: "Día D: no hay envíos confirmados" });
    return { enviados: 0 };
  }
  const mensajes = envios.map((e) => {
    const prepago = e.estado_buffer === "CONFIRMADO_PREPAGO";
    const cobro = prepago ? "Ya está pago: no tienes que pagar nada." : Number(e.cod_monto) > 0 ? `Ten listos ${formatoCOP(e.cod_monto)} en efectivo.` : "";
    return {
      envio_id: e.id,
      rol: "agente",
      texto: `Hola ${primerNombre(e.comprador_nombre)} 🛵 Tu mensajero Carlos llega en unos 30 min con tu pedido de ${e.tienda || "tu tienda"}. ${cobro} ¿Estás en casa?`.replace(/\s+/g, " ").trim(),
      botones: BOTONES_DIA_D,
      metadatos: { tipo: "dia_d", plantilla: "dia_d_30min_v1", origen: "planificador" },
    };
  });
  const { error: em } = await db.from("mensajes").insert(mensajes);
  if (em) throw new Error(`dia-d (mensajes): ${em.message}`);
  await registrarEventos(
    envios.map((e) => ({
      componente: "planificador",
      herramienta: "whatsapp_enviar_plantilla",
      envio_id: e.id,
      entrada: { plantilla: "dia_d_30min_v1" },
      nivel: "info",
      mensaje: `Aviso día D (mensajero a 30 min) · ${e.tracking_number || ""}`,
    })),
  );
  await registrarEvento({ componente: "planificador", herramienta: "dia_d", nivel: "ok", resultado: { enviados: envios.length }, mensaje: `Día D: ${envios.length} avisos enviados` });
  return { enviados: envios.length };
}
