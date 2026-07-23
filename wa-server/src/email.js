import nodemailer from 'nodemailer';
import { db } from './supabase.js';
import { log } from './logger.js';
import { GMAIL_USER, GMAIL_APP_PASS, GMAIL_FROM, EMAIL_SWEEP_MS, MAX_RETRIES } from './config.js';

// Envío de correos del CRM por Gmail SMTP (gratis, con "contraseña de aplicación").
// Espejo del outbox de WhatsApp: el panel inserta jjp_emails status='pending',
// aquí se despachan y se marcan sent/failed. Realtime + barrido de respaldo.

let transporter = null;
let processing = false;

function ready() {
  return !!(GMAIL_USER && GMAIL_APP_PASS);
}

export function startEmail() {
  if (!ready()) {
    log.warn('correo DESACTIVADO: faltan GMAIL_USER / GMAIL_APP_PASS en .env (envío de emails no disponible)');
    return false;
  }
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS }
  });
  transporter.verify()
    .then(() => log.info({ user: GMAIL_USER }, 'SMTP Gmail listo ✅'))
    .catch(e => log.error({ err: e.message }, 'SMTP Gmail NO verifica (revisa usuario / app password)'));

  db.channel('wa-server-email')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'jjp_emails', filter: 'status=eq.pending' },
      () => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')))
    .subscribe(st => log.info({ st }, 'realtime email'));

  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email sweep falló')), EMAIL_SWEEP_MS);
  sweep().catch(() => {});
  return true;
}

async function sweep() {
  if (processing || !transporter) return;
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
  // Lock optimista
  const { data: locked } = await db.from('jjp_emails')
    .update({ status: 'sending' }).eq('id', row.id).eq('status', 'pending').select('id');
  if (!locked?.length) return;

  try {
    const info = await transporter.sendMail({
      from: GMAIL_FROM || GMAIL_USER,
      to: row.to_addr,
      subject: row.subject || '(sin asunto)',
      text: row.body || '',
      html: row.html || undefined
    });
    await db.from('jjp_emails').update({
      status: 'sent', message_id: info.messageId || null,
      error: null, sent_at: new Date().toISOString()
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
