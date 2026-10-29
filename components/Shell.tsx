"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icono } from "./Iconos";

const RUTAS = [
  { href: "/buffer", texto: "Buffer", icono: "layers" },
  { href: "/whatsapp", texto: "WhatsApp", icono: "chat" },
  { href: "/excepciones", texto: "Excepciones", icono: "flag" },
  { href: "/agentes", texto: "Agentes", icono: "bot" },
  { href: "/resultados", texto: "Resultados", icono: "chart" },
  { href: "/control", texto: "Control", icono: "play" },
  { href: "/emulador", texto: "Emulador Waygo", icono: "truck" },
];

/** Estructura común: menú lateral del mockup + barra superior con cambio de tema. */
export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();

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

  return (
    <div className="page">
      <div className="mock-banner" role="note">
        <Icono nombre="flag" />
        <span>
          <b>Demo · datos de ejemplo · Propuesta TDX para Reflo</b> — ninguna guía o persona es real.
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
                  <Link href={r.href} aria-current={ruta?.startsWith(r.href) ? "page" : undefined}>
                    <Icono nombre={r.icono} />
                    {r.texto}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="side-foot">
            <span>
              <span className="dot-live" />
              Conectada a Waygo (emulador)
            </span>
            <span>Gobernanza: Ley 2300 (L-V 7–19, sáb 8–15)</span>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <div style={{ flex: 1, fontWeight: 600 }}>Torre de Promesa · Bogotá Sur</div>
            <div className="top-actions">
              <button className="icon-btn" type="button" onClick={cambiarTema} aria-label="Cambiar tema claro/oscuro">
                <Icono nombre="moon" />
              </button>
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Página provisional para las pantallas de las fases 6–7. */
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
