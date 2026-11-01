#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JJ Paper C.A. — AI Catalog Image Search, Training & Audit Studio v4
===================================================================
Servidor local en Python (puerto 8795) impulsado por el Pool de API Keys de Gemini
y el Motor de Búsqueda Web con Navegador Real (Edge / Chrome) para catálogo de
papelería, oficina, escolar y limpieza.
"""

import base64
import csv
import html
import io
import json
import mimetypes
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent.parent
TRAINING_FILE = BASE_DIR / "training" / "knowledge_base.json"
CSV_PROPOSALS_FILE = ROOT_DIR / "scratch" / "clasificacion_categorias_propuesta.csv"
PORT = int(os.environ.get("JJP_STUDIO_PORT", "8795"))

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Importar el motor de búsqueda real y gestor de lotes
from image_search import SEARCH_ENGINE
from batch_worker import REVIEW_QUEUE, BATCH_MANAGER


# ==============================================================================
# 1. CARGA DE CONFIGURACIÓN SOBERANA Y POOL DE API KEYS GEMINI
# ==============================================================================
def load_env_config():
    cfg = {
        "SUPABASE_URL": "https://166-0-112-247.sslip.io",
        "SUPABASE_KEY": "",
        "GEMINI_KEYS": [],
    }
    env_paths = [ROOT_DIR / "wa-server" / ".env", ROOT_DIR / ".env"]
    for ep in env_paths:
        if not ep.exists():
            continue
        text = ep.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip().strip("'").strip('"')
            if k in ("SUPABASE_URL_CORE", "SUPABASE_URL") and v:
                cfg["SUPABASE_URL"] = v
            elif k in ("SUPABASE_SERVICE_ROLE_KEY_CORE", "SUPABASE_SERVICE_ROLE_KEY") and v:
                cfg["SUPABASE_KEY"] = v
        m = re.search(r"GEMINI_API_KEYS\s*=\s*(\[[\s\S]*?\])", text)
        if m:
            try:
                arr = json.loads(m.group(1))
                for key in arr:
                    if isinstance(key, str) and key.strip() and key.strip() not in cfg["GEMINI_KEYS"]:
                        cfg["GEMINI_KEYS"].append(key.strip())
            except Exception:
                pass
    return cfg


CONFIG = load_env_config()

# Parámetros en vivo del Motor IA (configurables desde la interfaz)
AI_ENGINE_PARAMS = {
    "model": "gemini-3.5-flash-lite",
    "temperature": 0.1,
    "min_confidence": 88,
    "vision_min_score": 78,
    "vision_strictness": "alta",
    "search_suffix": "producto packshot fondo blanco -cartoon -clipart -dibujo",
    "max_candidates": 6,
    "custom_instructions": (
        "Prioriza packshots comerciales limpios sobre fondo blanco. "
        "Distingue con exactitud entre unidades sueltas, cajas, bultos, medidas (Carta vs Oficio) "
        "y utensilios reales (ej. coleto/mopa vs pañito de microfibra, palo de madera vs escoba completa)."
    ),
}


def vps_request(method, path, body=None, extra_headers=None, is_binary=False):
    url = f"{CONFIG['SUPABASE_URL'].rstrip('/')}/{path.lstrip('/')}"
    headers = {
        "apikey": CONFIG["SUPABASE_KEY"],
        "Authorization": f"Bearer {CONFIG['SUPABASE_KEY']}",
        "User-Agent": "JJPaper-AI-Studio/4.0",
    }
    if not is_binary:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if body is not None:
        data = body if is_binary else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=25, context=SSL_CTX) as resp:
        raw = resp.read()
        if not raw:
            return None
        ctype = resp.headers.get("Content-Type", "")
        if "application/json" in ctype:
            return json.loads(raw.decode("utf-8", errors="replace"))
        return raw


def sync_keys_from_vps():
    try:
        rows = vps_request("GET", "rest/v1/jjp_settings?select=value&key=eq.ai_gemini_keys")
        if isinstance(rows, list) and rows:
            val = rows[0].get("value")
            arr = json.loads(val) if isinstance(val, str) else val
            if isinstance(arr, list):
                for k in arr:
                    if isinstance(k, str) and k.strip() and k.strip() not in CONFIG["GEMINI_KEYS"]:
                        CONFIG["GEMINI_KEYS"].append(k.strip())
    except Exception as e:
        print(f"[WARN] No se pudieron sincronizar llaves extra desde jjp_settings: {e}")


sync_keys_from_vps()


class GeminiPool:
    """Balanceador rotativo para las API Keys de Gemini con soporte de texto, visión y telemetría."""

    MODELS = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
    ]

    def __init__(self, keys):
        self.lock = threading.Lock()
        self.keys = list(keys)
        self.idx = 0
        self.last_trace = {}
        self.stats = {
            i: {"masked": f"{k[:8]}...{k[-4:]}", "calls": 0, "success": 0, "errors": 0, "cooldown_until": 0}
            for i, k in enumerate(self.keys)
        }

    def get_status(self):
        now = time.time()
        with self.lock:
            out = []
            for i, st in self.stats.items():
                out.append({
                    "index": i + 1,
                    "masked": st["masked"],
                    "calls": st["calls"],
                    "success": st["success"],
                    "errors": st["errors"],
                    "active": now >= st["cooldown_until"],
                    "cooldown_sec": max(0, int(st["cooldown_until"] - now)),
                })
            return {
                "total_keys": len(self.keys),
                "models": self.MODELS,
                "active_params": AI_ENGINE_PARAMS,
                "last_trace": self.last_trace,
                "keys": out,
            }

    def _next_key(self):
        with self.lock:
            if not self.keys:
                raise RuntimeError("No hay API Keys de Gemini configuradas.")
            now = time.time()
            n = len(self.keys)
            for _ in range(n):
                i = self.idx % n
                self.idx = (self.idx + 1) % n
                if now >= self.stats[i]["cooldown_until"]:
                    return i, self.keys[i]
            soonest = min(self.stats.keys(), key=lambda k: self.stats[k]["cooldown_until"])
            return soonest, self.keys[soonest]

    def generate(
        self,
        prompt,
        system_instruction="",
        image_bytes=None,
        mime_type="image/jpeg",
        temperature=None,
        json_mode=True,
        preferred_model=None,
    ):
        t0 = time.time()
        temp = AI_ENGINE_PARAMS["temperature"] if temperature is None else float(temperature)
        pref_model = preferred_model or AI_ENGINE_PARAMS.get("model") or self.MODELS[0]
        models_order = [pref_model] + [m for m in self.MODELS if m != pref_model]

        parts = [{"text": prompt}]
        if image_bytes:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            parts.append({"inline_data": {"mime_type": mime_type, "data": b64}})

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temp, "maxOutputTokens": 1500},
        }
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        last_err = None
        max_attempts = max(4, len(self.keys))
        for attempt in range(max_attempts):
            key_idx, api_key = self._next_key()
            model = models_order[attempt % len(models_order)]
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            with self.lock:
                self.stats[key_idx]["calls"] += 1

            try:
                req = urllib.request.Request(
                    endpoint,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=22, context=SSL_CTX) as resp:
                    res_data = json.loads(resp.read().decode("utf-8", errors="replace"))

                # Concatenar todas las partes de texto recibidas de Gemini
                cand_parts = (
                    res_data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(p.get("text", "") for p in cand_parts if "text" in p)

                if not text:
                    raise RuntimeError("Respuesta vacía de Gemini")

                elapsed_ms = int((time.time() - t0) * 1000)
                with self.lock:
                    self.stats[key_idx]["success"] += 1
                    self.last_trace = {
                        "key_index": key_idx + 1,
                        "key_masked": self.stats[key_idx]["masked"],
                        "model": model,
                        "temperature": temp,
                        "elapsed_ms": elapsed_ms,
                        "has_vision": bool(image_bytes),
                        "timestamp": time.strftime("%H:%M:%S"),
                    }
                return text
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="replace")
                last_err = f"HTTP {he.code}: {err_body[:200]}"
                with self.lock:
                    self.stats[key_idx]["errors"] += 1
                    if he.code in (429, 503):
                        self.stats[key_idx]["cooldown_until"] = time.time() + 45
                    elif he.code in (400, 403) and "API_KEY" in err_body.upper():
                        self.stats[key_idx]["cooldown_until"] = time.time() + 600
            except Exception as e:
                last_err = str(e)
                with self.lock:
                    self.stats[key_idx]["errors"] += 1

        raise RuntimeError(f"Pool Gemini agotó reintentos: {last_err}")


GEMINI_POOL = GeminiPool(CONFIG["GEMINI_KEYS"])


# ==============================================================================
# 2. MOTOR DE ENTRENAMIENTO Y MEMORIA ACTIVA (`knowledge_base.json`)
# ==============================================================================
def load_training():
    if not TRAINING_FILE.exists():
        return {"abbreviations": {}, "visual_audit_rules": [], "learned_corrections": []}
    try:
        return json.loads(TRAINING_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"abbreviations": {}, "visual_audit_rules": [], "learned_corrections": []}


def save_training(data):
    TRAINING_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRAINING_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def build_trained_system_prompt():
    kb = load_training()
    abbr = kb.get("abbreviations", {})
    rules = kb.get("visual_audit_rules", [])
    learned = kb.get("learned_corrections", [])[-30:]

    abbr_str = "\n".join(f"  - {k}: {v}" for k, v in abbr.items())
    rules_str = "\n".join(f"  * {r}" for r in rules)
    learned_str = "\n".join(
        f"  * Producto '{item.get('raw_name')}' -> Es '{item.get('user_clarification')}' "
        f"(Categoría: {item.get('category')}, Buscar: '{item.get('search_query')}')"
        for item in learned
    )

    return f"""Eres el Consultor Maestro de Catálogo y Auditor Visual de Corporación JJ Paper C.A. (Mayorista de Papelería, Oficina, Escolar y Limpieza en Caracas).

PARÁMETROS ACTIVOS DEL MOTOR IA:
- Certeza mínima exigida para no preguntar al usuario: {AI_ENGINE_PARAMS.get('min_confidence', 88)}%
- Nivel de rigor en auditoría visual: {AI_ENGINE_PARAMS.get('vision_strictness', 'alta').upper()}
- Directriz del operador: {AI_ENGINE_PARAMS.get('custom_instructions', '')}

1. DICCIONARIO DE ABREVIATURAS DE NUESTRO ERP MIXNET:
{abbr_str}

2. REGLAS INVIOLABLES DE EXACTITUD FOTOGRÁFICA:
{rules_str}

3. CORRECCIONES APRENDIDAS DEL USUARIO (MEMORIA ACTIVA):
{learned_str if learned_str else '  (Sin correcciones previas aún)'}
"""


# ==============================================================================
# 3. PROCESAMIENTO Y OPTIMIZACIÓN DE IMÁGENES
# ==============================================================================
def search_web_images(query, max_results=6):
    """Wrapper de compatibilidad que utiliza el nuevo motor con navegador real."""
    res = SEARCH_ENGINE.search([query], limit=max_results)
    return res.get("candidates", [])


def download_image_bytes(url):
    if not url:
        raise ValueError("URL de imagen vacía")
    if url.startswith("data:image/"):
        header, b64 = url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "")
        return base64.b64decode(b64), mime
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=12, context=SSL_CTX) as resp:
        raw = resp.read()
        ctype = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/jpeg"
        return raw, ctype


def prepare_vision_image(raw_bytes, max_side=512):
    """Optimiza y redimensiona la imagen a <=512px para reducir latencia y costo en Gemini Vision."""
    if not HAS_PILLOW or not raw_bytes:
        return raw_bytes, "image/jpeg"
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            img = bg
        else:
            img = img.convert("RGB")
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue(), "image/jpeg"
    except Exception:
        return raw_bytes, "image/jpeg"


def convert_to_webp_bytes(raw_bytes, max_side=800):
    """Convierte a WebP (800px máx, calidad 80) según la convención obligatoria de JJ Paper."""
    if not HAS_PILLOW:
        return raw_bytes, "image/jpeg"
    img = Image.open(io.BytesIO(raw_bytes))
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[3])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=80, method=4)
    return out.getvalue(), "image/webp"


# ==============================================================================
# 4. CACHÉ EN MEMORIA DE PRODUCTOS Y CATEGORÍAS
# ==============================================================================
CACHE = {
    "lock": threading.Lock(),
    "last_fetch": 0,
    "products": [],
    "categories": [],
    "cat_by_id": {},
    "cat_by_name": {},
    "csv_proposals": {},
}


def load_csv_proposals():
    proposals = {}
    if CSV_PROPOSALS_FILE.exists():
        with open(CSV_PROPOSALS_FILE, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = row.get("producto_id", "").strip()
                if pid:
                    proposals[pid] = row
    CACHE["csv_proposals"] = proposals
    return proposals


def fetch_catalog_state(force=False):
    now = time.time()
    with CACHE["lock"]:
        if not force and CACHE["products"] and (now - CACHE["last_fetch"] < 180):
            return CACHE["products"], CACHE["categories"]

    cats = vps_request("GET", "rest/v1/jjp_categories?select=id,name,slug,emoji,sort_order,group_id&order=sort_order") or []
    cat_by_id = {c["id"]: c for c in cats}
    cat_by_name = {c["name"].upper(): c for c in cats}

    prods = vps_request(
        "GET",
        "rest/v1/jjp_products?select=id,sku,name,description,price_usd,unit,image_url,category_id,active&active=eq.true&order=name&limit=3000",
    ) or []

    audits = {}
    try:
        audit_rows = vps_request("GET", "rest/v1/jjp_photo_audit?select=product_id,verdict,confidence,reason,reviewed_at&order=created_at.desc&limit=2000") or []
        for a in audit_rows:
            pid = a.get("product_id")
            if pid and pid not in audits:
                audits[pid] = a
    except Exception:
        pass

    proposals = CACHE["csv_proposals"] or load_csv_proposals()
    enriched = []
    for p in prods:
        pid = p["id"]
        cat_obj = cat_by_id.get(p.get("category_id"))
        cat_name = cat_obj["name"] if cat_obj else "SIN CATEGORÍA"
        img = (p.get("image_url") or "").strip()
        has_photo = len(img) > 12 and img not in ("null", "undefined") and not img.startswith("data:image/")
        is_embedded_b64 = img.startswith("data:image/")
        prop = proposals.get(pid, {})
        aud = audits.get(pid, {})
        enriched.append({
            "id": pid,
            "sku": p.get("sku") or "",
            "name": p.get("name") or "",
            "description": p.get("description") or "",
            "price_usd": p.get("price_usd") or 0,
            "unit": p.get("unit") or "UND",
            "image_url": img if has_photo else "",
            "has_photo": has_photo,
            "is_embedded_b64": is_embedded_b64,
            "category_id": p.get("category_id"),
            "category_name": cat_name,
            "proposed_category": prop.get("categoria_propuesta", ""),
            "proposed_family": prop.get("familia_propuesta", ""),
            "proposal_confidence": prop.get("certeza", ""),
            "audit_verdict": aud.get("verdict", ""),
            "audit_reason": aud.get("reason", ""),
        })

    with CACHE["lock"]:
        CACHE["categories"] = cats
        CACHE["cat_by_id"] = cat_by_id
        CACHE["cat_by_name"] = cat_by_name
        CACHE["products"] = enriched
        CACHE["last_fetch"] = time.time()
    return enriched, cats


def update_cached_product(pid, **fields):
    with CACHE["lock"]:
        for p in CACHE["products"]:
            if p["id"] == pid:
                p.update(fields)
                break


# ==============================================================================
# 5. CONSULTOR IA Y AUDITOR VISUAL HONESTO CON GEMINI
# ==============================================================================
def parse_json_response(raw_text):
    clean = raw_text.strip()
    clean = re.sub(r"^```(?:json)?\s*", "", clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s*```$", "", clean)
    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        clean = clean[start : end + 1]
    return json.loads(clean)


def consult_product_with_ai(product_name, sku="", current_cat="", unit="UND", user_hint=""):
    """Analiza un producto con Gemini y devuelve ficha técnica y consultas optimizadas."""
    min_conf = int(AI_ENGINE_PARAMS.get("min_confidence", 88))
    sys_prompt = build_trained_system_prompt()
    prompt = f"""Analiza el siguiente producto del inventario de JJ Paper C.A.:
- Nombre en sistema: "{product_name}"
- SKU: "{sku or 'Sin SKU'}"
- Unidad de venta: "{unit}"
- Categoría actual: "{current_cat or 'SIN CATEGORÍA'}"
{f'- Aclaratoria directa del usuario: "{user_hint}"' if user_hint else ''}

Devuelve ESTRICTAMENTE un objeto JSON con esta estructura:
{{
  "interpreted_name": "Nombre comercial claro y completo en español de lo que es realmente este artículo",
  "confidence": 95,
  "needs_user_consultation": false,
  "question_for_user": "Si confidence < {min_conf} o hay ambigüedad de medida/color/presentación, escribe aquí una pregunta directa para el usuario. Si no, sugiere cómo afinar la búsqueda",
  "quick_options": ["Opción rápida 1 (ej. Medida Carta)", "Opción rápida 2 (ej. Medida Oficio)", "Opción rápida 3 (ej. Caja x 12 unidades)"],
  "recommended_category": "UNA DE LAS CATEGORÍAS OFICIALES EXACTAS",
  "category_reason": "Por qué pertenece a esta categoría",
  "attributes": {{
    "tipo": "Tipo físico exacto de producto",
    "marca": "Marca comercial o Genérico",
    "color": "Color específico o Surtido / No aplica",
    "medida": "Formato o dimensión (ej. Carta, Oficio, 24mmx30m, Galón, 80 hojas)",
    "empaque": "Presentación (ej. Unidad, Caja x 12, Resma 500 hojas, Bulto)"
  }},
  "search_queries": [
    "Consulta #1 en español específica para buscar foto comercial packshot fondo blanco",
    "Consulta #2 alternativa con marca y medida"
  ],
  "vision_criteria": "Regla exacta de qué debe verse en la fotografía y qué rechazar (color, medida, tipo, marca)"
}}"""

    raw = GEMINI_POOL.generate(
        prompt=prompt,
        system_instruction=sys_prompt,
        json_mode=True,
        preferred_model="gemini-3.5-flash-lite",
    )
    parsed = parse_json_response(raw)
    if int(parsed.get("confidence", 90)) < min_conf:
        parsed["needs_user_consultation"] = True
    return parsed


def verify_image_with_vision(image_bytes, mime_type, product_name, analysis):
    """Audita una imagen con Gemini Vision (gemini-3.6-flash) de forma estricta y honesta."""
    sys_prompt = build_trained_system_prompt()
    attrs = (analysis or {}).get("attributes", {})
    criteria = (analysis or {}).get("vision_criteria", "")
    interp = (analysis or {}).get("interpreted_name", product_name)
    strictness = AI_ENGINE_PARAMS.get("vision_strictness", "alta")

    prompt = f"""Audita visualmente esta imagen para el catálogo de JJ Paper C.A. (Rigor: {strictness.upper()}).
Producto buscado: "{product_name}" ({interp})
Atributos requeridos:
- Tipo de artículo: {attrs.get('tipo', 'N/A')}
- Marca: {attrs.get('marca', 'N/A')}
- Color: {attrs.get('color', 'N/A')}
- Medida / Formato: {attrs.get('medida', 'N/A')}
- Empaque: {attrs.get('empaque', 'N/A')}
Criterio estricto: {criteria}

Evalúa la imagen:
1. ¿Muestra exactamente el mismo TIPO de producto? (Ej. si pide coleto y muestra pañitos de microfibra o un vaso, es REJECTED).
2. ¿Es una fotografía real de producto comercial (y NO una imagen generada por IA, ni caricatura, ni meme)?
3. ¿Coincide en color, medida y marca (o es un packshot comercial limpio y fiel)?

Responde ESTRICTAMENTE en JSON:
{{
  "verdict": "exact_match" | "partial_match" | "rejected",
  "score": 0 a 100,
  "what_i_see": "Descripción breve en español de lo que se ve realmente en la foto",
  "matches": {{
    "tipo": true,
    "marca": true,
    "color": true,
    "medida": true,
    "es_foto_real": true
  }},
  "reason": "Explicación clara en español de por qué aprueba o por qué se rechaza"
}}"""

    raw = GEMINI_POOL.generate(
        prompt=prompt,
        system_instruction=sys_prompt,
        image_bytes=image_bytes,
        mime_type=mime_type,
        temperature=0.05,
        json_mode=True,
        preferred_model="gemini-3.6-flash",
    )
    return parse_json_response(raw)


def audit_candidate_single(cand, product_name, analysis):
    """Audita un único candidato. Si falla, reporta status 'failed' y score None. Cero inventos."""
    cand_id = cand.get("id")
    img_target = cand.get("thumb_url") or cand.get("image_url")
    if not img_target:
        return cand_id, {
            "status": "failed",
            "verdict": None,
            "score": None,
            "what_i_see": "",
            "matches": {},
            "reason": "Candidato sin URL válida",
        }

    try:
        raw_b, mime = download_image_bytes(img_target)
        prep_b, prep_mime = prepare_vision_image(raw_b, max_side=512)
        v_res = verify_image_with_vision(prep_b, prep_mime, product_name, analysis)
        raw_score = v_res.get("score")
        score_val = int(raw_score) if (raw_score is not None and str(raw_score).isdigit()) else None
        return cand_id, {
            "status": "verified",
            "verdict": v_res.get("verdict"),
            "score": score_val,
            "what_i_see": v_res.get("what_i_see", ""),
            "matches": v_res.get("matches", {}),
            "reason": v_res.get("reason", ""),
        }
    except Exception as e:
        # Si falló thumb_url, intentar una vez con image_url completo
        if cand.get("thumb_url") and cand.get("image_url") and cand["thumb_url"] != cand["image_url"]:
            try:
                raw_b, mime = download_image_bytes(cand["image_url"])
                prep_b, prep_mime = prepare_vision_image(raw_b, max_side=512)
                v_res = verify_image_with_vision(prep_b, prep_mime, product_name, analysis)
                raw_score = v_res.get("score")
                score_val = int(raw_score) if (raw_score is not None and str(raw_score).isdigit()) else None
                return cand_id, {
                    "status": "verified",
                    "verdict": v_res.get("verdict"),
                    "score": score_val,
                    "what_i_see": v_res.get("what_i_see", ""),
                    "matches": v_res.get("matches", {}),
                    "reason": v_res.get("reason", ""),
                }
            except Exception:
                pass

        return cand_id, {
            "status": "failed",
            "verdict": None,
            "score": None,
            "what_i_see": "",
            "matches": {},
            "reason": f"Fallo al auditar imagen ({str(e)[:80]})",
        }


def audit_candidates_parallel(candidates, product_name, analysis):
    """Audita todos los candidatos en paralelo utilizando el pool de Gemini Keys."""
    results = {}
    if not candidates:
        return results

    workers = min(7, max(1, len(GEMINI_POOL.keys)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(audit_candidate_single, c, product_name, analysis)
            for c in candidates[:20]
        ]
        for fut in futures:
            cid, v_obj = fut.result()
            results[cid] = v_obj
    return results


def search_verify_product(
    product_id=None,
    name="",
    sku="",
    unit="UND",
    category_name="",
    user_hint="",
    custom_query="",
    analysis=None,
    limit=6,
):
    """Realiza consult + search + vision-verify completo y ordena por score honesto."""
    if not analysis:
        analysis = consult_product_with_ai(
            product_name=name,
            sku=sku,
            current_cat=category_name,
            unit=unit,
            user_hint=user_hint,
        )

    queries = list(analysis.get("search_queries") or [name])
    custom_q = (custom_query or "").strip()
    if custom_q:
        queries = [custom_q] + [q for q in queries if q != custom_q]

    search_res = SEARCH_ENGINE.search(queries, limit=limit)
    candidates = search_res.get("candidates", [])

    if candidates:
        results = audit_candidates_parallel(candidates, name, analysis)
        for c in candidates:
            c["vision"] = results.get(c["id"])

        def _sort_key(c):
            v = c.get("vision") or {}
            score = v.get("score")
            status = v.get("status")
            if status == "verified" and score is not None:
                return (2, score)
            elif status != "failed":
                return (1, 0)
            else:
                return (0, 0)

        candidates.sort(key=_sort_key, reverse=True)

    return {
        "ok": True,
        "analysis": analysis,
        "candidates": candidates,
        "trace": GEMINI_POOL.last_trace,
    }


def approve_photo_action(product_id, image_url, category_name=None, vision=None):
    """Descarga, optimiza a WebP 800px, sube al VPS, actualiza DB y photo audit."""
    if not product_id or not image_url:
        raise ValueError("Faltan product_id o image_url")

    if re.search(r"pollinations|midjourney|stability\.ai|replicate\.delivery", image_url, re.I):
        raise ValueError("Bloqueado: No se permiten imágenes generadas por IA")

    raw_bytes, _ = download_image_bytes(image_url)
    webp_bytes, content_type = convert_to_webp_bytes(raw_bytes, max_side=800)
    ext = "webp"
    storage_path = f"storage/v1/object/jjp-products/{product_id}.{ext}"

    # Copia local en disco para resguardo
    local_dir = BASE_DIR / "data" / "images"
    local_dir.mkdir(parents=True, exist_ok=True)
    (local_dir / f"{product_id}.{ext}").write_bytes(webp_bytes)

    # Subida al VPS Storage
    try:
        vps_request(
            "POST",
            storage_path,
            body=webp_bytes,
            extra_headers={"Content-Type": content_type, "x-upsert": "true"},
            is_binary=True,
        )
    except Exception as e:
        print(f"[WARN] Error en POST storage VPS: {e}")

    public_url = f"{CONFIG['SUPABASE_URL'].rstrip('/')}/storage/v1/object/public/jjp-products/{product_id}.{ext}?v={int(time.time())}"

    patch_payload = {"image_url": public_url}
    new_cat_name = (category_name or "").strip().upper()
    if new_cat_name:
        if not CACHE["cat_by_name"]:
            fetch_catalog_state()
        cat_obj = CACHE["cat_by_name"].get(new_cat_name)
        if cat_obj:
            patch_payload["category_id"] = cat_obj["id"]

    vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{product_id}", patch_payload)
    update_cached_product(product_id, image_url=public_url, has_photo=True, audit_verdict="ok")

    # Registro en jjp_photo_audit
    try:
        conf_val = 100
        matches_val = {}
        reason_val = "Aprobada por operador en Estudio IA v4"
        if vision and isinstance(vision, dict):
            if vision.get("score") is not None:
                conf_val = vision.get("score")
            if vision.get("matches"):
                matches_val = vision.get("matches")
            if vision.get("reason"):
                reason_val = vision.get("reason")

        vps_request("POST", "rest/v1/jjp_photo_audit", {
            "product_id": product_id,
            "image_url": public_url,
            "verdict": "ok",
            "confidence": conf_val,
            "mismatches": matches_val,
            "reason": reason_val,
            "source": "estudio_ia_v4",
            "reviewed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
    except Exception as ae:
        print(f"[WARN] Error registrando jjp_photo_audit: {ae}")

    # Remover de la cola de revisión
    REVIEW_QUEUE.remove(product_id)
    return public_url


# ==============================================================================
# 6. SERVIDOR HTTP DEL ESTUDIO IA (`http://localhost:8795`)
# ==============================================================================
class StudioHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html", "/admin/estudio-fotos.html"):
            index_file = ROOT_DIR / "admin" / "estudio-fotos.html"
            if not index_file.exists():
                index_file = BASE_DIR / "index.html"
            content = index_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
            return

        if path == "/api/status":
            try:
                prods, cats = fetch_catalog_state(force=False)
                with_photo = sum(1 for p in prods if p["has_photo"])
                no_photo = len(prods) - with_photo
                uncat = sum(1 for p in prods if p["category_name"] in ("SIN CATEGORÍA", "VARIOS"))
                b64_count = sum(1 for p in prods if p["is_embedded_b64"])
                self._send_json({
                    "ok": True,
                    "pool": GEMINI_POOL.get_status(),
                    "search_engine": SEARCH_ENGINE.get_status(),
                    "ai_params": AI_ENGINE_PARAMS,
                    "catalog": {
                        "total_products": len(prods),
                        "with_photo": with_photo,
                        "without_photo": no_photo,
                        "uncategorized_or_varios": uncat,
                        "embedded_b64_photos": b64_count,
                        "total_categories": len(cats),
                    },
                    "training_rules_count": len(load_training().get("learned_corrections", [])),
                })
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/products":
            try:
                force = qs.get("refresh", ["0"])[0] == "1"
                prods, cats = fetch_catalog_state(force=force)
                self._send_json({"ok": True, "products": prods, "categories": cats})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/review-queue":
            try:
                items = REVIEW_QUEUE.get_items()
                self._send_json({"ok": True, "items": items})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/batch/status":
            try:
                job_id = qs.get("job_id", [None])[0]
                status_res = BATCH_MANAGER.get_status(job_id)
                self._send_json(status_res)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/training":
            self._send_json({"ok": True, "training": load_training(), "ai_params": AI_ENGINE_PARAMS})
            return

        if path == "/api/ai-params":
            self._send_json({
                "ok": True,
                "ai_params": AI_ENGINE_PARAMS,
                "pool": GEMINI_POOL.get_status(),
                "search_engine": SEARCH_ENGINE.get_status(),
            })
            return

        # Servir archivos estáticos del proyecto (/assets/..., etc.)
        rel = path.lstrip("/")
        static_file = (ROOT_DIR / rel).resolve()
        if str(static_file).startswith(str(ROOT_DIR.resolve())) and static_file.is_file():
            ctype, _ = mimetypes.guess_type(str(static_file))
            content = static_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(content)
            return

        self._send_json({"ok": False, "error": f"Ruta no encontrada: {path}"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8", errors="replace"))
        except Exception:
            body = {}

        try:
            if path == "/api/ai-params":
                for k in ("model", "vision_strictness", "search_suffix", "custom_instructions"):
                    if k in body and isinstance(body[k], str):
                        AI_ENGINE_PARAMS[k] = body[k].strip()
                for k in ("temperature",):
                    if k in body:
                        AI_ENGINE_PARAMS[k] = max(0.0, min(1.0, float(body[k])))
                for k in ("min_confidence", "vision_min_score", "max_candidates"):
                    if k in body:
                        AI_ENGINE_PARAMS[k] = int(body[k])
                self._send_json({
                    "ok": True,
                    "ai_params": AI_ENGINE_PARAMS,
                    "pool": GEMINI_POOL.get_status(),
                    "search_engine": SEARCH_ENGINE.get_status(),
                })
                return

            if path == "/api/consult":
                res = consult_product_with_ai(
                    product_name=body.get("name", ""),
                    sku=body.get("sku", ""),
                    current_cat=body.get("category_name", ""),
                    unit=body.get("unit", "UND"),
                    user_hint=body.get("user_hint", ""),
                )
                self._send_json({
                    "ok": True,
                    "analysis": res,
                    "trace": GEMINI_POOL.last_trace,
                })
                return

            if path in ("/api/search", "/api/search-candidates"):
                queries = body.get("queries") or []
                custom_q = (body.get("custom_query") or "").strip()
                if custom_q:
                    queries = [custom_q] + [q for q in queries if q != custom_q]
                if not queries and body.get("name"):
                    queries = [body.get("name")]

                limit = int(body.get("limit") or AI_ENGINE_PARAMS.get("max_candidates", 6))
                sources = body.get("sources")
                search_res = SEARCH_ENGINE.search(queries, limit=limit, sources=sources)
                self._send_json({
                    "ok": search_res.get("ok", True),
                    "queries_executed": search_res.get("queries_executed", queries),
                    "candidates": search_res.get("candidates", []),
                    "timings": search_res.get("timings", {}),
                    "errors": search_res.get("errors", {}),
                })
                return

            if path == "/api/vision-verify":
                prod_name = body.get("name", "")
                analysis = body.get("analysis") or {}
                candidates = body.get("candidates") or []
                results = audit_candidates_parallel(candidates, prod_name, analysis)
                self._send_json({
                    "ok": True,
                    "results": results,
                    "trace": GEMINI_POOL.last_trace,
                })
                return

            if path == "/api/vision-verify-one":
                prod_name = body.get("name", "")
                analysis = body.get("analysis") or {}
                img_url = body.get("thumb_url") or body.get("image_url") or ""
                cid, vision = audit_candidate_single(
                    {"id": "one", "image_url": img_url, "thumb_url": img_url},
                    prod_name,
                    analysis,
                )
                self._send_json({
                    "ok": True,
                    "vision": vision,
                    "trace": GEMINI_POOL.last_trace,
                })
                return

            if path == "/api/search-verify":
                limit = int(body.get("limit") or AI_ENGINE_PARAMS.get("max_candidates", 6))
                res = search_verify_product(
                    product_id=body.get("product_id"),
                    name=body.get("name", ""),
                    sku=body.get("sku", ""),
                    unit=body.get("unit", "UND"),
                    category_name=body.get("category_name", ""),
                    user_hint=body.get("user_hint", ""),
                    custom_query=body.get("custom_query", ""),
                    analysis=body.get("analysis"),
                    limit=limit,
                )
                self._send_json(res)
                return

            if path == "/api/approve-photo":
                pid = body.get("product_id")
                img_url = body.get("image_url", "")
                cat_name = (body.get("category_name") or "").strip().upper()
                vision = body.get("vision")
                public_url = approve_photo_action(
                    product_id=pid,
                    image_url=img_url,
                    category_name=cat_name,
                    vision=vision,
                )
                self._send_json({"ok": True, "public_url": public_url})
                return

            if path == "/api/batch/start":
                pids = body.get("product_ids") or []
                filter_type = body.get("filter", "sin_foto")
                limit = int(body.get("limit") or 50)
                min_score = int(body.get("min_score") or 85)

                prods, _ = fetch_catalog_state()
                if pids:
                    pid_set = {str(x) for x in pids}
                    target_prods = [p for p in prods if str(p["id"]) in pid_set]
                elif filter_type == "sin_foto":
                    target_prods = [p for p in prods if not p["has_photo"]]
                else:
                    target_prods = prods

                batch_res = BATCH_MANAGER.start(
                    products=target_prods,
                    min_score=min_score,
                    limit=limit,
                    consult_fn=consult_product_with_ai,
                    search_verify_fn=search_verify_product,
                )
                self._send_json(batch_res)
                return

            if path == "/api/batch/stop":
                job_id = body.get("job_id")
                self._send_json(BATCH_MANAGER.stop(job_id))
                return

            if path == "/api/review-queue/decide":
                pid = body.get("product_id")
                action = (body.get("action") or "").lower()
                img_url = body.get("image_url")
                cat_name = body.get("category_name")

                if not pid or action not in ("approve", "reject", "skip"):
                    self._send_json({"ok": False, "error": "Acción inválida o falta product_id"}, 400)
                    return

                if action == "approve":
                    if not img_url:
                        items = REVIEW_QUEUE.get_items()
                        for it in items:
                            if str(it.get("product_id")) == str(pid):
                                img_url = (it.get("best") or {}).get("image_url")
                                break
                    if not img_url:
                        self._send_json({"ok": False, "error": "No se encontró imagen para aprobar"}, 400)
                        return
                    pub_url = approve_photo_action(pid, img_url, category_name=cat_name)
                    self._send_json({"ok": True, "public_url": pub_url})
                    return

                REVIEW_QUEUE.remove(pid)
                self._send_json({"ok": True})
                return

            if path == "/api/audit-existing":
                pid = body.get("product_id")
                prod_name = body.get("name", "")
                img_url = body.get("image_url", "")
                if not img_url:
                    self._send_json({"ok": False, "error": "El producto no tiene imagen para auditar"}, 400)
                    return

                analysis = consult_product_with_ai(
                    product_name=prod_name,
                    sku=body.get("sku", ""),
                    current_cat=body.get("category_name", ""),
                    unit=body.get("unit", "UND"),
                )
                raw_b, mime = download_image_bytes(img_url)
                prep_b, prep_mime = prepare_vision_image(raw_b, max_side=512)
                vision = verify_image_with_vision(prep_b, prep_mime, prod_name, analysis)

                db_verdict = "ok" if vision.get("verdict") == "exact_match" else (
                    "dudosa" if vision.get("verdict") == "partial_match" else "incorrecta"
                )
                reason_str = f"{vision.get('what_i_see', '')} — {vision.get('reason', '')}"
                update_cached_product(pid, audit_verdict=db_verdict, audit_reason=reason_str)
                try:
                    vps_request("POST", "rest/v1/jjp_photo_audit", {
                        "product_id": pid,
                        "image_url": img_url[:500] if not img_url.startswith("data:") else "data:image/webp;base64,[EMBEBIDA]",
                        "verdict": db_verdict,
                        "confidence": vision.get("score", 0),
                        "mismatches": vision.get("matches", {}),
                        "reason": reason_str,
                        "source": "auditoria_estudio_ia",
                    })
                except Exception:
                    pass

                self._send_json({
                    "ok": True,
                    "analysis": analysis,
                    "vision": vision,
                    "db_verdict": db_verdict,
                    "trace": GEMINI_POOL.last_trace,
                })
                return

            if path == "/api/train-feedback":
                raw_name = body.get("name", "").strip()
                clarification = body.get("user_clarification", "").strip()
                category_name = body.get("category", "").strip().upper()
                search_query = body.get("search_query", "").strip()
                product_id = body.get("product_id")

                kb = load_training()
                kb.setdefault("learned_corrections", []).append({
                    "raw_name": raw_name,
                    "user_clarification": clarification,
                    "category": category_name,
                    "search_query": search_query or f"{clarification} fondo blanco",
                    "learned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })
                save_training(kb)

                updated_cat = False
                if product_id and category_name:
                    if not CACHE["cat_by_name"]:
                        fetch_catalog_state()
                    cat_obj = CACHE["cat_by_name"].get(category_name)
                    if cat_obj:
                        vps_request(
                            "PATCH",
                            f"rest/v1/jjp_products?id=eq.{product_id}",
                            {"category_id": cat_obj["id"]},
                        )
                        update_cached_product(product_id, category_id=cat_obj["id"], category_name=cat_obj["name"])
                        updated_cat = True

                self._send_json({
                    "ok": True,
                    "learned_total": len(kb["learned_corrections"]),
                    "updated_category_in_db": updated_cat,
                })
                return

            if path == "/api/quarantine-photo":
                pid = body.get("product_id")
                reason = body.get("reason", "Retirada por auditoría en Estudio IA")
                if not pid:
                    self._send_json({"ok": False, "error": "Falta product_id"}, 400)
                    return
                vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{pid}", {"image_url": None})
                update_cached_product(pid, image_url="", has_photo=False, audit_verdict="incorrecta", audit_reason=reason)
                try:
                    vps_request("POST", "rest/v1/jjp_photo_audit", {
                        "product_id": pid,
                        "image_url": body.get("image_url", "retirada"),
                        "verdict": "incorrecta",
                        "confidence": 100,
                        "reason": reason,
                        "source": "estudio_ia_python",
                    })
                except Exception:
                    pass
                self._send_json({"ok": True})
                return

            if path == "/api/apply-category":
                pid = body.get("product_id")
                cat_name = (body.get("category_name") or "").strip().upper()
                if not CACHE["cat_by_name"]:
                    fetch_catalog_state()
                cat_obj = CACHE["cat_by_name"].get(cat_name)
                if not pid or not cat_obj:
                    self._send_json({"ok": False, "error": f"Categoría '{cat_name}' no encontrada"}, 400)
                    return
                vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{pid}", {"category_id": cat_obj["id"]})
                update_cached_product(pid, category_id=cat_obj["id"], category_name=cat_obj["name"])
                self._send_json({"ok": True, "category_id": cat_obj["id"], "category_name": cat_obj["name"]})
                return

            if path == "/api/confirm-photo":
                pid = body.get("product_id")
                img_url = body.get("image_url", "")
                if not pid:
                    self._send_json({"ok": False, "error": "Falta product_id"}, 400)
                    return
                update_cached_product(pid, audit_verdict="ok", audit_reason="Confirmada manualmente como fotografía correcta.")
                try:
                    vps_request("POST", "rest/v1/jjp_photo_audit", {
                        "product_id": pid,
                        "image_url": img_url[:500] if not img_url.startswith("data:") else "data:image/webp;base64,[EMBEBIDA]",
                        "verdict": "ok",
                        "confidence": 100,
                        "reason": "Confirmada manualmente por el usuario como foto exacta",
                        "source": "estudio_ia_manual",
                    })
                except Exception:
                    pass
                self._send_json({"ok": True})
                return

            if path == "/api/apply-categories-batch":
                items = body.get("items") or []
                if not CACHE["cat_by_name"]:
                    fetch_catalog_state()
                updated = 0
                for it in items:
                    pid = it.get("product_id")
                    cname = (it.get("category_name") or "").strip().upper()
                    cobj = CACHE["cat_by_name"].get(cname)
                    if pid and cobj:
                        try:
                            vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{pid}", {"category_id": cobj["id"]})
                            update_cached_product(pid, category_id=cobj["id"], category_name=cobj["name"])
                            updated += 1
                        except Exception:
                            pass
                self._send_json({"ok": True, "updated": updated})
                return

            if path == "/api/save-training":
                new_kb = body.get("training")
                if not isinstance(new_kb, dict):
                    self._send_json({"ok": False, "error": "Formato de entrenamiento inválido"}, 400)
                    return
                save_training(new_kb)
                self._send_json({"ok": True})
                return

            self._send_json({"ok": False, "error": "Endpoint POST desconocido"}, 404)
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, 500)


def main():
    print("=" * 68)
    print("  JJ PAPER C.A. — ESTUDIO DE ENTRENAMIENTO, BÚSQUEDA Y AUDITORÍA IA v4")
    print("=" * 68)
    print(f"  * VPS Soberano:     {CONFIG['SUPABASE_URL']}")
    print(f"  * Pool Gemini Keys: {len(CONFIG['GEMINI_KEYS'])} llaves activas en rotación")
    print(f"  * Navegador Motor:  {SEARCH_ENGINE.browser_name}")
    print(f"  * Archivo Corpus:   {TRAINING_FILE}")
    print(f"  * Interfaz Web:     http://localhost:{PORT}")
    print("=" * 68)
    threading.Thread(target=lambda: fetch_catalog_state(force=True), daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), StudioHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando Estudio IA...")
        SEARCH_ENGINE.close()
        server.server_close()


if __name__ == "__main__":
    main()
