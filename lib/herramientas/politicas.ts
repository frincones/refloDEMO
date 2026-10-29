// Políticas de entrega y FAQ por tienda (texto fijo del demo). Las usa politicas_buscar y el contexto del agente.

export type Politica = {
  tienda: string;
  reprogramacion: string;
  max_reprogramaciones: number;
  max_dias_reprogramar: number;
  pagos: string;
  cambio_direccion: string;
  tercero: string;
  devoluciones: string;
  franjas: string;
  faq: { pregunta: string; respuesta: string }[];
};

const BASE: Omit<Politica, "tienda"> = {
  reprogramacion: "Se puede reprogramar sin costo hasta 2 veces, para una fecha dentro de los próximos 8 días, de lunes a sábado (no domingos ni festivos).",
  max_reprogramaciones: 2,
  max_dias_reprogramar: 8,
  pagos:
    "Pago contra entrega en efectivo por el valor exacto del pedido. También se puede pagar antes por enlace (Nequi, Daviplata, Bre-B o tarjeta). El monto siempre es el del pedido; Reflo nunca pide datos de tarjetas ni claves por chat.",
  cambio_direccion: "El cambio de dirección queda sujeto a validación de cobertura (Bogotá y municipios vecinos). Una persona del equipo lo confirma.",
  tercero: "Puede recibir otra persona mayor de edad si el comprador lo autoriza; debe tener el valor del pedido si es contra entrega.",
  devoluciones: "Si ya no quieres el pedido, se cancela la entrega y vuelve a la tienda. La tienda gestiona cualquier reembolso.",
  franjas: "Franjas de entrega: 8 am – 12 m, 2 pm – 5 pm y 5 pm – 8 pm. La entrega es de lunes a sábado.",
  faq: [
    {
      pregunta: "¿Quién es Reflo? ¿Es una estafa?",
      respuesta: "Reflo es la empresa de mensajería que contrató la tienda para llevar tu pedido. Puedes verificar tu guía en el enlace oficial de seguimiento. Nunca te pediremos claves ni datos de tarjetas.",
    },
    { pregunta: "¿El mensajero lleva cambio?", respuesta: "El mensajero lleva poco cambio; ayuda mucho tener el valor exacto." },
    { pregunta: "¿Puedo revisar el producto?", respuesta: "Puedes revisar el estado externo del paquete antes de pagar. Las garantías las maneja la tienda." },
    { pregunta: "No quiero recibir más mensajes", respuesta: "Puedes pedir la baja del canal en cualquier momento; solo te contactaremos por avisos operativos de tu entrega." },
  ],
};

const ESPECIFICAS: Record<string, Partial<Politica>> = {
  TecnoBarrio: { tercero: "Para tecnología, si recibe otra persona debe presentar la cédula del comprador o la autorización. Pedidos de alto valor requieren validación adicional." },
  "Electro Hogar Sabana": { tercero: "Si recibe otra persona, debe tener el valor exacto y presentar documento. Pedidos de alto valor requieren validación adicional." },
  "Tienda Moda Andina": { devoluciones: "Cambios de talla gratis en 30 días desde la tienda. Si ya no quieres el pedido, se devuelve a la tienda." },
};

export function politicaDe(tienda: string | null | undefined): Politica {
  const t = tienda || "la tienda";
  return { ...BASE, ...(ESPECIFICAS[t] || {}), tienda: t };
}

export function politicaComoTexto(p: Politica): string {
  return [
    `Políticas de entrega de ${p.tienda}:`,
    `- Pagos: ${p.pagos}`,
    `- Reprogramación: ${p.reprogramacion}`,
    `- Franjas: ${p.franjas}`,
    `- Cambio de dirección: ${p.cambio_direccion}`,
    `- Recibe otra persona: ${p.tercero}`,
    `- Si ya no lo quiere: ${p.devoluciones}`,
    ...p.faq.map((f) => `- FAQ «${f.pregunta}»: ${f.respuesta}`),
  ].join("\n");
}
