"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

/**
 * Cliente de Supabase para el NAVEGADOR: publishable key, solo lectura (RLS) + Realtime.
 * Ejemplo Realtime:
 *   supabaseBrowser().channel("envios").on("postgres_changes",
 *     { event: "*", schema: "public", table: "envios" }, (p) => ...).subscribe();
 */
export function supabaseBrowser(): SupabaseClient {
  if (!cliente) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    cliente = createClient(url, key, { auth: { persistSession: false } });
  }
  return cliente;
}
