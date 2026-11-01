#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JJ Paper C.A. — Gestor de Modo Lote y Cola de Revisión Humana
============================================================
Administra la cola de propuestas en `tools/ai-catalog-studio/data/review_queue.json`
con escrituras atómicas protegidas por candado y un hilo de procesamiento en segundo
plano para barrido progresivo de productos sin foto.
"""

import json
import os
import threading
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
REVIEW_QUEUE_FILE = DATA_DIR / "review_queue.json"


class ReviewQueue:
    """Gestiona la lista de productos pendientes por aprobación humana con persistencia atómica."""

    def __init__(self, queue_file: Path = REVIEW_QUEUE_FILE):
        self.queue_file = queue_file
        self.lock = threading.Lock()
        self._ensure_dir()

    def _ensure_dir(self):
        self.queue_file.parent.mkdir(parents=True, exist_ok=True)

    def get_items(self) -> list[dict]:
        with self.lock:
            if not self.queue_file.exists():
                return []
            try:
                content = self.queue_file.read_text(encoding="utf-8")
                return json.loads(content) if content.strip() else []
            except Exception:
                return []

    def _save_items_atomic(self, items: list[dict]):
        self._ensure_dir()
        tmp_name = self.queue_file.parent / f"review_queue_{int(time.time() * 1000)}.tmp"
        tmp_name.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp_name, self.queue_file)

    def add_or_update(
        self,
        product_id: str,
        name: str,
        sku: str,
        best_candidate: dict,
        alternatives: list[dict],
        analysis: dict,
    ):
        with self.lock:
            items = []
            if self.queue_file.exists():
                try:
                    content = self.queue_file.read_text(encoding="utf-8")
                    items = json.loads(content) if content.strip() else []
                except Exception:
                    items = []

            # Buscar si ya existe para reemplazar o añadir
            updated = False
            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            entry = {
                "product_id": str(product_id),
                "name": name,
                "sku": sku or "",
                "best": best_candidate,
                "alternatives": alternatives,
                "analysis": analysis,
                "created_at": now_iso,
            }

            for idx, it in enumerate(items):
                if str(it.get("product_id")) == str(product_id):
                    items[idx] = entry
                    updated = True
                    break

            if not updated:
                items.append(entry)

            self._save_items_atomic(items)

    def remove(self, product_id: str) -> bool:
        with self.lock:
            if not self.queue_file.exists():
                return False
            try:
                items = json.loads(self.queue_file.read_text(encoding="utf-8"))
            except Exception:
                items = []

            initial_len = len(items)
            items = [it for it in items if str(it.get("product_id")) != str(product_id)]
            if len(items) != initial_len:
                self._save_items_atomic(items)
                return True
            return False

    def clear(self):
        with self.lock:
            self._save_items_atomic([])


class BatchJobManager:
    """Ejecutor en segundo plano para procesar productos por lotes y llenar la cola de revisión."""

    def __init__(self, review_queue: ReviewQueue):
        self.queue = review_queue
        self.lock = threading.Lock()
        self.worker_thread: threading.Thread | None = None
        self.stop_event = threading.Event()

        self.state = "idle"  # idle | running | paused | done
        self.job_id: str | None = None
        self.processed = 0
        self.total = 0
        self.proposals = 0
        self.errors = 0
        self.last_error = None
        self.current_product = None

    def get_status(self, job_id: str | None = None) -> dict:
        with self.lock:
            return {
                "ok": True,
                "job_id": self.job_id,
                "state": self.state,
                "processed": self.processed,
                "total": self.total,
                "proposals": self.proposals,
                "errors": self.errors,
                "last_error": self.last_error,
                "current_product": self.current_product,
            }

    def stop(self, job_id: str | None = None) -> dict:
        with self.lock:
            if self.state == "running":
                self.stop_event.set()
                self.state = "paused"
                return {"ok": True, "message": "Detención solicitada al lote en curso"}
            return {"ok": True, "message": "No hay ningún lote en ejecución"}

    def start(
        self,
        products: list[dict],
        min_score: int,
        limit: int,
        consult_fn,
        search_verify_fn,
    ) -> dict:
        with self.lock:
            if self.state == "running" and self.worker_thread and self.worker_thread.is_alive():
                return {"ok": False, "error": "Ya existe un proceso por lotes ejecutándose", "job_id": self.job_id}

            self.stop_event.clear()
            self.job_id = f"batch_{int(time.time())}"
            self.state = "running"
            self.total = min(len(products), limit)
            self.processed = 0
            self.proposals = 0
            self.errors = 0
            self.last_error = None
            self.current_product = None

            target_products = products[:limit]

            self.worker_thread = threading.Thread(
                target=self._run_worker,
                args=(target_products, min_score, consult_fn, search_verify_fn),
                name=f"BatchWorker-{self.job_id}",
                daemon=True,
            )
            self.worker_thread.start()

            return {"ok": True, "job_id": self.job_id, "total": self.total}

    def _run_worker(
        self,
        target_products: list[dict],
        min_score: int,
        consult_fn,
        search_verify_fn,
    ):
        for prod in target_products:
            if self.stop_event.is_set():
                break

            pid = str(prod["id"])
            pname = prod.get("name", "")
            psku = prod.get("sku", "")
            punit = prod.get("unit", "UND")
            pcat = prod.get("category_name", "")

            with self.lock:
                self.current_product = pname

            try:
                # 1. Búsqueda y Verificación Completa
                res = search_verify_fn(
                    product_id=pid,
                    name=pname,
                    sku=psku,
                    unit=punit,
                    category_name=pcat,
                )

                if res.get("ok"):
                    analysis = res.get("analysis", {})
                    candidates = res.get("candidates", [])

                    # 2. Evaluar candidatos honestos
                    # Filtrar los que tengan verdict exact_match y score >= min_score
                    valid_candidates = [
                        c for c in candidates
                        if (c.get("vision") or {}).get("verdict") == "exact_match"
                        and ((c.get("vision") or {}).get("score") or 0) >= min_score
                    ]

                    if valid_candidates:
                        best = valid_candidates[0]
                        alternatives = [c for c in candidates if c.get("id") != best.get("id")][:4]

                        # 3. Guardar en cola de revisión para aprobación humana
                        self.queue.add_or_update(
                            product_id=pid,
                            name=pname,
                            sku=psku,
                            best_candidate=best,
                            alternatives=alternatives,
                            analysis=analysis,
                        )
                        with self.lock:
                            self.proposals += 1
            except Exception as e:
                with self.lock:
                    self.errors += 1
                    self.last_error = f"{pname}: {str(e)}"

            with self.lock:
                self.processed += 1

            # Pausa de 2 segundos para no agotar cuotas y permitir cooldown
            time.sleep(2.0)

        with self.lock:
            self.state = "done" if not self.stop_event.is_set() else "paused"
            self.current_product = None


# Instancias singleton para exportar
REVIEW_QUEUE = ReviewQueue()
BATCH_MANAGER = BatchJobManager(REVIEW_QUEUE)
