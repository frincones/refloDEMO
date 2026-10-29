// API del panel del operador del emulador (/emulador). Header requerido: x-admin-token.
import { despacharAdmin } from "@/lib/waygo-emu/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ path: string[] }> };

async function manejar(req: Request, { params }: Params) {
  const { path } = await params;
  return despacharAdmin(req, path || []);
}

export const GET = manejar;
export const POST = manejar;
