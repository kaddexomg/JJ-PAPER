// ======================================================================
// JJ Paper — Cloudflare Pages Function: Proxy de Importación desde
// Google Sheets (CSV). Endpoint: GET /api/sheets-import?url=...
// Descarga la exportación CSV pública de una hoja de cálculo y la
// devuelve como filas JSON, evitando CORS y Mixed Content en el navegador.
// ======================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Parsea CSV respetando comillas, saltos de línea y delimitadores.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row); row = []; field = '';
      } else if (ch === '\r') {
        // ignorar retorno de carro (solo saltos \n)
      } else {
        field += ch;
      }
    }
  }
  // Última fila sin salto final
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => String(c || '').trim() !== ''));
}

// Normaliza la URL de una hoja de cálculo hacia su exportación CSV pública.
function toSheetCsvUrl(rawUrl) {
  const u = (rawUrl || '').trim();
  if (!u) return null;

  try {
    const parsed = new URL(u);
    // Ya es una URL de exportación CSV directa
    if (parsed.hostname === 'docs.google.com' && (u.includes('export?format=csv') || u.includes('output=csv') || (u.includes('/pub') && u.includes('output=csv')))) {
      return u;
    }
  } catch (_) { /* no es URL válida */ }

  // www.google.com o /spreadsheets/d/<id>/edit...
  let m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) {
    // ID crudo pegado
    if (/^[a-zA-Z0-9_-]{10,100}$/.test(u)) {
      return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(u)}/export?format=csv`;
    }
    return null;
  }

  const id = m[1];
  let gid = '';
  m = u.match(/gid=(\d+)/);
  if (m) gid = `&gid=${m[1]}`;

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid}`;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const rawUrl = url.searchParams.get('url') || '';
  const sheet = url.searchParams.get('sheet') || '';

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const csvUrl = toSheetCsvUrl(rawUrl);
  if (!csvUrl) {
    return new Response(JSON.stringify({ ok: false, error: 'URL inválida. Pega el enlace completo de Google Sheets (docs.google.com/spreadsheets/d/...) o el ID de la hoja.' }), { headers: corsHeaders, status: 400 });
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(csvUrl, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8' },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(t);

    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Google no respondió (HTTP ${res.status}). Asegúrate de que la hoja sea pública: Archivo → Compartir → Cualquier persona con el enlace puede ver.` }), { headers: corsHeaders, status: 502 });
    }

    const text = await res.text();
    const rows = parseCSV(text);

    if (!rows.length) {
      return new Response(JSON.stringify({ ok: false, error: 'La hoja está vacía o no se pudo leer.' }), { headers: corsHeaders, status: 422 });
    }

    return new Response(JSON.stringify({
      ok: true,
      source: csvUrl,
      rowsCount: rows.length,
      rows: rows.slice(0, 2000),
      headers: rows[0] || []
    }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'Error de conexión al cargar Google Sheets: ' + err.message }), { headers: corsHeaders, status: 502 });
  }
}