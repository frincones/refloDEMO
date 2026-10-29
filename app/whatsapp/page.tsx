"use client";
// Simulador de WhatsApp (Fase 6): el presentador hace de comprador; el agente real responde por /api/chat (SSE).
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icono } from "@/components/Iconos";
import { Burbuja, tituloBoton } from "@/components/consola/Burbujas";
import { ChipEstado, Confianza } from "@/components/consola/Chips";
import { useBuffer, useEnvio, useEventos, type FilaBuffer } from "@/hooks/datos";
import { ESCENARIOS } from "@/lib/escenarios";
import { ApiError, post, postStream, textoError } from "@/lib/ui/api";
import { ORDEN_ESTADOS, PREFERENCIA_PAGO, defCaso, defEstado, detalleEstado, estadoVista } from "@/lib/ui/estados";
import { cop, franja, hora, iniciales, nombreCorto, telefonoOculto } from "@/lib/ui/formato";
import { leerSSE } from "@/lib/ui/sse";
import { toast } from "@/lib/ui/toast";
import type { Boton, Evento, Mensaje } from "@/lib/ui/tipos";

type Herramienta = { nombre: string; entrada: unknown; resultado: unknown; en: number };
type Intencion = {
  estado: string;
  confianza?: number;
  franja_inicio?: string | null;
  franja_fin?: string | null;
  preferencia_pago?: string | null;
  evidencia?: unknown;
  accion_ruta?: string | null;
};
type Turno = {
  n: number;
  envioId: string;
  texto: string;
  enviadoEn: number;
  baseComprador: number;
  baseAgente: number;
  agente: string;
  herramientas: Herramienta[];
  intencion: Intencion | null;
  botones: Boton[] | null;
  caso: { id: string; tipo: string } | null;
  mensajeId: string | null;
  error: string | null;
  terminado: boolean;
};

const CLAVE_VISTOS = "wa-vistos";
let turnoN = 0;

function leerVistos(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_VISTOS) || "{}");
  } catch {
    return {};
  }
}

function resumen(v: unknown, max = 120): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default function Pagina() {
  return (
    <Suspense fallback={<section className="screen active"><div className="card empty">Cargando simulador…</div></section>}>
      <Simulador />
    </Suspense>
  );
}

function Simulador() {
  const router = useRouter();
  const params = useSearchParams();
  const sel = params.get("envio");
  const { filas } = useBuffer();
  const { datos: det, recargar: recargarEnvio } = useEnvio(sel);
  const { datos: eventos } = useEventos(80, sel || undefined);
  const [filtro, setFiltro] = useState("");
  const [todos, setTodos] = useState(false);
  const [vistos, setVistos] = useState<Record<string, string>>({});
  const [turnos, setTurnos] = useState<Record<string, Turno>>({});
  const [borrador, setBorrador] = useState("");
  const cuerpo = useRef<HTMLDivElement>(null);
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => setVistos(leerVistos()), []);
  useEffect(() => () => abortar.current?.abort(), []);

  // Marca como vista la conversación abierta
  const ultimoSel = filas?.find((f) => f.envio.id === sel)?.ultimoMensaje?.created_at;
  useEffect(() => {
    if (!sel || !ultimoSel) return;
    setVistos((v) => {
      if (v[sel] && v[sel] >= ultimoSel) return v;
      const n = { ...v, [sel]: ultimoSel };
      try {
        sessionStorage.setItem(CLAVE_VISTOS, JSON.stringify(n));
      } catch {
        /* nada */
      }
      return n;
    });
  }, [sel, ultimoSel]);

  // Conversaciones: envíos con mensajes o contactando (o todos, con el interruptor)
  const conversaciones = useMemo(() => {
    const xs = (filas || []).filter((f) => f.envio.id === sel || (todos ? f.estado !== "GRUPO_CONTROL" : f.nMensajes > 0 || f.estado === "CONTACTANDO"));
    return xs
      .filter((f) => !filtro || f.estado === filtro)
      .sort((a, b) => (b.ultimoMensaje?.created_at || "").localeCompare(a.ultimoMensaje?.created_at || "") || (a.envio.tracking_number || "").localeCompare(b.envio.tracking_number || ""));
  }, [filas, filtro, todos, sel]);

  const fila: FilaBuffer | undefined = filas?.find((f) => f.envio.id === sel);
  const envio = det?.envio ?? fila?.envio ?? null;
  const mensajes: Mensaje[] = det?.mensajes ?? [];
  const turno = sel ? turnos[sel] : undefined;
  const ocupado = !!turno && !turno.terminado;

  const upd = useCallback((envioId: string, fn: (t: Turno) => Turno) => {
    setTurnos((ts) => (ts[envioId] ? { ...ts, [envioId]: fn(ts[envioId]) } : ts));
  }, []);

  // Desplaza el chat al final cuando llega algo
  const firma = `${mensajes.length}|${turno?.agente.length}|${turno?.terminado}|${turno?.botones?.length}`;
  useEffect(() => {
    const el = cuerpo.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [firma, sel]);

  async function enviar(texto: string, boton?: Boton) {
    const t = texto.trim();
    if (!sel || !t || ocupado) return;
    const envioId = sel;
    const n = ++turnoN;
    const nuevo: Turno = {
      n,
      envioId,
      texto: t,
      enviadoEn: Date.now(),
      baseComprador: mensajes.filter((m) => m.rol === "comprador" && m.texto.trim() === t).length,
      baseAgente: mensajes.filter((m) => m.rol === "agente").length,
      agente: "",
      herramientas: [],
      intencion: null,
      botones: null,
      caso: null,
      mensajeId: null,
      error: null,
      terminado: false,
    };
    setTurnos((ts) => ({ ...ts, [envioId]: nuevo }));
    setBorrador("");
    abortar.current?.abort();
    const ctl = new AbortController();
    abortar.current = ctl;
    try {
      const res = await postStream("/api/chat", { envio_id: envioId, texto: t, ...(boton ? { boton_id: boton.id } : {}) }, ctl.signal);
      for await (const ev of leerSSE(res)) {
        const d = (ev.datos || {}) as Record<string, unknown>;
        switch (ev.evento) {
          case "delta":
            upd(envioId, (x) => ({ ...x, agente: x.agente + String(d.texto ?? "") }));
            break;
          case "herramienta":
            upd(envioId, (x) => ({ ...x, herramientas: [...x.herramientas, { nombre: String(d.nombre), entrada: d.entrada, resultado: d.resultado, en: Date.now() }] }));
            break;
          case "intencion":
            upd(envioId, (x) => ({ ...x, intencion: d as unknown as Intencion }));
            break;
          case "botones":
            upd(envioId, (x) => ({ ...x, botones: (d.botones as Boton[]) || null }));
            break;
          case "caso":
            upd(envioId, (x) => ({ ...x, caso: { id: String(d.id), tipo: String(d.tipo) } }));
            toast(`Escalado a una persona · ${defCaso(String(d.tipo)).label}`, "info");
            break;
          case "fin":
            upd(envioId, (x) => ({ ...x, mensajeId: (d.mensaje_id as string) || null, terminado: true }));
            break;
          case "error": {
            const m = String(d.mensaje ?? "error");
            upd(envioId, (x) => ({ ...x, error: m, terminado: true }));
            toast(m === "agente_en_pausa" ? "Agentes en pausa: el agente no responde. Reanúdalos en Actividad de agentes." : `Error del agente: ${m}`, "error");
            break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof ApiError && e.codigo === "no_disponible" ? "endpoint no disponible" : textoError(e);
      upd(envioId, (x) => ({ ...x, error: msg }));
      toast(msg === "endpoint no disponible" ? "Endpoint /api/chat no disponible todavía (el backend del agente aún no está desplegado)" : msg, "error");
    } finally {
      upd(envioId, (x) => (x.n === n ? { ...x, terminado: true } : x));
      if (envioId === sel) recargarEnvio();
    }
  }

  // ---- burbujas: filas persistidas + el turno en curso (reconciliado por mensaje_id) ----
  const idsDb = new Set(mensajes.map((m) => m.id));
  const compradorDb = turno ? mensajes.filter((m) => m.rol === "comprador" && m.texto.trim() === turno.texto).length : 0;
  const agenteDb = mensajes.filter((m) => m.rol === "agente").length;
  const verCompradorLocal = !!turno && compradorDb <= turno.baseComprador;
  const verAgenteLocal =
    !!turno && !turno.error && (!turno.terminado || (turno.mensajeId ? !idsDb.has(turno.mensajeId) : agenteDb <= turno.baseAgente && !!turno.agente));

  const ultimoAgenteIdx = (() => {
    for (let i = mensajes.length - 1; i >= 0; i--) if (mensajes[i].rol !== "sistema") return mensajes[i].rol === "agente" || mensajes[i].rol === "persona" ? i : -1;
    return -1;
  })();

  // ---- panel "lo que entendió el agente" ----
  const vigente = det?.promesas.find((p) => p.vigente) ?? null;
  const intencion: Intencion | null =
    (turno?.intencion as Intencion) ??
    (vigente
      ? {
          estado: vigente.estado,
          confianza: vigente.confianza === null ? undefined : Number(vigente.confianza),
          franja_inicio: vigente.franja_inicio,
          franja_fin: vigente.franja_fin,
          preferencia_pago: vigente.preferencia_pago,
          evidencia: vigente.evidencia,
        }
      : null);
  const ultimoComprador = [...mensajes].reverse().find((m) => m.rol === "comprador");
  const herramientasDb: Evento[] = (eventos || [])
    .filter((e) => e.herramienta && (!ultimoComprador || Date.parse(e.created_at) >= Date.parse(ultimoComprador.created_at) - 5000))
    .slice(0, 12)
    .reverse();
  const herramientas: { nombre: string; entrada: unknown; resultado: unknown; nivel?: string }[] = turno?.herramientas.length
    ? turno.herramientas
    : herramientasDb.map((e) => ({ nombre: e.herramienta as string, entrada: e.entrada, resultado: e.resultado, nivel: e.nivel }));
  const linkGenerado =
    !!turno?.herramientas.some((h) => /pago_generar_link/.test(h.nombre)) || !!(eventos || []).some((e) => /pago_generar_link/.test(e.herramienta || ""));
  const casosAbiertos = (det?.casos || []).filter((c) => c.estado === "abierto");
  const estadoActual = envio ? estadoVista(envio, mensajes.some((m) => m.rol === "agente")) : null;

  async function simularPago() {
    if (!sel) return;
    try {
      await post("/api/demo/pago", { envio_id: sel });
      toast("Pago recibido (simulado) · el mensajero no cobrará en la puerta");
    } catch (e) {
      toast(textoError(e), "error");
    }
  }

  const abrir = (id: string) => router.replace(`/whatsapp?envio=${id}`, { scroll: false });

  return (
    <section className="screen active" aria-labelledby="h-wa">
      <div className="screen-head">
        <div>
          <h1 id="h-wa">Simulador de WhatsApp</h1>
          <div className="sub">
            Tú eres el comprador · responde el agente de contacto real · <span className="sample-tag">Demo · datos de prueba</span>
          </div>
        </div>
        <div className="actions-row">
          <Link className="btn btn-ghost btn-sm" href="/control">
            <Icono nombre="play" />
            Control del demo
          </Link>
          {sel && (
            <Link className="btn btn-outline btn-sm" href={`/envio/${sel}`}>
              <Icono nombre="box" />
              Ver detalle del envío
            </Link>
          )}
        </div>
      </div>

      <div className="card esc-bar" role="group" aria-label="Escenarios de un clic">
        <span className="esc-lab">Escenarios</span>
        {ESCENARIOS.map((e) => (
          <button key={e.id} type="button" className="esc-btn" disabled={!sel || ocupado} title={`${e.texto}\n→ esperado: ${e.esperado}`} onClick={() => enviar(e.texto)}>
            <span aria-hidden="true">{e.emoji}</span>
            {e.titulo}
          </button>
        ))}
        {!sel && <span className="sub" style={{ margin: 0 }}>Elige una conversación para usar los escenarios.</span>}
      </div>

      <div className="wa-sim">
        {/* ------- lista de conversaciones ------- */}
        <div className="card conv-card">
          <div className="conv-head">
            <h2>Conversaciones</h2>
            <span className="code">{conversaciones.length}</span>
          </div>
          <div className="conv-filtros">
            <select className="select" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar por estado de intención">
              <option value="">Todos los estados</option>
              {ORDEN_ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {defEstado(e).label}
                </option>
              ))}
            </select>
            <label className="conv-todos">
              <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
              Incluir envíos sin mensajes
            </label>
          </div>
          <ul className="conv-list">
            {!filas && <li className="empty">Cargando…</li>}
            {filas && !conversaciones.length && (
              <li className="empty">
                Sin conversaciones todavía. Lanza la ola de las 9:00 en <Link href="/control">Control del demo</Link> o marca “Incluir envíos sin mensajes”.
              </li>
            )}
            {conversaciones.map((f) => {
              const um = f.ultimoMensaje;
              const noLeido = !!um && um.rol !== "comprador" && f.envio.id !== sel && (!vistos[f.envio.id] || vistos[f.envio.id] < um.created_at);
              return (
                <li key={f.envio.id}>
                  <button type="button" className="conv" aria-current={f.envio.id === sel ? "true" : undefined} onClick={() => abrir(f.envio.id)}>
                    <span className="conv-av">{iniciales(f.envio.comprador_nombre)}</span>
                    <span className="conv-body">
                      <span className="conv-top">
                        <b>{nombreCorto(f.envio.comprador_nombre)}</b>
                        <time>{um ? hora(um.created_at) : ""}</time>
                      </span>
                      <span className="conv-snip">{um ? (um.rol === "comprador" ? "Tú: " : "") + um.texto : `${f.envio.tienda} · ${f.envio.tracking_number}`}</span>
                      <span className="conv-bot">
                        <ChipEstado estado={f.estado} detalle={detalleEstado(f.estado, f.promesa)} />
                        {noLeido && <span className="unread" aria-label="sin leer" />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ------- teléfono ------- */}
        <div className="phone-col">
          <div className="phone wa-phone">
            <div className="screen-in p-wa">
              <div className="notch" />
              <div className="statusbar num">
                <span suppressHydrationWarning>{hora(new Date().toISOString())}</span>
                <span>5G ▮▮▮</span>
              </div>
              <div className="wa-head">
                <div className="av">{iniciales(envio?.tienda || "Reflo")}</div>
                <div style={{ minWidth: 0 }}>
                  <b>{envio ? `${envio.tienda} · Entregas` : "WhatsApp del comprador"}</b>
                  <small>{ocupado ? "escribiendo…" : envio ? `Cuenta de empresa · vía Reflo · ${nombreCorto(envio.comprador_nombre)}` : "Elige una conversación"}</small>
                </div>
              </div>
              <div className="wa-body" ref={cuerpo} aria-live="polite">
                {!sel && <div className="sys">Elige una conversación de la lista para empezar.</div>}
                {sel && !mensajes.length && !turno && (
                  <div className="sys">Sin mensajes todavía. Escribe como comprador o lanza la ola desde Control.</div>
                )}
                {mensajes.map((m, i) => {
                  const siguiente = mensajes.slice(i + 1).find((x) => x.rol === "comprador");
                  const activos = i === ultimoAgenteIdx && !ocupado && !siguiente && !(turno && verCompradorLocal);
                  return (
                    <Burbuja
                      key={m.id}
                      rol={m.rol}
                      texto={m.texto}
                      hora={hora(m.created_at)}
                      botones={m.botones}
                      elegido={siguiente?.texto ?? (turno && !siguiente ? turno.texto : null)}
                      botonesActivos={activos}
                      alElegir={(b) => enviar(tituloBoton(b), b)}
                    />
                  );
                })}
                {turno && verCompradorLocal && <Burbuja rol="comprador" texto={turno.texto} hora={hora(new Date(turno.enviadoEn).toISOString())} pendiente={!turno.terminado} />}
                {turno && verAgenteLocal && (
                  <Burbuja
                    rol="agente"
                    texto={turno.agente}
                    escribiendo={!turno.terminado}
                    hora={turno.terminado ? hora(new Date().toISOString()) : ""}
                    botones={turno.botones}
                    botonesActivos={turno.terminado}
                    alElegir={(b) => enviar(tituloBoton(b), b)}
                  />
                )}
                {turno?.error && <div className="sys sys-err">{turno.error === "agente_en_pausa" ? "Agentes en pausa · nadie responde automáticamente" : `No se pudo responder: ${turno.error}`}</div>}
                {turno?.caso && <div className="sys">Conversación escalada a una persona · {defCaso(turno.caso.tipo).label}</div>}
              </div>
              <form
                className="wa-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  enviar(borrador);
                }}
              >
                <input
                  className="wa-field"
                  placeholder={sel ? "Escribe como comprador…" : "Elige una conversación"}
                  value={borrador}
                  onChange={(e) => setBorrador(e.target.value)}
                  disabled={!sel || ocupado}
                  aria-label="Mensaje del comprador"
                />
                <button type="submit" className="wa-send" disabled={!sel || ocupado || !borrador.trim()} aria-label="Enviar">
                  <Icono nombre="send" />
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* ------- lo que entendió el agente ------- */}
        <div className="col">
          <div className="card entendio">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div>
                <h2>Lo que entendió el agente</h2>
                <div className="sub">{turno ? (ocupado ? "Turno en curso…" : "Último turno") : vigente ? `Promesa vigente · v${vigente.version}` : "Sin intención registrada"}</div>
              </div>
              {estadoActual && <ChipEstado estado={estadoActual} />}
            </div>
            {!sel && <p className="sub">Elige una conversación.</p>}
            {sel && (
              <>
                <div className="ent-int">
                  <small>Intención</small>
                  {intencion ? <ChipEstado estado={intencion.estado} /> : <span className="code">— aún no clasificada</span>}
                  {intencion?.estado && <span className="code">{intencion.estado}</span>}
                </div>
                <div className="confline" style={{ margin: "10px 0" }}>
                  <span>Confianza</span>
                  {intencion?.confianza !== undefined && intencion?.confianza !== null ? (
                    <>
                      <span className="bar">
                        <i className={Number(intencion.confianza) < 0.5 ? "lo" : Number(intencion.confianza) < 0.75 ? "mid" : ""} style={{ width: `${Math.round(Number(intencion.confianza) * (Number(intencion.confianza) <= 1 ? 100 : 1))}%` }} />
                      </span>
                      <b className="num" style={{ color: "var(--ink)" }}>
                        {Math.round(Number(intencion.confianza) * (Number(intencion.confianza) <= 1 ? 100 : 1))} %
                      </b>
                    </>
                  ) : (
                    <span className="code">n/a</span>
                  )}
                </div>
                <div className="kv kv-2">
                  <div>
                    <small>Franja</small>
                    <span>{franja(intencion?.franja_inicio, intencion?.franja_fin) || "—"}</span>
                  </div>
                  <div>
                    <small>Pago</small>
                    <span>{intencion?.preferencia_pago ? PREFERENCIA_PAGO[intencion.preferencia_pago] || intencion.preferencia_pago : "—"}</span>
                  </div>
                  <div>
                    <small>Acción en ruta</small>
                    <span>{intencion?.accion_ruta || "—"}</span>
                  </div>
                  <div>
                    <small>Evidencia</small>
                    <span className="ent-evid">{resumen(intencion?.evidencia, 140) || "—"}</span>
                  </div>
                </div>
                {casosAbiertos.length > 0 && (
                  <Link href="/excepciones" className="reco" style={{ display: "block", marginTop: 12, textDecoration: "none" }}>
                    <small>Escalado a una persona</small>
                    {casosAbiertos.map((c) => defCaso(c.tipo).label).join(" · ")} — ver en Excepciones →
                  </Link>
                )}
                {linkGenerado && (
                  <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={simularPago}>
                    <Icono nombre="cash" />
                    Simular pago recibido
                  </button>
                )}
              </>
            )}
            <pre className="tools ent-tools">
              <span className="c"># herramientas MCP del {turno ? "último turno" : "último turno registrado"}</span>
              {"\n"}
              {herramientas.length === 0 && <span className="c">{sel ? "(ninguna todavía)" : ""}</span>}
              {herramientas.map((h, i) => (
                <span key={i}>
                  <span className="fn">{h.nombre}</span>(<span className="s">{resumen(h.entrada, 90)}</span>){"  "}
                  <span className={h.nivel === "error" ? "c" : "ok"}>→ {resumen(h.resultado, 110) || "✓"}</span>
                  {"\n"}
                </span>
              ))}
              {ocupado && <span className="c">… pensando</span>}
            </pre>
          </div>
          {envio && (
            <div className="card">
              <div className="kv kv-2">
                <div>
                  <small>Guía</small>
                  <span className="guia">{envio.tracking_number}</span>
                </div>
                <div>
                  <small>Monto COD</small>
                  <span className="num">
                    <b>{cop(envio.cod_monto)}</b>
                  </span>
                </div>
                <div>
                  <small>Comprador</small>
                  <span>{envio.comprador_nombre}</span>
                </div>
                <div>
                  <small>Teléfono</small>
                  <span className="code">{telefonoOculto(envio.telefono_e164)}</span>
                </div>
                <div>
                  <small>Zona</small>
                  <span>{envio.zona || "—"}</span>
                </div>
                <div>
                  <small>Riesgo · control</small>
                  <span>{envio.riesgo === null ? "sin calcular" : Number(envio.riesgo).toFixed(2)} · {envio.grupo_control ? "control" : envio.grupo_control === false ? "piloto" : "sin sortear"}</span>
                </div>
              </div>
              {vigente && (
                <div style={{ marginTop: 10 }}>
                  <Confianza valor={vigente.confianza} alinear="start" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
