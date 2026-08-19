---
tags: [indice]
---

# Mapa de archivos — código ➜ documentación

> **Índice inverso**: abriste un archivo y no sabes qué es. Búscalo aquí y salta
> a la nota que lo explica. Complemento de [[Paginas y rutas]] (que va al revés:
> de la página al script).

## Raíz del repo

| Archivo | Qué es | Nota |
|---|---|---|
| `AGENTS.md` | puerta de entrada para IAs | [[CONTEXTO]] |
| `CLAUDE.md` | reglas duras para Claude Code | [[Reglas de trabajo]] |
| `build.sh` | build de Cloudflare: copia lo web a `dist/` **excluyendo lo interno** | [[Configuracion]] |
| `_headers`, `_redirects` | seguridad y rutas del hosting | [[Modelo de seguridad]] |
| `skills-lock.json` | herramientas del repo (no es código del sitio) | — |
| `sql/*.sql` | migraciones históricas (la verdad viva está en Supabase) | [[Base de datos]] |

## `assets/js/` — núcleo compartido

| Archivo | Responsabilidad | Nota |
|---|---|---|
| `config.js` | cliente `sb`, tasas (`toBs`, `fmtPrice`), `escapeHTML`, `normTxt`, `optImg` | [[Dinero y tasas]] |
| `toast.js` | avisos al usuario | — |
| `doc-engine.js` | **motor único de PDF** (catálogo, lista, factura, recibo, presupuesto + `docPdfCatalogoFotos` para tarjetas con foto) | [[Envio de documentos]] |
| `send-hub.js` | menú 📤 + `sendPorWhatsApp` / `sendPorCorreo` (encolar) | [[Cola de mensajes]] |
| `ficha-producto.js` | 📤 Ficha: foto + reseña + enlace de compra | [[Envio de documentos]] |
| `catalog.js` | catálogo público, grupos y categorías, búsqueda | [[Catalogo publico]] |
| `product-modal.js` | modal de producto con variantes y galería | [[Producto y variante]] |
| `cart.js` / `checkout.js` | carrito y compra (con mapa de envío) | [[Delivery]] |
| `orders.js` | cotización al mayor pública | [[Cotizacion]] |
| `chatbot.js` | FAB del sitio: capta leads, busca, ofrece promos | [[Cliente]] |
| `export.js` | descarga del catálogo en PDF/Excel | [[Catalogo publico]] |
| `promos.js`, `hero-promos.js`, `reviews.js` | promociones y reseñas | [[Catalogo publico]] |
| `nav.js` | nav del **sitio público** (≠ `sidenav.js`) | — |
| `motion.js`, `logo3d.js`, `reveal.js`, `fx-buttons.js` | animación e identidad | [[Configuracion]] |
| `perf.js` | modo de bajo consumo para PCs viejas | [[Incidentes]] |

## `assets/js/admin/`

| Archivo | Responsabilidad | Nota |
|---|---|---|
| `auth.js` | guarda de sesión y rol | [[Sesion y roles]] |
| `sidenav.js` | **fuente única** del sidebar de staff | [[Arquitectura]] |
| `dashboard.js` | panel principal | — |
| `orders.js` | pedidos: pago, stock, descuentos, envío, 📤 | [[Pedido]] |
| `quotes.js` | cotizaciones y reseñas | [[Cotizacion]] |
| `products.js` | productos y variantes (+ botón 📤 Ficha) | [[Producto y variante]] |
| `pricing.js` | precios masivos desde costo/margen/tasa | [[Dinero y tasas]] |
| `inventory.js`, `inv-scan.js` | ajustes y escáner | [[Stock]] |
| `count-control.js` | control del conteo: cruces, bitácora, valorización | [[Inventario y conteo]] |
| `brands.js`, `units.js`, `promos.js`, `clients.js` | catálogos auxiliares | [[Catalogo publico]] |
| `missing-photos.js` | productos sin foto | [[Pendientes]] |
| `sellers.js` | vendedores, metas, ranking | [[Sesion y roles]] |
| `settings.js` | `jjp_settings` (tasas, pagos, envío, documentos) | [[Configuracion]] |
| `server-control.js` | 🟢/🔴 del servidor, restart/stop | [[wa-server]] |
| `correo.js` | bandeja de correo (admin y vendedor) | [[Correo]] |
| `invoices.js` | cuentas por pagar | [[wa-server]] |

## `assets/js/vendedor/` y `assets/js/wa/`

| Archivo | Responsabilidad | Nota |
|---|---|---|
| `vcommon.js` | `initSellerPage()`: rol + notificaciones | [[Sesion y roles]] |
| `product-finder.js` | buscador universal + escáner + puente teléfono→PC | [[Producto y variante]] |
| `pos.js` | punto de venta | [[Pedido]] |
| `vquotes.js` / `vquotes-list.js` | cotizador y conversión | [[Cotizacion]] |
| `consulta.js` | consultar stock (+ 📤 Ficha) | [[Stock]] |
| `vorders.js` | pedidos del vendedor | [[Pedido]] |
| `vcustomers.js` | cartera de clientes + importación | [[Cliente]] |
| `vdifusion.js` | campañas masivas | [[Difusion]] |
| `vdashboard.js` | metas y comisiones | [[Ventas y cotizaciones]] |
| `scan.js` | teléfono como pistola de códigos | [[Inventario y conteo]] |
| `vcatalogo.js` | catálogo del vendedor: tarjetas con foto, precios editables, imprimir, enviar (PDF sin costo/SKU) | [[Envio de documentos]] |
| `wa/wa-chat.js` | el chat completo del CRM | [[CRM WhatsApp]] |
| `wa/wa-common.js`, `wa/wa-link.js` | utilidades y vinculación por QR | [[CRM WhatsApp]] |

## `wa-server/src/`

| Archivo | Responsabilidad | Nota |
|---|---|---|
| `index.js`, `config.js`, `logger.js`, `supabase.js` | arranque, `.env`, logs, cliente | [[wa-server]] |
| `session-manager.js`, `wa-session.js` | sesiones Baileys + **vigilante** | [[Incidentes]] |
| `outbox.js`, `chats.js`, `media.js` | cola y mensajería de WhatsApp | [[Cola de mensajes]] |
| `wa-presence.js`, `wa-actions.js` | presencia, citar/reaccionar | [[CRM WhatsApp]] |
| `email.js`, `email-campaigns.js` | correo por usuario y campañas | [[Correo]] |
| `campaigns.js` | difusión WhatsApp con throttle | [[Difusion]] |
| `heartbeat.js` | latido y comandos del panel | [[wa-server]] |
| `count-lan.js` | conteo por WiFi local (8787/8788) | [[Inventario y conteo]] |
| `invoices.js`, `rates.js`, `retention.js` | avisos, tasas, purga | [[Dinero y tasas]] |

Relacionado: [[Paginas y rutas]] · [[Por tarea]] · [[Arquitectura]]
