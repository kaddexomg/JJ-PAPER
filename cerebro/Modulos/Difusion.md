---
tags: [modulo, crm, marketing]
---

# Difusión (campañas WhatsApp y correo)

`vendedor/difusion.html` → `vdifusion.js`. Motor: `wa-server/src/campaigns.js`
(WhatsApp) y `email-campaigns.js` (correo).

## Piezas

- **Contactos**: importación masiva (`jjp_wa_import_contacts`) y selección desde
  la cartera de `jjp_customers` con filtros (inactivos, ciudad, etc.).
- **Plantillas** (`jjp_wa_templates`): texto con variables `{{nombre}}` que se
  sustituyen por destinatario.
- **Campañas** (`jjp_wa_campaigns` + `jjp_wa_campaign_targets`): cada destinatario
  es una fila con su estado, así se ve el avance y se puede reintentar.

## Anti-baneo (crítico)

El despachador manda con **throttle** (espera configurable entre envíos, tick de
15 s). **No quitar ni "optimizar" ese retraso**: un baneo de WhatsApp deja al
negocio sin su canal principal de ventas. Los mensajes salen por la misma cola
`jjp_wa_messages` que el resto ([[CRM WhatsApp]]).

Al terminar una campaña, notifica en `jjp_notifications`.

## Automático

Reactivación diaria de clientes inactivos con 10% de descuento (nació con la
difusión, 16-jul). El equivalente por correo vive en `email-campaigns.js`
([[Correo]]).

Relacionado: [[CRM WhatsApp]] · [[Correo]] · [[Ventas y cotizaciones]] · [[wa-server]]
