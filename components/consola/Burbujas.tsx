"use client";
// Burbujas estilo WhatsApp del mockup (.wa / .msg / .qr / .sys).
import { Fragment } from "react";
import type { Boton } from "@/lib/ui/tipos";

export const tituloBoton = (b: Boton) => b.titulo ?? b.texto ?? b.id;

/** Formato WhatsApp mínimo: *negrita*, saltos de línea y enlaces. */
export function TextoWa({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  return (
    <>
      {lineas.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {l.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g).map((p, j) => {
            if (/^\*[^*]+\*$/.test(p)) return <b key={j}>{p.slice(1, -1)}</b>;
            if (/^https?:\/\//.test(p))
              return (
                <a key={j} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--wa-btn)", wordBreak: "break-all" }}>
                  {p}
                </a>
              );
            return <Fragment key={j}>{p}</Fragment>;
          })}
        </Fragment>
      ))}
    </>
  );
}

export type BurbujaProps = {
  rol: "agente" | "comprador" | "persona" | "sistema";
  texto: string;
  hora?: string;
  botones?: Boton[] | null;
  elegido?: string | null;
  alElegir?: (b: Boton) => void;
  botonesActivos?: boolean;
  escribiendo?: boolean;
  pendiente?: boolean;
  quien?: string;
};

export function Burbuja({ rol, texto, hora, botones, elegido, alElegir, botonesActivos, escribiendo, pendiente, quien }: BurbujaProps) {
  if (rol === "sistema") return <div className="sys">{texto}</div>;
  const sale = rol === "comprador";
  return (
    <div className={`msg ${sale ? "out" : "in"}${pendiente ? " pend" : ""}`}>
      {!sale && <span className="who">{quien || (rol === "persona" ? "Persona · supervisor de torre" : "Agente de contacto")}</span>}
      {escribiendo && !texto ? (
        <span className="typing" aria-label="escribiendo">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <TextoWa texto={texto} />
      )}
      {escribiendo && texto && <span className="caret" aria-hidden="true" />}
      <span className="t">
        {hora}
        {sale && (pendiente ? " 🕓" : " ✓✓")}
      </span>
      {!!botones?.length && (
        <div className="qr">
          {botones.map((b) => {
            const t = tituloBoton(b);
            const picked = !!elegido && elegido.trim().toLowerCase() === t.trim().toLowerCase();
            return botonesActivos && alElegir ? (
              <button key={b.id} type="button" className={picked ? "picked" : ""} onClick={() => alElegir(b)}>
                {t}
              </button>
            ) : (
              <span key={b.id} className={picked ? "picked" : ""}>
                {t}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
