# AGENTS.md — Contexto Soberano del Proyecto JJ Paper

> Actualizado: 27 de Octubre de 2026.
> Este documento define la arquitectura, convenciones, stack y protocolos obligatorios del sistema JJ Paper.
> El agente DEBE consultarlo ANTES de escribir o modificar código para respetar la infraestructura soberana.

---

## 1. Tech Stack Soberano (100% On-Premise / VPS)

- **Servidor VPS Ubuntu (Infraestructura Central 24/7)**:
  - **Host / IP**: `166.0.112.247` (Ubuntu 24.04 LTS). Dominio SSL: `https://166-0-112-247.sslip.io`.
  - **Especificaciones**: 4 GB RAM (3.915 MB), 60 GB NVMe (58.447 MB).
  - **Base de Datos**: PostgreSQL 16 nativo (`jjpaper_db`, ~30 MB, 53 tablas). Conexiones activas supervisadas y autovacuum optimizado.
  - **PostgREST 12**: Exposición REST & RPC de la base de datos con autenticación JWT Bearer.
  - **GoTrue Auth**: Servicio de autenticación nativo en `/auth/v1` (telemetría en `/auth/v1/telemetry`).
  - **Nginx Reverse Proxy & Media CDN**: SSL y servidor de medios estáticos WebP en `/var/www/jjp-media/` (accesible vía `/storage/v1/object/public/...`).
  - **Supabase Cloud**: ERRADICADO. No existen Proyecto A, Proyecto B ni Proyecto C en la nube. Todas las URLs en `config.js` y `wa-server/.env` apuntan exclusivamente al VPS Soberano.

- **Puente MixNet ERP LAN (Servidor Tienda Física)**:
  - **Red / Ubicación**: Servidor Central LAN `192.168.0.185:8790` (ruta compartida `M:\MIX11\comp01`).
  - **Motor**: Archivos de base de datos Clipper DBF con 10 índices B-Tree `.NTX` en memoria.
  - **Tablas Maestras**: `MXCTACLI.DBF` (clientes), `MXCTAINV.DBF` (artículos), `MXENCPED.DBF` / `MXRENPED.DBF` (pedidos), `MXENCCOT.DBF` / `MXRENCOT.DBF` (cotizaciones), `MXNUMCOT.DBF` / `MXNUMPED.DBF` (correlativos).

- **wa-server Local & Comunicación**:
  - **Entorno**: Node.js (v20+), Baileys para sesiones multi-agente de WhatsApp, cola outbox, despacho de campañas de correo y webhook LAN.
  - **Puertos**: 8787 (API LAN wa-server) y 8788 (conteo LAN).

- **Frontend & Despliegue**:
  - Vanilla JavaScript (ES6+ modular), componentes CSS nativos y librerías livianas.
  - **Hosting**: Cloudflare Pages (`https://jjpaper.pages.dev`).
  - **Build**: `bash build.sh` empaqueta estrictamente los archivos necesarios en `dist/`.

- **Suite IA & Copiloto**:
  - `assets/js/gemini-client.js`: Pool inteligente de 7 API Keys Gemini con balanceo y rotación ante cuotas. Modelos ultrarrápidos `gemini-flash` y `gemini-flash-lite`.

---

## 2. Estructura del Proyecto

```
admin/                   ← Módulos de administración (monitor, clientes, pos, cotizador, difusion, campanas-email, etc.)
vendedor/                ← Paneles para la fuerza de venta (pos, cotizador, clientes, whatsapp, difusion, etc.)
assets/
  css/                   ← Variables, componentes, estilos admin y responsive
  img/                   ← Logotipos y recursos visuales institucionales
  js/
    config.js            ← Configuración soberana central (URL VPS, esquemas de 53 tablas, helpers JWT)
    gemini-client.js     ← Cliente Gemini AI con pool rotativo de 7 API Keys
    catalog.js           ← Lógica de catálogo público, filtros, WebP y búsqueda
    admin/               ← Lógica de módulos administrativos (monitor-client.js, auth.js, sidenav.js, etc.)
    wa/                  ← Controladores de mensajería y CRM WhatsApp
  vendor/                ← Supabase JS client v2.58.0
wa-server/               ← Servidor Node.js para WhatsApp Baileys, outbox, sincronización y rates
build.sh                 ← Script de compilación que genera dist/ para Cloudflare Pages
AGENTS.md                ← Contexto maestro y reglas inviolables para agentes de IA
```

---

## 3. Comandos Útiles

- **Compilación Frontend**:
  `bash build.sh` → Genera la carpeta `dist/` para publicación en Cloudflare Pages (excluye backups, .csv, wa-server y archivos privados).
- **Despliegue a Producción**:
  `git push origin main` → Dispara el webhook y despliegue automático en Cloudflare Pages (`jjpaper.pages.dev`).
- **Ejecución Persistente de wa-server en Windows**:
  `Start-Process wscript.exe -ArgumentList "start-hidden.vbs" -WorkingDirectory "C:\Users\PC\Desktop\JJ PAPER\wa-server"`
  *(Inicia `run-service.bat` de forma desacoplada y persistente bajo el Session Manager de Windows con rotación de logs).*
- **Validación Sintáctica de Scripts**:
  `node -c assets/js/admin/monitor-client.js`

---

## 4. Convenciones Obligatorias y Reglas de Negocio

### Despliegue y Protección de Datos
- **Cloudflare Pages vía `build.sh`**: Todo cambio de frontend se despliega mediante `build.sh` a `dist/`.
- **Cero Datos Sensibles en Git**: Archivos `.csv`, `.pdf`, backups `.json` o `.bak`, credenciales `.env` y bases DBF NUNCA deben comitearse al repositorio Git (`.gitignore` los bloquea).

### Base de Datos y Esquema DDL/DML
- **Conexión Soberana Única**: Todas las operaciones de base de datos se ejecutan contra PostgreSQL 16 en el VPS (`https://166-0-112-247.sslip.io`).
- **Verificación Estricta de Esquemas**: Jamás asumir columnas por inferencia entre tablas padre/hijo. Por diseño, `unit` y `unit_id` pertenecen exclusivamente a `jjp_products`; la tabla `jjp_product_variants` **NO posee la columna `unit`**. Toda migración o script SQL debe ser contrastado contra el esquema real de las 53 tablas documentado en `assets/js/config.js`.

### Asignación de Vendedores y Nómina Sagrada
- **Vendedores Oficiales**:
  - `002`: Luis Alarcón
  - `004` / `006`: Yovanni Araujo
  - `008`: Marianela
  - `014`: Andreina
  - `010` / `020`: Keyder Salazar (Admin)
  - `005`: Jose Salazar (Atención mostrador físico tienda)
- **Cartera Exclusiva de Keyder Salazar (Zonas 010 y 020)**:
  - Estrictamente privada para Keyder: invisible para otros vendedores (no se descarga en `loadCustomers` para vendedores regulares ni se muestra en autocompletados ajenos).
  - Keyder conserva rol `admin` (gestión global en CRM `admin/clientes.html`) y puede vender/cotizar directamente tanto a su clientela como a cualquier cliente usando el selector de vendedor en `pos.html` y `cotizador.html`.
- **Cero Cruce de Vendedores**: El campo `CODVEN` define comisiones y nómina. Prohibido reasignar ventas por la zona del cliente. Si en MixNet dice `002`, en JJ Paper es Luis Alarcón irrefutablemente.

### Unificación de Entidades y Comunicación
- **Entidad Contacto Unificada**: Cliente o prospecto comparten una sola verdad: teléfono, correo y estado de entrega (`email_status = 'bounced'`). Prohibido crear tablas o estructuras duplicadas.
- **Páginas de Comunicación Nativas e Independientes**: Mantener estrictamente separadas las interfaces según su responsabilidad: `whatsapp.html` (chats directos), `difusion.html` (campañas WhatsApp), `correo.html` (bandeja de entrada) y `campanas-email.html` (campañas masivas email). No forzar pestañas unificadas ni redirects extraños.
- **Filosofía Cognitiva de Anaiel (IA Comercial B2B — Trato Humano y Cero Relleno)**:
  - *Los lectores son personas reales*: Quienes leen los correos y mensajes de WhatsApp son seres humanos de carne y hueso (jefes de departamentos de compras saturados de trabajo o dueños de comercios atendiendo en mostrador). Prohibido redactar como un bot genérico que rellena plantillas rígidas o genera saludos burocráticos vacíos.
  - *Bifurcación Obligatoria según Audiencia*:
    1. **Canal Revendedor / Comercio (Papelerías, Librerías, Quincallas, Bazares, Detal)**: Su lenguaje es *margen de ganancia, rotación rápida de vitrina/mostrador, precios por bulto cerrado de importador directo y reposición rápida en su tienda*. CTA idóneo: *"¿Cuáles son los productos escolares o de papelería que más rápido rotan en su mostrador para enviarles nuestra lista de precios mayorista por bulto?"*.
    2. **Canal Corporativo / Consumo Propio (Clínicas, Colegios, Almacenes, Oficinas, Industrias)**: Su lenguaje es *continuidad operativa, cero atascos de papel, archivo reglamentario, factura SENIAT a Tasa BCV y procura abierta ("un solo proveedor que les consiga todo")*. CTA idóneo: *"Compártannos su lista de los insumos de mayor concurrencia o rotación en su empresa para enviarles una cotización formal comparativa a Tasa Oficial BCV"*.

### Moneda y Catálogo
- **Tasa Oficial BCV**: La moneda de cobro oficial cara al cliente es estrictamente la tasa **BCV** (`rate_bcv` / `exchange_rate` en `jjp_settings`), mantenida al día por `wa-server/src/rates.js`.
- **Imágenes WebP**: Catálogo optimizado a WebP (800px máx, calidad 80) servido localmente desde el VPS en `/var/www/jjp-media/` (`jjp-products`).

---

## 5. Protocolo Mandatorio MixNet ERP (29-09-2026)

1. **Consultar Antes de Modificar**: Antes de escribir o modificar tablas DBF de MixNet, el agente DEBE consultar la documentación técnica de MixNet y contrastar contra la estructura Clipper original.
2. **Reparación Previa Indispensable**: Antes de activar sincronizadores, MixNet debe estar saneado en `M:\comp01` (limpieza de comentarios `COMEN1`/`COMEN2` contaminados con `[MixNet]` o `COT-`, correlativos calibrados `MXNUMPED`/`MXNUMCOT` y reindexación nativa `.NTX` en el menú de mantenimiento de MixNet).
3. **Escritura 100% Indetectable**: Cero huellas, cero firmas, cero notas técnicas. Si no hay comentarios de despacho del cliente, `COMEN1` y `COMEN2` se dejan en blanco (espacios `0x20`). Clientes no registrados en MixNet usan el código oficial `00` con nombre `CUENTA RECUPERADA`.
4. **Índices Clipper .NTX**: Prohibido escribir registros en `.DBF` sin actualizar `.NTX`. Utilizar el micro-conector o herramientas nativas en Harbour (`DBFNTX`) que actualizan los árboles B-Tree en tiempo real para evitar pantallas trabadas y bucles en caja.
5. **Snapshots Preventivos Obligatorios**: Toda operación por lotes sobre archivos DBF debe generar previamente un archivo de respaldo sellado en `M:\MIX11\comp01\backups\` con extensión `.BAK`.

---

## 6. Telemetría y Monitor del Sistema

- **Endpoint Nativo**: `https://166-0-112-247.sslip.io/auth/v1/telemetry`
- **Métricas Supervisadas**:
  - **RAM VPS**: Uso porcentual y memoria disponible sobre 3.9 GB físicos.
  - **Disco NVMe**: Uso porcentual y espacio libre sobre 58.4 GB físicos.
  - **PostgreSQL 16**: Nombre de base de datos (`jjpaper_db`), tamaño físico real (~30 MB), tuplas muertas y conexiones activas.
  - **Puente MixNet**: Estado del puente LAN (`192.168.0.185:8790`), ruta `M:\MIX11\comp01`, correlativos de cotización (`MXNUMCOT`) y pedido (`MXNUMPED`).
  - **wa-server**: Heartbeat en `jjp_server_control`, sesiones activas de WhatsApp y latencia promedio.
- **Sin Residuo Cloud**: La interfaz (`admin/monitor.html` y `assets/js/admin/monitor-client.js`) no posee tarjetas de cuotas ficticias (500 MB / 1 GB) ni advertencias falsas de servicios en la nube.

---

## 7. Incidencias y Directivas Activas

- **Permisos RLS en Campañas VPS**: Mantener verificado que las políticas Row Level Security en PostgreSQL del VPS permitan a los roles autorizados insertar y actualizar destinatarios en `jjp_email_campaign_targets` y `jjp_wa_campaign_targets`.
- **Desacople en Windows**: No iniciar Node.js como subproceso en segundo plano desde sesiones efímeras del agente; utilizar `start-hidden.vbs` para persistencia en el sistema operativo.
- **Marco Cognitivo de IA B2B (Directiva Maestra Activa)**: La IA comercial de campañas (Anaiel) debe aplicar estrictamente el diagnóstico operativo por sector y la bifurcación entre clientes corporativos (consumo interno) y revendedores comerciales (papelerías, librerías, quincallas, bazares buscando margen y rotación de mostrador). Debe activar el inventario real de +2.400 artículos (incluyendo maquinaria de oficina, destructoras, plastificadoras y embalaje), incluir la cláusula de procura abierta ("conseguimos cualquier producto o equipo fuera de lista"), usar formato visual escaneable de viñetas de 1 línea sin precios fijos en primer contacto, y cerrar con el CTA adaptado a la naturaleza del lector (margen por bulto para comercios o concurrencia para empresas). Cero textos planos enlatados, cero saludos robóticos y cero relleno. Documentado en detalle en el plan de arquitectura.
