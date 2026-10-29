"use client";
// Lectura con el cliente publishable + recarga automática por Realtime (postgres_changes).
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

let canalN = 0;

export type Suscripcion = { tabla: string; filtro?: string };

export function useConsulta<T>(
  clave: string,
  cargar: () => Promise<T>,
  suscripciones: (string | Suscripcion)[],
  opciones: { activo?: boolean; espera?: number } = {},
) {
  const { activo = true, espera = 250 } = opciones;
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<number | null>(null);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const vivo = useRef(true);

  const recargar = useCallback(async () => {
    try {
      const d = await cargarRef.current();
      if (!vivo.current) return;
      setDatos(d);
      setError(null);
      setActualizado(Date.now());
    } catch (e) {
      if (vivo.current) setError((e as Error).message);
    }
  }, []);

  const subsClave = JSON.stringify(suscripciones);

  useEffect(() => {
    vivo.current = true;
    if (!activo) return;
    setDatos(null);
    recargar();
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const programar = () => {
      if (temporizador) clearTimeout(temporizador);
      temporizador = setTimeout(recargar, espera);
    };
    const sb = supabaseBrowser();
    const canal = sb.channel(`${clave}-${++canalN}`);
    for (const s of JSON.parse(subsClave) as (string | Suscripcion)[]) {
      const sus = typeof s === "string" ? { tabla: s } : s;
      canal.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: sus.tabla, ...(sus.filtro ? { filter: sus.filtro } : {}) } as never,
        programar as never,
      );
    }
    canal.subscribe();
    // Respaldo por si Realtime se cae: refresco suave cada 30 s
    const respaldo = setInterval(recargar, 30000);
    return () => {
      vivo.current = false;
      if (temporizador) clearTimeout(temporizador);
      clearInterval(respaldo);
      sb.removeChannel(canal);
    };
  }, [clave, subsClave, activo, espera, recargar]);

  return { datos, error, actualizado, recargar };
}
