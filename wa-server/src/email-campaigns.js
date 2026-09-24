import { db, dbCore } from './supabase.js';
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
  if (camp.scheduled_at && new Date(camp.scheduled_at).getTime() > Date.now()) return;
  if (Date.now() < (nextSendAt.get(camp.owner_id) || 0)) return;
  if (await countSentToday(camp.owner_id) >= dailyLimit) {
    log.warn({ owner: camp.owner_id, dailyLimit }, 'tope diario de correos alcanzado');
    return;
  }

  const { data: targets } = await db.from('jjp_email_campaign_targets')
    .select('*').eq('campaign_id', camp.id).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(20);
  if (!targets?.length) { await finish(camp); return; }

  for (const t of targets) {
    // Respetar opt-out aunque cambie después de crear la campaña
    if (t.customer_id) {
      const { data: cust } = await dbCore.from('jjp_customers')
        .select('email_opt_out').eq('id', t.customer_id).maybeSingle();
      if (cust?.email_opt_out) { await skip(camp, t, 'cliente sin correos'); continue; }
    }
    const toAddr = t.to_addr || t.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toAddr || '')) { await skip(camp, t, 'correo inválido'); continue; }

    await db.from('jjp_email_campaign_targets').update({ status: 'sending' }).eq('id', t.id);

    try {
      const realVars = {
        ...(t.vars || {}),
        nombre: t.name || (t.vars || {}).nombre || '',
        empresa: (t.vars || {}).empresa || t.name || '',
      };
      
      // CHECK SUPPRESSION LIST BEFORE SENDING
      const { data: bounceCheck } = await dbCore.from('jjp_email_suppression_list').select('id').eq('email', toAddr).maybeSingle();
      if (bounceCheck) {
        await skip(camp, t, 'correo rebotado (suppression list)');
        continue;
      }

      const subjTemplate = t.vars?.custom_subject || t.custom_subject || camp.subject || '';
      const subject = renderTemplate(subjTemplate, realVars);
      const bodyTemplate = t.vars?.custom_message || t.vars?.custom_body || t.custom_message || camp.body || camp.body_html || '';
      const body = renderTemplate(bodyTemplate, realVars);

      let html = null;
      if (t.vars?.custom_html) {
        html = renderTemplate(t.vars.custom_html, realVars);
      } else if (t.vars?.custom_message || t.vars?.custom_body || !camp.html || camp.html.includes('Le saludamos cordialmente de JJ Paper...')) {
        // Generar HTML personalizado a partir del cuerpo renderizado único para este destinatario
        const bodyWithBr = body.replace(/\n/g, '<br>');
        const imgAtt = (camp.attachments || []).find(a => (a.mime && a.mime.startsWith('image/')) || (a.contentType && a.contentType.startsWith('image/')) || (a.path && a.path.includes('/campaigns/')));
        const STORAGE_BASE = `https://nmcamjxhyysmmvgxgabo.supabase.co/storage/v1/object/public/`;
        const imgUrl = imgAtt?.path ? (imgAtt.path.startsWith('http') ? imgAtt.path : `${STORAGE_BASE}${imgAtt.bucket || 'jjp-email-media'}/${imgAtt.path}`) : '';
        const imgHtml = imgUrl ? `<div style="margin:14px 0;text-align:center"><img src="${imgUrl}" style="max-width:600px;border-radius:8px"></div>` : '';
        html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#333;line-height:1.6;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;border:1px solid #edf2f7;border-radius:12px">${imgHtml}<div>${bodyWithBr}</div></div>`;
      } else {
        const htmlTemplate = camp.html || camp.body_html || null;
        html = htmlTemplate ? renderTemplate(htmlTemplate, realVars) : null;
      }

      const { id: msgId, from } = await sendEmailNow(camp.owner_id, {
        to_addr: toAddr, subject, body, html, attachments: camp.attachments || []
      });

      // Historial en jjp_emails (aparece en "Enviados")
      const { data: em } = await db.from('jjp_emails').insert({
        owner_id: camp.owner_id, direction: 'out', status: 'sent',
        to_addr: toAddr, from_addr: from, subject, body, html,
        attachments: camp.attachments || [], customer_id: t.customer_id || null,
        gmail_id: msgId, sent_at: new Date().toISOString()
      }).select('id').single();

      await db.from('jjp_email_campaign_targets')
        .update({ status: 'sent', email_id: em?.id || null, sent_at: new Date().toISOString(), error: null })
        .eq('id', t.id);
      if (t.customer_id) await dbCore.from('jjp_customers').update({ last_email_at: new Date().toISOString() }).eq('id', t.customer_id);
      await syncCounts(camp.id);

      const delayMs = 1000 * (camp.delay_min_s + Math.random() * Math.max(0, camp.delay_max_s - camp.delay_min_s));
      nextSendAt.set(camp.owner_id, Date.now() + delayMs);
      log.info({ campaign: camp.name, to: t.to_addr, nextInS: Math.round(delayMs / 1000) }, 'campaña correo: enviado');
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes('limit for sending mail')) {
         await db.from('jjp_email_campaigns').update({ status: 'paused', error: 'Límite de Gmail alcanzado' }).eq('id', camp.id);
         log.warn({ campaign: camp.name, target: t.id }, 'Campaña auto-pausada por límite de envío');
      }
      await db.from('jjp_email_campaign_targets').update({ status: 'failed', error: e.message }).eq('id', t.id);
      await syncCounts(camp.id);
      log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'campaña correo: target falló');
      // Si es fallo de credenciales, no reintentar en bucle rápido
      nextSendAt.set(camp.owner_id, Date.now() + 30_000);
    }
    
    break; // solo 1 envío real por tick
  }
}

// Procesa variables {{nombre}}, {{link}}, etc. PRIMERO, luego Spintax {Hola|Buenos días}.
// Orden invertido respecto a lo que había: las variables usan doble llave y deben
// resolverse antes de que la regex de Spintax (llave simple) toque el texto.
function renderTemplate(body, vars) {
  // 1) Variables: {{clave}} → valor real del target
  let str = String(body || '').replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
  // 2) Spintax: {Hola|Buenos días|Estimado/a} → elige una opción al azar
  str = str.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, choices) => {
    const parts = choices.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
  return str;
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
  const [{ count: sent }, { count: failed }, { count: skipped }] = await Promise.all([
    db.from('jjp_email_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('status', 'sent'),
    db.from('jjp_email_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('status', 'failed'),
    db.from('jjp_email_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).eq('status', 'skipped'),
  ]);
  await db.from('jjp_email_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0, skipped_count: skipped || 0, updated_at: new Date().toISOString() })
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
  const { data } = await dbCore.from('jjp_settings').select('value').eq('key', 'email_daily_limit').maybeSingle();
  const n = parseInt(data?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
}
