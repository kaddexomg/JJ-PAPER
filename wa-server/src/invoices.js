import { db } from './supabase.js';
import { log } from './logger.js';
import { INVOICE_SWEEP_MS } from './config.js';
import { normVePhone, localVePhone, phoneToJid } from './phone.js';

// Recordatorios de facturas por pagar → WhatsApp del dueño.
// El cron de Postgres (jjp_invoices_check) decide CUÁNDO avisar y escribe la
// fila en jjp_invoice_alerts; aquí solo se empuja al teléfono. El envío real
// lo hace outbox.js: esto encola la fila 'pending' en jjp_wa_messages.
//
// DESTINATARIO ÚNICO: el número de jjp_settings.invoice_alert_phone (el del
// dueño). Esto NO es difusión: nunca escribe a clientes ni a otros números.

let manager = null;
let running = false;

export function startInvoiceAlerts(sessionManager) {
  manager = sessionManager;
  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'invoice sweep falló')), INVOICE_SWEEP_MS);
  sweep().catch(() => {});
}

async function sweep() {
  if (running) return;
  running = true;
  try {
    const { data: alerts, error } = await db.from('jjp_invoice_alerts')
      .select('id, title, body')
      .eq('wa_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) { log.error({ error: error.message }, 'select alertas de factura falló'); return; }
    if (!alerts?.length) return;

    const cfg = await getConfig();

    // Avisos por WhatsApp apagados desde Ajustes → quedan solo en la campana
    if (!cfg.enabled) {
      await mark(alerts.map(a => a.id), { wa_status: 'skipped', wa_error: 'avisos por WhatsApp desactivados' });
      return;
    }
    if (!/^58\d{10}$/.test(cfg.phone)) {
      await mark(alerts.map(a => a.id), { wa_status: 'failed', wa_error: 'invoice_alert_phone inválido: ' + cfg.phone });
      log.warn({ phone: cfg.phone }, 'invoice_alert_phone inválido — revisa Ajustes');
      return;
    }

    const ownerId = await pickConnectedAdmin();
    if (!ownerId) return;                    // sin sesión conectada: reintenta al próximo barrido

    for (const a of alerts) await push(a, ownerId, cfg.phone);
  } finally {
    running = false;
  }
}

async function push(alert, ownerId, phone) {
  try {
    const chatId = await ensureChat(ownerId, phone);
    const body = `${alert.title}\n\n${alert.body}`;

    const { data: msg, error } = await db.from('jjp_wa_messages')
      .insert({ chat_id: chatId, owner_id: ownerId, direction: 'out', type: 'text', body, status: 'pending' })
      .select('id').single();
    if (error) throw new Error(error.message);

    await mark([alert.id], {
      wa_status: 'queued', wa_message_id: msg.id,
      wa_sent_at: new Date().toISOString(), wa_error: null,
    });
    log.info({ alert: alert.id, to: phone }, 'recordatorio de factura encolado');
  } catch (e) {
    await mark([alert.id], { wa_status: 'failed', wa_error: e.message });
    log.warn({ alert: alert.id, err: e.message }, 'recordatorio de factura falló');
  }
}

// Chat del propio dueño: se reusa el existente (owner+jid) o se crea
async function ensureChat(ownerId, phone) {
  const norm = normVePhone(phone);
  const { data: chat, error } = await db.from('jjp_wa_chats')
    .upsert({
      owner_id: ownerId, jid: phoneToJid(norm), phone: localVePhone(norm),
      display_name: 'Mis facturas por pagar',
    }, { onConflict: 'owner_id,jid', ignoreDuplicates: false })
    .select('id').single();
  if (error) throw new Error('no pude crear el chat de avisos: ' + error.message);
  return chat.id;
}

// Primer admin activo con la sesión de WhatsApp conectada
async function pickConnectedAdmin() {
  const { data: admins } = await db.from('jjp_profiles')
    .select('id').eq('role', 'admin').eq('active', true);
  for (const a of admins || []) {
    if (manager.get(a.id)?.isConnected()) return a.id;
  }
  return null;
}

async function mark(ids, patch) {
  await db.from('jjp_invoice_alerts').update(patch).in('id', ids);
}

async function getConfig() {
  const { data } = await db.from('jjp_settings').select('key,value')
    .in('key', ['invoice_alert_phone', 'invoice_wa_alerts']);
  const map = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  return {
    phone:   normVePhone(map.invoice_alert_phone || ''),
    enabled: map.invoice_wa_alerts !== '0',      // por defecto encendido
  };
}
