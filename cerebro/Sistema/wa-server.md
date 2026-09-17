---
tags: [sistema, servidor]
---

# wa-server — el servidor de la tienda

Node.js corriendo en la PC de la tienda (Windows). Habla con Supabase con
**service_role** (la clave vive SOLO en `wa-server/.env`). Es producción:
ver regla 5 de [[Reglas de trabajo]].

## Arranque y control

- `START-SERVIDOR.bat` — supervisor: relanza si el proceso muere; desactiva QuickEdit en consola (`HKCU\Console`) para prevenir bloqueos por clic.
- `INSTALAR-INICIO-AUTOMATICO.bat` / `DESINSTALAR-…` — tarea de Windows al arrancar la PC.
- Panel admin (`ajustes.html` → server-control): 🟢/🔴 por heartbeat (< 70 s),
  botones restart/stop (escriben en `jjp_server_control`, el server obedece).
- Logs a archivo (pino) en `wa-server/logs/`.
- **Arranque sano** se ve así: sesión WhatsApp `connected`, `realtime outbox`,
  `módulo correo activo`, `vigilante de sesiones activo`, latidos cada 20 s.
- Tras editar código del server: REINICIAR el proceso (el código viejo sigue en RAM).

## Módulos (`wa-server/src/`)

| Módulo               | Qué hace                                        | Detalles finos                                                                                                                                                                       |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.js`           | bootstrap de todo + HTTP local                  | —                                                                                                                                                                                    |
| `config.js`          | `.env` y constantes                             | sweeps: outbox 30s, email 20s, sesiones 15s, campañas 15s, facturas 60s; `MAX_RETRIES=3`                                                                                             |
| `session-manager.js` | sesiones Baileys por perfil                     | **vigilante cada 60s**: reconecta sesiones caídas sin `close`; guardia "arranque en curso" 3 min (evita doble socket → Bad MAC, ver [[Incidentes]])                                  |
| `wa-session.js`      | una sesión: QR, auth en `sessions/`, reconexión | `requested_action` de `jjp_wa_sessions` para vincular/desvincular desde el panel                                                                                                     |
| `outbox.js`          | cola de salida WA                               | Realtime INSERT pending + sweep; lock optimista (`update … eq status pending`); tipos text/image/video/audio(ptt si opus)/document; cita con `reply_to_wa_id`                        |
| `chats.js`           | entrantes → `jjp_wa_chats`/`messages`           | enlaza `customer_id` por teléfono                                                                                                                                                    |
| `media.js`           | media entrante/saliente ↔ bucket `jjp-wa-media` | ext por mime                                                                                                                                                                         |
| `wa-presence.js`     | presencia saliente (leído/escribiendo)          | la ENTRANTE va por Realtime Broadcast, no DB                                                                                                                                         |
| `wa-actions.js`      | citar/reaccionar/reenviar                       | cola `jjp_wa_actions`                                                                                                                                                                |
| `campaigns.js`       | difusión WA                                     | throttle anti-baneo configurable, notifica al terminar                                                                                                                               |
| `email.js`           | correo por usuario                              | Gmail API (OAuth `gmail.send`) o SMTP app-pass o `.env` de respaldo; recepción poll 2 min; adjuntos on-demand (`attach_state=requested`); verificación de cuentas al arrancar; timeouts `AbortSignal` (15-30s) anti-colgado y caché RAM con TTL 2h |
| `email-campaigns.js` | campañas de correo                              | gracias post-pedido + reactivación                                                                                                                                                   |
| `invoices.js`        | cuentas por pagar                               | despacha avisos que genera el cron de la DB al WhatsApp del dueño (+584120100372)                                                                                                    |
| `rates.js`           | tasas BCV/Binance/euro                          | escribe `jjp_settings` + historial `jjp_fx_rates`                                                                                                                                    |
| `retention.js`       | purga correo/WA viejo                           | lo purgado se puede re-traer de Gmail                                                                                                                                                |
| `heartbeat.js`       | latido 20 s + comandos                          | ahora incluye salud real de cada WhatsApp en `modules`                                                                                                                               |
| `count-lan.js`       | conteo por WiFi local                           | HTTP:8787 (PC) y HTTPS:8788 (teléfono, cert autofirmado para la cámara); buffer en disco; espejo SSE; sube en lote con `jjp_count_apply_batch`; QR en `/lan/start`; NO expone `.env` |
| `logger.js`          | pino a archivo + consola                        | `baileysLogger` filtra ruido                                                                                                                                                         |
| `mixer.js`           | puente bidireccional JJ Paper ↔ MixNet          | DBF reader + CSV drop dirs; sincronización catálogo, pedidos, cotizaciones, tasas; separador atomic con lock de escritura                                                             |

Scripts sueltos (raíz de `wa-server/`): `upload-images.js` (seguro: no crea
productos), `upload-brand-logos.js`, `export-catalogo.js`.

## Ruido normal vs problema real

- `Bad MAC` / `sendPresenceUpdate falló` **ocasionales** = ruido de Baileys. Ignorar.
- `Bad MAC` **masivo/continuo** = DOS procesos del server corriendo. Matar uno.
- `sin permiso de lectura (re-vincular con Google)` = el usuario debe re-vincular
  su Gmail desde "Mi correo" (refresh token revocado).

**Conceptos que toca**: [[Cola de mensajes]] (su trabajo principal) ·
[[Stock]] (conteo LAN) · [[Dinero y tasas]] (`rates.js`) · [[Sesion y roles]]
(despacha por `owner_id`)

Relacionado: [[Arquitectura]] · [[CRM WhatsApp]] · [[Correo]] · [[Configuracion]] · [[Por tarea]]

## Puente bidireccional MixNet (`mixer.js`) — 17/09/2026

`mixer.js` conecta real y constantemente JJ Paper con MixNet **sin HTTP**
(la API de MixNet en `192.168.0.185:3000` está caída): usa las tablas DBF vía
`M:\comp01\` (mapeada en `mixnet-config.json` → `dbf_dir`) y las carpetas de
intercambio CSV (drop dirs). Se auto-detecta el entorno al arrancar
(`auto-detect-mixnet.js`).

### Flujo real: MixNet ➔ JJ Paper (importación DBF)

| Archivo DBF     | ¿Qué contiene?          | Importa a          | Formato del número |
| --------------- | ----------------------- | ------------------ | ------------------ |
| `MXENCPED.DBF`  | cabeceras de pedido     | `jjp_orders`       | `MIX-<numped>`     |
| `MXRENPED.DBF`  | renglones de pedido     | (detalle)          | —                  |
| `MXENCCOT.DBF`  | cabeceras de cotización | `jjp_quotes`       | `MIX-COT-<numcot>` |
| `MXRENCOT.DBF`  | renglones de cotización | (detalle)          | —                  |
| `MXCTACLI.DBF`  | clientes MixNet         | resuelve cliente   | mapa codcli→ficha |

- **Sensor de actividad**: cada 30 s, `sweepMixnetDbf()`:
  1. Resuelve cliente vía `MXCTACLI.DBF` (codcli → nomcli/cif/tlf).
  2. Filtro de recencia: solo documentos con `emision >= hoy - X días`
     (`X = MIXER_DBF_RECENT_DAYS`, **default 7** desde 17/09; evita inundar con
     históricos).
  3. Dedup en 3 capas: `importedHistory` (RAM + `imported-mixnet.json`) →
     chequeo `SELECT` en Supabase → clave `dbf:ped:<numped>` / `dbf:cot:<numcot>`
     persistida en el RAIZ `wa-server/exported-orders.json` / `exported-quotes.json`.
  4. Lee el detalle SOLO si hay candidatos nuevos (detMap con
     `renNum < newestFound` para no escanear los 100K renglones en cada barrido).
  5. Inserta orden con `source:'pos'`, `status:'pendiente_pago'`; cotización con
     `source:'vendedor'`, `status:'pendiente'`, `exchange_rate` = tasa de hoy,
     `total_bs` calculado.
  6. Log: `Pedido importado desde DBF de MixNet (MIX-XXXX - $Y)`.

- **Vendedor (codven)**: el DBF tiene `codven` (código de vendedor MixNet). La
  importación lo detalla:
  - `004`/`006` → Yovanni Araujo (`95d5ad44-…`)
  - `008` → Marianela (`3c9b7ddd-…`)
  - `014` → Andreina (`68c29cd3-…`)
  - Otros códigos → se deja `seller_id` del cliente asociado (o null) y se anota
    `Vendedor MixNet #<codven> (<hint>)` en `notes` y en el log.
  - Resuelto por `SELLERS_BY_CODVEN` + `sellerForCodven()` en `mixer.js`.

### Flujo real: JJ Paper ➔ MixNet (exportación)

- `sweepRecentOutgoing()` cada 30 s con ventana de 48 h: pedidos
  (`jjp_orders`) → `pedido_<num>.csv/.txt` y cotizaciones (`jjp_quotes`) →
  `cotizacion_<num>.csv/.txt` en TODAS las drop dirs (primary + drop_dirs del
  `mixnet-config.json`). Se registra en `exported-orders.json`/`exported-quotes.json`.
- **Guard anti round-trip (17/09)**: los números `MIX-*` / `MIX-COT-*` SON
  documentos que ya vienen de MixNet: `sweepRecentOutgoing` hace `continue`
  antes de exportarlos (evita que un pedido importado del DBF se re-exporte de
  vuelta como archivo y Caja de MixNet lo reprocese duplicándolo).
- **Verificado 17/09**: `cotizacion_COT-260917-2097.csv/.txt` escritas hoy en
  los drop dirs (las cotizaciones hechas en JJ Paper SÍ se ven desde MixNet y
  se pueden transformar a pedido desde Caja).

### Sincronización de catálogo y precios

- Cada 5 min: `sweepMixnetProducts()` actualiza `price_a, price_b, price_usd,
  price_c_bs, price_d_bs` en `jjp_products` y variantes leyendo los archivos
  de precios de MixNet. El POS lee prioritariamente `price_b` (mayorista).
- `exportCatalogToMixnet()` escribe `catalogo_jjpaper.csv` (902 líneas con SKU,
  nombre, precio, stock) hacia MixNet. Log al arranque: `Catálogo sincronizado
  y exportado hacia MixNet (902 líneas)`.

### Datos y herramientas

- Tablas DBF leídas desde `M:\comp01\` (ubicación confirmada empíricamente;
  `PED.DBF` NO existe — el importador original nunca disparaba por buscar ese
  nombre, corregido el 16/09).
- Historiales persistidos en `wa-server/`: `exported-orders.json`,
  `exported-quotes.json`, `imported-mixnet.json`.
- Config de rutas: `wa-server/mixnet-config.json` (regenerado por
  auto-detección en cada arranque).
- Moneda: todos los registros DBF son `US$` (el campo `cambio` 24–36 son las
  tasas históricas al momento de la venta); los totales grandes (ej. $41 K) son
  ventas mayoristas reales, no errores.

### Estado operativo verificado (17/09/2026)

- 251 pedidos `MIX-*` en `jjp_orders`; 221 cotizaciones `MIX-COT-*` en
  `jjp_quotes` (dedup estable tras ciclos de 30 s).
- Conversación WhatsApp conectada (`584124676073`, Keyder); tasas BCV 847.44 /
  Binance 948.5 / monitor 944.70 / factor 1.1192.
- En 7 días naturalmente llegarán ~90 pedidos y ~230 cotizaciones (volumen
  medido del DBF), siempre deduplicados.

### Notas de este trabajo (17/09/2026)

- No se tocó info real de MixNet ni se borraron archivos de sus drop dirs (los
  `pedido_MIX-*.csv` que ya quedaron de la re-exportación anterior quedan como
  están; la orden `MIX-listapreciosrea` está `cancelado` y es inofensiva).
- Al tocar `mixer.js` se debe reiniciar el proceso (el código viejo sigue en RAM).
