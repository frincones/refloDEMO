import "server-only";
import { z } from "zod";
import { registrarEvento } from "@/lib/ingesta/envios";
import { CATALOGO } from "./catalogo";
import type { Contexto, ResultadoHerramienta } from "./comun";

// Gateway de herramientas del demo: lista blanca por componente, validación zod y auditoría en `eventos`.

export type { Contexto, ResultadoHerramienta } from "./comun";
export { construirContexto } from "./catalogo";

/** Herramientas permitidas por componente (validado en el servidor, no en el prompt). */
export const PERMISOS: Record<Contexto["componente"], string[]> = {
  agente_contacto: [
    "envio_contexto",
    "entrega_registrar_intencion",
    "entrega_proponer_cambio",
    "caso_escalar_a_humano",
    "pago_generar_link",
    "politicas_buscar",
    "whatsapp_ofrecer_botones",
  ],
  // Clientes MCP externos (p. ej. Claude Desktop en el demo): sin botones de WhatsApp
  mcp_externo: ["envio_contexto", "entrega_registrar_intencion", "entrega_proponer_cambio", "caso_escalar_a_humano", "pago_generar_link", "politicas_buscar"],
  humano: CATALOGO.map((h) => h.nombre),
  worker: ["envio_contexto", "politicas_buscar"],
};

const POR_NOMBRE = new Map(CATALOGO.map((h) => [h.nombre, h]));

export function herramientasDe(componente: Contexto["componente"]) {
  return CATALOGO.filter((h) => PERMISOS[componente].includes(h.nombre));
}

/** Definiciones de function calling para la Responses API de OpenAI. */
export function definicionesOpenAI(componente: Contexto["componente"]) {
  return herramientasDe(componente).map((h) => {
    const schema = z.toJSONSchema(h.esquema, { target: "draft-7" }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: "function" as const, name: h.nombre, description: h.descripcion, parameters: schema, strict: false };
  });
}

/** Ejecuta una herramienta con permisos, validación y auditoría. Nunca lanza: devuelve {ok:false, error}. */
export async function ejecutarHerramienta(nombre: string, entrada: unknown, ctx: Contexto): Promise<ResultadoHerramienta> {
  const inicio = Date.now();
  const h = POR_NOMBRE.get(nombre);
  let resultado: ResultadoHerramienta;
  let nivel: "ok" | "aviso" | "error" = "ok";
  if (!h) {
    resultado = { ok: false, error: `herramienta_desconocida: ${nombre}` };
    nivel = "error";
  } else if (!PERMISOS[ctx.componente]?.includes(nombre)) {
    resultado = { ok: false, error: `permiso_denegado: ${ctx.componente} no puede usar ${nombre}` };
    nivel = "error";
  } else {
    const p = h.esquema.safeParse(entrada ?? {});
    if (!p.success) {
      resultado = { ok: false, error: `entrada_invalida: ${p.error.issues.map((i) => `${i.path.join(".") || "(raíz)"} ${i.message}`).join("; ")}` };
      nivel = "aviso";
    } else {
      try {
        resultado = await h.ejecutar(p.data, ctx);
        if (!resultado.ok) nivel = "aviso";
      } catch (e) {
        resultado = { ok: false, error: (e as Error).message };
        nivel = "error";
      }
    }
  }
  await registrarEvento({
    componente: nombre === "pago_generar_link" && resultado.ok ? "cobro_cod" : ctx.componente,
    herramienta: nombre,
    envio_id: ctx.envio_id,
    entrada: entrada ?? {},
    resultado: { ...resultado, ms: Date.now() - inicio, solicitado_por: ctx.componente },
    nivel,
    mensaje: resultado.ok ? resultado.resumen || nombre : `${nombre}: ${resultado.error}`,
  });
  return resultado;
}
