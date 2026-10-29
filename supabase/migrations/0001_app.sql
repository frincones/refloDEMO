-- =====================================================================
-- 0001_app.sql · Tablas de la aplicación (Torre de Promesa · demo Reflo)
-- Idempotente: se puede volver a aplicar sin romper nada.
-- Escrituras: solo desde el servidor (service role). Lectura: consola (anon/authenticated).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Estados de la intención de entrega (nombres de la arquitectura v1)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.estado_intencion as enum (
    'PENDIENTE_CONTACTO',
    'CONFIRMADO',
    'CONFIRMADO_VENTANA',
    'CONFIRMADO_PREPAGO',
    'CONFIRMADO_TERCERO',
    'REPROGRAMADO',
    'SIN_PAGO_HOY',
    'DIRECCION_EN_VALIDACION',
    'RECHAZADO',
    'RIESGO_FRAUDE',
    'NO_CONTACTADO',
    'NUMERO_INVALIDO',
    'GRUPO_CONTROL'
  );
exception when duplicate_object then null; end $$;

-- Mantiene updated_at al día
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- envios: un registro por envío de Waygo (upsert por waygo_shipment_id)
-- ---------------------------------------------------------------------
create table if not exists public.envios (
  id                   uuid primary key default gen_random_uuid(),
  waygo_shipment_id    uuid not null unique,          -- id en Waygo (GET /v1/shipments/{id})
  waygo_client_id      uuid,                          -- cliente dueño (viene en el webhook)
  tracking_number      text,                          -- guía
  order_number         text,                          -- número de pedido de la tienda
  tienda               text,                          -- sender_name (marca de la tienda)
  comprador_nombre     text,                          -- recipient_name
  telefono             text,                          -- recipient_phone tal como llega
  telefono_e164        text,                          -- normalizado (+573XXXXXXXXX) o null si inválido
  direccion            text,                          -- recipient_address
  direccion_linea2     text,                          -- recipient_address_line2
  referencia           text,                          -- recipient_reference
  zona                 text,                          -- barrio (heurística sobre la dirección)
  ciudad               text,                          -- ciudad (heurística sobre la dirección)
  notas                text,                          -- notes para el mensajero
  es_cod               boolean,
  payment_type         text,                          -- prepaid | cod
  cod_monto            numeric(14,2),                 -- cod_amount (COP)
  shipping_price       numeric(14,2),
  pieces_count         integer,
  weight               numeric(10,3),
  shipment_type_code   text,                          -- SAME_DAY | NEXT_DAY (asignado por Waygo)
  shipment_type_name   text,
  delivery_attempts    integer not null default 0,
  tracking_url         text,
  label_url            text,
  -- Foto del estado en Waygo + banderas del catálogo de estados (nunca decidir por el código)
  waygo_status_code    text,
  waygo_status_name    text,
  waygo_is_initial     boolean,
  waygo_is_final       boolean,
  waygo_is_novelty     boolean,
  waygo_is_return      boolean,
  waygo_outcome        text,
  waygo_fase           text,                          -- salida de mapearEstado(): creado|en_bodega|en_reparto|novedad|entregado|cancelado|devolucion|devuelto|perdido|final
  ultima_novedad       jsonb,                         -- último objeto novelty recibido
  waygo_created_at     timestamptz,
  waygo_updated_at     timestamptz,
  -- Campos de negocio (los llenan los workers de la Fase 4; quedan null hasta entonces)
  riesgo               numeric(4,3) check (riesgo is null or (riesgo >= 0 and riesgo <= 1)),
  riesgo_motivos       jsonb,
  prioridad            numeric(10,4),
  grupo_control        boolean,                       -- null = aún no sorteado
  estado_buffer        public.estado_intencion not null default 'PENDIENTE_CONTACTO',
  validacion           jsonb,                         -- {ok:boolean, problemas:[...]} del validador básico
  fuente               text,                          -- webhook | sync
  sincronizado_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists envios_estado_buffer_idx on public.envios (estado_buffer);
create index if not exists envios_prioridad_idx on public.envios (prioridad desc nulls last);
create index if not exists envios_tracking_idx on public.envios (tracking_number);
create index if not exists envios_telefono_idx on public.envios (telefono_e164);
drop trigger if exists envios_updated_at on public.envios;
create trigger envios_updated_at before update on public.envios
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- promesas: historial versionado. Una sola fila vigente por envío.
-- Para cambiar la promesa: marcar la vigente como vigente=false (vigente_hasta=now())
-- e insertar una nueva con version = max(version)+1, en la misma transacción/RPC.
-- ---------------------------------------------------------------------
create table if not exists public.promesas (
  id               uuid primary key default gen_random_uuid(),
  envio_id         uuid not null references public.envios(id) on delete cascade,
  version          integer not null default 1,
  vigente          boolean not null default true,
  estado           public.estado_intencion not null,
  fecha_entrega    date,
  franja_inicio    timestamptz,
  franja_fin       timestamptz,
  confianza        numeric(4,3) check (confianza is null or (confianza >= 0 and confianza <= 1)),
  preferencia_pago text,                -- efectivo | nequi | link | prepago | otro
  nota_mensajero   text,
  evidencia        jsonb,               -- citas del comprador, botones, herramientas usadas
  tardia           boolean not null default false,  -- llegó después del corte
  origen           text,                -- agente | humano | worker
  vigente_desde    timestamptz not null default now(),
  vigente_hasta    timestamptz,
  created_at       timestamptz not null default now(),
  unique (envio_id, version)
);
create unique index if not exists promesas_una_vigente_idx on public.promesas (envio_id) where vigente;
create index if not exists promesas_envio_idx on public.promesas (envio_id);
create index if not exists promesas_estado_idx on public.promesas (estado) where vigente;

-- ---------------------------------------------------------------------
-- mensajes: conversación simulada de WhatsApp
-- ---------------------------------------------------------------------
create table if not exists public.mensajes (
  id          uuid primary key default gen_random_uuid(),
  envio_id    uuid not null references public.envios(id) on delete cascade,
  rol         text not null check (rol in ('agente','comprador','persona','sistema')),
  texto       text not null default '',
  botones     jsonb,                    -- [{id, texto}] respuestas rápidas
  canal       text not null default 'whatsapp',
  metadatos   jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists mensajes_envio_idx on public.mensajes (envio_id, created_at);

-- ---------------------------------------------------------------------
-- eventos: auditoría + feed EN VIVO de agentes/workers/ingestor
-- ---------------------------------------------------------------------
create table if not exists public.eventos (
  id          uuid primary key default gen_random_uuid(),
  componente  text not null,            -- ingestor | sync | agente_contacto | riesgo | planificador | corte | humano | emulador ...
  herramienta text,                     -- nombre de la herramienta MCP o acción
  envio_id    uuid references public.envios(id) on delete cascade,
  entrada     jsonb,
  resultado   jsonb,
  nivel       text not null default 'info' check (nivel in ('debug','info','ok','aviso','error')),
  mensaje     text,                     -- línea legible para el feed
  created_at  timestamptz not null default now()
);
create index if not exists eventos_envio_idx on public.eventos (envio_id);
create index if not exists eventos_created_idx on public.eventos (created_at desc);

-- ---------------------------------------------------------------------
-- casos: bandeja de excepciones para humanos
-- ---------------------------------------------------------------------
create table if not exists public.casos (
  id             uuid primary key default gen_random_uuid(),
  envio_id       uuid not null references public.envios(id) on delete cascade,
  tipo           text not null,          -- fraude | cliente_molesto | cod_alto | tercero_cod | cambio_direccion | otro
  resumen        text not null,
  recomendacion  text,
  estado         text not null default 'abierto' check (estado in ('abierto','aprobado','rechazado','tomado','cerrado')),
  resuelto_por   text,
  resuelto_at    timestamptz,
  datos          jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists casos_envio_idx on public.casos (envio_id);
create index if not exists casos_estado_idx on public.casos (estado);
drop trigger if exists casos_updated_at on public.casos;
create trigger casos_updated_at before update on public.casos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- cortes: snapshot congelado del buffer
-- ---------------------------------------------------------------------
create table if not exists public.cortes (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  hora        time not null,
  version     integer not null default 1,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),
  unique (fecha, version)
);

-- ---------------------------------------------------------------------
-- config_demo: una sola fila (id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.config_demo (
  id                smallint primary key default 1 check (id = 1),
  hora_simulada     timestamptz,             -- null = hora real
  agentes_pausados  boolean not null default false,  -- interruptor de apagado
  waygo_target      text not null default 'emulador' check (waygo_target in ('emulador','sandbox')),
  modo_datos        text not null default 'emulador',
  updated_at        timestamptz not null default now()
);
insert into public.config_demo (id) values (1) on conflict (id) do nothing;
drop trigger if exists config_demo_updated_at on public.config_demo;
create trigger config_demo_updated_at before update on public.config_demo
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- waygo_webhooks: ids recibidos (dedupe por X-Webhook-ID) y su procesamiento
-- ---------------------------------------------------------------------
create table if not exists public.waygo_webhooks (
  webhook_id    text primary key,           -- X-Webhook-ID
  evento        text not null,
  shipment_id   uuid,
  intento       integer,
  payload       jsonb,
  recibido_at   timestamptz not null default now(),
  procesado_at  timestamptz,
  error         text
);
create index if not exists waygo_webhooks_recibido_idx on public.waygo_webhooks (recibido_at desc);

-- ---------------------------------------------------------------------
-- RLS: activado en todo. Solo lectura para la consola; sin políticas de escritura.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['envios','promesas','mensajes','eventos','casos','cortes','config_demo','waygo_webhooks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lectura_consola on public.%I', t);
    execute format('create policy lectura_consola on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['envios','promesas','mensajes','eventos','casos','config_demo'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- reset_demo(): deja la app lista para empezar de nuevo (no toca el emulador)
-- ---------------------------------------------------------------------
create or replace function public.reset_demo() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate table public.mensajes, public.promesas, public.casos, public.eventos,
                 public.cortes, public.waygo_webhooks, public.envios restart identity cascade;
  update public.config_demo
     set hora_simulada = null, agentes_pausados = false
   where id = 1;
  insert into public.config_demo (id) values (1) on conflict (id) do nothing;
end $$;
revoke all on function public.reset_demo() from public, anon, authenticated;
grant execute on function public.reset_demo() to service_role;
