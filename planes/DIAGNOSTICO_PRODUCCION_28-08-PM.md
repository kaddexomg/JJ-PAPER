# 🔍 Diagnóstico en producción — "no llegan los mensajes a WhatsApp" (28/08/2026 tarde)

> Verificación REAL en BD + logs + Storage del wa-server en ejecución (PID node src/index.js).
> Complementa `DIAGNOSTICO_CAMPAÑAS_REAL_2026-08-28.md` (diagnóstico de código de la mañana).
> Este doc es el estado EXACTO de hoy por la tarde y sirve como handoff para retomar el trabajo.

---

## 🎯 Síntoma reportado por el usuario

- "Veo los mensajes en mi interfaz pero no llegan a WhatsApp en mi teléfono / no los recibe el destinatario."
- "Ayer sí lo veía, hoy no."
- "En este momento tengo una campaña activa enviando una imagen / promoción de un producto específico."

## ✅ Dato clave de BD que aclara la duda de "¿se llena la BD?"

**NO se llena la BD por el envío.** El `{{link}}` es solo texto del `body`. La imagen crea 1 blob por
campaña (no por destinatario). El único crecimiento real es 1 fila por target (ya existente). No hay
llamadas extra que aceleren el llenado.

---

## 🔬 Verificación hecha (consultas reales a Supabase)

### Campañas de hoy (tabla `jjp_wa_campaigns`)
```json
{
  "id": "d8fe9197-9e08-4da2-888b-e9527d9ed9e4",
  "name": "Difusión WhatsApp 28/8/2026", "status": "enviando",
  "owner_id": "24fd4fb8-...-83c2e842d502",
  "media_path": "24fd4fb8-.../campaigns/1787936931748-PAPEL_R._FOTOCOPIA_CARTA_PRINTO.jpg",
  "media_type": "image", "sent_count": 5, "total": 65
}
{
  "id": "81045a4c-6772-4302-b9f7-77b11251b585",
  "name": "Difusión WhatsApp 28/8/2026", "status": "pausada",
  "media_path": "assets/img/no-img.svg",           // ← PLACEHOLDER LOCAL, NO está en el bucket
  "media_type": "image", "sent_count": 1, "total": 65
}
{
  "id": "c512b6cd-99ea-4c16-9fa9-2e67eddddcab",
  "name": "Difusión 27/8/2026", "status": "cancelada",
  "media_path": "b0cd93c5-.../campaigns/1787852357212-Catalogo-JJPaper-2026-08-27.pdf",
  "media_type": "document", "sent_count": 19, "total": 897
}
```

### Targets de la campaña ACTIVA `d8fe9197` (tabla `jjp_wa_campaign_targets`)
```json
{ "en_cola": 60, "sent": 5 }
```

### Storage bucket `jjp-wa-media` (carpeta owner/campaigns)
```json
{
  "name": "1787936931748-PAPEL_R._FOTOCOPIA_CARTA_PRINTO.jpg",
  "size": 17857757,          // ← 17.8 MB (¡ENORME para WhatsApp!)
  "mimetype": "image/jpeg",
  "created_at": "2026-08-28T17:08:53.914Z"
}
```

### Logs `wa-server/logs/server.1.log` (PID 5488)
```json
{"campaign":"Difusión WhatsApp 28/8/2026","to":"584144593689","nextInS":56,"msg":"difusión: mensaje encolado"}
{"id":"ea3f1b2b-...","retries":1,"failed":false,"err":"descarga Storage falló: Object not found","msg":"envío falló"}
{"id":"ea3f1b2b-...","retries":2,"failed":false,"err":"descarga Storage falló: Object not found","msg":"envío falló"}
{"id":"ea3f1b2b-...","retries":3,"failed":true,"err":"descarga Storage falló: Object not found","msg":"envío falló"}
```

---

## 🧩 CAUSA RAÍZ (dos problemas, ambos de la IMAGEN)

### Problema 1 — Campaña anterior (16:11, pausada `81045a4c`)
- `media_path = "assets/img/no-img.svg"` → ruta **local del frontend** (placeholder), NO existe en el
  bucket `jjp-wa-media`.
- `outbox.js:86` → `downloadOutgoingMedia(row.media_path)` (src/media.js:42) → **"Object not found"**
  (3 reintentos, luego `failed: true`).
- El usuario la vio fallar y la **pausó**.

### Problema 2 — Campaña actual (17:08, activa `d8fe9197`)
- La imagen SÍ existe en el bucket y la ruta es correcta.
- **PERO pesa 17.857.757 bytes ≈ 17.8 MB.** WhatsApp limita las imágenes a ~5 MB → el envío de imagen
  falla / no se entrega.
- Estado: 60 targets `en_cola` (esperando) + 5 `sent` (marcados en BD, entrega no garantizada).
- Los primeros 5 "sent" coinciden con la campaña re-lanzada; es probable que quien recibe algo sea por
  texto o que la entrega de imagen esté fallando por el peso.

---

## 🔗 Ruta de la muerte (flujo completo verificado)

1. **Frontend** `vdifusion.js` `launchCampaignFromEditor` sube la imagen a `jjp-wa-media` y guarda
   `media_path` en `jjp_wa_campaigns` (correcto en la campaña activa).
2. **Server** `campaigns.js` copia `camp.media_path` a cada mensaje `jjp_wa_messages` (`status: 'pending'`).
3. **Server** `outbox.js` hace `downloadOutgoingMedia(row.media_path)` (media.js:42). Si falla → el mensaje
   NO sale; queda `failed`/reintentos.
4. **Nunca se llama `session.send()`** → WhatsApp en el teléfono no recibe nada, aunque la interfaz
   muestre el registro.

---

## 📋 Checklist de estado GLOBAL (hoy por la tarde)

| Componente | Estado |
|---|---|
| Fix link ficha directa `producto.html?id=` (commit `bb5061c`, pusheado) | ✅ desplegado |
| Fix imagen en flujo editor (commit `61ea83b`, pusheado) | ✅ en código |
| Cache-busting `?v=20260828_linkfix` (difusion, campanas-email, catalogo) | ✅ |
| Server `wa-server` corriendo | ✅ PID de `node src/index.js` activo |
| Reinicio de wa-server tras cambios de `campaigns.js` | ⚠️ VERIFICAR — si no se reinició, el fix de servidor no está vivo |
| Campaña de hoy funcional | ❌ NO (imagen placeholder vieja + imagen 17.8MB) |

> ⚠️ El cambio en `wa-server/src/campaigns.js` (personalización real) solo surte efecto tras
> **reiniciar** el proceso `node src/index.js`.

---

## 🎯 Siguiente paso propuesto (al retomar)

Opción recomendada — **"Ambas cosas"**:
1. **Código:** en `vdifusion.js` (`attachOpt === 'prod_image'`), tras descargar el blob, **comprimir /
   redimensionar a < 4-5 MB** antes de subir a `jjp-wa-media` (canvas/`createImageBitmap` + `toBlob` de
   calidad ajustable). Evita que vuelva a pasar. Requiere deploy.
2. **Datos en vivo:** arreglar la campaña actual `d8fe9197`:
   - Re-subir una versión comprimida de la imagen y corregir `media_path`.
   - (O) Cambiar la campaña a solo texto si la imagen no es imprescindible.
   - Poner en cola de nuevo los targets `failed` para que salgan.

Herramientas usadas para verificar: script `C:\Users\PC\AppData\Local\Temp\opencode\check_camp.mjs`
(consulta Supabase; importa desde `file:///C:/Users/PC/Desktop/JJ%20PAPER/wa-server/src/supabase.js`).
