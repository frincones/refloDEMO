import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cliente: SupabaseClient | null = null;

/**
 * Cliente de Supabase para el SERVIDOR (route handlers, server actions, workers).
 * Usa la service role: salta RLS. Nunca importarlo desde un componente de cliente.
 */
export function supabaseServer(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "reflo-demo-server" } },
    });
  }
  return cliente;
}
