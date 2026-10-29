// Tipos de las filas que la consola lee de Supabase (ver docs/ARQUITECTURA_DEMO.md §3).

export type EstadoIntencion =
  | "PENDIENTE_CONTACTO"
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

/** Estado que muestra la consola: el de la base + CONTACTANDO (pendiente con mensajes del agente). */
export type EstadoVista = EstadoIntencion | "CONTACTANDO";

export type Envio = {
  id: string;
  waygo_shipment_id: string;
  tracking_number: string | null;
  order_number: string | null;
  tienda: string | null;
  comprador_nombre: string | null;
  telefono: string | null;
  telefono_e164: string | null;
  direccion: string | null;
  direccion_linea2: string | null;
  referencia: string | null;
  zona: string | null;
  ciudad: string | null;
  notas: string | null;
  es_cod: boolean | null;
  cod_monto: number | string | null;
  shipment_type_name: string | null;
  delivery_attempts: number | null;
  tracking_url: string | null;
  waygo_status_code: string | null;
  waygo_status_name: string | null;
  waygo_fase: string | null;
  waygo_is_final: boolean | null;
  ultima_novedad: Record<string, unknown> | null;
  waygo_created_at: string | null;
  riesgo: number | string | null;
  riesgo_motivos: unknown;
  prioridad: number | string | null;
  grupo_control: boolean | null;
  estado_buffer: EstadoIntencion;
  validacion: { ok?: boolean; problemas?: string[] } | null;
  created_at: string;
  updated_at: string;
};

export type Promesa = {
  id: string;
  envio_id: string;
  version: number;
  vigente: boolean;
  estado: EstadoIntencion;
  fecha_entrega: string | null;
  franja_inicio: string | null;
  franja_fin: string | null;
  confianza: number | string | null;
  preferencia_pago: string | null;
  nota_mensajero: string | null;
  evidencia: unknown;
  tardia: boolean;
  origen: string | null;
  vigente_desde: string;
  created_at: string;
};

export type Boton = { id: string; titulo?: string; texto?: string };

export type Mensaje = {
  id: string;
  envio_id: string;
  rol: "agente" | "comprador" | "persona" | "sistema";
  texto: string;
  botones: Boton[] | null;
  canal: string;
  metadatos: Record<string, unknown> | null;
  created_at: string;
};

export type Evento = {
  id: string;
  componente: string;
  herramienta: string | null;
  envio_id: string | null;
  entrada: unknown;
  resultado: unknown;
  nivel: "debug" | "info" | "ok" | "aviso" | "error";
  mensaje: string | null;
  created_at: string;
};

export type Caso = {
  id: string;
  envio_id: string;
  tipo: string;
  resumen: string;
  recomendacion: string | null;
  estado: "abierto" | "aprobado" | "rechazado" | "tomado" | "cerrado";
  resuelto_por: string | null;
  resuelto_at: string | null;
  datos: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type Corte = {
  id: string;
  fecha: string;
  hora: string;
  version: number;
  snapshot: unknown;
  created_at: string;
};

export type ConfigDemo = {
  id: number;
  hora_simulada: string | null;
  agentes_pausados: boolean;
  waygo_target: string;
  modo_datos: string;
  updated_at: string;
};
