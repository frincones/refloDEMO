import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento, upsertEnvio } from "@/lib/ingesta/envios";
import { waygo, type ShipmentSummary } from "@/lib/waygo/client";
import { sembrarEmulador } from "@/lib/waygo-emu/seed";
import { envOpcional } from "@/lib/env";
import type { Caso, Promesa, ResetRespuesta } from "@/lib/contratos";
import { registrarPromesa } from "@/lib/herramientas/promesa";
import { leerEnvio, promesaVigente } from "@/lib/herramientas/comun";
import { preparar } from "./riesgo";
import { ahoraDemo, fechaEntregaManana, formatoCOP, leerConfig, primerNombre } from "./util";

// Workers de operación del demo: pago conciliado (Cobro COD), interruptor de apagado, reinicio y resolución de casos.

export class ErrorNegocio extends Error {
  constructor(
    public status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Simula el webhook de la pasarela: pago recibido → CONFIRMADO_PREPAGO (nueva versión) + mensaje al comprador. */
export async function confirmarPago(envioId: string): Promise<Promesa> {
  const e = await leerEnvio(envioId);
  if (!e) throw new ErrorNegocio(404, "envio_no_existe");
  const monto = Number(e.cod_monto) || 0;
  const pv = await promesaVigente(envioId);
  const link = (pv?.evidencia as { link_pago?: string } | null)?.link_pago ?? null;
  const cfg = await leerConfig();
  const r = await registrarPromesa({
    envio_id: envioId,
    estado: "CONFIRMADO_PREPAGO",
    confianza: 0.95,
    fecha_entrega: pv?.fecha_entrega || fechaEntregaManana(ahoraDemo(cfg)),
    franja_inicio: pv?.franja_inicio ?? null,
    franja_fin: pv?.franja_fin ?? null,
    preferencia_pago: "prepago",
    nota_mensajero: "PAGADO, no cobrar",
    evidencia: { tipo: "sistema", cita: "webhook PSP: pago aprobado", link_pago: link, monto },
    origen: "worker",
  });
  if (!r.idempotente) {
    await supabaseServer()
      .from("mensajes")
      .insert({
        envio_id: envioId,
        rol: "agente",
        texto: `✅ Pago recibido por ${formatoCOP(monto)}, ${primerNombre(e.comprador_nombre)}. Tu pedido de ${e.tienda || "la tienda"} llega mañana y el mensajero no te cobrará nada. ¡Gracias!`,
        metadatos: { tipo: "pago_confirmado", origen: "cobro_cod", link_pago: link },
      });
  }
  await registrarEvento({
    componente: "cobro_cod",
    herramienta: "pago_estado",
    envio_id: envioId,
    entrada: { link_pago: link },
    resultado: { estado: "CONFIRMADO_PREPAGO", version: r.promesa.version, monto, idempotente: r.idempotente },
    nivel: "ok",
    mensaje: `Pago conciliado por ${formatoCOP(monto)} → CONFIRMADO_PREPAGO v${r.promesa.version} · ${e.tracking_number || ""}`,
  });
  return r.promesa;
}

/** Interruptor de apagado global de los agentes. */
export async function fijarPausa(pausado: boolean): Promise<{ pausado: boolean }> {
  const { error } = await supabaseServer().from("config_demo").update({ agentes_pausados: pausado }).eq("id", 1);
  if (error) throw new Error(`config_demo: ${error.message}`);
  await registrarEvento({
    componente: "control",
    herramienta: "KILL_SWITCH",
    entrada: { pausado },
    resultado: { agentes_pausados: pausado },
    nivel: pausado ? "aviso" : "ok",
    mensaje: pausado ? "Interruptor de apagado: agentes EN PAUSA. Waygo sigue operando como hoy." : "Interruptor de apagado: agentes reactivados",
  });
  return { pausado };
}

/** Reinicio completo: reset_demo() + (re)siembra del emulador + sync desde Waygo + preparar. */
export async function reiniciarDemo(opciones: { resembrar?: boolean } = {}): Promise<ResetRespuesta> {
  const db = supabaseServer();
  const { error } = await db.rpc("reset_demo");
  if (error) throw new Error(`reset_demo: ${error.message}`);

  let sembrado = false;
  const esEmulador = envOpcional("WAYGO_TARGET", "emulador") === "emulador";
  if (esEmulador && opciones.resembrar !== false) {
    await sembrarEmulador({ resetear: true });
    sembrado = true;
  }

  const cliente = waygo();
  const resumenes: ShipmentSummary[] = [];
  let pagina = 1;
  let total = 1;
  do {
    const r = await cliente.listShipments({ page: pagina, page_size: 100 });
    resumenes.push(...(r.data || []));
    total = r.meta.total_pages;
    pagina += 1;
  } while (pagina <= total && pagina <= 5);

  let sincronizados = 0;
  // En paralelo de a 4 (el cliente ya limita a 4 req/s)
  for (let i = 0; i < resumenes.length; i += 4) {
    const lote = resumenes.slice(i, i + 4);
    const res = await Promise.allSettled(lote.map(async (s) => upsertEnvio(cliente, await cliente.getShipment(s.id), { fuente: "sync" })));
    sincronizados += res.filter((x) => x.status === "fulfilled").length;
  }
  const prep = await preparar();
  await registrarEvento({
    componente: "control",
    herramienta: "reset",
    resultado: { emulador_sembrado: sembrado, sincronizados, ...prep },
    nivel: "ok",
    mensaje: `Demo reiniciado: ${sincronizados} envíos sincronizados desde Waygo, ${prep.grupo_control} en grupo de control`,
  });
  return { emulador_sembrado: sembrado, sincronizados, procesados: prep.procesados, grupo_control: prep.grupo_control };
}

/** Decisión humana sobre un caso de la bandeja de excepciones. */
export async function resolverCaso(id: string, accion: "aprobar" | "rechazar" | "tomar" | "devolver", nota?: string): Promise<Caso> {
  const db = supabaseServer();
  const { data: caso } = await db.from("casos").select("*").eq("id", id).maybeSingle();
  if (!caso) throw new ErrorNegocio(404, "caso_no_existe");
  const datos = (caso.datos || {}) as Record<string, unknown>;
  const ahora = new Date().toISOString();
  let estado: Caso["estado"];
  let efecto: Record<string, unknown> = {};

  if (accion === "aprobar") {
    if (!["abierto", "tomado"].includes(caso.estado)) throw new ErrorNegocio(409, `caso_ya_resuelto (${caso.estado})`);
    estado = "aprobado";
    const recomendado = datos.estado_recomendado as string | undefined;
    const pv = await promesaVigente(caso.envio_id);
    if (recomendado === "CONFIRMADO" || caso.tipo === "cambio_direccion") {
      const r = await registrarPromesa({
        envio_id: caso.envio_id,
        estado: "CONFIRMADO",
        confianza: 0.9,
        fecha_entrega: pv?.fecha_entrega ?? null,
        franja_inicio: pv?.franja_inicio ?? null,
        franja_fin: pv?.franja_fin ?? null,
        preferencia_pago: pv?.preferencia_pago ?? null,
        nota_mensajero: datos.nueva_direccion ? `Dirección validada: ${datos.nueva_direccion}` : pv?.nota_mensajero ?? null,
        evidencia: { tipo: "humano", cita: nota || "Aprobado en la bandeja de excepciones", caso_id: id },
        origen: "humano",
      });
      efecto = { estado: "CONFIRMADO", version: r.promesa.version };
    } else if (recomendado === "REPROGRAMADO" && datos.fecha_entrega) {
      const r = await registrarPromesa({
        envio_id: caso.envio_id,
        estado: "REPROGRAMADO",
        confianza: 0.9,
        fecha_entrega: String(datos.fecha_entrega),
        evidencia: { tipo: "humano", cita: nota || "Reprogramación aprobada", caso_id: id },
        origen: "humano",
      });
      efecto = { estado: "REPROGRAMADO", version: r.promesa.version };
    } else if (caso.tipo === "fraude") {
      // Aprobar la recomendación de fraude = mantener retenido (RIESGO_FRAUDE) hasta que la tienda valide
      if (pv?.estado !== "RIESGO_FRAUDE") {
        const r = await registrarPromesa({ envio_id: caso.envio_id, estado: "RIESGO_FRAUDE", confianza: 0.9, evidencia: { tipo: "humano", cita: nota || "Fraude confirmado", caso_id: id }, origen: "humano" });
        efecto = { estado: "RIESGO_FRAUDE", version: r.promesa.version };
      } else efecto = { estado: "RIESGO_FRAUDE", sin_cambio: true };
    } else {
      efecto = { sin_cambio_de_promesa: true };
    }
  } else if (accion === "rechazar") {
    if (!["abierto", "tomado"].includes(caso.estado)) throw new ErrorNegocio(409, `caso_ya_resuelto (${caso.estado})`);
    estado = "rechazado";
  } else if (accion === "tomar") {
    estado = "tomado";
    efecto = { agente_silenciado: true };
  } else {
    // devolver: la persona devuelve la conversación al agente
    if (caso.estado !== "tomado") throw new ErrorNegocio(409, "caso_no_tomado");
    estado = "cerrado";
    efecto = { agente_silenciado: false };
  }

  const { data: act, error } = await db
    .from("casos")
    .update({
      estado,
      resuelto_por: "persona_reflo",
      resuelto_at: accion === "tomar" ? null : ahora,
      datos: { ...datos, decision: { accion, nota: nota ?? null, efecto, at: ahora } },
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`casos: ${error.message}`);
  if (accion === "tomar" || accion === "devolver") {
    await db.from("mensajes").insert({
      envio_id: caso.envio_id,
      rol: "sistema",
      texto: accion === "tomar" ? "Una persona del equipo de Reflo tomó la conversación." : "La persona devolvió la conversación al asistente virtual.",
      metadatos: { tipo: accion === "tomar" ? "conversacion_tomada" : "conversacion_devuelta", caso_id: id },
    });
  }
  await registrarEvento({
    componente: "humano",
    herramienta: `caso_${accion}`,
    envio_id: caso.envio_id,
    entrada: { caso_id: id, accion, nota: nota ?? null },
    resultado: { estado, efecto },
    nivel: "ok",
    mensaje: `Persona: ${accion} caso ${caso.tipo}${efecto.estado ? ` → ${efecto.estado}` : ""}${accion === "tomar" ? " (agente en silencio para este envío)" : ""}`,
  });
  return act as Caso;
}
