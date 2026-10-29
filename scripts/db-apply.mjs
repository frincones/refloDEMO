// Aplica migraciones SQL a Supabase vía la Management API.
//   node scripts/db-apply.mjs                         → aplica todas las de supabase/migrations en orden
//   node scripts/db-apply.mjs supabase/migrations/0002_x.sql   → aplica solo ese archivo
//   node scripts/db-apply.mjs --sql "select 1"        → ejecuta una consulta suelta (imprime el resultado)
// Requiere en .env.local: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN.
// Las migraciones deben ser idempotentes (se pueden reaplicar).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cargarEnv, requerir } from "./_env.mjs";

const env = cargarEnv();
requerir(env, "SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN");

export async function ejecutarSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

const args = process.argv.slice(2);
if (args[0] === "--sql") {
  const r = await ejecutarSql(args.slice(1).join(" "));
  console.log(JSON.stringify(r, null, 2));
} else {
  const dir = "supabase/migrations";
  const archivos = args.length ? args : readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => join(dir, f));
  for (const f of archivos) {
    process.stdout.write(`Aplicando ${f} … `);
    try {
      await ejecutarSql(readFileSync(f, "utf8"));
      console.log("OK");
    } catch (e) {
      console.log("ERROR");
      console.error(e.message);
      process.exit(1);
    }
  }
}
