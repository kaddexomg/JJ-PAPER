# JJ PAPER — Guía de auditoría (para agentes de IA)

> Procedimiento repetible para auditar este proyecto. Ejecutable por cualquier modelo con
> acceso al repo y (idealmente) al MCP de Supabase. Reporta hallazgos con severidad
> (CRÍTICO / ALTO / MEDIO / BAJO), archivo:línea y fix propuesto. **No apliques fixes de
> seguridad o DB sin confirmar el plan con el dueño** (regla de trabajo #1).

## 0. Preparación

- Lee `AGENTS.md`, `docs/ARQUITECTURA.md` y `docs/PELIGROS.md`.
- Auditorías previas (contexto de qué ya se revisó): seguridad+rendimiento 25-jul-2026,
  flujo de ventas 24-jul-2026, storage/egress 23-jul-2026, general 22-jul-2026.

## 1. Seguridad de datos (Supabase)

Con el MCP de Supabase (o SQL directo):

1. `get_advisors` (security y performance) — punto de partida oficial.
2. **RLS**: toda tabla `jjp_*` debe tener RLS activo. Buscar políticas con `auth.uid()`
   sin `(select ...)` y políticas demasiado abiertas (`USING (true)` en escritura).
3. **Funciones RPC**: para cada `jjp_*` function, verificar `EXECUTE` — debe estar
   revocado de `PUBLIC` **y** de `anon` salvo las públicas a propósito
   (`jjp_capture_lead`, rastreo). Query útil:
   ```sql
   select p.proname, pg_get_functiondef(p.oid) is not null,
          array_agg(distinct a.rolname) filter (where a.rolname in ('anon','authenticated'))
   from pg_proc p
   left join lateral aclexplode(p.proacl) acl on true
   left join pg_roles a on a.oid = acl.grantee
   where p.pronamespace = 'public'::regnamespace and p.proname like 'jjp%'
   group by 1, 2;
   ```
4. **Columnas sensibles**: costos (`cost_*` en products/variants), `oauth_refresh`/`app_pass`
   en `jjp_email_accounts` — NO legibles por anon; revisar también publicaciones Realtime.
5. **Storage**: `jjp-receipts` privado; sin buckets públicos nuevos con datos de clientes.
6. Frontend: grep de `service_role`, claves hardcodeadas, `select('*')` en páginas públicas.

## 2. Colas y servidor

1. Filas atascadas: `select status, count(*) from jjp_wa_messages group by 1;` (ídem
   `jjp_emails`). `sending` viejos = despacho murió a mitad; `failed` con `retry_count`
   al máximo = revisar `error`.
2. `jjp_server_control.heartbeat_at` reciente (< 70 s cuando el server corre).
3. Logs del server (`wa-server/logs/`): buscar `Bad MAC` masivo (doble arranque),
   `envío falló` repetido, cuentas de correo que no verifican.
4. Watchdogs: cualquier código que reinicie sesiones debe tener guardia anti
   doble-arranque (ver PELIGROS.md).

## 3. Flujo de ventas (integridad)

1. `variant_id` presente en líneas de pedidos convertidos desde cotización.
2. Todo cambio de stock tiene fila en `jjp_stock_moves` (kardex sin huecos).
3. Contadores de `jjp_customers` cuadran:
   ```sql
   select c.id, c.total_orders, count(o.id)
   from jjp_customers c left join jjp_orders o
     on o.customer_id = c.id and o.status in ('pagado','preparando','enviado','entregado')
   group by c.id, c.total_orders having c.total_orders <> count(o.id) limit 20;
   ```
4. Delivery fee: comisiones lo excluyen; descuentos (`jjp_decide_discount`) lo conservan.
5. Pendientes conocidos (no re-descubrir): entidad factura propia, numeración secuencial
   global, `@media print` global.

## 4. Frontend

1. **XSS**: grep de `innerHTML` con datos sin `escapeHTML` (clientes, productos, chats).
2. Botones/flujos con estado compartido: usar la técnica AUDITO (trazar cada botón por su
   secuencia completa de cambios de estado; los bugs viven en funciones que
   individualmente funcionan pero se pisan entre sí).
3. Mobile: reglas inline que pisan `responsive.css`; targets táctiles ≥ 44px; inputs 16px.
4. A11y: diálogos con `trapFocus` + ESC, `aria-label` en botones de icono, `aria-live`.
5. Cache-busting `?v=` actualizado en scripts editados.

## 5. Rendimiento

1. Advisors de Supabase: índices FK faltantes, seq scans en tablas grandes.
2. Egress/storage: media vieja purgable (`retention.js`), tamaño del catálogo de imágenes.
3. Front staff: sin blur/glass pesado; listas grandes con paginación.

## 6. Cierre

- Reporte: tabla de hallazgos por severidad + qué NO se pudo probar y cómo probarlo.
- Nada de fixes automáticos en DB/producción sin plan aprobado.
- Si se corrigió algo: actualizar `docs/PELIGROS.md` si nació una trampa nueva.
