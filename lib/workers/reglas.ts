import type { AccionRuta, EstadoIntencion } from "@/lib/contratos";

// Reglas de decisión de ruta (Gestor de corte). Código puro: las usa el corte y el evento `intencion` del chat.

export const ESTADOS_EXCLUSION: EstadoIntencion[] = ["RECHAZADO", "REPROGRAMADO", "SIN_PAGO_HOY"];
export const ESTADOS_RETENCION: EstadoIntencion[] = ["RIESGO_FRAUDE", "NUMERO_INVALIDO", "DIRECCION_EN_VALIDACION"];
export const ESTADOS_CONFIRMADOS: EstadoIntencion[] = ["CONFIRMADO", "CONFIRMADO_VENTANA", "CONFIRMADO_PREPAGO", "CONFIRMADO_TERCERO"];
export const RIESGO_ALTO = 0.5;

export type DecisionRuta = { accion: AccionRuta; nota: string | null };

/**
 * Acción de ruta para un envío.
 *  · CONFIRMADO_PREPAGO → INCLUIR "PAGADO, no cobrar"
 *  · GRUPO_CONTROL → INCLUIR (ruteo como hoy)
 *  · RECHAZADO / REPROGRAMADO / SIN_PAGO_HOY → EXCLUIR
 *  · RIESGO_FRAUDE / NUMERO_INVALIDO / DIRECCION_EN_VALIDACION → RETENER
 *  · NO_CONTACTADO (o sin respuesta al corte) → riesgo bajo INCLUIR_BAJA_PRIORIDAD, alto RETENER
 *  · resto por confianza: ≥0,75 INCLUIR · 0,5–0,75 INCLUIR_BAJA_PRIORIDAD · <0,5 RETENER
 */
export function decidirRuta(estado: EstadoIntencion, confianza: number | null | undefined, riesgo: number | null | undefined): DecisionRuta {
  if (estado === "CONFIRMADO_PREPAGO") return { accion: "INCLUIR", nota: "PAGADO, no cobrar" };
  if (estado === "GRUPO_CONTROL") return { accion: "INCLUIR", nota: "Grupo de control: ruteo como hoy" };
  if (ESTADOS_EXCLUSION.includes(estado)) return { accion: "EXCLUIR", nota: null };
  if (ESTADOS_RETENCION.includes(estado)) return { accion: "RETENER", nota: null };
  if (estado === "NO_CONTACTADO" || estado === "PENDIENTE_CONTACTO" || estado === "CONTACTANDO") {
    const alto = (Number(riesgo) || 0) >= RIESGO_ALTO;
    return alto ? { accion: "RETENER", nota: "Sin respuesta y riesgo alto" } : { accion: "INCLUIR_BAJA_PRIORIDAD", nota: "Sin respuesta, riesgo bajo" };
  }
  const c = Number(confianza) || 0;
  if (c >= 0.75) return { accion: "INCLUIR", nota: null };
  if (c >= 0.5) return { accion: "INCLUIR_BAJA_PRIORIDAD", nota: "Aviso de «en camino» el día D" };
  return { accion: "RETENER", nota: "Confianza baja" };
}
