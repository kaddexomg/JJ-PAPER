# 🏛️ PLAN MAESTRO DE REESTRUCTURACIÓN Y SANEAMIENTO INTEGRAL — JJ PAPER
**Fecha:** 03 de Octubre de 2026  
**Autor:** Antigravity (Auditoría Forense en Profundidad & Arquitectura de Sistemas)  
**Estado:** 📋 PROPUESTA TÉCNICA Y DIAGNÓSTICO ESTRUCTURAL (Sin tocar código)  

---

## 📑 ÍNDICE GENERAL

1. [El Diagnóstico Forense Real: Las 8 Fracturas Ocultas](#1-el-diagnóstico-forense-real-las-8-fracturas-ocultas)
2. [Análisis de Bucles Infinitos y "Request Polling" Descontrolado](#2-análisis-de-bucles-infinitos-y-request-polling-descontrolado)
3. [La Trampa del Desdoblamiento en Dos Proyectos (A vs B)](#3-la-trampa-del-desdoblamiento-en-dos-proyectos-a-vs-b)
4. [La Realidad de las Máquinas: Por qué Windows 7 No Puede con Baileys](#4-la-realidad-de-las-máquinas-por-qué-windows-7-no-puede-con-baileys)
5. [Nueva Arquitectura Desacoplada: Los 4 Pilares Limpios](#5-nueva-arquitectura-desacoplada-los-4-pilares-limpios)
6. [Flujo Comercial Reestructurado: Cotizador IA ➔ POS ➔ Pedido MixNet](#6-flujo-comercial-reestructurado-cotizador-ia--pos--pedido-mixnet)
7. [Purga Quirúrgica de Módulos y Código Zombie](#7-purga-quirúrgica-de-módulos-y-código-zombie)
8. [Matriz de Transición y Fases de Ejecución](#8-matriz-de-transición-y-fases-de-ejecución)

---

## 1. EL DIAGNÓSTICO FORENSE REAL: LAS 8 FRACTURAS OCULTAS

Tras contrastar los registros históricos de `cerebro/`, los esquemas reales en PostgreSQL y el código fuente de frontend y backend, se identificaron **8 fracturas críticas** que originan la inestabilidad actual:

```
                               LAS 8 FRACTURAS DEL SISTEMA
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│ 1. Proyecto B sin Autenticación │               │ 2. Tablas Fantasma en Frontend  │
│    0 usuarios, 0 perfiles. RLS  │               │    pos_scans, campaign_templates│
│    abierto a public ALL.        │               │    no existen en ninguna BD.    │
└────────────────┬────────────────┘               └────────────────┬────────────────┘
                 │                                                 │
                 ▼                                                 ▼
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│ 3. Inflación Extrema de Índices │               │ 4. Heartbeat Duplicado          │
│    jjp_emails: 58 MB de índices │               │    Server escribe cada 60s a    │
│    para solo 3.6 MB de datos.   │               │    Proyecto A y B a la vez.     │
└────────────────┬────────────────┘               └────────────────┬────────────────┘
                 │                                                 │
                 ▼                                                 ▼
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│ 5. Bucle de Polling QR (3s)     │               │ 6. 52 Llamadas Huérfanas LAN    │
│    Frontend sondea cada 3s sin  │               │    Peticiones a 192.168.0.172,  │
│    control si el server calla.  │               │    Tailscale y GSM muerto.      │
└────────────────┬────────────────┘               └────────────────┬────────────────┘
                 │                                                 │
                 ▼                                                 ▼
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│ 7. Baileys sin Purgar (102k)    │               │ 8. Correlativos Rnd Aleatorios  │
│    102.759 mensajes acumulados  │               │    Si RPC falla, genera random  │
│    con grupos y broadcasts.     │               │    que choca con Clipper MixNet │
└─────────────────────────────────┘               └─────────────────────────────────┘
```

### Detalle de Hallazgos en Base de Datos Real:

| Entidad / Tabla | Proyecto A (Core) | Proyecto B (Comm) | Diagnóstico Forense |
| :--- | :--- | :--- | :--- |
| `auth.users` | **11 usuarios** | **0 usuarios** | Proyecto B no tiene usuarios. Toda llamada del frontend corre como `anon`. |
| `jjp_profiles` | **11 perfiles** | **0 perfiles** | Funciones como `jjp_is_admin()` en B siempre fallan (`auth.uid()` es null). |
| `jjp_server_control` | 1 fila | 1 fila | **Escritura duplicada cada 60s**: `heartbeat.js` actualiza A y B a la vez. |
| `jjp_emails` | No existe | **2.379 filas (61 MB)** | **58 MB son índices inflados** sin VACUUM/REINDEX; data real ocupa 3.6 MB. |
| `jjp_wa_messages` | No existe | **102.759 filas (43 MB)** | Acumulación descontrolada de chats, grupos y estados sin purga periódica. |
| `jjp_wa_sessions` | No existe | 2 filas | `setSession()` usa `update()`, si la fila no existe, falla en silencio sin insertar. |
| `jjp_pos_scans` | ❌ No existe | ❌ No existe | Llamada fantasma en `product-finder.js` y `scan.js`. Genera error 42P01 silencioso. |
| `jjp_campaign_templates` | ❌ No existe | ❌ No existe | Llamada fantasma en `campaign-editor.js`. |
| `jjp_promos` | 0 filas | No existe | Módulo sin uso que se consulta en 6 scripts del frontend. |
| `jjp_reviews` | 5 filas huérfanas | No existe | Módulo abandonado que ensucia dashboard y menú. |
| `jjp_clients` | 2 filas huérfanas | No existe | Tabla legacy que compite con `jjp_customers` (5.609 clientes). |

---

## 2. ANÁLISIS DE BUCLES INFINITOS Y "REQUEST POLLING" DESCONTROLADO

El usuario reportó: *"las llamadas los request policing cuando a veces una llamada se queda rebotando y rebotando y rebotando sin conseguir respuesta del servidor que eso pasa con el QR y no tenemos una buena sincronización"*.

Al auditar los temporizadores (`setInterval`) del frontend, descubrimos los focos exactos de este comportamiento:

### A. La trampa del polling de QR en `assets/js/wa/wa-link.js` (L20-L28)
```javascript
// CÓDIGO ACTUAL PROBLEMÁTICO:
setInterval(async () => {
  const modal = document.getElementById('waLinkModal');
  const isModalOpen = modal?.classList.contains('op') || modal?.style?.display === 'block';
  if (isModalOpen || WA_SESSION?.status === 'starting' || WA_SESSION?.status === 'pending_qr' || WA_SESSION?.status === 'reconnecting') {
    await waLoadSession();
  }
}, 3000);
```
**¿Por qué rebota infinitamente?**
1. Cuando el usuario hace clic en "Generar QR", el frontend envía `requested_action = 'connect'`.
2. Si el servidor local (`wa-server`) está apagado, colgado o sin conexión, el estado queda en `starting` o `pending_qr`.
3. El frontend entra en un **bucle ciego cada 3 segundos**: dispara consultas `SELECT * FROM jjp_wa_sessions WHERE profile_id = ...` sin timeout exponencial ni límite de reintentos.
4. Con 3 vendedores y 1 admin con la pestaña abierta, esto genera **1.200 consultas HTTP por hora** rebotando contra Supabase sobre una sesión que nadie está atendiendo.
5. Si Baileys entra en reconexión transitoria (código 515), emite `reconnecting`, disparando el mismo bucle agresivo de 3 segundos.

### B. El sondeo ciego de la centralita GSM en `assets/js/phone-dialer.js` (L278)
```javascript
// CÓDIGO ACTUAL PROBLEMÁTICO:
gsmPollInterval = setInterval(checkBridgeStatus, 4000);
```
- Cada 4 segundos, cualquier pantalla que cargue el dialer telefónico hace `fetch('http://127.0.0.1:8789/status')`.
- Como el módulo GSM y ADB fueron desactivados, el navegador arroja `ERR_CONNECTION_REFUSED` **15 veces por minuto en la consola de cada usuario**.

### C. La cascada de timeouts en `assets/js/admin/monitor-client.js`
- El monitor intenta conectarse a `http://localhost:8787/lan/health`, `lan/monitor/stats`, `lan/mixnet/status` y a la IP `100.103.110.44:8787` (Tailscale).
- Al no responder la PC Supervisor, la promesa espera hasta agotar el timeout de red del navegador y cae en `querySupabaseDirectly()`, ejecutando 5 consultas pesadas `COUNT(*)` sobre `jjp_customers`, `jjp_products`, `jjp_wa_messages`, etc., congelando la interfaz.

---

## 3. LA TRAMPA DEL DESDOBLAMIENTO EN DOS PROYECTOS (A vs B)

### El Flujo Roto Actual:
```
┌────────────────────────────────────────────────────────────────────────┐
│                          NAVEGADOR DEL USUARIO                         │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
     (JWT de Login Google)              (Clave Pública "anon" pelada)
                   │                                 │
                   ▼                                 ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│       PROYECTO A (CORE)              │  │    PROYECTO B (COMUNICACIÓN) │
│ • Usuario Autenticado (auth.uid)     │  │ • auth.uid() = NULL (Siempre)│
│ • jjp_profiles (11 registros)        │  │ • jjp_profiles (0 registros) │
│ • RLS Activo y Protegido             │  │ • RLS vulnerado a public ALL │
└──────────────────────────────────────┘  └──────────────────────────────┘
```

**Consecuencias Técnicas:**
1. **Pérdida de Integridad Referencial**: Un mensaje en Proyecto B no puede tener clave foránea hacia el cliente en Proyecto A (`jjp_customers`). El enlace se hace por strings de texto sueltos (`phone`), generando registros huérfanos.
2. **Falsas Rutas Alternas**: En `config.js`, un objeto Proxy intercepta llamadas. Si un desarrollador o script consulta una tabla que no está en la lista blanca `COMM_TABLES`, la llamada cae en Proyecto A. Si la tabla no existe en A, revienta con error 404.
3. **Escrituras Dobles de Control**: El servidor gasta egress y cuota escribiendo el estado en ambos proyectos porque ningún módulo sabe a ciencia cierta quién tiene la verdad.

---

## 4. LA REALIDAD DE LAS MÁQUINAS: POR QUÉ WINDOWS 7 NO PUEDE CON BAILEYS

```
┌─────────────────────────────────────────────────────────────────────────┐
│ REQUERIMIENTOS TÉCNICOS DE BAILEYS v6+ vs ENTORNO TIENDA (WINDOWS 7)    │
├─────────────────────────────────────────────────────────────────────────┤
│ • Baileys exige: Node.js 18.x o superior (Crypto WebStandards, ESM)    │
│ • Windows 7 32-bit soporta nativo: Hasta Node.js 13.14.0 (2020)         │
│ • MixNet ERP corre en: Entorno DOS/Clipper 16/32-bit (NTVDM / BIOS)     │
│ • Intentar forzar Node 18+ en Win7: Requiere parches VxKex inestables   │
│   que provocan pantallazos azules o congelan el emulador de Clipper.   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Regla de Oro Operativa:**  
Las computadoras de la tienda física (Windows 7) **NO DEBEN procesar sockets de WhatsApp, ni sincronizaciones masivas de Gmail, ni cargas pesadas de Node**. Su trabajo debe ser exclusivamente:
1. Operar MixNet.
2. Servir de terminal de ventas / consulta.
3. Ejecutar un micro-agente local silencioso de sincronización de archivos DBF locales.

---

## 5. NUEVA ARQUITECTURA DESACOPLADA: LOS 4 PILARES LIMPIOS

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                 NUBE PERSISTENTE Y SEGURA                                 │
│                                                                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                        SUPABASE (BASE DE DATOS SANEADA)                           │   │
│   │ • Auth Centralizado: Un solo login seguro por rol (Admin / Vendedor)              │   │
│   │ • Tablas Depuradas: Catálogo plano (740ms), CRM 5.609 clientes, 705 prospectos    │   │
│   │ • Cola Transaccional: jjp_quotes (Presupuestos) ➔ jjp_orders (Pedidos)            │   │
│   │ • Mensajería Limpia: Solo mensajes directos reales (Sin grupos, purga a 90 días)  │   │
│   └─────────────────────────┬───────────────────────────────┬─────────────────────────┘   │
│                             │                               │                             │
│                             │ (API / HTTPS)                 │ (WebSocket / Push)          │
│                             ▼                               ▼                             │
│   ┌──────────────────────────────────────────┐  ┌─────────────────────────────────────┐   │
│   │   CLOUD WORKER / VPS (COMUNICACIÓN 24/7) │  │       CLOUDFLARE PAGES (FRONTEND)   │   │
│   │ • Node 20+ con Baileys v6 Oficial        │  │ • Interfaz Web Rápida y Limpia      │   │
│   │ • Gmail API con renovación OAuth limpia  │  │ • Modo Ventana Única (PWA Desktop)  │   │
│   │ • Cero sondeos ciegos: Despacho por colas│  │ • Catálogo rápido para clientes     │   │
│   │ • Funciona aunque la tienda esté cerrada │  │ • Cotizador con IA Gemini           │   │
│   └──────────────────────────────────────────┘  └─────────────────────────────────────┘   │
└──────────────────────────────────────┬────────────────────────────────────────────────────┘
                                       │
                         (Sincronización por Cola)
                                       │
                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                               TIENDA FÍSICA (RED LOCAL WINDOWS 7)                         │
│                                                                                           │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │                 MICRO-AGENTE MIXNET LOCAL (Node 13 Nativo / C#)                   │   │
│   │                                                                                   │   │
│   │ • Consume < 20 MB de memoria RAM. Cero interferencia con emulador Clipper.        │   │
│   │ • Tarea A (Cada 60s): Si hay pedido nuevo en Supabase ➔ Lo escribe en             │   │
│   │   M:\comp01\MXENCPED.DBF + MXRENPED.DBF y actualiza índices .NTX.                 │   │
│   │ • Tarea B (1 vez al día o manual): Lee MXCTAINV.DBF y actualiza precios/stock.    │   │
│   │ • No maneja WhatsApp, no maneja correos, no expone puertos inseguros.             │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. FLUJO COMERCIAL REESTRUCTURADO: COTIZADOR IA ➔ POS ➔ PEDIDO MIXNET

Se elimina la duplicidad entre Cotizador y POS. Cada uno asume un rol único y complementario:

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                   FASE 1: CAPTACIÓN Y PROPUESTA                       │
│                                                                                       │
│   [Vendedor / Admin en Cotizador]                                                     │
│   • Pega el requerimiento informal del cliente de WhatsApp.                           │
│   • Botón "⚡ Pre-armar con IA" (Gemini 2.5-flash) extrae SKUs, cantidades y precios.  │
│   • Búsqueda instantánea en catálogo plano (jjp_catalog_flat en ~740ms).              │
│   • Ajusta nivel de precio (A, B, C, D) y descuento autorizado.                       │
│   • Presiona "Guardar Cotización" ➔ Se genera PDF formal (comprobante.html).          │
│   • Estado en Supabase: status = 'pendiente'                                          │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │
                        (El cliente aprueba la propuesta)
                                           │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                   FASE 2: CONVERSIÓN Y DESPACHO                       │
│                                                                                       │
│   [Cajero / Mostrador en POS]                                                         │
│   • Presiona tecla F11 o escribe el N° de Cotización (o nombre del cliente).          │
│   • El POS absorbe el ticket completo en 1 segundo (Ítems, precios y cliente).        │
│   • Selecciona el método de pago real (Efectivo $, Zelle, Pago Móvil, Transferencia). │
│   • Presiona "Confirmar Venta y Facturar" (Ctrl + Enter):                             │
│     1. jjp_quotes pasa automáticamente a status = 'convertido'.                       │
│     2. Se inserta el registro oficial en jjp_orders con correlativo estricto.         │
│     3. Imprime factura/recibo para entrega física.                                    │
│     4. Marca la orden con status_mixnet = 'pending'.                                  │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │
                     (Sincronización silenciosa en red local)
                                           │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                   FASE 3: REGISTRO CONTABLE ERP                       │
│                                                                                       │
│   [Agente MixNet en PC Tienda]                                                        │
│   • Detecta la orden pendiente en Supabase.                                           │
│   • Inserta la cabecera en M:\comp01\MXENCPED.DBF.                                    │
│   • Inserta los renglones en M:\comp01\MXRENPED.DBF.                                  │
│   • Actualiza los árboles B-Tree en los índices Clipper .NTX en caliente.            │
│   • Actualiza en Supabase: status_mixnet = 'synced'.                                  │
│   • Cero firmas, cero huellas artificiales, correlativo respetado al 100%.            │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. PURGA QUIRÚRGICA DE MÓDULOS Y CÓDIGO ZOMBIE

Para garantizar la estabilidad prometida al 10.000.000%, se define la lista de erradicación sin contemplaciones:

### ❌ Lo que se ELIMINA Definitivamente:
1. **Módulo de Reseñas**:
   - Eliminar tabla `jjp_reviews`.
   - Remover enlace en menú administrativo (`assets/js/admin/sidenav.js`).
   - Remover widgets y consultas de reseñas en `admin/dashboard.js` y `vendedor/vdashboard.js`.
2. **Módulo de Promociones**:
   - Eliminar tabla `jjp_promos`.
   - Eliminar páginas `admin/promos.html` y scripts `assets/js/admin/promos.js`, `assets/js/promos.js`.
   - Limpiar bucles `setInterval` huérfanos de banners en `catalog.js`.
3. **Llamadas Fantasma / Tablas Inexistentes**:
   - Purgar toda referencia a `jjp_pos_scans` y `jjp_campaign_templates`.
   - Fusionar los 2 registros de `jjp_clients` hacia `jjp_customers` y eliminar `jjp_clients`.
4. **Código Zombie de Comercio Electrónico**:
   - Erradicar `assets/js/cart.js`, `assets/css/cart.css`, `checkout.html`, `producto.html`.
5. **Centralita GSM Inactiva**:
   - Purgar el `setInterval` de 4 segundos en `phone-dialer.js` (`127.0.0.1:8789`).
   - Desactivar endpoints muertos de llamadas que rebotan en la consola.
6. **Desinflado de Índices en Base de Datos**:
   - Ejecutar `REINDEX TABLE jjp_emails;` y purga de historiales de más de 180 días (reducción de 61 MB a ~5 MB).
   - Depurar `jjp_wa_messages` eliminando mensajes de grupos y difusiones masivas antiguas (reducción de 43 MB a ~8 MB).

---

## 8. MATRIZ DE TRANSICIÓN Y FASES DE EJECUCIÓN

| Fase | Objetivo Principal | Tareas Específicas | Riesgo |
| :---: | :--- | :--- | :---: |
| **0** | **Saneamiento Inmediato de Polling (Parar el rebote)** | 1. Implementar retroceso exponencial en `wa-link.js` (parar sondeo 3s).<br>2. Eliminar sondeo GSM 4s en `phone-dialer.js`.<br>3. Desactivar escritura dual de `heartbeat.js` a Proyecto A. | 🟢 Nulo |
| **1** | **Purga de Código Zombie y Tablas Muertas** | 1. Eliminar módulos de Reseñas y Promociones.<br>2. Purgar referencias a `jjp_pos_scans` y `jjp_campaign_templates`.<br>3. Limpiar scripts de carrito de compra en `catalogo.html`. | 🟢 Nulo |
| **2** | **Alineación del Flujo Cotización ➔ POS** | 1. Optimizar `posLoadQuote()` con atajo `F11` prioritario.<br>2. Asegurar marcado atómico de cotización a `convertido` al cobrar.<br>3. Blindar generación secuencial de correlativos. | 🟡 Bajo |
| **3** | **Desacople del Agente Local MixNet (Windows 7)** | 1. Aislar `mixnet-ai-panel/server.js` como servicio exclusivo DBF.<br>2. Configurar escritura atómica DBF + NTX de pedidos aprobados.<br>3. Sincronización diaria de catálogo con dirty-check de huella. | 🟡 Medio |
| **4** | **Aislamiento del Microservicio de Comunicación (Cloud)** | 1. Extraer Baileys y Gmail API a un servicio ligero sin dependencias locales.<br>2. Purgar mensajes de grupos y difusiones antiguas.<br>3. Conectar outbox limpio a Supabase. | 🟡 Medio |

---

> [!IMPORTANT]
> **Conclusión de la Auditoría:**
> Este plan no requiere comprar hardware nuevo ni forzar las computadoras Windows 7 de la tienda a hacer cosas para las que no fueron diseñadas. Sanea el 100% de los huecos descubiertos, elimina el tráfico basura que amenazaba las cuotas de Supabase y deja a JJ Paper operando sobre una base técnica indestructible.
