import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento } from "@/lib/ingesta/envios";
import type { CorteRespuesta, EstadoIntencion, ItemCorte } from "@/lib/contratos";
import { decidirRuta } from "./reglas";
import { ahoraDemo, fechaISO, horaBogota, leerConfig, partesBogota, registrarEventos } from "./util";

// Gestor de corte (Fase 4): congela el buffer en un snapshot versionado, aplica las reglas y publica la lista de ruta.
// Es código, no IA: la decisión de ruta es repetible y auditable.

const ORDEN_ACCION = { INCLUIR: 0, INCLUIR_BAJA_PRIORIDAD: 1, RETENER: 2, EXCLUIR: 3 } as const;

type FilaEnvio = {
  id: string;
  tracking_number: string | null;
  comprador_nombre: string | null;
  zona: string | null;
  cod_monto: number | string | null;
  estado_buffer: EstadoIntencion;
  riesgo: number | null;
  prioridad: number | null;
  grupo_control: boolean | null;
  waygo_is_final: boolean | null;
};

type FilaPromesa = {
  envio_id: string;
  version: number;
  estado: EstadoIntencion;
  confianza: number | null;
  franja_inicio: string | null;
  franja_fin: string | null;
  nota_mensajero: string | null;
  preferencia_pago: string | null;
  fecha_entrega: string | null;
};

export async function congelarCorte(): Promise<CorteRespuesta> {
  const db = supabaseServer();
  const cfg = await leerConfig();
  const ahora = ahoraDemo(cfg);
  const fecha = fechaISO(ahora);
  const p = partesBogota(ahora);
  const hora = `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;

  const { data: envData, error } = await db
    .from("envios")
    .select("id, tracking_number, comprador_nombre, zona, cod_monto, estado_buffer, riesgo, prioridad, grupo_control, waygo_is_final")
    .or("waygo_is_final.is.null,waygo_is_final.eq.false");
  if (error) throw new Error(`corte: ${error.message}`);
  const envios = (envData || []) as FilaEnvio[];

  // 1) Cadencia agotada: quien no respondió queda NO_CONTACTADO (nueva versión de su promesa, origen worker)
  const sinRespuesta = envios.filter((e) => e.estado_buffer === "CONTACTANDO" || (e.estado_buffer === "PENDIENTE_CONTACTO" && !e.grupo_control));
  for (const e of sinRespuesta) {
    const { error: er } = await db.rpc("registrar_promesa", {
      p_envio_id: e.id,
      p_estado: "NO_CONTACTADO",
      p_confianza: 0,
      p_evidencia: { tipo: "corte", detalle: "Sin respuesta al corte: cadencia agotada" },
      p_origen: "worker",
    });
    if (er) throw new Error(`corte (no_contactado): ${er.message}`);
    e.estado_buffer = "NO_CONTACTADO";
  }

  // 2) Promesas vigentes
  const { data: promData } = await db
    .from("promesas")
    .select("envio_id, version, estado, confianza, franja_inicio, franja_fin, nota_mensajero, preferencia_pago, fecha_entrega")
    .eq("vigente", true)
    .in("envio_id", envios.map((e) => e.id));
  const promesas = new Map<string, FilaPromesa>((promData || []).map((x) => [x.envio_id, x as FilaPromesa]));

  // 3) Reglas
  const items: (ItemCorte & { prioridad: number; promesa_version: number | null; confianza: number | null; riesgo: number | null })[] = envios.map((e) => {
    const pr = promesas.get(e.id);
    const estado = e.estado_buffer;
    const d = decidirRuta(estado, pr?.confianza ?? null, e.riesgo);
    const franja = pr?.franja_inicio && pr?.franja_fin ? `${horaBogota(pr.franja_inicio)}–${horaBogota(pr.franja_fin)}` : null;
    const notas = [d.nota, pr?.nota_mensajero && pr.nota_mensajero !== d.nota ? pr.nota_mensajero : null, franja && d.accion !== "EXCLUIR" ? `Entregar entre ${franja}` : null].filter(Boolean);
    return {
      envio_id: e.id,
      guia: e.tracking_number,
      comprador: e.comprador_nombre,
      zona: e.zona,
      cod_monto: e.cod_monto === null ? null : Number(e.cod_monto),
      estado,
      accion: d.accion,
      franja,
      nota: notas.length ? notas.join(" · ") : null,
      prioridad: Number(e.prioridad) || 0,
      promesa_version: pr?.version ?? null,
      confianza: pr?.confianza === undefined || pr?.confianza === null ? null : Number(pr.confianza),
      riesgo: e.riesgo === null ? null : Number(e.riesgo),
    };
  });
  items.sort((a, b) => ORDEN_ACCION[a.accion] - ORDEN_ACCION[b.accion] || b.prioridad - a.prioridad);

  const resumen = {
    incluir: items.filter((i) => i.accion === "INCLUIR").length,
    baja: items.filter((i) => i.accion === "INCLUIR_BAJA_PRIORIDAD").length,
    retener: items.filter((i) => i.accion === "RETENER").length,
    excluir: items.filter((i) => i.accion === "EXCLUIR").length,
  };

  const itemsPublicos: ItemCorte[] = items.map(({ envio_id, guia, comprador, zona, cod_monto, estado, accion, franja, nota }) => ({ envio_id, guia, comprador, zona, cod_monto, estado, accion, franja, nota }));

  // 4) Snapshot inmutable versionado. snapshot = exactamente la respuesta de POST /api/demo/corte
  //    (reintenta si otra petición tomó la misma versión)
  let respuesta: CorteRespuesta | null = null;
  for (let intento = 0; intento < 3 && !respuesta; intento++) {
    const { data: ult } = await db.from("cortes").select("version").eq("fecha", fecha).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (ult?.version || 0) + 1;
    const id = randomUUID();
    const snapshot: CorteRespuesta = { corte_id: id, version, fecha, hora, resumen, items: itemsPublicos };
    const { error: ei } = await db.from("cortes").insert({ id, fecha, hora, version, snapshot });
    if (!ei) respuesta = snapshot;
    else if (!/duplicate|unique/i.test(ei.message)) throw new Error(`corte (snapshot): ${ei.message}`);
  }
  if (!respuesta) throw new Error("corte: no se pudo asignar versión");
  const corte = { id: respuesta.corte_id, version: respuesta.version };

  await registrarEventos(
    sinRespuesta.map((e) => ({
      componente: "corte",
      herramienta: "corte_congelar",
      envio_id: e.id,
      resultado: { estado: "NO_CONTACTADO" },
      nivel: "aviso",
      mensaje: `Sin respuesta al corte → NO_CONTACTADO · ${e.tracking_number || ""}`,
    })),
  );
  await registrarEvento({
    componente: "corte",
    herramienta: "corte_congelar",
    entrada: { fecha, hora },
    resultado: { corte_id: corte.id, version: corte.version, resumen },
    nivel: "ok",
    mensaje: `Corte v${corte.version} congelado: ${resumen.incluir} incluir, ${resumen.baja} baja prioridad, ${resumen.retener} retener, ${resumen.excluir} excluir`,
  });

  return respuesta;
}

function celda(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Lista de ruta en CSV (UTF-8 con BOM para que Excel respete las tildes). Sin corte_id = último corte. */
export async function corteCsv(corteId?: string | null): Promise<{ nombre: string; csv: string } | null> {
  const db = supabaseServer();
  const q = db.from("cortes").select("id, fecha, version, snapshot");
  const { data } = corteId ? await q.eq("id", corteId).maybeSingle() : await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const items = ((data.snapshot as { items?: ItemCorte[] })?.items || []) as ItemCorte[];
  const cab = ["guia", "comprador", "zona", "cod_monto", "estado", "accion", "franja", "nota", "envio_id"];
  const filas = items.map((i) => [i.guia, i.comprador, i.zona, i.cod_monto, i.estado, i.accion, i.franja, i.nota, i.envio_id].map(celda).join(","));
  return { nombre: `lista_ruta_${data.fecha}_v${data.version}.csv`, csv: "﻿" + [cab.join(","), ...filas].join("\r\n") + "\r\n" };
}
