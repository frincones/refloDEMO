// label_url pública: el PDF de la guía, sin autenticación (se identifica por un token aleatorio).
import { supabaseServer } from "@/lib/supabase/server";
import { respuestaGuia } from "@/lib/waygo-emu/router";
import type { FilaEnvio } from "@/lib/waygo-emu/envios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await supabaseServer().from("wg_shipments").select("*").eq("label_token", token).maybeSingle();
  if (!data) return new Response("Guía no encontrada", { status: 404 });
  return respuestaGuia(data as FilaEnvio);
}
