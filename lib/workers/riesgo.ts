import "server-only";
import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { registrarEvento } from "@/lib/ingesta/envios";
import { envOpcional } from "@/lib/env";
import { COD_ALTO, ahoraDemo, horaCorte, leerConfig, partesBogota, registrarEventos } from "./util";

// Analista de riesgo + sorteo del grupo de control (Fase 4).
// P = R × M × U  (arquitectura §2.3)
//   R: riesgo 0–1 por reglas (COD alto, mismo teléfono con varios pedidos, pedido de madrugada)
//   M = 1 + min(cod / COD_p90, 2)
//   U = 1 + 2 × (1 − horas_al_corte / horas_de_ventana)   (ventana de contacto 07:00 → corte)

type FilaEnvio = {
  id: string;
  waygo_shipment_id: string;
  tracking_number: string | null;
  telefono_e164: string | null;
  cod_monto: number | string | null;
  waygo_created_at: string | null;
  riesgo: number | null;
  grupo_control: boolean | null;
  estado_buffer: string;
  waygo_is_final: boolean | null;
};

export type ResultadoRiesgo = { riesgo: number; motivos: string[] };

const BASE = 0.15;

function hashOrden(s: string): number {
  return parseInt(createHash("sha256").update(`control:${s}`).digest("hex").slice(0, 12), 16);
}

export function calcularRiesgo(e: Pick<FilaEnvio, "cod_monto" | "waygo_created_at" | "telefono_e164">, pedidosMismoTelefono: number): ResultadoRiesgo {
  let r = BASE;
  const motivos: string[] = [];
  if (Number(e.cod_monto) >= COD_ALTO) {
    r += 0.4;
    motivos.push("cod_alto");
  }
  if (pedidosMismoTelefono > 1) {
    r += 0.3;
    motivos.push("mismo_telefono_varios_pedidos");
  }
  if (e.waygo_created_at) {
    const h = partesBogota(new Date(e.waygo_created_at)).h;
    if (h >= 0 && h < 6) {
      r += 0.25;
      motivos.push("pedido_de_madrugada");
    }
  }
  return { riesgo: Math.round(Math.min(r, 1) * 1000) / 1000, motivos };
}

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 1;
  const v = [...valores].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1));
  return v[i] || 1;
}

/** U según la hora del demo y la hora de corte. */
export function urgencia(ahora: Date): number {
  const [hc, mc] = horaCorte().split(":").map(Number);
  const corteMin = hc * 60 + (mc || 0);
  const p = partesBogota(ahora);
  const ahoraMin = p.h * 60 + p.min;
  const ventana = corteMin - 7 * 60; // de 07:00 al corte
  let faltan = corteMin - ahoraMin;
  if (faltan < 0) faltan += 24 * 60; // después del corte: el siguiente
  const frac = Math.min(Math.max(faltan / ventana, 0), 1);
  return Math.round((1 + 2 * (1 - frac)) * 1000) / 1000;
}

/** Calcula riesgo/prioridad de todos los envíos activos y sortea el control de los que no lo tienen. */
export async function preparar(opciones: { todos?: boolean } = {}): Promise<{ procesados: number; grupo_control: number }> {
  const db = supabaseServer();
  const cfg = await leerConfig();
  const ahora = ahoraDemo(cfg);
  const { data, error } = await db
    .from("envios")
    .select("id, waygo_shipment_id, tracking_number, telefono_e164, cod_monto, waygo_created_at, riesgo, grupo_control, estado_buffer, waygo_is_final");
  if (error) throw new Error(`preparar: ${error.message}`);
  const envios = (data || []) as FilaEnvio[];
  const porTelefono = new Map<string, number>();
  for (const e of envios) if (e.telefono_e164) porTelefono.set(e.telefono_e164, (porTelefono.get(e.telefono_e164) || 0) + 1);
  const p90 = percentil(envios.map((e) => Number(e.cod_monto) || 0).filter((x) => x > 0), 0.9);
  const U = urgencia(ahora);
  const pct = Math.min(Math.max(Number(envOpcional("DEMO_CONTROL_GROUP_PCT", "7")) || 0, 0), 100);

  // Sorteo determinista: se ordenan los envíos sin sortear por hash de su id y se toman los primeros
  // hasta completar la cuota round(total × pct) (mínimo 1 cuando hay 10 o más envíos).
  const yaControl = envios.filter((e) => e.grupo_control === true).length;
  const sinSortear = envios.filter((e) => e.grupo_control === null);
  const cuota = pct > 0 ? Math.max(envios.length >= 10 ? 1 : 0, Math.round((envios.length * pct) / 100)) : 0;
  const faltan = Math.max(cuota - yaControl, 0);
  const elegidos = new Set(
    sinSortear
      .map((e) => ({ id: e.id, h: hashOrden(e.waygo_shipment_id || e.id) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, faltan)
      .map((x) => x.id),
  );

  let procesados = 0;
  let control = 0;
  const eventos: Record<string, unknown>[] = [];
  for (const e of envios) {
    const faltaRiesgo = e.riesgo === null || opciones.todos;
    const faltaControl = e.grupo_control === null;
    if (!faltaRiesgo && !faltaControl) continue;
    const { riesgo, motivos } = calcularRiesgo(e, e.telefono_e164 ? porTelefono.get(e.telefono_e164) || 0 : 0);
    const M = 1 + Math.min((Number(e.cod_monto) || 0) / p90, 2);
    const prioridad = Math.round(riesgo * M * U * 10000) / 10000;
    const cambios: Record<string, unknown> = { riesgo, prioridad, riesgo_motivos: { motivos, R: riesgo, M: Math.round(M * 1000) / 1000, U, cod_p90: p90 } };
    if (faltaControl) {
      const esControl = elegidos.has(e.id);
      cambios.grupo_control = esControl;
      // Solo los estados "del validador" pasan a GRUPO_CONTROL; NUMERO_INVALIDO se queda como está
      if (esControl && e.estado_buffer === "PENDIENTE_CONTACTO") cambios.estado_buffer = "GRUPO_CONTROL";
      if (esControl) control += 1;
    }
    const { error: eu } = await db.from("envios").update(cambios).eq("id", e.id);
    if (eu) throw new Error(`preparar (update): ${eu.message}`);
    procesados += 1;
    eventos.push({
      componente: "riesgo",
      herramienta: "riesgo_calcular",
      envio_id: e.id,
      entrada: { cod_monto: Number(e.cod_monto) || 0, creado: e.waygo_created_at },
      resultado: { riesgo, prioridad, motivos, grupo_control: cambios.grupo_control ?? e.grupo_control },
      nivel: "info",
      mensaje: `Riesgo ${riesgo.toFixed(2)} · P ${prioridad.toFixed(2)}${motivos.length ? ` (${motivos.join(", ")})` : ""}${cambios.grupo_control ? " · GRUPO DE CONTROL" : ""} · ${e.tracking_number || ""}`,
    });
  }
  await registrarEventos(eventos);
  await registrarEvento({
    componente: "riesgo",
    herramienta: "preparar",
    resultado: { procesados, grupo_control: control, U, cod_p90: p90, pct_control: pct },
    nivel: "ok",
    mensaje: `Analista de riesgo: ${procesados} envíos puntuados, ${control} al grupo de control`,
  });
  return { procesados, grupo_control: control };
}
