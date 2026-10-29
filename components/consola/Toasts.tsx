"use client";
import { useEffect, useState } from "react";
import { suscribirToasts, type Aviso } from "@/lib/ui/toast";
import { Icono } from "@/components/Iconos";

export function Toasts() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  useEffect(
    () =>
      suscribirToasts((a) => {
        setAvisos((xs) => [...xs.slice(-3), a]);
        setTimeout(() => setAvisos((xs) => xs.filter((x) => x.id !== a.id)), a.tipo === "error" ? 6500 : 4200);
      }),
    [],
  );
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {avisos.map((a) => (
        <div key={a.id} className={`toast toast-${a.tipo}`}>
          <Icono nombre={a.tipo === "error" ? "x" : a.tipo === "info" ? "bell" : "check"} />
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}
