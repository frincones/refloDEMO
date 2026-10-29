"use client";
// Diálogo en la página para pedir DEMO_ADMIN_TOKEN una sola vez (se guarda en sessionStorage).
import { useEffect, useRef, useState } from "react";
import { registrarSolicitanteToken } from "@/lib/ui/api";
import { Icono } from "@/components/Iconos";

export function DialogoToken() {
  const [abierto, setAbierto] = useState<{ motivo?: string } | null>(null);
  const [valor, setValor] = useState("");
  const resolver = useRef<((t: string | null) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registrarSolicitanteToken(
      (motivo) =>
        new Promise<string | null>((res) => {
          resolver.current = res;
          setValor("");
          setAbierto({ motivo });
        }),
    );
    return () => registrarSolicitanteToken(null);
  }, []);

  useEffect(() => {
    if (abierto) setTimeout(() => input.current?.focus(), 30);
  }, [abierto]);

  function cerrar(t: string | null) {
    resolver.current?.(t);
    resolver.current = null;
    setAbierto(null);
  }

  if (!abierto) return null;
  return (
    <div className="modal-fondo" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && cerrar(null)}>
      <form
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-token-t"
        onSubmit={(e) => {
          e.preventDefault();
          if (valor.trim()) cerrar(valor.trim());
        }}
        onKeyDown={(e) => e.key === "Escape" && cerrar(null)}
      >
        <h2 id="dlg-token-t" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icono nombre="lock" />
          Token de administración del demo
        </h2>
        <p className="sub" style={{ margin: "4px 0 12px" }}>
          Las acciones de la consola (ola, corte, chat, aprobar casos…) llaman rutas protegidas. Se guarda solo en esta pestaña.
        </p>
        {abierto.motivo && <p className="msg-err" style={{ margin: "0 0 10px", fontSize: 13.5 }}>{abierto.motivo}</p>}
        <label className="field">
          Token (header x-admin-token)
          <input ref={input} type="password" autoComplete="off" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <div className="actions-row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={() => cerrar(null)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valor.trim()}>
            <Icono nombre="check" />
            Guardar y continuar
          </button>
        </div>
      </form>
    </div>
  );
}
