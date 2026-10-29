// POST /api/demo/{preparar|ola|recordatorio|dia-d|corte|pago|pausa|reset} (header x-admin-token).
// Contrato en lib/contratos y docs/AGENTE.md.
import { preparar } from "@/lib/workers/riesgo";
import { diaD, ola, recordatorio } from "@/lib/workers/planificador";
import { congelarCorte } from "@/lib/workers/corte";
import { confirmarPago, ErrorNegocio, fijarPausa, reiniciarDemo } from "@/lib/workers/operacion";
import { rutaAdmin, UUID } from "@/lib/workers/rutas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCIONES: Record<string, (c: Record<string, unknown>) => Promise<unknown>> = {
  preparar: (c) => preparar({ todos: c.todos === true }),
  ola: () => ola(),
  recordatorio: () => recordatorio(),
  "dia-d": () => diaD(),
  corte: () => congelarCorte(),
  pago: async (c) => {
    if (typeof c.envio_id !== "string" || !UUID.test(c.envio_id)) throw new ErrorNegocio(400, "envio_id_invalido");
    return confirmarPago(c.envio_id);
  },
  pausa: async (c) => {
    if (typeof c.pausado !== "boolean") throw new ErrorNegocio(400, "pausado_debe_ser_boolean");
    return fijarPausa(c.pausado);
  },
  reset: (c) => reiniciarDemo({ resembrar: c.resembrar !== false }),
};

export async function POST(req: Request, { params }: { params: Promise<{ accion: string }> }) {
  const { accion } = await params;
  const fn = ACCIONES[accion];
  if (!fn) return Response.json({ error: "accion_desconocida" }, { status: 404 });
  return rutaAdmin(req, accion, fn);
}
