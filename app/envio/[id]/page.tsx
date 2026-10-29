"use client";
// Detalle de envío (mockup #envio): datos, recorrido, intentos de contacto, promesa vigente, herramientas y conversación.
import Link from "next/link";
import { use, useState } from "react";
import { Icono } from "@/components/Iconos";
import { Burbuja } from "@/components/consola/Burbujas";
import { ChipEstado, ChipRiesgo } from "@/components/consola/Chips";
import { useEnvio, useEventos } from "@/hooks/datos";
import { post, textoError } from "@/lib/ui/api";
import { PREFERENCIA_PAGO, defCaso, detalleEstado, esConfirmado, estadoVista } from "@/lib/ui/estados";
import { cop, fechaCorta, fechaHora, franja, hace, hora, iniciales, num, telefonoOculto } from "@/lib/ui/formato";
import { toast } from "@/lib/ui/toast";
import type { Envio, Evento, Mensaje, Promesa } from "@/lib/ui/tipos";

const PASOS = ["Ingresó", "Validado", "Contactado", "Confirmado", "En ruta", "Entregado", "COD conciliado"];

function pasos(e: Envio, mensajes: Mensaje[], p: Promesa | null): { idx: number; tiempos: string[] } {
  const tiempos: string[] = Array(PASOS.length).fill("");
  tiempos[0] = hora(e.waygo_created_at || e.created_at);
  let idx = 1;
  const validado = e.validacion?.ok !== false && e.estado_buffer !== "NUMERO_INVALIDO";
  if (validado) {
    tiempos[1] = e.riesgo !== null ? "riesgo " + Number(e.riesgo).toFixed(2) : "datos ok";
    idx = 2;
  }
  const primerAgente = mensajes.find((m) => m.rol === "agente");
  if (validado && primerAgente) {
    tiempos[2] = hora(primerAgente.created_at);
    idx = 3;
  }
  if (idx === 3 && p && esConfirmado(p.estado)) {
    tiempos[3] = hora(p.created_at);
    idx = 4;
  }
  const fase = e.waygo_fase || "";
  const st = (e.waygo_status_name || "").toLowerCase();
  if (idx >= 4 && (/ruta|route/.test(st) || fase === "novedad")) idx = 4;
  if (fase === "entregado") {
    idx = 6;
    tiempos[4] = "ok";
    tiempos[5] = "ok";
  }
  return { idx, tiempos };
}

type ItemTl = { t: string; chan: string; titulo: string; detalle: string; fuerte: boolean };

function timeline(e: Envio, mensajes: Mensaje[], eventos: Evento[]): ItemTl[] {
  const xs: ItemTl[] = [];
  for (const m of mensajes) {
    if (m.rol === "agente")
      xs.push({ t: m.created_at, chan: m.canal === "whatsapp" ? "WhatsApp" : m.canal, titulo: "Mensaje del agente", detalle: m.texto.slice(0, 110) + (m.texto.length > 110 ? "…" : ""), fuerte: false });
    else if (m.rol === "comprador") xs.push({ t: m.created_at, chan: "WhatsApp", titulo: `Respuesta: «${m.texto.slice(0, 80)}${m.texto.length > 80 ? "…" : ""}»`, detalle: "Comprador", fuerte: true });
    else if (m.rol === "persona") xs.push({ t: m.created_at, chan: "Humano", titulo: "Mensaje de una persona", detalle: m.texto.slice(0, 110), fuerte: true });
  }
  for (const ev of eventos) {
    if (ev.componente === "agente_contacto" && ev.herramienta) continue; // van en el bloque de herramientas
    xs.push({ t: ev.created_at, chan: etiquetaComponente(ev.componente), titulo: ev.mensaje || ev.herramienta || ev.componente, detalle: ev.herramienta || "", fuerte: ev.nivel === "ok" || ev.nivel === "aviso" });
  }
  if (!xs.length) xs.push({ t: e.created_at, chan: "Sistema", titulo: "Ingresó al buffer desde Waygo", detalle: e.waygo_status_name || "", fuerte: false });
  return xs.sort((a, b) => a.t.localeCompare(b.t));
}

function etiquetaComponente(c: string): string {
  const m: Record<string, string> = {
    ingestor: "Waygo",
    sync: "Waygo",
    riesgo: "Riesgo",
    planificador: "Planificador",
    corte: "Corte",
    humano: "Humano",
    control: "Control",
    agente_contacto: "Agente",
    cobro: "Cobro COD",
    supervisor: "Supervisor",
  };
  return m[c] || c;
}

function js(v: unknown, max = 100): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default function DetalleEnvio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { datos } = useEnvio(id);
  const { datos: eventos } = useEventos(200, id);
  const [tomando, setTomando] = useState(false);

  if (!datos) return <section className="screen active"><div className="card empty">Cargando envío…</div></section>;
  const e = datos.envio;
  if (!e)
    return (
      <section className="screen active">
        <div className="card empty">
          Envío no encontrado. <Link href="/buffer">← volver al buffer</Link>
        </div>
      </section>
    );

  const mensajes = datos.mensajes;
  const vigente = datos.promesas.find((p) => p.vigente) ?? null;
  const estado = estadoVista(e, mensajes.some((m) => m.rol === "agente"));
  const { idx, tiempos } = pasos(e, mensajes, vigente);
  const casoAbierto = datos.casos.find((c) => c.estado === "abierto");
  const casoTomado = datos.casos.find((c) => c.estado === "tomado");
  const herramientas = (eventos || []).filter((x) => x.herramienta).slice().reverse();

  async function tomar() {
    const caso = casoTomado ?? casoAbierto;
    if (!caso) return;
    setTomando(true);
    try {
      await post(`/api/casos/${caso.id}/resolver`, { accion: casoTomado ? "devolver" : "tomar" });
      toast(casoTomado ? `Conversación de ${e!.tracking_number} devuelta al agente.` : `Tomaste la conversación de ${e!.tracking_number}. El agente queda en silencio.`);
    } catch (err) {
      toast(textoError(err), "error");
    } finally {
      setTomando(false);
    }
  }

  return (
    <section className="screen active" aria-labelledby="h-env">
      <div className="screen-head">
        <div>
          <h1 id="h-env">
            Envío{" "}
            <span className="mono" style={{ fontSize: ".8em" }}>
              {e.tracking_number}
            </span>
          </h1>
          <div className="sub">
            <ChipEstado estado={estado} detalle={detalleEstado(estado, vigente)} /> ·{" "}
            <span className="fresh">
              <Icono nombre="refresh" />
              actualizado {hace(e.updated_at)}
            </span>{" "}
            · <Link href="/buffer">← volver al buffer</Link>
          </div>
        </div>
        <div className="actions-row">
          <Link className="btn btn-ghost" href={`/whatsapp?envio=${e.id}`}>
            <Icono nombre="phone" />
            Abrir en el simulador
          </Link>
          <span className="tip-wrap" tabIndex={casoAbierto || casoTomado ? -1 : 0}>
            <button className={`btn ${casoTomado ? "btn-primary" : "btn-outline"}`} type="button" onClick={tomar} disabled={(!casoAbierto && !casoTomado) || tomando}>
              <Icono nombre={casoTomado ? "bot" : "chat"} />
              {casoTomado ? "Devolver al agente" : "Tomar conversación"}
            </button>
            {!casoAbierto && !casoTomado && (
              <span className="tip" role="tooltip">
                Disponible cuando el envío tiene un caso abierto en <b>Excepciones</b>: la persona toma la conversación y el agente queda en silencio.
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="env-grid">
        <div className="col">
          <div className="card">
            <div className="kv">
              <div>
                <small>Comprador</small>
                <span>
                  {e.comprador_nombre} <span className="code">{telefonoOculto(e.telefono_e164)}</span>
                </span>
              </div>
              <div>
                <small>Tienda</small>
                <span>{e.tienda}</span>
              </div>
              <div>
                <small>Monto COD</small>
                <span>
                  <b className="num">{cop(e.cod_monto)}</b>
                </span>
              </div>
              <div>
                <small>Dirección</small>
                <span>
                  {(e.direccion || "").split(",")[0]}
                  {e.validacion?.ok !== false && (
                    <span className="geo">
                      <Icono nombre="check" />
                      validada
                    </span>
                  )}
                </span>
              </div>
              <div>
                <small>Zona · hub</small>
                <span>{e.zona || "—"} · Bogotá Sur</span>
              </div>
              <div>
                <small>Riesgo</small>
                <span>
                  <ChipRiesgo riesgo={e.riesgo} />
                </span>
              </div>
              <div>
                <small>Estado en Waygo</small>
                <span>
                  {e.waygo_status_name || e.waygo_status_code || "—"} <span className="code">{e.shipment_type_name || ""}</span>
                </span>
              </div>
              <div>
                <small>Pedido</small>
                <span className="mono" style={{ fontSize: 13 }}>
                  {e.order_number || "—"}
                </span>
              </div>
              <div>
                <small>Experimento</small>
                <span>{e.grupo_control ? "Grupo control" : e.grupo_control === false ? "Piloto" : "Sin sortear"}</span>
              </div>
            </div>
            <h3 style={{ marginTop: 18 }}>Recorrido de la promesa</h3>
            <ol className="stepper">
              {PASOS.map((s, i) => (
                <li key={s} className={i < idx ? "done" : i === idx ? "now" : ""} aria-current={i === idx ? "step" : undefined}>
                  <span className="sdot">{i < idx ? <Icono nombre="check" /> : i + 1}</span>
                  {s}
                  <small>{i < idx ? tiempos[i] || "listo" : i === idx ? "en curso" : "pendiente"}</small>
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Intentos de contacto</h2>
                <div className="sub">Cadencia D-1: WhatsApp 9:00 · recordatorio 12:30 · sin contacto proactivo después de 19:00 (Ley 2300)</div>
              </div>
            </div>
            <ul className="tl">
              {timeline(e, mensajes, eventos || []).map((t, i) => (
                <li key={i}>
                  <span className={`tdot${t.fuerte ? "" : " mute"}`} />
                  <div style={{ minWidth: 0 }}>
                    <b>
                      <span className="chan">{t.chan}</span>
                      {t.titulo}
                    </b>
                    {t.detalle && <p>{t.detalle}</p>}
                  </div>
                  <time>{hora(t.t)}</time>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="col">
          <div className="card promise">
            <div className="card-head" style={{ marginBottom: 0 }}>
              <div>
                <h2>Promesa de entrega</h2>
                <div className="sub">Lo que va en la lista de ruta del corte de las 20:00</div>
              </div>
              {vigente && (
                <span className="fresh">
                  <Icono nombre="refresh" />v{vigente.version} · {hace(vigente.vigente_desde)}
                </span>
              )}
            </div>
            <div className="big">
              <ChipEstado estado={vigente?.estado || estado} detalle={detalleEstado(vigente?.estado || estado, vigente)} />
              <span className="code">{vigente?.estado || e.estado_buffer}</span>
              {vigente?.tardia && <span className="chip c-warn">Tardía (después del corte)</span>}
            </div>
            <div className="kv">
              <div>
                <small>Franja</small>
                <span>{vigente ? franja(vigente.franja_inicio, vigente.franja_fin) || (esConfirmado(vigente.estado) ? "Todo el día" : "—") : "—"}</span>
              </div>
              <div>
                <small>Confianza</small>
                <span className="num">{vigente?.confianza !== null && vigente?.confianza !== undefined ? `${Math.round((num(vigente.confianza) || 0) * 100)} %` : e.grupo_control ? "n/a (control)" : "—"}</span>
              </div>
              <div>
                <small>Fecha de entrega</small>
                <span>{vigente?.fecha_entrega ? fechaCorta(vigente.fecha_entrega) : "—"}</span>
              </div>
              <div>
                <small>Pago</small>
                <span>{vigente?.preferencia_pago ? PREFERENCIA_PAGO[vigente.preferencia_pago] || vigente.preferencia_pago : "—"}</span>
              </div>
              <div>
                <small>Nota al mensajero</small>
                <span>{vigente?.nota_mensajero || "—"}</span>
              </div>
              <div>
                <small>Origen · versiones</small>
                <span>
                  {vigente?.origen || "—"} · {datos.promesas.length}
                </span>
              </div>
            </div>
            {datos.casos.length > 0 && (
              <div className="reco" style={{ marginTop: 12 }}>
                <small>Casos</small>
                {datos.casos.map((c) => (
                  <div key={c.id}>
                    {defCaso(c.tipo).label} · <b>{c.estado}</b> · {fechaHora(c.created_at)}
                  </div>
                ))}
              </div>
            )}
            <pre className="tools">
              <span className="c"># herramientas MCP invocadas para este envío</span>
              {"\n"}
              {!herramientas.length && <span className="c">(ninguna todavía)</span>}
              {herramientas.map((h) => (
                <span key={h.id}>
                  <span className="c">{hora(h.created_at, true)} </span>
                  <span className="fn">{h.herramienta}</span>(<span className="s">{js(h.entrada, 70)}</span>){"  "}
                  <span className={h.nivel === "error" ? "c" : "ok"}>{h.nivel === "error" ? "✗ " : "✓ "}{js(h.resultado, 80)}</span>
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="wa" style={{ borderRadius: "var(--r-lg)" }}>
              <div className="wa-head">
                <div className="av">{iniciales(e.tienda)}</div>
                <div>
                  <b>{e.tienda} · Entregas</b>
                  <small>Conversación del agente con {e.comprador_nombre}</small>
                </div>
              </div>
              {e.grupo_control && <div className="sys">Envío del grupo control · no recibe mensajes</div>}
              {!mensajes.length && !e.grupo_control && <div className="sys">Sin mensajes todavía</div>}
              {mensajes.map((m, i) => {
                const sig = mensajes.slice(i + 1).find((x) => x.rol === "comprador");
                return <Burbuja key={m.id} rol={m.rol} texto={m.texto} hora={hora(m.created_at)} botones={m.botones} elegido={sig?.texto} />;
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
