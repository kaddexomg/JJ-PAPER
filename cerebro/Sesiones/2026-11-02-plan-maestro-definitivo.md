# Bitácora de Sesión — 02 de Noviembre de 2026
## Auditoría Forense Completa & Plan Maestro Definitivo JJ Paper

> **Directiva de Continuidad Inmediata**:  
> Al abrir la próxima sesión, el agente **NO debe pedir confirmaciones redundantes ni reiniciar diagnósticos**. Se debe comenzar **inmediatamente** con la ejecución en código de la **Fase 1** del archivo [`cerebro/Sesiones/2026-11-02-plan-maestro-definitivo.md`](file:///C:/Users/PC/Desktop/JJ%20PAPER/cerebro/Sesiones/2026-11-02-plan-maestro-definitivo.md) (y el artefacto [`plan_maestro_definitivo.md`](file:///C:/Users/PC/.gemini/antigravity-cli/brain/11f4d7b5-baa1-491f-a326-db0f6ebe582e/plan_maestro_definitivo.md)).

---

## 1. Resumen de Contexto Guardado

En esta sesión se realizó una **auditoría forense exhaustiva** con 4 frentes de análisis (subagentes y traza en vivo) sobre la base de datos PostgreSQL 16 del VPS Soberano (`166.0.112.247`), el demonio LAN MixNet (`192.168.0.185:8790`), el servidor `wa-server` y todo el frontend en Cloudflare Pages (`admin/`, `vendedor/`, `assets/`).

### Diagnósticos Técnicos Confirmados con Archivos y Líneas Exactas:

1. **Monitor (Falsas Alarmas 125%, 111%, "Servidor Apagado" y Agentes Ficticios)**:
   - **VPS Soberano Real**: Saludable (RAM 23.8%, Disco 11.9%, PG 70 MB).
   - **Causa 125%/111%**: [`wa-server/src/monitor.js:12`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/monitor.js#L12) mantiene cuotas fijas de 500 MB y 1 GB de Supabase Cloud.
   - **Causa "Servidor Apagado"**: En [`assets/js/admin/monitor-client.js:390, 981`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/monitor-client.js#L390) se llama a `renderCardServer(...)`, cuya definición fue borrada en el commit `567b606`. Al dar `ReferenceError`, se rompe el JS y el panel queda congelado.
   - **Agentes Falsos**: En `admin/monitor.html` y `admin/mixnet.html` los botones ejecutan llamadas a `127.0.0.1:8790` (que no existe localmente) y fingen backups en consola.
2. **Fotos de Productos (4 funciones duplicadas, enlace 404 y motor pegado)**:
   - `fotos-faltantes.html` da 404 porque no existe el archivo físico (enlazado en [`assets/js/admin/sidenav.js:42`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/sidenav.js#L42)).
   - La búsqueda web falla en todas las pantallas porque [`functions/api/search-images.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/functions/api/search-images.js#L74) fue vaciado y delegado a `127.0.0.1:8795` (`studio_server.py`), motor Python con Playwright que **no puede correr en Windows 7**.
   - En [`assets/js/admin/products.js:1373`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/products.js#L1373) se guardaban strings `data:image/webp;base64` en PostgreSQL en vez de subir archivos WebP a `/var/www/jjp-media/`, y al aprobar fotos no se actualizaba `jjp_product_variants`.
3. **Puente MixNet ERP ('LIBRE', Inserción Automática y Códigos Reales)**:
   - [`wa-server/src/mixer.js:2032`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixer.js#L2032) escribía automáticamente en MixNet cada 30 segundos sin que el usuario pulsara "Insertar", y sin reconstruir los índices `.NTX`.
   - El código `LIBRE` se originaba en [`vquotes.js:1322`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vquotes.js#L1322) al crear un ítem personalizado.
   - **Códigos oficiales de MixNet verificados**:
     - Fuera de lista / Limpieza / Bolsas: **`IN-OS`**.
     - Venta por unidad / Detal: **`JJA-1`** y **`JJA-2`**.
     - Clientes nuevos no registrados: **`00`** (`CUENTA RECUPERADA`) — corregir bug en [`dbf-driver.js:220`](file:///C:/Users/PC/Desktop/JJ%20PAPER/jj-mixnet-agent/dbf-driver.js#L220) que asignaba `000-001`.
   - La UI pasaba a `'confirmado_mixnet'`, pero el agente [`sync-documents.js:255`](file:///C:/Users/PC/Desktop/JJ%20PAPER/jj-mixnet-agent/sync-documents.js#L255) esperaba `'pendiente_mixnet'` para inyectar.
4. **WhatsApp Multi-Vendedor y Cierres**:
   - Vendedores bloqueados por falta de política `FOR INSERT` en `jjp_wa_sessions`.
   - Código Baileys `515` intentaba guardar `status = 'reconnecting'`, lo cual violaba el constraint SQL `jjp_wa_sessions_status_check`.
5. **Campañas de Correo**:
   - Erradicar textos arcade en [`wa-server/src/email-campaigns.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/email-campaigns.js#L388) (`🕹️ NIVEL`, `POWER-UP`, `arcade-runner.gif`).
   - Sustituir asuntos con la palabra *"Propuesta..."* por mensajes comerciales directos adaptados a comercios y empresas.
6. **Prospectos**:
   - Clasificación `Agotado`, `Sin Respuesta`, `Descartado` y `Rebotado` sin borrar datos.
7. **Agente IA Soberano**:
   - Consolidar una consola interactiva real en `admin/monitor.html` con herramientas ejecutables (diagnóstico, snapshot preventivo con SHA-256, reconstrucción de índices Clipper, autovacuum).

---

## 2. Hoja de Ruta Inmediata para la Siguiente Sesión

```
Paso 1 ──► Fase 1: Monitor Honesto (restaurar renderCardServer, cuotas reales VPS, corregir 404 en sidenav.js).
Paso 2 ──► Fase 5: Campañas de Correo (erradicar 'Arcade', GIFs y asuntos con 'Propuesta').
Paso 3 ──► Fase 3: Puente MixNet ERP (solo insertar con botón, mapeo IN-OS, JJA-1/2, Cuenta 00, .NTX, .BAK).
Paso 4 ──► Fase 2: Unificación de Fotos en VPS (WebP 800px en jjp-products y sincronización de variantes).
Paso 5 ──► Fase 4: WhatsApp Multi-Vendedor (RLS, fix constraint reconnecting y watchdog).
Paso 6 ──► Fase 6: Clasificación y filtros de Prospectos.
Paso 7 ──► Fase 7: Consola del Agente IA Soberano ejecutable.
Paso 8 ──► Compilación dist/ y despliegue a Cloudflare Pages.
```
