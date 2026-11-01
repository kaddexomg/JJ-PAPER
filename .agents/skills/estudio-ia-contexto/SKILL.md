---
name: estudio-ia-contexto
description: Contexto compartido, diagnóstico comprobado y CONTRATO DE API del Estudio IA de Fotos de JJ Paper. Leer SIEMPRE antes de usar las skills estudio-ia-agente-motor, estudio-ia-agente-interfaz o estudio-ia-agente-integracion.
---

# Estudio IA de Fotos — Contexto Compartido (fuente única de verdad)

> Diagnóstico realizado y comprobado el 31-10-2026. Lee también `AGENTS.md` en la raíz (reglas soberanas: VPS único, cero datos sensibles en git, esquema real en `assets/js/config.js`).

## 1. Objetivo de negocio
JJ Paper tiene **1.313 productos activos y 1.037 sin foto**. El Estudio debe encontrar la foto **exacta** de cada producto (tipo, medida, color, marca, empaque), auditarla con Gemini Vision y publicarla en el VPS **solo con aprobación humana**. Prohibido usar imágenes generadas por IA (el usuario ya rechazó fotos "inventadas" de palo de escoba, coleto/estrapeador y toallín).

## 2. Causa raíz comprobada (NO repetir este error)
Las 3 implementaciones de búsqueda que existen raspan buscadores con peticiones HTTP simples (`urllib` / `fetch`):
- `tools/ai-catalog-studio/studio_server.py` → `search_web_images()` (Bing HTML)
- `functions/api/search-images.js` (Cloudflare Pages Function: Bing + DDG)
- `wa-server/src/product-images.js` → `searchDuckDuckGoImages()` / `searchBingImages()` (ruta LAN `/lan/products/search-images` en `wa-server/src/count-lan.js` ~L865)

Resultados medidos para `"pizarra acrilica blanca marco aluminio"`:

| Método | Resultado |
|---|---|
| urllib Bing HTML | 0 resultados |
| urllib Bing async | 1 resultado basura ("Hueso frontal") |
| Playwright Chromium headless sin camuflaje → Bing | **Resultados envenenados ("Lego Scooby-Doo")** |
| urllib DuckDuckGo / Google / MercadoLibre | 0 |
| API MercadoLibre | 403 |
| Cloudflare Function en producción | `results: []` |
| **Playwright + `channel="msedge"` + UA real de Edge + `--disable-blink-features=AutomationControlled` + `locale="es-VE"`** | ✅ **DDG 100, Google 164, Bing 35 — todos pizarras reales (MercadoLibre VE, Falabella…)** |

**Conclusión:** la única fuente fiable y gratuita es un **navegador real local** (Playwright ya instalado en Python; Edge instalado en `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; Chrome también existe). Las funciones en Cloudflare **nunca** podrán buscar (IPs de datacenter bloqueadas).

Script de prueba que funcionó (copiado junto a esta skill): `.agents/skills/estudio-ia-contexto/referencia_busqueda_navegador.py` (claves de extracción):
- DDG: navegar a `https://duckduckgo.com/?q=<q>&iax=images&ia=images` y capturar la respuesta de red que contiene `i.js` → JSON `results[].image/.thumbnail/.title/.url`.
- Google: `https://www.google.com/search?udm=2&hl=es&q=<q>` → regex sobre `page.content()`: `\["(https?://[^"]+?\.(?:jpg|jpeg|png|webp)[^"]*?)",(\d+),(\d+)\]`, descartar `gstatic`.
- Bing: `https://www.bing.com/images/search?q=<q>&form=HDRSC2&setlang=es` → `a.iusc[m]` (JSON con `murl`, `turl`, `t`, `purl`).

## 3. Lo que SÍ funciona (no tocar sin motivo)
- VPS PostgREST `https://166-0-112-247.sslip.io/rest/v1/...` con `SUPABASE_SERVICE_ROLE_KEY` leída de `wa-server/.env` (función `load_env_config()` de `studio_server.py`).
- Pool Gemini de 7 keys (`GEMINI_API_KEYS` en `wa-server/.env` + `jjp_settings.ai_gemini_keys`). Modelos válidos verificados: `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`.
- Lectura pública de fotos: `https://166-0-112-247.sslip.io/storage/v1/object/public/jjp-products/<id>.webp` → 200.
- Tabla `jjp_photo_audit` columnas reales: `id, product_id, variant_id, image_url, verdict, confidence, mismatches, reason, source, reviewed_by, reviewed_at, created_at`.
- `jjp_products` tiene `image_url`, `category_id`, `unit`. `jjp_product_variants` también tiene `image_url` pero **NO** tiene `unit`.
- **Pendiente de verificar:** subida `POST /storage/v1/object/jjp-products/<archivo>` con header `x-upsert: true` (el `GET /storage/v1/bucket` devolvió un JSON genérico, sospechoso). Probar con un archivo `_diag_test_<timestamp>.webp` y borrarlo después (`DELETE` mismo path). El usuario debe autorizar esta prueba.

## 4. Arquitectura objetivo

```
[admin/estudio-fotos.html]  ──HTTP──►  studio_server.py :8795 (Python, local PC)
[producto.html (QR, celular)] ─► wa-server :8787 /lan/products/search-images ─► proxy a :8795
                                              │
                         image_search.py (Playwright + Edge, navegador persistente)
                                              │
                         GeminiPool (interpretación + Vision) ── VPS PostgREST/Storage
```

## 5. CONTRATO DE API v4 (lo implementa el Agente Motor, lo consumen Interfaz e Integración)
Base: `http://127.0.0.1:8795`. Todas las respuestas JSON con `ok: bool`; en error `{ok:false, error:"mensaje en español"}` y status HTTP adecuado. CORS `*` + `Access-Control-Allow-Private-Network: true` (ya existe en `_send_json`/`do_OPTIONS`).

### Objeto `Candidate`
```json
{
  "id": "sha1 corto de image_url",
  "image_url": "https://...",          
  "thumb_url": "https://...",
  "page_url": "https://... (página origen)",
  "title": "texto del resultado",
  "source": "google|duckduckgo|bing",
  "domain": "http2.mlstatic.com",
  "width": 800, "height": 800,
  "rank": 1,
  "vision": null | {
    "status": "verified|failed|pending",
    "verdict": "exact_match|partial_match|rejected|null",
    "score": 0-100 | null,
    "what_i_see": "...",
    "matches": {"tipo":true,"marca":true,"color":true,"medida":true,"es_foto_real":true},
    "reason": "..."
  }
}
```
**Regla de honestidad:** si una imagen no se pudo descargar o Gemini falló → `vision.status="failed"`, `score=null`, `verdict=null`. Nunca inventar puntajes (el código actual pone 60/65 falsos — eliminar).

### Endpoints
| Método | Ruta | Cuerpo / Query | Respuesta |
|---|---|---|---|
| GET | `/api/status` | — | igual que hoy + `search_engine: {ready, browser:"msedge", last_error, avg_ms}` |
| GET | `/api/products?refresh=1` | — | igual que hoy |
| POST | `/api/consult` | `{name, sku, unit, category_name, user_hint}` | `{ok, analysis, trace}` (formato actual de `consult_product_with_ai`) |
| POST | `/api/search` | `{name?, queries?:[], custom_query?, limit?:20, sources?:["google","duckduckgo","bing"]}` | `{ok, queries_executed, candidates:[Candidate], timings:{google_ms,...}, errors:{source:msg}}` (sin visión) |
| POST | `/api/vision-verify` | `{name, analysis, candidates:[{id,image_url,thumb_url}]}` (máx 20) | `{ok, results:{<id>: vision}}` — en paralelo con el pool |
| POST | `/api/search-verify` | `{product_id?, name, sku, unit, category_name, user_hint?, custom_query?, analysis?}` | `{ok, analysis, candidates (ordenados por score, failed al final), trace}` |
| POST | `/api/approve-photo` | `{product_id, image_url, category_name?, vision?}` | `{ok, public_url}` — descarga, WebP 800px q80, sube, PATCH `jjp_products.image_url`, inserta `jjp_photo_audit` (verdict `ok`, source `estudio_ia_v4`) |
| POST | `/api/batch/start` | `{product_ids?:[], filter?:"sin_foto", limit?:50, min_score?:85}` | `{ok, job_id}` |
| GET | `/api/batch/status` | `?job_id=` | `{ok, state:"running|paused|done", processed, total, proposals, errors}` |
| POST | `/api/batch/stop` | `{job_id}` | `{ok}` |
| GET | `/api/review-queue` | — | `{ok, items:[{product_id, name, sku, best:Candidate, alternatives:[Candidate], analysis, created_at}]}` |
| POST | `/api/review-queue/decide` | `{product_id, action:"approve|reject|skip", image_url?}` | `{ok}` (approve reutiliza la lógica de approve-photo) |

Se mantienen sin cambio: `/api/ai-params`, `/api/training`, `/api/train-feedback`, `/api/audit-existing`, `/api/quarantine-photo`, `/api/apply-category`, `/api/apply-categories-batch`, `/api/confirm-photo`, `/api/save-training`. Los endpoints viejos `/api/search-candidates` y `/api/vision-verify-one` quedan como alias de compatibilidad.

La cola de revisión se guarda en `tools/ai-catalog-studio/data/review_queue.json` (local, sin DDL; añadir `tools/ai-catalog-studio/data/` al `.gitignore`).

## 6. Reglas comunes para los 3 agentes
1. Español en UI, logs y mensajes de error.
2. Nada se publica en producción sin clic humano de aprobación.
3. No iniciar procesos persistentes desde la sesión del agente; para pruebas, arrancar el servidor, probar y detenerlo.
4. Validar sintaxis: `python -m py_compile <archivo>`, `node -c <archivo.js>` / `node --check`.
5. No comitear `.env`, CSV, JSON de datos, backups. No hacer `git push` sin permiso explícito del usuario.
6. Cada agente edita **solo sus archivos asignados**; si necesita un cambio en otro archivo, lo reporta al orquestador.
7. Al terminar, entregar: lista de archivos cambiados, pruebas ejecutadas con su salida real, y pendientes.
