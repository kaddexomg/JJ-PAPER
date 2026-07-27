---
tags: [modulo, crm]
---

# CRM WhatsApp

Chat completo dentro del panel (admin y vendedor), con el número real del negocio
vía Baileys. Frontend: `assets/js/wa/wa-chat.js`, `wa-common.js`, `wa-link.js`.
Backend: [[wa-server]] (`wa-session.js`, `outbox.js`, `chats.js`, `media.js`,
`wa-presence.js`, `wa-actions.js`).

## Qué hace

- Hilos con historial, búsqueda y no leídos (`jjp_wa_chats` / `jjp_wa_messages`).
- Envío de texto, imágenes, documentos y **notas de voz** (mantener pulsado el
  micrófono; se manda como `ptt` si el mime es opus/ogg/webm).
- Citar, reaccionar y reenviar (`jjp_wa_actions`).
- **Ficha 360° del cliente** en el propio chat: datos, pedidos, cotizaciones y
  accesos a vender/cotizar (`?cliente=`).
- Botón 📤 dentro del chat ([[Envio de documentos]]).
- Borrar un chat o vaciar todos sin desvincular (`jjp_wa_delete_chat`,
  `jjp_wa_purge_chats`).
- Vincular/desvincular por QR desde el panel (`wa-link.js` escribe
  `requested_action` en `jjp_wa_sessions`; el server obedece).

## Presencia

- **Saliente** (nosotros escribiendo/leyendo): la manda el server.
- **Entrante** (el cliente escribiendo/en línea): viaja por **Realtime Broadcast**
  en el canal `wa-presence-<profile>`, NO se guarda en DB (sería basura infinita).
  Tipos: `watch`, `online`, `offline`. Solo se marca "en línea" con el panel a la vista.

## Trampas ya resueltas (no repetir)

- **El composer desaparecía**: `.wa-wrap` es grid y no tenía `grid-template-rows`;
  la fila del hilo crecía con el historial y empujaba la barra fuera del
  `overflow:hidden`. Solución: `waSyncComposer` como ÚNICA fuente de verdad +
  watchdog de 3 s + clase `.wa-hide`. Ver [[Incidentes]].
- Un chat mal enlazado a cliente se corrige actualizando `customer_id` en
  `jjp_wa_chats` (el send-hub lo enlaza al enviar si venía nulo).

## Diagnóstico rápido

| Síntoma | Dónde mirar |
|---|---|
| Mensajes atascados en `pending` | ¿server 🟢? ¿sesión `connected`? `outbox.js` |
| `Bad MAC` continuo | dos procesos del server → matar uno ([[Incidentes]]) |
| Chat sin historial viejo | Baileys solo trae desde la vinculación; es normal |
| No llega media | bucket `jjp-wa-media`, tamaño y mime en la fila |

Relacionado: [[wa-server]] · [[Envio de documentos]] · [[Difusion]] · [[Correo]]
