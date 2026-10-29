"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icono } from "./Iconos";
import { Toasts } from "./consola/Toasts";
import { DialogoToken } from "./consola/DialogoToken";
import { useCasosAbiertos, useConfig } from "@/hooks/datos";
import { post, textoError } from "@/lib/ui/api";
import { toast } from "@/lib/ui/toast";

const RUTAS = [
  { href: "/buffer", texto: "Buffer del corte", icono: "layers", tambien: ["/envio"] },
  { href: "/whatsapp", texto: "Simulador WhatsApp", icono: "chat" },
  { href: "/excepciones", texto: "Excepciones", icono: "flag", badge: true },
  { href: "/agentes", texto: "Actividad de agentes", icono: "bot" },
  { href: "/resultados", texto: "Resultados", icono: "chart" },
  { href: "/control", texto: "Control del demo", icono: "play" },
  { href: "/emulador", texto: "Emulador Waygo", icono: "truck" },
];

function Reloj() {
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => {
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  if (!ahora) return null;
  const f = ahora.toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short" });
  const h = ahora.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <span className="chip c-idle nodot num" title="Hora de Bogotá">
      {f.replace(".", "")} · {h}
    </span>
  );
}

/** Estructura común: menú lateral del mockup + barra superior + aviso global de pausa. */
export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname() || "";
  const pendientes = useCasosAbiertos();
  const { datos: config, recargar: recargarConfig } = useConfig();
  const pausados = !!config?.agentes_pausados;
  const [reanudando, setReanudando] = useState(false);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem("tp-theme");
      if (guardado === "dark" || guardado === "light") document.documentElement.setAttribute("data-theme", guardado);
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);

  function cambiarTema() {
    const raiz = document.documentElement;
    let actual = raiz.getAttribute("data-theme");
    if (!actual) actual = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const siguiente = actual === "dark" ? "light" : "dark";
    raiz.setAttribute("data-theme", siguiente);
    try {
      localStorage.setItem("tp-theme", siguiente);
    } catch {
      /* sin almacenamiento */
    }
  }

  async function reanudar() {
    setReanudando(true);
    try {
      await post("/api/demo/pausa", { pausado: false });
      toast("Agentes reanudados. La cadencia continúa desde el siguiente paso.");
      recargarConfig();
    } catch (e) {
      toast(textoError(e), "error");
    } finally {
      setReanudando(false);
    }
  }

  const activa = (r: (typeof RUTAS)[number]) => ruta.startsWith(r.href) || (r.tambien || []).some((t) => ruta.startsWith(t));

  return (
    <div className="page">
      <div className="mock-banner" role="note">
        <Icono nombre="flag" />
        <span>
          <b>Demo · datos de prueba · Propuesta TDX para Reflo</b> — ninguna guía o persona es real.
        </span>
      </div>
      <div className="shell">
        <aside className="side" aria-label="Navegación principal">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <Icono nombre="tower" />
            </div>
            <div className="brand-txt">
              <b>Torre de Promesa</b>
              <small>Reflo · powered by TDX</small>
            </div>
          </div>
          <nav>
            <ul className="nav">
              {RUTAS.map((r) => (
                <li key={r.href}>
                  <Link href={r.href} aria-current={activa(r) ? "page" : undefined}>
                    <Icono nombre={r.icono} />
                    {r.texto}
                    {r.badge && pendientes > 0 && <span className="badge num">{pendientes}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="side-foot">
            <span>
              <span className={`dot-live${pausados ? " dot-off" : ""}`} />
              {pausados ? "Agentes en pausa" : "3 agentes IA + 8 workers"}
            </span>
            <span>Conectada a Waygo ({config?.waygo_target === "sandbox" ? "sandbox" : "emulador"})</span>
            <span>Gobernanza: Ley 2300 (L-V 7–19, sáb 8–15)</span>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <div style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>
              Torre de Promesa · Bogotá Sur <span className="sample-tag" style={{ marginLeft: 8 }}>Demo · datos de prueba</span>
            </div>
            <div className="top-actions">
              <Reloj />
              <button className="icon-btn" type="button" onClick={cambiarTema} aria-label="Cambiar tema claro/oscuro">
                <Icono nombre="moon" />
              </button>
              <Link className="icon-btn" href="/excepciones" aria-label={`Excepciones pendientes: ${pendientes}`}>
                <Icono nombre="bell" />
                {pendientes > 0 && <span className="pip num">{pendientes}</span>}
              </Link>
              <div className="avatar" title="Supervisor de torre (demo)" aria-label="Usuario supervisor">
                ST
              </div>
            </div>
          </div>
          {pausados && (
            <div className="pause-banner on" role="status">
              <Icono nombre="pause" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>Agentes en pausa.</b> Fail-open: Waygo rutea el buffer como hoy, sin estados de intención nuevos. Los contactos programados quedan en espera.
              </span>
              <button className="btn btn-outline btn-sm" type="button" onClick={reanudar} disabled={reanudando}>
                <Icono nombre="play" />
                Reanudar agentes
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
      <Toasts />
      <DialogoToken />
    </div>
  );
}

/** Página provisional (ya no se usa en las pantallas de la consola). */
export function EnConstruccion({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <h1>{titulo}</h1>
          <div className="sub">{descripcion}</div>
        </div>
      </div>
      <div className="card placeholder">
        <h2>En construcción</h2>
        <p className="sub">Esta pantalla se construye en las siguientes fases del demo.</p>
        <span className="chip c-warn">Pendiente</span>
      </div>
    </section>
  );
}
