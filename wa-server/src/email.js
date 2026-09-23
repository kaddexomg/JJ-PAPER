import nodemailer from 'nodemailer';
import { db, dbCore } from './supabase.js';
import { log } from './logger.js';
import {
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  GMAIL_USER, GMAIL_APP_PASS, GMAIL_FROM, EMAIL_SWEEP_MS, MAX_RETRIES
} from './config.js';

// Envío de correos del CRM por Gmail SMTP, POR USUARIO.
// Cada vendedor configura su Gmail + contraseña de aplicación desde el panel
// (tabla jjp_email_accounts). Aquí construimos un transporter por perfil y
// enviamos cada correo desde la cuenta de su owner_id. Si un usuario no tiene
// cuenta configurada, se usa la del .env como respaldo (si existe).
// Espejo del outbox de WhatsApp: insert 'pending' → despacho → sent/failed.

let processing = false;
const transporters = new Map();   // profileId -> { sig, tx, from }

// Transporte según el método de la cuenta
function buildTxFromAcct(acct) {
  if (acct.source === 'oauth') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2', user: acct.email,
        clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET,
        refreshToken: acct.refresh
      }
    });
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: acct.email, pass: acct.pass }
  });
}
function acctSig(acct) {
  return acct.source === 'oauth' ? `oauth:${acct.email}:${acct.refresh}` : `smtp:${acct.email}:${acct.pass}`;
}

// ---- Envío por la API de Gmail (para cuentas vinculadas con OAuth 'gmail.send') ----
// SMTP+XOAUTH2 exigiría el scope amplio https://mail.google.com/; la API de Gmail
// funciona con el scope mínimo gmail.send. Renovamos el access token con el refresh.
const tokenCache = new Map(); // refresh -> { token, expiresAt }

async function gmailAccessToken(refresh) {
  const cached = tokenCache.get(refresh);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.error || `token HTTP ${res.status}`);
  // Guardar en caché (expira 5 min antes del tiempo real, por defecto 3600s)
  const ttl = (j.expires_in ? Math.max(300, j.expires_in - 300) : 3000) * 1000;
  tokenCache.set(refresh, { token: j.access_token, expiresAt: Date.now() + ttl });
  return j.access_token;
}

function encHeader(s) {   // asunto/nombre con acentos → RFC 2047
  return /[^\x00-\x7F]/.test(s || '') ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : (s || '');
}
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Descarga los adjuntos → base64, con caché en memoria (TTL 2 horas).
// Un mismo archivo se descarga UNA sola vez (a RAM) y se reutiliza en todos
// los envíos de la campaña, en vez de re-descargarlo por cada destinatario.
const attachCache = new Map();
const ATTACH_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Acepta dos formatos de ítem:
//   - { path, name, mime }  → archivo en Storage/URL (se baja UNA vez y se cachea en RAM)
//   - { base64, name|filename, mime|contentType }  → contenido inline (p.ej. PDF generado
//     en el navegador o archivo adjuntado desde la PC). El base64 puede venir como data URI
//     (data:application/pdf;base64,xxxx) o en base64 puro.
async function loadAttachments(list) {
  const out = [];
  const now = Date.now();

  // Limpieza periódica de attachCache para proteger memoria RAM
  if (attachCache.size > 50) {
    for (const [k, v] of attachCache.entries()) {
      if (now - (v.cachedAt || 0) > ATTACH_CACHE_TTL_MS) attachCache.delete(k);
    }
  }

  for (const a of list || []) {
    if (!a) continue;
    let name = String(a.name || a.filename || 'archivo').replace(/[\r\n"]/g, '');
    let mime = (a.mime || a.contentType || 'application/octet-stream').split(';')[0];

    if (a.base64) {
      let b64 = String(a.base64).trim();
      const sep = b64.indexOf(';base64,');
      if (sep !== -1) b64 = b64.slice(sep + 8);
      if (!b64) continue;
      out.push({ name, mime, b64 });
      continue;
    }

    if (!a.path) continue;
    const key = String(a.path);
    const cached = attachCache.get(key);
    if (!cached || (now - (cached.cachedAt || 0) > ATTACH_CACHE_TTL_MS)) {
      const buf = await fetchAttachmentBytes(key);
      if (buf) attachCache.set(key, { b64: buf.toString('base64'), cachedAt: now });
    }
    const item = attachCache.get(key);
    if (!item?.b64) continue;
    out.push({ name, mime, b64: item.b64 });
  }
  return out;
}

// Devuelve el Buffer del archivo (o null si no se pudo). Distingue URL vs bucket.
async function fetchAttachmentBytes(path) {
  try {
    let cleanPath = String(path || '');
    if (cleanPath.includes('czzvsqnmxtjzqzioknnn.supabase.co')) {
      cleanPath = cleanPath.replace('https://czzvsqnmxtjzqzioknnn.supabase.co', 'https://nmcamjxhyysmmvgxgabo.supabase.co');
    }
    if (/^https?:\/\//i.test(cleanPath)) {
      let r = await fetch(cleanPath, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!r.ok && cleanPath.includes(SUPABASE_URL_CORE)) {
        // Intentar en Proyecto C (Inventario/Storage)
        const fallbackUrl = cleanPath.replace(SUPABASE_URL_CORE, 'https://nmcamjxhyysmmvgxgabo.supabase.co');
        const r2 = await fetch(fallbackUrl, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
        if (r2.ok) return Buffer.from(await r2.arrayBuffer());
      }
      if (!r.ok) { log.warn({ err: `HTTP ${r.status}`, path }, 'adjunto no descargó'); return null; }
      return Buffer.from(await r.arrayBuffer());
    }
    // Probar primero en jjp-email-media (Comm)
    const { data, error } = await db.storage.from('jjp-email-media').download(cleanPath);
    if (!error && data) return Buffer.from(await data.arrayBuffer());

    // Fallback a jjp-wa-media (Comm)
    const { data: d2, error: e2 } = await db.storage.from('jjp-wa-media').download(cleanPath);
    if (!e2 && d2) return Buffer.from(await d2.arrayBuffer());

    // Fallback a jjp-wa-media (Core)
    const { data: d3, error: e3 } = await dbCore.storage.from('jjp-wa-media').download(cleanPath);
    if (!e3 && d3) return Buffer.from(await d3.arrayBuffer());

    log.warn({ err: error?.message || e2?.message || e3?.message, path }, 'adjunto no descargó');
    return null;
  } catch (e) {
    log.warn({ err: e.message, path }, 'adjunto no descargó');
    return null;
  }
}

function formatTextToHtml(text) {
  const escaped = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = escaped.split(/\r?\n\r?\n/).map(p => `<p style="margin:0 0 12px 0;">${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;background:#ffffff;margin:0;padding:16px;">${paragraphs}</body></html>`;
}

function buildRawEmail({ from, to, subject, text, html }, atts = []) {
  const NL = '\r\n';
  const effectiveText = text || '';
  const effectiveHtml = html || formatTextToHtml(effectiveText);
  const textB64 = Buffer.from(effectiveText, 'utf8').toString('base64');
  const htmlB64 = Buffer.from(effectiveHtml, 'utf8').toString('base64');

  const altBoundary = 'jjp_alt_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const altBody = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '', textB64, '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '', htmlB64, '',
    `--${altBoundary}--`
  ].join(NL);

  if (!atts?.length) {
    const s = [
      `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, 'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`, '',
      altBody
    ].join(NL);
    return b64url(Buffer.from(s, 'utf8'));
  }

  const mixBoundary = 'jjp_mix_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let s = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixBoundary}"`, '',
    `--${mixBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`, '',
    altBody, ''
  ].join(NL);
  for (const a of atts) {
    s += [
      `--${mixBoundary}`,
      `Content-Type: ${a.mime}; name="${a.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.name}"`, '',
      a.b64.replace(/(.{76})/g, '$1' + NL), ''
    ].join(NL);
  }
  s += `--${mixBoundary}--`;
  return b64url(Buffer.from(s, 'utf8'));
}

async function gmailApiSend(acct, m) {
  const token = await gmailAccessToken(acct.refresh);
  const atts = await loadAttachments(m.attachments);
  const raw = buildRawEmail({
    from: acct.from, to: m.to_addr, subject: m.subject || '(sin asunto)',
    text: m.body || '', html: m.html || null
  }, atts);
  const body = m.thread_id ? { raw, threadId: m.thread_id } : { raw };
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Gmail API HTTP ${res.status}`);
  return j.id || null;
}

// Envío inmediato reutilizable (lo usa el despachador de campañas).
// Lanza si el owner no tiene correo vinculado. Devuelve { id, from }.
export async function sendEmailNow(ownerId, m) {
  const acct = await accountFor(ownerId);
  if (!acct) throw new Error('Sin correo vinculado');
  let id = null;
  if (acct.source === 'oauth') {
    id = await gmailApiSend(acct, m);
  } else {
    const atts = await loadAttachments(m.attachments);
    const info = await buildTxFromAcct(acct).sendMail({
      from: acct.from, to: m.to_addr, subject: m.subject || '(sin asunto)',
      text: m.body || '', html: m.html || undefined,
      attachments: atts.map(a => ({ filename: a.name, content: Buffer.from(a.b64, 'base64'), contentType: a.mime }))
    });
    id = info.messageId || null;
  }
  return { id, from: acct.from };
}

// Credenciales efectivas para un owner. Orden:
//  1) su cuenta vinculada por Google (OAuth) — si está activa y no reportada como inválida
//  2) su cuenta por SMTP (si vinculó una con contraseña de app)
//  3) respaldo con cualquier otra cuenta verificada activa en la empresa (ej. admin)
//  4) respaldo .env por SMTP
async function accountFor(ownerId) {
  if (ownerId) {
    const { data } = await db.from('jjp_email_accounts')
      .select('email,app_pass,oauth_refresh,from_name,enabled,verified').eq('profile_id', ownerId).maybeSingle();
    if (data?.enabled && data.email && data.verified !== false) {
      const from = data.from_name ? `${data.from_name} <${data.email}>` : data.email;
      if (data.oauth_refresh && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        return { email: data.email, refresh: data.oauth_refresh, from, source: 'oauth' };
      }
      if (data.app_pass) return { email: data.email, pass: data.app_pass, from, source: 'smtp' };
    }
  }

  // Respaldo empresarial: buscar una cuenta verificada activa de otro usuario (ej. admin)
  try {
    const { data: fbList } = await db.from('jjp_email_accounts')
      .select('email,app_pass,oauth_refresh,from_name,enabled,verified')
      .eq('enabled', true)
      .eq('verified', true)
      .limit(2);
    for (const fb of fbList || []) {
      const from = fb.from_name ? `${fb.from_name} <${fb.email}>` : fb.email;
      if (fb.oauth_refresh && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        return { email: fb.email, refresh: fb.oauth_refresh, from, source: 'oauth', isFallback: true };
      }
      if (fb.app_pass) return { email: fb.email, pass: fb.app_pass, from, source: 'smtp', isFallback: true };
    }
  } catch (_) {}

  if (GMAIL_USER && GMAIL_APP_PASS) {
    return { email: GMAIL_USER, pass: GMAIL_APP_PASS, from: GMAIL_FROM || GMAIL_USER, source: 'smtp', isFallback: true };
  }
  return null;
}

// Transporter cacheado por owner; se reconstruye si cambian las credenciales
async function txFor(ownerId) {
  const acct = await accountFor(ownerId);
  if (!acct) return null;
  const sig = acctSig(acct);
  const cached = transporters.get(ownerId);
  if (cached && cached.sig === sig) return cached;
  const entry = { sig, tx: buildTxFromAcct(acct), from: acct.from };
  transporters.set(ownerId, entry);
  return entry;
}

export function startEmail() {
  // Salientes pendientes
  db.channel('wa-server-email')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_emails', filter: 'status=eq.pending' },
      () => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')))
    .subscribe(st => log.info({ st }, 'realtime email'));

  // Cambios de cuenta de usuario → invalidar caché y verificar SMTP en vivo
  db.channel('wa-server-email-accounts')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_email_accounts' },
      p => {
        const id = p.new?.profile_id || p.old?.profile_id;
        transporters.delete(id);
        if (!p.new) return;
        // Prevenir bucle infinito: SOLO verificar si cambiaron credenciales o enabled
        const oldSig = p.old ? `${p.old.email || ''}:${p.old.oauth_refresh || ''}:${p.old.app_pass || ''}:${p.old.enabled}` : '';
        const newSig = `${p.new.email || ''}:${p.new.oauth_refresh || ''}:${p.new.app_pass || ''}:${p.new.enabled}`;
        if (oldSig !== newSig) {
          verifyAccount(p.new).catch(() => {});
        }
      })
    .subscribe();

  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')), EMAIL_SWEEP_MS);
  sweep().catch(() => {});
  verifyAllAccounts().catch(() => {});   // valida las cuentas guardadas con el server apagado

  // Recepción: sondea la bandeja de cada cuenta OAuth cada 2 min
  setInterval(() => pollInbound().catch(e => log.error({ err: e.message }, 'poll entrantes falló')), INBOUND_POLL_MS);
  setTimeout(() => pollInbound().catch(() => {}), 8000);   // primer sondeo tras arrancar
  startAttachWorker();   // descarga on-demand de adjuntos entrantes

  log.info('módulo correo activo (Gmail API por usuario · envío + recepción)');
  return true;
}

const INBOUND_POLL_MS = 120_000;

// ---- Recepción de correos (Gmail API, solo cuentas con permiso de lectura) ----
async function pollInbound() {
  const { data: accts } = await db.from('jjp_email_accounts')
    .select('profile_id,email,oauth_refresh,enabled').eq('enabled', true).not('oauth_refresh', 'is', null);
  for (const a of accts || []) {
    await pollAccountInbound(a).catch(e => log.warn({ err: e.message, email: a.email }, 'poll cuenta falló'));
  }
}

async function pollAccountInbound(acct) {
  let token;
  try { token = await gmailAccessToken(acct.oauth_refresh); }
  catch { return; }   // refresh inválido → lo maneja verifyAccount

  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=' +
    encodeURIComponent('in:inbox newer_than:2d'),
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!listRes.ok) {
    if (listRes.status === 403) log.warn({ email: acct.email }, 'sin permiso de lectura (re-vincular con Google)');
    return;
  }
  const ids = ((await listRes.json()).messages || []).map(m => m.id);
  if (!ids.length) return;

  const { data: have } = await db.from('jjp_emails')
    .select('gmail_id').eq('owner_id', acct.profile_id).in('gmail_id', ids);
  const known = new Set((have || []).map(r => r.gmail_id));
  const missing = ids.filter(id => !known.has(id));

  for (const id of missing) {
    try { await ingestMessage(acct, token, id); }
    catch (e) { log.warn({ err: e.message, id }, 'ingesta de entrante falló'); }
  }
}

function headerVal(headers, name) {
  return (headers || []).find(h => h.name?.toLowerCase() === name)?.value || '';
}
function parseFrom(v) {
  const m = /<([^>]+)>/.exec(v);
  const email = (m ? m[1] : v).trim().toLowerCase();
  const name = v.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return { email, name: name || email };
}
function decodeB64Url(s) {
  return Buffer.from((s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function extractBody(payload) {
  if (!payload) return '';
  const walk = (p) => {
    if (p.mimeType === 'text/plain' && p.body?.data) return decodeB64Url(p.body.data);
    if (p.parts) { for (const c of p.parts) { const r = walk(c); if (r) return r; } }
    return '';
  };
  let txt = walk(payload);
  if (!txt) {
    const html = (function walkH(p) {
      if (p.mimeType === 'text/html' && p.body?.data) return decodeB64Url(p.body.data);
      if (p.parts) { for (const c of p.parts) { const r = walkH(c); if (r) return r; } }
      return '';
    })(payload);
    txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return txt.slice(0, 20000);
}

// HTML del correo (para verlo con formato en el panel)
function extractHtml(payload) {
  if (!payload) return '';
  const walk = (p) => {
    if (p.mimeType === 'text/html' && p.body?.data) return decodeB64Url(p.body.data);
    if (p.parts) { for (const c of p.parts) { const r = walk(c); if (r) return r; } }
    return '';
  };
  return (walk(payload) || '').slice(0, 500000);
}
// Metadatos de adjuntos (sin descargar): [{att_id,name,mime,size}]
function extractAttachments(payload) {
  const out = [];
  const walk = (p) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      out.push({ att_id: p.body.attachmentId, name: p.filename, mime: (p.mimeType || 'application/octet-stream').split(';')[0], size: p.body.size || null });
    }
    if (p.parts) p.parts.forEach(walk);
  };
  walk(payload);
  return out;
}

async function ingestMessage(acct, token, id) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return;
  const msg = await res.json();
  const headers = msg.payload?.headers || [];
  const from = parseFrom(headerVal(headers, 'from'));
  const subject = headerVal(headers, 'subject');
  const ts = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
  const atts = extractAttachments(msg.payload);
  const bodyText = extractBody(msg.payload);

  const { data: cust } = await dbCore.from('jjp_customers')
    .select('id').ilike('email', from.email).limit(1).maybeSingle();

  const fromLower = from.email.toLowerCase();
  const subjLower = (subject || '').toLowerCase();
  const isBounce = fromLower.includes('mailer-daemon') || subjLower.includes('delivery status notification') || subjLower.includes('undelivered mail');

  if (isBounce) {
    const bouncedEmailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (bouncedEmailMatch) {
      const bouncedEmail = bouncedEmailMatch[0].toLowerCase();
      try {
        await dbCore.from('jjp_email_suppression_list').upsert({
          email: bouncedEmail,
          reason: bodyText.slice(0, 300),
          bounce_type: 'hard',
          source: 'bounce_inbox',
          created_at: new Date().toISOString()
        }, { onConflict: 'email' });
        
        await dbCore.from('jjp_customers').update({
          email_status: 'bounced',
          bounce_reason: 'Mailer Daemon / DSN',
          bounced_at: new Date().toISOString()
        }).ilike('email', bouncedEmail);
        
        log.info({ bouncedEmail }, 'Rebote procesado y añadido a suppression list');
      } catch (err) {
        log.error({ err: err.message }, 'Error al procesar rebote en ingestMessage');
      }
    }
  }

  const { error } = await db.from('jjp_emails').insert({
    owner_id: acct.profile_id, direction: 'in', status: 'received',
    from_addr: from.name ? `${from.name} <${from.email}>` : from.email,
    to_addr: acct.email, subject: subject || '(sin asunto)',
    body: bodyText, html: extractHtml(msg.payload) || null,
    snippet: msg.snippet || null,
    gmail_id: id, thread_id: msg.threadId || null,
    attachments: atts, attach_state: atts.length ? 'pending' : 'none',
    customer_id: cust?.id || null, is_read: false, created_at: ts
  });
  if (error && error.code !== '23505') log.warn({ err: error.message }, 'insert entrante falló');
}

// ---- Descarga on-demand de adjuntos entrantes (cuando el panel abre el correo) ----
function startAttachWorker() {
  db.channel('email-attach')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_emails', filter: 'attach_state=eq.requested' },
      p => fetchAttachmentsFor(p.new).catch(e => log.warn({ err: e.message }, 'fetch adjuntos falló')))
    .subscribe();
  setInterval(async () => {
    const { data } = await db.from('jjp_emails').select('*').eq('attach_state', 'requested').limit(5);
    for (const r of data || []) await fetchAttachmentsFor(r).catch(() => {});
  }, 15000);
}

async function fetchAttachmentsFor(row) {
  const { data: acct } = await db.from('jjp_email_accounts')
    .select('oauth_refresh').eq('profile_id', row.owner_id).maybeSingle();
  if (!acct?.oauth_refresh || !row.gmail_id) { await db.from('jjp_emails').update({ attach_state: 'error' }).eq('id', row.id); return; }
  let token;
  try { token = await gmailAccessToken(acct.oauth_refresh); }
  catch { await db.from('jjp_emails').update({ attach_state: 'error' }).eq('id', row.id); return; }

  const out = [];
  for (const a of row.attachments || []) {
    if (a.path || !a.att_id) { out.push(a); continue; }
    try {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${row.gmail_id}/attachments/${a.att_id}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      const j = await r.json();
      if (!r.ok || !j.data) throw new Error(j.error?.message || 'sin datos');
      const buf = Buffer.from(j.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const path = `${row.owner_id}/${row.id}/${Date.now()}-${(a.name || 'archivo').replace(/[^\w.\-]/g, '_')}`;
      const { error } = await db.storage.from('jjp-email-media').upload(path, buf, { contentType: a.mime || 'application/octet-stream' });
      if (error) throw new Error(error.message);
      out.push({ ...a, path, size: buf.length });
    } catch (e) { out.push({ ...a, error: e.message }); }
  }
  await db.from('jjp_emails').update({ attachments: out, attach_state: 'ready' }).eq('id', row.id);
  log.info({ id: row.id, n: out.length }, 'adjuntos entrantes descargados');
}

// Traduce errores crípticos a algo accionable
function friendlyGmailError(msg) {
  if (/invalid_grant|invalid_request|token has been expired|revoked/i.test(msg || ''))
    return 'Google revocó el permiso. Vuelve a "Vincular con Google" en Mi correo.';
  if (/invalid login|5\.7\.8|username and password|badcredentials/i.test(msg || ''))
    return 'Gmail rechazó las credenciales del método SMTP.';
  return msg;
}

// Al arrancar, verifica todas las cuentas ya configuradas (así el chip 🟢/🔴 se
// actualiza aunque las hayan guardado con el servidor apagado).
async function verifyAllAccounts() {
  const { data } = await db.from('jjp_email_accounts').select('*').eq('enabled', true);
  for (const row of data || []) await verifyAccount(row).catch(() => {});
}

// Valida una cuenta (OAuth o SMTP) y escribe verified/last_error
const _verifyingAccounts = new Set();
async function verifyAccount(row) {
  if (!row?.enabled || !row?.email || !row?.profile_id) return;
  if (_verifyingAccounts.has(row.profile_id)) return;
  _verifyingAccounts.add(row.profile_id);

  let acct = null;
  if (row.oauth_refresh && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
    acct = { email: row.email, refresh: row.oauth_refresh, source: 'oauth' };
  else if (row.app_pass)
    acct = { email: row.email, pass: row.app_pass, source: 'smtp' };
  else {
    _verifyingAccounts.delete(row.profile_id);
    return;
  }

  try {
    // OAuth: basta con que el refresh token consiga un access token (sin SMTP)
    if (acct.source === 'oauth') await gmailAccessToken(acct.refresh);
    else await buildTxFromAcct(acct).verify();
    
    // Solo actualizar si el estado en la fila era diferente
    if (row.verified !== true || row.last_error !== null) {
      await db.from('jjp_email_accounts')
        .update({ verified: true, last_error: null }).eq('profile_id', row.profile_id);
    }
    log.info({ email: row.email, via: acct.source }, 'cuenta de correo verificada ✅');
  } catch (e) {
    const errText = friendlyGmailError(e.message);
    if (row.verified !== false || row.last_error !== errText) {
      await db.from('jjp_email_accounts')
        .update({ verified: false, last_error: errText }).eq('profile_id', row.profile_id);
    }
    log.warn({ email: row.email, err: e.message }, 'cuenta de correo NO verifica');
  } finally {
    _verifyingAccounts.delete(row.profile_id);
  }
}

async function sweep() {
  if (processing) return;
  processing = true;
  try {
    const { data: rows, error } = await db.from('jjp_emails')
      .select('*').eq('status', 'pending').eq('direction', 'out')
      .order('created_at', { ascending: true }).limit(10);
    if (error) { log.error({ error: error.message }, 'select emails pendientes falló'); return; }
    for (const row of rows || []) await dispatch(row);
  } finally {
    processing = false;
  }
}

async function dispatch(row) {
  const acct = await accountFor(row.owner_id);
  if (!acct) {
    // Sin cuenta configurada: no reintentar en bucle, marcar claro
    await db.from('jjp_emails').update({
      status: 'failed', error: 'Sin correo vinculado. Abre "Mi correo" y toca "Vincular con Google".'
    }).eq('id', row.id).eq('status', 'pending');
    return;
  }

  const { data: locked } = await db.from('jjp_emails')
    .update({ status: 'sending' }).eq('id', row.id).eq('status', 'pending').select('id');
  if (!locked?.length) return;

  try {
    let messageId = null;
    let usedAcct = acct;
    if (usedAcct.source === 'oauth') {
      try {
        messageId = await gmailApiSend(usedAcct, row);
      } catch (oauthErr) {
        if (/invalid_grant|token has been expired|revoked/i.test(oauthErr.message || '')) {
          log.warn({ email: usedAcct.email }, 'Token OAuth revocado/expirado, marcando cuenta y probando cuenta verificada alternativa');
          await db.from('jjp_email_accounts')
            .update({ verified: false, last_error: 'Google revocó el permiso. Vuelve a vincular con Google.' })
            .eq('email', usedAcct.email);
          // Buscar cuenta verificada alternativa
          const { data: fbList } = await db.from('jjp_email_accounts')
            .select('email,app_pass,oauth_refresh,from_name,enabled,verified')
            .eq('enabled', true)
            .eq('verified', true)
            .neq('email', usedAcct.email)
            .limit(1);
          if (fbList?.[0]) {
            const fb = fbList[0];
            const from = fb.from_name ? `${fb.from_name} <${fb.email}>` : fb.email;
            usedAcct = fb.oauth_refresh ? { email: fb.email, refresh: fb.oauth_refresh, from, source: 'oauth' } : { email: fb.email, pass: fb.app_pass, from, source: 'smtp' };
            if (usedAcct.source === 'oauth') {
              messageId = await gmailApiSend(usedAcct, row);
            } else {
              const atts = await loadAttachments(row.attachments);
              const info = await buildTxFromAcct(usedAcct).sendMail({
                from: usedAcct.from, to: row.to_addr,
                subject: row.subject || '(sin asunto)',
                text: row.body || '', html: row.html || undefined,
                attachments: atts.map(a => ({ filename: a.name, content: Buffer.from(a.b64, 'base64'), contentType: a.mime }))
              });
              messageId = info.messageId || null;
            }
          } else {
            throw oauthErr;
          }
        } else {
          throw oauthErr;
        }
      }
    } else {
      const atts = await loadAttachments(row.attachments);
      const info = await buildTxFromAcct(usedAcct).sendMail({  // SMTP (app pass / .env)
        from: usedAcct.from, to: row.to_addr,
        subject: row.subject || '(sin asunto)',
        text: row.body || '', html: row.html || undefined,
        attachments: atts.map(a => ({ filename: a.name, content: Buffer.from(a.b64, 'base64'), contentType: a.mime }))
      });
      messageId = info.messageId || null;
    }
    await db.from('jjp_emails').update({
      status: 'sent', message_id: messageId, error: null,
      from_addr: usedAcct.from, sent_at: new Date().toISOString()
    }).eq('id', row.id);
    log.info({ id: row.id, to: row.to_addr, via: usedAcct.source }, 'correo enviado');
  } catch (e) {
    const retries = (row.retry_count || 0) + 1;
    const failed = retries >= MAX_RETRIES;
    await db.from('jjp_emails').update({
      status: failed ? 'failed' : 'pending', retry_count: retries, error: e.message
    }).eq('id', row.id);
    log.warn({ id: row.id, retries, failed, err: e.message }, 'envío de correo falló');
  }
}
