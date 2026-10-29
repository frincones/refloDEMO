// GET /api/demo/corte/csv?corte_id=<uuid> (header x-admin-token) → text/csv. Sin corte_id: el último corte.
import { exigirTokenAdmin } from "@/lib/admin";
import { corteCsv } from "@/lib/workers/corte";
import { UUID } from "@/lib/workers/rutas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = exigirTokenAdmin(req);
  if (no) return no;
  const id = new URL(req.url).searchParams.get("corte_id");
  if (id && !UUID.test(id)) return Response.json({ error: "corte_id_invalido" }, { status: 400 });
  const r = await corteCsv(id);
  if (!r) return Response.json({ error: "corte_no_existe" }, { status: 404 });
  return new Response(r.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.nombre}"`, "Cache-Control": "no-store" },
  });
}
