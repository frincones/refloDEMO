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

/** Hora "14:00" / timestamptz → { h, m } en hora de Bogotá. */
function horaMin(s: string | null | undefined): { h: number; m: number } | null {
  if (!s) return null;
  const x = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (x) return { h: Number(x[1]) % 24, m: Number(x[2]) };
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const [h, m] = d.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).split(":").map(Number);
  return { h: h % 24, m };
}

/** 14 → "2 pm", 12 → "12 m", 9:30 → "9:30 am" (como los botones del agente). */
export function hora12(t: { h: number; m: number }): string {
  const min = t.m ? `:${String(t.m).padStart(2, "0")}` : "";
  if (t.h === 12 && !t.m) return "12 m";
  if (t.h === 0) return `12${min} am`;
  return t.h >= 12 ? `${t.h === 12 ? 12 : t.h - 12}${min} pm` : `${t.h}${min} am`;
}

/** "2 pm – 5 pm" a partir de franja_inicio / franja_fin ("HH:MM" o timestamptz). */
export function franja(ini: string | null | undefined, fin: string | null | undefined): string {
  const a = horaMin(ini);
  const b = horaMin(fin);
  if (a && b) return `${hora12(a)} – ${hora12(b)}`;
  if (a) return `desde ${hora12(a)}`;
  if (b) return `hasta ${hora12(b)}`;
  return "";
}

/** Franja del corte ("14:00–17:00") → "2 pm – 5 pm". */
export function franjaTexto(s: string | null | undefined): string {
  if (!s) return "";
  const [a, b] = s.split(/\s*[–-]\s*/);
  return franja(a, b) || s;
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
