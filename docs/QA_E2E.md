# QA de punta a punta · Torre de Promesa (demo Reflo, jueves 5-nov-2026 11:00)

## Cómo correr el demo

**URL:** https://reflo-demo.vercel.app (producción, pública). Las previews de Vercel están protegidas: no usarlas para el demo.

**Token de administración:** la primera acción de cada pestaña (ejecutar un paso, escribir en el chat, aprobar un caso) abre el diálogo **"Token de administración del demo"**. Pega el valor de `DEMO_ADMIN_TOKEN` (está en `.env.local` y en las variables de Vercel; no se escribe aquí) y pulsa **Guardar y continuar**. Se guarda solo en esa pestaña (sessionStorage): si abres otra pestaña, te lo vuelve a pedir. En `/emulador` se pide en su propio formulario de ingreso.

**Antes de empezar (09:30 del jueves):**
1. Abre la URL y entra a **Control del demo**. Ejecuta **1. Reiniciar demo** → "Sí, reiniciar" (tarda 10–25 s). Debe quedar: 18 envíos en el **Buffer**, 17 "Por contactar" + 1 "Grupo control", sin mensajes ni casos.
2. Revisa que la barra lateral diga "3 agentes IA + 8 workers" (no "Agentes en pausa"). Si dice pausa: **Actividad de agentes → Reanudar**.
3. Deja abiertas dos pestañas: **Control del demo** y **Simulador WhatsApp** (ingresa el token en ambas).
4. No corras `npm run test:agente` ni el reset desde otra máquina durante el demo: local y producción comparten la misma base.

**Orden de los botones (guion de 15 min, `PLAN_DEMO.md` §3):**

| Min | Dónde | Qué haces |
|---|---|---|
| 0–2 | Control | **2. Crear envíos de prueba en Waygo** (6 nuevos llegan por webhook) → muestra el **Buffer** (24 envíos). Opcional: **3. Sincronizar** y **4. Preparar buffer**. |
| 2–4 | Control → Simulador | **5. Lanzar ola 9:00**. En el Simulador aparecen las conversaciones "Contactando" con la plantilla y sus 4 botones. |
| 4–9 | Simulador | Elige una conversación distinta para cada escenario y pulsa el botón de la barra **Escenarios**: ✅ *Confirma con efectivo* · 🕑 *Solo en la tarde* · 💳 *Pagar por Nequi* (luego **Simular pago recibido** en el panel derecho → "Confirmado · prepago") · 🎤 *Audio* (se envía como nota de voz). También puedes tocar los botones del mensaje (p. ej. *Otra franja* → *2 pm – 5 pm*): responden en menos de 1 s. |
| 9–11 | Simulador → Excepciones | 🚩 *Yo no pedí nada* y 😠 *Cliente molesto* en otras dos conversaciones; en **Excepciones** aparecen los casos. **Aprobar** el de fraude; en el de cliente molesto **Tomar conversación** (el agente calla) y luego **Devolver al agente**. |
| 11–13 | Control | **7. Congelar corte 20:00** → tabla Incluir / Baja prioridad / Retener / Excluir → **Descargar CSV**. Opcional: **8. Día D**. |
| 13–15 | Actividad de agentes | Feed EN VIVO; **Pausar todos** → confirmar (fail-open) → **Reanudar**. |

Escenarios restantes de la barra (si hay tiempo): 📅 *Mejor el sábado* (→ Reprogramado) y ❌ *Ya no lo quiero* (pregunta y ofrece "Sí, cancelar el pedido").

**Qué esperar del agente:** el texto empieza a llegar en ~1–1,5 s; las herramientas (registro de la intención, casos, botones) se ejecutan justo después y el panel **"Lo que entendió el agente"** se actualiza 2–5 s después del texto. Es normal.

**Si algo falla:**
- *El chat no responde / "Agentes en pausa"*: barra lateral → si está en pausa, **Reanudar**. Si la conversación fue tomada en Excepciones, pulsa **Devolver al agente** (también está en el panel derecho del Simulador).
- *"Token de administración inválido (401)"*: vuelve a pegar el token en el diálogo.
- *El agente respondió raro o se trabó un escenario*: usa otra conversación "Contactando" (hay 17+). Si ya no quedan, **Control → 1. Reiniciar demo** y **5. Lanzar ola** (≈30 s en total).
- *Respuesta de respaldo "se me complicó responderte"* (falla de OpenAI): se crea un caso "Excepción" automáticamente; sigue con otra conversación. Revisa saldo/estado de OpenAI.
- *La página no actualiza en vivo*: recarga (F5). Los datos se refrescan solos cada 30 s aunque Realtime falle.
- *Todo caído*: video de respaldo (pendiente de grabar, `PLAN_DEMO.md` Fase 8).

---

## Resultado de la QA (29-oct-2026, producción)

Ejecutado contra https://reflo-demo.vercel.app con la versión de `main` que incluye `feat/consola` + `feat/agente` + integración y latencia. Dos pasadas:
- **API + SSE** (script de QA): 36/36 pasos OK.
- **UI real** con Chromium headless (Playwright 1.60, 1440×900): 14/14 OK, sin errores de JavaScript. Capturas en `docs/qa/`.
- **Regresión del agente** `npm run test:agente` (servidor local de producción, misma base): 119/119 OK.
- `npm ci && npm run build` OK · `npm run test:contract` 141/141 OK · `node scripts/check-secrets.mjs` OK.

### Checklist del guion (API + SSE)

| # | Paso | Resultado | Detalle |
|---|---|---|---|
| 1 | Reiniciar demo | PASS | 18 sincronizados, 18 preparados, 1 al grupo control (~8 s) |
| 1b | Estado inicial | PASS | 18 envíos · 17 por contactar + 1 control |
| 2 | Crear 6 envíos en Waygo (emulador) | PASS | 6 creados |
| 2b | Llegan al buffer por webhook | PASS | 24 envíos |
| 3 | Sincronizar con Waygo | PASS | 24 listados, sin cambios (ya llegaron por webhook) |
| 4 | Preparar buffer | PASS | 6 procesados, 1 al grupo control |
| 5 | Lanzar ola 9:00 | PASS | 22 plantillas · 22 en CONTACTANDO |
| 6.1 | ✅ Efectivo (botón) | PASS | CONFIRMADO · primer texto 0,5 s |
| 6.2 | 🕑 Solo en la tarde | PASS | CONFIRMADO_VENTANA · 1,5 s / 5,1 s |
| 6.3 | 💳 Nequi | PASS | CONFIRMADO + preferencia link, enlace con el monto de la base · 1,1 s / 4,2 s |
| 6.4 | 📅 Sábado | PASS | REPROGRAMADO · 1,2 s / 5,0 s |
| 6.5 | ❌ Ya no lo quiero → botón "Sí, cancelar" | PASS | Pregunta + botones; con el botón → RECHAZADO (0,5 s) |
| 6.6 | 🚩 Yo no pedí nada | PASS | RIESGO_FRAUDE + caso fraude · 1,2 s / 6,8 s |
| 6.7 | 🎤 Audio | PASS | CONFIRMADO_VENTANA; mensaje guardado con `es_audio: true` |
| 6.8 | 😠 Cliente molesto | PASS | caso cliente_molesto · 1,3 s / 6,2 s |
| 7 | Simular pago | PASS | CONFIRMADO_PREPAGO v2, "PAGADO, no cobrar" |
| 8a | Cambio de dirección (botón + texto) | PASS | DIRECCION_EN_VALIDACION + caso cambio_direccion |
| 8b | Excepciones → Aprobar | PASS | caso aprobado, promesa CONFIRMADO |
| 9a–d | Tomar / devolver | PASS | Tomada: `error agente_en_pausa` + `fin {mensaje_id:null}`; devuelta: el agente vuelve a responder |
| 10 | Recordatorio 12:30 | PASS | 13 recordatorios |
| 11 | Congelar corte | PASS | v1 · incluir 7 · baja 13 · retener 2 · excluir 2 |
| 11b | Reglas del corte | PASS | prepago → INCLUIR "PAGADO, no cobrar"; fraude → RETENER; rechazado → EXCLUIR |
| 11c | CSV | PASS | 24 filas, `attachment; filename="lista_ruta_2026-10-29_v1.csv"` |
| 11d | CSV sin token | PASS | 401 |
| 12 | Día D | PASS | 5 avisos; "Sí, estoy" → CONFIRMADO 0,95 (0,5 s) |
| 13a | Pausa | PASS | ola 409 y chat `agente_en_pausa` |
| 13b | Reanudar | PASS | el agente responde de nuevo |
| 14a | Emulador: → en ruta | PASS | webhook actualiza `envios`: "En bodega" → "En ruta" |
| 14b | Emulador: → entregado | PASS | "Entregado", `waygo_is_final = true` |

### Checklist por la UI (Chromium headless)

| Paso | Resultado | Captura |
|---|---|---|
| Control · 1. Reiniciar (con confirmación) y 5. Lanzar ola | PASS (17 mensajes) | `qa/00-control-ola.png` |
| Buffer con chips "Contactando" | PASS | `qa/01-buffer.png` |
| Simulador · "Solo en la tarde" en streaming (texto visible a ~1,5 s) | PASS | `qa/02-whatsapp-streaming.png`, `qa/03-whatsapp-turno-completo.png` |
| Franja formateada "2 pm – 8 pm", fecha de entrega y versión en el panel | PASS | `qa/03-whatsapp-turno-completo.png` |
| Botones de la plantilla: Otra franja → 2 pm – 5 pm → Confirmado · franja | PASS | `qa/04-whatsapp-botones.png` |
| Audio: burbuja de nota de voz + `es_audio` en la base | PASS | `qa/05-whatsapp-audio.png` |
| Fraude y cliente molesto por la UI → Excepciones (2 casos) | PASS | `qa/05b-whatsapp-molesto.png`, `qa/06-excepciones.png` |
| Excepciones · Tomar conversación → Devolver al agente | PASS | `qa/06b-excepciones-tomada.png` |
| Actividad de agentes · feed desde `eventos` | PASS | `qa/07-agentes.png` |
| Control · 7. Congelar corte + tabla de ruta | PASS | `qa/08-control-corte.png`, `qa/09-control-lista-ruta.png` |
| Descargar CSV desde la UI | PASS | `lista_ruta_2026-10-29_v1.csv` |
| Sin errores de JavaScript | PASS | — |

### Latencia del agente (P1)

| Medición | Antes | Después |
|---|---|---|
| Local, secuencial · primer texto promedio / máximo | 7,0 s / 10,1 s | 1,9 s / 2,4 s |
| Producción · primer texto, botones | — | ~0,5 s |
| Producción · primer texto, texto libre | — | 1,1–1,5 s |
| Producción · turno completo | ~8 s | 3–7 s (las herramientas corren después del texto) |

Detalle del diseño en `docs/AGENTE.md` §6 "Latencia".

### Riesgos abiertos para el jueves
1. **Base compartida local/producción**: cualquier `reset`, `test:agente` o script de QA desde otra máquina borra el demo en vivo. No correr nada el jueves después del reset de las 09:30.
2. **Dependencia de OpenAI** (gpt-5.5 + gpt-5.4-mini): sin saldo o con caída, el agente responde con el texto de respaldo y crea un caso. Revisar saldo el miércoles. Los botones de la plantilla funcionan sin el modelo.
3. **Texto antes que herramientas**: en texto libre el agente puede afirmar algo que luego una regla rechace (p. ej. reprogramación fuera de política); en ese caso agrega una corrección. No se vio en las pruebas con los 8 escenarios.
4. **Supabase gratuito** puede pausarse por inactividad: abrir la app el jueves temprano.
5. **Repo público** y tokens compartidos por chat (Fase 0 y Fase 10 del plan, pendientes).
6. Video de respaldo y ensayo completo con el guion: pendientes.
