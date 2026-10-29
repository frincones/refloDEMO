// Emulador de la Waygo TMS Partner API v1.0.0 (spec/waygo-partner-openapi.yaml).
// URL base: <origen>/api/waygo-emu/partner  → rutas /v1/... (igual que https://dev-tms-api.waygo.pro/partner).
import { despachar } from "@/lib/waygo-emu/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ path: string[] }> };

async function manejar(req: Request, { params }: Params) {
  const { path } = await params;
  return despachar(req, path || []);
}

export const GET = manejar;
export const POST = manejar;
export const PUT = manejar;
export const PATCH = manejar;
export const DELETE = manejar;
