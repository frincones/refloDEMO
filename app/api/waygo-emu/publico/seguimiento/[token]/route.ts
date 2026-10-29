// tracking_url pública: página de seguimiento para el comprador (sin autenticación).
import { supabaseServer } from "@/lib/supabase/server";
import { estados, eventosDe, type FilaEnvio } from "@/lib/waygo-emu/envios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await supabaseServer().from("wg_shipments").select("*").eq("label_token", token).maybeSingle();
  if (!data) return new Response("Envío no encontrado", { status: 404 });
  const f = data as FilaEnvio;
  const mapa = await estados();
  const evs = await eventosDe(f.id);
  const fmt = (d: string) =>
    new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
  const items = evs
    .slice()
    .reverse()
    .map(
      (e) =>
        `<li><b>${esc(e.state_name || mapa.get(e.state)?.name || e.state)}</b><span>${esc(fmt(e.occurred_at))}</span>${
          e.novelty ? `<em>Novedad: ${esc((e.novelty as { type_name?: string }).type_name)}</em>` : ""
        }${e.notes ? `<small>${esc(e.notes)}</small>` : ""}</li>`,
    )
    .join("");
  const html = `<!doctype html><html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seguimiento ${esc(f.tracking_number)}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#F2FBFC;color:#012A36}main{max-width:520px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border:1px solid #E1ECEF;border-radius:16px;padding:18px;margin-bottom:14px}h1{font-size:20px;margin:0 0 4px}
.estado{display:inline-block;background:#FF7A64;color:#2A0E08;font-weight:700;border-radius:999px;padding:4px 12px;margin-top:8px}
ul{list-style:none;padding:0;margin:0}li{border-left:3px solid #0E7C86;padding:6px 0 10px 12px;display:flex;flex-direction:column;gap:2px}
li span,small{color:#5F777C;font-size:13px}em{color:#B8321F;font-style:normal;font-size:13px}.nota{font-size:12px;color:#5F777C;text-align:center}</style></head>
<body><main><div class="card"><small>Guía</small><h1>${esc(f.tracking_number)}</h1><div>${esc(f.sender_name)} → ${esc(f.recipient_name)}</div>
<div class="estado">${esc(mapa.get(f.current_state)?.name || f.current_state)}</div></div>
<div class="card"><ul>${items}</ul></div><p class="nota">Página de seguimiento del emulador de Waygo (demo TDX · datos ficticios).</p></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
