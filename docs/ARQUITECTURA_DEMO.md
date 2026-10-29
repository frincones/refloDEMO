# Torre de Promesa · Arquitectura del demo (Bloque 1)

Documento para los ingenieros que construyen las fases 4 a 7 (workers, agente, simulador de WhatsApp y consola) sobre esta base.
No contiene secretos: los valores están en `.env.local` (fuera de git) y en Vercel.

- **Producción:** https://reflo-demo.vercel.app (proyecto Vercel `reflo-demo`, equipo `freddy-ricones-projects`, enlazado a GitHub `frincones/refloDEMO`, rama `main`: cada push despliega).
- **Emulador Waygo (URL base):** https://reflo-demo.vercel.app/api/waygo-emu/partner
- **Panel del operador del emulador:** https://reflo-demo.vercel.app/emulador
- **Supabase:** proyecto `dkucoppjceforwrkxpyl` (us-east-1). Local y producción usan **la misma base**.

---

## 1. Estructura de carpetas

```
app/
  layout.tsx, globals.css        Shell del mockup (menú lateral) y estilos/tokens del mockup
  buffer/ whatsapp/ excepciones/ agentes/ resultados/ control/   Pantallas (hoy "En construcción")
  emulador/page.tsx              Panel del operador Waygo (protegido con DEMO_ADMIN_TOKEN)
  api/
    waygo-emu/partner/[...path]  Emulador de la Waygo TMS Partner API v1.0.0 (todas las rutas /v1/*)
    waygo-emu/publico/…          label_url (PDF), tracking_url (HTML) y evidencias simuladas, sin auth
    waygo-emu/admin/[...path]    API del panel del operador (x-admin-token)
    webhooks/waygo               Receptor de webhooks de Waygo (HMAC + dedupe) → envios
    waygo/sync                   Reconciliación GET /v1/shipments → envios (x-admin-token)
    waygo/crear                  Crea N envíos COD de prueba con POST /v1/shipments (x-admin-token)
components/                      Shell, íconos (sprite del mockup)
lib/
  env.ts, admin.ts               Variables de entorno; guardia de x-admin-token para rutas de operación
  supabase/server.ts             Cliente service role (solo servidor; salta RLS)
  supabase/browser.ts            Cliente publishable (navegador: lectura + Realtime)
  waygo/client.ts                Cliente Waygo tipado (emulador o sandbox real)
  waygo/estados.ts               Mapeo de estados por banderas (nunca por código)
  waygo/schema.d.ts              Tipos generados del OpenAPI (npm run gen:spec)
  ingesta/envios.ts              Validación básica, upsert en envios, registrarEvento()
  ingesta/firma.ts               Verificación de X-Webhook-Signature
  waygo-emu/*                    Emulador: router, envíos/estados, webhooks, PDF, semilla, admin, validación
spec/waygo-partner-openapi.yaml  Spec real de Waygo (fuente de verdad del emulador y de las pruebas)
supabase/migrations/*.sql        Migraciones (idempotentes)
scripts/                         db-apply.mjs, emu-seed.mjs, gen-spec.mjs, _env.mjs
tests/contract/run.mjs           Pruebas de contrato (npm run test:contract)
```

Estilos: `app/globals.css` es una copia literal del CSS del mockup (`diagramas/reflo-torre-promesa-mockup.html`): tokens en `:root`, tema oscuro por `prefers-color-scheme` y por `data-theme="dark"` (botón de luna en la barra), fuentes Outfit y JetBrains Mono. Reutilicen las clases del mockup (`.card`, `.btn`, `.chip c-ok|c-warn|c-risk|c-info|c-idle|c-dig|c-ctrl`, `.tiles/.tile`, `table.data`, `.tabs/.tab`, `.countdown`, `.stack`, `.legend`, etc.) copiando el HTML del mockup.

---

## 2. Variables de entorno

| Variable | Dónde | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`NEXT_PUBLIC_SUPABASE_ANON_KEY` legado) | Vercel + local | Cliente del navegador (solo lectura + Realtime) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + local, **solo servidor** | Todas las escrituras |
| `OPENAI_API_KEY`, `OPENAI_MODEL_CONVERSA`, `OPENAI_MODEL_CLASIFICA` | Vercel + local | Fase 5 (agente) |
| `WAYGO_TARGET` | Vercel + local | `emulador` o `sandbox` (informativo; el cambio real es base URL + llave) |
| `WAYGO_API_BASE_URL`, `WAYGO_API_KEY` | Vercel + local | Cliente Waygo. Prod: `https://reflo-demo.vercel.app/api/waygo-emu/partner` |
| `WAYGO_WEBHOOK_SECRET` | Vercel + local | Verificar la firma de los webhooks que recibimos |
| `EMU_WAYGO_API_KEY` | Vercel + local | Llave `tms_c_` sembrada en el emulador para el cliente del demo |
| `EMU_WAYGO_WEBHOOK_SECRET` | Vercel + local | Secreto con que el emulador firma (debe ser igual a `WAYGO_WEBHOOK_SECRET`) |
| `EMU_WAYGO_WEBHOOK_URL` | Vercel + local | A dónde envía webhooks el emulador. Prod: `https://reflo-demo.vercel.app/api/webhooks/waygo`; local: `http://localhost:3000/api/webhooks/waygo` |
| `DEMO_ADMIN_TOKEN` | Vercel + local | Header `x-admin-token` de `/api/waygo-emu/admin/*`, `/api/waygo/*` y (por convención) `/api/demo/*` |
| `DEMO_CONTROL_GROUP_PCT`, `DEMO_CUTOFF_TIME` | Vercel + local | Fase 4 (sorteo de control, hora de corte del buffer) |
| `GITHUB_*`, `VERCEL_*`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_*` | **solo local** | Herramientas (no van a Vercel) |

`.env.example` lista todos los nombres sin valores. Para agregar una variable a Vercel: panel del proyecto → Settings → Environment Variables (Production y Preview), o la API `POST /v10/projects/reflo-demo/env?upsert=true`.

---

## 3. Base de datos

Migraciones en `supabase/migrations/NNNN_nombre.sql`, **idempotentes** (se pueden reaplicar). Se aplican con la Management API de Supabase:

```bash
node scripts/db-apply.mjs                                   # todas, en orden
node scripts/db-apply.mjs supabase/migrations/0003_x.sql    # una
node scripts/db-apply.mjs --sql "select count(*) from envios"   # consulta suelta
```
(lee `SUPABASE_PROJECT_REF` y `SUPABASE_ACCESS_TOKEN` de `.env.local`; hace `POST https://api.supabase.com/v1/projects/{ref}/database/query`). Nuevas migraciones: siguiente número (`0003_…`), con `create … if not exists` / `create or replace`.

### 3.1 Enum `estado_intencion`
`PENDIENTE_CONTACTO, CONFIRMADO, CONFIRMADO_VENTANA, CONFIRMADO_PREPAGO, CONFIRMADO_TERCERO, REPROGRAMADO, SIN_PAGO_HOY, DIRECCION_EN_VALIDACION, RECHAZADO, RIESGO_FRAUDE, NO_CONTACTADO, NUMERO_INVALIDO, GRUPO_CONTROL`. Lo usan `envios.estado_buffer` y `promesas.estado`.

### 3.2 Tablas de la aplicación (RLS: SELECT para anon/authenticated; sin políticas de escritura)

**`envios`** — un registro por envío de Waygo. Upsert por `waygo_shipment_id`.

| Columna | Significado |
|---|---|
| `id` uuid | Id interno (FK de las demás tablas) |
| `waygo_shipment_id` uuid **unique** | Id en Waygo |
| `waygo_client_id` | Cliente dueño (llega en el webhook; null si solo vino por sync) |
| `tracking_number`, `order_number` | Guía y número de pedido |
| `tienda` | `sender_name` (marca de la tienda a nombre de la que se envía) |
| `comprador_nombre`, `telefono`, `telefono_e164` | Destinatario; `telefono_e164` = `+573XXXXXXXXX` o null si no es celular válido |
| `direccion`, `direccion_linea2`, `referencia`, `notas` | Dirección y notas para el mensajero |
| `zona`, `ciudad` | Heurística sobre la dirección (`"…, Barrio, Ciudad"`); Waygo no devuelve la ciudad en el detalle |
| `es_cod`, `payment_type`, `cod_monto` | Pago (el COD solo llega en `GET /v1/shipments/{id}`, nunca en el webhook) |
| `shipping_price`, `pieces_count`, `weight` | Datos del envío |
| `shipment_type_code/_name` | `SAME_DAY` / `NEXT_DAY` (Waygo lo asigna por hora de corte) |
| `delivery_attempts`, `tracking_url`, `label_url` | De Waygo |
| `waygo_status_code/_name`, `waygo_is_initial/_final/_novelty/_return`, `waygo_outcome` | Foto del estado + banderas del catálogo |
| `waygo_fase` | Resultado de `mapearEstado()`: `creado, en_proceso, novedad, devolucion, entregado, cancelado, devuelto, perdido, abandonado, final, desconocido` |
| `ultima_novedad` jsonb | Último `data.novelty` recibido (type_id, type_name, description, reschedule_date) |
| `waygo_created_at`, `waygo_updated_at` | Fechas en Waygo (el sync compara `updated_at`) |
| `riesgo` 0–1, `riesgo_motivos` jsonb, `prioridad` | **null**: los llena el analista de riesgo (Fase 4) |
| `grupo_control` bool | **null** = sin sortear (Fase 4) |
| `estado_buffer` estado_intencion | Estado de la intención. Default `PENDIENTE_CONTACTO`; la ingesta pone `NUMERO_INVALIDO` si el teléfono no es celular colombiano |
| `validacion` jsonb | `{ok, problemas:["telefono_invalido"|"direccion_faltante"|"cod_no_positivo"]}` |
| `fuente` | `webhook` o `sync` (último que lo escribió) |
| `sincronizado_at`, `created_at`, `updated_at` | Trazabilidad (trigger mantiene `updated_at`) |

Regla de la ingesta sobre `estado_buffer`: solo recalcula si el valor actual es `PENDIENTE_CONTACTO` o `NUMERO_INVALIDO` (estados "del validador"). Cualquier otro estado (puesto por el agente, workers o humanos) **no se toca** al llegar nuevos webhooks.

**`promesas`** — historial versionado. Diseño: **historial + bandera `vigente`**. Índice único parcial `(envio_id) where vigente` ⇒ como máximo una vigente por envío; `unique(envio_id, version)`.
Columnas: `estado`, `fecha_entrega`, `franja_inicio/fin`, `confianza` 0–1, `preferencia_pago` (efectivo|nequi|link|prepago|otro), `nota_mensajero`, `evidencia` jsonb, `tardia` (llegó después del corte), `origen` (agente|humano|worker), `vigente_desde/hasta`.
Para cambiar la promesa: en una sola operación, `update … set vigente=false, vigente_hasta=now() where envio_id=$1 and vigente`, luego `insert` con `version = max+1`. Recomendado: una función SQL `registrar_promesa(...)` en la migración 0003 para hacerlo atómico (lo necesita `entrega_registrar_intencion`, que además debe ser idempotente por envío y versión).

**`mensajes`** — `envio_id`, `rol` ∈ (`agente`,`comprador`,`persona`,`sistema`), `texto`, `botones` jsonb (`[{id, texto}]`), `canal` (default `whatsapp`), `metadatos` jsonb, `created_at`.

**`eventos`** — auditoría y feed EN VIVO: `componente` (ingestor, sync, control, agente_contacto, riesgo, planificador, corte, humano…), `herramienta` (nombre MCP o acción), `envio_id` (nullable), `entrada` jsonb, `resultado` jsonb, `nivel` ∈ (`debug`,`info`,`ok`,`aviso`,`error`), `mensaje` (línea legible), `created_at`. Escribir con `registrarEvento()` de `lib/ingesta/envios.ts`.

**`casos`** — excepciones: `envio_id`, `tipo` (fraude|cliente_molesto|cod_alto|tercero_cod|cambio_direccion|otro), `resumen`, `recomendacion`, `estado` ∈ (`abierto`,`aprobado`,`rechazado`,`tomado`,`cerrado`), `resuelto_por`, `resuelto_at`, `datos` jsonb.

**`cortes`** — `fecha`, `hora`, `version`, `snapshot` jsonb; `unique(fecha, version)`.

**`config_demo`** — una sola fila (`id = 1`): `hora_simulada` (null = hora real), `agentes_pausados` (interruptor de apagado), `waygo_target` (`emulador`|`sandbox`), `modo_datos`.

**`waygo_webhooks`** — ids recibidos para dedupe: `webhook_id` (= `X-Webhook-ID`, PK), `evento`, `shipment_id`, `intento`, `payload`, `recibido_at`, `procesado_at`, `error`.

Índices: `envios(estado_buffer)`, `envios(prioridad desc)`, `envios(tracking_number)`, `envios(telefono_e164)`, `promesas(envio_id)`, `mensajes(envio_id, created_at)`, `eventos(envio_id)`, `eventos(created_at desc)`, `casos(envio_id)`, `casos(estado)`.

### 3.3 Realtime
Publicación `supabase_realtime` con `envios, promesas, mensajes, eventos, casos, config_demo`. En el navegador:
```ts
supabaseBrowser().channel("feed").on("postgres_changes", { event: "INSERT", schema: "public", table: "eventos" }, (p) => …).subscribe();
```
Como RLS permite SELECT a `anon`, Realtime entrega los cambios con la publishable key.

### 3.4 Funciones
- `reset_demo()` (security definer, solo `service_role`): vacía `mensajes, promesas, casos, eventos, cortes, waygo_webhooks, envios` y deja `config_demo` en valores iniciales. No toca el emulador. Llamar con `supabaseServer().rpc("reset_demo")`.
- `wg_reset()` (solo `service_role`): vacía todas las tablas `wg_*`. La semilla del emulador va después (necesita la llave del entorno): `POST /api/waygo-emu/admin/seed` o `node scripts/emu-seed.mjs [url]`.
- `wg_next_tracking()`: guía `RF<AAMM>-<consecutivo>` (la secuencia no se reinicia al resembrar).

Reinicio completo del demo: `node scripts/emu-seed.mjs https://reflo-demo.vercel.app` → `reset_demo()` → `POST /api/waygo/sync` (carga los 18 envíos en `envios`).

### 3.5 Tablas del emulador (`wg_*`, RLS sin políticas: solo service role)
`wg_clients` (con `service_cutoff` y tarifas), `wg_api_keys` (solo `sha256` de la llave), `wg_locations`, `wg_warehouses`, `wg_catalogs` (shipment_type, payment_method, cancel_reason con `data.require_comment/client_allowed`), `wg_statuses` (banderas), `wg_novelty_types`, `wg_couriers`, `wg_workflows`, `wg_shipments`, `wg_shipment_events`, `wg_idempotency`, `wg_webhook_subscriptions`, `wg_webhook_deliveries`, `wg_forms_assignments`, `wg_forms_runs`.

---

## 4. Emulador de Waygo

Implementa **todas** las operaciones de `spec/waygo-partner-openapi.yaml` bajo `/api/waygo-emu/partner/v1/…`:
`GET catalogs/{cancel-reasons,locations,novelty-types,payment-methods,shipment-types,statuses,warehouses}`, `POST forms/assignments`, `GET forms/runs/{id}`, `POST quotes`, `GET|POST shipments`, `GET shipments/tracking/{tracking}`, `GET shipments/{id}`, `POST shipments/{id}/cancel`, `GET shipments/{id}/events`, `GET shipments/{id}/label`.

Comportamiento (igual al spec):
- **Auth** `Authorization: Bearer tms_c_…` contra `wg_api_keys`; si no → 401. Todo es por cliente: un envío de otro cliente responde **404** (nunca 403).
- **Errores** `application/problem+json` con `ErrorModel` (`title`, `status`, `detail`, `errors[{location,message,value}]`). Cuerpos validados con ajv contra los esquemas del spec (`additionalProperties: false` ⇒ propiedad desconocida = 422). Parámetros inválidos (uuid, page_size fuera de rango, `level`) → 422.
- **Paginación** `page`/`page_size` (máx. 100 en envíos, 200 en ubicaciones) con `meta {page, page_size, total, total_pages}`; filtros `current_state` y `search` (guía u orden).
- **Idempotency-Key** en `POST /v1/shipments`: 24 h por cliente; mismo cuerpo → 200 con `Idempotent-Replayed: true` y el mismo envío; otro cuerpo → 422; en curso → 409; si la primera falló, la llave queda libre.
- **order_number** único entre envíos vivos de toda la operación: 409; si es propio, `errors[0].value = {shipment_id, tracking_number}`; si es de otro cliente, sin ids. Cancelar libera el número. Sin `order_number` se genera `ORD-…`.
- **Bodegas**: inexistente, inactiva o sucursal ajena → 422 (mismo mensaje); sucursal + `is_pickup=true` → 422. `is_pickup=false` ⇒ pasa a `in_warehouse` al crearse (dos webhooks: `created` y `state_changed`).
- **Reglas de pago**: `cod` exige `cod_amount`; `prepaid` lo rechaza; `declared_value` debe ser igual a `cod_amount` en COD. Ciudad debe ser de nivel `city`. Método de pago desconocido/inactivo → 422.
- **Tipo de servicio** automático por hora de corte del cliente (`wg_clients.service_cutoff`, 13:00 Bogotá): antes → Same Day, después → Next Day. **Precio**: base + recargo Same Day + $/kg cobrable (máx. entre peso y volumétrico L×A×H/5000) + % del COD. `POST /v1/quotes` usa la misma fórmula.
- **Cancelar** solo en estado inicial o en bodega, sin intentos y sin ruta; si no → 409. Motivo desconocido o no permitido al cliente → 422; motivo con `require_comment` sin comentario → 422.
- **label_url** (PDF 4×6" generado al vuelo) y **tracking_url** (página HTML) son públicas por un token aleatorio y apuntan al host del emulador.
- **Estados** sembrados (configurables en `wg_statuses`): `created` (inicial), `in_warehouse`, `in_route`, `novelty` (novedad, `failed_attempt`), `return_in_transit` (`is_return`), `delivered`, `returned`, `cancelled`, `lost` (finales con `outcome`).

**Webhooks**: en cada creación/cambio de estado se encola una entrega por evento y suscripción (`wg_webhook_deliveries`) y se envía **después de responder** (`after()` de Next). Cuerpo `PartnerWebhookEvent` (`event, shipment_id, tracking_number, order_number, client_id, from_state, to_state, timestamp, data{recipient_name, recipient_address, courier_id?, attempt_number?, notes?, novelty?, photo_url(s)?, signature_url?}`) — **sin teléfono ni COD**, como el real. Headers `X-Webhook-ID` (igual en reintentos), `X-Webhook-Event`, `X-Webhook-Attempt`, `X-Webhook-Timestamp`, `X-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<body>")>` con el secreto completo. Entrega + `state_changed` también emite `shipment.delivered`; cancelación también `shipment.cancelled`. Reintentos: 3 intentos (0 s, 1 s, 3 s) — el real hace 8 en ~5 h. Destino: si la suscripción tiene `url`/`secret` null se usan `EMU_WAYGO_WEBHOOK_URL`/`EMU_WAYGO_WEBHOOK_SECRET` **de la instancia que emite** (por eso local entrega a localhost y producción a producción, aunque compartan base).

**Semilla** (`POST /api/waygo-emu/admin/seed`): Colombia → 4 departamentos → 9 ciudades (Bogotá, Medellín, Envigado, Itagüí, Bello, Cali, Palmira, Soacha, Chía); 4 bodegas de la operación (+1 inactiva) y 2 sucursales; Same Day / Next Day; métodos de pago (efectivo COD, Nequi, Daviplata, datáfono, transferencia, 1 inactivo); 6 motivos de cancelación; 8 causales de novedad (no estaba, sin dinero, rechaza, dirección errada, no contesta, reprograma, cerrado, zona de difícil acceso); 3 mensajeros; 2 workflows; clientes: **Tienda Moda Andina** (llave `EMU_WAYGO_API_KEY`, con suscripción de webhooks), Calzado Pacífico, TecnoBarrio, Hogar & Cocina Express (llaves aleatorias internas, 2 envíos cada uno para probar aislamiento) y **QA Contrato** (llave derivada de `DEMO_ADMIN_TOKEN`, sin webhooks). Los **18 envíos del mockup** (guías `RF2610-48213…48381`, Bogotá Sur, COD en COP, celulares +57 3xx en formatos variados) son del cliente del demo y llevan la tienda del mockup en `sender_name` (el spec permite enviar a nombre de varias tiendas con una sola cuenta). Ids deterministas (`uuidDet()` en `lib/waygo-emu/seed.ts`). La semilla no emite webhooks: después hay que llamar `/api/waygo/sync`.

**Panel `/emulador`**: pide `DEMO_ADMIN_TOKEN` (se guarda en `sessionStorage` y se envía como `x-admin-token`; el servidor lo valida en cada llamada). Permite reiniciar y sembrar, crear lotes (opcionalmente con un teléfono inválido), mover envíos (en bodega, en ruta con mensajero, entregado, novedad con causal/descripción/fecha, en devolución, devuelto, cancelado, extraviado), ver y reintentar webhooks, y sincronizar la app.
API admin (header `x-admin-token`): `POST login`, `POST seed`, `GET resumen`, `POST lote {cantidad, incluir_invalido}`, `POST transicion {shipment_id, estado, courier_id?, novelty_type_id?, descripcion?, reschedule_date?}`, `POST reintentar {delivery_id}`, `POST formulario {assignment_id, outcome?}` (simula al conductor y emite `form.run.submitted`).

### Pasar al sandbox real
1. En Vercel: `WAYGO_API_BASE_URL=https://dev-tms-api.waygo.pro/partner`, `WAYGO_API_KEY=<tms_c_ del sandbox>`, `WAYGO_WEBHOOK_SECRET=<whsec del sandbox>`, `WAYGO_TARGET=sandbox` (y `update config_demo set waygo_target='sandbox'`). Redeploy.
2. Pedir al operador que registre el webhook con alcance Cliente apuntando a `https://reflo-demo.vercel.app/api/webhooks/waygo`.
3. Correr `POST /api/waygo/sync`. Nada más cambia: el código decide por banderas del catálogo y usa catálogos leídos de la API.
Notas: el sandbox puede tener otros códigos de estado (no importa), y su catálogo de bodegas/ciudades será distinto (`/api/waygo/crear` los lee en caliente).

---

## 5. Cliente de Waygo (`lib/waygo/client.ts`)

```ts
import { waygo, WaygoError } from "@/lib/waygo/client";   // usa WAYGO_API_BASE_URL + WAYGO_API_KEY
const c = waygo();
await c.listShipments({ page, page_size, current_state, search });   // ShipmentListResponseBody
await c.getShipment(id);                 // ShipmentDetail (incluye recipient_phone y cod_amount)
await c.getShipmentByTracking(guia);
await c.getShipmentEvents(id);           // ShipmentEvent[] (más antiguo primero)
await c.getShipmentLabel(id);            // Uint8Array (PDF)
await c.createShipment(body, idempotencyKey?);   // genera Idempotency-Key si no se pasa; ._replayed
await c.cancelShipment(id, { reason_id, comment });
await c.quote(body);
await c.getCatalog("statuses" | "warehouses" | "shipment-types" | "payment-methods" | "cancel-reasons" | "novelty-types");
await c.getLocations({ level: "city", search: "Bogot" });
await c.createFormAssignment(body);      // ._existente = true si respondió 200 por external_ref
await c.getFormRun(id);
```
- Limitador token-bucket en proceso: 4 req/s (la API pide < 5). Es por instancia de función, no global.
- Reintentos (3) con espera exponencial + jitter ante 5xx, 429 (respeta `Retry-After`), timeout (10 s) y errores de red. 4xx no se reintentan y lanzan `WaygoError` (`status`, `body: ErrorModel`, `esConflicto`, `esValidacion`, `envioExistente` para el 409 de order_number).
- Tipos: `lib/waygo/schema.d.ts` generado con `openapi-typescript` (`npm run gen:spec`, que también regenera `lib/waygo-emu/openapi.json`).

**Estados por banderas** (`lib/waygo/estados.ts`): `mapearEstado(code, catalogo)` y `mapearEstadoCon(cliente, code)` (caché 5 min, refresca si el código no existe). Nunca comparar contra códigos como `"delivered"`; usar `fase` / banderas. Limitación del spec: no hay bandera para distinguir "en bodega" de "en ruta" (ambos son `en_proceso`).

---

## 6. Flujo de ingesta

```
Waygo/emulador ──POST firmado──▶ /api/webhooks/waygo
   1. verifica HMAC (WAYGO_WEBHOOK_SECRET, |ahora−t| ≤ 300 s)        → 401 si falla
   2. inserta X-Webhook-ID en waygo_webhooks (PK)                       → 200 {duplicado:true} si ya estaba
   3. responde 200 de inmediato
   4. after(): GET /v1/shipments/{id} (teléfono + COD) → upsertEnvio() → registrarEvento(componente "ingestor")
      form.* y temperature.excursion: solo evento de auditoría
/api/waygo/sync (x-admin-token): lista todo, pide detalle solo de nuevos/cambiados (estado o updated_at), upsert. Idempotente.
   ?completo=1 fuerza el detalle de todos; ?max_paginas=N.
/api/waygo/crear (x-admin-token): {cantidad} envíos COD de prueba con catálogos leídos de la API.
```
`upsertEnvio()` normaliza el teléfono (`+573XXXXXXXXX`), valida (teléfono, dirección, COD > 0), guarda el estado con banderas y deja `riesgo`, `prioridad`, `grupo_control` en null. El orden de webhooks no está garantizado: como siempre se re-lee el detalle actual, el resultado converge.

---

## 7. Pruebas de contrato

```bash
npm run emu:seed                    # una vez (o tras cambios de semilla)
npm run test:contract               # usa http://localhost:3000 si está arriba; si no, levanta `next dev` en :3123
CONTRACT_BASE_URL=https://reflo-demo.vercel.app npm run test:contract
```
141 verificaciones: cada respuesta se valida contra el esquema del spec para su código (o `default`) con ajv 2020 + `yaml`, incluido content-type (`application/json`, `application/problem+json`, `application/pdf`). Cubre las 14 operaciones con al menos un 2xx (la prueba falla si alguna queda sin cubrir) y los errores principales (401, 404, 405, 409 de idempotencia/order_number/cancelación, 422 de validación y reglas de negocio). Usa el cliente "QA Contrato" (sin webhooks), así que no ensucia `envios`; sí deja envíos de QA en el emulador (se limpian al resembrar).

---

## 8. Seguridad
- `.env.local` está en `.gitignore`; el repo es público. Antes de cada commit: `git status` y `node scripts/check-secrets.mjs` (busca los valores reales de `.env.local` en lo staged y en todo el historial, sin imprimirlos).
- Escrituras solo desde el servidor con service role. El navegador solo lee (RLS) y escucha Realtime.
- Rutas que cambian estado (`/api/waygo/*`, `/api/waygo-emu/admin/*`, futuras `/api/demo/*`) exigen `x-admin-token`. Usen `exigirTokenAdmin(req)` de `lib/admin.ts`. Las pantallas de consola que las llamen deben pedir el token igual que `/emulador` (sessionStorage).
- Nunca escribir el valor de `DEMO_ADMIN_TOKEN` en código ni docs.

---

## 9. Puntos de extensión para las siguientes fases

**Workers (Fase 4)** — crear `lib/workers/*.ts` y exponerlos por `/api/demo/<accion>` (con `exigirTokenAdmin`). Sugerencia de enganche: después de `upsertEnvio()` en el webhook y en el sync, llamar a un `procesarNuevoEnvio(envio_id)` cuando `nuevo === true`.
- *Riesgo*: llenar `envios.riesgo`, `riesgo_motivos`, `prioridad` (P = R × M × U). Datos útiles: `cod_monto`, `telefono_e164` (pedidos repetidos), `waygo_created_at` (madrugada).
- *Grupo de control*: sortear con `DEMO_CONTROL_GROUP_PCT` solo si `grupo_control is null`; poner `estado_buffer='GRUPO_CONTROL'`.
- *Ola / recordatorio*: seleccionar `estado_buffer='PENDIENTE_CONTACTO' and grupo_control=false and waygo_is_final=false`, respetar `config_demo.agentes_pausados`, insertar en `mensajes` (rol `agente`, `botones`) y en `eventos`.
- *Corte*: congelar `snapshot` en `cortes` (siguiente `version` del día) con la promesa vigente de cada envío; `DEMO_CUTOFF_TIME` y `config_demo.hora_simulada`.
- *Día D / medición*: usar `waygo_fase`, `delivery_attempts`, `ultima_novedad` (llegan solos por webhook al mover envíos en `/emulador`).

**Herramientas del agente (Fase 5)** — `lib/agente/herramientas/*.ts` con zod; cada llamada → `registrarEvento({componente:"agente_contacto", herramienta, envio_id, entrada, resultado})`.
- `envio_contexto`: leer `envios` + promesa vigente + últimos `mensajes`; opcionalmente `waygo().getShipmentEvents(waygo_shipment_id)`.
- `entrega_registrar_intencion`: nueva versión en `promesas` + `envios.estado_buffer`; idempotente por (envío, versión).
- `entrega_proponer_cambio`: promesa con `estado` REPROGRAMADO/DIRECCION_EN_VALIDACION y/o `casos`.
- `caso_escalar_a_humano`: insertar en `casos`.
- `pago_generar_link`: enlace simulado con `envios.cod_monto` (nunca el monto del modelo).
- `politicas_buscar`: texto fijo.
Waygo no tiene endpoint para escribir la intención (ver `API_Waygo_TMS_Partner.md` §9): la promesa vive en nuestra base.

**`/api/chat` (Fase 5)** — `app/api/chat/route.ts` (runtime nodejs, `maxDuration` ≤ 60 en Hobby): cargar contexto con `supabaseServer()`, llamar a OpenAI, guardar `mensajes`/`promesas`/`eventos`. Comprobar `config_demo.agentes_pausados`.

**Pantallas (Fases 6–7)** — reemplazar `app/<pantalla>/page.tsx` (hoy `EnConstruccion`). Leer con `supabaseBrowser()` y suscribirse a Realtime; acciones vía rutas del servidor con `x-admin-token`. `/control` debe llamar a `/api/waygo/crear`, `/api/waygo/sync`, `/api/waygo-emu/admin/seed` y a un futuro `/api/demo/reset` (que ejecute `reset_demo()`). Agregar `/envio/[id]` para el detalle.

---

## 10. Decisiones y desviaciones respecto al spec
- **Cuerpo vacío o JSON inválido → 422** (no 400): el spec solo documenta 401/404/409/422/500 en esas operaciones.
- **`POST /v1/forms/assignments`**: el spec solo declara `200`, pero su descripción dice "200 en lugar de 201" al repetir `external_ref`. El emulador responde **201 al crear y 200 al repetir** (el cliente acepta ambos).
- **Validación de workflow**: además de existir, debe estar activo y tener el evento `office.assigned` (texto del spec); si no → 422. Un `shipment_id` ajeno en asignaciones → 422 (el spec no fija el código).
- **Estado de la respuesta al crear** con `is_pickup=false`: se devuelve ya en `in_warehouse` (el spec dice que pasa "apenas se crea").
- **Reintentos de webhooks**: 3 intentos en segundos (no 8 en 5 h) por los límites de Vercel Hobby; el panel permite reintentar a mano.
- **`$schema`** se incluye en las respuestas JSON (como hace Huma), apuntando a `<base>/schemas/<Nombre>.json` (esa ruta no se sirve).
- **405** para métodos no soportados y **404 problem+json** para rutas desconocidas.
- La ciudad no viene en `ShipmentDetail`; `envios.ciudad/zona` se infieren de la dirección.
- `tenant_id` de los webhooks `form.*` usa el id del cliente del demo (el emulador no modela operadores).
