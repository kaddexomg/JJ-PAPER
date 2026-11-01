// ======================================================================
// JJ Paper — Cloudflare Pages Function: Proxy de Imágenes CORS
// Endpoint: /api/search-images
//
// Por arquitectura soberana (AGENTS.md y estudio-ia-contexto):
// Las búsquedas web se realizan EXCLUSIVAMENTE en el motor local del
// Estudio IA (Playwright + Edge en wa-server / studio_server.py :8795).
// Las funciones serverless de Cloudflare están bloqueadas por IPs de
// datacenter en buscadores comerciales.
//
// Esta función se mantiene estrictamente para:
// 1. ?proxy_url=<url>: Proxy CORS para descargar y optimizar fotos externas
// 2. ?q=<query>: Respuesta honesta indicando que la búsqueda es local
// ======================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const proxyUrl = url.searchParams.get('proxy_url') || url.searchParams.get('proxy') || '';

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=1800'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Proxy seguro de imágenes para eludir bloqueos CORS al convertir a WebP en el navegador
  if (proxyUrl && /^https?:\/\//i.test(proxyUrl)) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const imgRes = await fetch(proxyUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(t);

      if (!imgRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: `HTTP ${imgRes.status}` }), {
          status: 502,
          headers: corsHeaders
        });
      }

      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const buf = await imgRes.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message || 'Proxy error' }), {
        status: 502,
        headers: corsHeaders
      });
    }
  }

  // 2. Respuesta honesta para cualquier consulta de búsqueda
  return new Response(JSON.stringify({
    ok: false,
    error: 'La búsqueda web se realiza en el motor local del Estudio IA',
    results: []
  }), {
    status: 200,
    headers: corsHeaders
  });
}
