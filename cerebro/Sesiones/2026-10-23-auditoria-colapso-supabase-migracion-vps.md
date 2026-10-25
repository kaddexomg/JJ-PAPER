# Sesión del 23 de Octubre de 2026: Auditoría Forense del Colapso de Supabase, Brecha de Seguridad y Migración al VPS

> **Documento del Cerebro de JJ Paper**
> **Fecha:** 23 de Octubre de 2026
> **Participantes:** Usuario Supervisor + Agente IA (OpenCode / DeepSeek)
> **Modo de trabajo:** Auditoría de solo lectura + pruebas controladas mínimas. **No se modificó producción.**
> **Commit auditado:** `dd3fc41` (main, árbol limpio). `feature/multi-supabase` queda aparte en `6ebab98`.
> **Estado:** Diagnóstico entregado. Remediación **pendiente de autorización** del usuario.

---

## 0. Resumen Ejecutivo

El sistema no cayó por una sola causa. Colapsó porque **cuatro fallas independientes se alinearon** y, sobre todo, porque **el sistema de monitoreo estaba diseñado para reportar salud mientras la plataforma se moría**.

| # | Falla | Impacto |
| :-- | :--- | :--- |
| 1 | Agotamiento de **egress** (transferencia saliente) en Supabase Cloud | Proyecto restringido → toda la app caída |
| 2 | El **monitor de cuotas solo medía DB y Storage**, nunca egress | Indicador siempre verde / 0% |
| 3 | La **autenticación vivía en el mismo proyecto** que la base de datos | Al caer el proyecto, murió el login → nada funcionó |
| 4 | **Credenciales `service_role` publicadas** en un repo público | Compromiso total de datos, antes y después del colapso |

A esto se suma que la migración al VPS se hizo **por partes y sin una fuente única de verdad**, dejando el sistema en un estado de **doble cerebro (split-brain)**: frontend apuntando al VPS, `wa-server` apuntando todavía a Supabase Cloud, y esquemas distintos entre lo que el código espera y lo que el VPS tiene.

**Conclusión central:** el VPS no falló. **El VPS está sano** (28 MB de base de datos, 15.6% RAM, 8.1% disco, 193 tuplas muertas). Lo que falla es la **capa de configuración, permisos y contratos de esquema** alrededor del VPS.

---

## 1. Por Qué el Monitor Siempre Mostró Uso Bajo (la mentira operativa)

### 1.1 Causa raíz
`wa-server/src/monitor.js` calculaba el uso así:

- Tamaño de base de datos vs. 500 MB.
- Tamaño de Storage vs. 1 GB.

**Nunca consultó egress.** El egress es la métrica que realmente se agotó.

### 1.2 Agravantes que convirtieron un error en una ceguera

1. **Error → 0% verde.** Ante cualquier fallo de medición, la función devolvía `usagePercent: '0'`. Un monitor que no puede medir reporta "perfecto".
2. **Fallback hardcodeado.** Si no podía leer Storage, asumía **295 archivos**. Un valor inventado presentado como real.
3. **Project ref equivocado.** El monitor apuntaba a un proyecto distinto del que servía la app, así que incluso midiendo, medía otro sistema.
4. **Cliente de UI con datos falsos.** `assets/js/admin/monitor-client.js` contiene **tablas hardcodeadas**, fuerza `overallHealth:'OPTIMAL'` y muestra mensajes de éxito incondicionales, independientemente de la respuesta real.
5. **Backups falsos.** Los respaldos reportaban éxito sin verificar que el archivo se hubiera creado.

### 1.3 Lección
Un monitor que no puede fallar no es un monitor: es un adorno. **Toda métrica debe tener estado `UNKNOWN` explícito**, nunca un valor por defecto tranquilizador.

---

## 2. Por Qué Murió También el Login

La autenticación (GoTrue / auth) estaba alojada en el **mismo proyecto de Supabase** que la base de datos. Cuando el proyecto entró en restricción por cuota:

1. Se bloqueó el acceso a datos.
2. Se bloqueó también el servicio de auth.
3. Sin auth no hay token → sin token no hay RLS satisfecho → **todo el frontend devuelve listas vacías o redirige al login**.
4. El usuario percibe "se cayó todo", cuando en realidad fueron **dos servicios acoplados cayendo juntos**.

Esto es exactamente el argumento que justifica la migración a VPS: **desacoplar auth de datos**. Pero la migración se ejecutó sin completar ese desacople (ver §4).

---

## 3. Brecha de Seguridad Activa (CRÍTICA — verificada en vivo)

> Estas comprobaciones se hicieron con la clave **pública (`anon`)** que está en el repositorio. No se usó ninguna credencial privilegiada.

### 3.1 Claves privilegiadas expuestas en un repositorio público

- Repositorio `https://github.com/kaddexomg/JJ-PAPER` → **`private: false`** (público).
- `jj-mixnet-agent/config.js` línea 13 → **`service_role` key válida**, en claro, en un repo público.
- `lan-daemon/daemon.js` → la misma clave `service_role`.
- `wa-server/setup-vps.sh` → claves de servicio + **client secret de Google OAuth**.
- `assets/js/config.js` → clave `anon` del VPS en claro (menos grave, pero confirma el patrón).
- La clave `service_role` del repo **funciona contra el VPS** (HTTP 200). La clave de Cloud del `.env` devuelve `401 JWSInvalidSignature`.

**`service_role` ignora RLS por completo.** Quien tenga esa clave tiene la base entera: lectura, escritura, borrado. Estuvo pública. Hay que asumir **compromiso total**.

### 3.2 Datos personales y secretos legibles con la clave pública

Con `anon` y sin autenticarse, se pudo leer:

| Tabla | Qué se expuso |
| :--- | :--- |
| `jjp_email_accounts` | **`oauth_refresh`** de `picoj386@gmail.com` y `jjventasadriana8@gmail.com` → permite enviar correo como esas cuentas |
| `jjp_settings` | **7 API keys de Gemini** |
| `jjp_products` | **`cost_usd`** → margen y estructura de costos del negocio |
| `jjp_profiles` | Nómina completa del personal |
| `jjp_server_control` | Estado interno del servidor |

### 3.3 Registro abierto y escalada a administrador

1. `POST /auth/v1/signup` está **abierto**: cualquiera se crea una cuenta.
2. El registro crea automáticamente un perfil **`vendedor` activo**.
3. Ese usuario recién creado puede ejecutar `PATCH jjp_profiles {role:"admin"}` y **la base lo acepta**.

**Causa raíz:** la política `jjp_profiles_upd_own` en `sql/2026-07-13-rebuild-base-schema.sql` (≈ líneas 383-387) permite al usuario actualizar **su propia fila completa**, incluyendo `role` y `active`. No hay separación entre "campos que el usuario puede editar" (nombre, teléfono) y "campos de autorización" (`role`, `active`).

**Resultado:** cualquier persona con internet puede convertirse en administrador del sistema en tres peticiones HTTP.

### 3.4 Bypass de administrador en el frontend

`assets/js/admin/auth.js` decide quién es admin con **coincidencias de subcadena de correo y correos hardcodeados**. Además, `requireAuth` **no valida expiración ni firma del token**.

Consecuencia: el control de acceso real es **cosmético**. La única barrera efectiva es RLS, y RLS está rota (§3.3) y bypasseable (§3.1).

### 3.5 Brecha en el servidor de autenticación propio (`jj-auth`)

| Endpoint | Resultado observado |
| :--- | :--- |
| `/auth/v1/settings` | **404** (contrato incompatible con el cliente Supabase JS) |
| `/auth/v1/user` | **401** |
| `DELETE /auth/v1/user` | **404** → **no se puede borrar una cuenta desde la API** |
| Rate limiting | **Inexistente**: 8 intentos de login fallidos, ningún 429 |
| `/auth/v1/authorize` | Usa `access_type=online&prompt=select_account` → **nunca emite refresh token** |

Ese último punto explica por qué las cuentas de Gmail se "desvinculan" solas: sin `access_type=offline` y `prompt=consent`, Google no entrega `refresh_token` permanente. El documento del 22-10 afirma que esto se corrigió en el VPS; **el endpoint en vivo sigue devolviendo los parámetros viejos**.

---

## 4. Split-Brain: el Sistema Tiene Dos Cerebros

### 4.1 Frontend → VPS
`assets/js/config.js` apunta los **tres** clientes al VPS. Además:
- `autoRefreshToken: false` → el token expira y no se renueva.
- `getAuthToken()` **cae a la clave `anon`** si no hay token. Es decir, ante un problema de sesión el sistema **degrada a acceso anónimo** en lugar de fallar, lo que produce listas vacías silenciosas en vez de un error claro.

### 4.2 `wa-server` → Supabase Cloud
- `wa-server/.env` sigue apuntando Core/Comm/Inv y los poolers a **Supabase Cloud**.
- `wa-server/src/supabase.js`: `db` = Cloud Comm, `dbCore` = Cloud Core.
- `wa-server/src/config.js`:
  - `IS_STALE_CORE` cambia la URL al VPS **pero conserva la service key de Cloud** → combinación inválida por diseño.
  - Contraseña de base de datos **hardcodeada**.
  - `PG_COMM` apunta a la base `postgres` (colisión de nombres entre proyectos).

**Consecuencia:** el frontend escribe en el VPS; el servidor de WhatsApp, campañas, correo y sincronización MixNet escribe en la nube. Los pedidos creados en la web **no los ve** el motor de campañas, y viceversa. Cualquier "dato que no aparece" tiene aquí su explicación.

### 4.3 Documentación que contradice la realidad
`cerebro/Sesiones/2026-10-22-solucion-integral-vps-mixnet.md` declara el sistema **"Verificado al 100%"**. La verificación en vivo contradice ese estado en: OAuth offline, endpoints de auth, esquema del VPS y permisos. **La documentación se escribió antes de verificar, o se verificó contra supuestos.** Esto es tan peligroso como el bug: produce falsa confianza.

---

## 5. Deriva de Esquema (Schema Drift)

El VPS tiene **53 tablas**, pero le faltan objetos que el código invoca. No es un problema de datos: es un problema de **contratos**.

### 5.1 Objetos inexistentes en el VPS

`jjp_catalog_flat` (vista materializada), `jjp_pos_scans`, `jjp_clients`, `jjp_next_doc_serial`, `jjp_delete_order`, `jjp_delete_email_campaign`, `jjp_wa_delete_chat`, `jjp_wa_purge_chats`, `jjp_email_request_attachments`.

### 5.2 Columnas faltantes

| Tabla | Faltan |
| :--- | :--- |
| `jjp_server_control` | `command`, `command_res`, `command_at`, `host`, `status`, `started_at` |
| `jjp_wa_campaigns` | `scheduled_at`, `next_send_at`, `pause_reason`, `pause_until` |
| `jjp_emails` | `customer_id` |
| `jjp_orders` | `order_num`, `total` |
| `jjp_customers` | `active` |

### 5.3 Impacto real
- Sin `jjp_catalog_flat` → el catálogo público no puede priorizar productos con foto (la lógica de `_hasPhoto` del 05-10 depende de esa vista).
- Sin columnas de pausa en `jjp_wa_campaigns` → el temporizador anti-baneo en vivo **no persiste**; tras un reinicio se pierde el ritmo y se puede disparar una ráfaga.
- Sin `command*` en `jjp_server_control` → `lan-daemon` hace `PATCH` contra columnas que no existen: **falla silenciosa**, el comando remoto nunca llega.
- Sin `jjp_next_doc_serial` → los correlativos vuelven a generarse en el cliente → riesgo de números duplicados o saltos.

---

## 6. Riesgos del Puente MixNet / DBF

- `lan-daemon/daemon.js` escribe DBF en **todas las carpetas que detecta**. Sin control de destino, puede escribir en una copia de pruebas o en una carpeta equivocada.
- Los `PATCH` a columnas inexistentes (§5.2) hacen que el daemon **crea que ejecutó** una orden cuando la base la rechazó.
- Persiste el riesgo histórico documentado en `JJP_Resumen_Errores.md`: sobrescritura de `NUMPED` sin filas `MXRENPED` → **pedidos vacíos**. Es el mismo patrón: cabecera sin renglones.
- Regla vigente que **debe** mantenerse: **prohibida la escritura binaria directa en `.DBF` de producción sin recompilar `.NTX`** (ver AGENTS.md, protocolo MixNet). El canal seguro es el buzón CSV/TXT.

---

## 7. Estado Real de los Datos (buena noticia)

El VPS **no perdió datos**. Medición en vivo:

| Métrica | Valor |
| :--- | :--- |
| Tamaño de base de datos | **28 MB** |
| Tuplas muertas | 193 (insignificante) |
| RAM | 15.6% |
| Disco | 8.1% |
| `jjp_products` | 2,406 |
| `jjp_customers` | 6,552 |
| `jjp_orders` | 1,297 |
| `jjp_quotes` | 712 |
| `jjp_profiles` | 13 |
| `jjp_stock_moves` | 7,934 |

**La infraestructura está sana.** El problema es de configuración, permisos y contratos. Eso es reparable sin migrar nada de nuevo.

---

## 8. Mapa Síntoma → Causa

| Síntoma que reportó el usuario | Causa real |
| :--- | :--- |
| "El monitor siempre decía que había espacio" | Nunca midió egress; error → `0%` verde; UI hardcodeada |
| "Se cayó todo de golpe" | Egress agotado → proyecto restringido |
| "No podía entrar / me sacaba" | Auth en el mismo proyecto caído + `autoRefreshToken:false` + fallback a `anon` |
| "La migración al VPS salió mal" | Split-brain frontend/VPS vs `wa-server`/Cloud + deriva de esquema |
| "Datos que no aparecen" | Escritura en dos bases distintas; RLS devolviendo `[]` silencioso |
| "Campañas se descontrolan tras reiniciar" | Columnas `pause_*` / `next_send_at` inexistentes en el VPS |
| "Comandos remotos no hacen nada" | `PATCH` a columnas inexistentes en `jjp_server_control` |
| "Se desvinculan las cuentas de Gmail" | `access_type=online` → sin refresh token |

---

## 9. Plan de Remediación

### P0 — Seguridad (antes de cualquier otra cosa)

1. **Poner el repositorio en privado** y **purgar el historial de Git** (las claves están en commits antiguos; borrarlas del HEAD no basta).
2. **Rotar todas las credenciales expuestas**: `service_role` (VPS y Cloud), `anon`, 7 API keys de Gemini, client secret de Google OAuth, contraseña de PostgreSQL.
3. **Revocar los `oauth_refresh` filtrados** de `picoj386@gmail.com` y `jjventasadriana8@gmail.com` y reautorizar.
4. **Cerrar el registro abierto** (`signup` deshabilitado o con invitación).
5. **Corregir `jjp_profiles_upd_own`**: el usuario solo puede editar campos no privilegiados. `role` y `active` pasan a una función `SECURITY DEFINER` exclusiva de admin.
6. **Revocar `SELECT` de `anon`** sobre `jjp_email_accounts`, `jjp_settings`, `jjp_server_control`, y quitar `cost_usd` de las proyecciones públicas.
7. **Rate limiting** en `/auth/v1/*` y **validación real de token** (firma + expiración) en `requireAuth`.

### P1 — Coherencia funcional

8. `sql/P1_ALINEACION_ESQUEMA.sql`: crear los 9 objetos y las columnas faltantes (§5).
9. **Un solo destino de datos**: decidir si el VPS es la única fuente y migrar `wa-server/.env` + `src/config.js` + `src/supabase.js` al VPS, **o** volver todo a Cloud. Lo que no se puede sostener es el estado actual.
10. Eliminar el fallback a `anon` en `getAuthToken()`; activar `autoRefreshToken`.
11. Corregir `access_type=offline&prompt=consent` en `auth-server.mjs` e implementar `GET/DELETE /auth/v1/user` y `/auth/v1/settings`.
12. Reemplazar el bypass de admin del frontend por verificación contra el perfil del servidor.

### P2 — Observabilidad honesta

13. Medir **egress** (y latencia, y tasa de error), no solo DB y Storage.
14. Estado `UNKNOWN` explícito: **nunca** un valor por defecto que parezca sano.
15. Eliminar todos los datos hardcodeados de `monitor-client.js`.
16. Backups que **verifiquen** la existencia y el tamaño del archivo antes de reportar éxito.
17. Alertas por umbral (egress 70/85/95%) con notificación real, no solo color en pantalla.

---

## 10. Acciones Ejecutadas en Esta Sesión

| Acción | Estado |
| :--- | :--- |
| `git pull` de `main` (`37a7770` → `dd3fc41`, 181 archivos, fast-forward, limpio) | ✅ |
| Auditoría de docs, config, frontend, backend, SQL, agentes y endpoints del VPS | ✅ |
| Pruebas controladas de seguridad con clave pública | ✅ |
| Cuenta de prueba `x@example.com` creada para demostrar el registro abierto | ✅ creada |
| Esa cuenta elevada temporalmente a `admin` para probar la escalada | ✅ probado y **revertido** a `vendedor` |
| Cuenta de prueba desactivada (`active:false`) | ✅ |
| **Borrado definitivo de la cuenta de prueba** | ❌ **imposible**: `DELETE /auth/v1/user` devuelve 404 |
| Cambios en producción | ❌ ninguno (no autorizado) |

### Deuda pendiente inmediata
- Perfil `b46ed4fe-add9-456c-98fd-52280d458ff9` (`x@example.com`) sigue existiendo, inactivo.
- Su registro en `jj-auth` también. **Debe borrarse por SQL directo** en el VPS, ya que la API no lo permite.
- Mientras exista el registro abierto, cualquiera puede repetir la prueba.

---

## 11. Bloqueos para Continuar

1. **Autorización explícita** para tocar el VPS (SQL, Nginx, systemd, PostgREST).
2. **Acceso a los archivos no versionados**: `auth-server.mjs`, configuración de PostgREST, Nginx y unidades systemd. Sin ellos no se puede corregir el contrato de auth ni el rate limiting.
3. **Decisión de negocio**: ¿el VPS es la fuente única de verdad? Todo el P1 depende de esa respuesta.

---

## 12. Regla para el Futuro (para AGENTS.md)

> **Ningún documento de sesión puede declarar "verificado al 100%" sin incluir la salida cruda de la verificación** (código HTTP, filas devueltas, timestamp). Una afirmación sin evidencia es una hipótesis, no un estado.

> **Ninguna credencial en el repositorio, ni siquiera en un repo privado.** Las claves viven en variables de entorno del servidor.

> **Un monitor debe poder decir "no sé".** Si no puede medir, reporta `UNKNOWN` y alerta; jamás un valor por defecto tranquilizador.
