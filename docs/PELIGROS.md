# JJ PAPER — Trampas conocidas y errores ya cometidos

> Cada punto de esta lista costó horas reales de depuración o un incidente en producción.
> Si tu cambio toca una de estas zonas, relee la entrada ANTES de editar.

## WhatsApp / wa-server

- **Doble arranque de sesión = `Bad MAC` en bucle.** Dos sockets Baileys con las mismas
  credenciales se corrompen mutuamente. Todo watchdog que reinicie sesiones necesita una
  guardia "arranque en curso" que se limpie en TODOS los caminos de salida (éxito, error,
  timeout). Si ves `Bad MAC` masivo: hay dos procesos del server corriendo.
- `Bad MAC` / `sendPresenceUpdate falló` **ocasionales** son ruido normal de Baileys; no
  pasan por pino y no son un bug.
- Campañas de difusión llevan **throttle anti-baneo** (espera entre envíos). No lo quites
  ni lo "optimices": un baneo de WhatsApp mata el canal de ventas.
- Tras cambiar código del server hay que **reiniciarlo** (panel admin → restart, o el .bat).

## CSS / UI

- Los `<style>` inline de `index.html` **pisan** `responsive.css` (las reglas del hero
  mobile viven en index.html, no en el CSS). Igual pasa en pedidos.html.
- El composer del CRM WhatsApp desaparecía porque `.wa-wrap` (grid) no tenía
  `grid-template-rows`: la fila del hilo crecía y empujaba la barra fuera con
  `overflow:hidden`. `waSyncComposer` es la única fuente de verdad + watchdog 3 s.
- Sidebar staff: se genera desde `assets/js/admin/sidenav.js`. Editar el HTML del aside
  no sirve (se reconstruye). No confundir con `nav.js` (nav del sitio público).
- `glass.css` (blur pesado) está EXCLUIDO de las páginas de staff por rendimiento.
  No lo re-agregues a paneles.

## Supabase / seguridad

- `REVOKE ... FROM anon` **no basta** si el `EXECUTE` viene concedido a `PUBLIC`:
  hay que revocar de `PUBLIC` también. (Incidente real: `purge_chats` borrable por anon.)
- Políticas RLS: usar `(select auth.uid())`, no `auth.uid()` directo (rendimiento; ya se
  migraron 62 políticas).
- Columnas de **costo** y el token de Gmail NO son legibles para anon (cerrado por columna
  + Realtime por columnas). Cualquier `select('*')` público nuevo debe revisarse.
- `jjp-receipts` es bucket **privado** (signed URLs). No crear buckets públicos para
  documentos de clientes.
- El público NUNCA ve: stock exacto (solo semáforo Disponible/Pocas/Agotado), SKU, costos.
- Producción es **Cloudflare Pages** (`jj-paper.pages.dev`). Netlify quedó obsoleto:
  no usar `/.netlify/images` ni funciones de Netlify.
- El proyecto Supabase vigente es `oeiuczltgdexwjjgquyq`; el viejo `drojfbytyhjgivdddxkw`
  está abandonado (bug OrioleDB). No apuntar nada ahí.

## Datos / ventas

- **`variant_id` debe sobrevivir todo el flujo** cotización→pedido→pago. Si se pierde,
  el stock NUNCA baja (bug real, ya corregido en `jjp_convert_quote`).
- Contadores de clientes (`total_orders`, `total_usd`): usar el recálculo idempotente;
  hubo doble conteo por sumar en dos caminos.
- Conteo físico: los totales van por RPC de **delta** (`jjp_count_scan`), nunca escribir
  totales absolutos (varias personas cuentan a la vez).
- La numeración de factura visible es correlativa por Nº de control, pero la entidad
  factura propia y la numeración secuencial global siguen PENDIENTES (ver auditoría
  24-jul). El documento imprime "sin valor fiscal" a propósito: no lo "arregles".
- NO tocar datos de inventario (stock/costos/conteos) sin orden explícita del dueño.

## Front / JS

- Todo es global y el **orden de los `<script>` importa** (config → toast → auth →
  sidenav → módulos). Un módulo nuevo que use `sendPorWhatsApp` debe cargar DESPUÉS
  de `send-hub.js`.
- `escapeHTML()` en TODA interpolación de datos a HTML. Los datos de clientes y
  productos los escribe gente real: hay comillas, emojis y `<`.
- Cache-busting con `?v=YYYYMMDD` en los `<script src>`: si editas un JS compartido y no
  subes la versión, los navegadores de la tienda sirven el viejo.
- `optImg()` hoy devuelve la URL tal cual (el CDN de Netlify rompió imágenes en
  producción). No re-activar transformaciones sin probar en Cloudflare.
