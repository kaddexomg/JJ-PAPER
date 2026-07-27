# JJ PAPER — Arquitectura del sistema

> Para agentes de IA y desarrolladores nuevos. Complementa `AGENTS.md` (léelo primero).
> Última actualización: 2026-07-27.

## Vista de pájaro

```
┌────────────────────────┐        ┌──────────────────────────────┐
│  Cloudflare Pages      │        │  Supabase (oeiuczltgdexwjjgquyq)
│  jj-paper.pages.dev    │◄──────►│  Postgres + RLS + Realtime   │
│  (este repo, estático) │  anon  │  Storage + Auth + pg_cron    │
└────────────────────────┘        └──────────────┬───────────────┘
                                                 │ service_role
                                  ┌──────────────┴───────────────┐
                                  │  wa-server (PC de la tienda) │
                                  │  Baileys WhatsApp · Gmail    │
                                  │  campañas · LAN conteo · crons│
                                  └──────────────────────────────┘
```

- El frontend habla con Supabase con la clave **anon** + RLS.
- `wa-server` habla con Supabase con **service_role** (nunca exponer esa clave al front).
- No hay API propia: la "API" son las tablas con RLS + funciones RPC (`jjp_*`) + Realtime.

## Frontend

### Páginas públicas (raíz)
`index.html` (hero + promos + reseñas), `catalogo.html`, `producto.html?id=` (ficha
compartible), `pedidos.html` (cotización al mayor), `checkout.html` (pago en Bs +
comprobante + delivery por distancia con mapa Leaflet vendoreado), `rastreo.html`,
`promociones.html`, `lista_costos.html` (lista imprimible), `comprobante.html`
(factura/recibo imprimible, `?t=ambos` imprime los dos).

### Paneles staff
- `admin/login.html` es la **única puerta** de login; redirige por rol (tabla de perfiles
  + trigger que limita a 4 admins con anti-lockout).
- `vendedor/`: `pos.html`, `cotizador.html`, `cotizaciones.html`, `consulta.html`
  (stock + 📤 Ficha), `pedidos.html`, `clientes.html`, `whatsapp.html`, `correo.html`,
  `difusion.html`, `scan.html` (teléfono como pistola de códigos).
- `admin/`: lo mismo más `productos.html`, `precios.html`, `inventario.html`,
  `conteo.html`, `escaner.html`, `lan.html`, `facturas.html` (cuentas por pagar),
  `vendedores.html`, `ajustes.html`, `correo.html`, `whatsapp.html`.

### JavaScript compartido (`assets/js/`)
Sin módulos ES: todo es global, cargado por `<script>` en orden. Dependencias típicas:
`supabase-2.58.0.js` → `config.js` → `toast.js` → (admin/auth.js + sidenav.js) → módulos.

| Archivo | Qué hace |
|---|---|
| `config.js` | Cliente `sb` de Supabase, tasas BCV (`toBs`, `fmtPrice`), `escapeHTML`, `normTxt`, `optImg`, coords del mapa. |
| `doc-engine.js` | **Única plantilla PDF**: catálogo, lista, factura, recibo, presupuesto → `Blob`. `docResolvePedido`/`docResolveCotizacion` traen las líneas. Numeración de factura con Nº de control correlativo, IVA 16% desglosado hacia atrás. SIN valor fiscal real. |
| `send-hub.js` | Botón 📤 universal: encola documentos por `jjp_wa_messages`/`jjp_emails` con el PDF adjunto. `sendPorWhatsApp` acepta `mime`/`tipoMedia` (PDF por defecto; `image` para fotos). `sendPorCorreo` acepta `html`. Respaldo wa.me si el servidor está apagado. |
| `ficha-producto.js` | 📤 Ficha: foto del producto + reseña (nombre, descripción, precio $ y Bs, marcas) + enlace `producto.html?id=` por WhatsApp (imagen con caption) o correo (tarjeta HTML). Buscador de cliente respeta RLS. |
| `catalog.js` / `product-modal.js` | Catálogo público + modal de detalle con variantes por marca, galería y semáforo de stock (nunca cantidad exacta). |
| `cart.js` / `checkout.js` | Carrito localStorage; checkout con delivery por distancia (haversine × 1.4, base + $/km + gratis-desde en `jjp_settings`). |
| `export.js` | Descarga de catálogo en PDF/Excel con estilos. |
| `chatbot.js` | FAB del sitio: capta lead (RPC `jjp_capture_lead`), busca productos, ofrece ofertas. |
| `admin/sidenav.js` | **Fuente única** del sidebar staff (admin y vendedor). Editar el array, no el HTML. |
| `admin/auth.js` | Guardia de sesión + roles en páginas staff. |
| `vendedor/product-finder.js` | Buscador universal (nombre/SKU/código/marca), escaneo físico + cámara, puente teléfono→PC vía `jjp_pos_scans`. |
| `wa/wa-chat.js`, `wa/wa-common.js` | Panel CRM WhatsApp: hilos, notas de voz ptt, presencia por Realtime Broadcast (`wa-presence-<profile>`), composer con watchdog. |

## Base de datos (tablas principales, prefijo `jjp_`)

**Catálogo**: `jjp_products` (+`description`, `image_url`, `emoji`, `sku`, `stock`, `min_qty`,
`active`, `featured`, `essential`), `jjp_product_variants` (precio/costo/stock POR MARCA,
`barcode`, trigger de sync al padre), `jjp_brands`, `jjp_categories`, `jjp_units`, `jjp_promos`.

**Ventas**: `jjp_orders` + líneas (con `variant_id` — crítico para que el stock baje),
`jjp_quotes` (RPC `jjp_convert_quote` conserva `variant_id` y enlaza `quote_id`),
`jjp_customers` (cartera con `seller_id`; contadores `total_orders`/`total_usd` con
recálculo idempotente), `jjp_stock_moves` (kardex de TODO cambio de stock).

**Comunicación**: `jjp_wa_chats`/`jjp_wa_messages` (cola out: `status` pending→sending→sent/failed,
media en bucket `jjp-wa-media`), `jjp_wa_sessions`, `jjp_emails` (idem, `html` opcional,
adjuntos en `jjp-email-media`), `jjp_email_accounts` (Gmail por usuario: OAuth o app pass),
`jjp_wa_contacts` + campañas de difusión con throttle anti-baneo.

**Operación**: `jjp_settings` (tasas, delivery, `doc_*` del comprobante, mapa),
`jjp_server_control` (heartbeat + órdenes restart/stop), `jjp_count_tally` +
`jjp_count_scan`/`jjp_count_apply_batch` (conteo físico multi-persona, por deltas),
`jjp_pos_scans` (puente escáner), cuentas por pagar con recordatorios escalonados.

**Storage**: `jjp-wa-media`, `jjp-email-media`, `jjp-receipts` (PRIVADO, signed URLs),
`jjp-brands` (logos). Imágenes de producto en bucket público.

## wa-server (Node, PC de la tienda)

Arranque: `START-SERVIDOR.bat` (supervisor con reinicio) o `npm start`. Tarea de Windows
opcional (`INSTALAR-INICIO-AUTOMATICO.bat`). Logs a archivo vía `logger.js` (pino).

| Módulo (`src/`) | Qué hace |
|---|---|
| `index.js` | Bootstrap: arranca todos los módulos + HTTP local. |
| `session-manager.js` / `wa-session.js` | Sesiones Baileys por perfil (multi-usuario), QR, reconexión. **Guardia anti doble-arranque**: dos sockets con las mismas credenciales = `Bad MAC` en bucle. |
| `outbox.js` | Cola `jjp_wa_messages`: Realtime + sweep 30 s, lock optimista, tipos text/image/video/audio(ptt)/document. |
| `chats.js` / `media.js` | Entrantes: mensajes y media → Storage. |
| `email.js` | Gmail por usuario (API OAuth con scope `gmail.send`, o SMTP app-pass, o .env de respaldo). Envío + recepción (poll 2 min) + adjuntos on-demand. |
| `campaigns.js` / `email-campaigns.js` | Difusión masiva con throttle anti-baneo + reactivación diaria 10% dcto. |
| `heartbeat.js` | Late cada 20 s en `jjp_server_control`; obedece restart/stop desde el panel. |
| `count-lan.js` | Sirve la app de conteo por WiFi local: HTTPS:8788 (teléfono, cert autofirmado) y HTTP:8787 (PC), buffer en disco, espejo SSE, sube en lote al reconectar. |
| `invoices.js` | Recordatorios de cuentas por pagar (7/3/1/0 días) al WhatsApp del dueño. |
| `rates.js` / `retention.js` | Tasa BCV y purga de correo/WA viejo (re-traíble de Gmail). |

## Flujos críticos (de punta a punta)

1. **Venta pública**: catálogo → carrito → checkout (pago Bs + comprobante + delivery fee) →
   `jjp_orders` → admin verifica pago → stock baja automático al marcar pagado (por
   `variant_id`) → kardex → rastreo público.
2. **Cotización → venta**: cotizador staff → `jjp_quotes` → 📤 PDF al cliente →
   `jjp_convert_quote` (conserva variant_id, enlaza customer/quote) → pedido.
3. **Envío de documento/ficha**: front genera Blob (doc-engine) o baja la foto →
   sube a Storage → inserta fila `pending` → wa-server la despacha → `sent`.
   Si el servidor está apagado: queda en cola + respaldo manual wa.me.
4. **Conteo físico**: teléfono escanea (RPC por delta, cola offline) → tally → admin
   resuelve cruces en `conteo.html` → aplica al stock (con bitácora y deshacer).
