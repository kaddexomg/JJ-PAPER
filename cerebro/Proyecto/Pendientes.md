---
tags: [proyecto, backlog]
---

# Pendientes

> Mantener al día: mover a [[Historia]] al completar. Prioridad: 🔴 alta · 🟡 media · 🟢 baja.

## 🔴 Requieren al dueño (manuales, no de código)

- [ ] Rotar la clave `service_role` de Supabase (expuesta en auditoría 22-jul;
      cambiarla invalida el `.env` del [[wa-server]] — coordinar reinicio).
- [ ] Activar "leaked password protection" en Supabase Auth.
- [ ] Ticket a soporte Supabase por el fantasma de ~2GB de storage (basura de
      backend no borrable por API; ver [[Historial de auditorias]]).
- [ ] Google Cloud: mantener OAuth consent + credenciales al día
      (`GOOGLE_CLIENT_ID/SECRET` en `.env` — ver [[Configuracion]]).

## 🔴 Producto — flujo fiscal (auditoría 24-jul, parcialmente resuelta 26-jul)

- [ ] Entidad **factura propia** en DB (hoy la factura se dibuja desde el pedido).
- [ ] **Numeración secuencial global** garantizada por DB (hoy: Nº de control
      correlativo por serie `doc_control_serie`, pero el número de pedido es random).
- [ ] `@media print` global unificado (hoy cada página imprimible se defiende sola).

## 🟡 Catálogo y datos

- [ ] Costos faltantes en variantes (la valorización del conteo queda incompleta —
      ver [[Inventario y conteo]]).
- [ ] 14 marcas locales siguen con logo placeholder (bucket `jjp-brands`).
- [ ] Productos sin foto: `admin/productos.html` tiene detector de fotos faltantes;
      la [[Envio de documentos|ficha]] sale sin imagen para esos.

## 🟡 Técnica

- [ ] Validar `optImg()` con transformaciones de imagen en Cloudflare (hoy devuelve
      la URL cruda; el CDN de Netlify rompió imágenes — ver [[Incidentes]]).
- [ ] A11y del carrusel del home + plan Motion mobile (notas en memoria 16-jul).
- [ ] Revisar `.claude/settings.local.json` y `launch.json` sin commitear (config
      local; decidir si se ignoran en git).

## 🟢 Ideas con dirección (no comprometidas)

- Respuestas guiadas/plantillas en el chat del CRM.
- Seguimiento automático post-cotización (X días sin respuesta → recordatorio).
- Panel de métricas de vendedor más rico (conversión cotización→venta).

Relacionado: [[Vision y metas]] · [[Guia maestra de auditoria]]
