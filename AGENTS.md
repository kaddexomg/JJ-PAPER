# JJ PAPER — Guía para agentes de IA (Claude, Codex, Cursor, Gemini, etc.)

Este archivo es la **puerta de entrada** para cualquier modelo de IA que trabaje en este
repositorio. Léelo completo antes de tocar código. Documentación detallada en `docs/`:

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — mapa completo del sistema, módulo por módulo.
- [`docs/AUDITORIA.md`](docs/AUDITORIA.md) — cómo auditar este proyecto (seguridad, rendimiento, flujos).
- [`docs/PELIGROS.md`](docs/PELIGROS.md) — errores ya cometidos y trampas conocidas. **No los repitas.**

## Qué es este proyecto

Tienda/CRM de una papelería real en Venezuela ("JJ Paper"). Vende al detal y al mayor.
Tres audiencias:

1. **Público** (raíz del repo): catálogo, carrito, checkout, rastreo de pedidos, promociones.
2. **Vendedor** (`vendedor/`): POS, cotizador, CRM de clientes, WhatsApp, correo, difusión.
3. **Admin** (`admin/`): todo lo del vendedor + inventario, precios, pedidos, ajustes, cuentas por pagar.

## Stack (sin frameworks, sin build)

| Capa | Tecnología |
|---|---|
| Frontend | **HTML + CSS + JavaScript vanilla**. Sin bundler, sin npm en el front. Scripts globales cargados con `<script src>` en orden; el orden IMPORTA. |
| Backend/DB | **Supabase** (proyecto `oeiuczltgdexwjjgquyq`). Postgres + RLS + Realtime + Storage + Auth. Tablas con prefijo `jjp_`. |
| Servidor local | **`wa-server/`** (Node.js, corre en la PC de la tienda): WhatsApp vía Baileys, correo vía Gmail API/SMTP, campañas, tareas programadas, servidor LAN para conteo físico. |
| Deploy | `git push` a `main` → **Cloudflare Pages** auto-despliega en `jj-paper.pages.dev`. (Netlify quedó OBSOLETO.) |
| SQL | Migraciones y funciones en `sql/` (referencia histórica; la verdad viva está en Supabase). |

## Reglas de trabajo (obligatorias)

1. **Confirma el plan antes de tocar código o DB**: qué vas a hacer, por dónde y con qué meta.
   El dueño quiere aprobar el enfoque, no descubrirlo después.
2. **Features reales, no cascarones**: si una función se promete, debe funcionar de punta a punta.
3. **No rompas el servidor de la tienda** (`wa-server`): es producción; una sesión de WhatsApp
   corrupta cuesta re-escanear el QR y puede causar baneo.
4. **NUNCA toques datos de inventario** (stock, conteos, costos) sin orden explícita.
5. **Sé honesto sobre lo que no probaste**: si no pudiste ejecutar algo, dilo y explica cómo
   se ve un arranque/flujo sano para que el humano lo verifique.
6. Todo texto visible al usuario, comentarios y commits van en **español**.
7. Cache-busting: al editar un JS compartido, sube el `?v=` en los HTML que lo incluyen.

## Convenciones de código

- **Funciones globales con prefijo por módulo**: `pf*` (product-finder), `send*` (send-hub),
  `ficha*` (ficha-producto), `doc*` (doc-engine), `wa*` (CRM WhatsApp), `cons*` (consulta),
  `cust*` (clientes)… Respeta el prefijo del archivo donde escribes.
- **`escapeHTML()` SIEMPRE** al interpolar datos en HTML (está en `assets/js/config.js`).
- Colas de salida (WhatsApp/correo) siguen el ciclo `pending → sending → sent/failed`
  con lock optimista + reintentos (`retry_count` vs `MAX_RETRIES`). No inventes otro patrón.
- Realtime + barrido (`setInterval`) de respaldo: todo listener de Realtime tiene un sweep
  periódico por si el socket se cae.
- RLS: políticas con `(select auth.uid())` (no `auth.uid()` pelado — rendimiento).
  Funciones RPC sensibles: `REVOKE EXECUTE FROM public, anon` (REVOKE a `anon` no basta
  si el `EXECUTE` es de `PUBLIC`).
- Información interna que NUNCA se muestra al público: stock exacto (solo semáforo),
  SKU, costos. Las columnas de costo no son legibles para `anon`.
- CSS: los `<style>` inline de `index.html` **pisan** `responsive.css`. El sidebar del staff
  se genera SOLO desde `assets/js/admin/sidenav.js` (no edites el HTML del aside).

## Cómo probar

- Frontend: abrir el HTML directo o servir la carpeta (es estático). Login staff en `admin/login.html`.
- `wa-server`: `cd wa-server && npm start` (o `START-SERVIDOR.bat`). Necesita `.env` con
  claves de Supabase (service_role) y Gmail. Un arranque sano loguea: sesión WhatsApp
  `connected`, `realtime outbox`, `módulo correo activo`, heartbeat cada 20 s en
  `jjp_server_control`. `Bad MAC` / `sendPresenceUpdate falló` ocasionales son ruido normal.
- El panel admin muestra 🟢/🔴 del servidor (heartbeat < 70 s = vivo).

## Dónde está cada cosa (resumen)

| Quiero tocar… | Archivo(s) |
|---|---|
| Catálogo público | `catalogo.html`, `assets/js/catalog.js`, `product-modal.js`, `producto.html` |
| Carrito/checkout | `assets/js/cart.js`, `checkout.js` (delivery por distancia con Leaflet) |
| Envío de documentos (📤) | `assets/js/send-hub.js` (menú) + `doc-engine.js` (PDF único) |
| Enviar ficha de producto | `assets/js/ficha-producto.js` (foto + reseña + link por WA/correo) |
| Buscador de productos staff | `assets/js/vendedor/product-finder.js` |
| POS / cotizador | `assets/js/vendedor/pos.js`, `vquotes.js` |
| CRM WhatsApp (panel) | `assets/js/wa/wa-chat.js`, `wa-common.js` |
| WhatsApp (servidor) | `wa-server/src/wa-session.js`, `outbox.js`, `chats.js`, `media.js` |
| Correo (servidor) | `wa-server/src/email.js`, campañas en `email-campaigns.js` |
| Sidebar staff | `assets/js/admin/sidenav.js` (fuente única) |
| Ajustes / tasas / doc_* | `assets/js/admin/settings.js`, tabla `jjp_settings` |

Detalle completo en `docs/ARQUITECTURA.md`.
