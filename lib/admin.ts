import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Protege rutas de operación del demo (/api/waygo/*, /api/demo/*) con DEMO_ADMIN_TOKEN.
 * El cliente envía el header `x-admin-token`. Devuelve una Response 401 si no es válido, o null si pasa.
 */
export function exigirTokenAdmin(req: Request): Response | null {
  const esperado = process.env.DEMO_ADMIN_TOKEN || "";
  const dado = req.headers.get("x-admin-token") || "";
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  if (!esperado || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ ok: false, error: "token de administración inválido" }, { status: 401 });
  }
  return null;
}
