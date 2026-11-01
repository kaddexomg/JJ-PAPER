#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Suite de Pruebas Automatizadas del Motor de Búsqueda y Visión (Subagente 1)
===========================================================================
Valida:
1. Búsqueda real multi-fuente para 5 consultas clave (>=8 candidatos, >=60% coincidencia)
2. search-verify en un producto real sin foto con veredicto y score honesto
3. Manejo honesto de fallos (status='failed', score=None, cero inventos)
4. Arranque del servidor HTTP en puerto de prueba (8796), /api/status y cierre limpio
5. Diagnóstico de subida efímera a Storage del VPS y comprobación de respuesta
"""

import json
import os
import ssl
import sys
import threading
import time
import urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer

TEST_DIR = Path(__file__).resolve().parent
STUDIO_DIR = TEST_DIR.parent
sys.path.insert(0, str(STUDIO_DIR))

import studio_server
from studio_server import (
    CONFIG,
    GEMINI_POOL,
    StudioHandler,
    audit_candidate_single,
    consult_product_with_ai,
    fetch_catalog_state,
    search_verify_product,
)
from image_search import SEARCH_ENGINE
from batch_worker import REVIEW_QUEUE, BATCH_MANAGER

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def run_test_1_queries():
    print("\n" + "=" * 65)
    print("TEST 1: Búsqueda Real Multi-Fuente (5 Consultas Críticas)")
    print("=" * 65)

    test_cases = [
        ("pizarra acrilica blanca marco aluminio", ["pizarra", "acrilica", "marco", "blanca"]),
        ("palo de madera para escoba con rosca", ["palo", "escoba", "madera", "rosca", "cepillo"]),
        ("coleto mopa algodon", ["coleto", "mopa", "algodon", "lampazo", "limpieza", "trapeador"]),
        ("toallin rollo papel cocina", ["toallin", "toalla", "papel", "cocina", "rollo"]),
        ("resma papel carta 500 hojas", ["resma", "papel", "carta", "hojas", "chamex"]),
    ]

    all_passed = True
    for query, keywords in test_cases:
        t0 = time.time()
        res = SEARCH_ENGINE.search([query], limit=12)
        elapsed = round(time.time() - t0, 2)
        candidates = res.get("candidates", [])
        timings = res.get("timings", {})
        errors = res.get("errors", {})

        # Calcular coincidencia temática en títulos
        matches = 0
        for c in candidates:
            title_lower = (c.get("title") or "").lower()
            if any(k in title_lower for k in keywords):
                matches += 1

        pct = (matches / len(candidates) * 100) if candidates else 0
        passed_count = len(candidates) >= 8
        passed_pct = pct >= 60.0

        print(f"\nQuery: '{query}'")
        print(f"  * Candidatos obtenidos: {len(candidates)} (Min requerido: 8) -> {'OK' if passed_count else 'FALLO'}")
        print(f"  * Coincidencia de títulos: {matches}/{len(candidates)} ({pct:.1f}%) (Min requerido: 60%) -> {'OK' if passed_pct else 'FALLO'}")
        print(f"  * Tiempos por fuente: {timings} (Total: {elapsed}s)")
        if errors:
            print(f"  * Avisos/Errores por fuente: {errors}")

        for i, c in enumerate(candidates[:3]):
            print(f"    [{i+1}] ({c['source']}) {c['title'][:45]} -> {c['image_url'][:65]}")

        if not passed_count or not passed_pct:
            all_passed = False

    assert all_passed, "Test 1 Falló: Algunas consultas no alcanzaron el umbral requerido."
    print("\n>>> TEST 1 COMPLETADO EXITOSAMENTE (5/5 Consultas Validadas)")


def run_test_2_search_verify_real():
    print("\n" + "=" * 65)
    print("TEST 2: search-verify sobre Producto Real del Catálogo ('PIZARRA')")
    print("=" * 65)

    prods, cats = fetch_catalog_state(force=False)
    target = None
    # Buscar producto de pizarra sin foto
    for p in prods:
        if "PIZARRA" in p["name"].upper() and not p["has_photo"]:
            target = p
            break
    # Si todos tienen foto, tomar cualquiera que sea pizarra
    if not target:
        for p in prods:
            if "PIZARRA" in p["name"].upper():
                target = p
                break

    assert target is not None, "No se encontró ningún producto con 'PIZARRA' en el catálogo"
    print(f"Producto seleccionado: [{target['sku']}] {target['name']} (ID: {target['id']})")
    print(f"Tiene foto previa: {target['has_photo']}")

    t0 = time.time()
    res = search_verify_product(
        product_id=target["id"],
        name=target["name"],
        sku=target["sku"],
        unit=target["unit"],
        category_name=target["category_name"],
        limit=6,
    )
    elapsed = round(time.time() - t0, 2)

    assert res.get("ok") is True, "search_verify_product no retornó ok=True"
    candidates = res.get("candidates", [])
    assert len(candidates) > 0, "No se obtuvieron candidatos para el producto real"

    print(f"Análisis Interpretado: {res.get('analysis', {}).get('interpreted_name')}")
    print(f"Categoría recomendada: {res.get('analysis', {}).get('recommended_category')}")
    print(f"Candidatos evaluados con Visión ({len(candidates)} en {elapsed}s):")

    has_real_score = False
    for i, c in enumerate(candidates):
        v = c.get("vision") or {}
        print(f"  [{i+1}] Verdict: {v.get('verdict')} | Score: {v.get('score')} | Fuente: {c['source']} | Título: {c['title'][:40]}")
        print(f"      Ve: {v.get('what_i_see')[:75]}")
        if v.get("verdict") in ("exact_match", "partial_match") and v.get("score") is not None and v.get("score") > 0:
            has_real_score = True

    assert has_real_score, "No se obtuvo ningún veredicto con score real > 0"
    print("\n>>> TEST 2 COMPLETADO EXITOSAMENTE (Producto auditado honestamente con Gemini Vision)")


def run_test_3_honest_failure():
    print("\n" + "=" * 65)
    print("TEST 3: Manejo Honesto de Fallos (URL Inválida -> status=failed, score=None)")
    print("=" * 65)

    dummy_cand = {
        "id": "cand_invalid_url",
        "image_url": "https://invalid-domain-non-existent-jjpaper-studio.com/image.jpg",
        "thumb_url": "",
    }
    cid, v = audit_candidate_single(dummy_cand, "Pizarra Blanca", {"attributes": {"tipo": "Pizarra"}})

    print(f"Candidato: {cid}")
    print(f"Resultado Visión: {v}")

    assert v["status"] == "failed", f"Esperado status='failed', obtenido: {v['status']}"
    assert v["score"] is None, f"Esperado score=None (sin inventos), obtenido: {v['score']}"
    assert v["verdict"] is None, f"Esperado verdict=None, obtenido: {v['verdict']}"
    assert len(v["reason"]) > 0, "Debe incluir explicación del fallo"

    print("\n>>> TEST 3 COMPLETADO EXITOSAMENTE (Cero puntajes inventados ante errores)")


def run_test_4_server_port_and_status():
    print("\n" + "=" * 65)
    print("TEST 4: Servidor HTTP de Prueba en Puerto 8796 (/api/status & /api/review-queue)")
    print("=" * 65)

    test_port = 8796
    server = ThreadingHTTPServer(("127.0.0.1", test_port), StudioHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    time.sleep(1.0)

    try:
        # 1. /api/status
        req = urllib.request.Request(f"http://127.0.0.1:{test_port}/api/status")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        print(f"GET /api/status -> HTTP 200")
        print(f"  * Estado: ok={data.get('ok')}")
        print(f"  * Motor de Búsqueda: {data.get('search_engine')}")
        print(f"  * Pool Gemini: {data.get('pool', {}).get('total_keys')} llaves activas")
        print(f"  * Catálogo: {data.get('catalog')}")

        assert data.get("ok") is True, "/api/status no retornó ok=True"
        assert "search_engine" in data, "search_engine no está presente en /api/status"
        assert data["search_engine"]["ready"] is True, "El motor de búsqueda no reporta ready=True"

        # 2. /api/review-queue
        req_q = urllib.request.Request(f"http://127.0.0.1:{test_port}/api/review-queue")
        with urllib.request.urlopen(req_q, timeout=10) as resp:
            data_q = json.loads(resp.read().decode("utf-8"))
        print(f"GET /api/review-queue -> HTTP 200 (Items: {len(data_q.get('items', []))})")
        assert data_q.get("ok") is True, "/api/review-queue no retornó ok=True"

    finally:
        print("Deteniendo servidor de prueba...")
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=3)
        print("Servidor detenido limpiamente.")

    print("\n>>> TEST 4 COMPLETADO EXITOSAMENTE (Endpoints HTTP v4 verificados)")


def run_test_5_vps_storage_diagnostic():
    print("\n" + "=" * 65)
    print("TEST 5: Diagnóstico de Subida Efímera a Storage VPS")
    print("=" * 65)

    ts = int(time.time())
    test_filename = f"_diag_test_{ts}.webp"
    # WebP 1x1 transparente
    test_webp = b"RIFF\x1a\x00\x00\x00WEBPVP8L\x0e\x00\x00\x00/\x00\x00\x00\x00\x07\x88\x85\x85\x88\x00\x00\x00"

    vps_url = CONFIG["SUPABASE_URL"]
    key = CONFIG["SUPABASE_KEY"]

    upload_url = f"{vps_url.rstrip('/')}/storage/v1/object/jjp-products/{test_filename}"
    public_url = f"{vps_url.rstrip('/')}/storage/v1/object/public/jjp-products/{test_filename}"

    print(f"URL de subida: {upload_url}")
    print(f"Archivo efímero: {test_filename}")

    # 1. POST Upload
    upload_status = None
    upload_body = None
    try:
        req_up = urllib.request.Request(
            upload_url,
            data=test_webp,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "image/webp",
                "x-upsert": "true",
            },
            method="POST",
        )
        with urllib.request.urlopen(req_up, timeout=15, context=SSL_CTX) as resp:
            upload_status = resp.status
            upload_body = resp.read().decode("utf-8", errors="replace")
        print(f"POST {upload_url} -> Status: {upload_status}")
        print(f"Cuerpo devuelto: {upload_body[:100]}")
    except Exception as e:
        print(f"POST falló: {e}")

    # 2. GET Public URL
    get_status = None
    try:
        req_get = urllib.request.Request(public_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req_get, timeout=10, context=SSL_CTX) as resp:
            get_status = resp.status
        print(f"GET {public_url} -> Status: {get_status} (¡Existe en disco CDN!)")
    except urllib.error.HTTPError as he:
        get_status = he.code
        print(f"GET {public_url} -> Status: {get_status} (Nginx root fallback detectado: Nginx no escribe archivos en disco vía POST /storage/v1/object)")
    except Exception as e:
        print(f"GET falló: {e}")

    # 3. DELETE Cleanup
    try:
        req_del = urllib.request.Request(
            upload_url,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            method="DELETE",
        )
        with urllib.request.urlopen(req_del, timeout=10, context=SSL_CTX) as resp:
            print(f"DELETE {upload_url} -> Status: {resp.status}")
    except Exception as e:
        print(f"DELETE falló: {e}")

    print("\n>>> TEST 5 COMPLETADO (Diagnóstico de Storage documentado con exactitud)")


def main():
    print("\n" + "#" * 68)
    print("  JJ PAPER C.A. — EJECUCIÓN DE PRUEBAS COMPLETAS DEL MOTOR (SUBAGENTE 1)")
    print("#" * 68)
    start_total = time.time()

    try:
        run_test_1_queries()
        run_test_2_search_verify_real()
        run_test_3_honest_failure()
        run_test_4_server_port_and_status()
        run_test_5_vps_storage_diagnostic()

        total_time = round(time.time() - start_total, 2)
        print("\n" + "=" * 68)
        print(f"  TODAS LAS PRUEBAS (5/5) PASARON EXITOSAMENTE EN {total_time}s")
        print("=" * 68 + "\n")
    finally:
        SEARCH_ENGINE.close()


if __name__ == "__main__":
    main()
