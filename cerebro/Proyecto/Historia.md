---
tags: [proyecto, cronologia]
---

# Historia del proyecto (cronología)

> Fuentes: historial git, migraciones en `sql/` y memoria de sesiones.
> Agregar una línea por hito nuevo, siempre con fecha.

## Julio 2026 — construcción intensiva

**~12-jul — Identidad y base**
- Paleta oficial: `#16604A` / `#99CC33` / `#003333` + latón `#C9A24B` (naranja
  `#F5A62B` ELIMINADO por chillón). Logo réplica IG en SVG. Hero chapa 3D.
- Rediseño UI: glass iOS, motion orgánico, carrusel promos.

**13-jul — RECONSTRUCCIÓN DE LA BASE DE DATOS** ⚠️
- El proyecto Supabase viejo (`drojfbytyhjgivdddxkw`) murió por bug de OrioleDB.
- Proyecto vigente: **`oeiuczltgdexwjjgquyq`**. Schema reconstruido 100% por
  ingeniería inversa del código (`sql/2026-07-13-rebuild-base-schema.sql`), sin
  datos previos. Ver [[Base de datos]].

**14→16-jul — Ventas y CRM toman forma**
- Descuentos de pedido, precio base, eventos de escaneo.
- Kardex (`jjp_stock_moves`), comprobante personalizable (`doc_*` en settings).
- Cuentas por pagar con recordatorios 7/3/1/0 días al WhatsApp del dueño.
- Difusión WhatsApp (contactos, plantillas, campañas con throttle anti-baneo).
- Clientes fiables + reseñas sembradas + chatbot con ofertas.
- Grupos de catálogo, migración 40 variantes al conteo persistente.

**18→19-jul — Conteo físico serio**
- Conteo por deltas (`jjp_count_tally` + RPC), multi-persona con etiqueta
  `counted_by`, cola de desconocidos, control de cruces con bitácora y deshacer.
- Puente SKU imágenes↔inventario; claves Gemini a .env.
- Hardening de seguridad (`2026-07-19-security-hardening.sql`).
- **Deploy pasa a git**: repo privado `github.com/kaddexomg/JJ-PAPER` (main) →
  Cloudflare Pages auto-deploy. Ver [[Configuracion]].

**22-jul — Auditoría general + deploy definitivo**
- Producción = **jj-paper.pages.dev** (Netlify OBSOLETO, plan agotado).
- `build.sh` publica solo lo web en `dist/` (excluye wa-server/sql/docs).
- Bucket `jjp-receipts` privado con signed URLs; REVOKE anon en 12 funciones.
- Conteo LAN por HTTPS:8788 (cámara del teléfono OK con cert autofirmado).

**23-jul — Server controlable + correo + tasas**
- `jjp_server_control`: heartbeat 🟢/🔴 + restart/stop desde el panel.
- Login Google OAuth; correo CRM por Gmail (por usuario, OAuth scope gmail.send).
- Euro BCV como 4ta tasa + Binance P2P real + historial `jjp_fx_rates`.
- Buscador universal de productos + sidebar unificado (`sidenav.js`).
- Auditoría storage/egress: catálogo de imágenes 2GB→19MB comprimido; retención
  de correo/WA; fantasma de 2GB en storage = basura backend (ticket a Supabase).

**24-jul — Auditoría del flujo de ventas**
- Detectado: cotización convertida perdía `variant_id` (stock nunca bajaba),
  doble conteo en contadores de clientes, sin vínculo quote↔order↔customer.

**25-jul — Delivery + WhatsApp pulido + rendimiento**
- Delivery por distancia: mapa Leaflet vendoreado, haversine×1.4, tarifas en
  settings, staff confirma o regala el envío. Ver [[Delivery]].
- Fix composer del chat (grid sin `grid-template-rows`) + presencia entrante por
  Realtime Broadcast. Incidente watchdog doble-arranque (Bad MAC) → [[Incidentes]].
- Auditoría rendimiento+seguridad: 62 políticas RLS a `(select auth.uid())`,
  21 índices FK, costos y token Gmail cerrados por columna, glass fuera de paneles.

**26-jul — Integraciones del ciclo de venta**
- `doc-engine.js`: UNA plantilla PDF para catálogo/lista/factura/recibo/presupuesto.
- `send-hub.js`: botón 📤 universal por el CRM con PDF adjunto real.
- Fix `jjp_convert_quote` conserva `variant_id`; contadores idempotentes;
  ficha 360° del cliente en el chat; factura formal SIN fingir valor fiscal.

**27-jul — Ficha de producto + cerebro**
- 📤 Ficha: foto del catálogo + reseña + enlace de compra por WhatsApp/correo
  (ver [[Envio de documentos]]). Sin cambios en wa-server.
- wa-server: vigilante de sesiones + logs a archivo + estado vivo en el latido.
- Nace este cerebro (`cerebro/` como baúl Obsidian) + `AGENTS.md` + `docs/`.

**06-ago — Precios personalizados, conexión con MixNet y UI WhatsApp**
- POS y Cotizaciones: Precios de venta unitarios personalizables en vivo para el vendedor, recalculando subtotales y totales automáticamente.
- Consulta de existencias: Modal de edición rápida (nombre, descripción, precios de variantes) para vendedores activos.
- Mis precios personalizados: Nuevo panel del vendedor (`vendedor/productos.html` y `vproducts.js`) que gestiona la tabla `jjp_seller_prices` en Supabase. El buscador universal (`product-finder.js`) inyecta automáticamente los precios personalizados por vendedor en memoria.
- Integración MixNet / Mixer: Endpoint local `/lan/mixnet/pedidos` (formatos JSON y CSV) y exportación consolidada a `pedidos_mixnet_local.csv` cada 60s. Además, el puente `mixer.js` escribe de manera inmediata archivos individuales CSV y TXT de cada pedido en `C:/JJ-PAPER-MIXER` conforme se registran en la base de datos de la tienda.
- Solución de Red y Conexión MixNet: Diseñadas 3 alternativas de arquitectura LAN/Nube para entornos donde la PC del facturador MixNet y el servidor principal no están en la misma red local. Creado el script puente independiente `mixer-bridge.js` que corre directo en la PC de MixNet consumiendo Supabase en tiempo real.
- Rediseño y Animaciones CRM WhatsApp: Modernización de la interfaz en `assets/css/wa.css` con esquinas asimétricas, profundidad de sombras, paleta de colores WhatsApp/Telegram y animaciones de entrada (`messageAppear`).

**19-ago — Catálogo del vendedor con fotos**
- Nueva página `vendedor/catalogo.html` + `vcatalogo.js`: tarjetas con foto, nombre,
  descripción corta, SKU, marca, precio $ y Bs y semáforo de existencias
  (✔ Disponible / ⚠ Pocas / ✕ Agotado). Precios personalizados de
  `jjp_seller_prices` aplicados igual que en `product-finder.js`.
- 💱 Edición de precios en vivo: solo para el PDF/impresión, NUNCA toca la base.
- 🖨️ Imprimir (con SKU) y ⬇️ descargar PDF interno (con SKU).
- 📤 Enviar al cliente: modal de chequeo con buscador de cliente (RLS), mensaje
  editable y botones directos WhatsApp/Correo; el PDF del CLIENTE va SIN costo ni
  SKU (protege el margen).
- `doc-engine.js` gana `docPdfCatalogoFotos` + `docImagenJpeg` (fetch→blob→canvas,
  evita el taint) + `docCargaFotos` (carga concurrente, límite 4).
- Menú: "📗 Catálogo" agregado al sidebar del vendedor (grupo Vender) y del admin
  (grupo Catálogo) en `sidenav.js`; bump `?v=20260819` en doc-engine.js (13 HTML)
  y sidenav.js (30 HTML).


Relacionado: [[Vision y metas]] · [[Pendientes]] · [[Historial de auditorias]]
