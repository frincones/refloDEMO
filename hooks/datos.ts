"use client";
// Consultas de la consola (solo lectura, RLS) con recarga por Realtime.
import { useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { estadoVista } from "@/lib/ui/estados";
import type { Caso, ConfigDemo, Corte, Envio, EstadoVista, Evento, Mensaje, Promesa } from "@/lib/ui/tipos";
import { useConsulta } from "./useConsulta";

const sb = () => supabaseBrowser();

async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? ([] as unknown)) as T;
}

// ---------- config_demo ----------
export function useConfig() {
  return useConsulta<ConfigDemo | null>(
    "config",
    async () => {
      const { data } = await sb().from("config_demo").select("*").eq("id", 1).maybeSingle();
      return (data as ConfigDemo) ?? null;
    },
    ["config_demo"],
  );
}

// ---------- casos ----------
export function useCasos() {
  return useConsulta<Caso[]>("casos", () => q<Caso[]>(sb().from("casos").select("*").order("created_at", { ascending: false })), ["casos"]);
}

export function useCasosAbiertos(): number {
  const { datos } = useConsulta<number>(
    "casos-abiertos",
    async () => {
      const { data } = await sb().from("casos").select("id").eq("estado", "abierto");
      return data?.length ?? 0;
    },
    ["casos"],
  );
  return datos ?? 0;
}

// ---------- eventos ----------
export function useEventos(limite = 120, envioId?: string) {
  return useConsulta<Evento[]>(
    `eventos-${envioId || "todos"}`,
    () => {
      let c = sb().from("eventos").select("*").order("created_at", { ascending: false }).limit(limite);
      if (envioId) c = c.eq("envio_id", envioId);
      return q<Evento[]>(c);
    },
    [envioId ? { tabla: "eventos", filtro: `envio_id=eq.${envioId}` } : "eventos"],
    { espera: 150 },
  );
}

// ---------- cortes ----------
export function useUltimoCorte() {
  return useConsulta<Corte | null>(
    "corte",
    async () => {
      const { data } = await sb().from("cortes").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return (data as Corte) ?? null;
    },
    // cortes no está en la publicación Realtime: se refresca con los eventos del gestor de corte
    ["eventos"],
    { espera: 800 },
  );
}

// ---------- buffer: envíos + promesa vigente + último mensaje + caso abierto ----------
export type FilaBuffer = {
  envio: Envio;
  promesa: Promesa | null;
  estado: EstadoVista;
  ultimoMensaje: Pick<Mensaje, "rol" | "canal" | "created_at" | "texto"> | null;
  ultimoAgente: string | null;
  nMensajes: number;
  casoAbierto: Caso | null;
};

type DatosBuffer = { envios: Envio[]; promesas: Promesa[]; mensajes: Pick<Mensaje, "envio_id" | "rol" | "canal" | "created_at" | "texto">[]; casos: Caso[] };

export function useBuffer() {
  const r = useConsulta<DatosBuffer>(
    "buffer",
    async () => {
      const [envios, promesas, mensajes, casos] = await Promise.all([
        q<Envio[]>(sb().from("envios").select("*").order("tracking_number", { ascending: true })),
        q<Promesa[]>(sb().from("promesas").select("*").eq("vigente", true)),
        q<DatosBuffer["mensajes"]>(sb().from("mensajes").select("envio_id, rol, canal, created_at, texto").order("created_at", { ascending: true }).limit(5000)),
        q<Caso[]>(sb().from("casos").select("*").eq("estado", "abierto")),
      ]);
      return { envios, promesas, mensajes, casos };
    },
    ["envios", "promesas", "mensajes", "casos"],
    { espera: 300 },
  );

  const filas = useMemo<FilaBuffer[] | null>(() => {
    if (!r.datos) return null;
    const { envios, promesas, mensajes, casos } = r.datos;
    const pm = new Map(promesas.map((p) => [p.envio_id, p]));
    const cm = new Map(casos.map((c) => [c.envio_id, c]));
    const ult = new Map<string, DatosBuffer["mensajes"][number]>();
    const ultAg = new Map<string, string>();
    const cnt = new Map<string, number>();
    for (const m of mensajes) {
      ult.set(m.envio_id, m);
      cnt.set(m.envio_id, (cnt.get(m.envio_id) || 0) + 1);
      if (m.rol === "agente") ultAg.set(m.envio_id, m.created_at);
    }
    return envios.map((e) => {
      const um = ult.get(e.id) ?? null;
      return {
        envio: e,
        promesa: pm.get(e.id) ?? null,
        estado: estadoVista(e, ultAg.has(e.id)),
        ultimoMensaje: um,
        ultimoAgente: ultAg.get(e.id) ?? null,
        nMensajes: cnt.get(e.id) || 0,
        casoAbierto: cm.get(e.id) ?? null,
      };
    });
  }, [r.datos]);

  return { filas, error: r.error, actualizado: r.actualizado, recargar: r.recargar };
}

// ---------- un envío ----------
export type DatosEnvio = { envio: Envio | null; promesas: Promesa[]; mensajes: Mensaje[]; casos: Caso[] };

export function useEnvio(id: string | null) {
  return useConsulta<DatosEnvio>(
    `envio-${id}`,
    async () => {
      if (!id) return { envio: null, promesas: [], mensajes: [], casos: [] };
      const [envio, promesas, mensajes, casos] = await Promise.all([
        sb().from("envios").select("*").eq("id", id).maybeSingle().then((x) => (x.data as Envio) ?? null),
        q<Promesa[]>(sb().from("promesas").select("*").eq("envio_id", id).order("version", { ascending: false })),
        q<Mensaje[]>(sb().from("mensajes").select("*").eq("envio_id", id).order("created_at", { ascending: true })),
        q<Caso[]>(sb().from("casos").select("*").eq("envio_id", id).order("created_at", { ascending: false })),
      ]);
      return { envio, promesas, mensajes, casos };
    },
    id
      ? [
          { tabla: "envios", filtro: `id=eq.${id}` },
          { tabla: "promesas", filtro: `envio_id=eq.${id}` },
          { tabla: "mensajes", filtro: `envio_id=eq.${id}` },
          { tabla: "casos", filtro: `envio_id=eq.${id}` },
        ]
      : [],
    { activo: !!id, espera: 120 },
  );
}
