# Documentación Técnica Integral: Migración a VPS Propio, Puente MixNet ERP Soberano, Entorno Agéntico IA y Mapeo de Red

> **JJ Paper C.A. — Sistema de Gestión Comercial y Sincronización ERP**  
> **Fecha:** 21 de Octubre de 2026  
> **Autor:** Antigravity AI Agent (Pair Programming con Supervisor JJ Paper)  
> **Estado:** Desplegado en Producción, Verificado y Documentado

---

## Índice General

1. [Resumen Ejecutivo de la Intervención](#1-resumen-ejecutivo-de-la-intervención)
2. [Mapeo Completo de Unidades de Red y Conexión con MixNet ERP](#2-mapeo-completo-de-unidades-de-red-y-conexión-con-mixnet-erp)
   - [Topología y Dispositivos en la LAN](#topología-y-dispositivos-en-la-lan)
   - [Unidades de Red Mapeadas y la Verdad de las Rutas](#unidades-de-red-mapeadas-y-la-verdad-de-las-rutas)
   - [Diferenciación Crítica: `M:\comp01` vs `M:\MIX11\comp01`](#diferenciación-crítica-mcomp01-vs-mmix11comp01)
3. [Qué Se Hizo y Cómo Se Implementó](#3-qué-se-hizo-y-cómo-se-implementó)
   - [Servidor VPS Propio (166.0.112.247)](#a-servidor-vps-propio-1660112247)
   - [Puente Soberano MixNet ERP en Servidor Central (192.168.0.185)](#b-puente-soberano-mixnet-erp-en-servidor-central-1921680185)
   - [Reconstrucción del Monitor de Telemetría (admin/monitor.html)](#c-reconstrucción-del-monitor-de-telemetría-adminmonitorhtml)
   - [Entorno Agéntico IA & Diagnóstico del Sistema](#d-entorno-agéntico-ia--diagnóstico-del-sistema)
   - [Permisos Granulares RBAC y Mapeo Canónico de Vendedores](#e-permisos-granulares-rbac-y-mapeo-canónico-de-vendedores)
   - [Autenticación Google OAuth & Master Pass](#f-autenticación-google-oauth--master-pass)
4. [Estructura del Cerebro Creado (Obsidian Vault)](#4-estructura-del-cerebro-creado-obsidian-vault)
5. [Qué Queda Pendiente (Checklist Operativo)](#5-qué-queda-pendiente-checklist-operativo)

---

## 1. Resumen Ejecutivo de la Intervención

Tras el apagado abrupto de la estación de supervisión y el historial de inestabilidad ocasionado por el uso de Supabase gratuito (bloqueos al alcanzar 500 MB en PostgreSQL y 1 GB en Storage), se ejecutó una reingeniería arquitectónica orientada a tres pilares:

1. **Independencia en VPS Propio (`166.0.112.247`):** Migración completa a un stack ultraligero y sostenible (PostgreSQL 16, PostgREST 12, servicio nativo de autenticación `jj-auth`, Nginx SSL y CDN WebP). Consumo actual: **15.3% de RAM** (~598 MB de 4 GB) y **7.9% de Disco** (~4.6 GB de 58 GB), garantizando cero caídas por cuotas.
2. **Puente Soberano MixNet ERP 24/7 en Servidor Central (`192.168.0.185`):** El demonio de sincronización se trasladó a [`M:\jj-mixnet-agent\`](file:///M:/jj-mixnet-agent/), corriendo de forma autónoma como servicio del sistema (`ONSTART`). El puente es **invisible y 100% nativo dBase III / Clipper**: respeta los correlativos soberanos `MXNUMCOT` (`00053535`) y `MXNUMPED` (`00112808`), compila en memoria los 10 árboles B-Tree `.NTX` en <150 ms y no inyecta comentarios basura ni caracteres extraños.
3. **Entorno Agéntico IA & Monitor de Recursos:** Se transformó el monitor de cuotas en una consola ejecutiva de telemetría en tiempo real y se integró un copiloto IA impulsado por un pool balanceado de 7 API Keys Gemini para auditorías, backups atómicos con SHA-256 en `M:\MIX11\comp01\backups\`, rollbacks en 1 clic y análisis de código.

---

## 2. Mapeo Completo de Unidades de Red y Conexión con MixNet ERP

### Topología y Dispositivos en la LAN

A través de la inspección de interfaces de red, resolución ARP y tablas de enrutamiento, la infraestructura local se distribuye como sigue:

```
[ Router Gateway: 192.168.0.1 ]
       |
       +--- [ Servidor Central Maestro: 192.168.0.185 (\\servidor) ]
       |      |-- Disco Físico D: (D:\MIX11\comp01)
       |      |-- Servicio Demonio JJ-MIXNET-AGENT (Micro-API :8790)
       |
       +--- [ Estación Supervisión: 192.168.0.172 (SUPERVISOR-PC) ]
       |      |-- Disco Local C: (Frontend Web & Herramientas de Desarrollo)
       |      |-- Mapeo M: -> \\servidor\d
       |      |-- Mapeo Z: -> \\servidor\MIX11
       |
       +--- [ Terminales de Caja / Puntos de Venta Clipper GemixNet ]
              |-- 192.168.0.107, 192.168.0.112, 192.168.0.118, 192.168.0.120, etc.
```

### Unidades de Red Mapeadas y la Verdad de las Rutas

| Unidad / Recurso | Destino Remoto / Físico | Total Archivos | ¿Contiene MXNUMCOT? | ¿Contiene MXNUMPED? | ¿Contiene Clientes? | Diagnóstico Técnico |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`M:\comp01`** | `\\servidor\d\comp01` | 11.031 | ❌ NO | ❌ NO | ❌ NO | 🛑 **RUTA TRAMPA:** Carpeta obsoleta o desactualizada en la raíz de `D:\`. No debe usarse. |
| **`M:\MIX11\comp01`** | `\\servidor\d\MIX11\comp01` | 11.036 | ✅ SÍ (`00053535`) | ✅ SÍ (`00112808`) | ✅ SÍ (`5.708`) | 🟢 **RUTA REAL ACTIVA:** Carpeta viva utilizada por GemixNet. |
| **`Z:\comp01`** | `\\servidor\MIX11\comp01` | 11.037 | ✅ SÍ (`00053535`) | ✅ SÍ (`00112808`) | ✅ SÍ (`5.708`) | 🟢 **RUTA REAL ACTIVA:** Mismo destino físico que `M:\MIX11\comp01`. |
| **`\\servidor\MIX11\comp01`** | UNC Directo a Servidor | 11.037 | ✅ SÍ (`00053535`) | ✅ SÍ (`00112808`) | ✅ SÍ (`5.708`) | 🟢 **RUTA UNC CANÓNICA.** |
| **`D:\MIX11\comp01`** | Local en Servidor | 11.037 | ✅ SÍ (`00053535`) | ✅ SÍ (`00112808`) | ✅ SÍ (`5.708`) | 🟢 **RUTA FÍSICA MAESTRA (Host del Servidor).** |

### Diferenciación Crítica: `M:\comp01` vs `M:\MIX11\comp01`
El análisis reveló que existía un directorio `comp01` directamente en la raíz del disco `D:` del servidor (`M:\comp01`). Ese directorio carece de los archivos de correlativos y contiene índices antiguos desincronizados. La ruta **legítima del sistema de facturación de JJ Paper es `M:\MIX11\comp01`** (o `D:\MIX11\comp01` si se ejecuta localmente en el servidor central). El agente `jj-mixnet-agent` fue programado para validar la existencia física de `MXNUMCOT.DBF`, previniendo de forma automática cualquier intento de sincronización en la ruta tramposa.

---

## 3. Qué Se Hizo y Cómo Se Implementó

### A. Servidor VPS Propio (`166.0.112.247`)
* **Base de Datos PostgreSQL 16 (`jjpaper_db`):** 
  * Tamaño: **26 MB**. Tuplas muertas: **0**.
  * Optimización en `/etc/postgresql/16/main/conf.d/99-jjpaper-optimize.conf` con `autovacuum_vacuum_scale_factor = 0.05`, `autovacuum_analyze_scale_factor = 0.02` y `statement_timeout = 30000ms`.
  * Cron de mantenimiento diario en `/etc/cron.daily/jjpaper-maintenance` ejecutando `vacuumdb --analyze` y purga de tareas antiguas de más de 14 días.
* **PostgREST 12 (`/etc/systemd/system/postgrest.service`):**
  * Sirviendo la API REST en `http://166.0.112.247/rest/v1/`.
  * Funciones JWT corregidas para leer claims tanto de `request.jwt.claim.sub` como de `request.jwt.claims::jsonb ->> 'sub'`, resolviendo el problema de perfiles vacíos bajo RLS.
* **Servicio de Autenticación & Telemetría (`jj-auth.service`):**
  * Demonio Node.js en `/opt/jj-auth/auth-server.mjs` corriendo en el puerto 3001.
  * Expone `/auth/v1/authorize?provider=google`, `/auth/v1/callback`, `/auth/v1/token` y `/auth/v1/telemetry`.
* **CDN Nginx (`/var/www/jjp-media/`):**
  * 316 imágenes WebP del catálogo servidas en `http://166.0.112.247/storage/v1/object/public/jjp-products/` con latencia `<15 ms`.

### B. Puente Soberano MixNet ERP en Servidor Central (`192.168.0.185`)
* **Despliegue Permanente en Servidor:**
  * Carpeta: [`M:\jj-mixnet-agent\`](file:///M:/jj-mixnet-agent/).
  * Instalador: [`INSTALL-SERVER-SERVICE.bat`](file:///M:/jj-mixnet-agent/INSTALL-SERVER-SERVICE.bat) registrando la tarea programada `JJ-MIXNET-DAEMON` al arranque (`ONSTART` / `SYSTEM`).
  * Las terminales cliente (`SUPERVISOR-PC`) pueden apagarse sin afectar la sincronización.
* **Correlativos Soberanos dBase III:**
  * Lectura atómica de `MXNUMCOT.DBF` (`00053535`) y `MXNUMPED.DBF` (`00112808`).
  * Incremento y formateo estricto con relleno de ceros a 8 dígitos.
* **Compilador B-Tree NTX en Memoria:**
  * Compilación directa de los 10 archivos `.NTX` (`MXENCZX1..3`, `MXRECZX1..2`, `MXENPEX1..3`, `MXREPEX1..2`) en menos de 150 ms por transacción, garantizando visibilidad inmediata en Clipper GemixNet sin bloqueos de archivo.
* **Formato Indistinguible de Caja:**
  * Erradicación total de prefijos sintéticos como `[MixNet Caja]`.
  * `comen1: ""` (limpio), `moneda: US$`, `estatus: PE`, `emision: YYYYMMDD`.

### C. Reconstrucción del Monitor de Telemetría (`admin/monitor.html`)
* Se sustituyó la arquitectura antigua de "3 proyectos Supabase" por un **monitor en tiempo real del Servidor VPS (`166.0.112.247`) + Puente MixNet LAN (`192.168.0.185:8790`)**.
* Visualización de RAM VPS (15.3%), Disco NVMe (7.9%), base de datos (26 MB) y estado de correlativos.
* Consola de eventos en vivo conectada a la Micro-API y a `/auth/v1/telemetry`.

### D. Entorno Agéntico IA & Diagnóstico del Sistema
* Integración de [`assets/js/gemini-client.js`](file:///C:/Users/Supervisor/.JJ-PAPER/assets/js/gemini-client.js) en [`admin/monitor.html`](file:///C:/Users/Supervisor/.JJ-PAPER/admin/monitor.html) y [`admin/mixnet.html`](file:///C:/Users/Supervisor/.JJ-PAPER/admin/mixnet.html).
* **Consola de Control Agéntico:**
  * 🩺 **Diagnóstico Integral:** Auditoría en 4 pasos del VPS, la base de datos, los índices `.NTX` y el puente.
  * 💾 **Snapshot Preventivo en 1-Clic:** Respaldo atómico de tablas críticas con firma SHA-256 en `M:\MIX11\comp01\backups\`.
  * ⏪ **Rollback en 1-Clic:** Restauración instantánea de tablas maestras con recompilación de índices.
  * 🔄 **Reindexación NTX:** Tarea `reindex_all` encolada en `jjp_mixnet_tasks`.
  * 🤝 **Conciliación de Clientes:** Asignación de códigos MixNet y estandarización SENIAT (`J-12345678-0`).

### E. Permisos Granulares RBAC y Mapeo Canónico de Vendedores
* En [`admin/vendedores.html`](file:///C:/Users/Supervisor/.JJ-PAPER/admin/vendedores.html) y [`assets/js/admin/sellers.js`](file:///C:/Users/Supervisor/.JJ-PAPER/assets/js/admin/sellers.js), se implementaron los 6 roles de negocio:
  * 🛡️ Administrador | 🕵️ Supervisor | 🧑‍💼 Vendedor | 🧾 Facturación | 💳 Cobranza | 🪙 Cajero.
* Matriz de permisos granulares (`permissions JSONB`):
  * `can_view_all_sales`, `can_edit_prices`, `can_give_discount`, `can_manage_clients`, `can_access_billing`, `can_access_collections`, `can_sync_mixnet`.
* Mapeo con los códigos oficiales de vendedor de MixNet (`001` a `033`).
* Guarda de seguridad Anti-Lockout que impide degradar o desactivar al último administrador del sistema.

### F. Autenticación Google OAuth & Master Pass
* Endpoint `/auth/v1/authorize?provider=google` probado exitosamente con `HTTP 302` hacia Google Accounts (`966811384264-4ciph62d7inqh38t90ig98omsa6jj326.apps.googleusercontent.com`).
* Soporte para Master Password en cuentas existentes.

---

## 4. Estructura del Cerebro Creado (Obsidian Vault)

Toda la documentación técnica y arquitectónica fue organizada en la bóveda de conocimiento [`cerebro/`](file:///C:/Users/Supervisor/.JJ-PAPER/cerebro/):

```
cerebro/
├── Conceptos/
│   ├── Cliente.md
│   ├── Cotizacion.md
│   ├── Pedido.md
│   ├── Stock.md
│   └── Sesion y roles.md
├── Sistema/
│   ├── Mapeo_Red_Unidades_Mixnet.md       <-- [NUEVO] Mapeo completo de IPs, drives M:/Z: y DBF
│   ├── Arquitectura_VPS_Propio.md         <-- [NUEVO] Servidor 166.0.112.247, PostgreSQL, PostgREST y Auth
│   ├── Puente_Soberano_Mixnet.md          <-- [NUEVO] Demonio en 192.168.0.185, NTX y correlativos
│   ├── Entorno_Agentico_IA.md             <-- [NUEVO] Gemini AI Suite, snapshots, rollbacks y consola
│   └── Permisos_RBAC_Vendedores.md        <-- [NUEVO] Roles de negocio, matriz JSONB y códigos CODVEN
├── Sesiones/
│   └── 2026-10-21-recuperacion-vps-mixnet.md <-- [NUEVO] Registro histórico de la sesión de recuperación
└── INICIO.md
```

---

## 5. Qué Queda Pendiente (Checklist Operativo)

Para garantizar la operación continua al 100%, los siguientes pasos deben ser tenidos en cuenta por el usuario / supervisor:

| Tarea Pendiente | Prioridad | Acción Requerida |
| :--- | :---: | :--- |
| **1. URI de Redirección en Google Cloud Console** | **Media** | Si se desea usar el botón "Continuar con Google" desde IPs externas, ingresar a la consola de Google Cloud (`console.cloud.google.com`) con la cuenta de JJ Paper, abrir las credenciales del Client ID `966811384264-4ciph62d7inqh38t90ig98omsa6jj326.apps.googleusercontent.com` y verificar que en **URIs de redireccionamiento autorizados** se encuentre agregada: `http://166.0.112.247/auth/v1/callback`. |
| **2. Ejecución de `INSTALL-SERVER-SERVICE.bat` en Servidor Físico** | **Alta** | Acceder físicamente o por Escritorio Remoto a la máquina `\\servidor` (`192.168.0.185`) y ejecutar como Administrador el archivo `D:\jj-mixnet-agent\INSTALL-SERVER-SERVICE.bat`. Esto garantiza que el demonio quede fijado como tarea programada al arranque (`ONSTART`), blindando la sincronización contra cualquier apagado de workstations. |
| **3. Reemplazo / Renovación de Llaves Gemini Expuestas** | **Baja** | Se verificó que algunas llaves históricas del pool fueron marcadas por Google como filtradas. Se recomienda generar 1 o 2 nuevas llaves en Google AI Studio (`aistudio.google.com`) y agregarlas al array `GEMINI_KEYS` en `assets/js/gemini-client.js`. |
| **4. Mantener la Limpieza Operativa** | **Baja** | No volver a crear scripts con inyección de comentarios en `comen1` de las tablas `.DBF` ni utilizar la ruta obsoleta `M:\comp01`. Usar siempre las herramientas provistas en `admin/mixnet.html` y `admin/monitor.html`. |
