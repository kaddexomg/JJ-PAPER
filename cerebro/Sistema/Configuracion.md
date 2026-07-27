---
tags: [sistema, config]
---

# Configuración

## `jjp_settings` (clave/valor — editable en `admin/ajustes.html`)

Lista REAL (de `SETTINGS_FIELDS` en `assets/js/admin/settings.js`):

| Grupo | Claves |
|---|---|
| Tasas | `exchange_rate` (BCV), `usdt_rate` (Binance P2P), `rate_eur`, `default_margin_pct` |
| Identidad | `site_name`, `site_tagline`, `phone_display`, `whatsapp_number`, `whatsapp_message`, `email`, `address`, `hours_weekday`, `hours_saturday` |
| Mapa | `map_lat`, `map_lng` (geocode Nominatim desde ajustes; index arma iframe + "Cómo llegar") |
| Pagos | `pago_movil_bank/phone/ci/name`, `transfer_bank/account/type/holder/ci` |
| [[Delivery]] | `delivery_base_usd`, `delivery_per_km_usd`, `delivery_free_over_usd` |
| Documentos | `business_name`, `rif`, `iva_pct`, `doc_title`, `doc_color` (#16604A), `doc_accent` (#C9A24B), `doc_logo_url`, `doc_paper`, `doc_show_bs`, `doc_footer_legal`, `doc_footer_note`, `doc_control_serie` |

Las tasas las refrescan el [[wa-server]] (`rates.js`) y un pg_cron de respaldo cada hora.

## `.env` del wa-server (NUNCA en git)

| Variable | Para qué |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | acceso total a la DB (obligatorias; el server no arranca sin ellas) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth de Gmail (vincular correo y login Google) |
| `GMAIL_USER`, `GMAIL_APP_PASS`, `GMAIL_FROM` | respaldo SMTP opcional |
| `COUNT_LAN_PORT` (8787), `COUNT_SESSION` | conteo LAN |

Puertos LAN: **8787 HTTP** (PC) y **8788 HTTPS** (teléfono; cert autofirmado
necesario para que el navegador dé cámara).

## Deploy

1. `git push` a `main` del repo PRIVADO `github.com/kaddexomg/JJ-PAPER` (gh en keyring).
2. Cloudflare Pages corre `build.sh` → `dist/` y publica **jj-paper.pages.dev**.
3. `build.sh` EXCLUYE: `wa-server/`, `sql/`, `docs/`, `cerebro/`, `*.md`,
   datos sueltos (pdf/xlsx/csv/jpg) y dotfiles. Si creas una carpeta interna
   nueva, AGRÉGALA a la exclusión — si no, se publica al mundo.
4. `_headers` (CSP/seguridad) y `_redirects` sí se publican.
5. Netlify (`jjpaper-store.netlify.app`) OBSOLETO desde 22-jul-2026.

## Identidad de marca

Paleta: verde `#16604A` · lima `#99CC33` · petróleo `#003333` · latón `#C9A24B`.
El naranja `#F5A62B` fue ELIMINADO (12-jul). Logo SVG réplica del de Instagram
(`assets/img/logo.svg`), 8 logos de marcas en bucket `jjp-brands`.

## Cuentas y servicios externos

| Servicio | Qué hay |
|---|---|
| Supabase | proyecto `oeiuczltgdexwjjgquyq` (el viejo `droj…` está muerto) |
| Cloudflare Pages | build `build.sh`, output `dist/`, auto-deploy en push |
| GitHub | repo privado, rama `main` |
| Google Cloud | OAuth consent + credenciales para Gmail/login |
| WhatsApp | número del negocio vinculado por QR (Baileys); dueño: +584120100372 |

Relacionado: [[Arquitectura]] · [[wa-server]] · [[Modelo de seguridad]]
