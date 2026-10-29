// Evidencias simuladas de entrega (fotos y firma) que referencian photo_url / signature_url.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; archivo: string }> }) {
  const { archivo } = await params;
  const etiqueta = archivo.replace(/\.svg$/, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#D6ECF2"/><text x="160" y="95" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#012A36">Evidencia simulada</text><text x="160" y="125" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#415B6C">${etiqueta.replace(/[^a-z0-9_-]/gi, "")}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
}
