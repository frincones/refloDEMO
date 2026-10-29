import "server-only";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import spec from "./openapi.json";
import { ErrorApi, type DetalleError } from "./http";

// El emulador valida los cuerpos de las peticiones contra los mismos esquemas del OpenAPI
// (generado desde spec/waygo-partner-openapi.yaml con `npm run gen:spec`).
const ID = "https://waygo-emu.local/spec";
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
ajv.addFormat("double", true);
ajv.addFormat("int64", true);
ajv.addSchema({ $id: ID, components: (spec as { components: unknown }).components });

const cache = new Map<string, ValidateFunction>();

function validador(nombre: string): ValidateFunction {
  let v = cache.get(nombre);
  if (!v) {
    v = ajv.getSchema(`${ID}#/components/schemas/${nombre}`);
    if (!v) throw new Error(`Esquema ${nombre} no existe en el spec`);
    cache.set(nombre, v);
  }
  return v;
}

/** Convierte un error de ajv a un ErrorDetail con el estilo de mensajes de Huma. */
function aDetalle(e: ErrorObject, cuerpo: unknown): DetalleError {
  const ruta = e.instancePath
    .split("/")
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? `[${p}]` : `.${p}`))
    .join("");
  const location = `body${ruta}`;
  let valor: unknown = cuerpo;
  for (const p of e.instancePath.split("/").filter(Boolean)) valor = (valor as Record<string, unknown> | undefined)?.[p];
  const params = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "required":
      return { message: `expected required property ${params.missingProperty} to be present`, location, value: valor };
    case "additionalProperties":
      return { message: "unexpected property", location: `${location}.${params.additionalProperty}`, value: valor };
    case "type":
      return { message: `expected ${params.type}`, location, value: valor };
    case "format":
      return { message: `expected string to be ${params.format === "uuid" ? "RFC 4122 uuid" : `in ${params.format} format`}`, location, value: valor };
    case "enum":
      return { message: `expected value to be one of "${(params.allowedValues as unknown[]).join(", ")}"`, location, value: valor };
    case "maxLength":
      return { message: `expected length <= ${params.limit}`, location, value: valor };
    case "minLength":
      return { message: `expected length >= ${params.limit}`, location, value: valor };
    case "minimum":
      return { message: `expected number >= ${params.limit}`, location, value: valor };
    case "maximum":
      return { message: `expected number <= ${params.limit}`, location, value: valor };
    default:
      return { message: e.message || "invalid value", location, value: valor };
  }
}

/** Valida el body contra components.schemas[nombre]; lanza 422 "validation failed" con errores estilo Huma. */
export function validarCuerpo<T>(nombre: string, cuerpo: unknown): T {
  const v = validador(nombre);
  if (!v(cuerpo)) {
    throw new ErrorApi(
      422,
      "validation failed",
      (v.errors || []).map((e) => aDetalle(e, cuerpo)),
    );
  }
  return cuerpo as T;
}

/** Valida un parámetro de query entero con mínimo/máximo (como Huma). */
export function queryEntero(sp: URLSearchParams, nombre: string, porDefecto: number, min: number, max?: number): number {
  const crudo = sp.get(nombre);
  if (crudo === null || crudo === "") return porDefecto;
  if (!/^-?\d+$/.test(crudo)) {
    throw new ErrorApi(422, "validation failed", [{ message: "expected integer", location: `query.${nombre}`, value: crudo }]);
  }
  const n = Number(crudo);
  if (n < min) throw new ErrorApi(422, "validation failed", [{ message: `expected number >= ${min}`, location: `query.${nombre}`, value: n }]);
  if (max !== undefined && n > max)
    throw new ErrorApi(422, "validation failed", [{ message: `expected number <= ${max}`, location: `query.${nombre}`, value: n }]);
  return n;
}
