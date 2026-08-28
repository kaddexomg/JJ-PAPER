# 🧪 Diagnóstico real de Campo — Campañas WhatsApp (no toca código)

> Generado el 2026-08-28. Verificación manual del código actual, aparte del documento previo
> (`diagnostico-campanas.md`) que **declaraba los fixes como aplicados**.
>
> Conclusión principal: **varios "fix" del documento anterior NO están realmente aplicados en el
> flujo activo**, y hay bugs nuevos en el editor. Por eso hoy el sistema no funciona bien.

---

## ⚠️ Hallazgo clave: hay DOS flujos de lanzamiento y el fix solo está en uno

- **Flujo VIEJO / legacy:** `launchCampaign()` en `assets/js/vendedor/vdifusion.js:673`
- **Flujo NUEVO / activo (editor):** `CampaignEditor` (campaign-editor.js) → `newCampaign()` en
  `vdifusion.js:483` → `launchCampaignFromEditor()` en `vdifusion.js:504`

`newCampaign()` (el único botón "＋ Nueva campaña" que ve el vendedor) usa SIEMPRE el editor
(flujo nuevo). El `launchCampaign()` viejo quedó de respaldo. **Los fixes se aplicaron al flujo viejo
pero NO al nuevo — que es el que realmente se usa.**

---

## 🐛 BUG 1 — Imagen de producto SIEMPRE falla en el flujo activo ("Object not found")

`diagnostico-campanas.md` contrastado:

> "FIX 3: el frontend ahora descarga la imagen desde la URL pública y la sube al bucket `jjp-wa-media`"

**Realidad:** eso solo está en el flujo viejo (`launchCampaign()`, vdifusion.js:709-731).

En el **flujo activo** (`launchCampaignFromEditor`, vdifusion.js:527-531):
```js
} else if (attachOpt === 'prod_image' && selectedProductOrCombo?.image_url) {
  mediaPath = selectedProductOrCombo.image_url;   // ✗ URL pública completa del otro bucket
```
Guarda la **URL pública** (`https://xxx.supabase.co/storage/v1/object/public/jjp-products/...`) como
`media_path`, en vez de subir la imagen al bucket `jjp-wa-media`.

Luego `outbox.js` → `downloadOutgoingMedia(row.media_path)` (src/media.js:41) hace
`db.storage.from('jjp-wa-media').download(mediaPath)` con esa key inválida → **"Object not found"**.
**El mensaje de imagen nunca sale.** (El de texto sí.)

**Esto es el bug 1 del documento original, sin corregir en el camino que usa el usuario.**

---

## 🐛 BUG 2 — El "preview" del editor destruye las variables dobles `{{...}}` al redactar

En `campaign-editor.js`, función `updatePreview()` (línea 459):
```js
let rendered = text.replace(/\{([^{}]+?)\}/g, (_, choices) => {   // ✗ regex de llave simple
  const parts = choices.split('|');
  return parts[0].trim();
});
```
Esta regex de **Spintax sin guard de doble llave** también captura la llave interna de `{{variable}}`.
Sobre `{{precio}}` matchea `{precio}` y lo reemplaza → queda **`{precio}`**, y como después el
`replaceAll("{{precio}}", valor)` ya no encuentra `{{precio}}`, el valor real **no se muestra**.

**Síntoma:** al escribir el mensaje, las variables se ven como `{precio}` `{nombre}` (código crudo,
sin haberse sustituido), el preview se ve roto y confunde al vendedor. Es el "no se distinguen / no se
redactan bien las variables".

Comparación — el flujo viejo de preview `dRender()` (vdifusion.js:382) SÍ tiene el guard:
```js
str.replace(/\{([^{}]+?)\}/g, (_, choices) => {
  if (choices.startsWith('{') || choices.endsWith('}')) return choices;  // ✓ guard
  ...
```

**El orden también importa:** el editor resuelve Spintax ANTES que variables (mal). El server
(`renderTemplate`, campaigns.js:155) resuelve variables PRIMERO y Spintax DESPUÉS (bien). Por eso el
preview del editor se ve distinto al mensaje que finalmente se envía.

---

## 🐛 BUG 3 — Spintax con `¡`/`!` al inicio de opción puede romperse en el server

Las plantillas del editor para combo (campaign-editor.js:374) escriben:
```
{¡Hola|Saludos cordiales|Buen día} ...
```
El server (`renderTemplate`, campaigns.js:160) hace elige una opción al azar con `parts[Math.floor(Math.random()*parts.length)]` — esto NO rompe por el `¡`, funciona. PERO el preview del editor
(linea 459) devuelve `parts[0]` = `¡Hola` → se ve raro. No es crítico, pero suma a la confusión.

---

## 🐛 BUG 4 — Las variables NO se reemplazan con datos reales (persiste, a medias)

`diagnostico-campanas.md` contrastado:

> "FIX 2: el server ahora computa variables reales del cliente por target"

**Realidad:** el server (campaigns.js:87) hace `renderTemplate(..., t.vars)` y **usa `t.vars`** tal cual
se guardaron en el target. Pero `t.vars` se llena desde el FRONTEND con `dSampleVars(...)` a la hora de
lanzar (vdifusion.js:589 y 800), o sea con el nombre/empresa del contacto (bien) pero con el **producto,
precio y link "de muestra"**. No hay recomputo server-side por cliente → el server solo "personaliza"
lo que el frontend ya puso. **El fix 2 tal y como lo describe el documento NO existe en el código: el
server no computa nada, solo aplica `t.vars`.**

Resultado: `{{producto}}`, `{{precio}}`, `{{link}}` salen con datos de muestra (ej. "Resma Carta HP...")
aunque estés promocionando otro producto, **si el flujo del editor no enlaza bien el producto elegido**
(ver Bug 5).

---

## 🐛 BUG 5 — En el flujo del editor, el producto/combo elegido NO llega a `dSampleVars`

En `launchCampaignFromEditor` (vdifusion.js:577-580):
```js
const extra = {
  productId: selectedProductOrCombo?.id,
  type: selectedProductOrCombo?.type || 'general'
};
```
`selectedProductOrCombo` aquí es **el objeto del ProductPicker** (del editor). En `dSampleVars`
(vdifusion.js:334) se busca `dProducts.find(x => x.id === extraContext.productId)`. Si el `id` del
picker no coincide con el `id` de `jjp_product_variants` de `dProducts` (o el picker usa otra clave),
`p` queda `undefined` y se usan los **valores de muestra por defecto**. Combinado con Bug 4, el mensaje
final puede decir otro producto / precio "de ejemplo".

---

## 🎯 Causa raíz de "no funcionamos bien hoy"

1. **El flujo que usa el vendedor (editor) nunca recibió los fixes** que sí se pusieron en el flujo legacy.
   El documento `diagnostico-campanas.md` los dio por corregidos a nivel global, pero el código activo
   quedó atrás (imagen rota, preview roto).
2. **El preview del editor (`updatePreview`) rompe las variables** `{{...}}` → `{...}` por usar regex de
   Spintax sin orden ni guard (Bug 2), mientras el server sí las resuelve → lo que el vendedor redacta
   y ve, no coincide con lo que se envía.
3. **Doble fuente de personalización** (frontend guarda variables de muestra en `t.vars`, server solo las
   aplica) → variables de producto/precio/link salen como ejemplo, no reales.

---

## ✅ Qué está BIEN (verificado en el código)

- `renderTemplate` del server (campaigns.js:155-165) tiene el **orden correcto** (variables primero,
  Spintax después) y es anti-spam con opciones aleatorias.
- El throttling anti-baneo (retardo aleatorio + pausa de lote + tope diario) está bien implementado y es
  el recomendado.
- El flujo legacy `launchCampaign()` sí tiene el fix de imagen (descarga → sube a `jjp-wa-media`).
- Autocompletado de audiencia, opt-out y estados de campaña se ven correctos.

---

## ✅ Correcciones aplicadas (2026-08-28)

| # | Qué | Estado | Archivo |
|---|-----|--------|---------|
| 1 | Imagen de producto en `launchCampaignFromEditor`: ahora descarga la imagen y la sube a `jjp-wa-media` (como el flujo legacy) en vez de guardar la URL pública → envía bien | ✅ | vdifusion.js |
| 2 | `updatePreview` del editor: resuelve variables `{{...}}` ANTES que Spintax y con guard de llaves dobles → preview correcto y coherente con lo enviado | ✅ | campaign-editor.js |
| 3 | Server recomputa `nombre`/`empresa` reales del target en `renderTemplate` (ya no confía solo en `t.vars` de ejemplo) | ✅ | campaigns.js (requiere reiniciar wa-server) |
| 4 | `dSampleVars` acepta el objeto directo del ProductPicker → `{{producto}}/{{precio}}/{{descripcion}}/{{descuento}}` salen reales, no de muestra | ✅ | vdifusion.js |
| 5 | Cache-busting forzado (`?v=20260828_fix`) para que el navegador tome los archivos nuevos | ✅ | difusion.html |

> ⚠️ **Importante:** el cambio en `wa-server/src/campaigns.js` solo surte efecto tras **reiniciar** el
> proceso `node src/index.js` (el server se corre con node, no con live-reload).
