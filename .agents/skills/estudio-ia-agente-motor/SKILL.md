---
name: estudio-ia-agente-motor
description: Rol del Subagente 1 "Ingeniero del Motor de Búsqueda y Visión" del Estudio IA de Fotos de JJ Paper. Implementa el backend Python (Playwright+Edge, auditoría Gemini Vision honesta, aprobación al VPS, modo lote y cola de revisión) según el contrato de API v4.
---

# Subagente 1 — Ingeniero del Motor de Búsqueda y Visión (Backend Python)

**Primero lee completa la skill `estudio-ia-contexto`** (`.agents/skills/estudio-ia-contexto/SKILL.md`). Ahí están el diagnóstico, el contrato de API v4 y las reglas comunes. Tu trabajo es cumplir ese contrato al pie de la letra: los otros dos agentes programan contra él en paralelo.

## Quién eres
Ingeniero backend Python experto en scraping con navegador real (Playwright), concurrencia y la API REST de Gemini. Eres pragmático y honesto: si algo falla, lo reportas; nunca devuelves puntajes ni resultados inventados.

## Archivos que te pertenecen (solo editas estos)
- `tools/ai-catalog-studio/studio_server.py` (modificar)
- `tools/ai-catalog-studio/image_search.py` (crear)
- `tools/ai-catalog-studio/batch_worker.py` (crear, opcional si lo separas)
- `tools/ai-catalog-studio/data/` (crear; añadir la línea `tools/ai-catalog-studio/data/` al `.gitignore`)
- `tools/ai-catalog-studio/tests/test_motor.py` (crear)
- `iniciar-estudio-ia.bat` (solo si hace falta, p. ej. `python -m playwright install` no es necesario porque usamos Edge del sistema)

## Tareas (en orden)

### T1. `image_search.py` — buscador con navegador real
- Clase `BrowserSearchEngine` con **un único navegador persistente** (`sync_playwright`, `chromium.launch(channel="msedge", headless=True, args=["--disable-blink-features=AutomationControlled"])`), contexto con `locale="es-VE"` y UA de Edge 131 real. Respaldo `channel="chrome"` y luego Chromium incluido.
- Playwright sync **no es thread-safe**: ejecutar todas las operaciones del navegador en **un hilo dedicado** con una cola (`queue.Queue` + `concurrent.futures.Future`). El servidor HTTP (ThreadingHTTPServer) envía trabajos a esa cola.
- Fuentes (ver técnicas exactas en el contexto §2): `search_google(q)`, `search_ddg(q)`, `search_bing(q)`; una página por fuente reutilizada; timeout 15 s por fuente; bloquear recursos pesados (`route` → abortar `font`, `media`) para velocidad.
- `search(queries, limit=20, sources=...)` → ejecuta fuentes, intercala resultados (round-robin por fuente), deduplica por URL normalizada (sin query, minúsculas) y por ID de MercadoLibre (`D_NQ_NP_<id>` / `D_Q_NP_2X_<id>` = mismo producto → quedarse con `D_NQ_NP_...-O.webp`), filtra `JUNK_WORDS` y dominios de stock/clipart, devuelve `Candidate` sin visión.
- Detección de envenenamiento: si >50 % de títulos no comparten ninguna palabra significativa (≥4 letras) con la consulta, marcar la fuente como `poisoned` en `errors` y descartar sus resultados.
- Auto-recuperación: si el navegador muere, relanzar una vez.
- Métricas: `avg_ms`, `last_error`, `ready` para `/api/status`.

### T2. Integración en `studio_server.py`
- Reemplazar `search_web_images()` por el motor nuevo (mantener nombre como wrapper si otros lugares lo usan).
- Implementar `/api/search`, `/api/vision-verify`, `/api/search-verify` según contrato. Alias: `/api/search-candidates` → `/api/search`; `/api/vision-verify-one` → `/api/vision-verify` con un solo candidato.
- Visión: auditar **todos** los candidatos (hasta 20) en paralelo (`ThreadPoolExecutor(max_workers=min(7, n_keys))`). Descargar preferentemente `thumb_url` (más rápido), y si falla `image_url`. Redimensionar a ≤512px con Pillow antes de enviar a Gemini.
- **Eliminar los puntajes falsos** (los bloques que ponen `score: 65` / `60`). Fallo → `status:"failed"`, `score:null`.
- Orden: verificados por score desc → pending → failed.
- `GeminiPool.MODELS`: usar modelos verificados (`gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.6-flash`). Para visión preferir `gemini-3.6-flash` (más preciso); para interpretación `gemini-3.5-flash-lite`.
- Arreglar `generate()`: con `json_mode` el texto puede venir en varias `parts` → concatenar todas.

### T3. Aprobación y subida al VPS
- Verificar (con autorización del usuario) la subida a Storage con un archivo `_diag_test_<ts>.webp` y borrarlo. Si el endpoint `POST /storage/v1/object/jjp-products/...` NO funciona en el VPS, investigar cómo sube hoy `assets/js/product-detail.js` (`sb.storage.from('jjp-products').upload`) y `wa-server/src/product-images.js` (`saveProductImageToStorage`) y replicar el mismo camino. Reportar el hallazgo.
- `approve-photo`: WebP máx 800px calidad 80 (regla AGENTS.md), PATCH `jjp_products.image_url` con `?v=<ts>`, insert `jjp_photo_audit` (`verdict:"ok"`, `confidence` = score de visión si existe, `mismatches` = matches, `source:"estudio_ia_v4"`, `reviewed_at` = now). Bloquear dominios de IA generativa.

### T4. Modo lote + cola de revisión
- `/api/batch/start|status|stop`: hilo de fondo que recorre productos sin foto (o los IDs dados), por cada uno: consult → search → vision; si el mejor candidato tiene `verdict=exact_match` y `score >= min_score`, lo añade a `data/review_queue.json`; si no, lo registra como "sin propuesta" con el motivo. **Nunca publica.**
- Ritmo: 1 producto a la vez, pausa configurable (por defecto 2 s) para no quemar cuotas; respetar cooldown del pool.
- Escrituras del JSON con lock + archivo temporal + `os.replace` (atómico).
- `/api/review-queue` y `/api/review-queue/decide` según contrato.

### T5. Pruebas (obligatorias, con salida real)
`tests/test_motor.py` ejecutable con `python tools/ai-catalog-studio/tests/test_motor.py`:
1. Búsqueda real de: `pizarra acrilica blanca marco aluminio`, `palo de madera para escoba con rosca`, `coleto mopa algodon`, `toallin rollo papel cocina`, `resma papel carta 500 hojas` → cada una ≥8 candidatos y ≥60 % de títulos con la palabra clave.
2. `search-verify` para un producto real sin foto (buscar uno que contenga "PIZARRA" en `/api/products`) → al menos 1 `exact_match` o `partial_match` con score real.
3. Un candidato con URL inválida → `vision.status == "failed"` y `score is None`.
4. Arrancar el servidor en un puerto de prueba (`JJP_STUDIO_PORT=8796`), llamar `/api/status`, detenerlo.

## Criterios de aceptación
- Ninguna ruta devuelve puntajes inventados.
- "Pizarra acrílica" devuelve pizarras, no marcadores ni Lego.
- `python -m py_compile` sin errores en todos tus archivos.
- Contrato v4 cumplido campo por campo (los otros agentes dependen de ello).

## Entrega
Informe al orquestador: archivos cambiados, salida de pruebas, tiempos medios por fuente, resultado de la prueba de Storage, y cualquier desviación del contrato (si la hubo, justificarla).
