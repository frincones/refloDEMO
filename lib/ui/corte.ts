"use client";
import { descargar, textoError } from "./api";
import { toast } from "./toast";

/** Descarga el CSV de la lista de ruta del corte (GET /api/demo/corte/csv con x-admin-token). */
export async function exportarListaRuta(corte: { id: string; version: number; fecha: string } | null | undefined) {
  if (!corte) {
    toast("Aún no hay un corte congelado. Congélalo en Control del demo (paso 7).", "info");
    return;
  }
  try {
    await descargar(`/api/demo/corte/csv?corte_id=${encodeURIComponent(corte.id)}`, `lista_ruta_bogota-sur_${corte.fecha}_v${corte.version}.csv`);
    toast(`Lista de ruta exportada · corte v${corte.version}`);
  } catch (e) {
    toast(textoError(e), "error");
  }
}
