"use client";
// Cinta EN VIVO del mockup, alimentada con los últimos eventos.
import { useEventos } from "@/hooks/datos";

export function Ticker() {
  const { datos } = useEventos(12);
  const lineas = (datos || []).filter((e) => e.mensaje && e.nivel !== "debug").map((e) => e.mensaje as string);
  const texto = lineas.length ? lineas.join("  ·  ") : "Sin actividad todavía · usa Control del demo para sincronizar, preparar el buffer y lanzar la ola";
  return (
    <div className="ticker" aria-label="Actividad en vivo">
      <span className="live">
        <span className="dot-live" />
        EN VIVO
      </span>
      <div className="track">
        <span key={texto} style={{ animationDuration: `${Math.max(30, Math.min(120, texto.length / 6))}s` }}>
          {texto}
        </span>
      </div>
    </div>
  );
}
