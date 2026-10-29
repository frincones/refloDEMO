import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";

/** Detalle de error con el formato ErrorDetail del spec. */
export type DetalleError = { location?: string; message?: string; value?: unknown };

const TITULOS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

/** Error de la API: se responde como application/problem+json (ErrorModel). */
export class ErrorApi extends Error {
  constructor(
    public status: number,
    public detail: string,
    public errors?: DetalleError[],
  ) {
    super(detail);
  }
}

/** Contexto de cada petición al emulador. */
export type Ctx = {
  origen: string; // https://host (para armar label_url, tracking_url, $schema)
  base: string; // origen + /api/waygo-emu/partner
};

export function ctxDesde(req: Request): Ctx {
  const url = new URL(req.url);
  // Detrás de proxies (Vercel) respetar el host reenviado
  const host = req.headers.get("x-forwarded-host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const origen = `${proto}://${host}`;
  return { origen, base: `${origen}/api/waygo-emu/partner` };
}

/** Respuesta problem+json con el formato ErrorModel del spec. */
export function problema(ctx: Ctx | null, status: number, detail: string, errors?: DetalleError[]): Response {
  const cuerpo: Record<string, unknown> = {};
  if (ctx) cuerpo.$schema = `${ctx.base}/schemas/ErrorModel.json`;
  cuerpo.title = TITULOS[status] || "Error";
  cuerpo.status = status;
  cuerpo.detail = detail;
  if (errors && errors.length) cuerpo.errors = errors;
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
  });
}

/** Respuesta JSON con $schema (como lo hace la API real, generada con Huma). */
export function json(ctx: Ctx, schema: string | null, cuerpo: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  const conSchema = schema ? { $schema: `${ctx.base}/schemas/${schema}.json`, ...cuerpo } : cuerpo;
  return new Response(JSON.stringify(conSchema), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Quita claves con undefined/null (equivalente a omitempty de Go). */
export function limpio<T extends Record<string, unknown>>(o: T): T {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) r[k] = v;
  return r as T;
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** JSON con claves ordenadas (para comparar cuerpos en Idempotency-Key). */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida un parámetro de ruta con format: uuid (como Huma: 422 con location path.<nombre>). */
export function exigirUuid(valor: string, nombre: string): void {
  if (!UUID_RE.test(valor)) {
    throw new ErrorApi(422, "validation failed", [
      { message: "expected string to be RFC 4122 uuid", location: `path.${nombre}`, value: valor },
    ]);
  }
}

export type Cliente = {
  id: string;
  nombre: string;
  telefono_contacto: string | null;
  direccion: string | null;
  service_cutoff: string;
  tarifa_base: number;
  tarifa_kg: number;
  cod_fee_pct: number;
  tiene_lista_precios: boolean;
};

/** Autenticación Bearer tms_c_…: devuelve el cliente dueño de la llave o lanza 401. */
export async function autenticar(req: Request): Promise<Cliente> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) throw new ErrorApi(401, "missing or malformed Authorization header: use Bearer tms_c_...");
  const llave = m[1];
  if (!llave.startsWith("tms_c_")) throw new ErrorApi(401, "invalid API key");
  const db = supabaseServer();
  const { data, error } = await db
    .from("wg_api_keys")
    .select("id, activa, wg_clients(*)")
    .eq("key_hash", sha256(llave))
    .maybeSingle();
  if (error) throw new ErrorApi(500, "internal error");
  if (!data || !data.activa || !data.wg_clients) throw new ErrorApi(401, "invalid API key");
  // Registrar último uso sin bloquear la respuesta
  void db.from("wg_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => undefined);
  const c = data.wg_clients as unknown as Cliente;
  return { ...c, tarifa_base: Number(c.tarifa_base), tarifa_kg: Number(c.tarifa_kg), cod_fee_pct: Number(c.cod_fee_pct) };
}

/** Lee el body JSON. Body vacío o JSON inválido → 422 (el spec solo documenta 401/404/409/422/500 en estas operaciones). */
export async function leerJson(req: Request): Promise<unknown> {
  const texto = await req.text();
  if (!texto.trim()) throw new ErrorApi(422, "validation failed", [{ message: "request body is required", location: "body" }]);
  try {
    return JSON.parse(texto);
  } catch (e) {
    throw new ErrorApi(422, "validation failed", [{ message: `unable to parse body: ${(e as Error).message}`, location: "body" }]);
  }
}

/** Fecha RFC 3339 en UTC sin milisegundos. */
export function rfc3339(d: string | Date | null | undefined): string | undefined {
  if (!d) return undefined;
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
}
