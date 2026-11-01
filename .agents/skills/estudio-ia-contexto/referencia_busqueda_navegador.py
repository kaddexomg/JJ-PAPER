import time, json, re, urllib.parse
from playwright.sync_api import sync_playwright
q = "pizarra acrilica blanca marco aluminio"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel="msedge", args=["--disable-blink-features=AutomationControlled"])
    ctx = b.new_context(locale="es-VE", user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
    pg = ctx.new_page()
    # DuckDuckGo
    t0 = time.time()
    try:
        pg.goto("https://duckduckgo.com/?q=" + urllib.parse.quote(q) + "&iax=images&ia=images", timeout=20000)
        with pg.expect_response(lambda r: "i.js" in r.url, timeout=12000) as ri:
            pass
        d = ri.value.json()
        print("DDG", len(d.get("results", [])), round(time.time()-t0, 1), flush=True)
        for r in d["results"][:6]: print("  ", r["title"][:50], r["image"][:90], flush=True)
    except Exception as e:
        print("DDG fail", str(e)[:200], flush=True)
        imgs = pg.eval_on_selector_all("img", "els => els.map(e => e.src).filter(s => s.includes('external-content'))")
        print("DDG imgs in DOM:", len(imgs), imgs[:3], flush=True)
    # Google
    t0 = time.time()
    try:
        pg.goto("https://www.google.com/search?udm=2&hl=es&q=" + urllib.parse.quote(q), timeout=20000)
        pg.wait_for_timeout(2000)
        html = pg.content()
        urls = re.findall(r'\["(https?://[^"]+?\.(?:jpg|jpeg|png|webp)[^"]*?)",(\d+),(\d+)\]', html)
        urls = [u for u in urls if "gstatic" not in u[0]]
        print("GOOGLE", len(urls), "title:", pg.title()[:60], round(time.time()-t0, 1), "sorry" in pg.url, flush=True)
        for u in urls[:6]: print("  ", u[0][:110], flush=True)
    except Exception as e:
        print("Google fail", str(e)[:200], flush=True)
    # Bing again with edge + real UA
    pg.goto("https://www.bing.com/images/search?q=" + urllib.parse.quote(q) + "&form=HDRSC2&setlang=es", timeout=20000)
    pg.wait_for_timeout(2000)
    ms = pg.eval_on_selector_all("a.iusc", "els => els.map(e => e.getAttribute('m'))")
    print("BING-EDGE", len(ms), flush=True)
    for m in ms[:5]:
        d = json.loads(m); print("  ", d.get("t", "")[:50], d.get("murl", "")[:80], flush=True)
    b.close()
