"use client";
// Avisos tipo toast del mockup (pub/sub sencillo; <Toasts/> los pinta).

export type Aviso = { id: number; texto: string; tipo: "ok" | "error" | "info" };
type Oyente = (a: Aviso) => void;

const oyentes = new Set<Oyente>();
let siguiente = 1;

export function suscribirToasts(fn: Oyente) {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

export function toast(texto: string, tipo: Aviso["tipo"] = "ok") {
  const a = { id: siguiente++, texto, tipo };
  oyentes.forEach((fn) => fn(a));
}
