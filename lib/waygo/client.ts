import "server-only";
import { randomUUID } from "node:crypto";
import type { components } from "./schema";

// Cliente de la Waygo TMS Partner API v1.0.0. Funciona igual contra el emulador
// (WAYGO_API_BASE_URL=<app>/api/waygo-emu/partner) y contra el sandbox real
// (https://dev-tms-api.waygo.pro/partner). Los tipos salen del OpenAPI (lib/waygo/schema.d.ts).

type S = components["schemas"];
export type ShipmentDetail = S["ShipmentDetail"];
export type ShipmentSummary = S["ShipmentSummary"];
export type ShipmentList = S["ShipmentListResponseBody"];
export type ShipmentEvent = S["ShipmentEvent"];
export type CreateShipmentBody = Omit<S["CreateShipmentRequestBody"], "$schema">;
export type CancelShipmentBody = Omit<S["CancelShipmentRequestBody"], "$schema">;
export type QuoteBody = Omit<S["PartnerQuoteRequestBody"], "$schema">;
export type QuoteResponse = S["PartnerQuoteResponseBody"];
export type StatusSummary = S["StatusSummary"];
export type LocationList = S["LocationListResponseBody"];
export type WarehouseSummary = S["WarehouseSummary"];
export type ShipmentTypeSummary = S["ShipmentTypeSummary"];
export type PaymentMethodSummary = S["PaymentMethodSummary"];
export type CancelReasonSummary = S["CancelReasonSummary"];
export type NoveltyTypeSummary = S["NoveltyTypeSummary"];
export type CreateFormAssignmentBody = Omit<S["CreateFormAssignmentRequestBody"], "$schema">;
export type FormsAssignmentView = S["FormsAssignmentView"];
export type FormsRunView = S["FormsPartnerRunView"];
export type ErrorModel = S["ErrorModel"];
export type PartnerWebhookEvent = S["PartnerWebhookEvent"];
export type PartnerFormWebhookEvent = S["PartnerFormWebhookEvent"];

/** Catálogos disponibles con getCatalog(). */
export type Catalogos = {
  statuses: StatusSummary[];
  warehouses: WarehouseSummary[];
  "shipment-types": ShipmentTypeSummary[];
  "payment-methods": PaymentMethodSummary[];
  "cancel-reasons": CancelReasonSummary[];
  "novelty-types": NoveltyTypeSummary[];
};

/** Error tipado de la API (cuerpo problem+json = ErrorModel). */
export class WaygoError extends Error {
  constructor(
    public status: number,
    public body: ErrorModel | null,
    public metodo: string,
    public ruta: string,
  ) {
    super(`Waygo ${metodo} ${ruta} → ${status}${body?.detail ? `: ${body.detail}` : ""}`);
    this.name = "WaygoError";
  }
  get esNoEncontrado() {
    return this.status === 404;
  }
  get esConflicto() {
    return this.status === 409;
  }
  get esValidacion() {
    return this.status === 422;
  }
  /** En un 409 por order_number repetido (envío propio): {shipment_id, tracking_number}. */
  get envioExistente(): { shipment_id: string; tracking_number: string } | null {
    const v = this.body?.errors?.[0]?.value as { shipment_id?: string; tracking_number?: string } | undefined;
    return v?.shipment_id ? { shipment_id: v.shipment_id, tracking_number: v.tracking_number || "" } : null;
  }
}

/** Limitador token-bucket en proceso (por defecto 4 req/s, la API pide < 5). */
class TokenBucket {
  private fichas: number;
  private ultimo = Date.now();
  private cola: Promise<void> = Promise.resolve();
  constructor(
    private capacidad: number,
    private porSegundo: number,
  ) {
    this.fichas = capacidad;
  }
  tomar(): Promise<void> {
    // Serializa las esperas para respetar el orden de llegada
    const turno = this.cola.then(async () => {
      for (;;) {
        const ahora = Date.now();
        this.fichas = Math.min(this.capacidad, this.fichas + ((ahora - this.ultimo) / 1000) * this.porSegundo);
        this.ultimo = ahora;
        if (this.fichas >= 1) {
          this.fichas -= 1;
          return;
        }
        await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.fichas) / this.porSegundo) * 1000)));
      }
    });
    this.cola = turno.catch(() => undefined);
    return turno;
  }
}

export type OpcionesCliente = {
  baseUrl: string; // incluye /partner
  apiKey: string; // tms_c_...
  reqPorSegundo?: number; // por defecto 4
  reintentos?: number; // por defecto 3
  timeoutMs?: number; // por defecto 10000
};

type OpcionesPeticion = {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  binario?: boolean;
};

export type RespuestaCreacion = ShipmentDetail & { _replayed: boolean };

export class WaygoClient {
  private bucket: TokenBucket;
  private base: string;
  constructor(private o: OpcionesCliente) {
    this.base = o.baseUrl.replace(/\/+$/, "");
    this.bucket = new TokenBucket(o.reqPorSegundo ?? 4, o.reqPorSegundo ?? 4);
  }

  /** Petición genérica con limitador, timeout y reintentos con espera creciente (5xx, 429, timeout, red). */
  async request<T>(metodo: string, ruta: string, op: OpcionesPeticion = {}): Promise<{ data: T; headers: Headers; status: number }> {
    const url = new URL(this.base + ruta);
    for (const [k, v] of Object.entries(op.query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const maxReintentos = this.o.reintentos ?? 3;
    let ultimoError: unknown;
    for (let intento = 0; intento <= maxReintentos; intento++) {
      await this.bucket.tomar();
      try {
        const res = await fetch(url, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${this.o.apiKey}`,
            Accept: op.binario ? "application/pdf" : "application/json",
            ...(op.body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...op.headers,
          },
          body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 10000),
          cache: "no-store",
        });
        if (res.status >= 500 || res.status === 429) {
          ultimoError = new WaygoError(res.status, await res.json().catch(() => null), metodo, ruta);
          if (intento < maxReintentos) {
            const retryAfter = Number(res.headers.get("retry-after"));
            await esperar(retryAfter > 0 ? retryAfter * 1000 : backoff(intento));
            continue;
          }
          throw ultimoError;
        }
        if (!res.ok) throw new WaygoError(res.status, await res.json().catch(() => null), metodo, ruta);
        const data = (op.binario ? new Uint8Array(await res.arrayBuffer()) : await res.json()) as T;
        return { data, headers: res.headers, status: res.status };
      } catch (e) {
        if (e instanceof WaygoError) throw e;
        // Timeout o error de red: reintentar
        ultimoError = e;
        if (intento < maxReintentos) {
          await esperar(backoff(intento));
          continue;
        }
      }
    }
    throw ultimoError;
  }

  // ---------------- Envíos ----------------
  listShipments(q: { page?: number; page_size?: number; current_state?: string; search?: string } = {}) {
    return this.request<ShipmentList>("GET", "/v1/shipments", { query: q }).then((r) => r.data);
  }
  getShipment(id: string) {
    return this.request<ShipmentDetail>("GET", `/v1/shipments/${encodeURIComponent(id)}`).then((r) => r.data);
  }
  getShipmentByTracking(tracking: string) {
    return this.request<ShipmentDetail>("GET", `/v1/shipments/tracking/${encodeURIComponent(tracking)}`).then((r) => r.data);
  }
  getShipmentEvents(id: string) {
    return this.request<S["ShipmentEventsResponseBody"]>("GET", `/v1/shipments/${encodeURIComponent(id)}/events`).then((r) => r.data.data || []);
  }
  getShipmentLabel(id: string) {
    return this.request<Uint8Array>("GET", `/v1/shipments/${encodeURIComponent(id)}/label`, { binario: true }).then((r) => r.data);
  }
  /**
   * Crea un envío con Idempotency-Key (si no se pasa, se genera una; los reintentos internos la reutilizan).
   * Guarda la llave junto al pedido si quieres reintentar tú mismo más tarde.
   */
  async createShipment(body: CreateShipmentBody, idempotencyKey: string = randomUUID()): Promise<RespuestaCreacion> {
    const r = await this.request<ShipmentDetail>("POST", "/v1/shipments", { body, headers: { "Idempotency-Key": idempotencyKey } });
    return { ...r.data, _replayed: r.headers.get("idempotent-replayed") === "true" };
  }
  cancelShipment(id: string, body: CancelShipmentBody) {
    return this.request<ShipmentDetail>("POST", `/v1/shipments/${encodeURIComponent(id)}/cancel`, { body }).then((r) => r.data);
  }
  quote(body: QuoteBody) {
    return this.request<QuoteResponse>("POST", "/v1/quotes", { body }).then((r) => r.data);
  }

  // ---------------- Catálogos ----------------
  async getCatalog<K extends keyof Catalogos>(nombre: K): Promise<Catalogos[K]> {
    const r = await this.request<{ data: Catalogos[K] | null }>("GET", `/v1/catalogs/${nombre}`);
    return (r.data.data || []) as Catalogos[K];
  }
  getLocations(q: { level?: "country" | "state" | "city"; parent_id?: string; search?: string; page?: number; page_size?: number } = {}) {
    return this.request<LocationList>("GET", "/v1/catalogs/locations", { query: q }).then((r) => r.data);
  }

  // ---------------- Formularios ----------------
  /** 201 si la crea; 200 si ya existía con el mismo external_ref. */
  createFormAssignment(body: CreateFormAssignmentBody) {
    return this.request<FormsAssignmentView>("POST", "/v1/forms/assignments", { body }).then((r) => ({ ...r.data, _existente: r.status === 200 }));
  }
  getFormRun(id: string) {
    return this.request<FormsRunView>("GET", `/v1/forms/runs/${encodeURIComponent(id)}`).then((r) => r.data);
  }
}

function backoff(intento: number): number {
  return Math.min(8000, 400 * 2 ** intento) + Math.floor(Math.random() * 250);
}
function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let porDefecto: WaygoClient | null = null;

/** Cliente configurado con WAYGO_API_BASE_URL y WAYGO_API_KEY (un solo limitador por proceso). */
export function waygo(): WaygoClient {
  if (!porDefecto) {
    const baseUrl = process.env.WAYGO_API_BASE_URL;
    const apiKey = process.env.WAYGO_API_KEY;
    if (!baseUrl || !apiKey) throw new Error("Faltan WAYGO_API_BASE_URL / WAYGO_API_KEY");
    porDefecto = new WaygoClient({ baseUrl, apiKey });
  }
  return porDefecto;
}
