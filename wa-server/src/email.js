import nodemailer from 'nodemailer';
import { db } from './supabase.js';
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
async function gmailAccessToken(refresh) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token'
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.error || `token HTTP ${res.status}`);
  return j.access_token;
}

function encHeader(s) {   // asunto/nombre con acentos → RFC 2047
  return /[^\x00-\x7F]/.test(s || '') ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : (s || '');
}
function buildRawEmail({ from, to, subject, text, html }) {
  const isHtml = !!html;
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: text/${isHtml ? 'html' : 'plain'}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(isHtml ? html : (text || ''), 'utf8').toString('base64')
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function gmailApiSend(acct, m) {
  const token = await gmailAccessToken(acct.refresh);
  const raw = buildRawEmail({
    from: acct.from, to: m.to_addr, subject: m.subject || '(sin asunto)',
    text: m.body || '', html: m.html || null
  });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Gmail API HTTP ${res.status}`);
  return j.id || null;
}

// Credenciales efectivas para un owner. Orden:
//  1) su cuenta vinculada por Google (OAuth) — método principal, sin claves
//  2) su cuenta por SMTP (si vinculó una con contraseña de app)
//  3) respaldo .env por SMTP
async function accountFor(ownerId) {
  if (ownerId) {
    const { data } = await db.from('jjp_email_accounts')
      .select('email,app_pass,oauth_refresh,from_name,enabled').eq('profile_id', ownerId).maybeSingle();
    if (data?.enabled && data.email) {
      const from = data.from_name ? `${data.from_name} <${data.email}>` : data.email;
      if (data.oauth_refresh && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
        return { email: data.email, refresh: data.oauth_refresh, from, source: 'oauth' };
      }
      if (data.app_pass) return { email: data.email, pass: data.app_pass, from, source: 'smtp' };
    }
  }
  if (GMAIL_USER && GMAIL_APP_PASS) {
    return { email: GMAIL_USER, pass: GMAIL_APP_PASS, from: GMAIL_FROM || GMAIL_USER, source: 'smtp' };
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
      p => { const id = p.new?.profile_id || p.old?.profile_id; transporters.delete(id); if (p.new) verifyAccount(p.new).catch(() => {}); })
    .subscribe();

  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')), EMAIL_SWEEP_MS);
  sweep().catch(() => {});
  verifyAllAccounts().catch(() => {});   // valida las cuentas guardadas con el server apagado
  log.info('módulo correo activo (Gmail por OAuth / SMTP por usuario)');
  return true;
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
async function verifyAccount(row) {
  if (!row.enabled || !row.email) return;
  let acct = null;
  if (row.oauth_refresh && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
    acct = { email: row.email, refresh: row.oauth_refresh, source: 'oauth' };
  else if (row.app_pass)
    acct = { email: row.email, pass: row.app_pass, source: 'smtp' };
  else return;
  try {
    // OAuth: basta con que el refresh token consiga un access token (sin SMTP)
    if (acct.source === 'oauth') await gmailAccessToken(acct.refresh);
    else await buildTxFromAcct(acct).verify();
    await db.from('jjp_email_accounts')
      .update({ verified: true, last_error: null }).eq('profile_id', row.profile_id);
    log.info({ email: row.email, via: acct.source }, 'cuenta de correo verificada ✅');
  } catch (e) {
    await db.from('jjp_email_accounts')
      .update({ verified: false, last_error: friendlyGmailError(e.message) }).eq('profile_id', row.profile_id);
    log.warn({ email: row.email, err: e.message }, 'cuenta de correo NO verifica');
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
    if (acct.source === 'oauth') {
      messageId = await gmailApiSend(acct, row);           // API de Gmail (scope gmail.send)
    } else {
      const info = await buildTxFromAcct(acct).sendMail({  // SMTP (app pass / .env)
        from: acct.from, to: row.to_addr,
        subject: row.subject || '(sin asunto)',
        text: row.body || '', html: row.html || undefined
      });
      messageId = info.messageId || null;
    }
    await db.from('jjp_emails').update({
      status: 'sent', message_id: messageId, error: null,
      from_addr: acct.from, sent_at: new Date().toISOString()
    }).eq('id', row.id);
    log.info({ id: row.id, to: row.to_addr, via: acct.source }, 'correo enviado');
  } catch (e) {
    const retries = (row.retry_count || 0) + 1;
    const failed = retries >= MAX_RETRIES;
    await db.from('jjp_emails').update({
      status: failed ? 'failed' : 'pending', retry_count: retries, error: e.message
    }).eq('id', row.id);
    log.warn({ id: row.id, retries, failed, err: e.message }, 'envío de correo falló');
  }
}
