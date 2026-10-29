import "server-only";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { TipoCaso } from "@/lib/contratos";

// Tipos y utilidades comunes de las herramientas MCP del demo.

/** Identidad de quien llama la herramienta (gateway: permisos por componente). */
export type Contexto = {
  componente: "agente_contacto" | "mcp_externo" | "humano" | "worker";
  /** El agente solo puede operar sobre el envío de su conversación: el envio_id lo pone el servidor, no el modelo. */
  envio_id: string;
  actor?: string;
};

export type Herramienta<S extends z.ZodType = z.ZodType> = {
  nombre: string;
  descripcion: string;
  esquema: S;
  ejecutar: (args: z.infer<S>, ctx: Contexto) => Promise<ResultadoHerramienta>;
};

export type ResultadoHerramienta = {
  ok: boolean;
  error?: string;
  /** Línea legible para el feed */
  resumen?: string;
  /** Casos creados como efecto (el chat emite un evento `caso` por cada uno) */
  casos?: { id: string; tipo: TipoCaso }[];
  [k: string]: unknown;
};

export function definir<S extends z.ZodType>(h: Herramienta<S>): Herramienta<S> {
  return h;
}

export type FilaEnvio = {
  id: string;
  waygo_shipment_id: string;
  tracking_number: string | null;
  order_number: string | null;
  tienda: string | null;
  comprador_nombre: string | null;
  telefono_e164: string | null;
  direccion: string | null;
  direccion_linea2: string | null;
  referencia: string | null;
  zona: string | null;
  ciudad: string | null;
  notas: string | null;
  es_cod: boolean | null;
  cod_monto: number | string | null;
  shipment_type_name: string | null;
  estado_buffer: string;
  riesgo: number | null;
  prioridad: number | null;
  grupo_control: boolean | null;
  waygo_status_name: string | null;
  waygo_fase: string | null;
  tracking_url: string | null;
  delivery_attempts: number | null;
};

export async function leerEnvio(id: string): Promise<FilaEnvio | null> {
  const { data } = await supabaseServer().from("envios").select("*").eq("id", id).maybeSingle();
  return (data as FilaEnvio) || null;
}

export async function promesaVigente(envioId: string) {
  const { data } = await supabaseServer().from("promesas").select("*").eq("envio_id", envioId).eq("vigente", true).maybeSingle();
  return data as null | {
    id: string;
    version: number;
    estado: string;
    confianza: number | null;
    fecha_entrega: string | null;
    franja_inicio: string | null;
    franja_fin: string | null;
    preferencia_pago: string | null;
    nota_mensajero: string | null;
    evidencia: Record<string, unknown> | null;
  };
}

/** Crea un caso, o devuelve el abierto del mismo tipo para ese envío (idempotente). */
export async function asegurarCaso(c: {
  envio_id: string;
  tipo: TipoCaso;
  resumen: string;
  recomendacion?: string | null;
  datos?: Record<string, unknown>;
  /** 0–1: qué tan seguro está quien escala de que el caso es del tipo indicado */
  confianza?: number | null;
  /** Por qué se escaló (una o dos frases para la persona) */
  razonamiento?: string | null;
}): Promise<{ id: string; tipo: TipoCaso; nuevo: boolean }> {
  const db = supabaseServer();
  const { data: existente } = await db
    .from("casos")
    .select("id, tipo")
    .eq("envio_id", c.envio_id)
    .eq("tipo", c.tipo)
    .in("estado", ["abierto", "tomado"])
    .limit(1)
    .maybeSingle();
  if (existente) return { id: existente.id, tipo: existente.tipo, nuevo: false };
  const { data, error } = await db
    .from("casos")
    .insert({
      envio_id: c.envio_id,
      tipo: c.tipo,
      resumen: c.resumen,
      recomendacion: c.recomendacion ?? null,
      datos: { confianza: c.confianza ?? null, razonamiento: c.razonamiento ?? null, ...(c.datos ?? {}) },
    })
    .select("id, tipo")
    .single();
  if (error) throw new Error(`casos: ${error.message}`);
  return { id: data.id, tipo: data.tipo, nuevo: true };
}

/** ¿Ya hay corte congelado hoy? (las promesas posteriores se marcan como tardías) */
export async function hayCorteHoy(fecha: string): Promise<boolean> {
  const { count } = await supabaseServer().from("cortes").select("id", { count: "exact", head: true }).eq("fecha", fecha);
  return (count || 0) > 0;
}
