// ======================================================================
// JJ Paper — Servidor de conteo OFFLINE por WiFi local
//
// Corre dentro del wa-server (en la PC). Sirve la app y una API por la
// red local, así el teléfono cuenta AUNQUE no haya internet: abre
// http://<IP-de-la-PC>:8787/admin/escaner.html (mismo origen que la API).
//
// - Cada escaneo se resuelve contra el catálogo cacheado y se bufferiza
//   en disco (count-buffer.json). No se pierde nada aunque se reinicie.
// - La PC ve el conteo en vivo por SSE (/lan/feed).
// - Cuando vuelve internet, el buffer se sube a Supabase en lote
//   (RPC jjp_count_apply_batch) y el acumulado se fusiona con el compartido.
//
// Sin dependencias nuevas: http/fs/os/path nativos + el cliente Supabase.
// ======================================================================
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';
import { db } from './supabase.js';
import { log } from './logger.js';
import {
  COUNT_LAN_PORT, COUNT_SESSION, COUNT_SYNC_MS, COUNT_ONLINE_MS,
  COUNT_CATALOG_MS, REPO_ROOT
} from './config.js';

// La cámara del teléfono SOLO funciona en HTTPS o en localhost. Por eso el
// servidor sirve la misma app+API por HTTPS (cert propio persistido en disco,
// así el teléfono acepta la advertencia UNA sola vez) en HTTPS_PORT, y mantiene
// el puerto HTTP original para la PC. HTTPS_PORT = COUNT_LAN_PORT + 1.
const HTTPS_PORT = COUNT_LAN_PORT + 1;
const BUFFER_FILE = path.join(REPO_ROOT, 'wa-server', 'count-buffer.json');
const CERT_FILE   = path.join(REPO_ROOT, 'wa-server', 'lan-cert.pem');
const KEY_FILE    = path.join(REPO_ROOT, 'wa-server', 'lan-key.pem');

// Cert autofirmado para la LAN: se genera una vez y se reutiliza (10 años).
// selfsigned v5 es asíncrono y resuelve { private, public, cert, fingerprint }.
async function lanCert() {
  try {
    if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
      return { cert: fs.readFileSync(CERT_FILE, 'utf8'), key: fs.readFileSync(KEY_FILE, 'utf8') };
    }
  } catch (_) {}
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'jjpaper-lan' }],
    {
      days: 3650, keySize: 2048,
      extensions: [{
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: lanIp() },
        ],
      }],
    },
  );
  try {
    fs.writeFileSync(CERT_FILE, pems.cert);
    fs.writeFileSync(KEY_FILE, pems.private);
  } catch (e) { log.warn({ err: e?.message }, 'count-lan: no se pudo persistir el cert (se regenerará)'); }
  return { cert: pems.cert, key: pems.private };
}

// ---- Estado en memoria ----
let state = {
  session:   COUNT_SESSION,
  ownerId:   null,
  catalogAt: null,
  catalog:   [],        // [{id,barcode,sku,name,emoji,brand,category,image_url,price,dupe}]
  base:      {},        // vid -> acumulado en Supabase (último conocido)
  pending:   [],        // [{v,d,by,at}] deltas aún sin subir
  counters:  {},        // device -> unidades contadas en la sesión
  unknowns:  {},        // code -> {seen,device,last}
  syncedAt:  null,
};
let online = true;
let byBarcode = new Map();      // code -> {id,name,sku,emoji,dupe}
const sseClients = new Set();
let saveTimer = null;

// ---- Persistencia ----
function loadBuffer() {
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf8'));
      state = { ...state, ...raw };
      rebuildIndex();
      log.info({ pending: state.pending.length, catalog: state.catalog.length }, 'count-lan: buffer recuperado');
    }
  } catch (e) { log.warn({ err: e?.message }, 'count-lan: no se pudo leer el buffer'); }
}
function saveBuffer() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(BUFFER_FILE, JSON.stringify(state)); }
    catch (e) { log.warn({ err: e?.message }, 'count-lan: no se pudo guardar el buffer'); }
  }, 800);
}

function rebuildIndex() {
  byBarcode = new Map();
  const seen = new Map();
  for (const it of state.catalog) {
    if (it.barcode) seen.set(it.barcode, (seen.get(it.barcode) || 0) + 1);
  }
  for (const it of state.catalog) {
    if (!it.barcode) continue;
    const dupe = (seen.get(it.barcode) || 0) > 1;
    // el más "fresco" gana si hay repetidos: el catálogo ya viene ordenado por la RPC
    if (!byBarcode.has(it.barcode)) byBarcode.set(it.barcode, { ...it, dupe });
  }
}

// ---- Catálogo + dueño desde Supabase (cuando hay internet) ----
async function detectOwner() {
  if (state.ownerId) return;
  const { data } = await withTimeout(
    db.from('jjp_count_tally').select('owner_id').eq('session_key', state.session).limit(1), 6000);
  if (data?.[0]?.owner_id) { state.ownerId = data[0].owner_id; saveBuffer(); }
}

async function refreshCatalog() {
  let data, error;
  try { ({ data, error } = await withTimeout(db.rpc('jjp_count_catalog', { p_only_active: true }), 12000)); }
  catch (e) { markProbe(false, e); return false; }
  if (error) { markProbe(false, error); return false; }
  markProbe(true);
  if (!data) return false;
  state.catalog = data.map(r => ({
    id: r.variant_id, barcode: r.barcode, sku: r.sku, name: r.product_name,
    emoji: r.emoji, brand: r.brand_name, category: r.category_name,
    image_url: r.image_url, price: r.price_usd,
  }));
  // base = acumulado real en Supabase (counted >= 0 significa contado)
  const base = {};
  for (const r of data) if (r.counted >= 0) base[r.variant_id] = r.counted;
  state.base = base;
  state.catalogAt = new Date().toISOString();
  rebuildIndex();
  saveBuffer();
  broadcast('state', publicState());
  return true;
}

// ---- Cálculo del acumulado (base + lo pendiente por subir) ----
function tallyOf(vid) {
  let n = state.base[vid] || 0;
  for (const p of state.pending) if (p.v === vid) n += p.d;
  return Math.max(0, n);
}
function fullTally() {
  const ids = new Set([...Object.keys(state.base), ...state.pending.map(p => p.v)]);
  const out = {};
  for (const id of ids) out[id] = tallyOf(id);
  return out;
}

// ---- Aplicar un escaneo ----
function applyScan(code, device) {
  code = String(code || '').trim();
  if (!code) return { ok: false, kind: 'vacio' };
  const hit = byBarcode.get(code);
  if (!hit) {
    const u = state.unknowns[code] || { seen: 0, device, last: null };
    u.seen += 1; u.device = device || u.device; u.last = Date.now();
    state.unknowns[code] = u;
    saveBuffer();
    broadcast('scan', { ok: false, kind: 'nuevo', code, device });
    return { ok: false, kind: 'nuevo', code };
  }
  return bump(hit.id, 1, device, hit);
}

function bump(vid, delta, device, hit) {
  hit = hit || state.catalog.find(c => c.id === vid);
  if (!hit) return { ok: false, kind: 'nuevo' };
  state.pending.push({ v: vid, d: delta, by: device || 'LAN', at: Date.now() });
  if (delta > 0) state.counters[device || 'LAN'] = (state.counters[device || 'LAN'] || 0) + delta;
  const counted = tallyOf(vid);
  saveBuffer();
  const res = { ok: true, kind: 'contado', variant_id: vid, name: hit.name,
    sku: hit.sku, counted, dupe: !!hit.dupe, device };
  broadcast('scan', res);
  return res;
}

function setExact(vid, total, device) {
  const cur = tallyOf(vid);
  const delta = Math.max(0, parseInt(total, 10) || 0) - cur;
  if (delta !== 0) state.pending.push({ v: vid, d: delta, by: device || 'LAN', at: Date.now() });
  const counted = tallyOf(vid);
  saveBuffer();
  const hit = state.catalog.find(c => c.id === vid) || {};
  const res = { ok: true, kind: 'ajuste', variant_id: vid, name: hit.name, counted, device };
  broadcast('scan', res);
  return res;
}

function resolveUnknown(code) {
  delete state.unknowns[String(code || '').trim()];
  saveBuffer();
}

// ---- Conexión con Supabase (robusta) ----
// CLAVE: sólo un fallo de RED marca offline. Un error lógico de Postgres
// significa que SÍ llegamos al servidor → seguimos online. Antes cualquier
// error de una RPC apagaba la conexión y hacía "flapping" (se veía offline
// con internet). Además toda llamada lleva timeout para no quedar colgado.
function isNetworkError(err) {
  if (!err) return false;
  if (err.code || err.status || err.statusCode) return false;   // hubo respuesta del servidor
  const m = (err.message || err.toString() || '').toLowerCase();
  return err.name === 'AbortError' || err.name === 'TypeError'
      || m.includes('fetch') || m.includes('network') || m.includes('timeout')
      || m.includes('enotfound') || m.includes('econn') || m.includes('getaddrinfo')
      || m.includes('socket') || m.includes('dns') || m.includes('failed');
}

function setOnline(v) {
  if (online === v) { return; }
  online = v;
  log.info({ online }, 'count-lan: ' + (online ? 'CONECTADO' : 'sin internet'));
  broadcast('online', { online, pending: state.pending.length });
  if (online) syncNow().catch(() => {});   // al reconectar, sube lo pendiente ya
}
function markProbe(ok, err) {
  if (ok) return setOnline(true);
  if (isNetworkError(err)) return setOnline(false);
  return setOnline(true);   // error lógico → estamos online igual
}

// Ejecuta una consulta de Supabase con timeout (evita quedarse "esperando")
async function withTimeout(builder, ms = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try { return await builder.abortSignal(ctrl.signal); }
  finally { clearTimeout(to); }
}

async function checkOnline() {
  try {
    const { error } = await withTimeout(
      db.from('jjp_product_variants').select('id', { head: true }).limit(1), 6000);
    markProbe(!error, error);
  } catch (e) { markProbe(false, e); }
  if (online && !state.ownerId) await detectOwner().catch(() => {});
}

// ---- Subida a Supabase ----
let syncing = false;
async function syncNow() {
  if (syncing || !state.pending.length || !state.ownerId) return;  // sin guard de "online": el intento se auto-diagnostica
  syncing = true;
  try {
    const sent = state.pending.splice(0, state.pending.length);   // saca todo; lo nuevo entra en la próxima vuelta
    const byDevice = {};
    for (const p of sent) {
      const dev = p.by || 'LAN';
      byDevice[dev] = byDevice[dev] || {};
      byDevice[dev][p.v] = (byDevice[dev][p.v] || 0) + p.d;
    }
    const failed = [];
    let netDown = false, appliedAny = false;
    for (const [dev, map] of Object.entries(byDevice)) {
      if (netDown) { for (const [v, d] of Object.entries(map)) failed.push({ v, d, by: dev, at: Date.now() }); continue; }
      try {
        const { data, error } = await withTimeout(db.rpc('jjp_count_apply_batch', {
          p_owner: state.ownerId, p_session: state.session, p_by: dev, p_items: Object.entries(map).map(([v, d]) => ({ v, d }))
        }), 9000);
        if (error) {
          for (const [v, d] of Object.entries(map)) failed.push({ v, d, by: dev, at: Date.now() });
          markProbe(false, error);
          if (isNetworkError(error)) netDown = true;
          else log.warn({ err: error.message }, 'count-lan: error lógico al subir (se reintenta)');
        } else {
          appliedAny = true;
          markProbe(true);
          if (data?.totals) for (const [v, total] of Object.entries(data.totals)) state.base[v] = total;
        }
      } catch (e) {
        for (const [v, d] of Object.entries(map)) failed.push({ v, d, by: dev, at: Date.now() });
        markProbe(false, e); netDown = true;
      }
    }
    if (failed.length) state.pending.unshift(...failed);
    state.syncedAt = new Date().toISOString();
    saveBuffer();
    broadcast('state', publicState());
    if (appliedAny) log.info({ pending: state.pending.length }, 'count-lan: conteo subido a Supabase');
  } finally { syncing = false; }
}

// ---- SSE ----
function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(line); } catch (e) {} }
}

function publicState() {
  return {
    session: state.session, online, pending: state.pending.length,
    catalogAt: state.catalogAt, syncedAt: state.syncedAt,
    tally: fullTally(), counters: state.counters,
    unknowns: Object.entries(state.unknowns).map(([code, u]) => ({ code, ...u })),
  };
}

// ---- Utilidades HTTP ----
// Elige la IP de la WiFi/LAN real. Descarta adaptadores virtuales/VPN
// (CloudflareWARP, VMware, Hyper-V, Tailscale…) que el teléfono NO alcanza,
// y prioriza el rango doméstico 192.168 > 10 > 172.16-31.
// Se puede forzar con la variable de entorno COUNT_LAN_IP.
function lanIp() {
  if (process.env.COUNT_LAN_IP) return process.env.COUNT_LAN_IP;
  const ifaces = os.networkInterfaces();
  const bad = /warp|vmware|virtualbox|hyper-?v|vethernet|loopback|tailscale|zerotier|docker|wsl|\btun\b|\btap\b|radmin|virtual/i;
  const cands = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (bad.test(name)) continue;                    // fuera VPN/virtuales
      cands.push({ name, ip: i.address });
    }
  }
  const rank = ip => ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2
    : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  cands.sort((a, b) => rank(b.ip) - rank(a.ip));
  return cands[0]?.ip || '127.0.0.1';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

// Antes se respondía con Access-Control-Allow-Origin: * — o sea, CUALQUIER web
// abierta en un equipo de la red podía leer el catálogo e inyectar conteos.
// Ahora solo se permiten los orígenes nuestros: el panel en la nube, el propio
// servidor por LAN y localhost.
const ALLOWED_ORIGINS = [
  'https://jj-paper.pages.dev',
  'http://localhost:8787', 'https://localhost:8788',
  'http://127.0.0.1:8787', 'https://127.0.0.1:8788',
];
function corsOrigin(req) {
  const o = req?.headers?.origin;
  if (!o) return null;                                   // petición del propio servidor
  if (ALLOWED_ORIGINS.includes(o)) return o;
  // El teléfono entra por la IP de la PC en la red local (192.168.x / 10.x)
  if (/^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(o)) return o;
  return null;
}
// Se marca la respuesta UNA vez al entrar la petición (handle) y de ahí en
// adelante todas las salidas la heredan.
function markCors(req, res) {
  const o = corsOrigin(req);
  if (!o) return;
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

// Sólo se sirve la app web. Se BLOQUEA todo lo sensible: el propio wa-server
// (contiene .env con la service_role key), node_modules, .git, y cualquier
// archivo/carpeta oculto (dotfiles). Además sólo extensiones web conocidas.
const BLOCKED_SEG = new Set(['wa-server', 'node_modules', '.git', 'sessions']);
const SERVE_EXT = new Set(Object.keys(MIME));   // .html/.js/.css/.svg/.png/…

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const segs = rel.split('/').filter(Boolean);
  // Bloquea dotfiles (.env, .git…) y carpetas sensibles en cualquier nivel
  if (segs.some(s => s.startsWith('.') || BLOCKED_SEG.has(s.toLowerCase()))) {
    res.writeHead(403); return res.end('forbidden');
  }

  const full = path.normalize(path.join(REPO_ROOT, rel));
  if (full !== REPO_ROOT && !full.startsWith(REPO_ROOT + path.sep)) {   // sin traversal
    res.writeHead(403); return res.end('forbidden');
  }

  const ext = path.extname(full).toLowerCase();
  if (!SERVE_EXT.has(ext)) { res.writeHead(403); return res.end('tipo no permitido'); }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('no encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(full).pipe(res);
  });
}

// Página de arranque: URL grande + QR para que el teléfono la escanee
function startHtml(url, qr) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conteo offline — JJ Paper</title>
<style>body{margin:0;min-height:100vh;background:#00140f;color:#eaf5ee;font-family:system-ui,Segoe UI,Roboto,sans-serif;
display:flex;align-items:center;justify-content:center;padding:24px}
.c{max-width:460px;text-align:center}h1{font-size:22px}p{color:#9fc7b3;line-height:1.5}
img{width:280px;height:280px;background:#fff;border-radius:16px;padding:10px;margin:14px 0}
a{display:inline-block;background:#99CC33;color:#06231a;font-weight:700;text-decoration:none;
padding:14px 22px;border-radius:12px;font-size:16px;margin-top:8px}
code{background:#0c231b;border:1px solid #2c5647;border-radius:8px;padding:6px 10px;font-size:15px;display:inline-block;margin-top:8px}</style>
</head><body><div class="c">
<h1>📦 Conteo offline · WiFi local</h1>
<p>En el teléfono (misma WiFi), escanea este QR o escribe la dirección en Chrome:</p>
${qr ? `<img src="${qr}" alt="QR">` : ''}
<div><code>${url}</code></div>
<p>La PC también puede contar y ver todo en vivo:</p>
<a href="/admin/lan.html">Abrir el conteo en esta PC →</a>
<p style="font-size:12px;margin-top:22px">Funciona sin internet. Cuando vuelva la señal, todo se sube solo a la nube.</p>
</div></body></html>`;
}

async function getMixnetPedidos(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const format = parsedUrl.searchParams.get('format') || 'json';
    const days = parseInt(parsedUrl.searchParams.get('days') || '3', 10);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const { data: orders, error } = await db.from('jjp_orders')
      .select('id, order_number, client_name, rif, phone, city, items, subtotal_usd, total_usd, exchange_rate, total_bs, payment_method, payment_ref, notes, seller_id, status, created_at')
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false });
      
    if (error) {
      log.error({ err: error.message }, 'mixnet: error consultando pedidos');
      return sendJSON(res, 500, { ok: false, error: error.message });
    }
    
    if (format === 'csv') {
      let csv = 'Pedido,Fecha,Cliente,RIF,Telefono,Ciudad,MetodoPago,Referencia,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,Tasa,TotalUSD,TotalBs\n';
      for (const o of orders || []) {
        const items = Array.isArray(o.items) ? o.items : JSON.parse(o.items || '[]');
        for (const i of items) {
          const row = [
            o.order_number || '',
            o.created_at || '',
            `"${(o.client_name || '').replace(/"/g, '""')}"`,
            `"${(o.rif || '').replace(/"/g, '""')}"`,
            `"${(o.phone || '').replace(/"/g, '""')}"`,
            `"${(o.city || '').replace(/"/g, '""')}"`,
            o.payment_method || '',
            o.payment_ref || '',
            i.sku || '',
            `"${(i.name || '').replace(/"/g, '""')}"`,
            i.qty || 0,
            i.price_usd || 0,
            i.subtotal_usd || 0,
            o.exchange_rate || 0,
            o.total_usd || 0,
            o.total_bs || 0
          ].join(',');
          csv += row + '\n';
        }
      }
      res.writeHead(200, { 
        'Content-Type': 'text/csv; charset=utf-8', 
        'Content-Disposition': 'attachment; filename=pedidos_mixnet.csv' 
      });
      return res.end(csv);
    }
    
    return sendJSON(res, 200, { ok: true, count: orders?.length || 0, orders });
  } catch (e) {
    log.error({ err: e.message }, 'mixnet: excepcion en getMixnetPedidos');
    return sendJSON(res, 500, { ok: false, error: e.message });
  }
}

// ---- Rutas ----
async function handle(req, res) {
  const { url, method } = req;
  markCors(req, res);
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const pathOnly = url.split('?')[0];
  if (pathOnly === '/') { res.writeHead(302, { Location: '/lan/start' }); return res.end(); }
  if (pathOnly === '/lan/start') {
    const u = `https://${lanIp()}:${HTTPS_PORT}/admin/lan.html`;
    let qr = '';
    try { qr = await QRCode.toDataURL(u, { width: 320, margin: 1 }); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(startHtml(u, qr));
  }

  if (url.startsWith('/lan/')) {
    const route = url.split('?')[0];

    if (route === '/lan/mixnet/pedidos') {
      return getMixnetPedidos(req, res);
    }

    if (route === '/lan/health')
      return sendJSON(res, 200, { ok: true, online, ip: lanIp(), port: COUNT_LAN_PORT, https_port: HTTPS_PORT,
        session: state.session, pending: state.pending.length, catalog: state.catalog.length,
        catalogAt: state.catalogAt });

    if (route === '/lan/state')  return sendJSON(res, 200, publicState());

    if (route === '/lan/catalog')
      return sendJSON(res, 200, { at: state.catalogAt, items: state.catalog });

    if (route === '/lan/feed') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (method === 'POST' && route === '/lan/scan') {
      const b = await readBody(req);
      return sendJSON(res, 200, applyScan(b.code, b.device));
    }
    if (method === 'POST' && route === '/lan/pick') {
      const b = await readBody(req);
      return sendJSON(res, 200, bump(b.variant_id, parseInt(b.delta, 10) || 1, b.device));
    }
    if (method === 'POST' && route === '/lan/set') {
      const b = await readBody(req);
      return sendJSON(res, 200, setExact(b.variant_id, b.total, b.device));
    }
    if (method === 'POST' && route === '/lan/unknown-resolve') {
      const b = await readBody(req);
      resolveUnknown(b.code);
      return sendJSON(res, 200, { ok: true });
    }
    if (method === 'POST' && route === '/lan/sync') { await syncNow(); return sendJSON(res, 200, publicState()); }

    return sendJSON(res, 404, { ok: false, error: 'ruta LAN desconocida' });
  }

  // Todo lo demás: servir la app (mismo origen que la API → sin mixed-content)
  return serveStatic(req, res, url);
}

async function exportMixnetFile() {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 3); // 3 días
    
    const { data: orders, error } = await db.from('jjp_orders')
      .select('order_number, client_name, rif, phone, city, items, subtotal_usd, total_usd, exchange_rate, total_bs, payment_method, payment_ref, created_at')
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false });
      
    if (error) {
      log.error({ err: error.message }, 'mixnet: falló consulta para archivo local');
      return;
    }
    
    let csv = 'Pedido,Fecha,Cliente,RIF,Telefono,Ciudad,MetodoPago,Referencia,SKU,Producto,Cantidad,PrecioUSD,SubtotalUSD,Tasa,TotalUSD,TotalBs\n';
    for (const o of orders || []) {
      const items = Array.isArray(o.items) ? o.items : JSON.parse(o.items || '[]');
      for (const i of items) {
        const row = [
          o.order_number || '',
          o.created_at || '',
          `"${(o.client_name || '').replace(/"/g, '""')}"`,
          `"${(o.rif || '').replace(/"/g, '""')}"`,
          `"${(o.phone || '').replace(/"/g, '""')}"`,
          `"${(o.city || '').replace(/"/g, '""')}"`,
          o.payment_method || '',
          o.payment_ref || '',
          i.sku || '',
          `"${(i.name || '').replace(/"/g, '""')}"`,
          i.qty || 0,
          i.price_usd || 0,
          i.subtotal_usd || 0,
          o.exchange_rate || 0,
          o.total_usd || 0,
          o.total_bs || 0
        ].join(',');
        csv += row + '\n';
      }
    }
    
    const filePath = path.join(REPO_ROOT, 'wa-server', 'pedidos_mixnet_local.csv');
    fs.writeFileSync(filePath, csv, 'utf8');
  } catch (e) {
    log.error({ err: e.message }, 'mixnet: fallo escribiendo archivo local');
  }
}

// ---- Arranque ----
export async function startCountLan() {
  loadBuffer();
  await checkOnline().catch(() => {});
  await detectOwner().catch(() => {});
  await refreshCatalog().catch(() => {});
  
  // Escribir el archivo mixnet inicialmente y luego cada 60s
  exportMixnetFile().catch(() => {});
  setInterval(() => exportMixnetFile().catch(() => {}), 60_000);

  const onReq = (req, res) => { handle(req, res).catch(e => {
    try { sendJSON(res, 500, { ok: false, error: e?.message || 'error' }); } catch (_) {}
  }); };

  // HTTP: lo usa la PC (feed en vivo, salud). HTTPS: lo usa el teléfono (cámara).
  const server = http.createServer(onReq);
  server.listen(COUNT_LAN_PORT, '0.0.0.0', () => {
    log.info(`count-lan: HTTP en http://${lanIp()}:${COUNT_LAN_PORT}  (PC)`);
  });
  server.on('error', e => log.error({ err: e?.message }, 'count-lan: no se pudo abrir el puerto HTTP'));

  try {
    const tls = https.createServer(await lanCert(), onReq);
    tls.listen(HTTPS_PORT, '0.0.0.0', () => {
      log.info(`count-lan: HTTPS en https://${lanIp()}:${HTTPS_PORT}  (teléfono → /admin/escaner.html)`);
    });
    tls.on('error', e => log.error({ err: e?.message }, 'count-lan: no se pudo abrir el puerto HTTPS'));
  } catch (e) {
    log.error({ err: e?.message }, 'count-lan: HTTPS deshabilitado (fallo generando cert)');
  }

  setInterval(() => checkOnline().catch(() => {}), COUNT_ONLINE_MS);
  setInterval(() => syncNow().catch(() => {}), COUNT_SYNC_MS);
  setInterval(() => { if (online) refreshCatalog().catch(() => {}); }, COUNT_CATALOG_MS);
  // keep-alive SSE (evita que proxies/red corten el stream)
  setInterval(() => broadcast('ping', { t: Date.now() }), 25_000);
}
