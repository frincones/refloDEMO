-- =====================================================================
-- 0002_emulador_waygo.sql · Estado del emulador de la Waygo TMS Partner API v1.0.0
-- Tablas wg_*: RLS activado SIN políticas → solo el service role (servidor) las usa.
-- Idempotente.
-- =====================================================================

-- Clientes del operador (cada API key tms_c_ pertenece a uno)
create table if not exists public.wg_clients (
  id                 uuid primary key default gen_random_uuid(),
  nombre             text not null,
  telefono_contacto  text,
  direccion          text,
  service_cutoff     time not null default '13:00',   -- antes → SAME_DAY, después → NEXT_DAY (hora Bogotá)
  tarifa_base        numeric(12,2) not null default 8900,
  tarifa_kg          numeric(12,2) not null default 1200,
  cod_fee_pct        numeric(6,4) not null default 0.02,
  tiene_lista_precios boolean not null default true,
  created_at         timestamptz not null default now()
);

-- API keys (se guarda solo el sha256 de la llave)
create table if not exists public.wg_api_keys (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.wg_clients(id) on delete cascade,
  key_hash      text not null unique,
  key_prefix    text not null,
  nombre        text,
  activa        boolean not null default true,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- Catálogo de ubicaciones (country → state → city)
create table if not exists public.wg_locations (
  id         uuid primary key,
  level      text not null check (level in ('country','state','city')),
  code       text,
  name       text not null,
  parent_id  uuid references public.wg_locations(id) on delete cascade
);
create index if not exists wg_locations_level_idx on public.wg_locations (level, parent_id);

-- Bodegas: de la operación (client_id null) o sucursales de un cliente
create table if not exists public.wg_warehouses (
  id         uuid primary key,
  code       text not null,
  name       text not null,
  client_id  uuid references public.wg_clients(id) on delete cascade,
  city_id    uuid references public.wg_locations(id),
  activa     boolean not null default true
);

-- Catálogos simples: shipment_type | payment_method | cancel_reason
create table if not exists public.wg_catalogs (
  tipo    text not null check (tipo in ('shipment_type','payment_method','cancel_reason')),
  id      uuid not null,
  code    text,
  name    text not null,
  activo  boolean not null default true,
  orden   integer not null default 0,
  data    jsonb not null default '{}'::jsonb,   -- cancel_reason: {require_comment, client_allowed}
  primary key (tipo, id)
);

-- Estados configurables con banderas
create table if not exists public.wg_statuses (
  code        text primary key,
  name        text not null,
  color       text,
  is_initial  boolean not null default false,
  is_final    boolean not null default false,
  is_novelty  boolean not null default false,
  is_return   boolean not null default false,
  outcome     text check (outcome is null or outcome in ('delivered','cancelled','returned','failed_attempt','lost','abandoned')),
  orden       integer not null default 0
);

-- Causales de novedad (visita fallida)
create table if not exists public.wg_novelty_types (
  id      uuid primary key,
  code    text,
  name    text not null,
  activo  boolean not null default true,
  orden   integer not null default 0
);

-- Mensajeros (para rutas, asignaciones y formularios)
create table if not exists public.wg_couriers (
  id        uuid primary key,
  nombre    text not null,
  telefono  text,
  placa     text,
  activo    boolean not null default true
);

-- Workflows de formularios del operador
create table if not exists public.wg_workflows (
  id      uuid primary key,
  nombre  text not null,
  evento  text not null default 'office.assigned',
  activo  boolean not null default true,
  forms   jsonb not null default '[]'::jsonb      -- [{node_id, form_name, title_text, version, schema}]
);

-- Envíos
create sequence if not exists public.wg_tracking_seq start 48400;

create table if not exists public.wg_shipments (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references public.wg_clients(id) on delete cascade,
  tracking_number          text not null unique,
  order_number             text not null,
  label_token              text not null unique default encode(gen_random_bytes(16), 'hex'),
  warehouse_id             uuid not null references public.wg_warehouses(id),
  is_pickup                boolean not null,
  recipient_name           text not null,
  recipient_phone          text,
  recipient_address        text not null,
  recipient_address_line2  text,
  recipient_reference      text,
  recipient_city_id        uuid not null references public.wg_locations(id),
  payment_type             text not null check (payment_type in ('prepaid','cod')),
  payment_method_id        uuid,
  cod_amount               numeric(14,2),
  declared_value           numeric(14,2),
  weight                   numeric(10,3),
  length_cm                integer,
  width_cm                 integer,
  height_cm                integer,
  pieces_count             integer not null default 1,
  notes                    text,
  sender_name              text,
  sender_phone             text,
  shipment_type_id         uuid,
  shipment_type_code       text,
  shipment_type_name       text,
  shipping_price           numeric(14,2),
  chargeable_weight_kg     numeric(10,3),
  current_state            text not null references public.wg_statuses(code),
  delivery_attempts        integer not null default 0,
  current_attempt          integer,                 -- intento en curso (en ruta)
  courier_id               uuid references public.wg_couriers(id),
  route_id                 uuid,                    -- != null ⇒ está en una ruta (no se puede cancelar)
  cancelled_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- order_number único entre envíos vivos (un envío cancelado libera su número)
create unique index if not exists wg_shipments_order_vivo_idx
  on public.wg_shipments (order_number) where cancelled_at is null;
create index if not exists wg_shipments_client_idx on public.wg_shipments (client_id, created_at desc);
create index if not exists wg_shipments_state_idx on public.wg_shipments (current_state);

-- Historial de estados
create table if not exists public.wg_shipment_events (
  id              bigserial primary key,
  shipment_id     uuid not null references public.wg_shipments(id) on delete cascade,
  from_state      text not null default '',
  state           text not null,
  state_name      text,
  occurred_at     timestamptz not null default now(),
  notes           text,
  attempt_number  integer,
  novelty         jsonb,
  courier_id      uuid,
  photo_url       text,
  photo_urls      jsonb,
  signature_url   text
);
create index if not exists wg_shipment_events_ship_idx on public.wg_shipment_events (shipment_id, occurred_at, id);

-- Idempotency-Key de POST /v1/shipments (24 h por cliente)
create table if not exists public.wg_idempotency (
  client_id        uuid not null references public.wg_clients(id) on delete cascade,
  key              text not null,
  request_hash     text not null,
  estado           text not null check (estado in ('en_curso','completada')),
  response_status  integer,
  response_body    jsonb,
  shipment_id      uuid,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  primary key (client_id, key)
);

-- Suscripciones de webhooks (url/secret null ⇒ se usan EMU_WAYGO_WEBHOOK_URL / EMU_WAYGO_WEBHOOK_SECRET
-- de la instancia que emite; así local y producción entregan cada una a su propia app)
create table if not exists public.wg_webhook_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.wg_clients(id) on delete cascade,
  url        text,
  secret     text,
  events     text[] not null default array['shipment.created','shipment.state_changed','shipment.delivered','shipment.cancelled','form.run.submitted'],
  activa     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Entregas de webhooks (id = X-Webhook-ID, igual en todos los reintentos)
create table if not exists public.wg_webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid references public.wg_webhook_subscriptions(id) on delete set null,
  client_id        uuid,
  event            text not null,
  shipment_id      uuid,
  url              text,
  body             text not null,          -- body exacto (se firma tal cual)
  estado           text not null default 'pendiente' check (estado in ('pendiente','entregado','fallido')),
  intentos         integer not null default 0,
  ultimo_status    integer,
  ultimo_error     text,
  created_at       timestamptz not null default now(),
  entregado_at     timestamptz,
  ultimo_intento_at timestamptz
);
create index if not exists wg_webhook_deliveries_created_idx on public.wg_webhook_deliveries (created_at desc);

-- Formularios: asignaciones y ejecuciones
create table if not exists public.wg_forms_assignments (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.wg_clients(id) on delete cascade,
  workflow_id   uuid not null references public.wg_workflows(id),
  courier_id    uuid not null references public.wg_couriers(id),
  shipment_id   uuid not null references public.wg_shipments(id) on delete cascade,
  route_id      text,
  stop_id       text,
  vehicle_id    text,
  due_at        timestamptz,
  note          text,
  blocking      boolean not null default false,
  external_ref  text,
  status        text not null default 'pending',
  source        text not null default 'partner_api',
  created_by    text,
  run_id        uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists wg_forms_assignments_ref_idx
  on public.wg_forms_assignments (client_id, external_ref) where external_ref is not null;

create table if not exists public.wg_forms_runs (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid references public.wg_forms_assignments(id) on delete set null,
  client_id      uuid not null references public.wg_clients(id) on delete cascade,
  workflow_id    uuid not null references public.wg_workflows(id),
  shipment_id    uuid references public.wg_shipments(id) on delete cascade,
  route_id       text,
  event          text not null default 'office.assigned',
  status         text not null default 'completed',
  outcome        text not null default 'pass',
  flags          jsonb not null default '[]'::jsonb,
  forms          jsonb not null default '[]'::jsonb,
  file_urls      jsonb not null default '{}'::jsonb,
  incidents      jsonb not null default '[]'::jsonb,
  latitude       double precision,
  longitude      double precision,
  occurred_at    timestamptz not null default now(),
  submitted_at   timestamptz not null default now()
);

-- RLS en todas las tablas wg_* sin políticas (solo service role)
do $$
declare t text;
begin
  foreach t in array array['wg_clients','wg_api_keys','wg_locations','wg_warehouses','wg_catalogs','wg_statuses',
    'wg_novelty_types','wg_couriers','wg_workflows','wg_shipments','wg_shipment_events','wg_idempotency',
    'wg_webhook_subscriptions','wg_webhook_deliveries','wg_forms_assignments','wg_forms_runs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Siguiente número de guía: RF<AAMM>-<consecutivo>
create or replace function public.wg_next_tracking() returns text
language sql security definer set search_path = public as $$
  select 'RF' || to_char(now() at time zone 'America/Bogota', 'YYMM') || '-' || nextval('public.wg_tracking_seq')::text;
$$;
revoke all on function public.wg_next_tracking() from public, anon, authenticated;
grant execute on function public.wg_next_tracking() to service_role;

-- wg_reset(): borra TODO el estado del emulador (envíos, catálogos, clientes, llaves).
-- La semilla se aplica después desde el servidor (POST /api/waygo-emu/admin/seed),
-- porque necesita la llave EMU_WAYGO_API_KEY del entorno.
create or replace function public.wg_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.wg_forms_runs, public.wg_forms_assignments, public.wg_webhook_deliveries,
                 public.wg_webhook_subscriptions, public.wg_idempotency, public.wg_shipment_events,
                 public.wg_shipments, public.wg_workflows, public.wg_couriers, public.wg_novelty_types,
                 public.wg_statuses, public.wg_catalogs, public.wg_warehouses, public.wg_locations,
                 public.wg_api_keys, public.wg_clients restart identity cascade;
  perform setval('public.wg_tracking_seq', 48400, false);
end $$;
revoke all on function public.wg_reset() from public, anon, authenticated;
grant execute on function public.wg_reset() to service_role;
