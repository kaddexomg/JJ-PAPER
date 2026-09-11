---
tags: [seguridad, incidentes]
---

# Incidentes y trampas conocidas

> Cada entrada costó horas reales o un susto en producción. Si tu cambio toca una
> de estas zonas, relee la entrada ANTES de editar.

## Servidor y WhatsApp

**Doble arranque de sesión → `Bad MAC` en bucle** (25-jul)
Dos sockets Baileys con las mismas credenciales se corrompen mutuamente. Un
watchdog que llamaba `start()` sin saber que ya había un arranque en curso creó
el segundo socket. Regla: **todo watchdog necesita guardia "arranque en curso"
limpiada en TODOS los caminos de salida** (éxito, error, timeout). Hoy son 3 min
en `session-manager.js`. Síntoma de que hay dos procesos: `Bad MAC` continuo.
→ `Bad MAC` y `sendPresenceUpdate falló` **ocasionales** son ruido normal.

**Doble `connect` → dos sockets → sesión expulsada y QR regenerado** (28-ago)
Realtime y el barrido de respaldo podían entregar el MISMO
`requested_action: 'connect'` dos veces; cada `start()` abría un socket Baileys
con el mismo auth → WhatsApp expulsaba a ambos ("sesión cerrada desde el
teléfono"). Síntoma: el QR se regenera aunque escanees. Regla: **un perfil =
una acción a la vez** — hoy hay mutex `working` en `session-manager.js` y guard
de 30 s en `WaSession.start()`. Regla aparte: dos sesiones `enabled` sobre el
MISMO número de WhatsApp se pisan entre sí; cada sesión = un número propio.
Columnas grandes de `jjp_wa_messages` (`forwarded`, `reply_to_wa_id`,
`reply_preview`, `reply_from`, `reaction*`) faltaban en la base nueva: sin ellas
los mensajes ENTRANTES no se guardan. Migración: `sql/2026-08-28-wa-messages-columnas-faltantes.sql`.

**Throttle de campañas**: quitarlo = riesgo de baneo del número del negocio. Ver
[[Difusion]].

**Código nuevo sin reiniciar**: el server sigue con el código viejo en RAM.
Reiniciar desde el panel o el .bat.

**Congelamiento por Modo de Edición Rápida (QuickEdit) de Windows** (10-sep)
Al hacer clic dentro de la ventana de consola (`START-SERVIDOR.bat`), Windows entra
en modo de selección (`Seleccionar...`) y bloquea sincrónicamente `stdout`
(`pino-pretty`). Todo el event-loop de Node.js se paraliza por completo
(campañas, Realtime, sweeps y latidos se congelan indefinidamente hasta que el usuario
presiona ENTER). Síntoma: el server deja de despachar sin errores y al presionar
Enter revive de golpe. Solución aplicada: QuickEdit desactivado en el registro de
Windows (`HKCU\Console -> QuickEdit = 0`), script `disable-quickedit.ps1` en arranque,
guarda en `index.js`, y `AbortSignal.timeout` en todas las llamadas `fetch` de `email.js`.

## Base de datos

**El proyecto Supabase murió** (13-jul): bug de OrioleDB en
`drojfbytyhjgivdddxkw`. Hubo que reconstruir el schema por ingeniería inversa del
código, sin datos previos. Proyecto vigente: `oeiuczltgdexwjjgquyq`. No apuntar
nada al viejo.

**`REVOKE ... FROM anon` no basta** si el `EXECUTE` es de `PUBLIC` — quedó
`purge_chats` ejecutable por anon. Revocar de `PUBLIC` también.

**Costos y token de Gmail expuestos** (25-jul): se cerró por permisos de columna
y publicación de Realtime por columnas.

**Confirm email ON dejó a todos fuera** del panel. Regla: Email provider ON /
Confirm email OFF.

## Ventas

**`variant_id` se perdía al convertir cotización → pedido**: el stock NUNCA
bajaba. Corregido en `jjp_convert_quote` (26-jul). Preservarlo de punta a punta.

**Doble conteo de contadores de cliente**: se sumaba en dos caminos. Hoy hay
recálculo idempotente.

**Delivery fee desaparecía** al decidir descuentos: `jjp_decide_discount` debe
conservarlo. Las comisiones sí lo excluyen (a propósito).

## Frontend

**El composer del chat desaparecía**: `.wa-wrap` es grid sin `grid-template-rows`;
la fila del hilo crecía con el historial y empujaba la barra fuera del
`overflow:hidden`. Diagnóstico costoso porque cada función "funcionaba sola".
Hoy: `waSyncComposer` única fuente de verdad + watchdog 3 s.

**Estilos inline que pisan `responsive.css`**: las reglas del hero mobile viven
en el `<style>` de `index.html` (igual en `pedidos.html`). Editar el CSS
compartido ahí no tiene efecto.

**Sidebar**: se reconstruye desde `assets/js/admin/sidenav.js`; editar el HTML del
aside no sirve. No confundir con `nav.js` (sitio público).
**Sidebar por URL ≠ por rol**: decidía el menú según la ruta (`/vendedor/`); un
admin entrando a `vendedor/catalogo.html` veía el menú del vendedor y parecía que
cambiaba de sesión. Hoy el menú sale del ROL (`loadProfile`); la URL es fallback.
El admin tiene su propia página `admin/catalogo.html` (mismo catálogo en
tarjetas); `vendedor/catalogo.html` redirige a los admins. No volver a decidir el
menú por la ruta.

**`optImg` con el CDN de Netlify rompió TODAS las imágenes** en producción. Hoy
devuelve la URL cruda (las imágenes ya se comprimen al subir). No reactivar
transformaciones sin probar en Cloudflare.

**`glass.css`** (42 blur) fuera de las 30 páginas de staff: mataba el rendimiento
en las PCs viejas de la tienda. No re-agregarlo a paneles.

**Orden de `<script>`**: un módulo que use `sendPorWhatsApp` debe cargar DESPUÉS
de `send-hub.js`. Y subir el `?v=` al editar JS compartido, o los navegadores de
la tienda sirven el viejo.

## Storage

**Fantasma de ~2GB** en storage: basura del backend de Supabase, NO borrable por
API (solo soporte o su GC). No perseguirlo desde el código; queda como
[[Pendientes|pendiente del dueño]].

**Entidades que más han mordido**: [[Stock]] y [[Pedido]] (el `variant_id`) ·
[[Cliente]] (contadores duplicados) · [[Cola de mensajes]] (doble arranque) ·
[[Sesion y roles]] (confirm email)

Relacionado: [[Modelo de seguridad]] · [[Guia maestra de auditoria]] · [[Historia]] · [[Por tarea]]
