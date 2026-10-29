// POST /api/chat {envio_id, texto, boton_id?, es_audio?} (header x-admin-token) → Server-Sent Events.
// Eventos: delta, herramienta, intencion, botones, caso, fin, error (ver lib/contratos y docs/AGENTE.md).
import { z } from "zod";
import { exigirTokenAdmin } from "@/lib/admin";
import { ejecutarTurno } from "@/lib/agente";
import { leerEnvio } from "@/lib/herramientas/comun";
import type { EventosChat, NombreEventoChat } from "@/lib/contratos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Cuerpo = z
  .object({
    envio_id: z.string().uuid(),
    texto: z.string().max(2000).default(""),
    boton_id: z.string().max(60).optional(),
    es_audio: z.boolean().optional(),
  })
  .refine((c) => c.texto.trim() || c.boton_id, { message: "texto o boton_id requerido" });

export async function POST(req: Request) {
  const no = exigirTokenAdmin(req);
  if (no) return no;
  const p = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "cuerpo_invalido", detalle: p.error.issues.map((i) => i.message) }, { status: 400 });
  if (!(await leerEnvio(p.data.envio_id))) return Response.json({ error: "envio_no_existe" }, { status: 404 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let cerrado = false;
      const emitir = <K extends NombreEventoChat>(evento: K, datos: EventosChat[K]) => {
        if (cerrado) return;
        try {
          ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
        } catch {
          cerrado = true; // el cliente se desconectó; el turno sigue y se guarda
        }
      };
      try {
        const r = await ejecutarTurno(p.data, emitir);
        emitir("fin", { mensaje_id: r.mensaje_id });
      } catch (e) {
        emitir("error", { mensaje: (e as Error).message });
        emitir("fin", { mensaje_id: null });
      } finally {
        cerrado = true;
        try {
          ctrl.close();
        } catch {
          /* ya cerrado */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
