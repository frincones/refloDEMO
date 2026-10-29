import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica X-Webhook-Signature: t=<unix>,v1=<hex> (HMAC-SHA256 de "<t>.<body crudo>" con el secreto whsec_... completo).
 * Rechaza si |ahora − t| > toleranciaSeg (5 min por defecto).
 */
export function verificarFirma(
  cuerpoCrudo: string,
  cabecera: string | null,
  secreto: string,
  toleranciaSeg = 300,
): { ok: true; t: number } | { ok: false; motivo: string } {
  if (!cabecera) return { ok: false, motivo: "falta X-Webhook-Signature" };
  const partes: Record<string, string> = {};
  for (const p of cabecera.split(",")) {
    const i = p.indexOf("=");
    if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  if (!partes.t || !partes.v1) return { ok: false, motivo: "formato de firma no soportado (se espera t=,v1=)" };
  const t = Number(partes.t);
  if (!Number.isFinite(t)) return { ok: false, motivo: "t inválido" };
  if (Math.abs(Date.now() / 1000 - t) > toleranciaSeg) return { ok: false, motivo: "timestamp fuera de la ventana de 5 minutos" };
  const esperado = createHmac("sha256", secreto).update(`${partes.t}.${cuerpoCrudo}`).digest("hex");
  const a = Buffer.from(partes.v1);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: "firma inválida" };
  return { ok: true, t };
}
