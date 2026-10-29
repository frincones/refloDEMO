import "server-only";
import { fechaLarga } from "@/lib/workers/util";

// Turnos de botón con intención inequívoca: se resuelven sin LLM (latencia < 1 s).
// Las herramientas pasan por el mismo gateway (permisos, validación y auditoría en `eventos`);
// solo la redacción es una plantilla. Los botones que necesitan conversación (otra_fecha,
// cambiar_direccion, dia_d_no, dia_d_tercero, hablar_persona) siguen yendo al modelo.

type CtxRapido = {
  fecha_entrega_prevista: string;
  envio: { comprador: string; tienda: string | null; contra_entrega: boolean; cod_monto_texto: string };
  promesa_vigente: null | { estado: string; franja: string | null; preferencia_pago: string | null; fecha_entrega: string | null };
};

export type LlamadaRapida = { nombre: string; args: Record<string, unknown> };
export type ResultadoRapido = { ok?: boolean; [k: string]: unknown };

export type PlanRapido = {
  llamadas: LlamadaRapida[];
  /** Texto final (recibe los resultados en el mismo orden de `llamadas`). */
  texto: (r: ResultadoRapido[]) => string;
};

const FRANJAS: Record<string, [string, string, string]> = {
  franja_manana: ["08:00", "12:00", "de 8 am a 12 m"],
  franja_tarde: ["14:00", "17:00", "de 2 pm a 5 pm"],
  franja_noche: ["17:00", "20:00", "de 5 pm a 8 pm"],
};


/** Devuelve el plan determinista para el botón, o null si debe resolverlo el modelo. */
export function planBoton(botonId: string | undefined, ctx: CtxRapido): PlanRapido | null {
  if (!botonId) return null;
  const n = ctx.envio.comprador || "";
  const hola = n ? `, ${n}` : "";
  const fecha = fechaLarga(ctx.fecha_entrega_prevista);
  const monto = ctx.envio.cod_monto_texto;
  const cod = ctx.envio.contra_entrega;
  const pv = ctx.promesa_vigente;
  const prepago = pv?.estado === "CONFIRMADO_PREPAGO";
  const ev = { tipo: "boton", cita: botonId };
  const franjaPv = pv?.estado === "CONFIRMADO_VENTANA" && pv.franja ? pv.franja.split("–") : null;

  switch (botonId) {
    case "si_efectivo": {
      if (prepago) return { llamadas: [], texto: () => `¡Listo${hola}! Tu pedido ya está pagado, así que el mensajero no te cobrará nada. Te avisamos cuando vaya en camino.` };
      // Si ya había elegido franja, se conserva (CONFIRMADO_VENTANA + efectivo)
      const args = franjaPv
        ? { estado: "CONFIRMADO_VENTANA", confianza: 0.9, evidencia: ev, franja_inicio: franjaPv[0], franja_fin: franjaPv[1], preferencia_pago: "efectivo" }
        : { estado: "CONFIRMADO", confianza: 0.9, evidencia: ev, preferencia_pago: "efectivo" };
      return {
        llamadas: [{ nombre: "entrega_registrar_intencion", args }],
        texto: () =>
          `¡Listo${hola}! Queda confirmado para el ${fecha}${franjaPv ? ` entre ${franjaPv[0]} y ${franjaPv[1]}` : ""}, pago contra entrega en efectivo por ${monto}. ¿Necesitas que el mensajero lleve cambio?`,
      };
    }
    case "otra_franja":
      return {
        llamadas: [{ nombre: "whatsapp_ofrecer_botones", args: { opciones: ["franja_manana", "franja_tarde", "franja_noche"] } }],
        texto: () => `Claro${hola}. ¿Qué franja te sirve para recibir el ${fecha}?`,
      };
    case "franja_manana":
    case "franja_tarde":
    case "franja_noche": {
      const [ini, fin, txt] = FRANJAS[botonId];
      const pago = pv?.preferencia_pago === "efectivo" || pv?.preferencia_pago === "link" ? pv.preferencia_pago : undefined;
      const preguntaPago = cod && !prepago && !pago;
      return {
        llamadas: [
          { nombre: "entrega_registrar_intencion", args: { estado: "CONFIRMADO_VENTANA", confianza: 0.9, evidencia: ev, franja_inicio: ini, franja_fin: fin, ...(pago ? { preferencia_pago: pago } : {}) } },
          ...(preguntaPago ? [{ nombre: "whatsapp_ofrecer_botones", args: { opciones: ["si_efectivo", "pagar_digital"] } }] : []),
        ],
        texto: () =>
          `Perfecto${hola}, queda para el ${fecha} ${txt}.` + (preguntaPago ? ` ¿Tendrás los ${monto} en efectivo para el mensajero?` : prepago ? " Ya está pagado: no tendrás que pagar nada en la puerta." : ""),
      };
    }
    case "pagar_digital":
      if (!cod || prepago) return null;
      return {
        llamadas: [{ nombre: "pago_generar_link", args: { metodo: "nequi" } }],
        texto: (r) => {
          const x = r[0] || {};
          return `Listo${hola}. Puedes pagar ${String(x.monto_texto ?? monto)} por Nequi o Bre-B en este enlace: ${String(x.link)}\nApenas se refleje el pago, el mensajero no te cobrará nada en la puerta.`;
        },
      };
    case "confirmar_cancelacion":
      return {
        llamadas: [{ nombre: "entrega_registrar_intencion", args: { estado: "RECHAZADO", confianza: 0.9, evidencia: ev, motivo: "no especificado (confirmó con el botón)" } }],
        texto: () => `Listo${hola}. Cancelamos la entrega de tu pedido; no tienes que hacer nada más. Gracias por avisarnos 🙏`,
      };
    case "mantener_pedido":
      return {
        llamadas: [
          { nombre: "entrega_registrar_intencion", args: { estado: "CONFIRMADO", confianza: 0.9, evidencia: ev } },
          ...(cod && !prepago ? [{ nombre: "whatsapp_ofrecer_botones", args: { opciones: ["si_efectivo", "pagar_digital"] } }] : []),
        ],
        texto: () => `¡Qué bien${hola}! Tu pedido sigue para el ${fecha}.` + (cod && !prepago ? ` ¿Lo pagas en efectivo (${monto}) o prefieres un enlace de pago?` : ""),
      };
    case "dia_d_si": {
      if (prepago) return { llamadas: [], texto: () => `¡Perfecto${hola}! Carlos llega en unos 30 minutos. Tu pedido ya está pagado, no tienes que pagar nada.` };
      const args: Record<string, unknown> = franjaPv
        ? { estado: "CONFIRMADO_VENTANA", confianza: 0.95, evidencia: ev, franja_inicio: franjaPv[0], franja_fin: franjaPv[1] }
        : { estado: "CONFIRMADO", confianza: 0.95, evidencia: ev };
      if (pv?.preferencia_pago === "efectivo" || pv?.preferencia_pago === "link") args.preferencia_pago = pv.preferencia_pago;
      return {
        llamadas: [{ nombre: "entrega_registrar_intencion", args }],
        texto: () => `¡Perfecto${hola}! Carlos llega en unos 30 minutos.` + (cod ? ` Ten a la mano ${monto} 🙌` : ""),
      };
    }
    default:
      return null;
  }
}

