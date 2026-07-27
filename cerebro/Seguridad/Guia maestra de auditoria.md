---
tags: [seguridad, auditoria, procedimiento]
---

# Guía maestra de auditoría — JJ Paper

> Procedimiento ejecutable por cualquier modelo de IA o desarrollador con acceso
> al repo y (idealmente) al MCP de Supabase. **No aplicar fixes de seguridad, DB
> o producción sin confirmar el plan con el dueño** ([[Reglas de trabajo]]).

## Cómo usar esta guía

Nueve bloques (A–I). Puedes correr **una auditoría completa** (todos) o **una
focalizada** (solo el bloque relevante). Cada hallazgo se reporta así:

```
[SEVERIDAD] Título corto
  Dónde:    archivo:línea  o  tabla/función
  Qué pasa: el defecto, en una frase
  Cómo se rompe: entrada o escenario concreto → consecuencia real para el negocio
  Fix:      cambio propuesto (sin aplicarlo si es DB/seguridad/producción)
  Verificado: sí/no — y cómo se comprobó
```

**Severidad según daño al negocio**, no según elegancia técnica:
- 🔴 **CRÍTICO** — pérdida de dinero, de stock, fuga de datos de clientes/costos,
  o el negocio no puede vender (WhatsApp caído, checkout roto).
- 🟠 **ALTO** — un flujo importante falla o da datos incorrectos, con rodeo manual.
- 🟡 **MEDIO** — molestia real, riesgo latente, deuda que ya mordió antes.
- 🟢 **BAJO** — cosmético, consistencia, mejora.

**Antes de empezar** (siempre): leer [[CONTEXTO]], [[Reglas de trabajo]],
[[Incidentes]] y [[Historial de auditorias]] — para no re-descubrir lo ya sabido
ni proponer algo que ya se descartó. Para entender qué significan los datos que
vas a revisar: [[Cliente]], [[Producto y variante]], [[Pedido]], [[Cotizacion]],
[[Stock]], [[Dinero y tasas]], [[Cola de mensajes]], [[Sesion y roles]].

---

## A. Seguridad de datos (Supabase)

**Objetivo**: que nadie vea ni cambie lo que no le toca.

1. `get_advisors` (security + performance) del MCP de Supabase: punto de partida oficial.
2. **RLS en todas las tablas** `jjp_*`:
   ```sql
   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and relkind='r' and relname like 'jjp%' and not relrowsecurity;
   ```
   Resultado esperado: **cero filas**.
3. **Políticas peligrosas o lentas**:
   ```sql
   select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname='public'
     and (qual ~ 'auth\.uid\(\)(?!\s*\))' or qual = 'true' or with_check = 'true');
   ```
   Buscar: `auth.uid()` sin `(select …)`, y `true` en INSERT/UPDATE/DELETE para anon.
4. **Permisos de ejecución de RPCs** (la trampa de `PUBLIC`, ver [[Incidentes]]):
   ```sql
   select p.proname, coalesce(array_agg(distinct r.rolname) filter (where r.rolname is not null), '{PUBLIC}') as quien
   from pg_proc p
   left join lateral aclexplode(p.proacl) a on true
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace='public'::regnamespace and p.proname like 'jjp%'
   group by p.proname order by 1;
   ```
   Solo deben quedar accesibles a anon las públicas a propósito (lista en
   [[Modelo de seguridad]]). `proacl` NULL = permiso de `PUBLIC` ⇒ 🔴.
5. **Columnas sensibles**: costos, `oauth_refresh`, `app_pass`. Verificar
   `information_schema.column_privileges` para `anon` y la publicación de Realtime
   (`supabase_realtime`) por columnas.
6. **Storage**: `jjp-receipts` privado; ningún bucket público con datos de clientes.
7. **Frontend**: `grep -rn "service_role\|SUPABASE_SERVICE" assets/ *.html` ⇒ vacío.
   Revisar `select('*')` en páginas públicas contra la tabla de "qué nunca ve el
   público".
8. **Repo**: `git log --all --oneline -S"service_role"` y confirmar que `.env`
   nunca entró; `build.sh` excluye `wa-server/`, `sql/`, `docs/`, `cerebro/`.

## B. Integridad del dinero y el stock

**Objetivo**: que lo que dice el sistema sea lo que hay en la caja y en el estante.

1. **`variant_id` presente** en pedidos convertidos (bug histórico 🔴):
   ```sql
   select o.order_number, o.created_at from jjp_orders o
   where o.quote_id is not null
     and exists (select 1 from jsonb_array_elements(o.items) i
                 where i->>'variant_id' is null)
   order by o.created_at desc limit 20;
   ```
   *(ajustar al nombre real de la columna de líneas)*
2. **Kardex sin huecos**: todo pedido `pagado` en adelante debe tener filas en
   `jjp_stock_moves`. Un pedido pagado sin movimientos = stock inflado.
3. **Contadores de cliente cuadrados**:
   ```sql
   select c.id, c.name, c.total_orders, count(o.id) as reales
   from jjp_customers c
   left join jjp_orders o on o.customer_id=c.id
        and o.status in ('pagado','preparando','enviado','entregado')
   group by 1,2,3 having c.total_orders <> count(o.id) limit 20;
   ```
4. **Totales de pedido**: suma de líneas + envío − descuento = `total_usd`.
   Diferencias de centavos = redondeo mal hecho; diferencias grandes = 🔴.
5. **Delivery**: fee conservado tras `jjp_decide_discount`; comisiones que lo
   excluyan (ver [[Delivery]]).
6. **Stock negativo o inconsistente** entre variante y producto padre (el trigger
   de sync debería impedirlo).
7. **Precios**: variantes activas con `price_usd` nulo o 0 ⇒ se venden regaladas.

## C. Colas de comunicación y servidor

**Objetivo**: que ningún mensaje al cliente se quede callado.

1. Estado de las colas:
   ```sql
   select 'wa' fuente, status, count(*) from jjp_wa_messages group by 1,2
   union all
   select 'mail', status, count(*) from jjp_emails where direction='out' group by 1,2;
   ```
   - `sending` con más de unos minutos = un despacho murió a mitad (lock colgado).
   - `failed` ⇒ leer la columna `error`: distinguir "sin correo vinculado"
     (acción del usuario) de fallo real.
   - `pending` viejo con server 🟢 = la sesión no está `connected`.
2. **Heartbeat**: `select heartbeat_at, modules from jjp_server_control where id=1;`
   Menos de 70 s = vivo. `modules` ahora trae la salud real de cada WhatsApp.
3. **Logs** (`wa-server/logs/`): buscar `Bad MAC` **continuo** (dos procesos),
   `envío falló` repetido, `sin permiso de lectura` (re-vincular Gmail).
4. **Watchdogs**: cualquier código que reinicie sesiones debe tener guardia
   anti doble-arranque ([[Incidentes]]).
5. **Reintentos**: filas con `retry_count >= MAX_RETRIES` deben estar `failed`,
   no reintentando para siempre.

## D. Recorrido de botones (técnica AUDITO)

**Objetivo**: cazar bugs donde cada función funciona sola pero juntas se pisan.

Para cada botón crítico, escribir su **secuencia completa de cambios de estado**
y verificar el estado final:

| Botón | Secuencia a trazar |
|---|---|
| Marcar pedido pagado | estado → stock (por variante) → kardex → contadores cliente → comisión → notificación |
| Convertir cotización | crea pedido → `variant_id` → `quote_id`/`customer_id` → marca cotización usada |
| 📤 Enviar (hub) | genera PDF → sube Storage → inserta `pending` → enlaza `customer_id` → toast honesto según server |
| 📤 Ficha | baja foto → sube → `pending` tipo image → cierra modal → toast |
| Aplicar conteo al stock | tally → ajuste → kardex → deshacer disponible |
| Aprobar/negar descuento | total → **fee de envío conservado** → comisión |
| Borrar chat / vaciar todos | ¿desvincula sesión por error? ¿RLS del RPC? |

Preguntas guía: ¿qué pasa si lo tocan **dos veces rápido**? ¿si se va la conexión
a mitad? ¿si el server está apagado? ¿queda la UI mostrando algo distinto a la DB?

## E. Frontend: XSS, estado y consistencia

1. **XSS**: `grep -rn "innerHTML" assets/js/ | grep -v escapeHTML` y revisar cada
   caso donde entren datos de clientes, productos o chats.
2. Datos en atributos `onclick='…${valor}…'`: comillas en un nombre rompen el HTML.
3. **Orden de scripts** y `?v=` actualizado en cada página que cargue un JS editado.
4. Estilos inline que pisan `responsive.css` (index/pedidos) — [[Incidentes]].
5. Funciones globales duplicadas entre módulos (mismo nombre, dos archivos).
6. Manejo de errores: `catch` que se traga el fallo sin avisar al usuario ⇒ el
   vendedor cree que envió y no envió (🟠 por confianza).

## F. Accesibilidad y mobile

1. Diálogos con `trapFocus` + cierre por ESC + foco devuelto al abridor.
2. `aria-label` en botones de solo icono (📤, 📷, ✏️, 🗑️); `aria-live` en zonas
   que cambian solas; `aria-pressed` en toggles.
3. Targets táctiles ≥ 44px; inputs de 16px (evita el zoom de iOS).
4. Contraste según la paleta de [[Configuracion]]; nada que dependa solo del color
   (el semáforo de stock lleva símbolo además del color).
5. `dvh` + safe-area en pantallas completas; tablas anchas con scroll propio.

## G. Rendimiento

1. Advisors de Supabase: índices FK faltantes, consultas lentas.
2. Consultas que traen todo el catálogo en páginas que muestran 20 filas.
3. `select('*')` donde bastan 5 columnas (además es riesgo de fuga, ver bloque A).
4. PCs viejas: sin `glass.css` en paneles, modo perf-low, imágenes comprimidas.
5. Egress/storage: media purgable por `retention.js`, tamaño de buckets.

## H. Experiencia y honestidad del producto

1. ¿Cada acción dice qué pasó **en español claro**? ("queda en cola" vs error críptico).
2. ¿Se promete algo que el sistema no hace? (cascarones ⇒ 🔴 según
   [[Reglas de trabajo]]).
3. ¿Los documentos declaran correctamente su naturaleza (sin valor fiscal)?
4. ¿Hay caminos sin salida cuando el server está apagado? Debe existir respaldo
   manual (el hub lo tiene con wa.me).

## I. Documentación y continuidad

1. ¿Este cerebro refleja el código de hoy? Módulo cambiado ⇒ nota actualizada.
2. ¿Nació una trampa nueva? ⇒ [[Incidentes]].
3. ¿Hay pendientes resueltos que siguen listados? ⇒ [[Pendientes]] / [[Historia]].
4. ¿`build.sh` excluye toda carpeta interna nueva?

---

## Cierre de la auditoría

1. Tabla de hallazgos ordenada por severidad, con el formato de arriba.
2. **Qué NO se pudo probar** y cómo probarlo (regla de honestidad).
3. Propuesta de plan: qué arreglar primero y por qué, en términos de negocio.
4. Registrar la auditoría en [[Historial de auditorias]].
5. Nada se aplica en DB o producción sin aprobación explícita.

Relacionado: [[Modelo de seguridad]] · [[Incidentes]] · [[Historial de auditorias]] · [[Reglas de trabajo]]
