// Genera a partir de spec/waygo-partner-openapi.yaml:
//  - lib/waygo-emu/openapi.json  (el emulador valida peticiones con él en tiempo de ejecución)
//  - lib/waygo/schema.d.ts        (tipos TypeScript del cliente, vía openapi-typescript)
// Uso: npm run gen:spec
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { parse } from "yaml";

const yamlPath = "spec/waygo-partner-openapi.yaml";
const spec = parse(readFileSync(yamlPath, "utf8"));
writeFileSync("lib/waygo-emu/openapi.json", JSON.stringify(spec, null, 1));
execSync(`npx openapi-typescript ${yamlPath} -o lib/waygo/schema.d.ts --default-non-nullable false`, { stdio: "inherit" });
console.log("OK: openapi.json y schema.d.ts generados");
