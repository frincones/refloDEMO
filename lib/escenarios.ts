// Escenarios de un clic del simulador de WhatsApp (Fase 6). Cada uno llena y envía el mensaje
// del comprador en la conversación seleccionada; la respuesta la da el agente real (/api/chat).

export type Escenario = {
  id: string;
  emoji: string;
  titulo: string;
  texto: string;
  /** Estado de intención que se espera que registre el agente (guía para el ensayo). */
  esperado: string;
  /** Se envía como transcripción de una nota de voz (`es_audio: true` en /api/chat). */
  audio?: boolean;
};

export const ESCENARIOS: Escenario[] = [
  { id: "efectivo", emoji: "✅", titulo: "Confirma con efectivo", texto: "Sí, ahí estaré y tengo el efectivo", esperado: "CONFIRMADO" },
  { id: "tarde", emoji: "🕑", titulo: "Solo en la tarde", texto: "Mañana solo puedo después de las 2 de la tarde", esperado: "CONFIRMADO_VENTANA" },
  { id: "nequi", emoji: "💳", titulo: "Pagar por Nequi", texto: "No tengo efectivo, ¿puedo pagar por Nequi?", esperado: "CONFIRMADO (link de pago) → CONFIRMADO_PREPAGO al simular el pago" },
  { id: "sabado", emoji: "📅", titulo: "Mejor el sábado", texto: "Mañana no puedo, ¿me lo pueden llevar el sábado?", esperado: "REPROGRAMADO" },
  { id: "no_quiero", emoji: "❌", titulo: "Ya no lo quiero", texto: "Ya no quiero el pedido", esperado: "RECHAZADO" },
  { id: "no_pedi", emoji: "🚩", titulo: "Yo no pedí nada", texto: "Yo no hice ningún pedido, ¿quién es usted?", esperado: "RIESGO_FRAUDE" },
  {
    id: "audio",
    emoji: "🎤",
    titulo: "Audio",
    texto: "Sí señor, mañana estoy en la casa después de las 3 y tengo la plata",
    esperado: "CONFIRMADO_VENTANA",
    audio: true,
  },
  { id: "molesto", emoji: "😠", titulo: "Cliente molesto", texto: "Otra vez con lo mismo, ya me lo habían prometido el martes y nada", esperado: "escala a humano" },
];
