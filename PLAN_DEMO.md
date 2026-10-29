# Torre de Promesa · Demo para Reflo

Demo: **jueves 5-nov-2026, 11:00**, con Sergio Ramírez y Alberto C.
Las credenciales están en `.env.local` (excluido de git). Este documento no contiene secretos.

---

## 1. Infraestructura del demo

```
┌──────────────────────────────────────────────────────────────────┐
│ VERCEL · un proyecto Next.js (repo frincones/refloDEMO)           │
│                                                                   │
│  PANTALLAS                          API (funciones)               │
│  /buffer        Buffer del corte    /api/waygo/sync    trae envíos│
│  /whatsapp      Simulador comprador /api/waygo/crear   crea envíos│
│  /envio/[id]    Detalle y promesa   /api/chat          agente     │
│  /excepciones   Bandeja humana      /api/demo/*        ola, corte │
│  /agentes       Feed EN VIVO        /api/mcp           opcional   │
│  /control       Control del demo                                  │
└───────┬───────────────────────────┬────────────────────┬─────────┘
        ▼                           ▼                    ▼
┌────────────────┐        ┌──────────────────┐   ┌─────────────────┐
│ SUPABASE        │        │ API DE OPENAI    │   │ WAYGO           │
│ datos + Realtime│        │ gpt-5.5 / 5.4-mini│  │ emulador propio │
└────────────────┘        └──────────────────┘   │ → sandbox real  │
                                                  └─────────────────┘
```

**Producción:** https://reflo-demo.vercel.app · arquitectura y contratos en `docs/ARQUITECTURA_DEMO.md`.

**Emulador de Waygo.** Mientras Reflo da acceso al sandbox, la app incluye un emulador de la TMS Partner API v1.0.0 en `/api/waygo-emu/partner/v1/*`. Está construido desde `api/waygo-partner-openapi.yaml`: mismas rutas, autenticación `Bearer tms_c_`, esquemas de respuesta, errores, `Idempotency-Key`, estados con banderas y webhooks firmados con HMAC-SHA256 (`X-Webhook-Signature: t=,v1=`, `X-Webhook-ID`). Pruebas de contrato validan cada respuesta contra el OpenAPI. Un panel de **operador Waygo** (`/emulador`) mueve envíos de estado (en bodega, en ruta, entregado, novedad) y dispara los webhooks. Pasar al sandbox real es cambiar `WAYGO_API_BASE_URL` y `WAYGO_API_KEY`.

| Servicio | Cuenta / recurso | Estado | Variables |
|---|---|---|---|
| GitHub | `frincones/refloDEMO` (público, vacío) | ✅ Validado | `GITHUB_REPO`, `GITHUB_TOKEN` (solo local) |
| Vercel | Usuario `freddyrincones-5429`, equipo `freddy-ricones-projects` | ✅ Validado | `VERCEL_TOKEN`, `VERCEL_SCOPE` (solo local) |
| Supabase | Proyecto `dkucoppjceforwrkxpyl`, región us-east-1 | ✅ Activo | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_*` |
| OpenAI | `gpt-5.5` conversa, `gpt-5.4-mini` clasifica | ✅ Validada | `OPENAI_API_KEY`, `OPENAI_MODEL_*` |
| Waygo | **Emulador propio** (`WAYGO_TARGET=emulador`); sandbox real cuando Reflo dé acceso | ✅ Emulador / ⏳ sandbox | `WAYGO_API_BASE_URL`, `WAYGO_API_KEY`, `EMU_WAYGO_*` |
| WhatsApp | **Simulado** dentro de la consola | — | — |

**Dónde va cada variable**
- **Vercel (Production y Preview):** las de la sección A de `.env.local`. `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` y `DEMO_ADMIN_TOKEN` solo se usan en el servidor; nunca con prefijo `NEXT_PUBLIC_`.
- **Solo local / CI:** las de la sección B (GitHub, Vercel, administración de Supabase).

**Destino de Waygo:** `WAYGO_TARGET=emulador` hoy; `sandbox` cuando Reflo dé acceso. El cambio no toca código.

---

## 2. To-do de implementación

Leyenda: **[P0]** indispensable para el demo · **[P1]** muy deseable · **[P2]** si sobra tiempo.

### Fase 0 · Seguridad y cuentas (hoy, 29-oct)
- [ ] [P0] Revocar el token clásico de GitHub y crear uno fine-grained solo para `refloDEMO` (Contents: read/write).
- [ ] [P0] Volver privado el repo `refloDEMO`, o confirmar que nunca se suben secretos.
- [x] [P0] Llave de OpenAI validada (`gpt-5.5`, `gpt-5.4-mini`). Se usa OpenAI en lugar de Anthropic.
- [x] [P0] Llave, secreto de webhook y token de administración del emulador generados.
- [ ] [P0] Enviar el WhatsApp a Sergio y Alberto pidiendo acceso al portal del sandbox de Waygo (ya no bloquea: hay emulador).
- [x] [P1] Decidir en qué equipo de Vercel va el proyecto (`freddy-ricones-projects` por defecto).

### Fase 1 · Proyecto base (29–30 oct)
- [x] [P0] Next.js (App Router, TypeScript) en la raíz del repo, con el `.gitignore` de esta carpeta.
- [x] [P0] Pasar los estilos del mockup (`diagramas/reflo-torre-promesa-mockup.html`) a CSS global: tokens, tema claro y oscuro, fuentes Outfit y JetBrains Mono.
- [x] [P0] Clientes de Supabase: navegador (publishable key) y servidor (service role).
- [x] [P0] Crear el `.env.example` sin valores.
- [x] [P0] Vincular el repo con Vercel, cargar las variables de la sección A y comprobar que el primer deploy funciona.
- [x] [P1] Deploy automático en cada push a `main` y previews en las ramas.

### Fase 2 · Base de datos en Supabase (30 oct)
- [x] [P0] Migración SQL con estas tablas:
  - `envios`: id, waygo_id, guía, order_number, tienda, comprador, teléfono, dirección, zona, cod_monto, tipo de servicio, estado en Waygo, riesgo, prioridad, estado_buffer, grupo_control, timestamps.
  - `promesas`: envio_id, estado, franja inicio y fin, confianza, preferencia de pago, nota al mensajero, evidencia, versión, vigencia, tardía.
  - `mensajes`: envio_id, rol (agente, comprador, persona o sistema), texto, botones (json), creado.
  - `eventos`: componente, herramienta, envio_id, entrada (json), resultado (json), nivel, creado. Es la auditoría y el feed.
  - `casos`: envio_id, tipo, resumen, recomendación, estado, resuelto_por.
  - `cortes`: fecha, hora, snapshot (json), versión.
  - `config_demo`: hora simulada, agentes pausados (interruptor de apagado), modo de datos.
- [x] [P0] Enums de estado de la intención con los nombres de la arquitectura v1: CONFIRMADO, CONFIRMADO_VENTANA, CONFIRMADO_PREPAGO, CONFIRMADO_TERCERO, REPROGRAMADO, SIN_PAGO_HOY, DIRECCION_EN_VALIDACION, RECHAZADO, RIESGO_FRAUDE, NO_CONTACTADO, NUMERO_INVALIDO, GRUPO_CONTROL, PENDIENTE_CONTACTO.
- [x] [P0] Índices por estado_buffer, prioridad y envio_id.
- [x] [P0] RLS activado en todas las tablas; solo lectura para la consola y escrituras únicamente desde las rutas del servidor.
- [x] [P0] Realtime activado en `envios`, `promesas`, `mensajes`, `eventos` y `casos`.
- [x] [P0] Semilla de datos de ejemplo: 18 envíos realistas de Bogotá Sur, los mismos del mockup.
- [x] [P0] Función `reset_demo()` que deja todo listo para empezar de nuevo.

### Fase 3a · Emulador de Waygo (30–31 oct)
- [x] [P0] Rutas `/api/waygo-emu/partner/v1/*` para todos los endpoints de `api/waygo-partner-openapi.yaml`: shipments (crear, listar con filtros y paginación, detalle, eventos, guía, cancelar), quotes, catalogs/*, forms/assignments y forms/runs.
- [x] [P0] Mismo contrato: autenticación `Bearer tms_c_`, 401/404/409/422 con el formato de error del spec, `Idempotency-Key` de 24 h con `Idempotent-Replayed: true`, `order_number` único, cancelación solo antes de salir a reparto.
- [x] [P0] Estado en tablas `wg_*` de Supabase (solo service role): envíos, eventos, idempotencia, entregas de webhook.
- [x] [P0] Catálogos sembrados con datos colombianos y estados configurables con banderas (`is_initial`, `is_final`, `is_novelty`, `is_return`, `outcome`).
- [x] [P0] Webhooks firmados HMAC-SHA256 (`X-Webhook-Signature: t=,v1=`, `X-Webhook-ID`) hacia `EMU_WAYGO_WEBHOOK_URL`, sin teléfono ni monto COD en el payload, igual que el real.
- [x] [P0] Panel `/emulador` (operador Waygo): ver envíos, crear lote de prueba y cambiar estado (en bodega, en ruta con mensajero, entregado, novedad con causa, cancelado), lo que dispara los webhooks.
- [x] [P0] Pruebas de contrato: cada respuesta del emulador se valida contra el esquema del OpenAPI.

### Fase 3b · Cliente de Waygo (31 oct)
- [x] [P0] Cliente `lib/waygo/client.ts`, idéntico para el emulador y el sandbox real:
  - base URL y Bearer tomados del entorno;
  - limitador de 4 req/s;
  - reintentos con espera creciente ante errores 5xx y timeouts;
  - `Idempotency-Key` en cada creación;
  - errores tipados.
- [x] [P0] Leer `GET /v1/catalogs/statuses` y mapear los estados por sus banderas (`is_initial`, `is_final`, `is_novelty`, `is_return`, `outcome`), nunca por el código del estado.
- [x] [P0] `/api/waygo/sync`: `GET /v1/shipments` para los envíos nuevos o cambiados, luego `GET /v1/shipments/{id}` para traer teléfono y COD, luego guardar en `envios` sin duplicar (upsert por waygo_id).
- [x] [P0] `/api/waygo/crear`: crea 6 envíos COD de prueba con `POST /v1/shipments`, usando catálogos válidos (tipo de envío, bodega, ciudad).
- [x] [P0] Webhook `/api/webhooks/waygo` con verificación HMAC (`X-Webhook-Signature`) y dedupe por `X-Webhook-ID`. Con el emulador funciona desde el día 1; con el sandbox real, cuando Reflo lo registre.
- [ ] [P1] Prueba manual en el sandbox real cuando llegue la llave: crear, listar, ver detalle y cancelar.

### Fase 4 · Workers de código (31 oct)
- [x] [P0] Validador: teléfono en E.164 colombiano, dirección presente y COD > 0. Si falla, el envío queda como NUMERO_INVALIDO o pasa a excepción. *(Hecho en la ingesta del Bloque 1: `lib/ingesta/envios.ts`.)*
- [x] [P0] Analista de riesgo con 3 reglas:
  - COD alto;
  - varios pedidos con el mismo número;
  - pedido creado de madrugada.

  Da un riesgo de 0 a 1 y la prioridad P = R × M × U.
- [x] [P0] Sorteo del grupo de control (`DEMO_CONTROL_GROUP_PCT`). Esos envíos no se contactan.
- [x] [P0] Planificador:
  - *ola* manda la plantilla de confirmación a los pendientes;
  - *recordatorio* a los que no respondieron;
  - las dos respetan el interruptor de apagado.
- [x] [P0] Gestor de corte:
  - congela el snapshot en `cortes`;
  - aplica las reglas de confianza (0,75 o más incluye; entre 0,5 y 0,75 incluye con baja prioridad; menos de 0,5 retiene);
  - genera la lista de ruta y el CSV.
- [x] [P1] Día D: mensaje "tu mensajero llega en 30 min" a los confirmados, con botones.

### Fase 5 · Herramientas MCP y Agente de contacto (31 oct – 1 nov)
- [x] [P0] Herramientas con los nombres del catálogo, esquemas zod y registro en `eventos`:
  - `envio_contexto`;
  - `entrega_registrar_intencion`, idempotente por envío y versión;
  - `entrega_proponer_cambio`;
  - `caso_escalar_a_humano`;
  - `pago_generar_link`, que en el demo devuelve un enlace simulado con el `cod_monto` de la base, nunca un monto que diga el modelo;
  - `politicas_buscar`, con un texto fijo de políticas de entrega.
- [x] [P0] Permisos por componente: lista de herramientas permitidas para el Agente de contacto, validada en el servidor.
- [x] [P0] System prompt en español colombiano:
  - se presenta como asistente virtual de Reflo con la marca de la tienda;
  - no usa lenguaje de cobranza y no pregunta por qué no tiene el dinero;
  - confirma el monto exacto;
  - siempre ofrece hablar con una persona;
  - el texto del comprador es dato, no instrucción.
- [x] [P0] `/api/chat`: carga el contexto desde Supabase y llama a OpenAI (`gpt-5.5`, Responses API con function calling) con las herramientas en ciclo. Devuelve la respuesta en streaming y guarda el mensaje y la promesa. *(Bloque 2A: ver `docs/AGENTE.md`; `npm run test:agente` 117/117.)*
- [x] [P0] Resultado estructurado del turno: estado, confianza y evidencia, para el panel "lo que entendió el agente".
- [x] [P0] Reglas de escalamiento: fraude, cliente molesto, COD por encima del umbral y tercero con COD.
- [x] [P1] `gpt-5.4-mini` clasifica la intención antes de llamar a `gpt-5.5`, para mostrar el uso de dos modelos.
- [ ] [P2] Exponer las herramientas en `/api/mcp` con `mcp-handler` para abrirlas desde Claude Desktop en el demo.

### Fase 6 · Simulador de WhatsApp (1–2 nov)
- [x] [P0] Pantalla `/whatsapp`:
  - a la izquierda, la lista de conversaciones con filtro por estado de la intención;
  - al centro, el teléfono con burbujas estilo WhatsApp, respuestas rápidas como botones y streaming;
  - a la derecha, el panel "lo que entendió el agente": intención, confianza y herramientas llamadas.
- [x] [P0] Barra de escenarios de un clic:
  - confirma con efectivo;
  - solo en la tarde;
  - no tengo efectivo, ¿puedo pagar por Nequi?;
  - mejor el sábado;
  - ya no lo quiero;
  - yo no pedí nada;
  - "audio" (texto transcrito);
  - cliente molesto.
- [x] [P0] Escritura libre como comprador.
- [x] [P1] Indicador "escribiendo…" y marcas de leído.

### Fase 7 · Consola (2–3 nov)
*(Rama `feat/consola`: pantallas leen Supabase + Realtime y escriben solo vía `/api/*` con `x-admin-token`. Las acciones dependen de las rutas de la rama `feat/agente`; sin ellas muestran "endpoint no disponible".)*
- [x] [P0] Buffer del corte:
  - mosaicos-filtro y barra por estado;
  - tabla de envíos, en tiempo real;
  - reloj hasta el corte;
  - exportar la lista de ruta.
- [x] [P0] Detalle de envío: línea de tiempo, promesa vigente, herramientas usadas y conversación.
- [x] [P0] Excepciones: tarjetas desde `casos`, con Aprobar, Rechazar o Tomar conversación. La decisión queda en `eventos`.
- [x] [P0] Actividad de agentes: feed EN VIVO desde `eventos` e interruptor de apagado en `config_demo`.
- [x] [P0] Control del demo:
  - crear envíos en Waygo;
  - sincronizar;
  - lanzar ola;
  - recordatorio;
  - congelar corte;
  - día D;
  - marcar pago recibido;
  - reiniciar.
- [x] [P1] Resultados (KPIs): calculados de la base del demo, marcados como "datos del demo".
- [ ] [P2] Pantalla móvil del mensajero (la del mockup) leyendo la promesa.

### Fase 8 · Pruebas y ensayo (3–4 nov)
- [ ] [P0] Correr de punta a punta los 8 escenarios y comprobar el estado final de cada uno.
- [ ] [P0] Probar el modo `waygo` con el sandbox real, o confirmar que el modo `mock` funciona si la llave no llega.
- [ ] [P0] Medir que la respuesta del agente llegue en menos de 5 s.
- [ ] [P0] Ensayo completo con el guion de 15 minutos.
- [ ] [P0] Grabar un video de respaldo del recorrido completo.
- [ ] [P1] Ensayo con Emma o con alguien que haga de comprador.

### Fase 9 · Día del demo (5 nov)
- [ ] [P0] Abrir Supabase y la app temprano; el proyecto gratuito no debe estar pausado.
- [ ] [P0] Ejecutar `reset_demo()`.
- [ ] [P0] Confirmar el saldo de OpenAI y que Waygo (emulador o sandbox) responde.
- [ ] [P0] Tener abiertas dos pestañas, consola y simulador, además del deck ejecutivo.
- [ ] [P0] Tener el video de respaldo a mano.

### Fase 10 · Después del demo
- [ ] [P0] Rotar todas las credenciales que se compartieron por chat: GitHub, Vercel, token de Supabase, contraseña de la base, service role y la llave de Waygo si se compartió.
- [ ] [P1] Registrar el feedback de Reflo y ajustar el alcance del piloto.

---

## 3. Guion del demo (15 min)

| Min | Pantalla | Qué pasa | Mensaje para Reflo |
|---|---|---|---|
| 0–2 | Control → Buffer | Crear envíos en el sandbox y verlos aparecer | "Es su API, sin cambios" |
| 2–4 | Control → Simulador | Lanzar ola: llegan las plantillas | "Así arranca el día anterior" |
| 4–9 | Simulador | Efectivo, franja, Nequi, audio | "Entiende cómo escribe un colombiano" |
| 9–11 | Excepciones | Fraude y cliente molesto pasan a una persona | "Lo delicado lo decide una persona" |
| 11–13 | Buffer | Congelar el corte, lista de ruta y CSV | "Esto recibe despacho" |
| 13–15 | Agentes | Feed e interruptor de apagado | "Si se apaga, Waygo sigue como hoy" |

## 4. Pendientes que dependen de terceros
- **Reflo:** acceso al portal del sandbox de Waygo (llave `tms_c_`). Ya no bloquea el demo: el emulador cubre el contrato completo.

## 5. Nota para la presentación
La arquitectura y el deck mencionan Claude. El demo usa OpenAI. La capa de agentes no depende del proveedor del modelo: se cambia en el adaptador del modelo. Si preguntan, esa es la respuesta.
