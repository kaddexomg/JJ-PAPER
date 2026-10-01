# 🔧 Plan Maestro de Corrección y Mejora — JJ Paper

> Basado en auditoría profunda del código real · 30 de septiembre 2026
> **Regla**: Este documento es solo el plan. No se toca código hasta tu aprobación.

---

## Resumen Ejecutivo

Se auditaron **+120 archivos** del sistema (frontend, wa-server, mixer, IA, campañas). Se encontraron:

| Severidad | Hallazgos |
|---|---|
| 🚨 **Críticos** (rompen producción) | 6 |
| ⚠️ **Altos** (funcionalidad rota/incompleta) | 8 |
| 🟡 **Medios** (degradan experiencia) | 5 |
| 🟢 **Mejoras** (optimización/nuevas capacidades) | 4 |

---

## FASE 0 — Bugs Críticos Paralizantes
> *Estos errores están rompiendo cosas AHORA. Deben corregirse primero.*

### 0.1 🚨 `ReferenceError: vendorNote` mata la sincronización MixNet
- **Archivo**: [`wa-server/src/mixer.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixer.js) — Líneas 1251 y 1284
- **Función**: `sweepMixnetDbf()`
- **Qué pasa**: Al importar un pedido/cotización de MixNet, el código intenta loguear `vendorNote` pero esa variable **no existe** en el scope. Lanza `ReferenceError` que detiene la ejecución silenciosamente → **los documentos posteriores en el barrido no se procesan**.
- **Solución**: Definir `vendorNote` (extraerla del mapeo de vendedor) o eliminar la referencia del log.

### 0.2 🚨 Cotizaciones de IA no tienen SKU ni variant_id → No descuentan stock
- **Archivos**:
  - [`assets/js/gemini-client.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/gemini-client.js) — Líneas 2517-2527, función `parseQuoteRequest`
  - [`assets/js/vendedor/vquotes.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vquotes.js) — Línea 1191, función `processAiQuoteRequest`
- **Qué pasa**: Cuando la IA arma una cotización y matchea productos del catálogo, el objeto de retorno **omite extraer `sku` y `variant_id`** del producto encontrado.
- **Consecuencia**:
  1. SKU vacío → MixNet no puede sincronizar el pedido de vuelta
  2. `variant_id = null` → La RPC `jjp_apply_order_stock` no puede descontar inventario
  3. **Los pedidos creados por IA nunca descuentan stock**
- **Solución**: En `parseQuoteRequest`, incluir `sku: matched.sku, variant_id: matched.variant_id || matched.id` al objeto de retorno.

### 0.3 🚨 Precios `NaN` cuando se cambia nivel de precio en ticket de IA
- **Archivo**: [`assets/js/vendedor/vquotes.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vquotes.js) — Líneas 1198-1199
- **Función**: `processAiQuoteRequest`
- **Qué pasa**: El ensamblado del ticket usa `price_c` y `price_d`, pero el POS espera `price_c_bs` y `price_d_bs`. Al cambiar el nivel de precio a C o D → `undefined` → **total = NaN**.
- **Solución**: Renombrar a `price_c_bs` y `price_d_bs` con la conversión correcta a bolívares.

### 0.4 🚨 Ticket se blanquea al cargar cotizaciones guardadas como string
- **Archivo**: [`assets/js/vendedor/pos.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/pos.js) — Línea 1297
- **Función**: `posLoadQuote`
- **Qué pasa**: A diferencia de `posLoadOrderForEdit` (que tiene `typeof o.items === 'string' ? JSON.parse(o.items) : ...`), la carga de cotizaciones solo hace `Array.isArray(q.items) ? q.items : []`. Si Supabase retorna los ítems como string JSON → **el ticket queda vacío**.
- **Solución**: Agregar el mismo parseo condicional que usa `posLoadOrderForEdit`.

---

## FASE 1 — Limpieza de la Vista Web Pública
> *Eliminar todo lo que no se usa para ahorrar egress y simplificar el sistema.*

### 1.1 Archivos HTML a ELIMINAR del deploy

| Archivo | Motivo | Queries que dispara |
|---|---|---|
| `index.html` | Portada pública (nadie la visita) | 4-5 queries (featured, best sellers, promos, reviews) + descarga de imágenes |
| `checkout.html` | Checkout web (no se usa) | Carga completa del carrito + Leaflet + cálculo de delivery |
| `comprobante.html` | Visor de comprobantes (no se usa) | Query de pedidos + firma de Storage |
| `pedidos.html` | Formulario de cotización online | Carga de catálogo completo + cliente |
| `rastreo.html` | Rastreo de pedidos (no se usa) | RPC `jjp_track_order` |
| `promociones.html` | Feed público de ofertas | Query de `jjp_promos` + imágenes |
| `producto.html` | Ficha SEO de producto | Query individual + variantes + imagen |

### 1.2 Archivos JS a ELIMINAR (exclusivos del frontend público)

| Archivo | Función |
|---|---|
| `assets/js/chatbot.js` | Chatbot público (carga TODO el catálogo en RAM) |
| `assets/js/checkout.js` | Lógica de checkout y delivery |
| `assets/js/hero-promos.js` | Carrusel de promociones en index |
| `assets/js/orders.js` | Formulario público de pedidos |
| `assets/js/reviews.js` | Reseñas de usuarios |
| `assets/js/reveal.js` | Animaciones de scroll (solo index) |
| `assets/js/motion.js` | Animaciones (solo index) |
| `assets/js/logo3d.js` | Logo 3D animado (solo index) |

### 1.3 Archivos que DEBEN MANTENERSE

| Archivo | Razón |
|---|---|
| `catalogo.html` | **Canal único vendedor → cliente** |
| `assets/js/catalog.js` | Motor del catálogo |
| `assets/js/product-modal.js` | Modal de producto |
| `assets/js/cart.js` | Armar listas para enviar por WA (evaluar) |
| `assets/js/config.js` | Configuración base |
| `assets/js/auth.js` | Autenticación |
| Todo `/admin/` y `/vendedor/` | Paneles internos |

### 1.4 Acción en `build.sh`
Agregar exclusiones explícitas para que los archivos eliminados no lleguen a `dist/`.

### 1.5 Acción en `_redirects`
Redirigir todas las URLs públicas muertas a `catalogo.html`:
```
/checkout*     /catalogo.html  301
/pedidos*      /catalogo.html  301
/rastreo*      /catalogo.html  301
/promociones*  /catalogo.html  301
/producto*     /catalogo.html  301
/comprobante*  /catalogo.html  301
/              /catalogo.html  301
```

### Impacto estimado
- **Ahorro de egress**: ~500 MB–1 GB/mes (imágenes del catálogo público + queries innecesarias)
- **Reducción de complejidad**: ~8 archivos HTML + ~8 archivos JS eliminados del deploy

---

## FASE 2 — Reparación del Puente Bidireccional MixNet
> *Que JJ Paper escriba en MixNet exactamente como MixNet escribe, sin huellas.*

### 2.1 ⚠️ Corregir variable `vendorNote` que rompe el barrido
- **Ya descrito en FASE 0.1** — prioridad máxima.

### 2.2 ⚠️ Asegurar renglones completos (todos los productos de la cotización/pedido)
- **Archivo**: [`wa-server/src/mixer.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixer.js)
- **Problema**: El sistema lee renglones de `MXRENPED.DBF` / `MXRENCOT.DBF` pero puede perder ítems si hay registros marcados como borrados (`0x2A`) intercalados.
- **Verificación necesaria**: Auditar que `readDbfRows` en [`mixnet-dbf-writer.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/mixnet-dbf-writer.js) no salte registros válidos cuando encuentra uno marcado como eliminado.

### 2.3 🟡 Carga diaria en vez de sincronización continua
- **Concepto del usuario**: Los archivos locales (clientes, perfiles, productos) no cambian durante el día. Solo se necesita **1 carga diaria** al arrancar el servidor.
- **Implementar**:
  - `sweepMixnetProducts()` → Ejecutar **1 vez al arrancar** + **botón manual** `/lan/mixnet/sync-now`. Eliminar el `setInterval` de 24h residual.
  - Clientes de MixNet → Cargar 1 vez al arrancar desde `MXCTACLI.DBF` al caché RAM de `api-local.js`.
  - Crear endpoint `/lan/mixnet/refresh` para forzar recarga manual cuando sea necesario.

### 2.4 ⚠️ Escritura indetectable hacia MixNet
- **Estado actual**: `mixnet-dbf-writer.js` ya implementa `appendDbfRecords`, `upsertDbfHeader`, `replaceDbfDetails` y `buildDbfRecord`. Los campos `COMEN1`/`COMEN2` se dejan en blanco (espacios) cuando no hay comentarios reales — **esto es correcto**.
- **Verificar**:
  1. Que los correlativos (`MXNUMPED`/`MXNUMCOT`) se generan con `getNextSerial()` leyendo el máximo actual del DBF + 1, sin prefijos `PED-` ni `COT-` ni `JJP-`.
  2. Que el formato de 8 dígitos se respeta (`padStart(8, '0')`).
  3. Que no se escriben timestamps ni marcas de agua en ningún campo.
  4. Que los índices `.NTX` se actualizan correctamente (o se instruye al usuario a reindexar después de la escritura).

### 2.5 Usuarios fantasma de MixNet
- **Limpiar** perfiles de zonas 1000+ en `jjp_profiles` de Core.
- **Usuarios activos definitivos**: Keyder (010/020→005), Yovanni (004/006), Marianela (008), Andreina (014).
- **Ventas sin vendedor asignado**: Marcar como `seller_id = null` con etiqueta "Sin vendedor" en la UI.

---

## FASE 3 — Datos: Prospectos, Teléfonos y Emails Múltiples
> *Corregir la lectura de datos de contacto que está rota.*

### 3.1 🚨 Teléfonos pegados/mutilados en prospectos
- **Archivo**: [`assets/js/vendedor/campaign-editor.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/campaign-editor.js) — Línea 63
- **Función**: `normPhoneKey(p)`
- **Qué pasa**: `.slice(-11)` corta el dígito `5` del código de Venezuela en números de 12 dígitos (`584141234567` → `84141234567`). Rompe el filtro anti-spam.
- **Solución**: Normalizar correctamente reconociendo el prefijo `58` y manteniendo los 10 dígitos nacionales.
- **Además**: Verificar que los datos de prospectos en `jjp_prospects` no tengan teléfonos concatenados en un solo campo. Si una empresa tiene 2 teléfonos, deben separarse en `phone_1` y `phone_2` (campos que ya existen en la tabla).

### 3.2 🚨 Empresas con 2 correos (compras vs info) no se manejan
- **Archivo**: [`assets/js/vendedor/vcampanas-email.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vcampanas-email.js) — Línea 471
- **Problema**: El regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` rechaza campos con 2 correos separados por coma.
- **Solución propuesta (2 opciones)**:
  - **Opción A**: Agregar columna `email_2` a `jjp_prospects` para el correo secundario (compras). La campaña envía a ambos.
  - **Opción B**: Soportar emails separados por coma en el campo `email`. Al despachar, splitear y enviar a cada uno.
- **Recomendación**: **Opción A** — un campo `email_2` con etiqueta "Correo de Compras". El editor de campañas muestra un checkbox "Enviar a ambos correos" cuando el prospecto tiene los 2.

### 3.3 ⚠️ Pérdida silenciosa de prospectos por límite de 1,000 filas
- **Archivo**: [`assets/js/vendedor/vcampanas-email.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vcampanas-email.js) — Líneas 452-461
- **Problema**: `loadEcContacts()` no pagina → si hay >1,000 clientes con email, el resto se pierde sin aviso.
- **Solución**: Implementar paginación con `.range()` como ya se hace en `vdifusion.js` para clientes (pero `vdifusion.js` también olvida paginar prospectos).

### 3.4 ⚠️ Sincronizar 9 perfiles faltantes en Proyecto B
- **Problema**: Solo Keyder y Adriana existen en `jjp_profiles` de Comm. Los otros 9 vendedores no pueden usar WhatsApp/Email por violación de FK.
- **Solución**: INSERT de los 9 perfiles faltantes con los mismos IDs que tienen en Core.

### 3.5 🟡 Clientes basura con teléfonos falsos (`sn-<timestamp>`)
- **Archivo**: [`assets/js/admin/vprospectos.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/vprospectos.js) — Línea 739
- **Función**: `convertProspectToCustomer`
- **Qué pasa**: Si el prospecto no tiene teléfono, genera `sn-1727654321000` como número falso.
- **Solución**: Permitir `phone = null` en `jjp_customers` en lugar de fabricar datos falsos. O usar el campo `notes` para marcar "Sin teléfono verificado".

---

## FASE 4 — IA Comercial Avanzada
> *De "bot genérico" a "vendedor estrella" con contexto real.*

### 4.1 ⚠️ Sugerencias de WhatsApp ciegas (no leen ficha del cliente)
- **Archivo**: [`assets/js/wa/wa-chat.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/wa/wa-chat.js) — `suggestWhatsAppReplies`
- **Estado actual**: Solo lee los últimos 5 mensajes del chat. **No sabe** qué compró el cliente, de qué sector es, ni tiene acceso al catálogo.
- **Mejora**:
  1. Inyectar `waFicha` (historial de pedidos, sector, zona) al prompt
  2. Incluir mini-catálogo de top 20 productos con precios actualizados a tasa BCV
  3. Aplicar el mismo nivel de prompt de `analyzeAndDraftProspectB2B` (que sí es excelente)

### 4.2 ⚠️ Correos desconectados del CRM
- **Archivo**: [`assets/js/admin/correo.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/correo.js) — Línea 903
- **Qué pasa**: Al seleccionar "Propuesta B2B", solo pasa nombre y notas al Gemini. **Pierde** el `customerId`, historial de compras y sector.
- **Mejora**: Pasar el objeto `customerFull` (con pedidos, zona, último pedido) cuando hay un ID de cliente seleccionado.

### 4.3 🟢 Nuevo: Call-to-Action obligatorio en todo mensaje
- **Regla**: Cada mensaje generado debe cerrar con una pregunta de baja fricción:
  - *"¿Para qué zona sería el despacho?"*
  - *"¿Le aparto las cajas disponibles?"*
  - *"¿Desea que le arme el pedido formal?"*
- **Prohibir** finales muertos como *"Quedo a su disposición"* o *"Estamos para servirle"*.

### 4.4 🟢 Nuevo: Cross-sell dinámico
- Si el cliente pide resmas → sugerir carpetas y clips
- Si pide rollos térmicos → sugerir cinta de embalaje
- Si pide cartulinas → sugerir marcadores y tijeras
- Agregar matriz de complementarios al prompt del Gemini.

### 4.5 🟢 Nuevo: Variaciones más humanas y personalizadas
- **Estado actual**: El motor anti-spam genera variaciones Spintax que cambian sinónimos pero no varían la estructura del mensaje.
- **Mejora**:
  - Incluir el nombre del contacto y empresa en la variación
  - Variar el saludo (formal vs coloquial venezolano)
  - Variar la estructura (empezar con pregunta vs afirmación vs dato)
  - Rotar CTAs entre mensajes

### 4.6 🟢 Top 20 productos en memoria para IA
- **Modificar** `getBusinessContext()` en `gemini-client.js` para incluir los 20 productos de mayor rotación con precios actualizados.
- La IA del chat y correo tendrá un "cerebro comercial" inmediato sin queries adicionales.

---

## FASE 5 — Rendimiento y Estabilidad
> *Sistema rápido y que no se caiga.*

### 5.1 ⚠️ Memory leak en caché de validación WA
- **Archivo**: [`wa-server/src/campaigns.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/campaigns.js) — Línea 24 (`onWaCache`)
- **Problema**: Las claves del Map nunca se eliminan. En difusiones masivas → crece infinitamente hasta colapsar RAM.
- **Solución**: Implementar `setInterval` de limpieza que purgue entradas con TTL expirado cada 30 minutos. O usar un LRU Cache con tamaño máximo.

### 5.2 ⚠️ Sobrecarga del navegador con 12,000+ contactos en DOM
- **Archivo**: [`assets/js/vendedor/vdifusion.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vdifusion.js) — `loadDContacts`
- **Problema**: Carga todos los contactos iterando en bloques de 1,000 hasta traer 12,000+ registros a la memoria del navegador y los renderiza en una tabla DOM gigante.
- **Solución**: Implementar paginación visual (50 contactos por página) con búsqueda server-side, o al menos virtualización del DOM.

### 5.3 🟡 Fallback de sesión WA confunde al cliente
- **Archivo**: [`wa-server/src/outbox.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/outbox.js) — Líneas 91-98
- **Problema**: Si el vendedor está desconectado, envía desde el número de otro vendedor.
- **Solución**: Mantener el mensaje en `pending` hasta que el vendedor dueño reconecte. Solo hacer fallback con mensajes de tipo "campaña" (no personales).

### 5.4 🟡 Polling + Realtime redundante en server-control
- **Archivo**: [`assets/js/admin/server-control.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/server-control.js)
- **Estado**: Polling cada 120s + canal WebSocket simultáneo.
- **Solución**: Confiar solo en Realtime. Polling solo como fallback cada 5 minutos.

### 5.5 🟡 Bug de caché corrupta en catálogo
- **Archivo**: [`assets/js/catalog.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/catalog.js) — Línea ~180
- **Problema**: Guarda en `sessionStorage` solo el último chunk de productos (`data`) en vez de `allData` (el array completo concatenado).
- **Solución**: Cambiar `sessionStorage.setItem(cacheKey, JSON.stringify(data))` por `JSON.stringify(allData)`.

---

## FASE 6 — Promociones y Catálogo B2B
> *El catálogo como canal directo de vendedores hacia clientes.*

### 6.1 Transformar `catalogo.html` en landing principal
- Redirigir `/` → `/catalogo.html`
- Destacar productos en oferta al tope (integrar `jjp_promos` directamente)
- Botón "Solicitar cotización por WhatsApp" en cada producto
- Mostrar precios públicos (nivel A) con tasa BCV actualizada

### 6.2 Sistema de Promociones mejorado
- **Tabla `jjp_promos`**: Ya existe y está vacía. Cargar las ofertas de octubre.
- **Gestión desde admin**: Hacer más interactivo el panel `admin/promociones.html`:
  - Selector visual de productos (con imagen)
  - Fecha de inicio y fin
  - Porcentaje de descuento o precio especial
  - Badge visual en el catálogo ("🔥 -20%" / "⭐ Oferta")
  - Notificación automática por WA/Email a clientes interesados en ese tipo de producto

### 6.3 Compartir catálogo por vendedores
- Generar links directos a productos: `catalogo.html?producto=SKU123`
- Los vendedores copian y envían por WhatsApp
- El cliente ve la ficha con precio, imagen y botón "Pedir cotización"

---

## Orden de Ejecución Recomendado

```
SEMANA 1 (Urgente):
├── FASE 0: Bugs críticos (0.1 → 0.4)         ← 2-3 horas
├── FASE 3.4: Sincronizar perfiles en Comm     ← 30 min
└── FASE 1: Eliminar vista web pública         ← 1-2 horas

SEMANA 2 (Importante):
├── FASE 2: Reparación MixNet (2.2 → 2.5)     ← 4-6 horas
├── FASE 3: Teléfonos, emails, paginación      ← 3-4 horas
└── FASE 5: Rendimiento (memory leak, caché)   ← 2-3 horas

SEMANA 3 (Mejoras):
├── FASE 4: IA Comercial (4.1 → 4.6)          ← 6-8 horas
└── FASE 6: Catálogo B2B y Promociones         ← 4-5 horas
```

---

## Ahorro Estimado de Egress

| Optimización | Ahorro mensual estimado |
|---|---|
| Eliminar vista web pública | ~500 MB – 1 GB |
| Carga diaria en vez de sondeo continuo | ~200 MB |
| Bug de caché corrupta de catálogo (L180) | ~300 MB |
| Poda de columnas adicional | ~200 MB |
| **Total estimado** | **~1.2 – 1.7 GB/mes** |

Con las optimizaciones de ayer (dirty-check, heartbeat, batch upsert, TTL 60min) + estas nuevas, el consumo de egress debería bajar a **<2 GB/mes** — muy dentro de la cuota de 5 GB.
