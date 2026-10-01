# 🧠 Contexto Completo — JJ Paper — 30 de Septiembre 2026

> Consolidado de **8 sesiones** de la laptop + **16 commits** del día + documentación del proyecto.
> Generado por Antigravity (Opus 4.6) — 30/09/2026 20:20 VET

---

## Índice

1. [Cronología del Día](#1-cronología-del-día)
2. [Crisis: Colapso del Proyecto A por Egress](#2-crisis-colapso-del-proyecto-a-por-egress)
3. [Auditoría del Esquema Completo (3 Proyectos Supabase)](#3-auditoría-del-esquema-completo)
4. [Migración al Nuevo Proyecto A Core](#4-migración-al-nuevo-proyecto-a-core)
5. [Optimizaciones Críticas Aplicadas](#5-optimizaciones-críticas-aplicadas)
6. [Trabajo de la Sesión Principal (25f08613)](#6-trabajo-de-la-sesión-principal)
7. [Estado Actual del Sistema](#7-estado-actual-del-sistema)
8. [Tareas Pendientes](#8-tareas-pendientes)

---

## 1. Cronología del Día

### Sesión de Diagnóstico (9:02 AM – 9:22 AM) — Sesión `97241682`
**Problema**: El Proyecto A de Supabase (`qxgdrfkobbhdzgtoiavv`) colapsó por exceder su cuota de egress (7.38 / 5 GB = **148%**) con apenas **1 usuario activo** en menos de 30 días. El Log Ingestion alcanzó 15.3 / 1 GB (**1,530%**).

El usuario solicitó:
- Auditoría total de los últimos 2.5-3 meses de desarrollo
- Identificar fugas de egress
- Plan maestro de estabilización

**Resultado**: Se desplegaron 6 subagentes especializados en paralelo:

| Subagente | Misión | Duración |
|---|---|---|
| `cb166cfd` | Leer todas las bitácoras del cerebro | ~5 min |
| `28e51183` | Auditar 75 JS + 45 HTML del frontend | ~10 min |
| `ad984b25` | Esquema completo de los 3 proyectos Supabase | ~14 min |
| `035ec084` | Optimizar egress en `wa-server` | ~2 min |
| `39949c3f` | Crear API HTTP local (`api-local.js`) | ~1 min |
| `46244d74` | Aumentar TTL de cachés frontend | ~1 min |

### Sesión Principal (9:26 AM – 4:13 PM) — Sesión `25f08613`
Sesión extensa (3,199 pasos) que cubrió:
1. Migración completa a nuevo Proyecto A
2. Reparación de bugs de modales
3. Conexión remota con PC Supervisor
4. Solución de productos "faltantes" en campañas
5. Redacción comercial con IA
6. Sincronización MixNet mejorada
7. Commits y deploy

### Commits del día (16 en total, 103 archivos, +1,964 / -496 líneas)

| Hora | Commit | Descripción |
|---|---|---|
| 10:14 | `2ff675f` | Migrar a nuevo Supabase Core, minimizar egress, dirty-check mixer 24h |
| 10:29 | `9b116ac` | Cache-busting universal en config.js, eliminar hangs UNC, actualizar monitor |
| 10:38 | `17882b0` | Modernizar mutex check con netstat |
| 10:43 | `cb695b3` | Protocolo maestro de activación del servidor en PC Supervisor |
| 11:17 | `2299750` | Restaurar claves foráneas en BD, corregir audiencia y pedidos, auto-sanar .env |
| 11:48 | `d08ef99` | Alinear formato estricto 8 dígitos nativo MixNet sin prefijos |
| 11:56 | `98eb446` | Eliminar etiquetas artificiales de notas y comentarios |
| 12:13 | `21fbacb` | Alinear código real 005 en MixNet para Keyder Salazar |
| 14:29 | `ebfd0f0` | Precios IA: alineación oficial Mayorista B, sincronización MixNet dual-bus |
| 14:45 | `bb8e7d9` | Fix syntax gemini-client; feat: two-way Gmail sync, anti-fatigue, quote-reply |
| 14:53 | `502e084` | Fix: habilitar scroll vertical en modales |
| 14:59 | `f0ce912` | Fix: campaign-editor, eliminar div redundante |
| 15:08 | `7ee8b68` | Fix: modal sizing, smooth scrolling, wheel bridge, cache-busting |
| 15:41 | `9ffe44f` | Feat: remote supervisor configurator, Tailscale guide, product search |
| 16:12 | `716c70f` | Fix: eliminar overflow en modales, restaurar scroll natural |

---

## 2. Crisis: Colapso del Proyecto A por Egress

### Métricas del Dashboard del Proyecto A Saturado (`qxgdrfkobbhdzgtoiavv`)
| Métrica | Uso | Cuota | % |
|---|---|---|---|
| **Egress** | 7.38 GB | 5 GB | **148%** 🔴 |
| **Database size** | 50 MB | 500 MB | 10% ✅ |
| **Monthly active users** | 2 | 50,000 | 0% ✅ |
| **File storage** | 0.01 GB | 1 GB | 1% ✅ |
| **Log Ingestion** | 15.3 GB | 1 GB | **1,530%** 🔴 |

### Las 7 Fugas de Egress Identificadas

1. **Bucle Asesino de MixNet (`mixer.js`)**: `sweepMixnetProducts()` leía el DBF cada 5 min → 1,800 UPDATEs cada 5 min = **518,400 queries/día = 15M operaciones/mes**
2. **Heartbeat Dual**: `heartbeat.js` escribía payload JSON c/30s tanto en Proyecto B como Proyecto A (~170 MB/mes)
3. **Caché Efímero**: Clientes (5,606) y catálogo se recargaban cada 3-7 min con `SELECT *`
4. **10 Upserts Individuales de Tasas**: `rates.js` ejecutaba 10 escrituras separadas cada hora
5. **`SELECT *` en 24 ocurrencias**: Descargaba columnas innecesarias (notas, direcciones, JSON, base64)
6. **Canal Realtime Zombie**: `correo.js` usaba prefix `mail-ui-` que no coincidía con reglas de enrutamiento → socket abierto en Proyecto A inútilmente
7. **Avalancha de Firmas de Storage**: `orders.js` firmaba URLs para todos los comprobantes al abrir la página
8. **Polling + Realtime Redundante**: `server-control.js` sondeaba cada 20s Y tenía canal WebSocket simultáneo

---

## 3. Auditoría del Esquema Completo

### Proyecto A — Core (Saturado → Migrado)
- **Ref ID**: `qxgdrfkobbhdzgtoiavv` → **Migrado a** `wwcdxqpibequfohbgejs`
- **43 tablas** (incluidas 14 residuales de comunicación que no deberían estar)
- **38 RPCs** / **83 políticas RLS** / **9 vistas SQL**
- **Tabla más pesada**: `jjp_customers` (5,606 filas, 3.78 MB)
- **Residuos**: `jjp_emails` (223 filas, 2.5 MB), `jjp_wa_messages` (141 filas), `jjp_wa_chats` (25 filas) — todas tablas que deberían estar solo en Proyecto B
- **Bucket duplicado**: `jjp-products` (295 WebP, 5.33 MB) — ya existe en Proyecto C

### Proyecto B — Comunicación (`klcibjwleiqppedefpxw`)
- **14 tablas** | BD: 83 MB
- **Tabla más pesada**: `jjp_emails` (2,160 filas, **60 MB = 70% de toda la BD**)
  - 174 correos con PDFs embebidos en Base64 dentro de JSONB `attachments` = **45.68 MB de bloat**
- **Storage**: `jjp-wa-media` (163 archivos, 33.8 MB) + `jjp-email-media` (16 archivos, 4 MB)
- **Bug crítico**: Solo 2 de 11 perfiles existen en Comm (`jjp_profiles`). Si otros vendedores intentan usar WhatsApp/correo → falla FK

### Proyecto C — Storage (`nmcamjxhyysmmvgxgabo`)
- **Función exclusiva**: CDN de imágenes y comprobantes
- `jjp-products`: 295 archivos WebP, 5.59 MB
- `jjp-receipts`: vacío

---

## 4. Migración al Nuevo Proyecto A Core

### Nuevo Proyecto A (`wwcdxqpibequfohbgejs`)
- **Región**: `ca-central-1` (PostgreSQL 17.6)
- **Pooler**: `aws-0-ca-central-1.pooler.supabase.com:6543`

### Datos Migrados (verificados al 100%)
| Tabla | Registros |
|---|---|
| `auth.users` / `auth.identities` | 11 |
| `jjp_profiles` | 11 |
| `jjp_customers` | 5,606 |
| `jjp_prospects` | 705 |
| `jjp_products` | 1,824 |
| `jjp_product_variants` | 1,823 |
| `jjp_orders` | 687 |
| `jjp_quotes` | 535 |
| `jjp_stock_moves` | 2,862 |
| `jjp_count_tally` | 539 |
| `jjp_fx_rates` | 594 |
| `jjp_settings` | 57 |
| `jjp_categories` + `jjp_brands` | 60 |
| `jjp_control_seq` | 1 (correlativo 148441) |
| RPCs y funciones | 54 |
| Vistas SQL | 9 |
| Políticas RLS | 56 |

### Archivos Actualizados con Nuevo Core
- [config.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/config.js) — URL y Anon Key del nuevo proyecto
- [wa-server/.env](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/.env) — credenciales Service Role
- [_headers](file:///C:/Users/PC/Desktop/JJ%20PAPER/_headers) — CSP actualizado + cache-control para config.js
- [wa-server/src/supabase.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/supabase.js) — reconectado a nuevo pooler
- [wa-server/src/monitor.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/monitor.js) — nuevo ref

---

## 5. Optimizaciones Críticas Aplicadas

### Backend (`wa-server/src/`)

| Archivo | Cambio | Impacto |
|---|---|---|
| [mixer.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixer.js) | Barrido catálogo de 5 min → **24h**; Dirty Check con huella determinista | De 518K queries/día → **~50 queries/día** |
| [heartbeat.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/heartbeat.js) | Eliminado dual write a Core; intervalo 30s → **60s**; eliminado `monitor_stats`/`fetchStatsForBeat()` | -170 MB/mes egress |
| [rates.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/rates.js) | 10 upserts individuales → **1 batch upsert** | -90% peticiones HTTP |
| [auto-detect-mixnet.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/auto-detect-mixnet.js) | `safeExistsSync` en lugar de sondeos UNC bloqueantes | Arranque de 50s → 250ms |
| [count-lan.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/count-lan.js) | `no-cache` en JS servidos por LAN | Previene config.js obsoleto |
| **Nuevo**: [api-local.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/api-local.js) | API HTTP local con caché RAM (clientes/10min, productos/30min, settings/60min) | Frontend puede leer sin Supabase |

### Frontend (`assets/js/`)

| Archivo | Cambio |
|---|---|
| [vcustomers.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vcustomers.js) | TTL caché 7 min → **60 min** |
| [aclients.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/aclients.js) | TTL caché 7 min → **60 min** |
| [product-finder.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/product-finder.js) | TTL caché 5 min → **60 min** |
| [catalog.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/catalog.js) | TTL caché 3 min → **60 min** |
| [vdifusion.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vdifusion.js) | `SELECT *` → 10 columnas específicas |
| [vcampanas-email.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vcampanas-email.js) | `SELECT *` → 10 columnas específicas |
| [server-control.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/server-control.js) | `SELECT *` → 7 columnas; polling 20s → **120s** |
| [correo.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/correo.js) | Canal `mail-ui-` → **`email-ui-`** (fix enrutamiento Realtime) |
| [product-picker.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/product-picker.js) | Búsqueda en vivo sin límite de 300 productos |
| 54 archivos HTML | Cache-busting `?v=20260930_core` en config.js y scripts afectados |

---

## 6. Trabajo de la Sesión Principal (25f08613)

La sesión de 7 horas cubrió las siguientes fases:

### Fase 1: Contexto y Migración (~9:26 AM – 11:00 AM)
- Recuperó contexto de la sesión anterior (diagnóstico de egress)
- Ejecutó la migración completa a `wwcdxqpibequfohbgejs`
- Actualizó credenciales en config.js, wa-server/.env, _headers, supabase.js
- Verificó integridad de datos al 100%
- Resolvió el error `exceed_egress_quota` con cache-busting universal

### Fase 2: Reparación de FK y MixNet (~11:00 AM – 12:13 PM)
- Restauró claves foráneas en la nueva BD
- Corrigió consultas de audiencia y pedidos
- Auto-saneó .env en la PC Supervisor
- Alineó formato estricto de 8 dígitos nativo MixNet (sin prefijos `COT-`, `PED-`, `JJP-`)
- Eliminó etiquetas artificiales `[MixNet` en comentarios
- Alineó código real `005` en MixNet para Keyder Salazar como admin

### Fase 3: Campañas, MixNet y Negocio (~12:13 PM – 2:29 PM)
- **Reconstrucción del Editor de Campañas** ([campaign-editor.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/campaign-editor.js)):
  - `onAudienceChange` reescrito: Filtros rápidos B2B, clientes activos, inactivos
  - Cooldown inteligente: excluye targets contactados en <30 días (discrimina WA vs Email, rebotes duros/suaves)
  - Badges visuales con conteos de audiencia
- **Alineación de vendedores MixNet** ([mixer.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixer.js)):
  - Zonas `010` y `020` re-mapeadas directamente a vendedor `005` (Keyder Salazar)
  - Regla: `codven 010/020` son carteras artificiales de JJ Paper, no vendedores reales de MixNet
- Alineación oficial de precios Mayorista B
- Sincronización MixNet dual-bus
- Renovación del redactor comercial IA con plantillas por sector
- Búsqueda en vivo de productos en campañas (eliminado límite de 300 items)

### Fase 4: Gmail, Correo y Gemini (~2:29 PM – 2:45 PM)
- **Sincronización Forzada Gmail** (end-to-end):
  - Función `pollInboundNow` implementada en [correo.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/correo.js)
  - Comunicación vía `jjp_server_control` → [email.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/email.js) detecta el comando y ejecuta sync
  - Botón "Forzar Sincronización" en la UI de correo
- Cooldown anti-fatiga en campañas
- Vinculación de respuestas a cotizaciones (quote-reply linking)
- Fix en [gemini-client.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/gemini-client.js): prompt ajustado para que el LLM no envuelva JSON en bloques Markdown

### Fase 5: Modales, UX y Acceso Remoto (~2:45 PM – 4:12 PM)
- Fix de scroll vertical en modales (pantallas <650px):
  - `align-items: flex-start` + `margin: auto 0` en overlay
  - `max-height: calc(100vh - 40px)` en modal-box
  - Padding inferior 36px en `.modal-body` para botones de acción
- Wheel event bridge en [sidenav.js](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/sidenav.js) (`initModalScrollBridge`)
- Configurador automático de acceso remoto para PC Supervisor
- Guía de Tailscale + búsqueda en vivo de productos desde remoto

### Diagnóstico de MixNet (Índices .NTX Corruptos)
- **Problema reportado**: MixNet no mostraba cotizaciones posteriores al 24/09
- **Diagnóstico**: Los registros **sí existen** tanto en los DBF como en Supabase (verificado por comparación cruzada del 28/09 al 30/09)
- **Causa raíz**: Índices Clipper/FoxPro `.NTX` (`MXRECZX1.NTX`) corrompidos o desincronizados
- **Solución instruida**: Ejecutar `Mantenimiento → Reindexar Archivos` en MixNet nativo

### Transferencia de Servidor: Laptop → PC Supervisor
- **Acción**: `wa-server` fue **detenido intencionalmente** en la laptop (PID 36168 killed)
- **Limpieza**: Eliminado acceso directo de auto-arranque en `Startup` de la laptop
- **Preparación**: Instrucciones documentadas en [cerebro/Sesiones/2026-09-30.md](file:///C:/Users/PC/Desktop/JJ%20PAPER/cerebro/Sesiones/2026-09-30.md) para arrancar en la PC Supervisor con `start-hidden.vbs`
- **Config .env**: `MIXER_EXPORT_DIR=M:/comp01` fijado para la ruta real del Supervisor

### Conexión Remota con PC Supervisor
- **Red Tailscale activa**: Laptop `100.67.139.121` ↔ Supervisor `100.103.110.44`
- **Puerto 8787 funcionando**: API LAN respondiendo (MixNet status, pedidos, productos, sync-now)
- **AnyDesk configurado** para control GUI
- **Script de configuración**: [CONFIGURAR-ACCESO-REMOTO-SUPERVISOR.bat](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/CONFIGURAR-ACCESO-REMOTO-SUPERVISOR.bat) + [configurar-remoto.ps1](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/configurar-remoto.ps1)

---

## 7. Estado Actual del Sistema

### Topología Multi-Proyecto

```
┌──────────────────────────────────────────────────────────┐
│ PROYECTO A — Core Nuevo (wwcdxqpibequfohbgejs)           │
│ • Auth & Profiles (11 usuarios/perfiles)                 │
│ • Clientes (5,606) & Prospectos B2B (705)                │
│ • Catálogo (1,824 productos, 1,823 variantes)            │
│ • Pedidos (687) y Cotizaciones (535)                     │
│ • Inventario: Kardex (2,862), Conteo (539)               │
│ • Configuración (57 settings, 594 tasas históricas)      │
│ • 54 RPCs, 9 vistas, 56 políticas RLS                   │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ PROYECTO B — Comunicación (klcibjwleiqppedefpxw)         │
│ • WhatsApp CRM: chats (236), mensajes (818), sesiones    │
│ • Email: correos (2,160 — 60 MB con PDF inline!)         │
│ • Campañas: WA (1) + Email (11) + targets (2,424)        │
│ • Server Control & Heartbeat                             │
│ ⚠️ Solo 2/11 perfiles sinc (Keyder + Adriana)            │
│ ⚠️ Bloat de 45 MB en PDF base64 inline                   │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ PROYECTO C — Storage CDN (nmcamjxhyysmmvgxgabo)          │
│ • jjp-products: 295 WebP, 5.59 MB                       │
│ • jjp-receipts: vacío                                    │
└──────────────────────────────────────────────────────────┘
```

### Vendedores Activos

| Vendedor | Rol | Zonas | Clientes | MixNet `codven` |
|---|---|---|---|---|
| Keyder Salazar | `admin` | 010, 020 | 3,665 | `010`, `020` |
| Yovanni Araujo | `vendedor` | 004, 006 | 554 | `004`, `006` |
| Andreina | `vendedor` | 014 | 540 | `014` |
| Marianela | `vendedor` | 008 | 494 | `008` |
| Luis Alarcón | mostrador/caja | N/A | Variable | `002` |
| Jose | mostrador físico | N/A | Mostrador | `005` |

### wa-server (PC Supervisor)
- **Método de arranque**: `start-hidden.vbs` → `run-service.bat` (invisible, auto-reinicio)
- **Mutex**: Puerto `127.0.0.1:8786` previene doble instancia
- **Puertos activos**: 8787 (HTTP) + 8788 (HTTPS SSL autofirmado)
- **MixNet**: Directorio `P:\Elias\MIX\MIX11\comp01`, barridos continuos con dirty-check
- **Heartbeat**: Cada 60s solo a Proyecto B
- **Tasas BCV**: Batch upsert unificado cada hora

---

## 8. Tareas Pendientes

### Alta Prioridad 🔴
1. **Sincronizar perfiles en Proyecto B**: Solo 2/11 vendedores existen en `jjp_profiles` de Comm. Los otros 9 no pueden usar WhatsApp/Email → insertar los 9 perfiles faltantes
2. **Limpiar PDF base64 inline de `jjp_emails`**: 45.68 MB de bloat (174 correos con PDFs embebidos). Migrar adjuntos a Storage → punteros en JSONB
3. **Eliminar bucket `jjp-products` redundante en Proyecto A**: 5.33 MB duplicados (ya están en Proyecto C)
4. **Publicar `jjp_orders` en Realtime (Proyecto A)**: Actualmente no está en `supabase_realtime` → mixer.js depende de polling
5. **Limpiar tablas residuales de comunicación en Core**: 14 tablas de WA/Email que no deberían estar en el nuevo Proyecto A

### Media Prioridad 🟡
6. **Integrar `api-local.js` en `count-lan.js`**: El módulo está listo pero no importado
7. **Fix bug caché `catalog.js` L180**: Guarda `data` (último chunk) en vez de `allData` (catálogo completo)
8. **Lazy loading de comprobantes en `orders.js`**: Firmar URLs solo al hacer clic, no al cargar la tabla
9. **Cargar ofertas de octubre en `jjp_promos`**: Tabla vacía, esperando lista de 15+ productos del usuario
10. **Renovar OAuth Gmail**: Tokens de `ventasjjmarianela014@gmail.com` y `araujoyovanni9@gmail.com` expirados

### Baja Prioridad 🟢
11. **Reemplazar polling por Realtime**: `server-control.js` (redundancia polling+WS) y `monitor-client.js` (8 peticiones c/5-30s)
12. **Column pruning adicional**: `orders.js`, `sellers.js`, `count-control.js`, `wa-chat.js`, `wa-link.js` aún usan `SELECT *`
13. **Purgar historial de `jjp_fx_rates`**: 594 registros acumulados
14. **Depurar perfiles inactivos en Core**: Zonas 1000+ sin actividad
15. **Retención de WhatsApp media**: `jjp-wa-media` tiene archivos >15 días (debería ser TTL 5 días)
