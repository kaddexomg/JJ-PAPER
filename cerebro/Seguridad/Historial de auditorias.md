---
tags: [seguridad, auditoria]
---

# Historial de auditorías

> Para no re-descubrir lo ya sabido. Registrar cada auditoría nueva aquí,
> siguiendo el cierre de la [[Guia maestra de auditoria]].

## 22-jul-2026 — General (deploy y seguridad)

- Producción confirmada en **jj-paper.pages.dev**; Netlify obsoleto.
- `optImg` sin `/.netlify/images` (rompía todas las imágenes).
- `jjp-receipts` pasado a privado con signed URLs.
- REVOKE de anon en 12 funciones; escáner LAN por HTTPS:8788.
- Pendientes que dejó: rotar `service_role`, activar leaked password protection,
  re-escanear QR de WhatsApp. Ver [[Pendientes]].

## 23-jul-2026 — Storage y egress

- El "fantasma" de 2GB es basura del backend de Supabase, **no borrable por API**
  (solo soporte o su GC). No perseguirlo desde el código.
- `retention.js`: purga de correo/WA (re-traíble desde Gmail).
- Catálogo de imágenes comprimido 19 → 6.4 MB.

## 24-jul-2026 — Flujo de ventas

Hallazgos 🔴 (resueltos el 26-jul): sin vínculo `quote_id`/`customer_id`,
documento de venta sin motor único, **`variant_id` perdido al convertir** (el
stock nunca bajaba).
Siguen pendientes: entidad factura propia, numeración secuencial global,
`@media print` unificado.

## 25-jul-2026 — Rendimiento y seguridad

- 🔴 Costos del catálogo y token de Gmail **expuestos** → cerrados por columna y
  Realtime por columnas.
- 🔴 `purge_chats` borrable por anon (el `EXECUTE` era de `PUBLIC`) → guardia NULL
  y revocación correcta.
- 62 políticas RLS migradas a `(select auth.uid())` + 21 índices FK.
- `glass.css` fuera de 30 páginas de staff + modo perf-low.
- wa-server: logs a archivo, watchdog de sesiones, tarea de Windows.
- Regla aprendida: **REVOKE de anon no basta si el EXECUTE es de PUBLIC**.

## 25-jul-2026 — Incidente propio (no fue auditoría, fue error nuestro)

Watchdog de doble arranque → `Bad MAC`. Detalle en [[Incidentes]].

## Próxima auditoría — sugerencia de alcance

Con lo movido en julio, priorizar: bloque **B** (integridad dinero/stock, por los
cambios de conversión y delivery), bloque **A4** (permisos de RPCs nuevas de
conteo y correo) y bloque **D** sobre los botones de pedidos y el nuevo
[[Envio de documentos|📤 Ficha]].

Relacionado: [[Guia maestra de auditoria]] · [[Pendientes]] · [[Historia]]
