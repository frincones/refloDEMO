import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { CATALOGO_BOTONES, type EstadoIntencion, type TipoCaso } from "@/lib/contratos";
import { decidirRuta, ESTADOS_EXCLUSION } from "@/lib/workers/reglas";
import {
  COD_ALTO,
  COD_ESCALAR,
  ahoraDemo,
  diaSemana,
  direccionCorta,
  fechaEntregaManana,
  fechaISO,
  formatoCOP,
  horaBogota,
  instanteBogota,
  leerConfig,
  primerNombre,
  sumarDias,
  telefonoEnmascarado,
} from "@/lib/workers/util";
import { asegurarCaso, definir, leerEnvio, promesaVigente, type Herramienta } from "./comun";
import { politicaComoTexto, politicaDe } from "./politicas";
import { registrarPromesa } from "./promesa";

// Catálogo de herramientas (nombres de la arquitectura §6.1). Cada una: esquema zod, reglas en código
// (la IA propone, el código decide) y auditoría en `eventos` (la hace ejecutarHerramienta en index.ts).

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "formato HH:MM");
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD");

const Evidencia = z.object({
  tipo: z.enum(["boton", "texto", "audio", "humano", "sistema"]).describe("boton = el comprador tocó un botón; texto = escribió; audio = nota de voz transcrita"),
  cita: z.string().max(400).describe("Frase literal del comprador (o id del botón) que respalda la intención"),
});

const ESTADOS_AGENTE = [
  "CONFIRMADO",
  "CONFIRMADO_VENTANA",
  "CONFIRMADO_TERCERO",
  "REPROGRAMADO",
  "SIN_PAGO_HOY",
  "RECHAZADO",
  "RIESGO_FRAUDE",
  "DIRECCION_EN_VALIDACION",
] as const;

// ---------------------------------------------------------------------
// envio_contexto (lectura)
// ---------------------------------------------------------------------
export async function construirContexto(envioId: string) {
  const db = supabaseServer();
  // Todas las lecturas en paralelo (latencia del turno del agente)
  const [e, cfg, pv, msgs, casos, reprog] = await Promise.all([
    leerEnvio(envioId),
    leerConfig(),
    promesaVigente(envioId),
    db.from("mensajes").select("rol, texto, botones, created_at").eq("envio_id", envioId).order("created_at", { ascending: false }).limit(20),
    db.from("casos").select("id, tipo, estado").eq("envio_id", envioId).in("estado", ["abierto", "tomado"]),
    db.from("promesas").select("id", { count: "exact", head: true }).eq("envio_id", envioId).eq("estado", "REPROGRAMADO"),
  ]);
  if (!e) return null;
  const ahora = ahoraDemo(cfg);
  const reprogramaciones = reprog.count;
  return {
    hoy: fechaISO(ahora),
    fecha_entrega_prevista: fechaEntregaManana(ahora),
    envio: {
      guia: e.tracking_number,
      pedido: e.order_number,
      tienda: e.tienda,
      comprador: primerNombre(e.comprador_nombre),
      telefono: telefonoEnmascarado(e.telefono_e164),
      direccion: direccionCorta(e.direccion, e.zona),
      complemento: e.direccion_linea2,
      referencia: e.referencia,
      ciudad: e.ciudad,
      contra_entrega: e.es_cod !== false && Number(e.cod_monto) > 0,
      cod_monto: Number(e.cod_monto) || 0,
      cod_monto_texto: formatoCOP(e.cod_monto),
      servicio: e.shipment_type_name,
      estado_waygo: e.waygo_status_name,
      seguimiento: e.tracking_url,
      estado_buffer: e.estado_buffer,
      riesgo: e.riesgo === null ? null : Number(e.riesgo),
      grupo_control: e.grupo_control,
    },
    promesa_vigente: pv
      ? {
          version: pv.version,
          estado: pv.estado,
          confianza: pv.confianza === null ? null : Number(pv.confianza),
          fecha_entrega: pv.fecha_entrega,
          franja: pv.franja_inicio && pv.franja_fin ? `${horaBogota(pv.franja_inicio)}–${horaBogota(pv.franja_fin)}` : null,
          preferencia_pago: pv.preferencia_pago,
          nota_mensajero: pv.nota_mensajero,
          link_pago: (pv.evidencia as { link_pago?: string } | null)?.link_pago ?? null,
        }
      : null,
    reprogramaciones: reprogramaciones || 0,
    casos_abiertos: casos.data || [],
    mensajes: (msgs.data || []).reverse().map((m) => ({ rol: m.rol, texto: m.texto, botones: m.botones })),
  };
}

const envioContexto = definir({
  nombre: "envio_contexto",
  descripcion: "Lee el contexto del envío de esta conversación: datos del pedido (sin teléfono completo), monto COD, promesa vigente, casos abiertos y últimos mensajes.",
  esquema: z.object({}),
  async ejecutar(_a, ctx) {
    const c = await construirContexto(ctx.envio_id);
    if (!c) return { ok: false, error: "envio_no_existe" };
    return { ok: true, resumen: `Contexto leído · ${c.envio.guia}`, ...c };
  },
});

// ---------------------------------------------------------------------
// entrega_registrar_intencion (escritura reversible)
// ---------------------------------------------------------------------
const RegistrarIntencion = z.object({
  estado: z.enum(ESTADOS_AGENTE).describe("Estado de la intención de entrega"),
  confianza: z.number().min(0).max(1).describe("botón 0,9 · texto claro 0,8 · audio claro 0,8 · ambiguo 0,5"),
  evidencia: Evidencia,
  franja_inicio: HMM_opcional("Inicio de la franja (HH:MM, hora Colombia). Obligatoria en CONFIRMADO_VENTANA"),
  franja_fin: HMM_opcional("Fin de la franja (HH:MM)"),
  fecha_entrega: FECHA.optional().describe("YYYY-MM-DD. Obligatoria en REPROGRAMADO (fecha nueva). Por defecto, la entrega prevista"),
  preferencia_pago: z.enum(["efectivo", "nequi", "link", "otro"]).optional(),
  nota_mensajero: z.string().max(200).optional().describe("Nota corta para el mensajero (p. ej. 'llevar cambio de 50.000', 'recibe la hermana')"),
  receptor: z.object({ nombre: z.string(), relacion: z.string().optional(), tendra_dinero: z.boolean().optional() }).optional().describe("Solo CONFIRMADO_TERCERO"),
  motivo: z.string().max(200).optional().describe("Motivo (obligatorio en RECHAZADO)"),
  version_base: z.number().int().optional().describe("Versión de la promesa vigente que viste (idempotencia)"),
  idempotency_key: z.string().max(80).optional(),
});

function HMM_opcional(desc: string) {
  return HHMM.optional().describe(desc);
}

async function registrarIntencionImpl(a: z.infer<typeof RegistrarIntencion>, envioId: string, origen: "agente" | "humano") {
  const e = await leerEnvio(envioId);
  if (!e) return { ok: false, error: "envio_no_existe" };
  const cfg = await leerConfig();
  const ahora = ahoraDemo(cfg);
  const hoy = fechaISO(ahora);
  const estado = a.estado as EstadoIntencion;

  // Reglas del gateway (fuera del modelo)
  if (ESTADOS_EXCLUSION.includes(estado) && a.confianza < 0.8 && a.evidencia.tipo !== "boton") {
    return { ok: false, error: "regla_exclusion: excluir de la ruta exige confianza ≥ 0,8 o un botón explícito. Confirma con el comprador antes de registrar." };
  }
  if (estado === "CONFIRMADO_VENTANA" && (!a.franja_inicio || !a.franja_fin)) return { ok: false, error: "CONFIRMADO_VENTANA exige franja_inicio y franja_fin" };
  if (a.franja_inicio && a.franja_fin && a.franja_inicio >= a.franja_fin) return { ok: false, error: "franja inválida: el inicio debe ser antes del fin" };
  if (estado === "REPROGRAMADO") {
    if (!a.fecha_entrega) return { ok: false, error: "REPROGRAMADO exige fecha_entrega (YYYY-MM-DD)" };
    if (a.fecha_entrega <= hoy) return { ok: false, error: "La nueva fecha debe ser posterior a hoy" };
  }
  if (estado === "RECHAZADO" && !a.motivo) return { ok: false, error: "RECHAZADO exige motivo" };
  if (estado === "CONFIRMADO_TERCERO" && !a.receptor?.nombre) return { ok: false, error: "CONFIRMADO_TERCERO exige receptor.nombre" };

  const fecha = a.fecha_entrega || (["REPROGRAMADO", "RECHAZADO", "RIESGO_FRAUDE", "SIN_PAGO_HOY"].includes(estado) ? null : fechaEntregaManana(ahora));
  const fechaFranja = fecha || fechaEntregaManana(ahora);
  const notas = [a.nota_mensajero, a.receptor ? `Recibe ${a.receptor.nombre}${a.receptor.relacion ? ` (${a.receptor.relacion})` : ""}` : null].filter(Boolean).join(" · ");
  const pv = await promesaVigente(envioId);
  // Si ya pagó por enlace, la preferencia y la nota de "no cobrar" se conservan
  const r = await registrarPromesa({
    envio_id: envioId,
    estado,
    confianza: a.confianza,
    fecha_entrega: fecha,
    franja_inicio: a.franja_inicio ? instanteBogota(fechaFranja, a.franja_inicio) : null,
    franja_fin: a.franja_fin ? instanteBogota(fechaFranja, a.franja_fin) : null,
    preferencia_pago: a.preferencia_pago ?? (pv?.preferencia_pago === "link" && estado.startsWith("CONFIRMADO") ? "link" : null),
    nota_mensajero: notas || null,
    evidencia: { ...a.evidencia, motivo: a.motivo ?? null, receptor: a.receptor ?? null, ...(pv?.evidencia && (pv.evidencia as { link_pago?: string }).link_pago ? { link_pago: (pv.evidencia as { link_pago?: string }).link_pago } : {}) },
    origen,
    version_base: a.version_base ?? null,
    idem: a.idempotency_key ?? null,
  });

  // Reglas de escalamiento (código)
  const casos: { id: string; tipo: TipoCaso }[] = [];
  const cod = Number(e.cod_monto) || 0;
  if (!r.idempotente) {
    if (estado === "RIESGO_FRAUDE") {
      const c = await asegurarCaso({
        envio_id: envioId,
        tipo: "fraude",
        resumen: `El comprador no reconoce el pedido ${e.tracking_number} (${formatoCOP(cod)}). Cita: «${a.evidencia.cita}».`,
        recomendacion: "Retener el envío y validar con la tienda antes de despachar. No revelar datos del pedido.",
        datos: { cita: a.evidencia.cita },
        confianza: a.confianza,
        razonamiento: "El comprador dice no haber hecho el pedido: posible suplantación o error de datos.",
      });
      casos.push({ id: c.id, tipo: c.tipo });
    }
    if (estado === "CONFIRMADO_TERCERO" && cod >= COD_ALTO) {
      const c = await asegurarCaso({
        envio_id: envioId,
        tipo: "tercero_cod",
        resumen: `Recibe un tercero (${a.receptor?.nombre || "sin nombre"}) un COD alto de ${formatoCOP(cod)}.`,
        recomendacion: "Aprobar si la tienda acepta entregar a tercero; pedir documento al recibir.",
        datos: { receptor: a.receptor ?? null },
        confianza: a.confianza,
        razonamiento: `Regla: tercero recibiendo COD ≥ ${formatoCOP(COD_ALTO)}.`,
      });
      casos.push({ id: c.id, tipo: c.tipo });
    }
    if (cod >= COD_ESCALAR && a.confianza < 0.75 && estado !== "RIESGO_FRAUDE") {
      const c = await asegurarCaso({
        envio_id: envioId,
        tipo: "cod_alto",
        resumen: `COD alto (${formatoCOP(cod)}) con confianza baja (${a.confianza}) en ${estado}.`,
        recomendacion: "Llamada humana corta antes del corte para confirmar.",
        confianza: a.confianza,
        razonamiento: `Regla: COD ≥ ${formatoCOP(COD_ESCALAR)} con confianza < 0,75.`,
      });
      casos.push({ id: c.id, tipo: c.tipo });
    }
  }
  const p = r.promesa;
  const decision = decidirRuta(p.estado, p.confianza, e.riesgo);
  return {
    ok: true,
    idempotente: r.idempotente,
    resumen: `Intención ${p.estado} (${Number(p.confianza).toFixed(2)}) v${p.version}${r.idempotente ? " · réplica idempotente" : ""} · ${e.tracking_number}`,
    promesa: {
      version: p.version,
      estado: p.estado,
      confianza: p.confianza,
      fecha_entrega: p.fecha_entrega,
      franja_inicio: horaBogota(p.franja_inicio),
      franja_fin: horaBogota(p.franja_fin),
      preferencia_pago: p.preferencia_pago,
      nota_mensajero: p.nota_mensajero,
    },
    accion_ruta: decision.accion,
    casos,
  };
}

const registrarIntencion = definir({
  nombre: "entrega_registrar_intencion",
  descripcion:
    "Registra la intención de entrega del comprador como nueva versión de la promesa (idempotente). Úsala apenas la intención sea clara. " +
    "Reglas del servidor: excluir de la ruta (RECHAZADO, REPROGRAMADO, SIN_PAGO_HOY) exige confianza ≥ 0,8 o botón; CONFIRMADO_PREPAGO no se puede registrar (solo lo pone el pago conciliado).",
  esquema: RegistrarIntencion,
  async ejecutar(a, ctx) {
    return registrarIntencionImpl(a, ctx.envio_id, ctx.componente === "humano" ? "humano" : "agente");
  },
});

// ---------------------------------------------------------------------
// entrega_proponer_cambio (propuesta: dirección, fecha o receptor)
// ---------------------------------------------------------------------
const ProponerCambio = z.object({
  tipo: z.enum(["direccion", "fecha", "receptor"]),
  nueva_direccion: z.string().max(200).optional().describe("Dirección completa nueva (tipo=direccion)"),
  referencia: z.string().max(200).optional(),
  nueva_fecha: FECHA.optional().describe("YYYY-MM-DD (tipo=fecha)"),
  receptor: z.object({ nombre: z.string(), relacion: z.string().optional(), tendra_dinero: z.boolean().optional() }).optional(),
  motivo: z.string().max(200).optional(),
  evidencia: Evidencia,
});

const proponerCambio = definir({
  nombre: "entrega_proponer_cambio",
  descripcion:
    "Propone un cambio sobre la entrega: dirección (queda DIRECCION_EN_VALIDACION y se abre un caso para aprobación), nueva fecha (REPROGRAMADO si cumple la política; si no, caso para aprobación) o receptor (CONFIRMADO_TERCERO).",
  esquema: ProponerCambio,
  async ejecutar(a, ctx) {
    const e = await leerEnvio(ctx.envio_id);
    if (!e) return { ok: false, error: "envio_no_existe" };
    const cfg = await leerConfig();
    const hoy = fechaISO(ahoraDemo(cfg));
    const politica = politicaDe(e.tienda);

    if (a.tipo === "direccion") {
      if (!a.nueva_direccion || a.nueva_direccion.trim().length < 6) return { ok: false, error: "Falta la nueva dirección completa. Pídesela al comprador (calle, número, barrio)." };
      const r = await registrarPromesa({
        envio_id: ctx.envio_id,
        estado: "DIRECCION_EN_VALIDACION",
        confianza: a.evidencia.tipo === "boton" ? 0.9 : 0.8,
        fecha_entrega: fechaEntregaManana(ahoraDemo(cfg)),
        nota_mensajero: `Nueva dirección propuesta: ${a.nueva_direccion}${a.referencia ? ` (${a.referencia})` : ""}`,
        evidencia: { ...a.evidencia, cambio: { tipo: "direccion", anterior: direccionCorta(e.direccion, e.zona), nueva: a.nueva_direccion, referencia: a.referencia ?? null } },
        origen: "agente",
      });
      const c = await asegurarCaso({
        envio_id: ctx.envio_id,
        tipo: "cambio_direccion",
        resumen: `Cambio de dirección: «${direccionCorta(e.direccion, e.zona)}» → «${a.nueva_direccion}».`,
        recomendacion: "Validar cobertura y aplicar la dirección en Waygo (hoy no hay API para editarla). Al aprobar, la promesa pasa a CONFIRMADO.",
        datos: { estado_recomendado: "CONFIRMADO", nueva_direccion: a.nueva_direccion, referencia: a.referencia ?? null },
        confianza: r.promesa.confianza,
        razonamiento: "Waygo no permite editar la dirección por API y hay que validar cobertura antes de rutear.",
      });
      return {
        ok: true,
        resumen: `Cambio de dirección propuesto → DIRECCION_EN_VALIDACION v${r.promesa.version} · caso ${c.tipo}`,
        promesa: { version: r.promesa.version, estado: r.promesa.estado, confianza: r.promesa.confianza },
        accion_ruta: decidirRuta("DIRECCION_EN_VALIDACION", r.promesa.confianza, e.riesgo).accion,
        requiere_aprobacion: true,
        casos: [{ id: c.id, tipo: c.tipo }],
      };
    }

    if (a.tipo === "fecha") {
      if (!a.nueva_fecha) return { ok: false, error: "Falta nueva_fecha (YYYY-MM-DD)" };
      if (a.nueva_fecha <= hoy) return { ok: false, error: "La nueva fecha debe ser posterior a hoy" };
      const { count } = await supabaseServer().from("promesas").select("id", { count: "exact", head: true }).eq("envio_id", ctx.envio_id).eq("estado", "REPROGRAMADO");
      const problemas: string[] = [];
      if (diaSemana(a.nueva_fecha) === 0) problemas.push("domingo sin entregas");
      if (a.nueva_fecha > sumarDias(hoy, politica.max_dias_reprogramar)) problemas.push(`más de ${politica.max_dias_reprogramar} días`);
      if ((count || 0) >= politica.max_reprogramaciones) problemas.push(`ya tiene ${count} reprogramaciones`);
      if (problemas.length) {
        const c = await asegurarCaso({
          envio_id: ctx.envio_id,
          tipo: "reprogramacion",
          resumen: `Pide entrega el ${a.nueva_fecha}, fuera de política (${problemas.join(", ")}).`,
          recomendacion: `Aprobar solo si la tienda acepta. Al aprobar, la promesa pasa a REPROGRAMADO para el ${a.nueva_fecha}.`,
          datos: { estado_recomendado: "REPROGRAMADO", fecha_entrega: a.nueva_fecha },
          confianza: a.evidencia.tipo === "boton" ? 0.9 : 0.85,
          razonamiento: `La fecha pedida está fuera de la política de la tienda: ${problemas.join(", ")}.`,
        });
        return { ok: true, requiere_aprobacion: true, fuera_de_politica: problemas, resumen: `Reprogramación fuera de política → caso`, casos: [{ id: c.id, tipo: c.tipo }] };
      }
      return registrarIntencionImpl(
        { estado: "REPROGRAMADO", confianza: a.evidencia.tipo === "boton" ? 0.9 : 0.85, evidencia: a.evidencia, fecha_entrega: a.nueva_fecha, motivo: a.motivo },
        ctx.envio_id,
        "agente",
      );
    }

    // receptor
    if (!a.receptor?.nombre) return { ok: false, error: "Falta el nombre de quien recibe" };
    return registrarIntencionImpl(
      { estado: "CONFIRMADO_TERCERO", confianza: 0.8, evidencia: a.evidencia, receptor: a.receptor, preferencia_pago: "efectivo" },
      ctx.envio_id,
      "agente",
    );
  },
});

// ---------------------------------------------------------------------
// caso_escalar_a_humano
// ---------------------------------------------------------------------
const escalar = definir({
  nombre: "caso_escalar_a_humano",
  descripcion: "Pasa la conversación a una persona de Reflo con un resumen y una recomendación. Úsala con fraude, cliente molesto, pedido de hablar con una persona, o lo que no puedas resolver.",
  esquema: z.object({
    tipo: z.enum(["fraude", "cliente_molesto", "cod_alto", "tercero_cod", "cambio_direccion", "reprogramacion", "otro"]),
    resumen: z.string().min(5).max(600).describe("Resumen breve del caso para la persona"),
    recomendacion: z.string().max(300).optional().describe("Qué debería hacer la persona"),
    razonamiento: z.string().max(300).optional().describe("Por qué escalas (señales concretas de la conversación)"),
    confianza: z.number().min(0).max(1).optional().describe("Qué tan seguro estás del tipo de caso"),
  }),
  async ejecutar(a, ctx) {
    const c = await asegurarCaso({
      envio_id: ctx.envio_id,
      tipo: a.tipo,
      resumen: a.resumen,
      recomendacion: a.recomendacion ?? null,
      confianza: a.confianza ?? null,
      razonamiento: a.razonamiento ?? null,
      datos: { origen: ctx.componente },
    });
    return { ok: true, caso_id: c.id, nuevo: c.nuevo, resumen: `Caso ${a.tipo} ${c.nuevo ? "creado" : "ya estaba abierto"}`, casos: [{ id: c.id, tipo: c.tipo }] };
  },
});

// ---------------------------------------------------------------------
// pago_generar_link (dinero: el monto SIEMPRE sale de envios.cod_monto)
// ---------------------------------------------------------------------
const pagoLink = definir({
  nombre: "pago_generar_link",
  descripcion:
    "Genera un enlace de pago (Nequi, Daviplata, Bre-B o tarjeta) por el monto exacto del pedido, que el servidor toma de Waygo. No recibe monto. La promesa queda CONFIRMADO con preferencia 'link'; pasa a CONFIRMADO_PREPAGO solo cuando el pago se concilia.",
  esquema: z.object({ metodo: z.enum(["nequi", "daviplata", "bre_b", "tarjeta"]).optional() }),
  async ejecutar(a, ctx) {
    const e = await leerEnvio(ctx.envio_id);
    if (!e) return { ok: false, error: "envio_no_existe" };
    const monto = Number(e.cod_monto) || 0;
    if (!(e.es_cod !== false && monto > 0)) return { ok: false, error: "El pedido no tiene valor contra entrega pendiente" };
    const cfg = await leerConfig();
    const fecha = fechaEntregaManana(ahoraDemo(cfg));
    const ref = createHash("sha256").update(`${e.id}:${fecha}`).digest("hex").slice(0, 4).toUpperCase();
    const link = `https://pago.reflo.demo/BRB-${ref}`;
    const pv = await promesaVigente(ctx.envio_id);
    let version = pv?.version ?? null;
    if (pv?.estado !== "CONFIRMADO_PREPAGO") {
      const r = await registrarPromesa({
        envio_id: ctx.envio_id,
        estado: "CONFIRMADO",
        confianza: 0.8,
        fecha_entrega: fecha,
        franja_inicio: pv?.franja_inicio ?? null,
        franja_fin: pv?.franja_fin ?? null,
        preferencia_pago: "link",
        nota_mensajero: `Pago digital pendiente (${link.slice(-8)}). Si no paga antes del corte, cobrar ${formatoCOP(monto)} en efectivo.`,
        evidencia: { tipo: "sistema", cita: "pago_generar_link", link_pago: link, metodo: a.metodo ?? "nequi" },
        origen: "worker",
      });
      version = r.promesa.version;
    }
    return {
      ok: true,
      resumen: `Enlace ${link.slice(-8)} por ${formatoCOP(monto)} (monto de Waygo)`,
      link,
      referencia: `BRB-${ref}`,
      guia: e.tracking_number,
      monto,
      monto_texto: formatoCOP(monto),
      metodos: ["Nequi", "Daviplata", "Bre-B", "tarjeta"],
      expira: `${fecha} 08:00 (antes de salir a ruta)`,
      promesa: { version, estado: pv?.estado === "CONFIRMADO_PREPAGO" ? "CONFIRMADO_PREPAGO" : "CONFIRMADO", preferencia_pago: "link" },
    };
  },
});

// ---------------------------------------------------------------------
// politicas_buscar (lectura)
// ---------------------------------------------------------------------
const politicas = definir({
  nombre: "politicas_buscar",
  descripcion: "Busca las políticas de entrega y preguntas frecuentes de la tienda (reprogramación, pagos, cambios de dirección, terceros, devoluciones, quién es Reflo).",
  esquema: z.object({ pregunta: z.string().max(200).optional() }),
  async ejecutar(a, ctx) {
    const e = await leerEnvio(ctx.envio_id);
    const p = politicaDe(e?.tienda);
    return { ok: true, resumen: `Políticas de ${p.tienda}${a.pregunta ? ` · «${a.pregunta}»` : ""}`, politica: politicaComoTexto(p) };
  },
});

// ---------------------------------------------------------------------
// whatsapp_ofrecer_botones (UI: respuestas rápidas del mensaje del agente)
// ---------------------------------------------------------------------
const IDS_BOTONES = Object.keys(CATALOGO_BOTONES) as [string, ...string[]];
const botones = definir({
  nombre: "whatsapp_ofrecer_botones",
  descripcion:
    "Adjunta botones de respuesta rápida (máx. 3) a tu próximo mensaje. Franjas: franja_manana (8 am–12 m), franja_tarde (2–5 pm), franja_noche (5–8 pm). Otros: si_efectivo, pagar_digital, otra_fecha, confirmar_cancelacion, mantener_pedido, hablar_persona, cambiar_direccion.",
  esquema: z.object({ opciones: z.array(z.enum(IDS_BOTONES)).min(1).max(3) }),
  async ejecutar(a) {
    const lista = a.opciones.map((id) => CATALOGO_BOTONES[id]).filter(Boolean);
    return { ok: true, resumen: `Botones: ${lista.map((b) => b.titulo).join(" · ")}`, botones: lista };
  },
});

export const CATALOGO: Herramienta[] = [envioContexto, registrarIntencion, proponerCambio, escalar, pagoLink, politicas, botones] as unknown as Herramienta[];
