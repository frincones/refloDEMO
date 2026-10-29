import "server-only";
import type { StatusSummary, WaygoClient } from "./client";

// Mapeo de estados de Waygo POR BANDERAS de GET /v1/catalogs/statuses (nunca por el código:
// cada operación configura sus propios códigos).

export type FaseWaygo =
  | "creado" //        is_initial
  | "en_proceso" //    ni inicial ni final, sin novedad ni devolución (en bodega, en ruta, …)
  | "novedad" //       is_novelty (visita fallida, outcome failed_attempt)
  | "devolucion" //    is_return y no final
  | "entregado" //     final, outcome delivered
  | "cancelado" //     final, outcome cancelled
  | "devuelto" //      final, outcome returned
  | "perdido" //       final, outcome lost
  | "abandonado" //    final, outcome abandoned
  | "final" //         final sin outcome conocido
  | "desconocido"; //  el código no está en el catálogo

export type EstadoMapeado = {
  code: string;
  name: string | null;
  is_initial: boolean | null;
  is_final: boolean | null;
  is_novelty: boolean | null;
  is_return: boolean | null;
  outcome: string | null;
  fase: FaseWaygo;
};

/** Decide la fase solo con las banderas del catálogo. */
export function mapearEstado(code: string, catalogo: StatusSummary[]): EstadoMapeado {
  const s = catalogo.find((x) => x.code === code);
  if (!s) return { code, name: null, is_initial: null, is_final: null, is_novelty: null, is_return: null, outcome: null, fase: "desconocido" };
  let fase: FaseWaygo;
  if (s.is_novelty) fase = "novedad";
  else if (s.is_final) {
    fase =
      s.outcome === "delivered"
        ? "entregado"
        : s.outcome === "cancelled"
          ? "cancelado"
          : s.outcome === "returned"
            ? "devuelto"
            : s.outcome === "lost"
              ? "perdido"
              : s.outcome === "abandoned"
                ? "abandonado"
                : "final";
  } else if (s.is_return) fase = "devolucion";
  else if (s.is_initial) fase = "creado";
  else fase = "en_proceso";
  return {
    code: s.code,
    name: s.name,
    is_initial: s.is_initial,
    is_final: s.is_final,
    is_novelty: s.is_novelty,
    is_return: s.is_return,
    outcome: s.outcome ?? null,
    fase,
  };
}

let cache: { t: number; lista: StatusSummary[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** Catálogo de estados con caché de 5 min por proceso. */
export async function catalogoEstados(cliente: WaygoClient, forzar = false): Promise<StatusSummary[]> {
  if (!forzar && cache && Date.now() - cache.t < TTL_MS) return cache.lista;
  const lista = await cliente.getCatalog("statuses");
  cache = { t: Date.now(), lista };
  return lista;
}

/** Igual que mapearEstado, pero refresca el catálogo una vez si el código no aparece. */
export async function mapearEstadoCon(cliente: WaygoClient, code: string): Promise<EstadoMapeado> {
  let m = mapearEstado(code, await catalogoEstados(cliente));
  if (m.fase === "desconocido") m = mapearEstado(code, await catalogoEstados(cliente, true));
  return m;
}
