import { db } from './supabase.js';
import { log } from './logger.js';
import { CAMPAIGN_SWEEP_MS } from './config.js';
import { normVePhone, localVePhone, phoneToJid } from './phone.js';

// Despachador de campañas de difusión (jjp_wa_campaigns / jjp_wa_campaign_targets).
// Anti-baneo: UN mensaje por vendedor por tick, con espera aleatoria entre
// delay_min_s y delay_max_s de la campaña, y tope diario global (wa_daily_limit).
// El envío real lo hace outbox.js: aquí solo se crea el chat (si falta) y se
// encola la fila 'pending' en jjp_wa_messages con la plantilla ya renderizada.

let manager = null;
let running = false;
const nextSendAt = new Map();   // owner_id → timestamp del próximo envío permitido

export function startCampaigns(sessionManager) {
  manager = sessionManager;
  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'campaign sweep falló')), CAMPAIGN_SWEEP_MS);
  sweep().catch(() => {});
}

async function sweep() {
  if (running) return;
  running = true;
  try {
    await releaseCancelled();

    const { data: camps, error } = await db.from('jjp_wa_campaigns')
      .select('*')
      .in('status', ['en_cola', 'enviando', 'pending', 'sending'])
      .order('created_at', { ascending: true });
    if (error) { log.error({ error: error.message }, 'select campañas falló'); return; }
    if (!camps?.length) return;

    const dailyLimit = await getDailyLimit();

    // Una campaña activa por vendedor a la vez (la más vieja primero)
    const byOwner = new Map();
    for (const c of camps) if (!byOwner.has(c.owner_id)) byOwner.set(c.owner_id, c);

    for (const camp of byOwner.values()) await step(camp, dailyLimit);
  } finally {
    running = false;
  }
}

async function step(camp, dailyLimit) {
  const session = manager.get(camp.owner_id);
  if (!session?.isConnected()) return;                 // espera a que la sesión conecte

  if (Date.now() < (nextSendAt.get(camp.owner_id) || 0)) return;

  const sentToday = await countSentToday(camp.owner_id);
  if (sentToday >= dailyLimit) {
    log.warn({ owner: camp.owner_id, sentToday, dailyLimit }, 'tope diario de difusión alcanzado');
    return;
  }

  const { data: targets } = await db.from('jjp_wa_campaign_targets')
    .select('*')
    .eq('campaign_id', camp.id)
    .in('status', ['pending', 'en_cola'])
    .order('created_at', { ascending: true })
    .limit(1);

  if (!targets?.length) { await finish(camp); return; }
  const t = targets[0];

  if (camp.status === 'en_cola' || camp.status === 'pending') {
    await db.from('jjp_wa_campaigns')
      .update({ status: 'enviando', started_at: camp.started_at || new Date().toISOString() })
      .eq('id', camp.id);
  }

  // Respetar opt-out aunque haya cambiado después de crear la campaña
  if (t.customer_id) {
    const { data: cust } = await db.from('jjp_customers')
      .select('wa_opt_out').eq('id', t.customer_id).maybeSingle();
    if (cust?.wa_opt_out) { await skip(camp, t, 'cliente con opt-out'); return; }
  }

  const norm = normVePhone(t.phone);
  if (!/^58\d{10}$/.test(norm)) { await skip(camp, t, 'teléfono inválido: ' + t.phone); return; }

  try {
    const chatId = await ensureChat(camp.owner_id, norm, t);
    const body = renderTemplate(camp.body || camp.message || '', t.vars || {});

    const msgPayload = {
      chat_id: chatId,
      owner_id: camp.owner_id,
      direction: 'out',
      type: camp.media_path ? (camp.media_type || 'document') : 'text',
      body,
      media_path: camp.media_path || null,
      media_mime: camp.media_mime || null,
      media_filename: camp.media_filename || null,
      media_size: camp.media_size || null,
      status: 'pending'
    };

    const { data: msg, error: msgErr } = await db.from('jjp_wa_messages')
      .insert(msgPayload)
      .select('id').single();
    if (msgErr) throw new Error(msgErr.message);

    await db.from('jjp_wa_campaign_targets')
      .update({ status: 'sent', message_id: msg.id, sent_at: new Date().toISOString(), error: null })
      .eq('id', t.id);
    await syncCounts(camp.id);

    const minS = Number(camp.delay_min_s) || 12;
    const maxS = Number(camp.delay_max_s) || 28;
    const delayMs = 1000 * (minS + Math.random() * Math.max(1, maxS - minS));
    nextSendAt.set(camp.owner_id, Date.now() + delayMs);
    log.info({ campaign: camp.name, to: norm, nextInS: Math.round(delayMs / 1000) }, 'difusión: mensaje encolado');
  } catch (e) {
    await db.from('jjp_wa_campaign_targets')
      .update({ status: 'failed', error: e.message }).eq('id', t.id);
    await syncCounts(camp.id);
    log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'difusión: target falló');
  }
}

// Chat del destinatario: reusa el existente (owner+jid) o lo crea
async function ensureChat(ownerId, norm, target) {
  const jid = phoneToJid(norm);
  const { data: chat, error } = await db.from('jjp_wa_chats')
    .upsert({
      owner_id: ownerId, jid, phone: localVePhone(norm),
      customer_id: target.customer_id || null,
      display_name: target.name || localVePhone(norm),
    }, { onConflict: 'owner_id,jid', ignoreDuplicates: false })
    .select('id').single();
  if (error) throw new Error('no pude crear el chat: ' + error.message);
  return chat.id;
}

// {{variable}} → valor; sin valor queda vacío (nunca se envía el placeholder crudo)
function renderTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
}

async function skip(camp, target, reason) {
  await db.from('jjp_wa_campaign_targets')
    .update({ status: 'skipped', error: reason }).eq('id', target.id);
  await syncCounts(camp.id);
}

async function finish(camp) {
  await syncCounts(camp.id);
  await db.from('jjp_wa_campaigns')
    .update({ status: 'completada', finished_at: new Date().toISOString() })
    .eq('id', camp.id).in('status', ['en_cola', 'enviando', 'pending', 'sending']);
  await db.from('jjp_notifications').insert({
    user_id: camp.owner_id, type: 'wa_campana',
    title: '📣 Campaña completada',
    body: `"${camp.name}" terminó de enviarse.`,
    link: '/vendedor/difusion.html',
  });
  log.info({ campaign: camp.name }, 'difusión: campaña completada');
}

// Recalcula contadores desde los targets (fuente de verdad)
async function syncCounts(campaignId) {
  const [{ count: sent }, { count: failed }] = await Promise.all([
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['sent', 'enviado']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['failed', 'fallido', 'skipped', 'omitido']),
  ]);
  await db.from('jjp_wa_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0 })
    .eq('id', campaignId);
}

// El frontend no puede tocar targets (RLS): al cancelar una campaña,
// aquí se liberan sus pendientes como 'skipped'
async function releaseCancelled() {
  const { data: cancelled } = await db.from('jjp_wa_campaigns')
    .select('id').eq('status', 'cancelada');
  for (const c of cancelled || []) {
    await db.from('jjp_wa_campaign_targets')
      .update({ status: 'skipped', error: 'campaña cancelada' })
      .eq('campaign_id', c.id).in('status', ['pending', 'en_cola']);
  }
}

async function countSentToday(ownerId) {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const { count } = await db.from('jjp_wa_campaign_targets')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId).in('status', ['sent', 'enviado'])
    .gte('sent_at', midnight.toISOString());
  return count || 0;
}

async function getDailyLimit() {
  const { data } = await db.from('jjp_settings').select('value').eq('key', 'wa_daily_limit').maybeSingle();
  const n = parseInt(data?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
}
