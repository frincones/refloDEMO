"use client";
// Panel "operador Waygo": simula lo que hace la operación en el TMS (crear envíos, sacarlos a ruta,
// entregarlos, registrar novedades, cancelar) para que el emulador dispare los webhooks reales.
// Acceso: DEMO_ADMIN_TOKEN, guardado en sessionStorage y verificado en el servidor en cada llamada.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icono } from "@/components/Iconos";

type Estado = { code: string; name: string; is_initial: boolean; is_final: boolean; is_novelty: boolean; is_return: boolean; outcome: string | null };
type Envio = {
  id: string;
  cliente: string;
  es_principal: boolean;
  tracking_number: string;
  order_number: string;
  tienda: string;
  comprador: string;
  telefono: string | null;
  direccion: string;
  cod: number;
  estado: string;
  estado_nombre: string;
  intentos: number;
  servicio: string | null;
  creado: string;
  label_url: string;
  tracking_url: string;
};
type Entrega = { id: string; event: string; shipment_id: string | null; url: string | null; estado: string; intentos: number; ultimo_status: number | null; ultimo_error: string | null; created_at: string };
type Resumen = {
  sembrado: boolean;
  estados: Estado[];
  transiciones: Record<string, string[]>;
  mensajeros: { id: string; nombre: string; placa: string }[];
  novedades: { id: string; name: string }[];
  envios: Envio[];
  entregas: Entrega[];
};

const CLAVE = "emu-admin-token";
const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
const hora = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function claseEstado(e?: Estado): string {
  if (!e) return "c-idle";
  if (e.outcome === "delivered") return "c-ok";
  if (e.is_novelty) return "c-warn";
  if (e.outcome === "cancelled" || e.outcome === "lost") return "c-risk";
  if (e.is_return) return "c-dig";
  if (e.is_initial) return "c-idle";
  return "c-info";
}

export default function PanelEmulador() {
  const [token, setToken] = useState<string | null>(null);
  const [entrada, setEntrada] = useState("");
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [soloPrincipal, setSoloPrincipal] = useState(true);
  const [cantidad, setCantidad] = useState(6);
  const [conInvalido, setConInvalido] = useState(false);
  const [sel, setSel] = useState<{ envio: Envio; destino: string } | null>(null);
  const [courier, setCourier] = useState("");
  const [novedad, setNovedad] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [reprogramar, setReprogramar] = useState("");

  useEffect(() => {
    try {
      const t = sessionStorage.getItem(CLAVE);
      if (t) setToken(t);
    } catch {
      /* sin sessionStorage */
    }
  }, []);

  const llamar = useCallback(
    async (ruta: string, metodo = "GET", cuerpo?: unknown, t = token) => {
      const res = await fetch(ruta, {
        method: metodo,
        headers: { "x-admin-token": t || "", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        try {
          sessionStorage.removeItem(CLAVE);
        } catch {
          /* nada */
        }
        setToken(null);
      }
      if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
      return j;
    },
    [token],
  );

  const cargar = useCallback(async () => {
    if (!token) return;
    try {
      setDatos(await llamar("/api/waygo-emu/admin/resumen"));
    } catch (e) {
      setMensaje({ ok: false, texto: (e as Error).message });
    }
  }, [token, llamar]);

  useEffect(() => {
    if (!token) return;
    cargar();
    const id = setInterval(cargar, 5000);
    return () => clearInterval(id);
  }, [token, cargar]);

  async function ingresar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await llamar("/api/waygo-emu/admin/login", "POST", {}, entrada);
      sessionStorage.setItem(CLAVE, entrada);
      setToken(entrada);
      setMensaje(null);
    } catch {
      setMensaje({ ok: false, texto: "Token inválido" });
    }
  }

  async function accion(fn: () => Promise<string>) {
    setOcupado(true);
    setMensaje(null);
    try {
      setMensaje({ ok: true, texto: await fn() });
      await cargar();
    } catch (e) {
      setMensaje({ ok: false, texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  const mapaEstados = useMemo(() => new Map((datos?.estados || []).map((e) => [e.code, e])), [datos]);
  const envios = (datos?.envios || []).filter((e) => !soloPrincipal || e.es_principal);

  if (!token) {
    return (
      <section className="screen active">
        <div className="screen-head">
          <div>
            <h1>Emulador Waygo · operador</h1>
            <div className="sub">Panel protegido. Ingresa el token de administración del demo.</div>
          </div>
        </div>
        <form className="card form-row" onSubmit={ingresar} style={{ maxWidth: 520 }}>
          <label className="field" style={{ flex: 1 }}>
            Token de administración
            <input type="password" value={entrada} onChange={(e) => setEntrada(e.target.value)} autoComplete="off" required />
          </label>
          <button className="btn btn-primary" type="submit">
            <Icono nombre="lock" /> Entrar
          </button>
          {mensaje && <p className="msg-err" style={{ width: "100%", margin: 0 }}>{mensaje.texto}</p>}
        </form>
      </section>
    );
  }

  const destinos = (e: Envio) => datos?.transiciones[e.estado] || [];

  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <h1>Emulador Waygo · operador</h1>
          <div className="sub">
            Simula la operación del TMS. Cada cambio dispara los webhooks firmados hacia la app.
            <span className="chip c-info nodot">{datos ? `${datos.envios.length} envíos` : "cargando…"}</span>
          </div>
        </div>
        <div className="actions-row">
          <button className="btn btn-ghost btn-sm" onClick={cargar} disabled={ocupado}>
            <Icono nombre="refresh" /> Actualizar
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              accion(async () => {
                const r = await llamar("/api/waygo/sync", "POST");
                return `Sincronización de la app: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.sin_cambios} sin cambios`;
              })
            }
            disabled={ocupado}
          >
            <Icono nombre="send" /> Sincronizar app
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              if (!confirm("¿Reiniciar el emulador? Se borran todos sus envíos y se vuelven a sembrar los 18 del mockup.")) return;
              accion(async () => {
                const r = await llamar("/api/waygo-emu/admin/seed", "POST");
                return `Emulador sembrado: ${r.envios} envíos, ${r.clientes} clientes`;
              });
            }}
            disabled={ocupado}
          >
            Reiniciar y sembrar
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              sessionStorage.removeItem(CLAVE);
              setToken(null);
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {mensaje && <div className={`card ${mensaje.ok ? "msg-ok" : "msg-err"}`} style={{ padding: 12 }}>{mensaje.texto}</div>}
      {datos && !datos.sembrado && (
        <div className="pause-banner" style={{ display: "flex" }}>
          El emulador está vacío. Usa «Reiniciar y sembrar» para cargar catálogos, clientes y los 18 envíos del mockup.
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Crear lote de envíos de prueba</h2>
            <div className="sub">Cliente «Tienda Moda Andina» · COD · Bogotá Sur · sin recogida (quedan en bodega).</div>
          </div>
        </div>
        <div className="form-row">
          <label className="field">
            Cantidad
            <input type="number" min={1} max={20} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={conInvalido} onChange={(e) => setConInvalido(e.target.checked)} />
            Incluir uno con teléfono inválido
          </label>
          <button
            className="btn btn-primary"
            disabled={ocupado}
            onClick={() =>
              accion(async () => {
                const r = await llamar("/api/waygo-emu/admin/lote", "POST", { cantidad, incluir_invalido: conInvalido });
                return `Creados: ${r.creados.join(", ")}`;
              })
            }
          >
            <Icono nombre="truck" /> Crear lote
          </button>
        </div>
      </div>

      {sel && datos && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>
                {sel.envio.tracking_number} → {mapaEstados.get(sel.destino)?.name || sel.destino}
              </h2>
              <div className="sub">
                {sel.envio.comprador} · {sel.envio.tienda} · {cop(sel.envio.cod)}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>
              <Icono nombre="x" /> Cerrar
            </button>
          </div>
          <div className="form-row">
            {sel.destino === "in_route" && (
              <label className="field">
                Mensajero
                <select value={courier} onChange={(e) => setCourier(e.target.value)}>
                  <option value="">Elegir…</option>
                  {datos.mensajeros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} · {m.placa}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sel.destino === "novelty" && (
              <>
                <label className="field">
                  Causal
                  <select value={novedad} onChange={(e) => setNovedad(e.target.value)}>
                    <option value="">Elegir…</option>
                    {datos.novedades.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  Lo que escribió el mensajero
                  <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="No estaba, timbré 3 veces" />
                </label>
                <label className="field">
                  Reprogramar para
                  <input type="date" value={reprogramar} onChange={(e) => setReprogramar(e.target.value)} />
                </label>
              </>
            )}
            <button
              className="btn btn-primary"
              disabled={ocupado || (sel.destino === "in_route" && !courier) || (sel.destino === "novelty" && !novedad)}
              onClick={() =>
                accion(async () => {
                  await llamar("/api/waygo-emu/admin/transicion", "POST", {
                    shipment_id: sel.envio.id,
                    estado: sel.destino,
                    courier_id: courier || undefined,
                    novelty_type_id: novedad || undefined,
                    descripcion: descripcion || undefined,
                    reschedule_date: reprogramar || undefined,
                  });
                  setSel(null);
                  setDescripcion("");
                  setReprogramar("");
                  return `${sel.envio.tracking_number}: cambio aplicado y webhooks encolados`;
                })
              }
            >
              <Icono nombre="check" /> Aplicar cambio
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Envíos en el emulador</h2>
            <div className="sub">Mueve cada envío como lo haría la operación.</div>
          </div>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={soloPrincipal} onChange={(e) => setSoloPrincipal(e.target.checked)} />
            Solo el cliente del demo
          </label>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Guía</th>
                <th>Tienda</th>
                <th>Comprador</th>
                <th className="r">COD</th>
                <th>Estado Waygo</th>
                <th className="r">Intentos</th>
                <th>Servicio</th>
                <th>Creado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {envios.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="cell2">
                      <span className="guia">{e.tracking_number}</span>
                      <small>
                        <a href={e.label_url} target="_blank" rel="noreferrer">guía PDF</a> ·{" "}
                        <a href={e.tracking_url} target="_blank" rel="noreferrer">seguimiento</a>
                      </small>
                    </div>
                  </td>
                  <td>
                    <div className="cell2">
                      {e.tienda}
                      {!e.es_principal && <small>cliente: {e.cliente}</small>}
                    </div>
                  </td>
                  <td>
                    <div className="cell2">
                      {e.comprador}
                      <small className="mono">{e.telefono}</small>
                    </div>
                  </td>
                  <td className="r num">{e.cod ? cop(e.cod) : "—"}</td>
                  <td>
                    <span className={`chip ${claseEstado(mapaEstados.get(e.estado))}`}>{e.estado_nombre}</span>
                  </td>
                  <td className="r num">{e.intentos}</td>
                  <td>{e.servicio || "—"}</td>
                  <td>{hora(e.creado)}</td>
                  <td>
                    {destinos(e).length ? (
                      <select
                        className="select"
                        value=""
                        onChange={(ev) => ev.target.value && setSel({ envio: e, destino: ev.target.value })}
                        aria-label={`Cambiar estado de ${e.tracking_number}`}
                      >
                        <option value="">Mover a…</option>
                        {destinos(e).map((d) => (
                          <option key={d} value={d}>
                            {mapaEstados.get(d)?.name || d}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="code">final</span>
                    )}
                  </td>
                </tr>
              ))}
              {!envios.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    Sin envíos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Webhooks enviados</h2>
            <div className="sub">Últimas 60 entregas (firmadas con HMAC-SHA256, hasta 3 intentos).</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Evento</th>
                <th>Guía</th>
                <th>Estado</th>
                <th className="r">Intentos</th>
                <th>Respuesta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(datos?.entregas || []).map((w) => (
                <tr key={w.id}>
                  <td>{hora(w.created_at)}</td>
                  <td className="mono">{w.event}</td>
                  <td className="guia">{datos?.envios.find((e) => e.id === w.shipment_id)?.tracking_number || "—"}</td>
                  <td>
                    <span className={`chip ${w.estado === "entregado" ? "c-ok" : w.estado === "fallido" ? "c-risk" : "c-warn"}`}>{w.estado}</span>
                  </td>
                  <td className="r num">{w.intentos}</td>
                  <td className="code" title={w.ultimo_error || ""}>
                    {w.ultimo_status ?? ""} {w.ultimo_error ? w.ultimo_error.slice(0, 40) : ""}
                  </td>
                  <td>
                    {w.estado !== "entregado" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={ocupado}
                        onClick={() =>
                          accion(async () => {
                            const r = await llamar("/api/waygo-emu/admin/reintentar", "POST", { delivery_id: w.id });
                            return r.ok ? "Webhook entregado" : `Falló: ${r.error || r.status}`;
                          })
                        }
                      >
                        Reintentar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!datos?.entregas.length && (
                <tr>
                  <td colSpan={7} className="empty">
                    Aún no se han enviado webhooks.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
