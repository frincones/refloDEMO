// Carga .env.local (sin dependencias). Las variables ya presentes en process.env tienen prioridad.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function cargarEnv(archivo = ".env.local") {
  const ruta = resolve(process.cwd(), archivo);
  const env = {};
  if (existsSync(ruta)) {
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k in env) env[k] = v;
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !(k in env))) };
}

export function requerir(env, ...nombres) {
  const faltan = nombres.filter((n) => !env[n]);
  if (faltan.length) {
    console.error(`Faltan variables: ${faltan.join(", ")} (revisa .env.local)`);
    process.exit(1);
  }
}
