"use client";
// Actividad de agentes (mockup #agentes): registro EN VIVO desde `eventos`, los 11 componentes e interruptor global.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icono } from "@/components/Iconos";
import { useBuffer, useConfig, useEventos } from "@/hooks/datos";
import { post, textoError } from "@/lib/ui/api";
import { fmtInt, hora } from "@/lib/ui/formato";
import { toast } from "@/lib/ui/toast";
import type { Evento } from "@/lib/ui/tipos";

type Componente = {
  nombre: string;
  icono: string;
  nivel: string;
  tipo: "IA" | "Worker";
  desc: string;
  enDemo: boolean;
  coincide: (e: Evento) => boolean;
};

const txt = (e: Evento) => `${e.componente} ${e.herramienta || ""}`.toLowerCase();

// 3 agentes de IA + 8 workers (arquitectura v1 · §3.3.1.b)
const COMPONENTES: Componente[] = [
  { nombre: "Agente de contacto", icono: "chat", nivel: "N3", tipo: "IA", desc: "WhatsApp y voz · registra la intención con evidencia", enDemo: true, coincide: (e) => /agente_contacto|chat|dia_d|registrar_intencion|envio_contexto|proponer_cambio|politicas/.test(txt(e)) },
  { nombre: "Supervisor de excepciones", icono: "users", nivel: "N1", tipo: "IA", desc: "Clasifica y pasa los casos delicados a una persona", enDemo: true, coincide: (e) => /supervisor|escalar|caso|humano/.test(txt(e)) },
  { nombre: "Copiloto de operación", icono: "bot", nivel: "N1", tipo: "IA", desc: "Consultas en lenguaje natural · solo lectura · fase 3", enDemo: false, coincide: (e) => /copiloto/.test(txt(e)) },
  { nombre: "Validador de datos y dirección", icono: "check", nivel: "N3", tipo: "Worker", desc: "Teléfono E.164, dirección y COD > 0", enDemo: true, coincide: (e) => /ingestor|sync|validador|waygo/.test(txt(e)) },
  { nombre: "Analista de riesgo", icono: "shield", nivel: "N3", tipo: "Worker", desc: "Prioridad P = R × M × U · grupo control", enDemo: true, coincide: (e) => /riesgo|preparar|grupo_control|control_sorteo/.test(txt(e)) },
  { nombre: "Planificador de contacto", icono: "clock", nivel: "N3", tipo: "Worker", desc: "Ola 9:00 y recordatorio 12:30 · Ley 2300", enDemo: true, coincide: (e) => /planificador|ola|recordatorio|plantilla/.test(txt(e)) },
  { nombre: "Cobro COD", icono: "cash", nivel: "N3", tipo: "Worker", desc: "Enlace por el cod_amount exacto · nunca el del modelo", enDemo: true, coincide: (e) => /cobro|pago/.test(txt(e)) },
  { nombre: "Gestor de corte", icono: "layers", nivel: "N3", tipo: "Worker", desc: "Congela el snapshot y publica la lista de ruta 20:00", enDemo: true, coincide: (e) => /corte/.test(txt(e)) },
  { nombre: "Enlace con mensajero", icono: "truck", nivel: "N3", tipo: "Worker", desc: "Avisos por Forms al conductor · fase 3", enDemo: false, coincide: (e) => /mensajero|forms/.test(txt(e)) },
  { nombre: "Conciliador COD", icono: "scale", nivel: "N2", tipo: "Worker", desc: "Propone; finanzas aprueba · fase 4", enDemo: false, coincide: (e) => /concilia/.test(txt(e)) },
  { nombre: "Auditor de evidencia", icono: "check", nivel: "N1", tipo: "Worker", desc: "POD y fotos · marca excepciones · fase 4", enDemo: false, coincide: (e) => /auditor/.test(txt(e)) },
];

function tag(e: Evento): [string, string] {
  const t = txt(e);
  if (e.nivel === "error") return ["ERROR", "t-risk"];
  if (/pausa|kill|reanud/.test(t)) return [/reanud/.test(t) || (e.entrada as { pausado?: boolean })?.pausado === false ? "REANUDAR" : "KILL_SWITCH", "t-risk"];
  if (e.componente === "humano" || /resolver/.test(t)) return ["HUMANO", "t-acc"];
  if (/escalar|caso|supervisor/.test(t)) return ["ESCALAR", "t-warn"];
  if (/pago|cobro/.test(t)) return ["PAGO", "t-vio"];
  if (/recordatorio/.test(t)) return ["RECORDAR", "t-info"];
  if (/dia_d|dia-d/.test(t)) return ["DÍA D", "t-info"];
  if (/ola|plantilla|planificador/.test(t)) return ["CONTACTAR", "t-info"];
  if (/registrar_intencion|intencion/.test(t)) return ["CONFIRMAR", "t-ok"];
  if (/proponer_cambio/.test(t)) return ["REPROGRAMAR", "t-info"];
  if (/envio_contexto|politicas/.test(t)) return ["CONSULTAR", "t-info"];
  if (/agente_contacto|chat/.test(t)) return ["CONVERSAR", "t-ok"];
  if (/corte/.test(t)) return ["CORTE", "t-acc"];
  if (/riesgo|preparar|grupo_control/.test(t)) return ["RIESGO", "t-info"];
  if (/sync|ingestor|waygo/.test(t)) return ["WAYGO", "t-ok"];
  if (/reset|control/.test(t)) return ["CONTROL", "t-acc"];
  return [(e.herramienta || e.componente).toUpperCase().slice(0, 14), "t-info"];
}

const esEscalado = (e: Evento) => e.nivel === "aviso" || e.nivel === "error" || ["ESCALAR", "HUMANO", "KILL_SWITCH", "REANUDAR", "ERROR"].includes(tag(e)[0]);
const esContacto = (e: Evento) => ["CONTACTAR", "RECORDAR", "CONFIRMAR", "CONVERSAR", "DÍA D", "REPROGRAMAR", "PAGO"].includes(tag(e)[0]);

function nombreComponente(e: Evento): string {
  return COMPONENTES.find((c) => c.coincide(e))?.nombre || (e.componente === "humano" ? "Supervisor de torre" : e.componente);
}

export default function Agentes() {
  const { datos: eventos } = useEventos(400);
  const { datos: config, recargar } = useConfig();
  const { filas } = useBuffer();
  const [filtro, setFiltro] = useState<"all" | "esc" | "contact">("all");
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const pausados = !!config?.agentes_pausados;
  const vistos = useRef<Set<string> | null>(null);
  const cancelar = useRef<HTMLButtonElement>(null);

  const guias = useMemo(() => new Map((filas || []).map((f) => [f.envio.id, f.envio.tracking_number])), [filas]);
  const lista = (eventos || []).filter((e) => e.nivel !== "debug");
  const nuevos = useMemo(() => {
    const s = new Set<string>();
    if (!eventos) return s;
    if (vistos.current) for (const e of eventos) if (!vistos.current.has(e.id)) s.add(e.id);
    return s;
  }, [eventos]);
  useEffect(() => {
    if (eventos) vistos.current = new Set(eventos.map((e) => e.id));
  }, [eventos]);
  useEffect(() => {
    if (confirmar) cancelar.current?.focus();
  }, [confirmar]);

  const visibles = lista.filter((e) => filtro === "all" || (filtro === "esc" ? esEscalado(e) : esContacto(e)));

  async function pausar(p: boolean) {
    setOcupado(true);
    try {
      await post("/api/demo/pausa", { pausado: p });
      toast(p ? "Agentes pausados. Waygo rutea como hoy." : "Agentes reanudados.");
      setConfirmar(false);
      recargar();
    } catch (e) {
      toast(textoError(e), "error");
    } finally {
      setOcupado(false);
    }
  }

  const activos = COMPONENTES.filter((c) => c.enDemo).length;

  return (
    <section className="screen active" aria-labelledby="h-ag">
      <div className="screen-head">
        <div>
          <h1 id="h-ag">Actividad de agentes</h1>
          <div className="sub">
            Cada acción queda registrada con su herramienta y resultado ·{" "}
            <span className="fresh">
              <Icono nombre="refresh" />
              en vivo
            </span>
          </div>
        </div>
      </div>

      <div className="card kill">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icono nombre="shield" />
            Interruptor global
          </h2>
          <p>
            Detiene todos los contactos y decisiones automáticas. <b>Fail-open:</b> si los agentes paran, Waygo rutea el buffer como hoy; nada queda retenido.
          </p>
        </div>
        {pausados ? (
          <button className="btn btn-outline" type="button" disabled={ocupado} onClick={() => pausar(false)}>
            <Icono nombre="play" />
            Reanudar agentes
          </button>
        ) : (
          !confirmar && (
            <button className="btn btn-danger" type="button" onClick={() => setConfirmar(true)}>
              <Icono nombre="pause" />
              Pausar agentes (fail-open: Waygo rutea como hoy)
            </button>
          )
        )}
        <div className={`kill-confirm${confirmar && !pausados ? " open" : ""}`} role="region" aria-label="Confirmar pausa">
          <b>¿Pausar los 3 agentes de IA y los 8 workers ahora?</b>
          <ul>
            <li>Se cancelan los contactos en cola (ola, recordatorio y respuestas del agente).</li>
            <li>Los estados ya registrados se conservan y entran a la lista de ruta del corte de las 20:00.</li>
            <li>Los envíos sin estado van a ruta con el criterio actual de Waygo.</li>
          </ul>
          <div className="actions-row">
            <button ref={cancelar} className="btn btn-ghost" type="button" onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
            <button className="btn btn-danger" type="button" disabled={ocupado} onClick={() => pausar(true)}>
              <Icono nombre="pause" />
              Sí, pausar todos
            </button>
          </div>
        </div>
      </div>

      <div className="ag-grid">
        <div className="term" aria-label="Registro de actividad de agentes">
          <div className="term-head">
            <b>
              <span className={`dot-live${pausados ? " dot-off" : ""}`} />
              Registro en vivo
            </b>
            <div className="seg" role="group" aria-label="Filtro del registro">
              {(
                [
                  ["all", "Todo"],
                  ["esc", "Escalados"],
                  ["contact", "Contactos"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <ul className="log" aria-live="polite">
            {!eventos && (
              <li>
                <span className="desc">Cargando…</span>
              </li>
            )}
            {eventos && !visibles.length && (
              <li>
                <time />
                <span />
                <span className="desc">
                  <em>Sin eventos para este filtro.</em>
                </span>
              </li>
            )}
            {visibles.map((e) => {
              const [t, cls] = tag(e);
              const guia = e.envio_id ? guias.get(e.envio_id) : null;
              const res = e.nivel === "ok" ? "✓" : e.nivel === "aviso" ? "!1" : e.nivel === "error" ? "✗" : "·";
              return (
                <li key={e.id} className={nuevos.has(e.id) ? "new" : undefined}>
                  <time>{hora(e.created_at, true)}</time>
                  <span className={`tag ${cls}`}>{t}</span>
                  <span className="desc">
                    {guia && <span className="mono" style={{ fontSize: 11.5 }}>{guia} · </span>}
                    {e.mensaje || e.herramienta || e.componente} <em>· {nombreComponente(e)}</em>
                  </span>
                  <span className={`res${/^!|✗/.test(res) ? " r" : ""}`}>{res}</span>
                </li>
              );
            })}
          </ul>
          <div className="term-foot">
            <span>{pausados ? "0 agentes activos · fail-open" : `${activos} de 11 componentes encendidos en el demo`}</span>
            <span>{fmtInt(lista.length)} eventos recientes</span>
            <span>herramientas MCP auditadas en `eventos`</span>
            <span>gobernanza: activa</span>
          </div>
        </div>
        <div className="col">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Agentes y workers</h2>
                <div className="sub">3 agentes de IA + 8 workers · contadores sobre los eventos del demo</div>
              </div>
            </div>
            <ul className="agents">
              {COMPONENTES.map((c) => {
                const evs = lista.filter(c.coincide);
                const esc = evs.filter((e) => e.nivel === "aviso" || e.nivel === "error" || /escalar|caso/.test(txt(e))).length;
                const st = pausados && c.enDemo ? ["c-warn", "Pausado"] : c.enDemo ? ["c-ok", "Activo"] : ["c-idle", "En espera"];
                return (
                  <li key={c.nombre} className="agent">
                    <span className="ai">
                      <Icono nombre={c.icono} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <b>
                        {c.nombre} <span className={`chip nodot ${c.tipo === "IA" ? "c-dig" : "c-idle"}`} style={{ fontSize: 11, padding: "0 7px", marginLeft: 4 }}>{c.tipo === "IA" ? "IA" : "código"}</span>
                      </b>
                      <small>
                        <span className="lvl">{c.nivel}</span>
                        {c.desc}
                      </small>
                      <div style={{ marginTop: 4 }}>
                        <span className={`chip ${st[0]}`}>{st[1]}</span>
                      </div>
                    </div>
                    <div className="cnts num">
                      <div>
                        <b>{fmtInt(evs.length)}</b>
                        <br />
                        acciones
                      </div>
                      <div>
                        <b>{fmtInt(esc)}</b>
                        <br />
                        escalados
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>Niveles de autonomía</h3>
            <div className="autonomy">
              <div>
                <span className="lvl">N1</span>
                <b>Sugiere</b>
                <br />
                Un humano ejecuta.
              </div>
              <div>
                <span className="lvl">N2</span>
                <b>Actúa con aprobación</b>
                <br />
                Pasa por la bandeja.
              </div>
              <div>
                <span className="lvl">N3</span>
                <b>Autónomo con límites</b>
                <br />
                Montos, horario y cadencia acotados.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
