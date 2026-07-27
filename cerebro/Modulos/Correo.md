---
tags: [modulo, crm]
---

# Correo (CRM por Gmail)

Bandeja bidireccional dentro del panel: `admin/correo.html` y `vendedor/correo.html`
(mismo script `assets/js/admin/correo.js`). Motor: `wa-server/src/email.js`.

## Cómo se autentica (por usuario, no una cuenta global)

Orden de resolución en `accountFor(ownerId)`:

1. **OAuth de Google** del propio usuario (`jjp_email_accounts.oauth_refresh`) —
   método principal, sin contraseñas. Scope mínimo **`gmail.send`**, por eso se
   envía con la **API de Gmail** y no por SMTP (SMTP+XOAUTH2 exigiría el scope
   amplio `https://mail.google.com/`).
2. SMTP con contraseña de aplicación (`app_pass`), si el usuario la configuró.
3. Respaldo global desde `.env` (`GMAIL_USER` + `GMAIL_APP_PASS`).

Sin cuenta configurada, el correo se marca `failed` con texto accionable
("Abre Mi correo y toca Vincular con Google") — no reintenta en bucle.
Las cuentas se **verifican al arrancar** el server y al cambiarlas (chip 🟢/🔴).

## Envío

`jjp_emails` con `direction='out'`, `status pending → sending → sent/failed`,
`html` opcional (tiene prioridad sobre el texto plano), `attachments` JSON con
rutas del bucket `jjp-email-media`. El MIME multipart se arma a mano en
`buildRawEmail()` (asuntos con acentos → RFC 2047).

## Recepción

Poll cada 2 min por cuenta OAuth (`in:inbox newer_than:2d`), deduplicado por
`gmail_id`. Guarda texto + HTML + snippet + metadatos de adjuntos, y enlaza
`customer_id` buscando el remitente en `jjp_customers`. Los **adjuntos se bajan
on-demand**: el panel marca `attach_state='requested'` (RPC
`jjp_email_request_attachments`) y un worker los trae a Storage.

## Automatizaciones

`email-campaigns.js`: campañas de seguimiento/captación, gracias post-pedido y
reactivación de inactivos. Comparten la cola con los correos normales.

## Retención

`retention.js` purga correo viejo (se puede re-traer de Gmail cuando haga falta).
Nació de la [[Historial de auditorias|auditoría de storage]].

Relacionado: [[wa-server]] · [[Envio de documentos]] · [[Difusion]] · [[Configuracion]]
