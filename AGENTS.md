# AGENTS.md — contexto del proyecto

> Generado por AgentForge el 2026-08-26 10:23. El agente lo consulta (load_project_context)
> ANTES de escribir o modificar codigo para respetar stack y convenciones.

## Tech Stack
no detectado

## Estructura
```
.claude/ (skills)
.env.local
.gitignore
.vscode/
404.html
_headers
_redirects
admin/
  clientes.html        ← gestión global de clientes (tabla + modal con address/notes)
AGENTS.md
assets/ (css, img, js, vendor)
audits/
backups/
  jjp_customers_antes_actualizar_*.json  ← backups de BD previos a correcciones
build.sh               ← Cloudflare Pages: publica solo dist/
cargar_clientes.mjs    ← script legacy de carga (usa IDs viejos de seller)
corregir_cartera_mixnet.cjs  ← genera CSV corregido desde MixNet (commit en repo)
actualizar_clientes_bd.mjs   ← actualiza/inserta en Supabase (--dry-run/--execute)
catalogo.html
cerebro/ (.obsidian, Conceptos, Indices, Modulos, Proyecto, Seguridad, Sesiones, Sistema)
checkout.html
CLAUDE.md
CLIENTES/
  clientes_importables_zonas.csv   ← cartera original (1811 filas, phone simulado)
  cartera_corregida_mixnet.csv     ← corregida: RIF real, phone real, address (NO subir a git)
comprobante.html
CONEXION_MIXNET.md
wa-server/
  clientes_mixnet_20263108_1529.csv ← datos reales extraidos de MixNet (6170 filas)
  extraer-clientes-mixnet.cjs       ← extractor v2 (Node 13+)
  extraer-clientes-mixnet.bat       ← menú para el usuario
  ...
```

## Comandos utiles
- `node corregir_cartera_mixnet.cjs` → genera CSV corregido con address (requiere MixNet CSV en wa-server/)
- `node actualizar_clientes_bd.mjs --dry-run` → simula updates en Supabase sin tocar nada
- `node actualizar_clientes_bd.mjs --execute` → aplica updates + inserts a jjp_customers
- `bash build.sh` → genera dist/ para Cloudflare Pages (excluye .csv, wa-server, cerebro)
- Deploy: push a main en kaddexomg/JJ-PAPER dispara Cloudflare Pages automaticamente

## Convenciones
- Repo git (kaddexomg/JJ-PAPER)
- Deploy: Cloudflare Pages via build.sh → dist/
- DB: Supabase (jjp_customers, jjp_profiles)
- Datos de negocio (.csv, .pdf, backups) NUNCA al repo (.gitignore lo bloquea)
- Vendedores actuales: Yovanni (004/006), Marianela (008), Andreina (014)
- Zona 010 (Keyder Salazar, admin): cartera propia de 191 clientes importada del reporte MixNet `clientes keyder.docx` (08-09-2026). Keyder conserva rol `admin` (gestión global + distribución) y puede vender/cotizar (las páginas `vendedor/*` aceptan admins). En `vcustomers.js`, "Mi cartera" para admins = `seller_id === SELLER.id`; "Todos"/"Sin vendedor" siguen globales.
- Maestro MixNet `CLIENTES/mixnet_clientes_cartera_20260908_1205.csv` (NO subir a git): usado el 08-09-2026 para enriquecer 1.817 clientes globales con RIF/email/teléfono/dirección reales. El cruce BD→CSV usa CODIGO_CLIENTE (vía `notes` de zona 010), teléfono, nombre exacto o núcleo de nombre; teléfonos con colisión UNIQUE no se sobrescriben.

## Tests
No se detectaron tests.

## Migración a 3 Proyectos Supabase (Septiembre 2026)
- **Estrategia**: El proyecto original (czzvsqnmxtjzqzioknnn) excedió su cuota. Se migró exitosamente el Core a Proyecto A (`qxgdrfkobbhdzgtoiavv`). Las credenciales multi-proyecto residen en `.env.supabase-multi`.
- **Estado Actual (07-09-2026)**:
  - **Proyecto A (Core)**: 100% ACTIVO en producción (`assets/js/config.js`, `_headers`, `wa-server/.env`).
  - **Proyecto B (Comunicación)**: WhatsApp, CRM, Sesiones y emails enrutados. Tablas `jjp_server_control` y `jjp_emails` sincronizadas en DDL con Proyecto B.
  - **wa-server Multi-Instancia**: Módulos que manejan pedidos (`mixer.js` y `count-lan.js`) y facturas de compra (`invoices.js`) configurados para consultar a Core (`dbCore`), eliminando errores de schema cache.
  - **Esquema Maestro Consolidado**: `sql/SQL_Proyecto_A_Fixed.sql` (incluye correcciones de storage, grants a public/anon, constraints de templates y funciones actualizadas).
  - **Datos Restaurados**: 1,808 clientes, 1,012 productos y variantes, 601 conteos de inventario, tasas de cambio y perfiles de staff.
  - **Admin Activo**: Usuario Google `picoj386@gmail.com` activado con UID `bddc57dc-5bf9-4a72-9e1c-751d07b03164` (`role: 'admin'`, `ref_code: 'jose'`).
  - **Prevención 42P13 / Limpieza**: Si se reinstala en un proyecto nuevo, ejecutar `sql/LIMPIAR_NUEVO_SUPABASE.sql` antes de aplicar el DDL maestro.

## Catálogo de Productos y Lista de Precios (Septiembre 2026)
- **Sincronización Catálogo (04-09-2026)**: Catálogo sincronizado en Supabase con 767 variantes y productos activos según `catalogo actualizado 03_09_2026 - Hoja 1.csv`.
- **Clasificación Estricta**: La regla de asignación en `verificar_catalogo.mjs` no debe forzar productos con 'P' (Porta Taco, Porta Clip) o 'D' (Dispensadores) dentro de `BANDEJAS`.
- **Lista de Costos / Precios (`lista_costos.html`)**:
  - Organizada por defecto en modo **🔤 Por Letra Inicial (A - Z)** (`GROUP_MODE = 'letra'`) para orden correlativo estricto.
  - Impresión optimizada a **13 - 15 páginas** exactas con diseño de alta densidad, cabeceras repetidas (`thead { display: table-header-group }`) y filas protegidas contra cortes (`break-inside: avoid !important`).
  - Habilitado para vendedores (`requireAuth('vendedor')`). Documento de costos interno requiere admin (`?mode=cost`).

## Sub-sistema de Comunicación, WhatsApp y Campañas (07/08-09-2026)
- **Proyecto B (`klcibjwleiqppedefpxw`) Totalmente Consolidado**:
  - **Realtime & REPLICA IDENTITY FULL**: Activados en `jjp_wa_sessions`, `jjp_wa_chats`, `jjp_wa_messages`, `jjp_emails`, `jjp_wa_campaigns`, `jjp_wa_campaign_targets` y `jjp_server_control` bajo la publicación `supabase_realtime`.
  - **Campañas de WhatsApp (`jjp_wa_campaigns`)**: Soporta todas las columnas de throttling y lotes anti-baneo (`batch_size`, `batch_pause_m`, `delay_min_s`, `delay_max_s`, `media_path`, `media_type`, `media_mime`, `media_filename`, `media_size`, `started_at`, `finished_at`, `skipped_count`).
  - **Mensajes de WhatsApp (`jjp_wa_messages`)**: Incluye columnas de citas, respuestas y reacciones (`reply_preview`, `reply_to_wa_id`, `reply_from`, `forwarded`, `reaction`, `reaction_from`).
  - **RPC Atómica (`jjp_wa_touch_chat`)**: Creada en Proyecto B con permisos para `service_role`, `authenticated` y `anon`.
  - **Sondeo de Respaldo QR**: `wa-link.js` sondea cada 3 segundos si el modal está abierto o la sesión está en `starting`/`pending_qr`, eliminando retrasos en la carga del código QR.
  - **Enrutamiento de Canales**: `assets/js/config.js` enruta hacia Proyecto B los canales con prefijos `wa-`, `difusion-`, `srv-` y los que contienen `email`.
  - **Auditoría de Cuotas (08-09-2026)**:
    - **Proyecto A (Core)**: 20 MB utilizados (4.0% de cuota) · 1,812 clientes, 1,012 productos y variantes, 601 conteos.
    - **Proyecto B (Comunicación)**: 12 MB utilizados (2.4% de cuota) · Aislamiento total de chats, mensajes y campañas.
    - **Proyecto C (Storage & Inventario)**: 8 MB de esquema · Buckets `jjp-products` y `jjp-receipts` listos con 1 GB libre.
    - Todos los proyectos operan con más del 95% de margen libre.

## Optimización Storage WebP, Cifrado Baileys y Caché RAM en Campañas (08-09-2026)
- **Compresión Masiva a WebP**: Catálogo optimizado a 800px máx, calidad 80. Peso total reducido de 8.63 MB a 5.33 MB (38.2% ahorro). Archivos originales pesados eliminados de Storage. 320 productos y 294 variantes actualizadas a `.webp` en Proyecto C (`nmcamjxhyysmmvgxgabo`).
- **Desacople 100% del Proyecto Viejo (`czzvsqnmxtjzqzioknnn`)**: 0 referencias en base de datos, CSP de `_headers` limpio, redirección automática en servidor. El proyecto antiguo se puede eliminar o pausar sin riesgo.
- **Cifrado E2EE Baileys**: Implementado `msgRetryCounterCache` y reescrito `getMessage` con protobuf stanzas y `.limit(1)` en `wa-session.js`. Resuelve definitivamente "Esperando este mensaje...".
- **Deduplicación & Heartbeat Dual**: Previene duplicados salientes por eco local `fromMe`. Latido actualiza `heartbeat` y `heartbeat_at` cada 30s.
- **Caché en RAM para Campañas Masivas**:
  - `mediaCache` (TTL 12h) en `outbox.js` (WhatsApp) y `attachCache` en `email.js` (Correo) evitan descargas redundantes hacia Supabase Storage durante envíos masivos.
  - Soporte multiagente paralelo con temporizadores y colas independientes por vendedor (`byOwner`).
- **Adjuntos de Email (fix 08-09-2026)**: `loadAttachments` (email.js) acepta inline base64 (`data:…;base64,` o base64 puro) además de `path`; `docPdfProductos` (doc-engine.js) soporta `returnBase64:true` (data URI) para campañas; el editor de campañas email (`campaign-editor.js` + `vcampanas-email.js`) usa checkboxes múltiples (PDF Lista de Precios + foto del producto/combo + archivo propio desde PC) y puede enviar varios a la vez (`attachOpt` coma-separado para email; select único en WhatsApp).
- **Cooldown anti-reenvío (48 h)**: `campaign-editor.js` excluye clientes que ya recibieron una campaña en las últimas N horas (lee `jjp_*_campaign_targets` con `status='sent'`), por `customer_id`/email/phone, en email y WhatsApp. Horas configurables en `jjp_settings`: `email_camp_cooldown_h` y `wa_camp_cooldown_h` (default 48). Cancelar y relanzar una campaña no reenvía a los ya alcanzados.
- **Deploy Automático**: Empujado a `origin main` (commit `eb20d8e`) con Cloudflare Pages actualizado.

## Integración de Suite Gemini AI & Copiloto JJ Paper (08-09-2026)
- **Pool de 7 API Keys & Balanceo Resiliente (`assets/js/gemini-client.js`)**:
  - Pool de 7 claves con rotación automática y reintentos transparentes ante límites de cuota (HTTP 429/503).
  - Cascada de modelos ultrarrápidos: `gemini-3.6-flash` (prioritario), `gemini-3.5-flash`, `gemini-flash-latest` y `gemini-2.5-flash-lite`.
  - Contexto de negocio embebido: Tasa oficial BCV en vivo (`getRate()`), catálogo, productos, zonas de venta y condiciones de despacho.
- **Asistente IA en WhatsApp CRM (`admin/whatsapp.html`, `vendedor/whatsapp.html` y `assets/js/wa/wa-chat.js`)**:
  - Botón interactivo `🪄 IA` en la barra de mensajes.
  - **Sugerencias Inteligentes**: Lee el contexto del cliente y redacta 3 opciones listas en 1 clic (Directa, Cordial, Comercial).
  - **Motor Anti-Spam / Anti-Baneo**: Toma cualquier mensaje base y genera 3 variaciones naturales con distinta estructura, sinónimos venezolanos y saludo para evitar bloqueos por envíos repetitivos.
  - **Cotizador Rápido de Precios**: Búsqueda en vivo de productos que inyecta en el mensaje el precio oficial en USD y su equivalente en Bs a tasa BCV.
- **Redactor Comercial de Correos (`admin/correo.html`, `vendedor/correo.html` y `assets/js/admin/correo.js`)**:
  - Botones `✨ Redactar con IA` (modal nuevo correo) y `✨ Responder con IA` (vista de lectura).
  - Redacción guiada por escenarios: Cotización formal, confirmación de despacho, recordatorio de pago amistoso y promociones de catálogo.
- **Copiloto JJ Flotante & Generador Canvas de Flyers (`assets/js/copilot-jj.js`)**:
  - Botón flotante `🤖 Copiloto JJ` auto-inyectado en todos los paneles de Admin y Vendedor a través de `assets/js/admin/sidenav.js`.
  - **Pestaña Chat**: Consultas inmediatas sobre productos, precios, políticas de despacho y procedimientos. Accesos directos a Difusiones y Editor de Campañas.
  - **Pestaña Generador de Flyer (Canvas 800x800)**: Diseña flyers comerciales de alta resolución con cabecera institucional JJ Paper, nombre del producto, badge de stock, marcas, precio destacado en USD ($) y Bs oficiales (BCV).
  - Opciones de exportación: Copiar al portapapeles (`ClipboardItem`), Descargar PNG, Enviar directo al chat activo de WhatsApp (`waSendGeneratedImage`) o inyectar directo a Campaña/Difusión.

## Suite de Campañas Inteligentes con IA y Despacho Programado (08-09-2026)
- **Desbloqueo CSP Google AI**: Añadido `https://generativelanguage.googleapis.com` al `connect-src` de `_headers`, permitiendo llamadas directas desde navegadores en Cloudflare Pages.
- **Motor Anti-Spam / Anti-Baneo con Spintax Dinámico**:
  - `GeminiClient.generateCampaignSpintax()`: Transforma automáticamente mensajes y plantillas en Spintax `{A|B|C}` preservando variables `{{nombre}}`, `{{empresa}}`, `{{producto}}`, `{{precio}}`, `{{link}}`.
  - Al despachar masivamente, cada cliente recibe una variación sintáctica única y humana, imposibilitando el bloqueo por patrón repetitivo.
- **Redactor Comercial Inteligente (`GeminiClient.draftCampaignMessage`)**:
  - Redacta plantillas de alta conversión para WhatsApp y Email adaptadas a productos destacados, combos o reactivación.
- **Integración Directa en Editor de Campañas (`campaign-editor.js`)**:
  - Botón `🪄 Redactar con IA`: Redacción asistida con 1 clic.
  - Botón `🛡️ Variar Anti-Spam IA`: Convierte el mensaje actual en Spintax dinámico.
  - Botón `🎨 Diseñar Flyer con IA`: Genera tarjeta visual en Canvas 800x800 y la adjunta automáticamente a la campaña.
- **Programación de Envíos (`scheduled_at`)**:
  - Columna `scheduled_at TIMESTAMPTZ` en `jjp_wa_campaigns` y `jjp_email_campaigns` (Proyecto B).
  - Selector datetime-local en el editor de campañas.
  - Sweepers en `wa-server` (`campaigns.js` y `email-campaigns.js`) respetan la marca temporal antes de iniciar envíos.
  - Badges visuales en tablas de campañas (`vdifusion.js` y `vcampanas-email.js`) indicando `⏰ Programada: dd/mm hh:mm`.

## Suite de IA Ultrarrápida, Generación de Flyers en Chat y Campañas Multicontenido (08-09-2026)
- **Optimización de Latencia Gemini (<800ms)**:
  - Cascada de modelos optimizada priorizando `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`, eliminando modelos obsoletos o con 404 (`gemini-2.5-flash-lite`).
  - Límite de tiempo por request (`AbortController` a 3.5s) que descarta inmediatamente intentos lentos y conmuta a la siguiente clave del pool de 7.
- **Generación Visual de Flyers en Chat Copiloto (`copilot-jj.js`)**:
  - Detección de intenciones gráficas en el chat (`flyer`, `imagen`, `foto`, `tarjeta`, etc.).
  - Búsqueda en vivo en catálogo con extracción de producto, renderizado dinámico en Canvas 800x800 con precio USD y Bs oficiales a tasa BCV.
  - Botones de acción directa embebidos en el mensaje: Copiar Imagen, Descargar PNG, Personalizar Precio y Lanzar Campaña.
  - Carga segura de imágenes mediante blob (`fetch` + `createObjectURL`) para prevenir errores de lienzo contaminado (CORS).
- **Ventas y Cotizaciones Nativas para Administradores (`admin/pos.html`, `admin/cotizador.html`, `sidenav.js`)**:
  - Las herramientas de venta y cotización para administradores residen directamente dentro de la ruta `/admin/` (`admin/pos.html` y `admin/cotizador.html`), sin redirecciones ni cambios a `/vendedor/`.
  - En el menú administrativo (`ADMIN_NAV`), el grupo "Ventas" solo incluye: `Nueva Venta (POS)`, `Nueva Cotización`, `Pedidos`, `Cotizaciones`, `Promociones` y `Reseñas`.
  - Al realizar ventas (POS) o cotizaciones, el autocompletado y búsqueda de clientes (`cust-autocomplete.js` y `pos.js`) se restringe estrictamente a la cartera propia asignada del usuario (`seller_id = SELLER.id`), mientras que en el CRM (`admin/clientes.html`) conserva el acceso global a toda la base de datos.
- **Envío Masivo de Múltiples Adjuntos en Campañas (`campaign-editor.js`, `vdifusion.js`, `campaigns.js`)**:
  - Unificación de controles de adjuntos a casillas de verificación múltiples tanto para WhatsApp como para Correo: `Ficha / Foto del Producto o Flyer`, `Lista de Precios Oficial (PDF)` y `Subir Archivo Propio`.
  - Soporte de columnas `extra_media_*` en `jjp_wa_campaigns` de Proyecto B.
  - Despacho secuencial en `wa-server` de mensaje principal con imagen/flyer y documento PDF complementario para cada destinatario.

## Diagnóstico y Estabilidad del Servidor `wa-server` (08-09-2026)
- **Colisión por Doble Instancia Concurrente de Node**:
  - Se identificó la ejecución simultánea de dos procesos `node src/index.js` en Windows (PID 63732 iniciado a las 3:44 PM desde consola y PID 69832 iniciado a las 4:10 PM como tarea de fondo).
  - **Conflicto de Puertos**: Ocasionó error `listen EADDRINUSE: address already in use 0.0.0.0:8787 / 8788` en `count-lan`.
  - **Tormenta "Bad MAC" & Desincronización Signal/Baileys**: Al conectarse dos WebSockets simultáneos a WhatsApp con las mismas credenciales y archivos de sesión, las cadenas de cifrado (ratchets) de Signal Protocol se corrompieron mutuamente, generando un bucle de ping-pong continuo (reconexión cada 2s) y miles de advertencias `Bad MAC Error: Bad MAC`. Esto obligó a la sesión `b0cd93c5...` (Andreina) a desvincularse y solicitar escaneo QR.
  - **Explicación de "Servidor Fantasma"**: Aunque el panel web mostrara desconexión por desincronización del heartbeat en `jjp_server_control`, el proceso previo continuaba activo en background recibiendo mensajes y enviando campañas.
  - **Estado OAuth Gmail**: Las credenciales de `ventasjjmarianela014@gmail.com` y `araujoyovanni9@gmail.com` arrojaron `Token has been expired or revoked.` y deben renovarse desde el módulo de correo.
  - **Resolución**: Se cerraron ambos procesos en conflicto, dejando los puertos liberados y el entorno limpio para arrancar una única instancia controlada.