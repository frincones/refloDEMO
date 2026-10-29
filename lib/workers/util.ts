import "server-only";
import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { envOpcional } from "@/lib/env";

// Utilidades compartidas por workers, herramientas y agente: reloj de Bogotá, formato y configuración.

export const TZ = "America/Bogota";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Umbrales de negocio del demo (COP)
export const COD_ALTO = 400_000; // regla de riesgo y escalamiento de terceros
export const COD_ESCALAR = 1_000_000; // COD por encima del umbral con confianza baja → caso

export type ConfigDemo = { hora_simulada: string | null; agentes_pausados: boolean };

export async function leerConfig(): Promise<ConfigDemo> {
  const { data } = await supabaseServer().from("config_demo").select("hora_simulada, agentes_pausados").eq("id", 1).maybeSingle();
  return { hora_simulada: data?.hora_simulada ?? null, agentes_pausados: !!data?.agentes_pausados };
}

/** Hora actual del demo (config_demo.hora_simulada o la real). */
export function ahoraDemo(cfg?: Pick<ConfigDemo, "hora_simulada">): Date {
  return cfg?.hora_simulada ? new Date(cfg.hora_simulada) : new Date();
}

/** Fecha y hora "de pared" en Bogotá (UTC−5, sin horario de verano). */
export function partesBogota(d: Date) {
  const b = new Date(d.getTime() - 5 * 3600_000);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(), h: b.getUTCHours(), min: b.getUTCMinutes(), dow: b.getUTCDay() };
}

/** "YYYY-MM-DD" en Bogotá. */
export function fechaISO(d: Date): string {
  const p = partesBogota(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Suma días a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "jueves 30 de octubre" */
export function fechaLarga(fecha: string): string {
  const [, m, d] = fecha.split("-").map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}

/** Fecha de entrega por defecto: el siguiente día hábil (no domingo). */
export function fechaEntregaManana(ahora: Date): string {
  let f = sumarDias(fechaISO(ahora), 1);
  if (diaSemana(f) === 0) f = sumarDias(f, 1);
  return f;
}

/** Timestamp ISO para "YYYY-MM-DD" + "HH:MM" en Bogotá. */
export function instanteBogota(fecha: string, hhmm: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h + 5, mi || 0)).toISOString();
}

/** "HH:MM" en Bogotá de un timestamp ISO. */
export function horaBogota(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const p = partesBogota(new Date(iso));
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/** $189.900 */
export function formatoCOP(v: number | string | null | undefined): string {
  const n = Math.round(Number(v) || 0);
  return "$" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function primerNombre(nombre: string | null | undefined): string {
  return (nombre || "").trim().split(/\s+/)[0] || "";
}

/** "Cl 20 Sur # 30-10, Timiza, Bogotá" → "Cl 20 Sur # 30-10 (Timiza)" */
export function direccionCorta(direccion: string | null | undefined, zona?: string | null): string {
  const calle = (direccion || "").split(",")[0]?.trim() || "";
  return zona ? `${calle} (${zona})` : calle;
}

/** "+573001234567" → "***4567" */
export function telefonoEnmascarado(e164: string | null | undefined): string | null {
  if (!e164) return null;
  return `***${e164.slice(-4)}`;
}

/** Hora de corte (DEMO_CUTOFF_TIME, por defecto 20:00) */
export function horaCorte(): string {
  return envOpcional("DEMO_CUTOFF_TIME", "20:00");
}

/** Hash determinista 0–99 */
export function hash100(s: string): number {
  return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 100;
}

/** Ventana de contacto proactivo (Ley 2300, lectura conservadora): L–V 07–19, sábado 08–15, domingo nunca. */
export function enHorarioLegal(ahora: Date): boolean {
  const p = partesBogota(ahora);
  const min = p.h * 60 + p.min;
  if (p.dow === 0) return false;
  if (p.dow === 6) return min >= 8 * 60 && min < 15 * 60;
  return min >= 7 * 60 && min < 19 * 60;
}

/** Inserta varios eventos de una vez (feed). No lanza errores. */
export async function registrarEventos(eventos: Record<string, unknown>[]): Promise<void> {
  if (!eventos.length) return;
  const { error } = await supabaseServer().from("eventos").insert(eventos.map((e) => ({ nivel: "info", ...e })));
  if (error) console.error("[eventos] no se pudieron registrar:", error.message);
}
