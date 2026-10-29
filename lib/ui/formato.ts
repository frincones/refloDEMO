// Formatos de presentación (es-CO, hora de Bogotá).

const TZ = "America/Bogota";

export function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("es-CO");
}

export function cop(v: number | string | null | undefined): string {
  const n = num(v);
  return n === null ? "—" : "$" + fmtInt(n);
}

export function pct(n: number, decimales = 1): string {
  return n.toLocaleString("es-CO", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + " %";
}

export function hora(iso: string | null | undefined, conSegundos = false): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: conSegundos ? "2-digit" : undefined,
    hour12: false,
  });
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-CO", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00-05:00") : new Date(iso);
  return d.toLocaleDateString("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}

/** "2–5 pm" a partir de franja_inicio / franja_fin (timestamptz o "HH:MM"). */
export function franja(ini: string | null | undefined, fin: string | null | undefined): string {
  if (!ini && !fin) return "";
  const h = (s: string | null | undefined) => {
    if (!s) return null;
    if (/^\d{1,2}:\d{2}/.test(s)) return Number(s.split(":")[0]);
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return Number(d.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false })) % 24;
  };
  const a = h(ini);
  const b = h(fin);
  const f12 = (x: number) => (x === 12 ? "12 m" : x > 12 ? `${x - 12} pm` : `${x} am`);
  if (a !== null && b !== null) {
    const sufijo = (x: number) => (x >= 12 ? "pm" : "am");
    if (sufijo(a) === sufijo(b) && a !== 12 && b !== 12) return `${a > 12 ? a - 12 : a}–${b > 12 ? b - 12 : b} ${sufijo(b)}`;
    return `${f12(a)} – ${f12(b)}`;
  }
  if (a !== null) return `desde ${f12(a)}`;
  if (b !== null) return `hasta ${f12(b)}`;
  return "";
}

export function hace(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function iniciales(texto: string | null | undefined): string {
  return (texto || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function primerNombre(nombre: string | null | undefined): string {
  return (nombre || "").split(/\s+/)[0] || "";
}

/** "Valentina Rodríguez" → "Valentina R." (como en el mockup). */
export function nombreCorto(nombre: string | null | undefined): string {
  const p = (nombre || "").split(/\s+/).filter(Boolean);
  if (p.length < 2) return p[0] || "—";
  return `${p[0]} ${p[p.length - 1][0]}.`;
}

export function telefonoOculto(e164: string | null | undefined): string {
  if (!e164) return "sin celular válido";
  const d = e164.replace(/\D/g, "");
  return `+57 ${d.slice(2, 5)} *** ${d.slice(-4)}`;
}
