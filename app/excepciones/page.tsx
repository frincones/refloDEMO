"use client";
// Bandeja de excepciones (mockup #excepciones) desde la tabla `casos`. La decisión va por /api/casos/[id]/resolver.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icono } from "@/components/Iconos";
import { useBuffer, useCasos, useEventos } from "@/hooks/datos";
import { post, textoError } from "@/lib/ui/api";
import { defCaso } from "@/lib/ui/estados";
import { cop, fechaHora, hace, hora, nombreCorto, num } from "@/lib/ui/formato";
import { toast } from "@/lib/ui/toast";
import type { Caso, Envio, Evento } from "@/lib/ui/tipos";

const RESULTADO: Record<string, [string, string, string]> = {
  aprobado: ["Aprobado", "c-ok", "Recomendación aplicada · estado de intención actualizado"],
  rechazado: ["Rechazado", "c-risk", "Recomendación descartada · el agente no actúa"],
  tomado: ["Conversación tomada", "c-info", "Una persona atiende por WhatsApp · agente en silencio"],
  cerrado: ["Devuelto al agente", "c-idle", "Una persona atendió y devolvió la conversación al agente"],
};

function confianzaDe(c: Caso): number | null {
  const d = c.datos || {};
  const v = num((d.confianza as number) ?? (d.confidence as number) ?? null);
  if (v === null) return null;
  return v <= 1 ? Math.round(v * 100) : Math.round(v);
}

function razonamiento(c: Caso, eventos: Evento[]): string[] {
  const d = c.datos || {};
  const lineas: string[] = [];
  for (const k of ["razonamiento", "motivo", "evidencia", "cita"]) {
    const v = d[k];
    if (typeof v === "string") lineas.push(`# ${v}`);
    else if (Array.isArray(v)) v.forEach((x) => lineas.push(`# ${typeof x === "string" ? x : JSON.stringify(x)}`));
  }
  for (const ev of eventos.filter((e) => e.envio_id === c.envio_id && e.herramienta).slice(0, 8).reverse()) {
    const r = typeof ev.resultado === "string" ? ev.resultado : JSON.stringify(ev.resultado ?? "");
    lineas.push(`${ev.herramienta}(${JSON.stringify(ev.entrada ?? "").slice(0, 70)})  → ${r.slice(0, 80)}`);
  }
  lineas.push(`regla: ${c.tipo} → aprobación humana (N2)`);
  return lineas;
}

function Tarjeta({ c, envio, eventos }: { c: Caso; envio: Envio | undefined; eventos: Evento[] }) {
  const [ocupado, setOcupado] = useState(false);
  const def = defCaso(c.tipo);
  const conf = confianzaDe(c);
  const resuelto = c.estado !== "abierto";
  const res = RESULTADO[c.estado];

  async function resolver(accion: "aprobar" | "rechazar" | "tomar" | "devolver") {
    setOcupado(true);
    try {
      await post(`/api/casos/${c.id}/resolver`, { accion });
      const t = { aprobar: "Aprobado", rechazar: "Rechazado", tomar: "Conversación tomada · el agente queda en silencio", devolver: "Conversación devuelta al agente" }[accion];
      toast(`${t} · ${envio?.tracking_number || ""}`);
    } catch (e) {
      toast(textoError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className={`card exc${resuelto ? " resolved" : ""}`} aria-label={def.label}>
      <div className="exc-top">
        <div className={`flag ${def.tono}`}>
          <Icono nombre={def.icono} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="exc-title">
            {def.label}
            {c.tipo === "cod_alto" && envio ? ` · ${cop(envio.cod_monto)}` : ""}
          </div>
          <div className="exc-meta">
            {envio ? (
              <Link className="guia" href={`/envio/${envio.id}`}>
                {envio.tracking_number}
              </Link>
            ) : (
              <span className="guia">—</span>
            )}
            <span>
              {nombreCorto(envio?.comprador_nombre)} · {envio?.tienda}
            </span>
            <span>{envio?.zona}</span>
            <span className="num">
              COD <b>{cop(envio?.cod_monto)}</b>
            </span>
            <span title={fechaHora(c.created_at)}>{hace(c.created_at)}</span>
          </div>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 14 }}>{c.resumen}</p>
      <div className="reco">
        <small>Recomendación del agente</small>
        {c.recomendacion || "Revisar el caso y decidir."}
      </div>
      <div className="confline">
        <span>Confianza</span>
        {conf !== null ? (
          <>
            <span className="bar">
              <i className={conf < 65 ? "mid" : ""} style={{ width: `${conf}%` }} />
            </span>
            <b className="num" style={{ color: "var(--ink)" }}>
              {conf} %
            </b>
          </>
        ) : (
          <span className="code">n/a</span>
        )}
      </div>
      <details className="trace">
        <summary>Ver razonamiento</summary>
        <pre>
          {razonamiento(c, eventos).map((l, i) => (
            <span key={i} className={l.startsWith("#") ? "m" : l.startsWith("regla") ? "" : "k"}>
              {l}
              {"\n"}
            </span>
          ))}
        </pre>
      </details>
      {!resuelto ? (
        <div className="exc-actions">
          <button className="btn btn-ghost btn-sm" type="button" disabled={ocupado} onClick={() => resolver("rechazar")}>
            <Icono nombre="x" />
            Rechazar
          </button>
          <button className="btn btn-outline btn-sm" type="button" disabled={ocupado} onClick={() => resolver("tomar")}>
            <Icono nombre="chat" />
            Tomar conversación
          </button>
          <button className="btn btn-primary btn-sm" type="button" disabled={ocupado} onClick={() => resolver("aprobar")}>
            <Icono nombre="check" />
            Aprobar
          </button>
        </div>
      ) : (
        <div className="resolved-note" role="status">
          <span className={`chip ${res?.[1] || "c-idle"}`}>{res?.[0] || c.estado}</span>
          <span style={{ color: "var(--muted)", fontWeight: 500 }}>
            {res?.[2]} · {c.resuelto_por || "supervisor"} · {hora(c.resuelto_at || c.updated_at)}
          </span>
          {c.estado === "tomado" && (
            <span className="actions-row" style={{ marginLeft: "auto" }}>
              <Link className="btn btn-ghost btn-sm" href={`/whatsapp?envio=${c.envio_id}`}>
                <Icono nombre="phone" />
                Ver chat
              </Link>
              <button className="btn btn-primary btn-sm" type="button" disabled={ocupado} onClick={() => resolver("devolver")}>
                <Icono nombre="bot" />
                Devolver al agente
              </button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export default function Excepciones() {
  const { datos: casos, actualizado } = useCasos();
  const { filas } = useBuffer();
  const { datos: eventos } = useEventos(300);
  const [tab, setTab] = useState<"pend" | "res">("pend");
  const envios = useMemo(() => new Map((filas || []).map((f) => [f.envio.id, f.envio])), [filas]);
  // Los casos "tomados" siguen en la bandeja: una persona los atiende y puede devolverlos al agente.
  const pendientes = (casos || []).filter((c) => c.estado === "abierto" || c.estado === "tomado");
  const resueltas = (casos || []).filter((c) => c.estado !== "abierto" && c.estado !== "tomado");
  const lista = tab === "pend" ? pendientes : resueltas;

  return (
    <section className="screen active" aria-labelledby="h-exc">
      <div className="screen-head">
        <div>
          <h1 id="h-exc">Bandeja de excepciones</h1>
          <div className="sub">
            Casos de alto riesgo que los agentes no resuelven solos ·{" "}
            <span className="fresh">
              <Icono nombre="refresh" />
              {actualizado ? "en vivo" : "cargando…"}
            </span>
          </div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "pend"} type="button" onClick={() => setTab("pend")}>
          Requieren aprobación <span className="cnt num">{pendientes.length}</span>
        </button>
        <button className="tab" role="tab" aria-selected={tab === "res"} type="button" onClick={() => setTab("res")}>
          Resueltas <span className="cnt num">{resueltas.length}</span>
        </button>
      </div>
      <div className="bulk">
        <span className="sub">
          Política: aprobación humana obligatoria para cambio de dirección, posible fraude, COD &gt; $1.000.000, cliente molesto y tercero que recibe con COD.
        </span>
      </div>
      {casos && !lista.length && (
        <div className="card empty">
          {tab === "pend" ? (
            <>
              No hay casos pendientes. Prueba “🚩 Yo no pedí nada” o “😠 Cliente molesto” en el <Link href="/whatsapp">simulador de WhatsApp</Link>.
            </>
          ) : (
            "Aún no hay casos resueltos."
          )}
        </div>
      )}
      <div className="exc-grid">
        {lista.map((c) => (
          <Tarjeta key={c.id} c={c} envio={envios.get(c.envio_id)} eventos={eventos || []} />
        ))}
      </div>
    </section>
  );
}
