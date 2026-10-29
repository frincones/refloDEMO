// Verifica que ningún valor secreto de .env.local esté en lo que se va a commitear (staged) ni en el historial.
//   node scripts/check-secrets.mjs          → revisa `git diff --cached` y `git log -p`
// Sale con código 1 si encuentra alguno (no imprime el valor, solo el nombre de la variable).
import { execSync } from "node:child_process";
import { cargarEnv } from "./_env.mjs";

const env = cargarEnv();
const SECRETOS = [
  "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY",
  "WAYGO_API_KEY", "WAYGO_WEBHOOK_SECRET", "EMU_WAYGO_API_KEY", "EMU_WAYGO_WEBHOOK_SECRET", "DEMO_ADMIN_TOKEN",
  "GITHUB_TOKEN", "VERCEL_TOKEN", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL",
];
const texto = execSync("git diff --cached", { maxBuffer: 1e9 }).toString() + execSync("git log -p --all", { maxBuffer: 1e9 }).toString();
const hallados = SECRETOS.filter((k) => env[k] && env[k].length > 8 && texto.includes(env[k]));
const ignorado = execSync("git check-ignore .env.local || true").toString().trim() === ".env.local";
console.log(`.env.local ignorado: ${ignorado ? "sí" : "NO"}`);
console.log(hallados.length ? `SECRETOS ENCONTRADOS: ${hallados.join(", ")}` : "Sin secretos en staged ni en el historial.");
process.exit(hallados.length || !ignorado ? 1 : 0);
