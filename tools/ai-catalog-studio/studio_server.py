#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JJ Paper C.A. — AI Catalog Image Search, Training & Audit Studio
================================================================
Servidor local en Python (puerto 8795) impulsado por el Pool de API Keys de Gemini
y entrenado con el corpus de papelería, oficina, escolar y limpieza (`training/knowledge_base.json`).

Funciones principales:
1. Pool inteligente de API Keys de Gemini con rotación automática, failover de modelos y telemetría.
2. Consultor IA interactivo: interpreta nombres abreviados de MixNet, detecta dudas (<90% certeza),
   pregunta al usuario y guarda cada respuesta en `training/knowledge_base.json` (aprendizaje continuo).
3. Buscador Exacto + Auditoría Visual con Gemini Vision: busca packshots comerciales reales y verifica
   imagen por imagen si coinciden en Tipo, Marca, Color, Medida y Presentación.
4. Auditor de Fotos Existentes y Categorías: examina las fotos actuales del catálogo para detectar
   imágenes equivocadas o inventadas y permite aplicar las 8 familias y 43 categorías oficiales.
5. Compresión nativa a WebP (800px, calidad 82) con Pillow y subida directa al VPS Soberano.
"""

import base64
import csv
import html
import io
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
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


def vps_request(method, path, body=None, extra_headers=None, is_binary=False):
    url = f"{CONFIG['SUPABASE_URL'].rstrip('/')}/{path.lstrip('/')}"
    headers = {
        "apikey": CONFIG["SUPABASE_KEY"],
        "Authorization": f"Bearer {CONFIG['SUPABASE_KEY']}",
        "User-Agent": "JJPaper-AI-Studio/1.0",
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
    """Balanceador rotativo para las API Keys de Gemini con soporte de texto y visión."""

    MODELS = [
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.6-flash",
    ]

    def __init__(self, keys):
        self.lock = threading.Lock()
        self.keys = list(keys)
        self.idx = 0
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
            return {"total_keys": len(self.keys), "models": self.MODELS, "keys": out}

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
            # Si todas están en cooldown, usar la que venza más pronto
            soonest = min(self.stats.keys(), key=lambda k: self.stats[k]["cooldown_until"])
            return soonest, self.keys[soonest]

    def generate(self, prompt, system_instruction="", image_bytes=None, mime_type="image/jpeg", temperature=0.1, json_mode=True):
        parts = [{"text": prompt}]
        if image_bytes:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            parts.append({"inline_data": {"mime_type": mime_type, "data": b64}})

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature, "maxOutputTokens": 1200},
        }
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        last_err = None
        max_attempts = max(4, len(self.keys))
        for attempt in range(max_attempts):
            key_idx, api_key = self._next_key()
            model = self.MODELS[attempt % len(self.MODELS)]
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
                with urllib.request.urlopen(req, timeout=25, context=SSL_CTX) as resp:
                    res_data = json.loads(resp.read().decode("utf-8", errors="replace"))
                text = (
                    res_data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                if not text:
                    raise RuntimeError("Respuesta vacía de Gemini")
                with self.lock:
                    self.stats[key_idx]["success"] += 1
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
        return {}
    return json.loads(TRAINING_FILE.read_text(encoding="utf-8"))


def save_training(data):
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    TRAINING_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRAINING_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def build_trained_system_prompt():
    kb = load_training()
    abbr_str = "\n".join(f"- {k}: {v}" for k, v in kb.get("abbreviations", {}).items())
    brands_str = ", ".join(kb.get("venezuelan_brands", []))
    must_have = "\n".join(f"- {r}" for r in kb.get("image_search_rules", {}).get("must_have", []))
    forbidden = "\n".join(f"- {r}" for r in kb.get("image_search_rules", {}).get("strictly_forbidden", []))
    cats_str = ", ".join(kb.get("official_categories", []))

    examples_str = ""
    for ex in kb.get("few_shot_examples", [])[:10]:
        examples_str += (
            f"\n* Producto MixNet: '{ex['raw_name']}' -> Interpretación: {ex['interpreted_product']} "
            f"| Categoría: {ex['category']} | Consultas: {ex['optimal_queries']} "
            f"| Criterio Visual: {ex['vision_criteria']}"
        )

    learned_str = ""
    for lc in kb.get("learned_corrections", [])[-25:]:
        learned_str += (
            f"\n* CORRECCIÓN APRENDIDA DEL USUARIO sobre '{lc.get('raw_name')}': "
            f"Es '{lc.get('user_clarification')}' | Categoría oficial: {lc.get('category')} "
            f"| Buscar como: '{lc.get('search_query')}'"
        )

    return f"""{kb.get('system_role', '')}

=== DICCIONARIO DE ABREVIATURAS MIXNET / CLIPPER ===
{abbr_str}

=== MARCAS COMERCIALES REALES EN VENEZUELA ===
{brands_str}

=== 43 CATEGORÍAS OFICIALES DE JJ PAPER ===
{cats_str}

=== REGLAS OBLIGATORIAS DE BÚSQUEDA Y AUDITORÍA VISUAL ===
DEBE CUMPLIR:
{must_have}

ESTRICTAMENTE PROHIBIDO:
{forbidden}

=== EJEMPLOS DE ENTRENAMIENTO ===
{examples_str}

=== LECCIONES APRENDIDAS DIRECTAMENTE DEL USUARIO (PRIORIDAD MÁXIMA) ===
{learned_str if learned_str else '(Ninguna corrección adicional registrada aún)'}
"""


# ==============================================================================
# 3. BÚSQUEDA WEB DE IMÁGENES COMERCIALES Y DESCARGA SEGURA
# ==============================================================================
JUNK_WORDS = re.compile(
    r"winnie|pooh|peppa|disney|cartoon|caricatura|anime|manga|meme|anatomia|anatomy|"
    r"medical|cirugia|organo|tattoo|wallpaper|coloring\s*page|dibujo\s*para\s*colorear|"
    r"pollinations|midjourney|stable\s*diffusion|roblox|minecraft",
    re.IGNORECASE,
)


def search_web_images(query, max_results=6):
    """Busca packshots reales en Bing Images y filtra resultados basura."""
    clean_q = f"{query} producto -cartoon -clipart -dibujo"
    url = f"https://www.bing.com/images/search?q={urllib.parse.quote(clean_q)}&form=HDRSC2&first=1"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "es-VE,es;q=0.9"})
    results = []
    try:
        with urllib.request.urlopen(req, timeout=12, context=SSL_CTX) as resp:
            page = resp.read().decode("utf-8", errors="ignore")
        matches = re.findall(r'm="(\{[^"]*murl[^"]*\})"', page)
        seen = set()
        for raw_m in matches:
            try:
                info = json.loads(html.unescape(raw_m))
                img_url = info.get("murl", "")
                thumb_url = info.get("turl", "") or img_url
                title = info.get("t", "") or ""
                if not img_url or img_url in seen:
                    continue
                if JUNK_WORDS.search(title) or JUNK_WORDS.search(img_url):
                    continue
                seen.add(img_url)
                results.append({
                    "image_url": img_url,
                    "thumb_url": thumb_url,
                    "title": title,
                })
                if len(results) >= max_results:
                    break
            except Exception:
                continue
    except Exception as e:
        print(f"[WARN] Error buscando en Bing '{query}': {e}")
    return results


def download_image_bytes(url):
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


def convert_to_webp_bytes(raw_bytes, max_side=800):
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
    img.save(out, format="WEBP", quality=82, method=4)
    return out.getvalue(), "image/webp"


# ==============================================================================
# 4. CACHÉ DE PRODUCTOS, CATEGORÍAS Y PROPUESTAS CSV
# ==============================================================================
CACHE = {
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


def fetch_catalog_state():
    cats = vps_request("GET", "rest/v1/jjp_categories?select=id,name,slug,emoji,sort_order,group_id&order=sort_order") or []
    CACHE["categories"] = cats
    CACHE["cat_by_id"] = {c["id"]: c for c in cats}
    CACHE["cat_by_name"] = {c["name"].upper(): c for c in cats}

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

    proposals = load_csv_proposals()
    enriched = []
    for p in prods:
        pid = p["id"]
        cat_obj = CACHE["cat_by_id"].get(p.get("category_id"))
        cat_name = cat_obj["name"] if cat_obj else "SIN CATEGORÍA"
        img = (p.get("image_url") or "").strip()
        has_photo = len(img) > 12 and img not in ("null", "undefined")
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
    return enriched, cats


# ==============================================================================
# 5. CONSULTOR IA Y AUDITOR VISUAL CON GEMINI
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
    """Analiza un producto con el modelo entrenado: devuelve ficha, consultas y pregunta si hay duda."""
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
  "question_for_user": "Si confidence < 88, escribe aquí la pregunta directa y honesta para el usuario explicando tu duda. Si tienes certeza >= 88, deja cadena vacía",
  "quick_options": ["Opción 1 para el usuario", "Opción 2 para el usuario"],
  "recommended_category": "UNA DE LAS 43 CATEGORÍAS OFICIALES EXACTAS",
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

    raw = GEMINI_POOL.generate(prompt=prompt, system_instruction=sys_prompt, temperature=0.1, json_mode=True)
    return parse_json_response(raw)


def verify_image_with_vision(image_bytes, mime_type, product_name, analysis):
    """Pasa una imagen candidata (o actual) por Gemini Vision contra la ficha de atributos del producto."""
    sys_prompt = build_trained_system_prompt()
    attrs = analysis.get("attributes", {})
    criteria = analysis.get("vision_criteria", "")
    interp = analysis.get("interpreted_name", product_name)

    prompt = f"""Audita visualmente esta imagen candidata para el catálogo de JJ Paper C.A.
Producto buscado: "{product_name}" ({interp})
Atributos requeridos:
- Tipo de artículo: {attrs.get('tipo', 'N/A')}
- Marca: {attrs.get('marca', 'N/A')}
- Color: {attrs.get('color', 'N/A')}
- Medida / Formato: {attrs.get('medida', 'N/A')}
- Empaque: {attrs.get('empaque', 'N/A')}
Criterio estricto: {criteria}

Evalúa la imagen con rigor absoluto:
1. ¿Muestra exactamente el mismo TIPO de producto? (Ej. si pide coleto y muestra pañitos de microfibra o un vaso, es REJECTED).
2. ¿Es una fotografía real de producto comercial (y NO una imagen generada por IA como Pollinations, ni caricatura, ni meme)?
3. ¿Coincide en color, medida y marca (o es un packshot comercial limpio y fiel)?

Responde ESTRICTAMENTE en JSON:
{{
  "verdict": "exact_match" | "partial_match" | "rejected",
  "score": 0 a 100,
  "what_i_see": "Descripción breve de lo que se ve realmente en la foto",
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
    )
    return parse_json_response(raw)


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
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            index_file = BASE_DIR / "index.html"
            content = index_file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if path == "/api/status":
            try:
                prods, cats = fetch_catalog_state()
                with_photo = sum(1 for p in prods if p["has_photo"])
                no_photo = len(prods) - with_photo
                uncat = sum(1 for p in prods if p["category_name"] in ("SIN CATEGORÍA", "VARIOS"))
                b64_count = sum(1 for p in prods if p["is_embedded_b64"])
                self._send_json({
                    "ok": True,
                    "pool": GEMINI_POOL.get_status(),
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
                prods, cats = fetch_catalog_state()
                self._send_json({"ok": True, "products": prods, "categories": cats})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/training":
            self._send_json({"ok": True, "training": load_training()})
            return

        self._send_json({"ok": False, "error": "Ruta no encontrada"}, 404)

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
            if path == "/api/consult":
                res = consult_product_with_ai(
                    product_name=body.get("name", ""),
                    sku=body.get("sku", ""),
                    current_cat=body.get("category_name", ""),
                    unit=body.get("unit", "UND"),
                    user_hint=body.get("user_hint", ""),
                )
                self._send_json({"ok": True, "analysis": res})
                return

            if path == "/api/search-verify":
                prod_name = body.get("name", "")
                analysis = body.get("analysis")
                if not analysis:
                    analysis = consult_product_with_ai(
                        product_name=prod_name,
                        sku=body.get("sku", ""),
                        current_cat=body.get("category_name", ""),
                        unit=body.get("unit", "UND"),
                        user_hint=body.get("user_hint", ""),
                    )
                queries = analysis.get("search_queries") or [prod_name]
                custom_q = (body.get("custom_query") or "").strip()
                if custom_q:
                    queries = [custom_q] + queries

                raw_candidates = []
                seen_urls = set()
                for q in queries[:2]:
                    for item in search_web_images(q, max_results=5):
                        if item["image_url"] not in seen_urls:
                            seen_urls.add(item["image_url"])
                            raw_candidates.append(item)
                        if len(raw_candidates) >= 6:
                            break
                    if len(raw_candidates) >= 6:
                        break

                audited_candidates = []
                max_to_verify = min(4, len(raw_candidates))
                for idx, cand in enumerate(raw_candidates):
                    if idx < max_to_verify:
                        try:
                            img_bytes, mime = download_image_bytes(cand["thumb_url"] or cand["image_url"])
                            vision = verify_image_with_vision(img_bytes, mime, prod_name, analysis)
                            cand["vision"] = vision
                        except Exception as ve:
                            cand["vision"] = {
                                "verdict": "partial_match",
                                "score": 50,
                                "what_i_see": "No se pudo descargar miniatura para visión",
                                "reason": str(ve),
                            }
                    else:
                        cand["vision"] = {
                            "verdict": "partial_match",
                            "score": 50,
                            "what_i_see": "Candidato adicional sin auditar",
                            "reason": "Candidato de respaldo",
                        }
                    audited_candidates.append(cand)

                audited_candidates.sort(key=lambda c: c.get("vision", {}).get("score", 0), reverse=True)
                self._send_json({
                    "ok": True,
                    "analysis": analysis,
                    "candidates": audited_candidates,
                })
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
                img_bytes, mime = download_image_bytes(img_url)
                vision = verify_image_with_vision(img_bytes, mime, prod_name, analysis)

                db_verdict = "ok" if vision.get("verdict") == "exact_match" else (
                    "dudosa" if vision.get("verdict") == "partial_match" else "incorrecta"
                )
                try:
                    vps_request("POST", "rest/v1/jjp_photo_audit", {
                        "product_id": pid,
                        "image_url": img_url[:500] if not img_url.startswith("data:") else "data:image/webp;base64,[EMBEBIDA]",
                        "verdict": db_verdict,
                        "confidence": vision.get("score", 0),
                        "mismatches": vision.get("matches", {}),
                        "reason": f"{vision.get('what_i_see', '')} — {vision.get('reason', '')}",
                        "source": "auditoria_estudio_ia",
                    })
                except Exception:
                    pass

                self._send_json({
                    "ok": True,
                    "analysis": analysis,
                    "vision": vision,
                    "db_verdict": db_verdict,
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

                # Si se indicó categoría oficial y product_id, actualizar en PostgreSQL
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
                        updated_cat = True

                self._send_json({
                    "ok": True,
                    "learned_total": len(kb["learned_corrections"]),
                    "updated_category_in_db": updated_cat,
                })
                return

            if path == "/api/approve-photo":
                pid = body.get("product_id")
                img_url = body.get("image_url", "")
                new_cat_name = (body.get("category_name") or "").strip().upper()
                if not pid or not img_url:
                    self._send_json({"ok": False, "error": "Faltan product_id o image_url"}, 400)
                    return

                if re.search(r"pollinations|midjourney|stability\.ai", img_url, re.I):
                    self._send_json({"ok": False, "error": "Bloqueado: No se permiten imágenes generadas por IA"}, 400)
                    return

                raw_bytes, _ = download_image_bytes(img_url)
                webp_bytes, content_type = convert_to_webp_bytes(raw_bytes, max_side=800)
                ext = "webp" if content_type == "image/webp" else "jpg"
                storage_path = f"storage/v1/object/jjp-products/{pid}.{ext}"

                vps_request(
                    "POST",
                    storage_path,
                    body=webp_bytes,
                    extra_headers={"Content-Type": content_type, "x-upsert": "true"},
                    is_binary=True,
                )
                public_url = f"{CONFIG['SUPABASE_URL'].rstrip('/')}/storage/v1/object/public/jjp-products/{pid}.{ext}?t={int(time.time())}"

                patch_payload = {"image_url": public_url}
                if new_cat_name:
                    if not CACHE["cat_by_name"]:
                        fetch_catalog_state()
                    cat_obj = CACHE["cat_by_name"].get(new_cat_name)
                    if cat_obj:
                        patch_payload["category_id"] = cat_obj["id"]

                vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{pid}", patch_payload)

                try:
                    vps_request("POST", "rest/v1/jjp_photo_audit", {
                        "product_id": pid,
                        "image_url": public_url,
                        "verdict": "ok",
                        "confidence": 100,
                        "reason": "Aprobada y verificada en Estudio IA JJ Paper",
                        "source": "estudio_ia_python",
                    })
                except Exception:
                    pass

                self._send_json({"ok": True, "public_url": public_url})
                return

            if path == "/api/quarantine-photo":
                pid = body.get("product_id")
                reason = body.get("reason", "Retirada por auditoría en Estudio IA")
                if not pid:
                    self._send_json({"ok": False, "error": "Falta product_id"}, 400)
                    return
                vps_request("PATCH", f"rest/v1/jjp_products?id=eq.{pid}", {"image_url": None})
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
                self._send_json({"ok": True, "category_id": cat_obj["id"], "category_name": cat_obj["name"]})
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
    print("  JJ PAPER C.A. — ESTUDIO DE ENTRENAMIENTO, BÚSQUEDA Y AUDITORÍA IA")
    print("=" * 68)
    print(f"  * VPS Soberano:     {CONFIG['SUPABASE_URL']}")
    print(f"  * Pool Gemini Keys: {len(CONFIG['GEMINI_KEYS'])} llaves activas en rotación")
    print(f"  * Archivo Corpus:   {TRAINING_FILE}")
    print(f"  * Interfaz Web:     http://localhost:{PORT}")
    print("=" * 68)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), StudioHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando Estudio IA...")
        server.server_close()


if __name__ == "__main__":
    main()
