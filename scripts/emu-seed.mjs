// Reinicia y siembra el emulador de Waygo llamando a POST <base>/api/waygo-emu/admin/seed.
//   node scripts/emu-seed.mjs                       → http://localhost:3000
//   node scripts/emu-seed.mjs https://<app>.vercel.app
// Requiere DEMO_ADMIN_TOKEN en .env.local. ¡Borra todos los envíos del emulador!
import { cargarEnv, requerir } from "./_env.mjs";

const env = cargarEnv();
requerir(env, "DEMO_ADMIN_TOKEN");
const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");
const res = await fetch(`${base}/api/waygo-emu/admin/seed`, { method: "POST", headers: { "x-admin-token": env.DEMO_ADMIN_TOKEN } });
const j = await res.json().catch(() => ({}));
console.log(res.status, JSON.stringify(j));
process.exit(res.ok ? 0 : 1);
