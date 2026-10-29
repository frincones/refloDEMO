// POST /api/casos/[id]/resolver {accion: "aprobar"|"rechazar"|"tomar"|"devolver", nota?} (header x-admin-token).
import { ErrorNegocio, resolverCaso } from "@/lib/workers/operacion";
import { rutaAdmin, UUID } from "@/lib/workers/rutas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCIONES = ["aprobar", "rechazar", "tomar", "devolver"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return rutaAdmin(req, "caso_resolver", async (c) => {
    if (!UUID.test(id)) throw new ErrorNegocio(400, "id_invalido");
    const accion = c.accion as (typeof ACCIONES)[number];
    if (!ACCIONES.includes(accion)) throw new ErrorNegocio(400, "accion_invalida");
    return resolverCaso(id, accion, typeof c.nota === "string" ? c.nota.slice(0, 500) : undefined);
  });
}
