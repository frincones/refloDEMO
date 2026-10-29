"use client";
// Resultados (mockup #kpis) calculados de la base del demo. Etiquetados como "Datos del demo".
import { Icono } from "@/components/Iconos";
import { useBuffer, useCasos } from "@/hooks/datos";
import { useConsulta } from "@/hooks/useConsulta";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ORDEN_ESTADOS, defEstado, esConfirmado } from "@/lib/ui/estados";
import { cop, fmtInt, num, pct } from "@/lib/ui/formato";
import type { FilaBuffer } from "@/hooks/datos";

type MsgHora = { rol: string; created_at: string };

function horaBog(iso: string): number {
  return (new Date(iso).getUTCHours() + 19) % 24; // UTC-5
}

function tasa(n: number, d: number) {
  return d ? pct((n / d) * 100) : "—";
}

function metricas(fs: FilaBuffer[]) {
  const contactados = fs.filter((f) => f.ultimoAgente).length;
  const respondieron = fs.filter((f) => f.ultimoMensaje && f.nMensajes > 1).length;
  const confirmados = fs.filter((f) => esConfirmado(f.estado)).length;
  const entregados = fs.filter((f) => f.envio.waygo_fase === "entregado").length;
  const novedad = fs.filter((f) => f.envio.waygo_fase === "novedad" || f.envio.waygo_fase === "devolucion" || f.envio.waygo_fase === "devuelto").length;
  return { n: fs.length, contactados, respondieron, confirmados, entregados, novedad };
}

export default function Resultados() {
  const { filas, actualizado } = useBuffer();
  const { datos: casos } = useCasos();
  const { datos: msgs } = useConsulta<MsgHora[]>(
    "kpi-mensajes",
    async () => {
      const { data } = await supabaseBrowser().from("mensajes").select("rol, created_at").order("created_at").limit(5000);
      return (data as MsgHora[]) || [];
    },
    ["mensajes"],
    { espera: 800 },
  );

  const todas = filas || [];
  const piloto = todas.filter((f) => f.estado !== "GRUPO_CONTROL" && f.envio.grupo_control !== true);
  const control = todas.filter((f) => f.estado === "GRUPO_CONTROL" || f.envio.grupo_control === true);
  const mp = metricas(piloto);
  const mc = metricas(control);
  const codConf = piloto.filter((f) => esConfirmado(f.estado)).reduce((s, f) => s + (num(f.envio.cod_monto) || 0), 0);
  const digital = piloto.filter((f) => f.estado === "CONFIRMADO_PREPAGO").length;
  const escalados = (casos || []).length;

  // Distribución por estado
  const dist = ORDEN_ESTADOS.map((e) => [e, todas.filter((f) => f.estado === e).length] as const).filter(([, n]) => n > 0);
  const maxD = Math.max(1, ...dist.map(([, n]) => n));

  // Actividad por hora (mensajes del agente vs respuestas del comprador)
  const horas = Array.from({ length: 14 }, (_, i) => i + 7); // 7:00–20:00
  const porHora = (rol: string) => horas.map((h) => (msgs || []).filter((m) => m.rol === rol && horaBog(m.created_at) === h).length);
  const ag = porHora("agente");
  const co = porHora("comprador");
  const maxH = Math.max(4, ...ag, ...co);

  const W = 640, H = 260, L = 40, R = 24, T = 16, B = 34;
  const x = (i: number) => L + (i * (W - L - R)) / (horas.length - 1);
  const y = (v: number) => T + ((maxH - v) * (H - T - B)) / maxH;
  const path = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const pasoY = Math.max(1, Math.ceil(maxH / 4));

  return (
    <section className="screen active" aria-labelledby="h-kpi">
      <div className="screen-head">
        <div>
          <h1 id="h-kpi">Resultados del demo</h1>
          <div className="sub">
            Bogotá Sur · piloto vs grupo control (sin contacto) · <span className="sample-tag">Datos del demo</span>
          </div>
        </div>
        <span className="fresh">
          <Icono nombre="refresh" />
          {actualizado ? "en vivo" : "cargando…"}
        </span>
      </div>

      <div className="kpis">
        <div className="card kpi hero">
          <div className="lab">Tasa de confirmación</div>
          <div className="kpi-val num">{tasa(mp.confirmados, mp.n)}</div>
          <div className="cmp">
            {mp.confirmados} de {mp.n} del piloto · sobre contactados: <b>{tasa(mp.confirmados, mp.contactados)}</b>
          </div>
        </div>
        <div className="card kpi">
          <div className="lab">Tasa de contacto</div>
          <div className="kpi-val num">{tasa(mp.contactados, mp.n)}</div>
          <div className="cmp">{mp.contactados} contactados por WhatsApp</div>
        </div>
        <div className="card kpi">
          <div className="lab">Respondieron</div>
          <div className="kpi-val num">{tasa(mp.respondieron, mp.contactados)}</div>
          <div className="cmp">{mp.respondieron} compradores escribieron</div>
        </div>
        <div className="card kpi">
          <div className="lab">COD con promesa</div>
          <div className="kpi-val num">{cop(codConf)}</div>
          <div className="cmp">{digital} pasaron a pago digital</div>
        </div>
        <div className="card kpi">
          <div className="lab">Casos a una persona</div>
          <div className="kpi-val num">{fmtInt(escalados)}</div>
          <div className="cmp">{(casos || []).filter((c) => c.estado === "abierto").length} pendientes de aprobación</div>
        </div>
      </div>

      <div className="charts">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Actividad por hora</h2>
              <div className="sub">Mensajes del agente (línea continua) vs respuestas del comprador (punteada)</div>
            </div>
            <span className="sample-tag">Datos del demo</span>
          </div>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mensajes por hora del agente y del comprador, datos del demo">
            {Array.from({ length: Math.floor(maxH / pasoY) + 1 }, (_, i) => i * pasoY).map((v) => (
              <g key={v}>
                <line className="gl" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
                <text className="ax" x={L - 8} y={y(v) + 4} textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {horas.map((h, i) =>
              i % 2 === 0 ? (
                <text key={h} className="ax" x={x(i)} y={H - 12} textAnchor="middle">
                  {h}:00
                </text>
              ) : null,
            )}
            <path className="area" d={`${path(ag)} L${x(horas.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} />
            <path className="sb" d={path(co)} />
            <path className="sa" d={path(ag)} />
            <text className="lbl a" x={L + 6} y={T + 4}>
              Agente {ag.reduce((a, b) => a + b, 0)}
            </text>
            <text className="lbl b" x={L + 96} y={T + 4}>
              Comprador {co.reduce((a, b) => a + b, 0)}
            </text>
          </svg>
          <div className="card-head" style={{ marginTop: 16 }}>
            <div>
              <h2>Distribución por estado de intención</h2>
              <div className="sub">Todos los envíos del demo</div>
            </div>
          </div>
          <svg className="chart" viewBox={`0 0 640 ${Math.max(40, dist.length * 30 + 10)}`} role="img" aria-label="Barras por estado de intención">
            {dist.map(([e, n], i) => {
              const w = ((640 - 230 - 50) * n) / maxD;
              const yy = 6 + i * 30;
              return (
                <g key={e}>
                  <text className="ax" x={222} y={yy + 15} textAnchor="end" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10.5 }}>
                    {e}
                  </text>
                  <rect x={230} y={yy} width={Math.max(3, w)} height={20} rx={5} style={{ fill: `var(${defEstado(e).seg})` }} />
                  <text className="val" x={230 + w + 6} y={yy + 15}>
                    {n}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Piloto vs grupo control</h2>
              <div className="sub">Intención de tratar · el control no recibe contactos</div>
            </div>
          </div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="cmp-table num">
              <thead>
                <tr>
                  <th>Métrica</th>
                  <th>Piloto</th>
                  <th>Control</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Envíos asignados</td>
                  <td>{mp.n}</td>
                  <td>{mc.n}</td>
                </tr>
                <tr>
                  <td>Contactados</td>
                  <td>{tasa(mp.contactados, mp.n)}</td>
                  <td>{tasa(mc.contactados, mc.n)}</td>
                </tr>
                <tr>
                  <td>Con promesa confirmada</td>
                  <td>{tasa(mp.confirmados, mp.n)}</td>
                  <td>{tasa(mc.confirmados, mc.n)}</td>
                </tr>
                <tr>
                  <td>Entregados (Waygo)</td>
                  <td>{tasa(mp.entregados, mp.n)}</td>
                  <td>{tasa(mc.entregados, mc.n)}</td>
                </tr>
                <tr>
                  <td>Novedad o devolución</td>
                  <td>{tasa(mp.novedad, mp.n)}</td>
                  <td>{tasa(mc.novedad, mc.n)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <svg className="chart" viewBox="0 0 320 120" role="img" aria-label="Confirmación piloto vs control" style={{ marginTop: 12 }}>
            {(
              [
                ["Piloto", mp.n ? (mp.confirmados / mp.n) * 100 : 0, "bar-a"],
                ["Control", mc.n ? (mc.confirmados / mc.n) * 100 : 0, "bar-b"],
              ] as const
            ).map(([l, v, c], i) => {
              const w = ((320 - 74 - 50) * v) / 100;
              const yy = 8 + i * 36;
              return (
                <g key={l}>
                  <text className="ax" x={66} y={yy + 15} textAnchor="end">
                    {l}
                  </text>
                  <rect className={c} x={74} y={yy} width={Math.max(3, w)} height={22} rx={5} />
                  <text className="val" x={74 + w + 6} y={yy + 15}>
                    {pct(v)}
                  </text>
                </g>
              );
            })}
            <text className="ax" x={74} y={100}>
              Promesa confirmada sobre envíos asignados
            </text>
          </svg>
          <p className="note">
            Sorteo aleatorio del grupo control al preparar el buffer. Con pocos envíos de prueba las cifras no son estadísticamente significativas: muestran cómo se mide el piloto.
          </p>
        </div>
      </div>
    </section>
  );
}
