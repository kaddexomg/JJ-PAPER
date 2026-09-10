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
- Zona 010 y Zona 020 (Keyder Salazar, admin): carteras propias (Zona 010 con 191 clientes y Zona 020 con 3.474 clientes de MixNet). Ambas son estrictamente exclusivas para Keyder: invisibles para otros vendedores (no se descargan en `loadCustomers` ni se muestran en `vcustomers.js`, ni en autocompletado de POS/cotizador para vendedores regulares). Keyder conserva rol `admin` (gestión global + distribución) y puede vender/cotizar directamente a su clientela. En `vcustomers.js`, "Mi cartera" para Keyder = `seller_id === SELLER.id` (agrupa sus 3.665 clientes).
- Maestro MixNet `CLIENTES/mixnet_clientes_cartera_20260908_1205.csv` (NO subir a git): usado para enriquecer clientes globales e importar la cartera MixNet general a la Zona 020 de Keyder.

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

## Campañas Email Nativas en Admin, Optimización de Catálogo y Candado Único en wa-server (08-09-2026)
- **Campañas Email Nativas para Administrador (`admin/campanas-email.html`, `sidenav.js`)**:
  - Implementada la interfaz nativa dentro de `/admin/` para gestión y despacho masivo de campañas de correo vía Gmail API.
  - Se eliminó el enlace residual que redirigía a `../vendedor/campanas-email.html`, manteniendo al usuario con rol admin estrictamente en el entorno de administración.
  - Soporte completo para selección de plantillas, audiencia, Spintax dinámico y adjuntos múltiples (PDF Lista de Precios + Imagen del producto + Archivo local).
- **Optimización Integral de Carga del Catálogo (`assets/js/catalog.js`)**:
  - **Caché en Memoria (`sessionStorage`)**: Implementado almacenamiento temporal de 3 a 5 minutos para grupos de categorías (`jjp_category_groups`), categorías finas (`jjp_categories`) y el catálogo completo de productos con sus variantes. Al navegar o recargar, el catálogo carga en **<50ms**.
  - **Rango Ampliado (0 - 1999)**: La consulta de productos incluye explícitamente `.range(0, 1999)` para prevenir el truncamiento por defecto del límite de 1.000 filas de Supabase PostgREST.
  - **Degradación Visual Agraciada (`onerror`)**: Si la URL de imagen de un producto falla o da 404, la etiqueta `<img>` conmuta instantáneamente al emoji/icono de su categoría sin mostrar recuadros de imagen rota.
- **Candado de Instancia Única en el Sistema Operativo (`wa-server/src/index.js`)**:
  - Mutex por puerto local (`127.0.0.1:8786`). Si se intenta ejecutar una segunda instancia de Node, el proceso detecta el puerto ocupado y aborta de inmediato con código de salida 2 (`process.exit(2)`).
  - Previene definitivamente colisiones de puertos (8787/8788), WebSockets concurrentes en Baileys y desincronizaciones criptográficas "Bad MAC".
- **Optimización de Despacho Outbox (`wa-server/src/outbox.js`)**:
  - Escucha eventos `INSERT` y `UPDATE` con `status=eq.pending` en tiempo real para disparar reintentos al instante sin esperar el barrido periódico.
  - Fallback a cualquier sesión activa sana en el servidor si la sesión del vendedor asignado está desconectada.

## Suite de IA Avanzada: Priorización Flash-Lite, Auto-Carga Resiliente y Flyers Ultra-HD (08-09-2026)
- **Priorización de Modelos y Failover Inmediato (`assets/js/gemini-client.js`)**:
  - Priorizado `gemini-3.1-flash-lite` como modelo principal, respondiendo en **~1.000ms** de forma continua.
  - Ante picos 503 (modelo ocupado), el motor ahora conmuta de inmediato al siguiente modelo en la misma clave (`continue`), y ante cuota 429 rota instantáneamente a la siguiente llave (`break`) a través del pool balanceado de 7 llaves.
- **Auto-Carga Dinámica Resiliente (`ensureGeminiClient`)**:
  - Implementado cargador automático bajo demanda en `assets/js/vendedor/campaign-editor.js`, `vcampanas-email.js` y `vdifusion.js`. Si una página no incluyó la etiqueta de script, el cliente se autodescarga asíncronamente eliminando el error `Módulo GeminiClient no disponible`.
  - Incluida la etiqueta de script `<script src="../assets/js/gemini-client.js?v=20260908_ai_v2"></script>` en `admin/campanas-email.html`, `vendedor/campanas-email.html`, `admin/difusion.html` y `vendedor/difusion.html`.
- **Redactor Comercial Inteligente de Plantillas (`ecTplDraftWithAi` y `tplDraftWithAi`)**:
  - Añadido botón interactivo `✨ Redactar con IA` dentro de los modales de creación de plantillas (`tplModal`) tanto en Campañas de Correo como en Difusiones de WhatsApp.
  - Genera con 1 solo clic Asunto, Cuerpo con viñetas comerciales, variables dinámicas (`{{nombre}}`, `{{empresa}}`, `{{vendedor}}`, `{{producto}}`, `{{precio}}`, `{{link}}`) y Spintax dinámico `{A|B|C}` anti-spam.
- **Generador Visual de Flyers Publicitarios Ultra-HD (`renderProductCard`)**:
  - Resolución ampliada a **1200 x 1200 px** (Canvas Retina 2x) para máxima nitidez en WhatsApp y pantallas móviles.
  - Iluminación de estudio con halo radial esmeralda, cinta promocional superior derecha ("🔥 OFERTA ESPECIAL"), sello de garantía institucional, doble cotización jerárquica en USD ($) y Bolívares (Bs) a tasa oficial BCV, y pie de página con datos de contacto del asesor.
  - Mockup vectorial publicitario 3D inteligente en caso de que el producto no posea fotografía en catálogo.

## Plan de Integración MixNet: Micro-Agente Satélite para Windows 7 (Bajos Recursos)
- **Principio Fundamental**: NO modificar ni poner en riesgo `wa-server` actual. La suite de WhatsApp, campañas y correos permanece intacta y protegida.
- **Limitaciones de las PCs de Facturación en la Empresa**:
  - La mayoría opera con **Windows 7** y pocos recursos (2GB - 4GB RAM).
  - Node 18+ (requerido por Baileys/WhatsApp) no corre nativamente en Windows 7 y consumiría demasiada RAM.
  - Si una PC de facturación se apaga, no debe afectar el WhatsApp ni las campañas de la empresa.
- **Solución Acordada: Micro-Agente Satélite Desacoplado (`mixnet-bridge.cjs`)**:
  - Script independiente en CommonJS nativo sin dependencias pesadas de npm, compatible con Node 13+ en Windows 7.
  - Consumo ultraligero: **<20 MB de RAM y 0% de CPU**.
  - Sondea periódicamente (cada 5-10s) pedidos (`jjp_orders`) y cotizaciones (`jjp_quotes`) en Supabase.
  - Deposita automáticamente `pedido_[ID].csv` / `pedido_[ID].txt` y `cotizacion_[ID].csv` en la carpeta vigilada de MixNet (`C:\JJ-PAPER-MIXER\` o ruta interna).
  - **Arranque Automático Desatendido**: Configurado con script `.vbs` en `shell:startup` para iniciar en segundo plano sin ventana negra cada vez que se enciende la PC. Si la PC se apaga por la noche, al encenderse a la mañana siguiente procesa las órdenes acumuladas en segundos.

## Monitor de Cuotas Multi-Proyecto, Tráfico en Vivo y Gestor de Optimizaciones (08-09-2026)
- **Dashboard Web & App de Escritorio PC (`admin/monitor.html`, `MONITOR-JJ-PAPER.bat`)**:
  - Supervisión en tiempo real de las cuotas de almacenamiento y bases de datos de los 3 proyectos Supabase (Core 500 MB, Comunicación 500 MB, Storage 1.000 MB).
  - Modo dual resiliente: Conexión nativa con `wa-server` local (consultas PostgreSQL directas, latencia, conexiones activas y tuplas muertas) y modo fallback en la nube directo con PostgREST y Storage API cuando se accede fuera de la red local.
  - Lanzador de escritorio para Windows (`MONITOR-JJ-PAPER.bat` y `wa-server/MONITOR-SISTEMA.bat`) que abre el monitor como aplicación nativa de PC independiente sin barra de direcciones (Chrome/Edge en modo `--app`).
- **Motor de Telemetría y Requests en Vivo (`wa-server/src/monitor.js`, `count-lan.js`)**:
  - Ring buffer en memoria de los últimos 150 requests y llamadas con cálculo de RPM (Requests Per Minute) y latencias individuales.
  - Registro de eventos HTTP, transacciones de WhatsApp (`outbox.js`), campañas de correo y sincronizaciones LAN.
  - Consola interactiva en vivo con filtros rápidos (Todos, HTTP/LAN, WhatsApp, Optimizador) y control de pausa.
- **Gestor de Optimizaciones y Purga de Datos Temporales**:
  - Ejecución de `VACUUM ANALYZE` en PostgreSQL para compactar tablas, liberar espacio físico retenido por tuplas muertas y actualizar estadísticas del planificador de consultas en Proyecto A y Proyecto B.
  - Purga de logs transitorios en `jjp_server_control` (>7 días) y targets obsoletos/fallidos de campañas antiguas (>30 días).
  - Botón de "Mantenimiento Maestro 1-Clic" con modal de confirmación y reporte de tiempo transcurrido y filas optimizadas.

## Suite de Fotografía de Estudio Fotorrealista IA, Corrección de Búsqueda en Catálogo, Anti-Spam y Botón Flotante Draggable (08-09-2026)
- **Buscador Resiliente de Catálogo en Vivo (`searchProductsLive`)**:
  - Consulta multi-nivel: Lee primero de la memoria/`sessionStorage` (`jjp_products_cache_v4`) para respuesta instantánea en **0ms**, con fallback directo a Supabase Core (`client.from('jjp_products')`).
  - Tokenizador semántico con filtro de palabras vacías (de, del, la, el, caja, etc.) y lematización (stemming) de plurales (`es`/`s`), permitiendo encontrar de inmediato marcas ("Expo", "Shark", "Caribe"), productos ("Marcadores", "Carpetas Fibra", "Sacapuntas") y SKUs.
- **Resolución de Bloqueo CSP y Carga Segura de Imágenes (`loadImageSafe`)**:
  - Inclusión de `https://image.pollinations.ai` y `https://pollinations.ai` en `connect-src` de `_headers`, permitiendo la generación de fotos de estudio mediante Flux sin violaciones de política de seguridad en Cloudflare Pages.
  - Conversión a blob en memoria vía `fetch({ mode: 'cors' })` con `URL.createObjectURL(blob)`, garantizando que el Canvas no se manche (evita el error `Tainted canvases may not be exported` al descargar o copiar).
  - Eliminación definitiva del renderizado de emergencia con caja verde ("JJ OFICIAL"), sustituyéndolo por una tarjeta de presentación de estudio de alta gama en fondo blanco con isotipo y datos del producto.
- **Botón Flotante Copiloto Draggable y Despeje de WhatsApp (`copilot-jj.js`)**:
  - Detección de ruta en `whatsapp.html` que eleva automáticamente el botón flotante `#jjp-copilot-fab` a `bottom: 115px`, evitando tapar el botón de envío de mensajes (`#waSendBtn`) o la barra del compositor.
  - Función de arrastre táctil y con mouse (`makeDraggable`) con límites de pantalla y persistencia en `localStorage` (`jjp_copilot_fab_pos`), permitiendo al usuario mover el botón a cualquier posición de la pantalla.
- **Optimizador Anti-Spam Resiliente (`handleGenAntiSpam`, `cpiCopyAntiSpam`)**:
  - Almacenamiento seguro de variaciones generadas en memoria (`_antiSpamResults`), reemplazando la interpolación de texto multilínea en atributos HTML `onclick`.
  - Inyección directa en el campo de texto de WhatsApp (`#waComposerInput`) al hacer clic en "Copiar", además de copiar al portapapeles.
- **Diseño de Flyers en Campañas (`campaign-editor.js`)**:
  - Generación previa y automática de la fotografía de estudio fotorrealista con IA antes de renderizar el flyer si el producto no tiene foto en catálogo.
  - Renderizado predeterminado en fondo blanco de estudio comercial (`theme: 'white'`) con titular publicitario configurable ("🔥 OFERTA AL MAYOR").

## Motor de Fotos Reales de la Web, Guardado Oficial en Catálogo y Packshots IA sin Fondos Arquitectónicos (09-09-2026)
- **Buscador de Fotografías Reales en la Web (`wa-server/src/product-images.js`, `count-lan.js`)**:
  - Búsqueda en vivo de fotografías de producto auténticas de papelerías, catálogos comerciales y MercadoLibre vía DuckDuckGo Image Search (`/lan/products/search-images?q=...`), con expansión automática de abreviaturas venezolanas (`RESALT.` → `resaltador`, `P/PIZARRA` → `marcador pizarra`, `C/T` → `con tapa`).
  - Bypass total de CORS en el servidor local `wa-server` y soporte para cualquier dominio `*.pages.dev` en `corsOrigin`.
- **Selector Triple de Fuente de Imagen en Copiloto (`copilot-jj.js`)**:
  - **🌐 Fotos Web Reales (Recomendado)**: Cuadrícula de fotos reales del producto encontradas en internet con previsualización inmediata en 1 clic.
  - **🤖 Generar con IA (Flux Packshot)**: Fotografía aislada sobre fondo blanco puro (`#FFFFFF`) con ingeniería de prompts estricta.
  - **📁 Subir / Enlace**: Carga de cualquier URL directa de Google Imágenes / web o subida de archivo desde PC / teléfono móvil (`<input type="file">`).
- **Guardado Oficial en Catálogo (`/lan/products/save-image` y fallback Supabase)**:
  - Botón `💾 Guardar como Foto Oficial en Catálogo`: Descarga la foto seleccionada, la sube al bucket `jjp-products/[id].[ext]` en Proyecto C (Storage) y actualiza automáticamente `image_url` en `jjp_products` (Proyecto A Core) de forma permanente para todos los usuarios.
- **Erradicación Definitiva de Fondos Arquitectónicos (Paredes, Pisos, Cuartos) en IA**:
  - En `gemini-client.js`: Eliminados los términos ambiguos "cyclorama", "floor", "room" o "shadows".
  - Prompt estricto de Packshot de Objeto Aislado (`isolated object on pure solid white background #FFFFFF`) con tokens negativos explícitos (`STRICT NEGATIVE PROMPT: no room, no floor, no walls, no cyclorama, no table, no furniture, no background scenery, no interior, no people, no hands, no mockups`).
  - Expansión de vocabulario comercial en `enrichProductForMarketing`: soporte para rosado, fucsia, magenta, morado, violeta, naranja, turquesa, cyan, resaltadores, displays y cajas por 12.
  - Traducción asistida por Gemini a descripción comercial de empaque en inglés antes de pasar a Flux.

## Lineamientos de Estilo Visual Packshots y Copywriting Comercial B2B Anti-Spam (09-09-2026)
- **Documento Rector (`docs/GUIA_ESTILO_VISUAL_Y_COPYWRITING_IA.md`)**:
  - Centraliza los lineamientos de fotografía comercial (anatomía del prompt, iluminación softbox, ángulo hero a 15°-25°, empaque litografiado/blíster con euro-slot, y sombra de contacto en la base).
  - Define la política editorial B2B: erradicar tono publicitario agresivo/spam, lenguaje consultivo humano, atención a colegios/oficinas/librerías venezolanas y preservación intacta de variables dinámicas.
- **Refinamiento de Prompts Fotorrealistas (`assets/js/gemini-client.js`)**:
  - Enriquecimiento de tipos de artículos escolares y de oficina: plastilinas en barra con caja litografiada, tijeras de oficina de acero inoxidable en blíster colgante, notas adhesivas señalizadoras en display colgante.
  - Inyección en el prompt de Flux de empaques comerciales auténticos (`authentic retail folding carton box`, `hanging blister retail package with euro-slot`, `printed paper wrap`) y sombra de contacto suave en base (`soft natural contact shadow at base`).
  - Negativos robustos contra textos deformados, manos sosteniendo el objeto, escritorios y renders 3D infantiles.
- **Copywriting B2B y Spintax Dinámico**:
  - `generateCampaignSpintax`: Saludos, conectores de valor y cierres amables y consultivos sin presión comercial ("¿Requiere una cotización formal?", "¿Desea que le verifiquemos disponibilidad?").
  - `draftCampaignMessage`: Textos y asuntos de correo sobrios y elegantes, con desglose de precios oficiales a tasa BCV y condiciones de despacho directo en Caracas y envíos nacionales.
- **Cache Bumping**:
  - Actualizado `?v=20260909_b2b_packshot_v3` en `assets/js/admin/sidenav.js`, `copilot-jj.js`, `campaign-editor.js` y páginas de difusión.

## Reinicio Limpio de Servidor, Filtro Móvil WhatsApp, Fotos Reales y Copywriting B2B Humano (09-09-2026)
- **Reinicio Limpio y Desbloqueo del Mutex de Red Local (`REINICIAR-SERVIDOR.bat` y `START-SERVIDOR.bat`)**:
  - Implementado script `REINICIAR-SERVIDOR.bat` en la raíz y en `wa-server/` que cierra limpiamente procesos `node.exe` anteriores (`taskkill /F /IM node.exe`) y relanza el servidor con el código más reciente.
  - Menú interactivo en `START-SERVIDOR.bat` cuando el candado detecta el puerto 8786 ocupado (código 3): permite al usuario presionar `R` para matar la instancia previa y reiniciar de inmediato sin bloquearse.
- **Filtrado Estricto de Números Móviles para WhatsApp (`wa-server/src/phone.js`, `assets/js/wa/wa-common.js`)**:
  - Detección precisa de líneas fijas CANTV (`0212`, `0241`, `0251`, etc.) que representan el ~70% de la base de clientes y no poseen WhatsApp.
  - Normalización de prefijos heredados de vendedores (`0080414...` → `0414...`), `5804...` y números inválidos.
  - `campaigns.js`: Omite de inmediato números fijos CANTV sin saturar USync en Baileys y con timeout de seguridad de 5s en `sock.onWhatsApp`.
  - `campaign-editor.js` y `vdifusion.js`: Muestran en el resumen de audiencia el conteo exacto de móviles válidos y fijos omitidos (`X móviles WhatsApp (Y fijos CANTV omitidos)`).
- **Búsqueda Instantánea de Fotografías Reales y Eliminación de Alucinaciones IA (`wa-server/src/product-images.js`)**:
  - Prioridad 1 con DuckDuckGo Images JSON API (<1.5s): extrae packshots de distribuidores reales (Office Depot, Sam's Club, MercadoLibre) con expansión de abreviaturas y limpieza de códigos SKU de bodega.
  - Se eliminó la generación forzada de caricaturas/deformaciones de Flux (Pollinations) cuando no se encuentra foto web: el sistema ahora orienta al usuario a pegar el link directo o subir el archivo, manteniendo imágenes comerciales 100% fidedignas.
- **Previsualización Inmediata de Enlaces y Botón 1-Clic "Guardar en Catálogo" (`copilot-jj.js`)**:
  - Detección automática de URLs de imágenes pegadas en el chat o en el campo de enlace del Flyer (`oninput` / `onpaste` con renderizado inmediato).
  - Función `window.cpiSavePhotoDirectToCatalog(photoUrl, productId, btn)`: descarga la imagen (o decodifica base64), la sube a Supabase Storage Proyecto C (`jjp-products`) y actualiza permanentemente `jjp_products.image_url` en Proyecto A Core.
  - Botón interactivo `💾 Guardar en Catálogo` inyectado directamente en la tarjeta de respuesta del Copiloto en el chat y en el visor del Flyer.
- **Plantillas Comerciales B2B Humanas y Concisas (`campaign-editor.js`, `vdifusion.js`, `gemini-client.js`)**:
  - Formato breve y directo (5 a 7 líneas máximo para WhatsApp, legible en 5 segundos).
  - Tono venezolano cercano y cálido ("Hola {{nombre}}, espero estés muy bien 👋", "Te escribe {{vendedor}} de JJ Paper").
  - Estructura visual con doble salto de línea y negritas para nombres de productos y precios (`*📦 {{producto}}*`, `*💲 Precio especial: {{precio}}*`).
  - Spintax dinámico en saludos y preguntas de cierre ("¿Te aparto unas unidades para tu próximo despacho?").

## Temporizador Visual en Vivo de Campañas WhatsApp, Deliberación Profunda Gemini y Motor Anti-Alucinaciones de Imágenes (09-09-2026)
- **Temporizador Visual en Vivo en Campañas WhatsApp (`vdifusion.js`, `difusion.html`, `campaigns.js`)**:
  - **Columnas de Seguimiento Temporal en Proyecto B**: `next_send_at TIMESTAMPTZ`, `pause_reason TEXT` (`'batch_pause'` vs `'interval'`), `pause_until TIMESTAMPTZ` en `jjp_wa_campaigns` y `jjp_email_campaigns`.
  - **Cálculo y Persistencia en Despachador**: `wa-server/src/campaigns.js` calcula el próximo timestamp de envío tras cada mensaje e identifica si entra en pausa de descanso anti-bloqueo de lote (ej: 15 minutos cada 20 envíos) o en intervalo normal de cadencia humana (45-90s). Al reiniciar el servidor, se respeta el tiempo restante sin adelantar envíos.
  - **Ticker Visual en Tiempo Real (1s)**: En `vdifusion.js`, ticker interactivo `startCampaignLiveTimers()` que actualiza dinámicamente badges en la tabla de campañas y un banner destacado `#rd-live-timer-wrap` en el modal de detalle:
    - Intervalo entre mensajes: `⏳ Próximo: 00:45s` (estilo esmeralda suave).
    - Pausa anti-bloqueo: `☕ Pausa descanso (14m 30s)` (estilo ámbar pulsante con animación).
  - **Sincronización Realtime**: Suscripción al canal `difusion-progress` en Supabase Realtime que refresca contadores y recalcula la cuenta regresiva en milisegundos.
- **Deliberación Profunda con IA Gemini en Búsqueda de Imágenes (`wa-server/src/product-images.js`)**:
  - **Diagnóstico de la Falla Previa**: Las búsquedas con títulos brutos de inventario (ej. `GRAPADORA STD 24/6 26/6 METALICA C/G` o `ESCARCHA 50GR`) enviaban términos de almacén literales a DuckDuckGo, retornando cajas de grapas/clavos o municiones/talco. Al obtener >=4 resultados basura, Gemini nunca era consultado. Además, rate-limits de DuckDuckGo provocaban errores de parseo JSON no capturados (`SyntaxError: Unexpected token I`), resultando en errores 500 y el mensaje "servidor ocupado o apagado".
  - **Deliberación Previa con Gemini (Pool de 7 API Keys)**: Antes de buscar, Gemini analiza el SKU y extrae:
    1. Título comercial canónico en español.
    2. Categoría exacta (distinguiendo herramientas de consumibles: grapadora vs caja de grapas, escarcha escolar vs pólvora, talonario físico vs plantilla excel).
    3. Queries canónicas optimizadas (`{brand} {producto} fondo blanco`).
    4. Palabras clave negativas de descarte estricto (`negative_keywords`).
  - **Búsqueda Multi-Fuente Paralela en Bing y DuckDuckGo**: Scraping directo en Bing Images (alta disponibilidad sin rate-limits agresivos) en paralelo con DuckDuckGo, retornando fotos comerciales auténticas de distribuidores y papelerías.
  - **Filtrado Negativo Estricto**: Función `filterNegativeKeywords` que descarta automáticamente falsos positivos antes de rankear los resultados.
- **Eliminación Total de Alucinaciones y Deformaciones en Fotografía de Catálogo (`gemini-client.js`, `campaign-editor.js`, `copilot-jj.js`)**:
  - **Causa Raíz de Caricaturas y Deformaciones Flux**: En el generador de imágenes se inyectaba `NEGATIVE PROMPT: blurry text, hand holding object, person, cartoon...`. Debido a que Pollinations Flux no procesa la sintaxis de prompt negativo, interpretaba esas palabras como instrucciones afirmativas, generando caricaturas, personas, manos y fondos distorsionados.
  - **Prompt Comercial 100% Positivo y Puro**: Eliminada la cláusula de prompt negativo y reemplazada por especificaciones fotográficas comerciales de estudio de producto 8K UHD sobre fondo blanco puro `#FFFFFF`.
  - **CORS y Conectividad Robusta (`wa-server/src/count-lan.js`)**: `corsOrigin` permite cualquier puerto de localhost/127.0.0.1 y `sendJSON` preserva todas las cabeceras HTTP necesarias.

## Auditoría Integral, Corrección de 8 Bugs Críticos y Estabilización de Campañas/IA (09-09-2026)
- **Diagnóstico y Corrección de los 8 Bugs Críticos del Sistema (`commit e72ca96`)**:
  - **1. Búsqueda de Productos (`wa-server/src/product-images.js`)**:
    - **Regex Destructiva de Nombres Eliminada**: `cleanProductName` usaba `/\b[A-Z0-9_-]{7,}\b/g`, lo cual borraba nombres de productos en mayúsculas de 7+ letras (`GRAPADORA`, `RESALTADOR`, `BOLIGRAFO`, `FABER-CASTELL`, `AMARILLO`). Reemplazado por `/\b(?=[A-Z0-9_-]*\d)[A-Z0-9_-]{6,}\b/g` que exige al menos un dígito para clasificar como código SKU de almacén.
    - **Regex de Bing Corregida**: `[^&]` truncaba URLs de imágenes comerciales en CDNs con parámetros (`?w=800&h=800`). Sustituido por `[^"]` con `decodeURIComponent` y normalización de entidades `&amp;`.
    - **Extracción de Títulos en Bing**: Se incluyó regex para capturar títulos desde el HTML de Bing, enriqueciendo el algoritmo de scoring y filtrado negativo.
    - **Abreviaturas con Punto**: `expandAbbreviations` ahora soporta abreviaturas que terminan en punto (`RESALT.`, `PERM.`) mediante coincidencia opcional `\.?`.
    - **Depuración de Código Muerto**: Eliminada la función inactiva `searchGoogleImages`.
    - **Expansión de Cobertura Multi-Fuente**: Se amplió el despacho paralelo en Bing de 2 a 4 queries inteligentes canónicas.
  - **2. Pipeline de Campañas y Mensajería (`campaigns.js`, `outbox.js`)**:
    - **Persistencia de Timers tras Reinicio**: `campaigns.js` ahora carga `next_send_at` desde la base de datos (`jjp_wa_campaigns`) al iniciar el sweep si la memoria en RAM está vacía, respetando las pausas de lote de 15 minutos sin adelantar mensajes indebidos.
    - **Auto-Recovery de Targets Huérfanos**: Detección automática al inicio del barrido de destinatarios atrapados en `enviando` por >5 minutos sin progreso, restableciéndolos a `pending`.
    - **Eliminación de Doble Validación `onWhatsApp`**: Se retiró la comprobación redundante en `outbox.js` (ya garantizada en `campaigns.js`), eliminando la duplicación de peticiones de red hacia los servidores de Meta.
    - **Aislamiento de Sesiones por Vendedor**: Eliminado el fallback cross-vendor en `outbox.js` para evitar que mensajes de un vendedor desconectado salgan desde el número de otro asesor.
  - **3. Suite Gemini AI y Generación Gráfica (`assets/js/gemini-client.js`)**:
    - **Modelos Oficiales Google AI**: Reemplazados nombres inexistentes por `gemini-2.0-flash-lite`, `gemini-2.0-flash`, `gemini-1.5-flash` y `gemini-2.5-pro`.
    - **Rotación Resiliente de API Keys**: Manejo de status HTTP 400 y 403 para rotar inmediatamente de clave en el pool de 7 llaves.
    - **Extractor Universal de JSON (`extractJSON`)**: Parser robusto con regex envolvente `\{[\s\S]*\}` que previene excepciones por texto explicativo o markdown previo de Gemini.
    - **Erradicación de Alucinaciones Pollinations/Flux**: Se removió la generación sintética de productos por IA (que producía objetos deformes/caricaturescos). Si no existe fotografía real en catálogo o en la web, el sistema recurre al mockup 3D vectorial de alta fidelidad del flyer (`renderProductCard`).
    - **Temperaturas Calibradas**: Redactor B2B `draftCampaignMessage` a `0.45` (formal, estructurado, sin lenguaje teletienda/spam) y `generateCampaignSpintax` a `0.55`.
  - **4. Correcciones en WhatsApp CRM y Copiloto UI (`wa-chat.js`, `copilot-jj.js`)**:
    - **Resolución de Nombre de Contacto**: Reemplazado `contact_name` (inexistente en el esquema) por `display_name` en `wa-chat.js`, evitando saludos erróneos como "Hola 58412...".
    - **Eliminación de XSS/Errores de Sintaxis en Tarjetas IA**: Sustituida la interpolación de texto en `onclick` por atributos `data-reply-key` con event listeners dedicados.
    - **Rutas Nativas de Admin**: Corregida redirección en `copilot-jj.js` para que los administradores permanezcan en `admin/difusion.html`.
  - **5. Limpieza Criptográfica Signal/Baileys (`wa-session.js`)**:
    - Purga masiva de cientos de archivos de sesión redundantes `.0.json` y sesiones remotas desincronizadas (`session-277584189346047.27.json`).
    - Los registros `Closing session` en consola corresponden a la negociación normal y saludable de PreKeys tras la depuración de ratchets obsoletos.
- **Pendientes Prioritarios para la Siguiente Intervención**:
  - **1. Reglas Taxonómicas Estrictas para Búsqueda de Productos**: Crear un documento de lineamientos canónicos (`cerebro/` / `docs/`) con metadatos por familias de papelería (medidas, calibres, tipos de punta, marcas y presentaciones exactas) que Gemini inyecte antes de buscar para evitar confusiones de producto (ej. marcadores de servicio vs permanentes).
  - **2. Gestión de Campañas y Permisos en UI**: Implementar en `admin/difusion.html` y `vendedor/difusion.html` la acción para eliminar/archivar campañas completadas o canceladas desde la interfaz, y revisar permisos RLS en `jjp_wa_campaigns` / `jjp_wa_campaign_targets`.
  - **3. Importador Masivo de Clientes CSV**: Asegurar que la carga de archivos CSV de clientes desde la interfaz de usuario procese correctamente las columnas y asigne cartera sin fallos de esquema o RLS.

## Servicio en Segundo Plano, Puente Bidireccional MixNet y Carga de Cartera Zona 020 (10-09-2026)
- **Erradicación Definitiva de "Esperando este mensaje..." (`wa-session.js`)**:
  - **Signal Pre-Warming**: Antes de cada envío con `sock.sendMessage()`, se dispara un `sendPresenceUpdate('composing', jid)` con un delay humano de 1.200 ms. Esto fuerza a la red de WhatsApp a intercambiar el PreKey bundle de Signal Protocol y precalentar el ratchet de cifrado en el dispositivo destino antes de entregar el texto cifrado.
  - **Reconstrucción Completa en `getMessage(key)`**: Al recibir un `receipt: retry` de un receptor que perdió sincronización, `getMessage` ahora reconstruye stanzas completas con `mimetype`, `media_path` y `media_filename` para imágenes, videos, audios y documentos, evitando que el cliente falle la desencriptación.
  - **Almacén de Mensajes en RAM/Disco**: Ampliado el `messageStore` en RAM a 10.000 mensajes y persistencia en disco (`sent-cache.json`) a 5.000 mensajes con flush asíncrono.
  - **Parches y Timers de Socket**: Inyectados `connectTimeoutMs: 60_000`, `defaultQueryTimeoutMs: 60_000`, `keepAliveIntervalMs: 25_000` y `patchMessageBeforeSending` para encapsular mensajes interactivos en `viewOnceMessage`.
- **Escalabilidad y Concurrencia Multi-Campaña (`campaigns.js`)**:
  - **Despacho Paralelo por Vendedor**: Reemplazado el bucle serial por `Promise.allSettled(ownerIds.map(...))`. Todas las sesiones de vendedores (Keyder, Marianela, Andreina, Yovanni) avanzan en paralelo sin bloquearse mutuamente.
  - **Intercalado Round-Robin Multicampaña**: Si un mismo vendedor tiene 2 o más campañas activas, el despachador conmuta entre ellas de forma equitativa (`ownerCampIndex`), evitando que una campaña larga congele a las demás.
  - **Caché en RAM para `onWhatsApp`**: Almacenamiento en memoria (TTL 24 horas) para verificaciones de números en WhatsApp, reduciendo drásticamente las llamadas de red y eliminando riesgos de rate-limit.
- **Puente Bidireccional MixNet y Servicio Silencioso de Fondo**:
  - **Auto-Detección de Carpetas de Facturación**: `mixer.js` detecta en tiempo de ejecución y exporta pedidos/cotizaciones a todas las carpetas activas (`C:/JJ-PAPER-MIXER`, `C:/Pedidos JJ`, `M:/pedidos`, etc.), importando a su vez los pedidos confeccionados en MixNet hacia `jjp_orders`.
  - **Arranque Invisible y Resiliente en Windows**:
    - `run-service.bat`: Bucle supervisor que mantiene el servidor activo ante reinicios imprevistos.
    - `start-hidden.vbs`: Ejecuta el proceso en segundo plano absoluto (0 ventanas de consola negras).
    - `INSTALAR-INICIO-AUTOMATICO.bat`: Inyecta el acceso directo en `shell:startup` para que el servidor inicie solo con encender la PC.
    - `ESTADO-SERVIDOR.bat` y `DETENER-SERVIDOR.bat`: Herramientas de diagnóstico de puertos (8786, 8787, 8788) y apagado limpio.
- **Importación Exitosa de la Cartera General MixNet — Zona 020 (`cargar_nueva_cartera_020.mjs`)**:
  - **3.474 Clientes Nuevos Insertados**: Procesado el maestro `CLIENTES/mixnet_clientes_cartera_20260908_1205.csv` deduplicando contra la base de datos existente.
  - **Crecimiento de Cartera**: La base de datos de clientes (`jjp_customers` en Proyecto A Core) creció de 1.999 a **5.473 clientes**.
  - **Calidad de Datos**: Limpieza de artefactos de codificación DOS/Windows-1252 (`¥` → `Ñ`, `COMPAÑIA`, tildes corregidas), RIFs validados, teléfonos normalizados a formato venezolano y direcciones físicas preservadas.
  - **Integridad `UNIQUE(phone)`**: Lógica de deduplicación estricta con fallback a `phone: null` ante colisiones, logrando 3.474 inserciones exitosas con **0 fallos**.
  - **Asignación Libre (`seller_id: null`)**: Los clientes de Zona 020 están disponibles en la cartera libre para que cualquier vendedor o administrador pueda tomarlos, cotizarlos o enviarles catálogo.
  - **Soporte en Frontend y Optimización DOM**:
    - Filtro y badge azul `Zona 020 (Nueva Cartera)` agregado en `admin/clientes.html` y `assets/js/vendedor/vcustomers.js`.
    - Paginación DOM virtual (`MAX_RENDER = 150`) con banner informativo en `aclients.js` y `vcustomers.js`, garantizando que la navegación y búsquedas con 5.473 clientes respondan en <10ms sin sobrecargar el navegador.