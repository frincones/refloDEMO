import "server-only";
import { exigirTokenAdmin } from "@/lib/admin";
import { registrarEvento } from "@/lib/ingesta/envios";
import { AgentesPausados } from "./planificador";
import { ErrorNegocio } from "./operacion";

// Envoltorio común de las rutas /api/demo/* y /api/casos/*: token, JSON y errores uniformes.
export async function rutaAdmin(req: Request, accion: string, fn: (cuerpo: Record<string, unknown>) => Promise<unknown>): Promise<Response> {
  const no = exigirTokenAdmin(req);
  if (no) return no;
  let cuerpo: Record<string, unknown> = {};
  if (req.method === "POST") {
    const t = await req.text();
    if (t.trim()) {
      try {
        cuerpo = JSON.parse(t);
      } catch {
        return Response.json({ error: "json_invalido" }, { status: 400 });
      }
    }
  }
  try {
    return Response.json(await fn(cuerpo));
  } catch (e) {
    if (e instanceof AgentesPausados) return Response.json({ error: "agentes_pausados" }, { status: 409 });
    if (e instanceof ErrorNegocio) return Response.json({ error: e.message }, { status: e.status });
    console.error(`[${accion}]`, e);
    await registrarEvento({ componente: "control", herramienta: accion, nivel: "error", mensaje: `${accion}: ${(e as Error).message}` });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
