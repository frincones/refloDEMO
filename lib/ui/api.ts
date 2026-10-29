"use client";
// Llamadas de la consola a las rutas del servidor (escrituras). Todas llevan `x-admin-token`.
// El token se pide una vez en un diálogo de la página (mismo patrón y misma clave que /emulador)
// y se guarda en sessionStorage. La consola nunca escribe directo en Supabase.

const CLAVE = "emu-admin-token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensaje: string,
    public cuerpo?: unknown,
  ) {
    super(mensaje);
  }
}

// ---------- token ----------
type Solicitante = (motivo?: string) => Promise<string | null>;
let solicitante: Solicitante | null = null;
let pendiente: Promise<string | null> | null = null;

/** Lo registra <DialogoToken/> para poder pedir el token desde cualquier llamada. */
export function registrarSolicitanteToken(fn: Solicitante | null) {
  solicitante = fn;
}

export function leerToken(): string | null {
  try {
    return sessionStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

export function guardarToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(CLAVE, t);
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin sessionStorage */
  }
}

async function obtenerToken(motivo?: string): Promise<string> {
  const t = leerToken();
  if (t) return t;
  if (!solicitante) throw new ApiError(401, "sin_token", "Falta el token de administración");
  if (!pendiente) pendiente = solicitante(motivo).finally(() => (pendiente = null));
  const nuevo = await pendiente;
  if (!nuevo) throw new ApiError(401, "cancelado", "Acción cancelada: se necesita el token de administración");
  guardarToken(nuevo);
  return nuevo;
}

function errorDeRespuesta(res: Response, j: Record<string, unknown> | null): ApiError {
  if (res.status === 401) {
    guardarToken(null);
    return new ApiError(401, "token_invalido", "Token de administración inválido (401). Vuelve a ingresarlo.", j);
  }
  // Ruta inexistente: el backend (rama feat/agente) aún no la publica.
  if ((res.status === 404 || res.status === 405) && (!j || (!j.error && !j.ok))) {
    return new ApiError(res.status, "no_disponible", "Endpoint no disponible todavía en este despliegue", j);
  }
  const msg = (j && (typeof j.error === "string" ? j.error : typeof j.mensaje === "string" ? j.mensaje : null)) || `HTTP ${res.status}`;
  return new ApiError(res.status, typeof j?.error === "string" ? j.error : "error", msg, j);
}

/** fetch con token y reintento único si el token guardado era inválido. */
async function fetchConToken(ruta: string, init: RequestInit, reintento = true): Promise<Response> {
  const token = await obtenerToken();
  let res: Response;
  try {
    res = await fetch(ruta, {
      ...init,
      headers: { ...(init.headers || {}), "x-admin-token": token },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "red", "No se pudo conectar con el servidor");
  }
  if (res.status === 401 && reintento) {
    guardarToken(null);
    await obtenerToken("El token guardado no es válido (401). Ingrésalo de nuevo.");
    return fetchConToken(ruta, init, false);
  }
  return res;
}

/** POST JSON a una ruta de operación. Devuelve el JSON de respuesta o lanza ApiError. */
export async function post<T = Record<string, unknown>>(ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetchConToken(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo ?? {}),
  });
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || (j && j.ok === false)) throw errorDeRespuesta(res, j);
  return (j ?? {}) as T;
}

/** GET que descarga un archivo (CSV) con el token y lo guarda en el navegador. */
export async function descargar(ruta: string, nombre: string): Promise<void> {
  const res = await fetchConToken(ruta, { method: "GET" });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw errorDeRespuesta(res, j);
  }
  const blob = await res.blob();
  const disp = res.headers.get("content-disposition") || "";
  const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m ? decodeURIComponent(m[1]) : nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** POST que responde con Server-Sent Events (POST /api/chat). Devuelve la Response abierta. */
export async function postStream(ruta: string, cuerpo: unknown, senal?: AbortSignal): Promise<Response> {
  const res = await fetchConToken(ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(cuerpo),
    signal: senal,
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw errorDeRespuesta(res, j);
  }
  return res;
}

/** Mensaje legible para un error de cualquier llamada. */
export function textoError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.codigo === "no_disponible") return "Endpoint no disponible todavía (el backend del agente aún no está desplegado)";
    if (e.codigo === "agentes_pausados" || e.codigo === "agente_en_pausa") return "Los agentes están en pausa. Reanúdalos en Agentes.";
    return e.message;
  }
  return (e as Error)?.message || String(e);
}
