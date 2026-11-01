#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JJ Paper C.A. — Motor de Búsqueda Web de Imágenes con Navegador Real
=====================================================================
Utiliza Playwright sobre un navegador real (Microsoft Edge o Chrome)
con camuflaje anti-automatización para extraer packshots auténticos
de Google, DuckDuckGo y Bing sin envenenamiento ni bloqueos.
"""

import concurrent.futures
import hashlib
import html
import json
import os
import queue
import re
import threading
import time
import urllib.parse
from pathlib import Path

# Palabras y dominios de stock, cliparts o imágenes falsas
JUNK_WORDS_RE = re.compile(
    r"(pollinations|clipart|cartoon|dibujo|vector|meme|wallpaper|personaje|anime|juego|roblox|minecraft|shutterstock|123rf|depositphotos|freepik|vecteezy|istockphoto|dreamstime)",
    re.IGNORECASE,
)

JUNK_DOMAINS = {
    "shutterstock.com",
    "depositphotos.com",
    "123rf.com",
    "freepik.com",
    "vecteezy.com",
    "istockphoto.com",
    "dreamstime.com",
    "vectorstock.com",
    "cleanpng.com",
    "pngwing.com",
    "pngtree.com",
}

EDGE_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
)


def _clean_text(s: str) -> str:
    """Limpia caracteres de escape unicode y entidades HTML en títulos."""
    if not s or not isinstance(s, str):
        return ""
    if "\\u" in s:
        try:
            s = s.encode("latin1").decode("unicode_escape")
        except Exception:
            pass
    return html.unescape(s).strip()


def _normalize_url(url: str) -> str:
    """Remueve parámetros de query superfluos y anclas para deduplicación exacta."""
    if not url or not isinstance(url, str):
        return ""
    try:
        p = urllib.parse.urlsplit(url)
        return f"{p.scheme}://{p.netloc}{p.path}".lower().rstrip("/")
    except Exception:
        return url.strip().lower()
    try:
        p = urllib.parse.urlsplit(url)
        return f"{p.scheme}://{p.netloc}{p.path}".lower().rstrip("/")
    except Exception:
        return url.strip().lower()


def _extract_mercadolibre_id(url: str) -> str | None:
    """Extrae el ID base de MercadoLibre (ej: 906545-MLA108280484387_032026)."""
    m = re.search(r"D_(?:NQ|Q)_NP_(?:2X_)?([0-9A-Za-z_-]+?)(?:-[OFPV])?\.(?:webp|jpg|jpeg|png)", url, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _to_mercadolibre_high_res(url: str) -> str:
    """Convierte miniaturas o imágenes de baja calidad de MercadoLibre a la versión original -O.webp."""
    return re.sub(
        r"D_(?:NQ|Q)_NP_(?:2X_)?([0-9A-Za-z_-]+?)(?:-[OFPV])?\.(?:webp|jpg|jpeg|png)",
        r"D_NQ_NP_\1-O.webp",
        url,
        flags=re.IGNORECASE,
    )


def _extract_meaningful_words(query: str) -> set[str]:
    """Extrae palabras de 4 o más caracteres ignorando conectores."""
    stop_words = {
        "para", "como", "este", "esta", "estos", "estas", "unos", "unas", "sobre",
        "desde", "entre", "hacia", "hasta", "donde", "cuando", "marca", "color",
        "tipo", "producto", "fondo", "blanco", "packshot", "calidad", "super"
    }
    words = re.findall(r"[a-záéíóúñ]{4,}", query.lower())
    return {w for w in words if w not in stop_words}


class BrowserSearchEngine:
    """
    Motor de búsqueda de imágenes multi-fuente que corre un navegador persistente
    en un hilo dedicado para garantizar thread-safety absoluto con Playwright sync.
    """

    def __init__(self):
        self._task_queue = queue.Queue()
        self._ready_event = threading.Event()
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        self.ready = False
        self.browser_name = "msedge"
        self.last_error = None
        self._durations = []
        self.avg_ms = 0

        self._worker_thread = threading.Thread(
            target=self._run_browser_worker,
            name="PlaywrightBrowserWorker",
            daemon=True,
        )
        self._worker_thread.start()
        # Esperar hasta 20s para que el navegador esté listo
        self._ready_event.wait(timeout=20)

    def _update_timing(self, elapsed_ms: int):
        with self._lock:
            self._durations.append(elapsed_ms)
            if len(self._durations) > 20:
                self._durations.pop(0)
            self.avg_ms = int(sum(self._durations) / len(self._durations))

    def get_status(self) -> dict:
        with self._lock:
            return {
                "ready": self.ready,
                "browser": self.browser_name,
                "last_error": self.last_error,
                "avg_ms": self.avg_ms,
            }

    def _run_browser_worker(self):
        """Loop principal en el hilo exclusivo de Playwright."""
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as ie:
            self.last_error = f"Playwright no disponible: {ie}"
            self._ready_event.set()
            return

        playwright_inst = None
        browser_inst = None
        context_inst = None
        page_inst = None

        def launch_browser():
            nonlocal playwright_inst, browser_inst, context_inst, page_inst
            if playwright_inst is None:
                playwright_inst = sync_playwright().start()

            channels_to_try = [("msedge", "msedge"), ("chrome", "chrome"), (None, "chromium")]
            launched = False
            last_launch_err = None

            for channel, name in channels_to_try:
                try:
                    kwargs = {
                        "headless": True,
                        "args": [
                            "--disable-blink-features=AutomationControlled",
                            "--no-sandbox",
                            "--disable-dev-shm-usage",
                        ],
                    }
                    if channel:
                        kwargs["channel"] = channel
                    browser_inst = playwright_inst.chromium.launch(**kwargs)
                    self.browser_name = name
                    launched = True
                    break
                except Exception as e:
                    last_launch_err = str(e)
                    continue

            if not launched or not browser_inst:
                raise RuntimeError(f"No se pudo iniciar ningún navegador: {last_launch_err}")

            context_inst = browser_inst.new_context(
                locale="es-VE",
                user_agent=EDGE_UA,
                viewport={"width": 1280, "height": 800},
            )

            # Bloquear fuentes y medios pesados para acelerar scraping al máximo
            def _filter_route(route):
                req = route.request
                if req.resource_type in ("font", "media"):
                    route.abort()
                else:
                    route.continue_()

            context_inst.route("**/*", _filter_route)
            page_inst = context_inst.new_page()

        try:
            launch_browser()
            self.ready = True
            self.last_error = None
        except Exception as e:
            self.ready = False
            self.last_error = str(e)
        finally:
            self._ready_event.set()

        # Ciclo de despacho de tareas
        while not self._stop_event.is_set():
            try:
                task = self._task_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            if task is None:
                break

            action, args, kwargs, future = task
            try:
                if action == "search":
                    # Si el navegador se cerró o falló, relanzar una vez
                    if not browser_inst or not context_inst or not page_inst:
                        launch_browser()
                    try:
                        res = self._execute_search(page_inst, *args, **kwargs)
                    except Exception as first_err:
                        # Auto-recuperación: si crashea, relanzar una vez
                        try:
                            if page_inst:
                                try: page_inst.close()
                                except Exception: pass
                            if context_inst:
                                try: context_inst.close()
                                except Exception: pass
                            if browser_inst:
                                try: browser_inst.close()
                                except Exception: pass
                            launch_browser()
                            res = self._execute_search(page_inst, *args, **kwargs)
                        except Exception as retry_err:
                            raise retry_err from first_err
                    future.set_result(res)
                else:
                    future.set_exception(ValueError(f"Acción desconocida: {action}"))
            except Exception as ex:
                self.last_error = str(ex)
                future.set_exception(ex)
            finally:
                self._task_queue.task_done()

        # Limpieza al cerrar
        try:
            if page_inst: page_inst.close()
            if context_inst: context_inst.close()
            if browser_inst: browser_inst.close()
            if playwright_inst: playwright_inst.stop()
        except Exception:
            pass
        self.ready = False

    def close(self):
        self._stop_event.set()
        self._task_queue.put(None)
        if self._worker_thread.is_alive():
            self._worker_thread.join(timeout=3)

    # -------------------------------------------------------------------------
    # Extracción por Fuentes
    # -------------------------------------------------------------------------
    def _search_ddg(self, page, query: str, limit: int = 20) -> list[dict]:
        """Scraping de DuckDuckGo Images interceptando i.js."""
        results = []
        encoded_q = urllib.parse.quote(query)
        url = f"https://duckduckgo.com/?q={encoded_q}&iax=images&ia=images"
        try:
            page.goto(url, timeout=10000, wait_until="commit")
            try:
                with page.expect_response(lambda r: "i.js" in r.url, timeout=7000) as ri:
                    pass
                data = ri.value.json()
                raw_items = data.get("results", [])
                for it in raw_items:
                    img = it.get("image")
                    if not img:
                        continue
                    results.append({
                        "image_url": img,
                        "thumb_url": it.get("thumbnail") or img,
                        "title": _clean_text(it.get("title") or ""),
                        "page_url": it.get("url") or "",
                        "source": "duckduckgo",
                        "width": int(it.get("width") or 800),
                        "height": int(it.get("height") or 800),
                    })
                    if len(results) >= limit:
                        break
            except Exception:
                # Fallback al DOM si expect_response expira
                imgs = page.eval_on_selector_all(
                    "img",
                    "els => els.map(e => ({src: e.src, title: e.alt || ''})).filter(x => x.src.includes('external-content'))",
                )
                for it in imgs:
                    src = it.get("src", "")
                    if src:
                        results.append({
                            "image_url": src,
                            "thumb_url": src,
                            "title": _clean_text(it.get("title") or ""),
                            "page_url": "",
                            "source": "duckduckgo",
                            "width": 800,
                            "height": 800,
                        })
                        if len(results) >= limit:
                            break
        except Exception as e:
            raise RuntimeError(f"Error DuckDuckGo: {e}")
        return results

    def _search_google(self, page, query: str, limit: int = 20) -> list[dict]:
        """Scraping de Google Images (udm=2) extrayendo URLs de alta resolución y metadatos."""
        results = []
        encoded_q = urllib.parse.quote(query)
        url = f"https://www.google.com/search?udm=2&hl=es&q={encoded_q}"
        try:
            page.goto(url, timeout=12000, wait_until="domcontentloaded")
            page.wait_for_timeout(1000)
            content = page.content()

            # En el HTML de Google Images, los bloques de datos contienen:
            # ["https://encrypted-tbn0.gstatic.com...", th_h, th_w], ["https://...imagen_real", h, w]
            # seguido eventualmente de {"2003":[null, id, page_url, title]}
            pattern = re.compile(
                r'\[\"(https://encrypted-tbn0\.gstatic\.com[^\"]+?)\",\d+,\d+\],\[\"(https?://[^\"]+?\.(?:jpg|jpeg|png|webp)[^\"]*?)\",(\d+),(\d+)\]'
            )
            matches = pattern.findall(content)

            seen = set()
            for thumb_raw, img_raw, h_str, w_str in matches:
                if "gstatic" in img_raw:
                    continue
                # Desescapar unicode
                img_url = img_raw.encode("utf-8").decode("unicode_escape", errors="ignore")
                thumb_url = thumb_raw.encode("utf-8").decode("unicode_escape", errors="ignore")
                if img_url in seen:
                    continue
                seen.add(img_url)

                # Buscar título y página de origen cerca de la URL en el HTML
                title = ""
                page_url = ""
                pos = content.find(img_raw)
                if pos != -1:
                    snippet = content[pos : min(len(content), pos + 700)]
                    m_title = re.search(r'\"2003\":\[[^,]+,[^,]+,\"(https?://[^\"]+)\",\"([^\"]+)\"', snippet)
                    if m_title:
                        page_url = _clean_text(m_title.group(1))
                        title = _clean_text(m_title.group(2))

                results.append({
                    "image_url": img_url,
                    "thumb_url": thumb_url,
                    "title": title or query,
                    "page_url": page_url,
                    "source": "google",
                    "width": int(w_str) if w_str.isdigit() else 800,
                    "height": int(h_str) if h_str.isdigit() else 800,
                })
                if len(results) >= limit:
                    break

            # Fallback simple si el regex de pares no captura suficientes
            if len(results) < 5:
                all_imgs = re.findall(r'\[\"(https?://[^\"]+?\.(?:jpg|jpeg|png|webp)[^\"]*?)\",(\d+),(\d+)\]', content)
                for raw_u, h_s, w_s in all_imgs:
                    if "gstatic" in raw_u:
                        continue
                    u = raw_u.encode("utf-8").decode("unicode_escape", errors="ignore")
                    if u not in seen:
                        seen.add(u)
                        results.append({
                            "image_url": u,
                            "thumb_url": u,
                            "title": query,
                            "page_url": "",
                            "source": "google",
                            "width": int(w_s) if w_s.isdigit() else 800,
                            "height": int(h_s) if h_s.isdigit() else 800,
                        })
                        if len(results) >= limit:
                            break
        except Exception as e:
            raise RuntimeError(f"Error Google: {e}")
        return results

    def _search_bing(self, page, query: str, limit: int = 20) -> list[dict]:
        """Scraping de Bing Images leyendo atributos JSON m de elementos a.iusc."""
        results = []
        encoded_q = urllib.parse.quote(query)
        url = f"https://www.bing.com/images/search?q={encoded_q}&form=HDRSC2&setlang=es"
        try:
            page.goto(url, timeout=12000, wait_until="domcontentloaded")
            page.wait_for_timeout(1000)
            ms = page.eval_on_selector_all("a.iusc", "els => els.map(e => e.getAttribute('m'))")
            seen = set()
            for raw_m in ms:
                if not raw_m:
                    continue
                try:
                    data = json.loads(raw_m)
                    murl = data.get("murl")
                    if not murl or murl in seen:
                        continue
                    seen.add(murl)
                    results.append({
                        "image_url": murl,
                        "thumb_url": data.get("turl") or murl,
                        "title": _clean_text(data.get("t") or ""),
                        "page_url": data.get("purl") or "",
                        "source": "bing",
                        "width": 800,
                        "height": 800,
                    })
                    if len(results) >= limit:
                        break
                except Exception:
                    continue
        except Exception as e:
            raise RuntimeError(f"Error Bing: {e}")
        return results

    # -------------------------------------------------------------------------
    # Ejecución Coordinada con Deduplicación y Anti-Envenenamiento
    # -------------------------------------------------------------------------
    def _execute_search(
        self,
        page,
        queries: list[str],
        limit: int = 20,
        sources: list[str] | None = None,
    ) -> dict:
        t0 = time.time()
        active_sources = sources or ["google", "duckduckgo", "bing"]
        results_by_source: dict[str, list[dict]] = {}
        timings: dict[str, int] = {}
        errors: dict[str, str] = {}

        primary_query = queries[0] if queries else ""
        meaningful_words = _extract_meaningful_words(primary_query)

        # 1. Ejecutar cada fuente seleccionada
        for src in active_sources:
            s0 = time.time()
            try:
                src_results = []
                for q in queries[:2]:
                    if src == "google":
                        items = self._search_google(page, q, limit=limit)
                    elif src == "duckduckgo":
                        items = self._search_ddg(page, q, limit=limit)
                    elif src == "bing":
                        items = self._search_bing(page, q, limit=limit)
                    else:
                        continue
                    src_results.extend(items)
                    if len(src_results) >= limit:
                        break

                timings[f"{src}_ms"] = int((time.time() - s0) * 1000)

                # Chequeo de Envenenamiento:
                # Si > 50% de los títulos no comparten palabras significativas con la consulta
                if meaningful_words and src_results:
                    poisoned_count = 0
                    for r in src_results:
                        title_lower = (r.get("title") or "").lower()
                        has_match = any(w in title_lower for w in meaningful_words)
                        if not has_match:
                            poisoned_count += 1
                    ratio = poisoned_count / len(src_results)
                    if ratio > 0.50:
                        errors[src] = f"Fuente descartada: envenenada ({int(ratio*100)}% resultados ajenos a la consulta)"
                        results_by_source[src] = []
                        continue

                results_by_source[src] = src_results
            except Exception as e:
                timings[f"{src}_ms"] = int((time.time() - s0) * 1000)
                errors[src] = str(e)
                results_by_source[src] = []

        # 2. Intercalar resultados (Round-Robin) entre fuentes activas
        combined: list[dict] = []
        max_len = max((len(lst) for lst in results_by_source.values()), default=0)
        for i in range(max_len):
            for src in active_sources:
                lst = results_by_source.get(src, [])
                if i < len(lst):
                    combined.append(lst[i])

        # 3. Filtrado de palabras basura, dominios prohibidos y deduplicación inteligente
        candidates: list[dict] = []
        seen_urls: set[str] = set()
        seen_ml_ids: set[str] = set()

        for it in combined:
            img_url = (it.get("image_url") or "").strip()
            if not img_url:
                continue
            thumb_url = (it.get("thumb_url") or "").strip() or img_url
            title = (it.get("title") or "").strip()
            page_url = (it.get("page_url") or "").strip()
            source = it.get("source", "")
            width = it.get("width", 800)
            height = it.get("height", 800)

            # Filtro basura por texto o URL
            if JUNK_WORDS_RE.search(title) or JUNK_WORDS_RE.search(img_url):
                continue

            parsed_url = urllib.parse.urlparse(img_url)
            domain = parsed_url.netloc.lower()
            if any(junk_d in domain for junk_d in JUNK_DOMAINS):
                continue

            # Deduplicación por URL canónica normalizada
            norm_u = _normalize_url(img_url)
            if norm_u in seen_urls:
                continue

            # Deduplicación de MercadoLibre (preferir original -O.webp)
            ml_id = _extract_mercadolibre_id(img_url)
            if ml_id:
                if ml_id in seen_ml_ids:
                    continue
                seen_ml_ids.add(ml_id)
                img_url = _to_mercadolibre_high_res(img_url)

            seen_urls.add(norm_u)

            # ID determinista de 12 caracteres hex
            cand_id = hashlib.sha1(img_url.encode("utf-8")).hexdigest()[:12]

            candidate_obj = {
                "id": cand_id,
                "image_url": img_url,
                "thumb_url": thumb_url,
                "page_url": page_url,
                "title": title,
                "source": source,
                "domain": domain,
                "width": width,
                "height": height,
                "rank": len(candidates) + 1,
                "vision": None,
            }
            candidates.append(candidate_obj)
            if len(candidates) >= limit:
                break

        total_elapsed = int((time.time() - t0) * 1000)
        self._update_timing(total_elapsed)

        return {
            "ok": True,
            "queries_executed": queries[:2],
            "candidates": candidates,
            "timings": timings,
            "errors": errors,
        }

    # -------------------------------------------------------------------------
    # Método Público Seguro
    # -------------------------------------------------------------------------
    def search(
        self,
        queries: list[str],
        limit: int = 20,
        sources: list[str] | None = None,
        timeout: float = 60.0,
    ) -> dict:
        """
        Envía una tarea de búsqueda al hilo dedicado de Playwright y espera su Future.
        """
        if not queries:
            return {
                "ok": True,
                "queries_executed": [],
                "candidates": [],
                "timings": {},
                "errors": {"query": "Consulta vacía"},
            }

        fut = concurrent.futures.Future()
        self._task_queue.put(("search", (queries,), {"limit": limit, "sources": sources}, fut))
        try:
            return fut.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            self.last_error = f"Búsqueda excedió el timeout de {timeout}s"
            return {
                "ok": False,
                "queries_executed": queries,
                "candidates": [],
                "timings": {},
                "errors": {"timeout": self.last_error},
            }
        except Exception as e:
            return {
                "ok": False,
                "queries_executed": queries,
                "candidates": [],
                "timings": {},
                "errors": {"worker": str(e)},
            }


# Instancia singleton del motor
SEARCH_ENGINE = BrowserSearchEngine()
