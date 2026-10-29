// Estados de la intención con los colores y etiquetas del mockup aprobado.
import type { Envio, EstadoIntencion, EstadoVista, Promesa } from "./tipos";
import { fechaCorta, franja, num } from "./formato";

export type DefEstado = { label: string; cls: string; seg: string };

export const ESTADOS: Record<EstadoVista, DefEstado> = {
  CONFIRMADO: { label: "Confirmado", cls: "c-ok", seg: "--seg-ok" },
  CONFIRMADO_VENTANA: { label: "Confirmado · franja", cls: "c-ok", seg: "--seg-ok2" },
  CONFIRMADO_PREPAGO: { label: "Confirmado · prepago", cls: "c-dig", seg: "--seg-dig" },
  CONFIRMADO_TERCERO: { label: "Confirmado · tercero", cls: "c-ok", seg: "--seg-ok2" },
  CONTACTANDO: { label: "Contactando", cls: "c-warn", seg: "--seg-warn" },
  PENDIENTE_CONTACTO: { label: "Por contactar", cls: "c-idle", seg: "--seg-idle" },
  NO_CONTACTADO: { label: "No contactado", cls: "c-idle", seg: "--seg-idle" },
  NUMERO_INVALIDO: { label: "Número inválido", cls: "c-risk", seg: "--seg-addr" },
  SIN_PAGO_HOY: { label: "Sin pago hoy", cls: "c-info", seg: "--seg-info" },
  REPROGRAMADO: { label: "Reprogramado", cls: "c-info", seg: "--seg-info" },
  DIRECCION_EN_VALIDACION: { label: "Dirección en validación", cls: "c-warn", seg: "--seg-addr" },
  RECHAZADO: { label: "Rechazado", cls: "c-risk", seg: "--seg-risk" },
  RIESGO_FRAUDE: { label: "Riesgo de fraude", cls: "c-risk", seg: "--seg-risk" },
  GRUPO_CONTROL: { label: "Grupo control", cls: "c-ctrl", seg: "--seg-ctrl" },
};

/** Orden de la barra apilada y de la leyenda. */
export const ORDEN_ESTADOS: EstadoVista[] = [
  "CONFIRMADO",
  "CONFIRMADO_VENTANA",
  "CONFIRMADO_TERCERO",
  "CONFIRMADO_PREPAGO",
  "CONTACTANDO",
  "PENDIENTE_CONTACTO",
  "NO_CONTACTADO",
  "REPROGRAMADO",
  "SIN_PAGO_HOY",
  "DIRECCION_EN_VALIDACION",
  "NUMERO_INVALIDO",
  "RECHAZADO",
  "RIESGO_FRAUDE",
  "GRUPO_CONTROL",
];

export function defEstado(e: string | null | undefined): DefEstado {
  return ESTADOS[(e as EstadoVista) || "PENDIENTE_CONTACTO"] || { label: e || "—", cls: "c-idle", seg: "--seg-idle" };
}

export const esConfirmado = (e: string | null | undefined) => !!e && e.startsWith("CONFIRMADO");

/** Estado que muestra la consola: si sigue pendiente pero el agente ya escribió, está "Contactando". */
export function estadoVista(envio: Pick<Envio, "estado_buffer">, contactado: boolean): EstadoVista {
  if (envio.estado_buffer === "PENDIENTE_CONTACTO" && contactado) return "CONTACTANDO";
  return envio.estado_buffer;
}

/** Detalle corto del chip ("2–5 pm", "sáb 31 oct", "pagado"…). */
export function detalleEstado(estado: EstadoVista, p: Promesa | null | undefined): string {
  if (!p) return "";
  if (estado === "CONFIRMADO_VENTANA") return franja(p.franja_inicio, p.franja_fin);
  if (estado === "REPROGRAMADO" && p.fecha_entrega) return fechaCorta(p.fecha_entrega);
  if (estado === "CONFIRMADO_PREPAGO" && p.preferencia_pago) return p.preferencia_pago;
  return "";
}

export type NivelRiesgo = "alto" | "medio" | "bajo" | null;

export function nivelRiesgo(r: number | string | null | undefined): NivelRiesgo {
  const n = num(r);
  if (n === null) return null;
  if (n >= 0.6) return "alto";
  if (n >= 0.3) return "medio";
  return "bajo";
}

export const RIESGO: Record<"alto" | "medio" | "bajo", [string, string]> = {
  alto: ["c-risk", "Alto"],
  medio: ["c-warn", "Medio"],
  bajo: ["c-ok", "Bajo"],
};

/** Próxima acción que la torre hará con el envío (texto corto de la tabla). */
export function proximaAccion(estado: EstadoVista, p: Promesa | null | undefined, casoAbierto: boolean): string {
  if (casoAbierto) return "Aprobación humana";
  switch (estado) {
    case "PENDIENTE_CONTACTO":
      return "Ola WhatsApp 9:00";
    case "CONTACTANDO":
      return "Recordatorio 12:30";
    case "CONFIRMADO":
    case "CONFIRMADO_TERCERO":
      return "Va a ruta";
    case "CONFIRMADO_VENTANA":
      return "Va a ruta · aviso día D";
    case "CONFIRMADO_PREPAGO":
      return "Ruta · no cobrar";
    case "REPROGRAMADO":
      return p?.fecha_entrega ? `Reingresa ${fechaCorta(p.fecha_entrega)}` : "Reingresa en la nueva fecha";
    case "SIN_PAGO_HOY":
      return "Ofrecer pago digital";
    case "DIRECCION_EN_VALIDACION":
      return "Validar dirección";
    case "RECHAZADO":
      return "Retener · no sale a ruta";
    case "RIESGO_FRAUDE":
      return "Revisión fraude";
    case "NO_CONTACTADO":
      return "Ruta · baja prioridad";
    case "NUMERO_INVALIDO":
      return "Corregir teléfono";
    case "GRUPO_CONTROL":
      return "Ruteo estándar";
    default:
      return "—";
  }
}

export const TIPOS_CASO: Record<string, { label: string; icono: string; tono: string }> = {
  fraude: { label: "Posible fraude", icono: "shield", tono: "c-risk" },
  cliente_molesto: { label: "Cliente molesto", icono: "angry", tono: "c-warn" },
  cod_alto: { label: "COD alto", icono: "cash", tono: "c-risk" },
  tercero_cod: { label: "Recibe un tercero con COD", icono: "users", tono: "c-info" },
  cambio_direccion: { label: "Cambio de dirección", icono: "pin", tono: "c-warn" },
  otro: { label: "Excepción", icono: "flag", tono: "c-idle" },
};

export function defCaso(tipo: string) {
  return TIPOS_CASO[tipo] || TIPOS_CASO.otro;
}

export const PREFERENCIA_PAGO: Record<string, string> = {
  efectivo: "Efectivo contra entrega",
  nequi: "Nequi",
  link: "Link de pago",
  prepago: "Prepago",
  otro: "Otro",
};

export function todosLosEstados(): EstadoIntencion[] {
  return ORDEN_ESTADOS.filter((e) => e !== "CONTACTANDO") as EstadoIntencion[];
}
