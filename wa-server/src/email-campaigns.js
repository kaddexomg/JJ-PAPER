import { db } from './supabase.js';
import { log } from './logger.js';
import { CAMPAIGN_SWEEP_MS } from './config.js';
import { sendEmailNow } from './email.js';

// Despachador de campañas de CORREO (jjp_email_campaigns / _targets).
// Un correo por dueño por tick, con espera aleatoria delay_min_s..delay_max_s
// y tope diario (email_daily_limit, def. 300 — Gmail gratis ~500/día).
// Registra cada envío en jjp_emails (direction out) para que aparezca en Enviados.

let running = false;
const nextSendAt = new Map();   // owner_id → próximo envío permitido

export function startEmailCampaigns() {
  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email-campaign sweep falló')), CAMPAIGN_SWEEP_MS);
  sweep().catch(() => {});
  log.info('despachador de campañas de correo activo');
}

async function sweep() {
  if (running) return;
  running = true;
  try {
    await releaseCancelled();
    const { data: camps } = await db.from('jjp_email_campaigns')
      .select('*').eq('status', 'running').order('created_at', { ascending: true });
    if (!camps?.length) return;

    const dailyLimit = await getDailyLimit();
    const byOwner = new Map();
    for (const c of camps) if (!byOwner.has(c.owner_id)) byOwner.set(c.owner_id, c);
    for (const camp of byOwner.values()) await step(camp, dailyLimit);
  } finally {
    running = false;
  }
}

async function step(camp, dailyLimit) {
  if (Date.now() < (nextSendAt.get(camp.owner_id) || 0)) return;
  if (await countSentToday(camp.owner_id) >= dailyLimit) {
    log.warn({ owner: camp.owner_id, dailyLimit }, 'tope diario de correos alcanzado');
    return;
  }

  const { data: targets } = await db.from('jjp_email_campaign_targets')
    .select('*').eq('campaign_id', camp.id).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(1);
  if (!targets?.length) { await finish(camp); return; }
  const t = targets[0];

  // Respetar opt-out aunque cambie después de crear la campaña
  if (t.customer_id) {
    const { data: cust } = await db.from('jjp_customers')
      .select('email_opt_out').eq('id', t.customer_id).maybeSingle();
    if (cust?.email_opt_out) { await skip(camp, t, 'cliente sin correos'); return; }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.to_addr || '')) { await skip(camp, t, 'correo inválido'); return; }

  await db.from('jjp_email_campaign_targets').update({ status: 'sending' }).eq('id', t.id);

  try {
    const subject = renderTemplate(camp.subject, t.vars || {});
    const body = renderTemplate(camp.body, t.vars || {});
    const html = camp.html ? renderTemplate(camp.html, t.vars || {}) : null;

    const { id: msgId, from } = await sendEmailNow(camp.owner_id, {
      to_addr: t.to_addr, subject, body, html, attachments: camp.attachments || []
    });

    // Historial en jjp_emails (aparece en "Enviados")
    const { data: em } = await db.from('jjp_emails').insert({
      owner_id: camp.owner_id, direction: 'out', status: 'sent',
      to_addr: t.to_addr, from_addr: from, subject, body, html,
      attachments: camp.attachments || [], customer_id: t.customer_id || null,
      campaign_id: camp.id, message_id: msgId, sent_at: new Date().toISOString()
    }).select('id').single();

    await db.from('jjp_email_campaign_targets')
      .update({ status: 'sent', email_id: em?.id || null, sent_at: new Date().toISOString(), error: null })
      .eq('id', t.id);
    if (t.customer_id) await db.from('jjp_customers').update({ last_email_at: new Date().toISOString() }).eq('id', t.customer_id);
    await syncCounts(camp.id);

    const delayMs = 1000 * (camp.delay_min_s + Math.random() * Math.max(0, camp.delay_max_s - camp.delay_min_s));
    nextSendAt.set(camp.owner_id, Date.now() + delayMs);
    log.info({ campaign: camp.name, to: t.to_addr, nextInS: Math.round(delayMs / 1000) }, 'campaña correo: enviado');
  } catch (e) {
    await db.from('jjp_email_campaign_targets').update({ status: 'failed', error: e.message }).eq('id', t.id);
    await syncCounts(camp.id);
    log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'campaña correo: target falló');
    // Si es fallo de credenciales, no reintentar en bucle rápido
    nextSendAt.set(camp.owner_id, Date.now() + 30_000);
  }
}

function renderTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
}

async function skip(camp, t, reason) {
  await db.from('jjp_email_campaign_targets').update({ status: 'skipped', error: reason }).eq('id', t.id);
  await syncCounts(camp.id);
}

async function finish(camp) {
  await syncCounts(camp.id);
  await db.from('jjp_email_campaigns')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', camp.id).eq('status', 'running');
  log.info({ campaign: camp.name }, 'campaña correo completada');
}

async function syncCounts(campaignId) {
  const [{ count: sent }, { count: failed }] = await Promise.all([
    db.from('jjp_email_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('status', 'sent'),
    db.from('jjp_email_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['failed', 'skipped']),
  ]);
  await db.from('jjp_email_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0, updated_at: new Date().toISOString() })
    .eq('id', campaignId);
}

async function releaseCancelled() {
  const { data: cancelled } = await db.from('jjp_email_campaigns').select('id').eq('status', 'cancelled');
  for (const c of cancelled || []) {
    await db.from('jjp_email_campaign_targets')
      .update({ status: 'skipped', error: 'campaña cancelada' })
      .eq('campaign_id', c.id).in('status', ['pending', 'sending']);
  }
}

async function countSentToday(ownerId) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const { count } = await db.from('jjp_email_campaign_targets')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId).eq('status', 'sent').gte('sent_at', midnight.toISOString());
  return count || 0;
}

async function getDailyLimit() {
  const { data } = await db.from('jjp_settings').select('value').eq('key', 'email_daily_limit').maybeSingle();
  const n = parseInt(data?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
}
