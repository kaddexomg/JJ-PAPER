# Sesión del 21 de Octubre de 2026: Recuperación Crítica, Migración a VPS Propio y Puente Soberano MixNet

> **Documento del Cerebro de JJ Paper**  
> **Fecha:** 21 de Octubre de 2026  
> **Participantes:** Usuario Supervisor + Agente IA Antigravity  
> **Estado:** Consolidado y Desplegado en Producción

---

## 1. Contexto Inicial y Colapso Previo

La PC de supervisión se apagó de forma abrupta durante una sesión activa de desarrollo. El proyecto base había acumulado código redundante, parches inconsistentes y presentaba las siguientes fallas críticas:
1. **Dependencia y Saturación de Supabase:** Proyectos de nube gratuitos bloqueados frecuentemente por límites de 500 MB en PostgreSQL y 1 GB en Storage.
2. **Caída Total del Puente MixNet:** Sin precios reales actualizados, sin cotizaciones ni pedidos sincronizados con las cajas de la tienda física.
3. **Pérdida de Sesión y Credenciales:** Necesidad de recuperar credenciales reales de la versión anterior oculta de `.JJ-PAPER`.

---

## 2. Acciones Ejecutadas Durante la Sesión

### A. Recuperación de Credenciales de Carpeta Oculta
* Se inspeccionó la versión anterior oculta `C:\Users\Supervisor\.jj-paper\wa-server\.env` y scripts auxiliares.
* Se extrajeron los accesos reales al VPS (`166.0.112.247`, usuario `root`, contraseña `samily31657900`, base `jjpaper_db`).
* Se recuperaron las credenciales de Google OAuth (`GOOGLE_CLIENT_ID: 966811384264-4ciph62d7inqh38t90ig98omsa6jj326.apps.googleusercontent.com` y su secret oficial).

### B. Despliegue y Optimización del VPS Propio (`166.0.112.247`)
* **PostgreSQL 16:** Base de datos `jjpaper_db` saneada (26 MB, 0 tuplas muertas).
* **Autovacuum Agresivo:** Desplegado en `/etc/postgresql/16/main/conf.d/99-jjpaper-optimize.conf` con mantenimiento diario programado en `/etc/cron.daily/jjpaper-maintenance`.
* **PostgREST 12:** Configurado y funcionando en puerto 3000 con soporte RLS y compatibilidad de JWT claims.
* **Servicio de Autenticación (`jj-auth.service`):** Node.js nativo en puerto 3001 con endpoints de login Google OAuth (`/auth/v1/authorize`, `/auth/v1/callback`), telemetría en vivo (`/auth/v1/telemetry`) y master password.
* **CDN Nginx:** Sirviendo las 316 imágenes WebP del catálogo en `/var/www/jjp-media/`.

### C. Despliegue del Agente Autónomo en Servidor Central (`192.168.0.185`)
* Mapeo de la red LAN identificando el servidor maestro en `192.168.0.185` (`\\servidor`).
* Despliegue del demonio en `M:\jj-mixnet-agent\` con script de instalación como Tarea Programada de arranque del sistema (`INSTALL-SERVER-SERVICE.bat`).
* Reconstrucción atómica en memoria de los 10 árboles B-Tree `.NTX` Clipper (<150 ms/TX).
* Lectura y respeto de los correlativos soberanos `MXNUMCOT` (`00053535`) y `MXNUMPED` (`00112808`).
* Erradicación de comentarios sintéticos (`comen1: ""`).

### D. Rediseño del Monitor de Recursos (`admin/monitor.html`)
* Se transformó el monitor de cuotas de Supabase en un panel de control y supervisión en vivo del **Servidor VPS propio** + **Puente MixNet LAN**.
* Visualización en vivo de RAM VPS (15.3% / 4 GB), Disco (7.9% / 58 GB), BD `jjpaper_db` (26 MB) y latencias.

### E. Integración del Entorno Agéntico IA
* Se conectó el pool de 7 API Keys Gemini en `assets/js/gemini-client.js`.
* Creación de consola agéntica para auditorías integrales, creación de snapshots atómicos con SHA-256 en `M:\MIX11\comp01\backups\`, rollback en 1 clic y análisis de código.

### F. Granularidad de Permisos RBAC
* Ampliación de roles en `jjp_profiles` (Admin, Supervisor, Vendedor, Facturación, Cobranza, Cajero).
* Columna `permissions JSONB` para permisos granulares por usuario y mapeo con códigos MixNet (`001` a `033`).
