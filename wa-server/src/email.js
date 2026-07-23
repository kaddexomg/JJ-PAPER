import nodemailer from 'nodemailer';
import { db } from './supabase.js';
import { log } from './logger.js';
import { GMAIL_USER, GMAIL_APP_PASS, GMAIL_FROM, EMAIL_SWEEP_MS, MAX_RETRIES } from './config.js';

// Envío de correos del CRM por Gmail SMTP, POR USUARIO.
// Cada vendedor configura su Gmail + contraseña de aplicación desde el panel
// (tabla jjp_email_accounts). Aquí construimos un transporter por perfil y
// enviamos cada correo desde la cuenta de su owner_id. Si un usuario no tiene
// cuenta configurada, se usa la del .env como respaldo (si existe).
// Espejo del outbox de WhatsApp: insert 'pending' → despacho → sent/failed.

let processing = false;
const transporters = new Map();   // profileId -> { sig, tx, from }

function buildTx(email, pass) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: email, pass }
  });
}

// Credenciales efectivas para un owner. Orden:
//  1) su propia cuenta (si el vendedor optó por vincular la suya)
//  2) la cuenta de EMPRESA (lo normal) — envía con el nombre del vendedor
//  3) respaldo .env
async function accountFor(ownerId) {
  if (ownerId) {
    const { data } = await db.from('jjp_email_accounts')
      .select('email,app_pass,from_name,enabled').eq('profile_id', ownerId).maybeSingle();
    if (data?.enabled && data.email && data.app_pass) {
      return {
        email: data.email, pass: data.app_pass,
        from: data.from_name ? `${data.from_name} <${data.email}>` : data.email,
        source: 'user'
      };
    }
  }
  const { data: co } = await db.from('jjp_email_company')
    .select('email,app_pass,from_name,enabled').eq('id', 1).maybeSingle();
  if (co?.enabled && co.email && co.app_pass) {
    // Remitente = "Nombre del vendedor <correo_empresa>" (así el cliente ve quién escribe)
    let sellerName = co.from_name || '';
    if (ownerId) {
      const { data: prof } = await db.from('jjp_profiles').select('name').eq('id', ownerId).maybeSingle();
      if (prof?.name) sellerName = co.from_name ? `${prof.name} · ${co.from_name}` : prof.name;
    }
    return {
      email: co.email, pass: co.app_pass,
      from: sellerName ? `${sellerName} <${co.email}>` : co.email,
      source: 'company'
    };
  }
  if (GMAIL_USER && GMAIL_APP_PASS) {
    return { email: GMAIL_USER, pass: GMAIL_APP_PASS, from: GMAIL_FROM || GMAIL_USER, source: 'env' };
  }
  return null;
}

// Transporter cacheado por owner; se reconstruye si cambian las credenciales
async function txFor(ownerId) {
  const acct = await accountFor(ownerId);
  if (!acct) return null;
  const sig = acct.email + ':' + acct.pass;
  const cached = transporters.get(ownerId);
  if (cached && cached.sig === sig) return cached;
  const entry = { sig, tx: buildTx(acct.email, acct.pass), from: acct.from };
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

  // Cambios en la cuenta de EMPRESA → invalidar TODO el caché y re-verificar
  db.channel('wa-server-email-company')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'jjp_email_company' },
      () => { transporters.clear(); verifyCompany().catch(() => {}); })
    .subscribe();

  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')), EMAIL_SWEEP_MS);
  sweep().catch(() => {});
  verifyAllAccounts().catch(() => {});   // valida las cuentas guardadas con el server apagado
  verifyCompany().catch(() => {});       // valida la cuenta de empresa + bandera "listo"
  log.info('módulo correo activo (Gmail SMTP: empresa + por usuario)');
  return true;
}

// Traduce el error críptico de Gmail a algo accionable
function friendlyGmailError(msg) {
  return /invalid login|5\.7\.8|username and password|badcredentials|application-specific/i.test(msg || '')
    ? 'Gmail rechazó las credenciales. Usa una CONTRASEÑA DE APLICACIÓN (no la clave normal) y ten activada la Verificación en 2 pasos.'
    : msg;
}

// Verifica la cuenta de empresa y publica la bandera jjp_settings.email_company_ready
async function verifyCompany() {
  const { data: co } = await db.from('jjp_email_company').select('*').eq('id', 1).maybeSingle();
  let ready = false;
  if (co?.enabled && co.email && co.app_pass) {
    try {
      await buildTx(co.email, co.app_pass).verify();
      ready = true;
      await db.from('jjp_email_company').update({ verified: true, last_error: null }).eq('id', 1);
      log.info({ email: co.email }, 'correo de empresa verificado ✅');
    } catch (e) {
      await db.from('jjp_email_company').update({ verified: false, last_error: friendlyGmailError(e.message) }).eq('id', 1);
      log.warn({ err: e.message }, 'correo de empresa NO verifica');
    }
  }
  await db.from('jjp_settings').update({ value: ready ? 'true' : 'false' }).eq('key', 'email_company_ready');
}

// Al arrancar, verifica todas las cuentas ya configuradas (así el chip 🟢/🔴 se
// actualiza aunque las hayan guardado con el servidor apagado).
async function verifyAllAccounts() {
  const { data } = await db.from('jjp_email_accounts').select('*').eq('enabled', true);
  for (const row of data || []) await verifyAccount(row).catch(() => {});
}

// Valida las credenciales de una cuenta y escribe verified/last_error
async function verifyAccount(row) {
  if (!row.enabled || !row.email || !row.app_pass) return;
  try {
    await buildTx(row.email, row.app_pass).verify();
    await db.from('jjp_email_accounts')
      .update({ verified: true, last_error: null }).eq('profile_id', row.profile_id);
    log.info({ email: row.email }, 'cuenta de correo verificada ✅');
  } catch (e) {
    // Traducir el error críptico de Gmail a algo accionable para el usuario
    const friendly = /invalid login|5\.7\.8|username and password|badcredentials|application-specific/i.test(e.message || '')
      ? 'Gmail rechazó las credenciales. Usa una CONTRASEÑA DE APLICACIÓN (no tu clave normal de Gmail) y ten activada la Verificación en 2 pasos.'
      : e.message;
    await db.from('jjp_email_accounts')
      .update({ verified: false, last_error: friendly }).eq('profile_id', row.profile_id);
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
  const entry = await txFor(row.owner_id);
  if (!entry) {
    // Sin cuenta configurada: no reintentar en bucle, marcar claro
    await db.from('jjp_emails').update({
      status: 'failed', error: 'Sin correo disponible. Un admin debe configurar el "Correo de la empresa", o vincula el tuyo en "Mi correo".'
    }).eq('id', row.id).eq('status', 'pending');
    return;
  }

  const { data: locked } = await db.from('jjp_emails')
    .update({ status: 'sending' }).eq('id', row.id).eq('status', 'pending').select('id');
  if (!locked?.length) return;

  try {
    const info = await entry.tx.sendMail({
      from: entry.from, to: row.to_addr,
      subject: row.subject || '(sin asunto)',
      text: row.body || '', html: row.html || undefined
    });
    await db.from('jjp_emails').update({
      status: 'sent', message_id: info.messageId || null, error: null,
      from_addr: entry.from, sent_at: new Date().toISOString()
    }).eq('id', row.id);
    log.info({ id: row.id, to: row.to_addr }, 'correo enviado');
  } catch (e) {
    const retries = (row.retry_count || 0) + 1;
    const failed = retries >= MAX_RETRIES;
    await db.from('jjp_emails').update({
      status: failed ? 'failed' : 'pending', retry_count: retries, error: e.message
    }).eq('id', row.id);
    log.warn({ id: row.id, retries, failed, err: e.message }, 'envío de correo falló');
  }
}
