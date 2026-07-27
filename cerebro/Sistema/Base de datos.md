---
tags: [sistema, db]
---

# Base de datos (Supabase `oeiuczltgdexwjjgquyq`)

> ⚠️ El proyecto viejo `drojfbytyhjgivdddxkw` está MUERTO (bug OrioleDB, 13-jul-2026).
> Schema reconstruido por ingeniería inversa: `sql/2026-07-13-rebuild-base-schema.sql`
> y migraciones posteriores en `sql/` (referencia histórica; la verdad viva está en
> Supabase). RLS activo en todo; ver [[Modelo de seguridad]].

## Tablas por dominio (todas las vistas en código)

### Catálogo
- `jjp_products` — nombre, `description`, `price_usd`, `unit`, `emoji`, `image_url`,
  `sku`, `stock`, `min_qty`, `active`, `featured`, `essential`, `tag`, `category_id`.
- `jjp_product_variants` — **precio/costo/stock POR MARCA** (`brand_id`,
  `variant_name`, `sku`, `barcode`, `image_url`, `active`). Trigger sincroniza al padre.
- `jjp_brands` (con `logo_url`), `jjp_categories`, `jjp_category_groups`, `jjp_units`.
- `jjp_promos` — feed de promociones con vigencia y CTA.
- `jjp_missing_photos` (vista) — productos sin foto.
- `jjp_catalog_export` — apoyo del export del catálogo.

### Ventas y clientes
- `jjp_orders` — pedidos (líneas con `variant_id` ⚠️ crítico), `order_number`,
  estados: `pendiente_pago → verificando → pagado → preparando → enviado →
  entregado` (+ `cancelado`, `rechazado`), `delivery_*`, `discount_*`, `seller_id`,
  `customer_id`, `quote_id`.
- `jjp_quotes` — cotizaciones (mismas líneas), se convierten con `jjp_convert_quote`.
- `jjp_customers` — CRM: `phone` único, `email`, `rif`, `city`, `seller_id`,
  contadores `total_orders`/`total_usd` (recálculo idempotente), `last_order_at`.
- `jjp_reviews` — reseñas del home.
- `jjp_clients` — logos "clientes fiables" del marquee.
- `jjp_profiles` — usuarios staff (rol admin/seller, metas, `ref_code`, comisiones).
- `jjp_notifications` — campanita in-app.

### Comunicación
- `jjp_wa_chats` / `jjp_wa_messages` — CRM WhatsApp. Salientes: `status`
  `pending→sending→sent/failed`, `retry_count`, tipos `text|image|video|audio|document`,
  media en bucket `jjp-wa-media`. Ver [[CRM WhatsApp]].
- `jjp_wa_sessions` — estado de la sesión Baileys por perfil (`requested_action`
  para vincular/desvincular desde el panel).
- `jjp_wa_actions` — acciones sobre mensajes (citar/reaccionar/reenviar).
- `jjp_wa_contacts`*, `jjp_wa_templates`, `jjp_wa_campaigns`, `jjp_wa_campaign_targets`
  — [[Difusion]].
- `jjp_emails` — bandeja bidireccional (`direction`, `html`, `attachments` JSON,
  `attach_state`, `gmail_id`, `thread_id`). `jjp_email_accounts` (OAuth refresh o
  app pass POR USUARIO), `jjp_email_company`, `jjp_email_campaigns` + targets.

### Inventario y conteo
- `jjp_stock_moves` — kardex: TODO cambio de stock con razón y nº de pedido.
- `jjp_count_tally` — conteo físico por DELTAS (multi-persona, `counted_by`).
- `jjp_count_unknown`, `jjp_count_conflicts`, `jjp_count_counters`,
  `jjp_count_valued`, `jjp_count_log_view`, `jjp_barcode_dupes`, `jjp_barcode_log`
  — vistas/apoyo del control de conteo.
- `jjp_scan_events` — eventos de escaneo.
- `jjp_pos_scans` — puente teléfono→PC para POS/cotizador (`consumed`).

### Operación
- `jjp_settings` — clave/valor de TODA la configuración (ver [[Configuracion]]).
- `jjp_server_control` — heartbeat + `restart/stop` + `modules` (estado vivo).
- `jjp_fx_rates` — historial de tasas (BCV, Binance P2P, euro).
- `jjp_supplier_invoices` + `jjp_invoice_alerts` — cuentas por pagar.

## RPCs (las que llama el código — lista real)

| RPC | Quién la usa | Qué hace |
|---|---|---|
| `jjp_create_quote` | checkout, pedidos, chatbot | crea cotización/pedido público |
| `jjp_convert_quote` | cotizaciones (admin+vendedor) | cotización→pedido conservando `variant_id` ⚠️ |
| `jjp_track_order` / `jjp_track_quote` | rastreo, chatbot | estado público tolerante |
| `jjp_capture_lead` | chatbot | crea lead en `jjp_customers` (pública a propósito) |
| `jjp_best_sellers` | catálogo | destacados |
| `jjp_seller_by_ref` | config.js | atribución `?ref=` |
| `jjp_seller_ranking` | dashboards | ranking/comisiones |
| `jjp_decide_discount` | admin pedidos | aprueba/niega descuento (conserva delivery fee) |
| `jjp_apply_order_stock` / `jjp_revert_order_stock` | admin pedidos | baja/repone stock (kardex) |
| `jjp_delete_order` | admin pedidos | borra cancelados/rechazados |
| `jjp_set_stock`, `jjp_count_add`, `jjp_count_set`, `jjp_count_remove`, `jjp_count_transfer`, `jjp_count_revert`, `jjp_count_scan`, `jjp_count_apply_batch`, `jjp_count_unknown_resolve` | inventario/conteo | ver [[Inventario y conteo]] |
| `jjp_barcode_assign` / `jjp_barcode_clear` | conteo | arreglar códigos cruzados |
| `jjp_wa_ensure_chat` | send-hub/ficha | abre o reusa chat por teléfono |
| `jjp_wa_delete_chat` / `jjp_wa_purge_chats` | panel WA | borrar chats (guardia NULL ⚠️) |
| `jjp_wa_import_contacts` | difusión | importar contactos masivo |
| `jjp_email_request_attachments` | correo | pide descargar adjuntos entrantes |

## Automatizaciones en la DB (pg_cron)

- Tasas de cambio cada hora (respaldo del server) → `jjp_settings` + `jjp_fx_rates`.
- Generación de avisos de cuentas por pagar (el server solo los despacha).
- Crons diario/semanal del módulo vendedor (metas/resumen).
- Trigger `jjp_admin_limit`: máx 4 admins + anti-lockout.
- Trigger de provisión de perfil al registrarse con Google.

Relacionado: [[Modelo de seguridad]] · [[Guia maestra de auditoria]] · [[Arquitectura]]
