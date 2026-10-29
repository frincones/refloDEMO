"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icono } from "@/components/Iconos";
import { ChipEstado, ChipRiesgo, Confianza } from "@/components/consola/Chips";
import { CuentaRegresiva, ahoraSimulado, fechaManana } from "@/components/consola/Cuenta";
import { Ticker } from "@/components/consola/Ticker";
import { useBuffer, useConfig, useUltimoCorte, type FilaBuffer } from "@/hooks/datos";
import { exportarListaRuta } from "@/lib/ui/corte";
import { ORDEN_ESTADOS, defEstado, detalleEstado, esConfirmado, nivelRiesgo, proximaAccion } from "@/lib/ui/estados";
import { cop, fmtInt, hace, hora, nombreCorto, num, pct } from "@/lib/ui/formato";
import type { EstadoVista } from "@/lib/ui/tipos";

type Tile = { k: string; lab: string; test: (f: FilaBuffer) => boolean };
const TILES: Tile[] = [
  { k: "all", lab: "Total en buffer", test: () => true },
  { k: "conf", lab: "Confirmados", test: (f) => esConfirmado(f.estado) },
  { k: "cont", lab: "En contacto", test: (f) => f.estado === "CONTACTANDO" },
  { k: "pend", lab: "Sin contactar", test: (f) => ["PENDIENTE_CONTACTO", "NO_CONTACTADO", "NUMERO_INVALIDO"].includes(f.estado) },
  { k: "repr", lab: "Reprogramados", test: (f) => f.estado === "REPROGRAMADO" || f.estado === "SIN_PAGO_HOY" },
  { k: "risk", lab: "Riesgo y excepciones", test: (f) => nivelRiesgo(f.envio.riesgo) === "alto" || ["RIESGO_FRAUDE", "RECHAZADO", "DIRECCION_EN_VALIDACION"].includes(f.estado) || !!f.casoAbierto },
];

function canal(f: FilaBuffer): [string, string] {
  const m = f.ultimoMensaje;
  if (!m) return f.estado === "GRUPO_CONTROL" ? ["—", "sin contacto (control)"] : f.estado === "NUMERO_INVALIDO" ? ["—", "teléfono no válido"] : ["—", "sin contacto aún"];
  const can = m.rol === "persona" ? "Humano" : m.canal === "whatsapp" ? "WhatsApp" : m.canal;
  const que = m.rol === "comprador" ? "respondió" : m.rol === "agente" ? "enviado" : m.rol === "persona" ? "persona" : "sistema";
  return [can, `${hora(m.created_at)} · ${que}`];
}

export default function Buffer() {
  const router = useRouter();
  const { filas, actualizado } = useBuffer();
  const { datos: config } = useConfig();
  const { datos: corte } = useUltimoCorte();
  const [tile, setTile] = useState("all");
  const [busca, setBusca] = useState("");
  const [zona, setZona] = useState("");
  const [riesgo, setRiesgo] = useState("");
  const [monto, setMonto] = useState("");
  const [cargado, setCargado] = useState<number | null>(null);
  useEffect(() => setCargado(Date.now()), []);

  const todas = filas || [];
  const total = todas.length;
  const zonas = useMemo(() => Array.from(new Set(todas.map((f) => f.envio.zona).filter(Boolean) as string[])).sort(), [todas]);

  const conteo = useMemo(() => {
    const c = new Map<EstadoVista, number>();
    for (const f of todas) c.set(f.estado, (c.get(f.estado) || 0) + 1);
    return c;
  }, [todas]);

  const tdef = TILES.find((t) => t.k === tile)!;
  const visibles = todas.filter((f) => {
    if (!tdef.test(f)) return false;
    if (zona && f.envio.zona !== zona) return false;
    if (riesgo && nivelRiesgo(f.envio.riesgo) !== riesgo) return false;
    const m = num(f.envio.cod_monto) ?? 0;
    if (monto === "alto" && m <= 1000000) return false;
    if (monto === "mid" && (m < 200000 || m > 1000000)) return false;
    if (monto === "bajo" && m >= 200000) return false;
    const q = busca.trim().toLowerCase();
    if (q) {
      const hay = `${f.envio.tracking_number} ${f.envio.tienda} ${f.envio.comprador_nombre} ${f.envio.zona} ${f.envio.telefono_e164}`.toLowerCase();
      if (q.split(/\s+/).some((w) => !hay.includes(w))) return false;
    }
    return true;
  });

  // Puntajes (calculados sobre los datos del demo)
  const piloto = todas.filter((f) => f.estado !== "GRUPO_CONTROL");
  const confirmados = piloto.filter((f) => esConfirmado(f.estado));
  const contactados = piloto.filter((f) => f.ultimoAgente);
  const codConf = confirmados.reduce((s, f) => s + (num(f.envio.cod_monto) || 0), 0);
  const prepago = piloto.filter((f) => f.estado === "CONFIRMADO_PREPAGO").length;

  const ahora = cargado ? ahoraSimulado(config, cargado) : null;

  return (
    <section className="screen active" aria-labelledby="h-buffer">
      <Ticker />
      <div className="screen-head">
        <div>
          <h1 id="h-buffer">Buffer del corte · Bogotá Sur</h1>
          <div className="sub">
            Entregas para <b>mañana{ahora ? " " + fechaManana(ahora) : ""}</b> ·{" "}
            <span className="fresh">
              <Icono nombre="refresh" />
              {actualizado ? `actualizado ${hace(new Date(actualizado).toISOString())}` : "cargando…"} · en vivo
            </span>
          </div>
        </div>
        <CuentaRegresiva config={config} corte={corte} />
      </div>

      <div className="tiles" role="group" aria-label="Filtros por estado">
        {TILES.map((t) => {
          const n = todas.filter(t.test).length;
          return (
            <button key={t.k} type="button" className="tile" aria-pressed={t.k === tile} onClick={() => setTile(t.k)}>
              <span className="tile-top">
                <span>{t.lab}</span>
                <span className="box" aria-hidden="true" />
              </span>
              <span className="tile-num">{filas ? fmtInt(n) : "…"}</span>
              <span className="tile-sub">{t.k === "all" ? "envíos para mañana" : total ? `${pct((n / total) * 100)} del buffer` : "—"}</span>
            </button>
          );
        })}
      </div>

      <div className="scores">
        <div className="score">
          <span>Tasa de confirmación (D-1)</span>
          <b className="num">{piloto.length ? pct((confirmados.length / piloto.length) * 100) : "—"}</b>
          <span className="delta" style={{ color: "var(--muted)", fontWeight: 600 }}>
            {confirmados.length} de {piloto.length} del piloto
          </span>
        </div>
        <div className="score">
          <span>Contactados por WhatsApp</span>
          <b className="num">{piloto.length ? pct((contactados.length / piloto.length) * 100) : "—"}</b>
          <span className="delta" style={{ color: "var(--muted)", fontWeight: 600 }}>
            {contactados.length} conversaciones
          </span>
        </div>
        <div className="score">
          <span>COD confirmado</span>
          <b className="num">{cop(codConf)}</b>
          <span className="delta">{prepago ? `${prepago} pasaron a pago digital` : "datos del demo"}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Distribución por estado de intención</h2>
            <div className="sub">El estado (con confianza y vigencia) es lo que viaja a la lista de ruta en el corte</div>
          </div>
          <span className="fresh">
            <Icono nombre="refresh" />
            en vivo
          </span>
        </div>
        <div className="stack" role="img" aria-label="Barra apilada de estados de intención">
          {ORDEN_ESTADOS.filter((e) => conteo.get(e)).map((e) => (
            <span key={e} style={{ width: `${((conteo.get(e) || 0) / Math.max(total, 1)) * 100}%`, background: `var(${defEstado(e).seg})` }} title={`${e}: ${conteo.get(e)}`} />
          ))}
        </div>
        <div className="legend">
          {ORDEN_ESTADOS.filter((e) => conteo.get(e)).map((e) => {
            const n = conteo.get(e) || 0;
            return (
              <div key={e}>
                <i style={{ background: `var(${defEstado(e).seg})`, outline: e === "GRUPO_CONTROL" ? "1px dashed var(--muted)" : undefined }} />
                <span className="mono" style={{ fontSize: 11 }}>
                  {e}
                </span>
                <b className="num">{n}</b>
                <span className="num">{pct((n / Math.max(total, 1)) * 100)}</span>
              </div>
            );
          })}
          {!total && <div>Sin envíos en el buffer. Sincroniza con Waygo desde Control del demo.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Envíos en buffer</h2>
            <div className="sub">{tile === "all" ? "Mostrando todos los estados" : `Filtro activo: ${tdef.lab}`}</div>
          </div>
          <div className="actions-row">
            <button className="btn btn-outline" type="button" onClick={() => exportarListaRuta(corte)} title={corte ? `Corte v${corte.version} · ${corte.fecha}` : "Aún no hay corte congelado"}>
              <Icono nombre="download" />
              Exportar lista de ruta
            </button>
            <span className="tip-wrap" tabIndex={0} aria-describedby="tipWaygo">
              <button className="btn btn-primary" type="button" disabled aria-disabled="true">
                <Icono nombre="lock" />
                Enviar a despacho (Waygo)
              </button>
              <span className="tip" role="tooltip" id="tipWaygo">
                <b>Fase 2 (C-03).</b> En el piloto la torre entrega la lista de ruta en la consola o como CSV y despacho arma la ruta en Waygo como hoy. El envío directo por API a Waygo se activa cuando el piloto demuestre la mejora frente al grupo control y esté acordado el contrato de datos.
              </span>
            </span>
          </div>
        </div>
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="search">
            <Icono nombre="search" />
            <span className="sr-only">Filtrar tabla</span>
            <input type="search" placeholder="Filtrar por guía, comprador o tienda" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>
          <label className="sr-only" htmlFor="fZona">Zona</label>
          <select className="select" id="fZona" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {zonas.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="fRiesgo">Riesgo</label>
          <select className="select" id="fRiesgo" value={riesgo} onChange={(e) => setRiesgo(e.target.value)}>
            <option value="">Todo riesgo</option>
            <option value="alto">Riesgo alto</option>
            <option value="medio">Riesgo medio</option>
            <option value="bajo">Riesgo bajo</option>
          </select>
          <label className="sr-only" htmlFor="fMonto">Monto</label>
          <select className="select" id="fMonto" value={monto} onChange={(e) => setMonto(e.target.value)}>
            <option value="">Todo monto COD</option>
            <option value="alto">COD &gt; $1.000.000</option>
            <option value="mid">$200.000 – $1.000.000</option>
            <option value="bajo">&lt; $200.000</option>
          </select>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              setBusca("");
              setZona("");
              setRiesgo("");
              setMonto("");
              setTile("all");
            }}
          >
            Limpiar
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Guía</th>
                <th>Tienda</th>
                <th>Comprador</th>
                <th>Zona</th>
                <th className="r">Monto COD</th>
                <th>Riesgo</th>
                <th>Estado intención</th>
                <th>Canal · último contacto</th>
                <th>Próxima acción</th>
                <th className="r">Confianza</th>
              </tr>
            </thead>
            <tbody>
              {!filas && (
                <tr>
                  <td colSpan={10} className="empty">
                    Cargando envíos…
                  </td>
                </tr>
              )}
              {filas && !visibles.length && (
                <tr>
                  <td colSpan={10} className="empty">
                    Ningún envío coincide con los filtros.
                  </td>
                </tr>
              )}
              {visibles.map((f) => {
                const [can, ult] = canal(f);
                const ir = () => router.push(`/envio/${f.envio.id}`);
                return (
                  <tr
                    key={f.envio.id}
                    tabIndex={0}
                    aria-label={`Ver envío ${f.envio.tracking_number}`}
                    onClick={ir}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        ir();
                      }
                    }}
                  >
                    <td>
                      <span className="guia">{f.envio.tracking_number}</span>
                    </td>
                    <td>{f.envio.tienda}</td>
                    <td>{nombreCorto(f.envio.comprador_nombre)}</td>
                    <td>{f.envio.zona || "—"}</td>
                    <td className="r num">
                      <b>{cop(f.envio.cod_monto)}</b>
                    </td>
                    <td>
                      <ChipRiesgo riesgo={f.envio.riesgo} />
                    </td>
                    <td>
                      <ChipEstado estado={f.estado} detalle={detalleEstado(f.estado, f.promesa)} />
                    </td>
                    <td>
                      <div className="cell2">
                        <span>{can}</span>
                        <small>{ult}</small>
                      </div>
                    </td>
                    <td>{proximaAccion(f.estado, f.promesa, !!f.casoAbierto)}</td>
                    <td className="r">{f.estado === "GRUPO_CONTROL" ? <span className="code">n/a</span> : <Confianza valor={f.promesa?.confianza} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            {visibles.length} de {total} envíos · datos del demo
          </span>
          <span>Clic en una fila para ver el detalle del envío</span>
        </div>
      </div>
    </section>
  );
}
