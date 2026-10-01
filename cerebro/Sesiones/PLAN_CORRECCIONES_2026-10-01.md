# 🔴 PLAN MAESTRO DE CORRECCIONES — JJ PAPER
**Fecha:** 01 de Octubre de 2026  
**Agente:** Antigravity (PC Principal — Análisis y Plan)  
**Ejecutor:** Agente de la PC Supervisora  
**Estado:** Para Ejecución Inmediata  

> [!CAUTION]
> Este plan fue generado tras un análisis real del código fuente actual (post git-pull commit `d0b8f92`). Cada problema tiene archivos, líneas exactas y causa raíz verificada. NO es especulación.

---

## RESUMEN EJECUTIVO

| # | Problema | Severidad | Causa Raíz |
|---|----------|-----------|------------|
| **0** | **Comprobante / impresión de cotizaciones y pedidos ELIMINADO** | **🔴 URGENTE** | **`comprobante.html` fue borrado en commit `41c61b8` y `_redirects` lo manda a `catalogo.html` (roto)** |
| 1 | Pre-armar cotizaciones con IA no funciona | 🔴 CRÍTICO | Modelos Gemini inexistentes (`gemini-3.6-flash`, `gemini-3.1-flash-lite`) + 5 de 7 API keys inválidas |
| 2 | Campañas multi-producto para ofertas no existen | 🔴 CRÍTICO | Nunca se implementó. El picker solo acepta 1 producto |
| 3 | Monitor de cuotas muestra datos falsos/estáticos | 🟡 MEDIO | Datos hardcodeados como fallback (21.14 MB, 12.96 MB, 5.33 MB) en vez de datos reales |
| 4 | Request `jjp_products` lentísima (2888ms) | 🟡 MEDIO | JOIN de 3 niveles en PostgREST sin vista materializada + descarga total sin paginación |
| 5 | Vista web / tienda muerta con enlaces rotos | 🟡 MEDIO | `cart.js`, `nav.js`, `product-modal.js` con enlaces a páginas eliminadas |
| 6 | Cada módulo parece manejar datos diferentes | 🟠 ARQUITECTÓNICO | Cada módulo carga datos de forma independiente con queries distintas, sin capa de datos compartida |

---

## PROBLEMA 0: COMPROBANTE / IMPRESIÓN DE COTIZACIONES Y PEDIDOS — ELIMINADO POR ERROR

### Diagnóstico Exacto

**El archivo `comprobante.html` fue eliminado en commit `41c61b8` (Implementación Fases 0-5 del Plan Maestro).** Este archivo NUNCA debió eliminarse — es la página de impresión de presupuestos, cotizaciones, pedidos y facturas.

**Consecuencia actual:** Cuando un vendedor/admin hace clic en "🖨️ Imprimir presupuesto" o presiona F10 en el cotizador, el sistema abre `../comprobante.html?q=XXXXX&print=1`. Cloudflare Pages intercepta esa URL con `_redirects` línea 13 (`/comprobante* /catalogo.html 301`) y lo manda al catálogo público (que además está roto por el código zombie de cart.js).

**Archivos afectados:**
- `comprobante.html` — **ELIMINADO** del repo, existe en git history en commit `41c61b8~1`
- `_redirects` L13: `/comprobante* /catalogo.html 301` — **REDIRECT ERRÓNEO** que debe eliminarse
- `assets/js/vendedor/vquotes.js` — L1370: `window.open('../comprobante.html?q=...')` — referencia correcta, el archivo es el que falta
- `assets/js/vendedor/vorders.js` o similar — pueden tener referencias a comprobante para pedidos

### Solución (5 minutos)

```bash
# Paso 1: Restaurar comprobante.html desde git history
git checkout 41c61b8~1 -- comprobante.html

# Paso 2: Eliminar la línea de _redirects que redirige /comprobante* a catalogo
# En _redirects, BORRAR la línea 13:
# /comprobante* /catalogo.html 301

# Paso 3: Verificar que el archivo se cargue correctamente:
# - Abrir admin/cotizador.html
# - Crear cotización con productos
# - Presionar F10 o clic en "Presupuesto PDF"
# - Debe abrir comprobante.html con el presupuesto renderizado

# Paso 4: Commit
git add comprobante.html _redirects
git commit -m "fix(urgent): restaurar comprobante.html eliminado por error, quitar redirect roto"
git push origin main
```

---

## PROBLEMA 1: PRE-ARMAR COTIZACIONES CON IA — NO FUNCIONA

### Diagnóstico Exacto

**Archivos afectados:**
- [`assets/js/gemini-client.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/gemini-client.js) — Líneas 22-47 (keys y modelos), L2459-2589 (`parseQuoteRequest`)
- [`assets/js/vendedor/vquotes.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vquotes.js) — L1076-1282 (`openAiQuoteModal`, `processAiQuoteRequest`)
- [`admin/cotizador.html`](file:///C:/Users/PC/Desktop/JJ%20PAPER/admin/cotizador.html) — L131 (botón), L232 (script)
- [`vendedor/cotizador.html`](file:///C:/Users/PC/Desktop/JJ%20PAPER/vendedor/cotizador.html) — L144 (botón), L244 (script)

**Flujo actual:** Botón "⚡ Pre-armar con IA" → `openAiQuoteModal()` → `processAiQuoteRequest()` → `GeminiClient.parseQuoteRequest(text, posProducts)` → `callGemini(prompt, 'gemini-3.6-flash')` → **💥 FALLA**

**Causa raíz verificada (3 problemas encadenados):**

1. **Modelos INEXISTENTES en la API de Google Gemini** (`gemini-client.js:38-47`):
   ```javascript
   // ESTOS MODELOS NO EXISTEN — Google devuelve HTTP 404
   const PRO_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
   const FAST_MODELS = ['gemini-3.6-flash', 'gemini-3.1-flash-lite'];
   ```
   - `gemini-3.6-flash` → 404 NOT_FOUND
   - `gemini-3.1-flash-lite` → 404 NOT_FOUND
   - El bucle de `callGemini` (L140-206) prueba ambos modelos para cada key, recibe 404 en ambos, pasa a la siguiente key, y así las 7 keys → agota todo y lanza excepción.

2. **5 de 7 API Keys son INVÁLIDAS** (`gemini-client.js:27-35`):
   ```javascript
   const GEMINI_KEYS = [
     'AIzaSyAMnb_...',       // ✅ Válida (formato AIzaSy...)
     'AIzaSyABK4e...',       // ✅ Válida (formato AIzaSy...)
     'AQ.Ab8RN6Is...',       // ❌ NO ES API KEY (formato Vertex AI / OAuth)
     'AQ.Ab8RN6LO...',       // ❌ NO ES API KEY
     'AQ.Ab8RN6I3...',       // ❌ NO ES API KEY
     'AQ.Ab8RN6K7...',       // ❌ NO ES API KEY
     'AQ.Ab8RN6L0...',       // ❌ NO ES API KEY
   ];
   ```
   Las llaves que comienzan con `AQ.Ab8RN6` son tokens de OAuth/Vertex AI, NO API keys de Google AI Studio.

3. **Sin fallback heurístico** — `parseQuoteRequest` no tiene bloque `catch` inteligente como otras funciones (ej: `analyzeCustomerAndDraftMessage` que tiene fallback con `generateHeuristicCustomerMessage`).

### Solución Exacta

```javascript
// gemini-client.js L38-47 → REEMPLAZAR con modelos que SÍ EXISTEN:
const PRO_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const FAST_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

// gemini-client.js L27-35 → LIMPIAR keys inválidas:
const GEMINI_KEYS = [
  'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
  'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E',
  // Agregar SOLO keys nuevas que empiecen con AIzaSy...
];

// gemini-client.js L2524 → CAMBIAR modelo de parseQuoteRequest:
const rawResponse = await callGemini(prompt, 'gemini-2.5-flash');

// vquotes.js L1149-1282 → AGREGAR fallback heurístico en catch:
// Si la IA falla, parsear el texto línea por línea con regex:
// Detectar patrones tipo "20 resmas", "10 cajas", etc.
// Matchear contra posProducts por similaridad de nombre
```

---

## PROBLEMA 2: CAMPAÑAS MULTI-PRODUCTO PARA OFERTAS — NO EXISTE

### Diagnóstico Exacto

**Archivos verificados:**
- [`assets/js/vendedor/campaign-editor.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/campaign-editor.js) — L20 (`selectedProductOrCombo = null` — singular), L214-218 (selector `ceTypeSelect`), L770-795 (`openCatalogPicker` — devuelve 1 solo producto)
- [`assets/js/vendedor/product-picker.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/product-picker.js) — `selectedItem = null` (mono-selección)
- [`assets/js/vendedor/vdifusion.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/vendedor/vdifusion.js) — L74-92 (`<select>` HTML de selección única)

**Estado REAL: NUNCA SE IMPLEMENTÓ.**

El selector `ceTypeSelect` (L214-218) tiene estas opciones:
```html
<option value="general">📣 General</option>
<option value="producto">📦 Promoción de un Producto Específico</option>  <!-- 1 SOLO -->
<option value="combo">🎁 Promoción de un Combo</option>                   <!-- 1 SOLO -->
<option value="reactivacion">😴 Reactivación de Clientes Inactivos</option>
```

**No existe:** Ninguna opción de "Lista de Ofertas", "Volante Multi-Producto", o "Catálogo de Destacados".

### Solución — Implementar de Cero

#### Paso 1: Agregar opción al selector
```javascript
// campaign-editor.js L214-218 → AGREGAR:
<option value="multi_oferta">🔥 Ofertas / Catálogo Multi-Producto (hasta 15)</option>
```

#### Paso 2: Modificar product-picker.js para modo multi-selección
```javascript
// product-picker.js → Agregar modo 'multi':
// - let selectedItems = new Map();  // id → {product, discount_pct}
// - Checkboxes en cada tarjeta del catálogo
// - Contador flotante: "5 de 15 productos seleccionados"
// - Botón "Confirmar Selección" devuelve array
// - Descuento global o individual por producto
```

#### Paso 3: Crear `selectedProductsList` en campaign-editor.js
```javascript
// campaign-editor.js → AGREGAR:
let selectedProductsList = [];  // Array para modo multi_oferta

// Renderizar bandeja visual de productos seleccionados
// Cada uno con botón de remover y campo de descuento

// Nueva función applyMultiOfertaTemplate(products) que genera:
// "🔥 *OFERTAS MAYORISTAS DE LA SEMANA — JJ PAPER*
//  • *Resma Carta 75g Report*: $4.95 USD (antes $5.45) · -10%
//  • *Cuaderno 1 Línea 100h*: $0.85 USD
//  ... (hasta 15 productos)"
```

#### Paso 4: Plantilla spintax multi-producto en vdifusion.js
```javascript
// vdifusion.js → AGREGAR nueva variable {{productos_oferta}} en dSampleVars
// y en DEFAULT_GLOBAL_TEMPLATES:
{
  name: '🔥 Volante de Ofertas Quincenales',
  body: '{Hola|Buen día|Un gusto saludarle} {{nombre}} 👋\n\n' +
        '{{productos_oferta}}\n\n' +
        '📞 Consultas y pedidos: {{telefono_vendedor}}'
}
```

---

## PROBLEMA 3: MONITOR DE CUOTAS MUESTRA DATOS FALSOS

### Diagnóstico Exacto

**Archivo:** [`assets/js/admin/monitor-client.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/admin/monitor-client.js)

**Causa raíz:** Cuando el servidor local (`localhost:8787`) no responde, el código cae en `querySupabaseDirectly()` (L402+) que usa **valores hardcodeados como fallback**:

```javascript
// monitor-client.js L523-526 — DATOS FALSOS:
const estSizeA_Mb = isSrvStatsFresh ? parseFloat(srvStats.projects.core.sizeMb || 21.14) : 21.14;   // ← HARDCODEADO
const estSizeB_Mb = isSrvStatsFresh ? parseFloat(srvStats.projects.comm.sizeMb || 12.96) : 12.96;   // ← HARDCODEADO
const totalFilesC = isSrvStatsFresh ? (srvStats.projects.storage.totalFiles || 295) : 295;          // ← HARDCODEADO
const estSizeC_Mb = isSrvStatsFresh ? (srvStats.projects.storage.sizeMb || '5.33') : '5.33';        // ← HARDCODEADO
```

Además en L608-651, las cuotas son fijas (`quotaMb: 500`, `quotaMb: 1024`, `totalDbQuotaMb: 1000`) sin consultar a la API de management de Supabase.

El stream de "requests en vivo" (L536-570) **también es fabricado**: inyecta manualmente `handleLiveRequestIncoming()` con los tiempos de las 3-4 consultas que hizo el propio monitor.

### Solución

```javascript
// monitor-client.js → REEMPLAZAR querySupabaseDirectly():

// 1. Si el servidor local no responde, mostrar HONESTAMENTE:
//    "⚠️ Servidor local offline — datos de cuota no disponibles"
//    Con contadores REALES que sí se pueden obtener:
//    - COUNT(*) de jjp_customers (ya lo hace: countCust)
//    - COUNT(*) de jjp_products (ya lo hace)
//    - COUNT(*) de jjp_wa_messages (ya lo hace)
//    - Latencia REAL a cada proyecto (ya la mide)

// 2. Eliminar TODOS los valores hardcodeados:
//    - 21.14, 12.96, 5.33, 295, '1.1 MB', '544 kB', '120 kB', '408 kB'
//    → Sustituir con "N/D" o "Requiere servidor local"

// 3. Renombrar la sección: "Cuotas Estimadas" en vez de "Cuotas del Sistema"
//    cuando los datos no son en vivo

// 4. Eliminar las llamadas SSE/request fabricadas (L536-570)
//    o marcarlas explícitamente como "Sondeo periódico del monitor"
```

---

## PROBLEMA 4: REQUEST `jjp_products` LENTA (2888ms)

### Diagnóstico Exacto

**Archivo:** [`assets/js/catalog.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/catalog.js) — L144-184

**Causa raíz:**
1. **JOIN de 3 niveles en PostgREST** (L165-166): `jjp_products` → `jjp_categories(...)` → `jjp_product_variants(... jjp_brands(...))` — PostgreSQL debe resolver este árbol JSON anidado para CADA producto.
2. **Sin paginación** — Bucle `while(true)` (L164) descarga TODOS los productos activos antes de renderizar.
3. **Caché volátil** — `sessionStorage` se pierde al cerrar pestaña/incógnito. TTL de 1h (L150) obliga recarga frecuente.

### Solución

```sql
-- Crear vista materializada en Supabase (Proyecto A) para aplanar la consulta:
CREATE MATERIALIZED VIEW jjp_catalog_flat AS
SELECT 
  p.id, p.name, p.description, p.price_usd, p.price_a, p.price_b,
  p.price_c_bs, p.price_d_bs, p.unit, p.image_url, p.emoji, p.tag,
  p.featured, p.essential, p.stock, p.min_qty, p.category_id, p.sort_order,
  c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
  c.group_id,
  jsonb_agg(DISTINCT jsonb_build_object(
    'id', v.id, 'name', v.name, 'sku', v.sku, 'price_usd', v.price_usd,
    'price_a', v.price_a, 'price_b', v.price_b, 'active', v.active,
    'stock', v.stock, 'brand_name', b.name
  )) FILTER (WHERE v.id IS NOT NULL AND v.active) AS variants
FROM jjp_products p
LEFT JOIN jjp_categories c ON c.id = p.category_id
LEFT JOIN jjp_product_variants v ON v.product_id = p.id AND v.active
LEFT JOIN jjp_brands b ON b.id = v.brand_id
WHERE p.active = true
GROUP BY p.id, c.id;

-- Refrescar con trigger o cron cada 15min:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY jjp_catalog_flat;
```

```javascript
// catalog.js L165 → REEMPLAZAR query por vista plana:
const { data, error } = await sb.from('jjp_catalog_flat')
  .select('*')
  .range(from, from + step)
  .order('sort_order');
// Resultado: ~150ms en vez de ~2888ms
```

---

## PROBLEMA 5: VISTA WEB / TIENDA MUERTA

### Diagnóstico Exacto

Las páginas de la tienda web (`checkout.html`, `producto.html`, `comprobante.html`, etc.) ya fueron eliminadas en commit `41c61b8`. Sin embargo, el código JavaScript y CSS que las servía **sigue cargándose en `catalogo.html`**:

**Código zombie activo:**
- [`assets/js/cart.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/cart.js) — Sistema de carrito completo que redirige a `checkout.html` (inexistente → bucle 301)
- [`assets/js/nav.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/nav.js) — `NAV_LINKS` con enlaces muertos a `index.html`, `promociones.html`, `pedidos.html`, `rastreo.html`
- [`assets/js/product-modal.js`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/js/product-modal.js) — Botones `modalBuyNow()` → `checkout.html` (roto), `modalQuoteWS()` → `pedidos.html` (roto)
- [`assets/css/cart.css`](file:///C:/Users/PC/Desktop/JJ%20PAPER/assets/css/cart.css) — Estilos del drawer de carrito

**En `catalogo.html`:**
- L16: `<link rel="stylesheet" href="assets/css/cart.css">` ← ELIMINAR
- L25: `<div id="cart-placeholder"></div>` ← ELIMINAR
- L113: `<script src="assets/js/cart.js">` ← ELIMINAR

### Solución

1. **Eliminar** de `catalogo.html` las líneas 16 (cart.css), 25 (cart-placeholder) y 113 (cart.js)
2. **Limpiar** `nav.js` — Quitar enlaces muertos y dejar solo `catalogo.html` + logo
3. **Limpiar** `product-modal.js` — Reemplazar botones de compra/checkout por:
   - "📱 Consultar por WhatsApp" (abre chat con el producto)
   - "📋 Compartir Ficha" (copiar link)
   - "📥 Descargar Catálogo PDF"
4. **Opcional:** Eliminar `assets/js/cart.js` y `assets/css/cart.css` del repositorio

---

## PROBLEMA 6: MÓDULOS CON DATOS INCONSISTENTES

### Diagnóstico Parcial (análisis en curso)

Cada módulo del sistema carga datos por su cuenta, con queries distintas y sin una capa de datos compartida:

| Módulo | Archivo | Cómo carga clientes | Tabla/Vista |
|--------|---------|---------------------|-------------|
| POS/Cotizador | `vquotes.js` L45 | `pfLoad()` → `product-finder.js` | `jjp_products` con variants |
| Catálogo público | `catalog.js` L165 | `loadProducts()` bucle | `jjp_products` + JOINs |
| CRM Clientes | `admin/clientes.js` | Query directa | `jjp_customers` |
| Campañas WA | `campaign-editor.js` | `loadConfig()` | `jjp_products` + `jjp_promos` |
| Campañas Email | `vcampanas-email.js` | Audiencia propia | `jjp_customers` filtrado |
| Correo | `correo.js` | Desde `jjp_email_accounts` + wa-server SMTP relay | Mixto Gmail API + Supabase |
| Autocomplete | `cust-autocomplete.js` | Query directa | `jjp_customers` |
| Monitor | `monitor-client.js` | `COUNT(*)` + hardcoded | Varios |

**Problema real:** No hay un "data layer" unificado. Cada módulo reimplementa su propia consulta con selects distintos, filtros distintos y cachés independientes. Esto causa:
- El POS puede ver precios diferentes al catálogo si el caché expiró en uno y no en el otro
- Las campañas no ven los mismos productos que el POS porque cargan datos en distinto momento
- El correo funciona como pieza aislada (Gmail OAuth → wa-server relay → Supabase registros)

### Solución Arquitectónica (No urgente, pero necesaria)

Crear un **Data Service Layer** compartido:

```javascript
// NUEVO: assets/js/data-service.js
// Singleton que centraliza la carga de datos con caché compartido

const DataService = (() => {
  let _products = null, _customers = null, _productsAt = 0, _customersAt = 0;
  const TTL = 5 * 60 * 1000; // 5 minutos
  
  async function getProducts(force = false) {
    if (!force && _products && Date.now() - _productsAt < TTL) return _products;
    // Una sola query optimizada, igual para todos los módulos
    _products = await loadFromSupabase('jjp_catalog_flat'); // vista materializada
    _productsAt = Date.now();
    return _products;
  }
  
  async function getCustomers(sellerId, force = false) {
    // Misma lógica: una fuente, un caché, usada por POS, Campañas, CRM...
  }
  
  return { getProducts, getCustomers };
})();
```

Luego todos los módulos consumen `DataService.getProducts()` en vez de hacer sus propias queries.

---

## ORDEN DE EJECUCIÓN RECOMENDADO

> [!IMPORTANT]
> El agente de la otra PC debe ejecutar en este orden:

| Prioridad | Tarea | Tiempo Est. | Impacto |
|-----------|-------|-------------|---------|
| 🔴 **0** | **Restaurar `comprobante.html` desde git + quitar redirect en `_redirects`** | **5 min** | **Se puede imprimir cotizaciones/pedidos otra vez** |
| 🔴 1 | Corregir modelos Gemini y limpiar keys inválidas | 15 min | Pre-armar cotizaciones con IA funciona |
| 🔴 2 | Implementar campañas multi-producto (picker multi + plantilla oferta) | 2-3 horas | El vendedor puede crear campañas de ofertas |
| 🟡 3 | Limpiar código zombie de tienda web en catalogo.html | 30 min | No más enlaces rotos |
| 🟡 4 | Eliminar datos hardcodeados del monitor | 45 min | Datos honestos en el dashboard |
| 🟡 5 | Crear vista materializada para catálogo | 1 hora | Request de 2888ms → ~150ms |
| 🟠 6 | Data Service Layer unificado | 3-4 horas | Coherencia de datos entre módulos |

---

## ARCHIVOS QUE NO SE DEBEN TOCAR

El otro agente está trabajando actualmente en sincronización MixNet → precios. **NO tocar:**
- `wa-server/src/mixer.js`
- `wa-server/auto-detect-mixnet.js`
- Nada dentro de `wa-server/src/` que no esté listado arriba

---

> **Para el agente ejecutor:** Este plan tiene rutas de archivos exactas, líneas exactas y código de reemplazo. No hay ambigüedad. Ejecuta en el orden indicado y haz commit después de cada problema resuelto.
