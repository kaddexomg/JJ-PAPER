# 🔧 Diagnóstico y Correcciones — Campañas WhatsApp

## Problemas Encontrados

### 🐛 BUG 1: Variables de plantilla NO se reemplazan con datos reales del cliente
**Causa raíz:** En `renderTemplate()` del servidor (`campaigns.js` línea 153-163), el código tiene un **conflicto entre Spintax y variables**. La primera regex `\{([^{}]+?)\}` captura las llaves simples del Spintax `{Hola|Buen día}`, pero por su naturaleza greedy, al encontrar `{{nombre}}` primero procesa `{nombre}` (la llave interna) y lo devuelve como texto plano (ya que no contiene `|` ni es Spintax) — esto **destruye la llave externa** dejando `{nombre}` en vez de `{{nombre}}`, por lo que la segunda regex que busca `{{variable}}` ya **nunca encuentra match**.

**Además**, las variables (`t.vars`) se guardan en el frontend con datos de muestra (`dSampleVars()`) en vez de personalizarse por cada cliente. Esto significa que todos los targets reciben las **mismas variables** (por ejemplo siempre dice "Distribuidora Alfa" en vez del nombre real del cliente).

### 🐛 BUG 2: Imagen del producto NO se envía — `Object not found` en Storage
**Causa raíz:** Cuando se adjunta la imagen de un producto (`prod_image`), el código guarda en `media_path` la **URL pública de Supabase Storage** (ej: `https://xxx.supabase.co/storage/v1/object/public/jjp-products/...`) en vez del **path relativo** del bucket `jjp-wa-media`. Luego el servidor intenta hacer `db.storage.from('jjp-wa-media').download(url_completa)` → `Object not found`.

**Segundo problema:** La query de productos en `vdifusion.js` línea 46 **NO incluye `image_url`** en el select de `jjp_products`, así que `image_url` siempre es `undefined`.

### 🐛 BUG 3: Error de columna `forwarded` en jjp_wa_messages
**Causa raíz:** El servidor escribe `forwarded: !!ctx?.isForwarded` en el insert de mensajes entrantes, pero la tabla `jjp_wa_messages` no tiene esta columna en el schema cache de Supabase. El error: `Could not find the 'forwarded' column of 'jjp_wa_messages' in the schema cache`.

### ⚠️ BUG 4: Spam masivo de logs de email
**Observación:** El log muestra cientos de líneas repetidas `"cuenta de correo verificada ✅"` por segundo — esto indica un loop de verificación sin throttle.

---

## Correcciones Aplicadas

### ✅ FIX 1: `renderTemplate()` en `campaigns.js` — Regex arreglada
La regex del Spintax ahora excluye correctamente las dobles llaves: primero se procesan las `{{variables}}` y luego el Spintax `{opciones}`.

### ✅ FIX 2: Variables personalizadas por cliente
El server ahora computa las variables para cada target individualmente con los datos reales del cliente (nombre, empresa, etc.) en vez de usar datos estáticos guardados en el frontend.

### ✅ FIX 3: Imagen del producto — descarga y sube correctamente
Cuando el adjunto es `prod_image`, el frontend ahora **descarga la imagen desde la URL pública y la sube al bucket `jjp-wa-media`**, generando un path válido que el servidor puede descargar.

### ✅ FIX 4: Query de productos incluye `image_url`
Añadido `image_url` al select de `jjp_products` en la query de difusión.

### ✅ FIX 5: Columna `forwarded` removida del insert
Se remueve el campo `forwarded` del insert de mensajes entrantes para evitar el error de schema.
