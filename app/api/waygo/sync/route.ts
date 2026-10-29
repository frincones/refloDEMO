// Reconciliación con Waygo: lista los envíos (GET /v1/shipments), pide el detalle solo de los nuevos
// o cambiados (GET /v1/shipments/{id}, trae teléfono y COD) y hace upsert en `envios`. Idempotente.
// POST /api/waygo/sync            (header x-admin-token)
//   ?completo=1   → pide el detalle de todos, aunque no hayan cambiado
//   ?max_paginas=N (por defecto 10, de 100 envíos cada una)
import { supabaseServer } from "@/lib/supabase/server";
import { exigirTokenAdmin } from "@/lib/admin";
import { registrarEvento, upsertEnvio } from "@/lib/ingesta/envios";
import { waygo, WaygoError, type ShipmentSummary } from "@/lib/waygo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const no = exigirTokenAdmin(req);
  if (no) return no;
  const sp = new URL(req.url).searchParams;
  const completo = sp.get("completo") === "1";
  const maxPaginas = Math.min(Math.max(Number(sp.get("max_paginas")) || 10, 1), 50);
  const inicio = Date.now();
  const cliente = waygo();
  const db = supabaseServer();

  try {
    // 1) Listado completo (paginado)
    const resumenes: ShipmentSummary[] = [];
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const r = await cliente.listShipments({ page: pagina, page_size: 100 });
      resumenes.push(...(r.data || []));
      totalPaginas = r.meta.total_pages;
      pagina += 1;
    } while (pagina <= totalPaginas && pagina <= maxPaginas);

    // 2) Comparar con lo que ya tenemos
    const ids = resumenes.map((s) => s.id);
    const conocidos = new Map<string, { waygo_updated_at: string | null; waygo_status_code: string | null }>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("envios").select("waygo_shipment_id, waygo_updated_at, waygo_status_code").in("waygo_shipment_id", ids.slice(i, i + 200));
      for (const e of data || []) conocidos.set(e.waygo_shipment_id, e);
    }
    const pendientes = resumenes.filter((s) => {
      const c = conocidos.get(s.id);
      if (completo || !c) return true;
      return c.waygo_status_code !== s.current_state || !c.waygo_updated_at || new Date(c.waygo_updated_at).getTime() !== new Date(s.updated_at).getTime();
    });

    // 3) Detalle + upsert
    let nuevos = 0;
    let actualizados = 0;
    const errores: { id: string; error: string }[] = [];
    for (const s of pendientes) {
      try {
        const detalle = await cliente.getShipment(s.id);
        const r = await upsertEnvio(cliente, detalle, { fuente: "sync" });
        if (r.nuevo) nuevos += 1;
        else actualizados += 1;
      } catch (e) {
        errores.push({ id: s.id, error: (e as Error).message });
      }
    }
    const resultado = {
      listados: resumenes.length,
      revisados: pendientes.length,
      nuevos,
      actualizados,
      sin_cambios: resumenes.length - pendientes.length,
      errores,
      ms: Date.now() - inicio,
    };
    await registrarEvento({
      componente: "sync",
      herramienta: "waygo.sync",
      entrada: { completo, max_paginas: maxPaginas },
      resultado,
      nivel: errores.length ? "aviso" : "ok",
      mensaje: `Sincronización con Waygo: ${nuevos} nuevos, ${actualizados} actualizados, ${resultado.sin_cambios} sin cambios`,
    });
    return Response.json({ ok: true, ...resultado });
  } catch (e) {
    const status = e instanceof WaygoError ? e.status : 500;
    await registrarEvento({ componente: "sync", herramienta: "waygo.sync", nivel: "error", mensaje: `Error sincronizando: ${(e as Error).message}` });
    return Response.json({ ok: false, error: (e as Error).message }, { status: status >= 400 && status < 600 ? 502 : 500 });
  }
}
