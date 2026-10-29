import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { EstadoIntencion, Promesa } from "@/lib/contratos";
import { ahoraDemo, fechaISO, leerConfig } from "@/lib/workers/util";
import { hayCorteHoy } from "./comun";

// Escritura de promesas (historial versionado + bandera vigente) vía la función SQL registrar_promesa.

export type NuevaPromesa = {
  envio_id: string;
  estado: EstadoIntencion;
  confianza: number;
  fecha_entrega?: string | null;
  franja_inicio?: string | null; // timestamptz ISO
  franja_fin?: string | null;
  preferencia_pago?: string | null;
  nota_mensajero?: string | null;
  evidencia?: Record<string, unknown>;
  origen: "agente" | "humano" | "worker";
  version_base?: number | null;
  idem?: string | null;
};

export async function registrarPromesa(p: NuevaPromesa): Promise<{ promesa: Promesa; idempotente: boolean; version_anterior: number | null }> {
  const cfg = await leerConfig();
  const tardia = await hayCorteHoy(fechaISO(ahoraDemo(cfg)));
  const { data, error } = await supabaseServer().rpc("registrar_promesa", {
    p_envio_id: p.envio_id,
    p_estado: p.estado,
    p_confianza: Math.round(Math.min(Math.max(p.confianza, 0), 1) * 1000) / 1000,
    p_fecha_entrega: p.fecha_entrega ?? null,
    p_franja_inicio: p.franja_inicio ?? null,
    p_franja_fin: p.franja_fin ?? null,
    p_preferencia_pago: p.preferencia_pago ?? null,
    p_nota_mensajero: p.nota_mensajero ?? null,
    p_evidencia: { ...(p.evidencia || {}), ...(p.idem ? { idem: p.idem } : {}) },
    p_origen: p.origen,
    p_tardia: tardia,
    p_version_base: p.version_base ?? null,
    p_idem: p.idem ?? null,
  });
  if (error) throw new Error(`registrar_promesa: ${error.message}`);
  const r = data as { promesa: Promesa; idempotente: boolean; version_anterior: number | null };
  r.promesa.confianza = r.promesa.confianza === null ? null : Number(r.promesa.confianza);
  return r;
}
