---
tags: [sistema, servidor]
---

# wa-server — el servidor de la tienda

Node.js corriendo en la PC de la tienda (Windows). Habla con Supabase con
**service_role** (la clave vive SOLO en `wa-server/.env`). Es producción:
ver regla 5 de [[Reglas de trabajo]].

## Arranque y control

- `START-SERVIDOR.bat` — supervisor: relanza si el proceso muere.
- `INSTALAR-INICIO-AUTOMATICO.bat` / `DESINSTALAR-…` — tarea de Windows al arrancar la PC.
- Panel admin (`ajustes.html` → server-control): 🟢/🔴 por heartbeat (< 70 s),
  botones restart/stop (escriben en `jjp_server_control`, el server obedece).
- Logs a archivo (pino) en `wa-server/logs/`.
- **Arranque sano** se ve así: sesión WhatsApp `connected`, `realtime outbox`,
  `módulo correo activo`, `vigilante de sesiones activo`, latidos cada 20 s.
- Tras editar código del server: REINICIAR el proceso (el código viejo sigue en RAM).

## Módulos (`wa-server/src/`)

| Módulo | Qué hace | Detalles finos |
|---|---|---|
| `index.js` | bootstrap de todo + HTTP local | — |
| `config.js` | `.env` y constantes | sweeps: outbox 30s, email 20s, sesiones 15s, campañas 15s, facturas 60s; `MAX_RETRIES=3` |
| `session-manager.js` | sesiones Baileys por perfil | **vigilante cada 60s**: reconecta sesiones caídas sin `close`; guardia "arranque en curso" 3 min (evita doble socket → Bad MAC, ver [[Incidentes]]) |
| `wa-session.js` | una sesión: QR, auth en `sessions/`, reconexión | `requested_action` de `jjp_wa_sessions` para vincular/desvincular desde el panel |
| `outbox.js` | cola de salida WA | Realtime INSERT pending + sweep; lock optimista (`update … eq status pending`); tipos text/image/video/audio(ptt si opus)/document; cita con `reply_to_wa_id` |
| `chats.js` | entrantes → `jjp_wa_chats`/`messages` | enlaza `customer_id` por teléfono |
| `media.js` | media entrante/saliente ↔ bucket `jjp-wa-media` | ext por mime |
| `wa-presence.js` | presencia saliente (leído/escribiendo) | la ENTRANTE va por Realtime Broadcast, no DB |
| `wa-actions.js` | citar/reaccionar/reenviar | cola `jjp_wa_actions` |
| `campaigns.js` | difusión WA | throttle anti-baneo configurable, notifica al terminar |
| `email.js` | correo por usuario | Gmail API (OAuth `gmail.send`) o SMTP app-pass o `.env` de respaldo; recepción poll 2 min; adjuntos on-demand (`attach_state=requested`); verifica cuentas al arrancar |
| `email-campaigns.js` | campañas de correo | gracias post-pedido + reactivación |
| `invoices.js` | cuentas por pagar | despacha avisos que genera el cron de la DB al WhatsApp del dueño (+584120100372) |
| `rates.js` | tasas BCV/Binance/euro | escribe `jjp_settings` + historial `jjp_fx_rates` |
| `retention.js` | purga correo/WA viejo | lo purgado se puede re-traer de Gmail |
| `heartbeat.js` | latido 20 s + comandos | ahora incluye salud real de cada WhatsApp en `modules` |
| `count-lan.js` | conteo por WiFi local | HTTP:8787 (PC) y HTTPS:8788 (teléfono, cert autofirmado para la cámara); buffer en disco; espejo SSE; sube en lote con `jjp_count_apply_batch`; QR en `/lan/start`; NO expone `.env` |
| `logger.js` | pino a archivo + consola | `baileysLogger` filtra ruido |

Scripts sueltos (raíz de `wa-server/`): `upload-images.js` (seguro: no crea
productos), `upload-brand-logos.js`, `export-catalogo.js`.

## Ruido normal vs problema real

- `Bad MAC` / `sendPresenceUpdate falló` **ocasionales** = ruido de Baileys. Ignorar.
- `Bad MAC` **masivo/continuo** = DOS procesos del server corriendo. Matar uno.
- `sin permiso de lectura (re-vincular con Google)` = el usuario debe re-vincular
  su Gmail desde "Mi correo" (refresh token revocado).

Relacionado: [[Arquitectura]] · [[CRM WhatsApp]] · [[Correo]] · [[Configuracion]]
