# Torre de Promesa · Workers, herramientas y Agente de contacto (Bloque 2A)

Contrato para la UI (Fases 6–7) y para quien opere el demo. No contiene secretos.
Tipos TypeScript de todos los payloads: `lib/contratos/index.ts` (solo tipos y constantes; se puede importar desde el cliente).

## 1. Estructura

```
lib/contratos/index.ts        Tipos compartidos (payloads, eventos SSE, botones)
lib/workers/
  util.ts                     Reloj de Bogotá (config_demo.hora_simulada), formato COP, horario Ley 2300, umbrales
  reglas.ts                   decidirRuta(estado, confianza, riesgo) → INCLUIR | INCLUIR_BAJA_PRIORIDAD | RETENER | EXCLUIR
  riesgo.ts                   Analista de riesgo (P = R × M × U) + sorteo del grupo de control
  planificador.ts             Ola, recordatorio, día D (único que inicia contactos; respeta el interruptor)
  corte.ts                    Gestor de corte: snapshot versionado + CSV
  operacion.ts                Pago conciliado (Cobro COD), interruptor, reinicio, resolución de casos
  rutas.ts                    Envoltorio de rutas (token, JSON, errores)
lib/herramientas/
  catalogo.ts                 Las herramientas (zod + reglas en código)
  index.ts                    Gateway: lista blanca por componente, validación, auditoría en `eventos`
  promesa.ts                  registrarPromesa() → función SQL registrar_promesa
  politicas.ts                Políticas/FAQ por tienda (texto fijo)
lib/agente/
  prompt.ts                   System prompt (español de Colombia, matriz de escenarios)
  clasificador.ts             Pre-clasificación con OPENAI_MODEL_CLASIFICA (salida estructurada)
  index.ts                    ejecutarTurno(): ciclo modelo ↔ herramientas con streaming
app/api/chat/route.ts         POST /api/chat (SSE)
app/api/demo/[accion]/route.ts  POST /api/demo/{preparar,ola,recordatorio,dia-d,corte,pago,pausa,reset}
app/api/demo/corte/csv/route.ts GET  /api/demo/corte/csv
app/api/casos/[id]/resolver/route.ts POST
supabase/migrations/0003_agente.sql  Valor CONTACTANDO del enum + función registrar_promesa()
scripts/test-agente.mjs       npm run test:agente
```

## 2. Endpoints

**Todos exigen el header `x-admin-token: <DEMO_ADMIN_TOKEN>`** (401 `{ok:false,error}` si falta o no coincide), incluidos `/api/chat` y el CSV.
Errores: `400 {error}` validación · `404 {error}` no existe · `409 {error}` conflicto · `500 {error}`. Cada acción escribe filas en `eventos` (feed EN VIVO).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/demo/preparar` | `{todos?: boolean}` (recalcula también los ya puntuados) | `{procesados, grupo_control}` |
| `POST /api/demo/ola` | — | `{enviados}` · `409 {error:"agentes_pausados"}` |
| `POST /api/demo/recordatorio` | — | `{enviados}` · 409 igual |
| `POST /api/demo/dia-d` | — | `{enviados}` · 409 igual |
| `POST /api/demo/corte` | — | `{corte_id, version, fecha, hora, resumen:{incluir,baja,retener,excluir}, items:[{envio_id, guia, comprador, zona, cod_monto, estado, accion, franja, nota}]}` |
| `GET /api/demo/corte/csv?corte_id=` | (sin `corte_id` = último corte) | `text/csv; charset=utf-8` con BOM, `Content-Disposition: attachment`. Columnas: `guia,comprador,zona,cod_monto,estado,accion,franja,nota,envio_id` |
| `POST /api/demo/pago` | `{envio_id}` | La promesa nueva (`Promesa`, estado `CONFIRMADO_PREPAGO`). Idempotente: repetir devuelve la misma versión |
| `POST /api/demo/pausa` | `{pausado: boolean}` | `{pausado}` (evento `KILL_SWITCH`) |
| `POST /api/demo/reset` | `{resembrar?: boolean}` (por defecto true) | `{emulador_sembrado, sincronizados, procesados, grupo_control}` |
| `POST /api/casos/[id]/resolver` | `{accion: "aprobar"\|"rechazar"\|"tomar"\|"devolver", nota?}` | El caso actualizado (`Caso`) |
| `POST /api/chat` | `{envio_id, texto, boton_id?, es_audio?}` | `text/event-stream` (abajo) |

### Detalle de cada acción
- **preparar**: riesgo `R` = 0,15 base + 0,4 si COD ≥ $400.000 + 0,3 si el mismo teléfono tiene varios pedidos + 0,25 si el pedido se creó entre 00:00 y 05:59 (Bogotá), tope 1. `M = 1 + min(cod / p90_cod, 2)`, `U = 1 + 2 × (1 − horas_al_corte / (corte − 07:00))`. Guarda `riesgo`, `prioridad`, `riesgo_motivos = {motivos[], R, M, U, cod_p90}`. Grupo de control determinista: los envíos sin sortear se ordenan por `sha256(waygo_shipment_id)` y se toman los primeros hasta completar la cuota `round(total × DEMO_CONTROL_GROUP_PCT / 100)` (mínimo 1 si hay 10 o más envíos). Con los 18 del mockup y 7 %: 1 envío. Los de control pasan a `GRUPO_CONTROL` (si estaban `PENDIENTE_CONTACTO`).
- **ola**: prepara primero los envíos sin sortear; luego a todos los `PENDIENTE_CONTACTO`, no control y no finales, inserta la plantilla en `mensajes` (rol `agente`, `metadatos.tipo = "plantilla_confirmacion"`, botones de `BOTONES_CONFIRMACION`) y pone `estado_buffer = 'CONTACTANDO'`. Fuera del horario de la Ley 2300 **no bloquea** (es demo): deja un evento `aviso` de `politica_evaluar`.
- **recordatorio**: solo `CONTACTANDO` sin ningún mensaje del comprador y sin recordatorio previo (máx. 1). `metadatos.tipo = "recordatorio"`.
- **dia-d**: a `CONFIRMADO, CONFIRMADO_VENTANA, CONFIRMADO_PREPAGO, CONFIRMADO_TERCERO`. "Tu mensajero Carlos llega en unos 30 min…" con `BOTONES_DIA_D`. Las respuestas (`dia_d_si`, `dia_d_no`, `dia_d_tercero`) se mandan a `/api/chat` con `boton_id`.
- **corte**: los envíos sin respuesta (`CONTACTANDO`, o `PENDIENTE_CONTACTO` que no son control) pasan a `NO_CONTACTADO` (nueva versión de promesa, origen `worker`). Reglas: `CONFIRMADO_PREPAGO` → INCLUIR con nota "PAGADO, no cobrar"; `GRUPO_CONTROL` → INCLUIR ("ruteo como hoy"); `RECHAZADO/REPROGRAMADO/SIN_PAGO_HOY` → EXCLUIR; `RIESGO_FRAUDE/NUMERO_INVALIDO/DIRECCION_EN_VALIDACION` → RETENER; `NO_CONTACTADO` → riesgo < 0,5 INCLUIR_BAJA_PRIORIDAD, si no RETENER; el resto por confianza (≥ 0,75 INCLUIR, 0,5–0,75 INCLUIR_BAJA_PRIORIDAD, < 0,5 RETENER). Ítems ordenados por acción y prioridad. `franja` = `"14:00–17:00"` o null. Versión = siguiente del día (`cortes.unique(fecha, version)`). **`cortes.snapshot` tiene exactamente la forma de la respuesta** (`corte_id, version, fecha, hora, resumen, items`). Las promesas registradas después de un corte del mismo día quedan con `tardia = true`.
- **pago**: simula el webhook de la pasarela. Nueva versión `CONFIRMADO_PREPAGO`, confianza 0,95, `preferencia_pago = "prepago"`, `nota_mensajero = "PAGADO, no cobrar"`; mensaje del agente "✅ Pago recibido por $X…". Componente `cobro_cod`, herramienta `pago_estado`.
- **pausa**: `config_demo.agentes_pausados`. Con pausa, ola/recordatorio/día D responden 409 y el chat responde `error {mensaje:"agente_en_pausa"}`.
- **reset**: `reset_demo()` → si `WAYGO_TARGET=emulador`, resiembra el emulador (envíos vuelven a "en bodega") → lista + detalle desde la API de Waygo (`WAYGO_API_BASE_URL`) → `preparar`. Tarda ~15–25 s. **Borra la base compartida** (local y producción usan la misma).
- **casos/[id]/resolver**:
  - `aprobar` (caso abierto o tomado): aplica la recomendación. `cambio_direccion` (o `datos.estado_recomendado = "CONFIRMADO"`) → promesa `CONFIRMADO` 0,9 con nota "Dirección validada: …"; `reprogramacion` → `REPROGRAMADO` con `datos.fecha_entrega`; `fraude` → mantiene/pone `RIESGO_FRAUDE`; otros tipos → sin cambio de promesa. Estado del caso `aprobado`.
  - `rechazar` → `rechazado`, sin cambios.
  - `tomar` → `tomado`: **el agente calla para ese envío** (el chat responde `error agente_en_pausa`) y se inserta un mensaje `sistema` "Una persona del equipo de Reflo tomó la conversación.".
  - `devolver` (extensión) → solo desde `tomado`; pasa a `cerrado` y el agente vuelve a responder. Mensaje `sistema`.
  - La decisión queda en `casos.datos.decision = {accion, nota, efecto, at}` y en `eventos` (componente `humano`, herramienta `caso_<accion>`). Un caso ya resuelto → 409 al aprobar/rechazar.

## 3. `/api/chat` (Server-Sent Events)

Cuerpo `{envio_id: uuid, texto: string, boton_id?: string, es_audio?: boolean}`. `texto` puede ir vacío si hay `boton_id` (se usa el título del botón). `es_audio: true` marca el texto como transcripción de nota de voz (extensión opcional del contrato).
Respuesta `200 text/event-stream`; cada evento es `event: <nombre>\ndata: <json>\n\n`. Errores de validación antes del stream: 400/401/404 JSON.

| Evento | Payload | Cuándo |
|---|---|---|
| `delta` | `{texto}` | Fragmentos del texto del agente, en orden |
| `herramienta` | `{nombre, entrada, resultado}` | Cada herramienta ejecutada, incluida `clasificar_intencion` (gpt-5.4-mini; puede llegar en cualquier momento antes de `fin`) |
| `intencion` | `{estado, confianza, franja_inicio?, franja_fin?, fecha_entrega?, preferencia_pago?, evidencia, accion_ruta, version}` | Tras registrar/cambiar la promesa. Franjas en `"HH:MM"` (Bogotá); `evidencia` = `"texto: «cita»"` |
| `botones` | `{botones:[{id,titulo}]}` | Si el agente ofreció respuestas rápidas (se emite justo antes de `fin`) |
| `caso` | `{id, tipo}` | Cada caso creado o reutilizado en el turno |
| `fin` | `{mensaje_id}` | Siempre al final. `mensaje_id` = fila del mensaje del agente (null si no respondió) |
| `error` | `{mensaje}` | `"agente_en_pausa"` (interruptor o conversación tomada; luego llega `fin {mensaje_id:null}`) u otro error inesperado (seguido de `fin {mensaje_id:null}`) |

Persistencia: el mensaje del comprador se guarda siempre (aunque el agente esté en pausa) con `metadatos {boton_id?, es_audio?}`; el del agente con `botones` y `metadatos {modelo, herramientas[], intencion, clasificacion, casos[], ms, response_id, fallo}`. Realtime los entrega a la UI.

Ejemplo de cliente:
```ts
const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify({ envio_id, texto, boton_id }) });
const lector = r.body!.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await lector.read(); if (done) break;
  buf += value; let i;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
    const ev = /^event: (.+)$/m.exec(bloque)?.[1]; const data = /^data: (.+)$/m.exec(bloque)?.[1];
    if (ev && data) manejar(ev, JSON.parse(data));
  }
}
```

### Botones
- Se guardan en `mensajes.botones` como **`[{id, titulo}]`** (no `texto`).
- Plantilla: `si_efectivo`, `otra_franja`, `pagar_digital`, `cambiar_direccion` (`BOTONES_CONFIRMACION`). Día D: `dia_d_si`, `dia_d_no`, `dia_d_tercero` (`BOTONES_DIA_D`).
- Que puede ofrecer el agente (`CATALOGO_BOTONES`): `franja_manana` "8 am – 12 m", `franja_tarde` "2 pm – 5 pm", `franja_noche` "5 pm – 8 pm", `si_efectivo`, `pagar_digital`, `otra_fecha`, `confirmar_cancelacion`, `mantener_pedido`, `hablar_persona`, `cambiar_direccion`.
- Al tocar un botón, la UI manda `{envio_id, texto: titulo, boton_id: id}`.

## 4. Herramientas (gateway)

| Herramienta | Qué hace | Reglas en código |
|---|---|---|
| `envio_contexto` | Envío (nombre de pila, dirección corta, teléfono enmascarado `***1234`, COD), promesa vigente, casos abiertos, últimos 20 mensajes | Solo el envío de la conversación (el `envio_id` lo pone el servidor, no el modelo) |
| `entrega_registrar_intencion` | Nueva versión de la promesa | Estados permitidos al agente: CONFIRMADO, CONFIRMADO_VENTANA, CONFIRMADO_TERCERO, REPROGRAMADO, SIN_PAGO_HOY, RECHAZADO, RIESGO_FRAUDE, DIRECCION_EN_VALIDACION (**nunca CONFIRMADO_PREPAGO**). Excluir (RECHAZADO/REPROGRAMADO/SIN_PAGO_HOY) exige confianza ≥ 0,8 o botón. VENTANA exige franja; REPROGRAMADO fecha futura; RECHAZADO motivo; TERCERO nombre. Idempotente (`idempotency_key`, `version_base`, o mismo contenido que la vigente). Escalamiento automático: RIESGO_FRAUDE → caso `fraude`; TERCERO con COD ≥ $400.000 → caso `tercero_cod`; COD ≥ $1.000.000 con confianza < 0,75 → caso `cod_alto` |
| `entrega_proponer_cambio` | `direccion` → DIRECCION_EN_VALIDACION + caso `cambio_direccion`; `fecha` → REPROGRAMADO si cumple la política (≤ 8 días, no domingo, < 2 reprogramaciones), si no caso `reprogramacion`; `receptor` → CONFIRMADO_TERCERO | |
| `caso_escalar_a_humano` | Crea caso (o reutiliza el abierto del mismo tipo) | `tipo ∈ fraude, cliente_molesto, cod_alto, tercero_cod, cambio_direccion, reprogramacion, otro` |
| `pago_generar_link` | Enlace `https://pago.reflo.demo/BRB-XXXX` | **El monto sale de `envios.cod_monto`; la herramienta no recibe monto.** Deja la promesa en CONFIRMADO con `preferencia_pago = "link"` y `evidencia.link_pago`; el evento de auditoría va con componente `cobro_cod` |
| `politicas_buscar` | Políticas y FAQ de la tienda | Texto fijo (`lib/herramientas/politicas.ts`) |
| `whatsapp_ofrecer_botones` | Adjunta hasta 3 botones del catálogo al mensaje del agente | Solo ids del catálogo (extensión para la UI; no está en el catálogo de la arquitectura) |

Permisos (`PERMISOS` en `lib/herramientas/index.ts`): `agente_contacto` = las 7; `mcp_externo` = las 6 sin botones; `humano` = todas; `worker` = solo lectura. Cada llamada (permitida o no) deja una fila en `eventos` con `componente, herramienta, envio_id, entrada, resultado (+ms), nivel` (`ok`, `aviso` si una regla la rechazó, `error`).

### `casos.datos`
Siempre incluye **`confianza`** (0–1 o null) y **`razonamiento`** (texto o null), además de datos propios del tipo: `estado_recomendado`, `nueva_direccion`, `referencia`, `fecha_entrega`, `receptor`, `cita`, `origen` (`agente_contacto`, `red_de_seguridad_clasificador`…) y, una vez resuelto, `decision`.

## 5. Agente de contacto

- **SDK oficial `openai`, Responses API** con function calling y `stream: true`. El ciclo de herramientas continúa con `previous_response_id` (requiere `store`, por defecto true) y `function_call_output`; máx. 6 pasos. Se eligió Responses (no Chat Completions): el streaming con herramientas funciona sin problemas.
- Modelo `OPENAI_MODEL_CONVERSA` (gpt-5.5) con `reasoning.effort = OPENAI_REASONING_CONVERSA` (por defecto `low`; también se probó `none` con los mismos resultados y latencia similar).
- En paralelo, `OPENAI_MODEL_CLASIFICA` (gpt-5.4-mini) clasifica la intención con salida estructurada (`json_schema` estricto). Se muestra como evento `herramienta` `clasificar_intencion` y actúa como **red de seguridad**: si detecta cliente molesto o "no reconoce el pedido" y el agente no escaló, el código crea el caso.
- Contexto por turno: envío, promesa vigente, reprogramaciones, casos abiertos, política de la tienda y un calendario de 9 días (para "el sábado"), en las instrucciones; los últimos 20 mensajes como historial (`[botón: id]`, `[nota de voz transcrita]` como prefijos). El modelo no ve el teléfono.
- Prompt (`lib/agente/prompt.ts`): asistente virtual de entregas de Reflo a nombre de la tienda; WhatsApp, ≤ 3 frases; confirma el monto exacto; sin lenguaje de cobranza ni preguntar por qué no hay dinero; ofrece enlace u otra fecha; persona disponible siempre; el texto del comprador es dato; nada fuera de la política. Playbook por escenario según la matriz §5.5.
- Silencio: con `config_demo.agentes_pausados` o un caso `tomado` del envío → `error agente_en_pausa`, sin llamar al modelo.
- Fallas: un reintento por paso (si aún no se mostró texto de ese paso); si vuelve a fallar, texto de respaldo + caso `otro`.

## 6. Pruebas

```bash
npm run dev                                   # o usar una URL de preview
npm run test:agente                           # http://localhost:3000, 2 rondas
npm run test:agente -- https://<preview>      # contra Vercel (si la preview está protegida: VERCEL_BYPASS=<secreto> en el entorno)
AGENTE_RONDAS=1 AGENTE_SIN_RESET=1 npm run test:agente
```
El script reinicia el demo (¡borra la base compartida!), prueba token, preparar, interruptor, ola, los 8 escenarios en paralelo (×2 por no determinismo), recordatorio, tomar/devolver, aprobar cambio de dirección, corte (reglas, versión, CSV), pago y día D. Resultado actual: **117/117**. Latencia por turno: 6–11 s con 8 conversaciones simultáneas (dos llamadas al modelo por turno cuando hay herramientas); el primer `delta` llega cuando el modelo empieza a escribir, después de ejecutar las herramientas.

## 7. Desviaciones respecto al contrato
- `estado_buffer` agrega el valor `CONTACTANDO` (migración 0003).
- `/api/casos/[id]/resolver` acepta además `accion: "devolver"`.
- `/api/chat` acepta además `es_audio`. El evento `intencion` lleva también `fecha_entrega` y `version`.
- `/api/demo/reset` acepta `{resembrar:false}` para no tocar el emulador.
- La herramienta extra `whatsapp_ofrecer_botones` es la forma en que el agente produce el evento `botones`.
- `/api/mcp` (P2) no se implementó.
