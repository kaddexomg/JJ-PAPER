import { db, dbCore } from './supabase.js';
import { log } from './logger.js';
import { CAMPAIGN_SWEEP_MS } from './config.js';
import { normVePhone, localVePhone, phoneToJid, parsePhoneInfo } from './phone.js';

// Despachador de campañas de difusión (jjp_wa_campaigns / jjp_wa_campaign_targets).
// Anti-baneo: UN mensaje por vendedor por tick, con espera aleatoria entre
// delay_min_s y delay_max_s de la campaña, y tope diario global (wa_daily_limit).
// El envío real lo hace outbox.js: aquí solo se crea el chat (si falta) y se
// encola la fila 'pending' en jjp_wa_messages con la plantilla ya renderizada.

function buildFullCommercialMessage(vars, camp) {
  const sName = vars.vendedor || 'Asesor JJ Paper';
  const hasPdf = Boolean(camp.media_path && camp.media_type === 'document') || Boolean(camp.extra_media_path);
  const pdfText = hasPdf ? '\n\n📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.' : '';
  
  return `{Hola|Buen día|Saludos} {{nombre}} 👋\n\nLe escribe ${sName} de *JJ Paper C.A.*, su distribuidor directo de papelería, insumos de oficina y consumibles en Caracas.\n\n📦 *Tenemos disponibilidad inmediata en:*\n\n• 🖨️ *Resmas de papel Bond* — Carta y Oficio, diferentes gramajes\n• 🧾 *Rollos térmicos POS* — 80x70mm y 57x40mm para puntos de venta\n• 📎 *Cintas de embalaje industrial* — 48x100m y 48x200m, alto micraje\n• 📁 *Carpetas, archivadores y sobres* — Fibra marrón, manila, radiografía\n• ✏️ *Material escolar y de escritorio* — Cuadernos, bolígrafos, marcadores${pdfText}\n\n✅ *¿Por qué elegirnos?*\n1️⃣ Catálogo con +900 artículos disponibles\n2️⃣ Cotizaciones al instante adaptadas a su presupuesto\n3️⃣ 🚚 Delivery GRATIS en toda Caracas\n4️⃣ Facturación fiscal formal (RIF J-295375450) en Bs a tasa BCV oficial\n\n👉 Catálogo digital: {{link}}\n\n{Quedo a su orden|Estamos para servirle|A su completa disposición} para cualquier cotización o consulta.\n\n${sName}\n📞 0412-4676073\n*JJ Paper C.A.* — Distribución directa en Caracas`;
}

let manager = null;
let running = false;
const nextSendAt = new Map();   // owner_id → timestamp del próximo envío permitido
const ownerCampIndex = new Map(); // owner_id → índice de rotación de campañas (round-robin)
const onWaCache = new Map();    // norm_phone → { exists: boolean, ts: number } (TTL 24h)

export function startCampaigns(sessionManager) {
  manager = sessionManager;
  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'campaign sweep falló')), CAMPAIGN_SWEEP_MS);
  
  // Limpieza de memoria (Garbage Collection) para onWaCache cada hora
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of onWaCache.entries()) {
      if (now - val.ts > 24 * 60 * 60 * 1000) onWaCache.delete(key);
    }
    if (onWaCache.size > 50000) onWaCache.clear(); // Safety cap adicional
  }, 60 * 60 * 1000);
  sweep().catch(() => {});
}

async function sweep() {
  if (running) return;
  running = true;
  try {
    // Al inicio de sweep(), si nextSendAt está vacío, restaurar del DB
    if (nextSendAt.size === 0) {
      const { data: active } = await db.from('jjp_wa_campaigns')
        .select('owner_id, next_send_at')
        .in('status', ['en_cola', 'enviando', 'pending', 'sending'])
        .not('next_send_at', 'is', null);
      if (active) {
        for (const c of active) {
          const ts = new Date(c.next_send_at).getTime();
          if (ts > Date.now()) nextSendAt.set(c.owner_id, ts);
        }
      }
    }

    // Recuperar targets huérfanos (enviando > 5 min sin progreso)
    await db.from('jjp_wa_campaign_targets')
      .update({ status: 'pending', error: null })
      .eq('status', 'enviando')
      .lt('updated_at', new Date(Date.now() - 5 * 60_000).toISOString());

    await releaseCancelled();

    const { data: camps, error } = await db.from('jjp_wa_campaigns')
      .select('*')
      .in('status', ['en_cola', 'enviando', 'pending', 'sending'])
      .order('created_at', { ascending: true });
    if (error) { log.error({ error: error.message }, 'select campañas falló'); return; }
    if (!camps?.length) return;

    const dailyLimit = await getDailyLimit();

    // Soporte Multi-Campaña Simultáneo:
    // Agrupar TODAS las campañas activas por vendedor (owner_id).
    // Para cada vendedor, se hace rotación Round-Robin entre sus campañas activas.
    // De este modo, si un vendedor tiene 2 o 3 campañas activas, todas progresan
    // en paralelo sin que una con cientos de contactos congele a las demás.
    const campsByOwner = new Map();
    for (const c of camps) {
      if (!campsByOwner.has(c.owner_id)) campsByOwner.set(c.owner_id, []);
      campsByOwner.get(c.owner_id).push(c);
    }

    // Ejecución paralela por cada vendedor (concurrencia total entre vendedores)
    const ownerIds = Array.from(campsByOwner.keys());
    await Promise.allSettled(ownerIds.map(async (ownerId) => {
      const list = campsByOwner.get(ownerId);
      if (!list || !list.length) return;
      const curIdx = (ownerCampIndex.get(ownerId) || 0) % list.length;
      ownerCampIndex.set(ownerId, curIdx + 1);
      const campToProcess = list[curIdx];
      await step(campToProcess, dailyLimit);
    }));
  } finally {
    running = false;
  }
}

async function step(camp, dailyLimit) {
  if (camp.scheduled_at && new Date(camp.scheduled_at).getTime() > Date.now()) return;

  let session = manager.get(camp.owner_id);
  if (!session?.isConnected()) {
    const activeSessions = manager.all().filter(s => s.isConnected());
    if (activeSessions.length > 0) {
      session = activeSessions[0];
    } else {
      return;
    }
  }

  if (Date.now() < (nextSendAt.get(camp.owner_id) || 0)) return;

  const sentToday = await countSentToday(camp.owner_id);
  if (sentToday >= dailyLimit) {
    log.warn({ owner: camp.owner_id, sentToday, dailyLimit }, 'tope diario de difusión alcanzado');
    return;
  }

  // Procesar hasta 20 targets en un tick (los skips son instantáneos)
  const { data: targets } = await db.from('jjp_wa_campaign_targets')
    .select('*')
    .eq('campaign_id', camp.id)
    .in('status', ['pending', 'en_cola'])
    .order('created_at', { ascending: true })
    .limit(20);

  if (!targets?.length) {
    const { count: sendingCount } = await db.from('jjp_wa_campaign_targets')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', camp.id)
      .eq('status', 'enviando');
    if (!sendingCount) {
      await finish(camp);
    }
    return;
  }

  if (camp.status === 'en_cola' || camp.status === 'pending') {
    await db.from('jjp_wa_campaigns')
      .update({ status: 'enviando', started_at: camp.started_at || new Date().toISOString() })
      .eq('id', camp.id);
  }

  for (const t of targets) {
    // Validaciones rápidas que no requieren delay
    if (t.customer_id) {
      const { data: cust } = await dbCore.from('jjp_customers')
        .select('wa_opt_out').eq('id', t.customer_id).maybeSingle();
      if (cust?.wa_opt_out) { await skip(camp, t, 'cliente con opt-out'); continue; }
    }

    const pInfo = parsePhoneInfo(t.phone);
    if (!pInfo.isValid) {
      await skip(camp, t, 'teléfono inválido: ' + (t.phone || 'vacío'));
      continue;
    }
    if (pInfo.isLandline) {
      await skip(camp, t, 'teléfono fijo CANTV sin WhatsApp: ' + (t.phone || ''));
      continue;
    }
    const norm = pInfo.norm;

    // Validar WA con Baileys con caché en RAM (TTL 24h) para evitar llamadas redundantes
    let hasWa = false;
    const cachedWa = onWaCache.get(norm);
    if (cachedWa && Date.now() - cachedWa.ts < 24 * 60 * 60 * 1000) {
      hasWa = cachedWa.exists;
    } else {
      try {
        const waPromise = session.sock.onWhatsApp(norm + '@s.whatsapp.net');
        const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
        const res = await Promise.race([waPromise, timeoutPromise]);
        hasWa = Array.isArray(res) && res.length > 0 && Boolean(res[0]?.exists);
        onWaCache.set(norm, { exists: hasWa, ts: Date.now() });
      } catch (e) {
        log.warn({ phone: norm, err: e.message }, 'validación onWhatsApp falló con error/timeout');
      }
    }

    if (!hasWa) {
      if (t.customer_id) {
        try {
          await dbCore.from('jjp_customers')
            .update({ wa_opt_out: true })
            .eq('id', t.customer_id);
        } catch (e) {
          log.warn({ custId: t.customer_id, err: e.message }, 'no se pudo actualizar wa_opt_out');
        }
      }
      await skip(camp, t, 'número sin WhatsApp activo: ' + (t.phone || ''));
      continue;
    }

    // Este SÍ es válido → encolar y aplicar delay
    try {
      const chatId = await ensureChat(camp.owner_id, norm, t);
      const realVars = {
        ...(t.vars || {}),
        nombre: t.name || (t.vars || {}).nombre || '',
        empresa: t.name || (t.vars || {}).empresa || '',
      };
      // Resolver plantilla: prioridad custom_message del target > message de la campaña > fallback comercial
      let msgTemplate = t.vars?.custom_message || t.vars?.custom_body || t.custom_message || camp.message || camp.body || '';

      if (!msgTemplate) {
        msgTemplate = buildFullCommercialMessage(realVars, camp);
      }
      
      const body = renderTemplate(msgTemplate, realVars);

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

      if (camp.extra_media_path) {
        const extraPayload = {
          chat_id: chatId,
          owner_id: camp.owner_id,
          direction: 'out',
          type: camp.extra_media_type || 'document',
          body: '',
          media_path: camp.extra_media_path,
          media_mime: camp.extra_media_mime || null,
          media_filename: camp.extra_media_filename || null,
          media_size: camp.extra_media_size || null,
          status: 'pending'
        };
        await db.from('jjp_wa_messages').insert(extraPayload);
      }

      await db.from('jjp_wa_campaign_targets')
        .update({ status: 'enviando', message_id: msg.id, error: null })
        .eq('id', t.id);

      // Piso de seguridad estricto anti-baneo para WhatsApp: nunca despachar a menos de 35s
      const minS = Math.max(35, Number(camp.delay_min_s) || 45);
      const maxS = Math.max(minS + 15, Number(camp.delay_max_s) || 90);
      let delayMs = 1000 * (minS + Math.random() * (maxS - minS));

      // Protección por lotes: si no se configuró, aplicar descanso humano por defecto cada 18 mensajes
      const batchSize = Number(camp.batch_size) > 0 ? Number(camp.batch_size) : 18;
      const batchPauseM = Number(camp.batch_pause_m) > 0 ? Number(camp.batch_pause_m) : 5;
      const currentSent = (camp.sent_count || 0) + 1;

      const isBatchPause = (batchSize > 0 && currentSent % batchSize === 0);
      if (isBatchPause) {
        const longPauseMs = (batchPauseM * 60 * 1000) + Math.floor(Math.random() * 60000); // 5m + jitter
        delayMs = longPauseMs;
        log.info({ campaign: camp.name, sent: currentSent, pauseMin: batchPauseM }, 'difusión: pausa de lote (descanso humano anti-bloqueo)');
      }

      const nextTime = new Date(Date.now() + delayMs).toISOString();
      nextSendAt.set(camp.owner_id, Date.now() + delayMs);
      await db.from('jjp_wa_campaigns').update({
        next_send_at: nextTime,
        pause_reason: isBatchPause ? 'batch_pause' : 'interval',
        pause_until: isBatchPause ? nextTime : null,
        updated_at: new Date().toISOString()
      }).eq('id', camp.id);

      log.info({ campaign: camp.name, to: norm, nextInS: Math.round(delayMs / 1000), isBatchPause }, 'difusión: mensaje encolado');
    } catch (e) {
      await db.from('jjp_wa_campaign_targets')
        .update({ status: 'failed', error: e.message }).eq('id', t.id);
      await syncCounts(camp.id);
      log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'difusión: target falló');
    }
    
    break; // solo 1 envío real por tick (el delay anti-baneo)
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

// Diccionario de clusters de sinónimos para intercalar variaciones humanas automáticas
const LEXICAL_SYNONYMS = [
  {
    regex: /\b(buen día|buenos días)\b/gi,
    variants: ['buen día', 'un cordial saludo', 'excelente día', 'saludos cordiales', 'un placer saludarle']
  },
  {
    regex: /\b(hola|qué tal)\b/gi,
    variants: ['hola', 'qué tal', 'un gusto saludarle', 'un cordial saludo']
  },
  {
    regex: /\b(le saluda|le escribe)\b/gi,
    variants: ['le saluda', 'le escribe', 'por aquí le contacta', 'se comunica con usted']
  },
  {
    regex: /\b(su distribuidor directo|su distribuidora directa)\b/gi,
    variants: ['su distribuidor directo', 'su aliado mayorista', 'su proveedor directo', 'importador y distribuidor mayorista directo']
  },
  {
    regex: /\b(tenemos disponibilidad inmediata en|contamos con disponibilidad inmediata en)\b/gi,
    variants: [
      'tenemos disponibilidad inmediata en',
      'contamos con inventario listo para despacho en',
      'disponemos de stock para entrega inmediata en',
      'le ofrecemos disponibilidad inmediata en'
    ]
  },
  {
    regex: /\b(precios mayoristas|precios de mayorista|precios de distribuidor)\b/gi,
    variants: [
      'precios mayoristas',
      'precios directos de distribuidor',
      'condiciones especiales al mayor',
      'tarifas preferenciales de importador'
    ]
  },
  {
    regex: /\b(a tasa oficial bcv|al cambio oficial bcv|según tasa bcv)\b/gi,
    variants: [
      'a tasa oficial BCV',
      'al cambio oficial del BCV',
      'calculados a tasa oficial BCV',
      'según la tasa oficial publicada por el BCV'
    ]
  },
  {
    regex: /\b(facturación fiscal legal|factura fiscal formal|factura formal legal)\b/gi,
    variants: [
      'facturación fiscal legal (RIF J-295375450)',
      'factura legal formal con RIF',
      'facturación formal SENIAT con RIF J-295375450'
    ]
  },
  {
    regex: /\b(delivery gratis en toda caracas|despacho gratuito en caracas)\b/gi,
    variants: [
      'delivery GRATIS en toda Caracas',
      'despacho gratuito en el área metropolitana de Caracas',
      'entrega directa sin costo en toda Caracas'
    ]
  },
  {
    regex: /\b(quedo a su orden|estamos para servirle|a su completa disposición|a su entera orden)\b/gi,
    variants: [
      'quedo a su completa orden',
      'estamos para servirle con total gusto',
      'a su entera disposición para apoyarle',
      'atentos a sus requerimientos'
    ]
  },
  {
    regex: /\b(¿desea que le preparemos una cotización\?|¿desea que le enviemos una cotización\?)\b/gi,
    variants: [
      '¿Desea que le preparemos una cotización formal?',
      '¿Gusta que le reservemos disponibilidad para su despacho de esta semana?',
      '¿En qué requerimientos o reposición de insumos podemos apoyarle hoy?',
      '¿Le gustaría recibir una cotización formal ajustada a su empresa?'
    ]
  }
];

export function applyLexicalPermutations(text) {
  if (!text || typeof text !== 'string') return text;
  let res = text;

  // 1. Sustitución estocástica de sinónimos clave de negocio
  for (const item of LEXICAL_SYNONYMS) {
    if (item.regex.test(res)) {
      item.regex.lastIndex = 0;
      res = res.replace(item.regex, (match) => {
        if (Math.random() < 0.75) {
          return item.variants[Math.floor(Math.random() * item.variants.length)];
        }
        return match;
      });
    }
  }

  // 2. Alternancia de viñetas dinámicas (•, ▪️, 🔹) para romper similitud visual
  const bulletSymbols = ['•', '▪️', '🔹'];
  const chosenBullet = bulletSymbols[Math.floor(Math.random() * bulletSymbols.length)];
  if (chosenBullet !== '•') {
    res = res.replace(/^[ \t]*• /gm, `${chosenBullet} `);
  }

  // 3. Inserción de caracter invisible de espaciado único (\u200B o \u200C)
  // en una posición aleatoria para alterar el checksum y hash binario del mensaje
  const zwChars = ['\u200B', '\u200C', '\uFEFF'];
  const zw = zwChars[Math.floor(Math.random() * zwChars.length)];
  const words = res.split(' ');
  if (words.length > 5) {
    const insertIdx = Math.floor(Math.random() * (words.length - 2)) + 1;
    words[insertIdx] = words[insertIdx] + zw;
    res = words.join(' ');
  }

  return res;
}

// Procesa variables {{nombre}}, {{link}}, etc. PRIMERO, luego Spintax {Hola|Buenos días}.
// Por último, aplica el motor anti-baneo de permutaciones léxicas para que cada envío sea 100% único.
export function renderTemplate(body, vars) {
  // 1) Variables: {{clave}} → valor real del target
  let str = String(body || '').replace(/\{\{\s*([\w áéíóúñ]+?)\s*\}\}/gi,
    (_, k) => vars[k.trim().toLowerCase()] ?? '');
  // 2) Spintax: {Hola|Buenos días|Estimado/a} → elige una opción al azar
  str = str.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, choices) => {
    const parts = choices.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
  // 3) Motor Anti-Baneo / Permutaciones Léxicas Dinámicas
  str = applyLexicalPermutations(str);
  return str;
}

async function skip(camp, target, reason) {
  await db.from('jjp_wa_campaign_targets')
    .update({ status: 'skipped', error: reason }).eq('id', target.id);
  await syncCounts(camp.id);
}

async function finish(camp) {
  await syncCounts(camp.id);
  await db.from('jjp_wa_campaigns')
    .update({
      status: 'completada',
      finished_at: new Date().toISOString(),
      next_send_at: null,
      pause_reason: null,
      pause_until: null
    })
    .eq('id', camp.id).in('status', ['en_cola', 'enviando', 'pending', 'sending']);
  await dbCore.from('jjp_notifications').insert({
    user_id: camp.owner_id, type: 'wa_campana',
    title: '📣 Campaña completada',
    body: `"${camp.name}" terminó de enviarse.`,
    link: '/vendedor/difusion.html',
  });
  log.info({ campaign: camp.name }, 'difusión: campaña completada');
}

// Recalcula contadores desde los targets (fuente de verdad)
export async function syncCounts(campaignId) {
  const [{ count: sent }, { count: failed }, { count: skipped }] = await Promise.all([
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['sent', 'enviado']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['failed', 'fallido']),
    db.from('jjp_wa_campaign_targets').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['skipped', 'omitido']),
  ]);
  await db.from('jjp_wa_campaigns')
    .update({ sent_count: sent || 0, failed_count: failed || 0, skipped_count: skipped || 0, updated_at: new Date().toISOString() })
    .eq('id', campaignId);
}

// El frontend no puede tocar targets (RLS): al cancelar una campaña,
// aquí se liberan sus pendientes como 'skipped'
async function releaseCancelled() {
  const { data: cancelled } = await db.from('jjp_wa_campaigns')
    .select('id').eq('status', 'cancelada')
    .gte('updated_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    .limit(20);
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
  const { data } = await dbCore.from('jjp_settings').select('value').eq('key', 'wa_daily_limit').maybeSingle();
  const n = parseInt(data?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

