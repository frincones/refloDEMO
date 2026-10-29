"use client";
// Control del demo (Fase 7): botones en orden del guion. Cada paso llama una ruta del servidor con x-admin-token.
import Link from "next/link";
import { useState } from "react";
import { Icono } from "@/components/Iconos";
import { ChipEstado } from "@/components/consola/Chips";
import { useBuffer, useConfig, useUltimoCorte } from "@/hooks/datos";
import { post, textoError } from "@/lib/ui/api";
import { exportarListaRuta } from "@/lib/ui/corte";
import { cop, fechaHora, nombreCorto } from "@/lib/ui/formato";
import { toast } from "@/lib/ui/toast";

type R = Record<string, unknown>;
type ItemCorte = { envio_id: string; guia: string; comprador: string; zona: string; cod_monto: number; estado: string; accion: string; franja: string | null; nota: string | null };
type ResCorte = { corte_id: string; version: number; resumen: { incluir: number; baja: number; retener: number; excluir: number }; items: ItemCorte[] };

type Paso = {
  n: number;
  titulo: string;
  desc: string;
  icono: string;
  ruta: string;
  cuerpo?: R;
  resumen: (r: R) => string;
  peligro?: boolean;
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

const PASOS: Paso[] = [
  { n: 1, titulo: "Reiniciar demo", desc: "Vacía mensajes, promesas, casos, eventos y cortes; deja la configuración inicial.", icono: "refresh", ruta: "/api/demo/reset", resumen: () => "Demo reiniciado", peligro: true },
  { n: 2, titulo: "Crear envíos de prueba en Waygo", desc: "POST /v1/shipments en el emulador (o sandbox): 6 envíos COD nuevos. Llegan por webhook.", icono: "truck", ruta: "/api/waygo/crear", cuerpo: { cantidad: 6 }, resumen: (r) => `${Array.isArray(r.creados) ? r.creados.length : 0} envíos creados en Waygo · llegan por webhook` },
  { n: 3, titulo: "Sincronizar con Waygo", desc: "GET /v1/shipments → trae teléfono y COD de los nuevos o cambiados al buffer.", icono: "refresh", ruta: "/api/waygo/sync", resumen: (r) => `Sincronizado · ${n(r.nuevos)} nuevos, ${n(r.actualizados)} actualizados` },
  { n: 4, titulo: "Preparar buffer (riesgo y grupo de control)", desc: "Analista de riesgo (P = R × M × U) y sorteo aleatorio del grupo control.", icono: "shield", ruta: "/api/demo/preparar", resumen: (r) => `${n(r.procesados)} envíos preparados · ${n(r.grupo_control)} al grupo control` },
  { n: 5, titulo: "Lanzar ola 9:00", desc: "Plantilla de confirmación por WhatsApp a los pendientes del piloto (respeta el interruptor).", icono: "send", ruta: "/api/demo/ola", resumen: (r) => `Ola enviada · ${n(r.enviados)} mensajes` },
  { n: 6, titulo: "Recordatorio 12:30", desc: "Mensaje corto a los que no respondieron.", icono: "bell", ruta: "/api/demo/recordatorio", resumen: (r) => `Recordatorio enviado · ${n(r.enviados)} mensajes` },
  { n: 7, titulo: "Congelar corte 20:00", desc: "Snapshot con reglas de confianza (≥ 0,75 incluye; 0,5–0,75 baja prioridad; < 0,5 retiene) y lista de ruta.", icono: "layers", ruta: "/api/demo/corte", resumen: (r) => `Corte v${n(r.version)} congelado · ${(r.items as unknown[])?.length ?? 0} envíos` },
  { n: 8, titulo: "Día D: llega en 30 min", desc: "Aviso “tu mensajero llega en 30 min” a los confirmados, con botones.", icono: "truck", ruta: "/api/demo/dia-d", resumen: (r) => `Aviso del día D · ${n(r.enviados)} mensajes` },
];

const ACCION: Record<string, [string, string]> = {
  incluir: ["Incluir", "c-ok"],
  baja: ["Baja prioridad", "c-warn"],
  retener: ["Retener", "c-info"],
  excluir: ["Excluir", "c-risk"],
};

export default function Control() {
  const [estado, setEstado] = useState<Record<number, { st: "run" | "ok" | "err"; txt: string; en: string }>>({});
  const [ultimo, setUltimo] = useState<{ paso: string; status: "ok" | "error"; json: unknown } | null>(null);
  const [corte, setCorte] = useState<ResCorte | null>(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const [envioPago, setEnvioPago] = useState("");
  const { filas } = useBuffer();
  const { datos: config } = useConfig();
  const { datos: ultimoCorte } = useUltimoCorte();

  async function correr(p: Paso) {
    setEstado((s) => ({ ...s, [p.n]: { st: "run", txt: "En curso…", en: new Date().toISOString() } }));
    try {
      const r = await post<R>(p.ruta, p.cuerpo);
      const txt = p.resumen(r);
      setEstado((s) => ({ ...s, [p.n]: { st: "ok", txt, en: new Date().toISOString() } }));
      setUltimo({ paso: `${p.n}. ${p.titulo}`, status: "ok", json: r });
      if (p.n === 7) setCorte(r as unknown as ResCorte);
      if (p.n === 1) setCorte(null);
      toast(txt);
    } catch (e) {
      const txt = textoError(e);
      setEstado((s) => ({ ...s, [p.n]: { st: "err", txt, en: new Date().toISOString() } }));
      setUltimo({ paso: `${p.n}. ${p.titulo}`, status: "error", json: { error: txt } });
      toast(`${p.titulo}: ${txt}`, "error");
    }
  }

  async function pago() {
    if (!envioPago) return;
    try {
      const r = await post<R>("/api/demo/pago", { envio_id: envioPago });
      setUltimo({ paso: "Marcar pago recibido", status: "ok", json: r });
      toast("Pago recibido (simulado)");
    } catch (e) {
      const txt = textoError(e);
      setUltimo({ paso: "Marcar pago recibido", status: "error", json: { error: txt } });
      toast(txt, "error");
    }
  }

  const corteParaCsv = corte ? { id: corte.corte_id, version: corte.version, fecha: ultimoCorte?.fecha || new Date().toISOString().slice(0, 10) } : ultimoCorte;

  return (
    <section className="screen active" aria-labelledby="h-ctl">
      <div className="screen-head">
        <div>
          <h1 id="h-ctl">Control del demo</h1>
          <div className="sub">
            Los pasos del guion, en orden · cada botón llama la API real · <span className="sample-tag">Demo · datos de prueba</span>
          </div>
        </div>
        <div className="actions-row">
          <Link className="btn btn-ghost" href="/emulador">
            <Icono nombre="truck" />
            Emulador Waygo
          </Link>
          <Link className="btn btn-outline" href="/whatsapp">
            <Icono nombre="chat" />
            Simulador WhatsApp
          </Link>
        </div>
      </div>

      {config?.agentes_pausados && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <b>Agentes en pausa:</b> la ola, el recordatorio, el día D y el chat responderán con error hasta reanudarlos.
        </div>
      )}

      <div className="ctl-grid">
        <ol className="pasos">
          {PASOS.map((p) => {
            const s = estado[p.n];
            return (
              <li key={p.n} className={`card paso${s ? " " + s.st : ""}`}>
                <span className="paso-n">{s?.st === "ok" ? <Icono nombre="check" /> : p.n}</span>
                <div className="paso-body">
                  <b>{p.titulo}</b>
                  <small>{p.desc}</small>
                  {s && (
                    <span className={`paso-res ${s.st === "err" ? "msg-err" : s.st === "ok" ? "msg-ok" : ""}`}>
                      {s.txt} · {fechaHora(s.en)}
                    </span>
                  )}
                  {p.peligro && confirmarReset && (
                    <span className="actions-row" style={{ marginTop: 8 }}>
                      <span style={{ fontSize: 13 }}>¿Seguro? Se borra la actividad del demo.</span>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmarReset(false)}>
                        Cancelar
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => {
                          setConfirmarReset(false);
                          correr(p);
                        }}
                      >
                        Sí, reiniciar
                      </button>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`btn ${p.peligro ? "btn-ghost" : "btn-primary"} paso-btn`}
                  disabled={s?.st === "run"}
                  onClick={() => (p.peligro ? setConfirmarReset(true) : correr(p))}
                >
                  <Icono nombre={p.icono} />
                  {s?.st === "run" ? "En curso…" : s?.st === "ok" ? "Repetir" : "Ejecutar"}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="col">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Otras acciones</h2>
                <div className="sub">Para escenas puntuales del guion</div>
              </div>
            </div>
            <div className="form-row">
              <label className="field" style={{ flex: 1 }}>
                Marcar pago recibido
                <select value={envioPago} onChange={(e) => setEnvioPago(e.target.value)}>
                  <option value="">Elige un envío…</option>
                  {(filas || []).map((f) => (
                    <option key={f.envio.id} value={f.envio.id}>
                      {f.envio.tracking_number} · {nombreCorto(f.envio.comprador_nombre)} · {cop(f.envio.cod_monto)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn-outline" type="button" disabled={!envioPago} onClick={pago}>
                <Icono nombre="cash" />
                Pago recibido
              </button>
            </div>
            <div className="actions-row" style={{ marginTop: 12 }}>
              <Link className="btn btn-ghost btn-sm" href="/buffer">
                <Icono nombre="layers" />
                Ver buffer
              </Link>
              <Link className="btn btn-ghost btn-sm" href="/excepciones">
                <Icono nombre="flag" />
                Excepciones
              </Link>
              <Link className="btn btn-ghost btn-sm" href="/agentes">
                <Icono nombre="bot" />
                Agentes e interruptor
              </Link>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Último resultado</h2>
                <div className="sub">{ultimo ? ultimo.paso : "Aún no ejecutas ningún paso en esta sesión"}</div>
              </div>
              {ultimo && <span className={`chip ${ultimo.status === "ok" ? "c-ok" : "c-risk"}`}>{ultimo.status === "ok" ? "OK" : "Error"}</span>}
            </div>
            <pre className="json">{ultimo ? JSON.stringify(compactar(ultimo.json), null, 2) : "—"}</pre>
          </div>
        </div>
      </div>

      {(corte || ultimoCorte) && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Lista de ruta · corte {corte ? `v${corte.version}` : ultimoCorte ? `v${ultimoCorte.version}` : ""}</h2>
              <div className="sub">{corte ? "Recién congelado" : `Último corte guardado · ${fechaHora(ultimoCorte?.created_at)}`} · lo que recibe despacho</div>
            </div>
            <button className="btn btn-outline" type="button" onClick={() => exportarListaRuta(corteParaCsv)}>
              <Icono nombre="download" />
              Descargar CSV
            </button>
          </div>
          {corte ? (
            <>
              <div className="scores" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))", marginBottom: 12 }}>
                {(["incluir", "baja", "retener", "excluir"] as const).map((k) => (
                  <div key={k} className="score">
                    <span>{ACCION[k][0]}</span>
                    <b className="num">{corte.resumen?.[k] ?? 0}</b>
                  </div>
                ))}
              </div>
              <div className="table-wrap">
                <table className="data compact">
                  <thead>
                    <tr>
                      <th>Guía</th>
                      <th>Comprador</th>
                      <th>Zona</th>
                      <th className="r">COD</th>
                      <th>Estado</th>
                      <th>Acción</th>
                      <th>Franja</th>
                      <th>Nota al mensajero</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(corte.items || []).map((it) => (
                      <tr key={it.envio_id} style={{ cursor: "default" }}>
                        <td>
                          <span className="guia">{it.guia}</span>
                        </td>
                        <td>{it.comprador}</td>
                        <td>{it.zona}</td>
                        <td className="r num">{cop(it.cod_monto)}</td>
                        <td>
                          <ChipEstado estado={it.estado} />
                        </td>
                        <td>
                          <span className={`chip ${ACCION[it.accion]?.[1] || "c-idle"}`}>{ACCION[it.accion]?.[0] || it.accion}</span>
                        </td>
                        <td>{it.franja || "—"}</td>
                        <td style={{ whiteSpace: "normal", minWidth: 180 }}>{it.nota || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="sub">Congela el corte (paso 7) para ver la tabla aquí, o descarga el CSV del último corte guardado.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Recorta arreglos largos para que el JSON se lea de un vistazo. */
function compactar(v: unknown, prof = 0): unknown {
  if (Array.isArray(v)) {
    const xs = v.slice(0, 3).map((x) => compactar(x, prof + 1));
    return v.length > 3 ? [...xs, `… ${v.length - 3} más`] : xs;
  }
  if (v && typeof v === "object" && prof < 4) return Object.fromEntries(Object.entries(v as R).map(([k, x]) => [k, compactar(x, prof + 1)]));
  return v;
}
