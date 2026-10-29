"use client";
// Reloj simulado del corte D-1 20:00 (hora de Bogotá, o config_demo.hora_simulada si está puesta).
import { useEffect, useState } from "react";
import { Icono } from "@/components/Iconos";
import type { ConfigDemo, Corte } from "@/lib/ui/tipos";

const OFFSET_BOG = -5 * 3600 * 1000; // Bogotá no tiene horario de verano

export function ahoraSimulado(config: ConfigDemo | null | undefined, cargadoEn: number): Date {
  if (config?.hora_simulada) return new Date(new Date(config.hora_simulada).getTime() + (Date.now() - cargadoEn));
  return new Date();
}

/** Minutos que faltan para las 20:00 de Bogotá del día de `ahora` (negativo si ya pasó). */
export function minutosAlCorte(ahora: Date, hora = 20): number {
  const bog = new Date(ahora.getTime() + OFFSET_BOG);
  const min = bog.getUTCHours() * 60 + bog.getUTCMinutes() + bog.getUTCSeconds() / 60;
  return hora * 60 - min;
}

export function fechaManana(ahora: Date): string {
  const d = new Date(ahora.getTime() + 24 * 3600 * 1000);
  return d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short" }).replace(".", "");
}

export function CuentaRegresiva({ config, corte }: { config: ConfigDemo | null | undefined; corte: Corte | null | undefined }) {
  const [cargado] = useState(() => Date.now());
  const [tic, setTic] = useState(0);
  useEffect(() => {
    setTic(1);
    const id = setInterval(() => setTic((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (!tic)
    return (
      <div className="countdown" role="timer" aria-live="off">
        <div className="cd-ic">
          <Icono nombre="clock" />
        </div>
        <div>
          <small>Corte de ruta D-1 · 20:00 → snapshot y lista de ruta</small>
          <b>…</b>
        </div>
      </div>
    );
  const ahora = ahoraSimulado(config, cargado);
  const faltan = minutosAlCorte(ahora);
  const hoyBog = new Date(ahora.getTime() + OFFSET_BOG).toISOString().slice(0, 10);
  const corteHoy = corte && corte.fecha === hoyBog;
  let texto: React.ReactNode;
  if (corteHoy) texto = <>corte congelado · <em>v{corte!.version}</em></>;
  else if (faltan <= 0) texto = <>corte <em>pendiente de congelar</em></>;
  else {
    const h = Math.floor(faltan / 60);
    const m = Math.floor(faltan % 60);
    texto = <>faltan <em>{h} h {m} min</em></>;
  }
  return (
    <div className="countdown" role="timer" aria-live="off">
      <div className="cd-ic">
        <Icono nombre="clock" />
      </div>
      <div>
        <small>Corte de ruta D-1 · 20:00 → snapshot y lista de ruta{config?.hora_simulada ? " · hora simulada" : ""}</small>
        <b>{texto}</b>
      </div>
    </div>
  );
}
