---
tags: [sistema, mapa]
---

# Páginas y rutas — quién mueve qué

> Cada fila: página → script(s) principal(es) → módulo del cerebro.
> Los scripts viven en `assets/js/` salvo indicación.

## Sitio público (raíz)

| Página | Scripts clave | Módulo |
|---|---|---|
| `index.html` | `catalog.js` (destacados), `hero-promos.js`, `reviews.js`, `logo3d.js`, `motion.js`, `chatbot.js` | [[Catalogo publico]] |
| `catalogo.html` | `catalog.js`, `product-modal.js`, `cart.js`, `export.js` (PDF/Excel) | [[Catalogo publico]] |
| `producto.html?id=` | consulta inline a `jjp_products` + `product-modal.js` | [[Catalogo publico]] — destino del enlace de la [[Envio de documentos|ficha]] |
| `checkout.html` | `checkout.js` + `cart.js` + Leaflet vendoreado | [[Delivery]] |
| `pedidos.html` | `orders.js` (cotización al mayor → `jjp_create_quote`) | [[Ventas y cotizaciones]] |
| `rastreo.html?n=` | RPC `jjp_track_order` (tolerante: teléfono por dígitos) | [[Ventas y cotizaciones]] |
| `promociones.html` | `promos.js` | [[Catalogo publico]] |
| `comprobante.html?o=/q=&t=` | lee pedido/cotización e imprime; `?t=ambos` = factura+recibo en una impresión | [[Envio de documentos]] |
| `lista_costos.html?q=` | lista de precios imprimible (modo costo solo staff) | [[Ventas y cotizaciones]] |
| `diag.html` | diagnóstico ES5 para PCs viejas | — |
| `404.html`, `_headers`, `_redirects` | seguridad/routing de Cloudflare Pages | [[Configuracion]] |

## Panel vendedor (`vendedor/`) — scripts en `assets/js/vendedor/`

| Página | Scripts | Módulo |
|---|---|---|
| `index.html` | `vdashboard.js` (metas, comisiones, notificaciones) | [[Ventas y cotizaciones]] |
| `pos.html?add=&cliente=` | `pos.js` + `product-finder.js` + `send-hub.js` | [[Ventas y cotizaciones]] |
| `cotizador.html?add=&cliente=` | `vquotes.js` + `product-finder.js` + `send-hub.js` | [[Ventas y cotizaciones]] |
| `cotizaciones.html` | `vquotes-list.js` (convertir → `jjp_convert_quote`) | [[Ventas y cotizaciones]] |
| `consulta.html` | `consulta.js` + `product-finder.js` + `ficha-producto.js` (botón 📤 Ficha) | [[Envio de documentos]] |
| `pedidos.html` | `vorders.js` | [[Ventas y cotizaciones]] |
| `clientes.html` | `vcustomers.js` (cartera, importar Excel/CSV, 📤 catálogo/lista) | [[Ventas y cotizaciones]] |
| `whatsapp.html` | `../wa/wa-chat.js`, `wa-common.js`, `wa-link.js` | [[CRM WhatsApp]] |
| `correo.html` | `../admin/correo.js` (compartido) | [[Correo]] |
| `difusion.html` | `vdifusion.js` | [[Difusion]] |
| `scan.html` | `scan.js` (teléfono como pistola → `jjp_pos_scans`) | [[Inventario y conteo]] |

`vcommon.js` = `initSellerPage()` (guardia de rol + notificaciones).

## Panel admin (`admin/`) — scripts en `assets/js/admin/`

| Página | Scripts | Módulo |
|---|---|---|
| `index.html` | `dashboard.js` | — |
| `pedidos.html` | `orders.js` (verificar pago, stock auto, delivery fee, 📤) | [[Ventas y cotizaciones]] |
| `cotizaciones.html` | `quotes.js` | [[Ventas y cotizaciones]] |
| `productos.html` | `products.js` + `ficha-producto.js` (📤) + `missing-photos.js` | [[Catalogo publico]] |
| `precios.html` | `pricing.js` (masivo por margen/tasas) | [[Ventas y cotizaciones]] |
| `inventario.html` | `inventory.js` | [[Inventario y conteo]] |
| `conteo.html` | `count-control.js` (cruces, bitácora, valorización) | [[Inventario y conteo]] |
| `escaner.html` | `inv-scan.js` | [[Inventario y conteo]] |
| `lan.html` | QR/estado del conteo WiFi (server `count-lan.js`) | [[Inventario y conteo]] |
| `marcas.html` / `unidades.html` | `brands.js` / `units.js` | [[Catalogo publico]] |
| `promociones.html` | `promos.js` (preview en vivo) | [[Catalogo publico]] |
| `resenas.html` | dentro de `quotes.js` (jjp_reviews) | [[Catalogo publico]] |
| `facturas.html` | `invoices.js` (cuentas por pagar) | [[Correo]]/[[wa-server]] avisos |
| `vendedores.html` | `sellers.js` (roles, metas, ranking) | [[Ventas y cotizaciones]] |
| `whatsapp.html` / `correo.html` | igual que vendedor | [[CRM WhatsApp]] / [[Correo]] |
| `ajustes.html` | `settings.js` + `server-control.js` + `clients.js` | [[Configuracion]] |
| `login.html` | `auth.js` (única puerta, redirige por rol) | [[Modelo de seguridad]] |

## Parámetros de URL que conectan flujos

- `?add=<productId>` → POS/cotizador auto-agregan el producto.
- `?cliente=<customerId>` → POS/cotizador precargan el cliente.
- `?cust=<customerId>` → whatsapp.html abre el chat de ese cliente.
- `?ref=<código>` → atribución de vendedor en el sitio público.
- `producto.html?id=` → ficha pública (la usa [[Envio de documentos|la ficha]] y "Compartir").
- `rastreo.html?n=<orden>` → estado del pedido.
- `comprobante.html?o=<orden>&t=<tipo>` → imprimir documento.

Relacionado: [[Arquitectura]] · [[Base de datos]] · [[Mapa de archivos]] (el índice inverso: de un archivo a su nota) · [[Por tarea]]
