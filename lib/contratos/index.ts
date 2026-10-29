// Contrato compartido entre el backend (Bloque 2A: workers, herramientas, agente) y la UI.
// Solo tipos: se puede importar desde componentes de cliente y de servidor.
// Documentación completa en docs/AGENTE.md.

/** Estados de la intención (enum `estado_intencion` de la base). */
export type EstadoIntencion =
  | "PENDIENTE_CONTACTO"
  | "CONTACTANDO"
  | "CONFIRMADO"
  | "CONFIRMADO_VENTANA"
  | "CONFIRMADO_PREPAGO"
  | "CONFIRMADO_TERCERO"
  | "REPROGRAMADO"
  | "SIN_PAGO_HOY"
  | "DIRECCION_EN_VALIDACION"
  | "RECHAZADO"
  | "RIESGO_FRAUDE"
  | "NO_CONTACTADO"
  | "NUMERO_INVALIDO"
  | "GRUPO_CONTROL";

/** Acción de ruta que decide el Gestor de corte (y que se muestra en el panel del agente). */
export type AccionRuta = "INCLUIR" | "INCLUIR_BAJA_PRIORIDAD" | "RETENER" | "EXCLUIR";

export type PreferenciaPago = "efectivo" | "nequi" | "link" | "prepago" | "otro";

/** Botón de respuesta rápida (se guarda así en `mensajes.botones`). */
export type Boton = { id: string; titulo: string };

export type TipoCaso = "fraude" | "cliente_molesto" | "cod_alto" | "tercero_cod" | "cambio_direccion" | "reprogramacion" | "otro";
export type EstadoCaso = "abierto" | "aprobado" | "rechazado" | "tomado" | "cerrado";

// ---------------------------------------------------------------------
// Endpoints /api/demo/* (todos POST con header x-admin-token, salvo el CSV que es GET)
// ---------------------------------------------------------------------

/** POST /api/demo/preparar */
export type PrepararRespuesta = { procesados: number; grupo_control: number };

/** POST /api/demo/ola · POST /api/demo/recordatorio · POST /api/demo/dia-d */
export type EnviadosRespuesta = { enviados: number };

/** 409 de ola/recordatorio/dia-d cuando el interruptor de apagado está activo */
export type ErrorPausa = { error: "agentes_pausados" };

/** Fila de la lista de ruta del corte */
export type ItemCorte = {
  envio_id: string;
  guia: string | null;
  comprador: string | null;
  zona: string | null;
  cod_monto: number | null;
  estado: EstadoIntencion;
  accion: AccionRuta;
  /** "14:00–17:00" o null */
  franja: string | null;
  /** Nota para despacho / mensajero (p. ej. "PAGADO, no cobrar") */
  nota: string | null;
};

/** POST /api/demo/corte */
export type CorteRespuesta = {
  corte_id: string;
  version: number;
  fecha: string; // YYYY-MM-DD (Bogotá)
  hora: string; // HH:MM
  resumen: { incluir: number; baja: number; retener: number; excluir: number };
  items: ItemCorte[];
};
// GET /api/demo/corte/csv?corte_id=<uuid>  (header x-admin-token) → text/csv; sin corte_id = último corte

/** Promesa (fila de `promesas`) */
export type Promesa = {
  id: string;
  envio_id: string;
  version: number;
  vigente: boolean;
  estado: EstadoIntencion;
  fecha_entrega: string | null;
  franja_inicio: string | null; // timestamptz ISO
  franja_fin: string | null;
  confianza: number | null;
  preferencia_pago: PreferenciaPago | null;
  nota_mensajero: string | null;
  evidencia: Record<string, unknown> | null;
  tardia: boolean;
  origen: "agente" | "humano" | "worker" | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  created_at: string;
};

/** POST /api/demo/pago */
export type PagoSolicitud = { envio_id: string };
export type PagoRespuesta = Promesa;

/** POST /api/demo/pausa */
export type PausaSolicitud = { pausado: boolean };
export type PausaRespuesta = { pausado: boolean };

/** POST /api/demo/reset */
export type ResetRespuesta = {
  emulador_sembrado: boolean;
  sincronizados: number;
  procesados: number;
  grupo_control: number;
};

/** POST /api/casos/[id]/resolver */
export type ResolverCasoSolicitud = { accion: "aprobar" | "rechazar" | "tomar" | "devolver"; nota?: string };
export type Caso = {
  id: string;
  envio_id: string;
  tipo: TipoCaso;
  resumen: string;
  recomendacion: string | null;
  estado: EstadoCaso;
  resuelto_por: string | null;
  resuelto_at: string | null;
  datos: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------
// POST /api/chat → Server-Sent Events
// ---------------------------------------------------------------------

export type ChatSolicitud = {
  envio_id: string;
  texto: string;
  boton_id?: string;
  /** Extensión opcional: el texto es la transcripción de una nota de voz */
  es_audio?: boolean;
};

export type EventoIntencion = {
  estado: EstadoIntencion;
  confianza: number;
  franja_inicio?: string; // "HH:MM" (Bogotá)
  franja_fin?: string;
  fecha_entrega?: string; // YYYY-MM-DD
  preferencia_pago?: PreferenciaPago;
  evidencia: string;
  accion_ruta: AccionRuta;
  version: number;
};

/** Mapa nombre de evento SSE → payload (`event: <nombre>\ndata: <json>\n\n`) */
export type EventosChat = {
  delta: { texto: string };
  herramienta: { nombre: string; entrada: unknown; resultado: unknown };
  intencion: EventoIntencion;
  botones: { botones: Boton[] };
  caso: { id: string; tipo: TipoCaso };
  fin: { mensaje_id: string | null };
  error: { mensaje: string };
};
export type NombreEventoChat = keyof EventosChat;

/** Botones de la plantilla de confirmación (ola y recordatorio) */
export const BOTONES_CONFIRMACION: Boton[] = [
  { id: "si_efectivo", titulo: "Sí, estaré y tengo el efectivo" },
  { id: "otra_franja", titulo: "Otra franja" },
  { id: "pagar_digital", titulo: "Pagar con Nequi/Bre-B" },
  { id: "cambiar_direccion", titulo: "Cambiar dirección" },
];

/** Botones del aviso del día D */
export const BOTONES_DIA_D: Boton[] = [
  { id: "dia_d_si", titulo: "Sí, estoy" },
  { id: "dia_d_no", titulo: "No estoy" },
  { id: "dia_d_tercero", titulo: "Recibe otra persona" },
];

/** Catálogo de botones que el agente puede ofrecer (herramienta whatsapp_ofrecer_botones) */
export const CATALOGO_BOTONES: Record<string, Boton> = {
  franja_manana: { id: "franja_manana", titulo: "8 am – 12 m" },
  franja_tarde: { id: "franja_tarde", titulo: "2 pm – 5 pm" },
  franja_noche: { id: "franja_noche", titulo: "5 pm – 8 pm" },
  si_efectivo: { id: "si_efectivo", titulo: "Sí, estaré y tengo el efectivo" },
  pagar_digital: { id: "pagar_digital", titulo: "Pagar con Nequi/Bre-B" },
  otra_fecha: { id: "otra_fecha", titulo: "Otra fecha" },
  confirmar_cancelacion: { id: "confirmar_cancelacion", titulo: "Sí, cancelar el pedido" },
  mantener_pedido: { id: "mantener_pedido", titulo: "No, mejor lo recibo" },
  hablar_persona: { id: "hablar_persona", titulo: "Hablar con una persona" },
  cambiar_direccion: { id: "cambiar_direccion", titulo: "Cambiar dirección" },
};
