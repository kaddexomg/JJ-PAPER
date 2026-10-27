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
  // Barrido ágil cada 5 segundos para un flujo continuo de correos sin congelamientos
  setInterval(() => sweep().catch(e => log.error({ err: e.message }, 'email-campaign sweep falló')), 5_000);
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


function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatBodyToCorporateHtml(text) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let currentParagraph = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 14px 0;line-height:1.65;font-size:14.5px;color:#1e293b;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      continue;
    }

    // Bullet point / oferta de insumo
    if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 14px 0;line-height:1.65;font-size:14.5px;color:#1e293b;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      let content = trimmed.replace(/^[•\-*]\s*/, '');
      // Reemplazar negritas *...* por <strong>...</strong>
      content = content.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
      blocks.push(
        '<div style="margin:6px 0 8px;padding:10px 14px;background:#f0fdf4;border-left:3px solid #16604A;border-radius:6px;font-size:13.5px;color:#1e293b;line-height:1.5;">' +
          content +
        '</div>'
      );
      continue;
    }

    // Título de sección destacado
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length < 80) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 14px 0;line-height:1.65;font-size:14.5px;color:#1e293b;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      const title = trimmed.slice(1, -1);
      blocks.push('<div style="font-size:14px;font-weight:700;color:#16604A;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.5px;">' + title + '</div>');
      continue;
    }

    let formatted = trimmed.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
    currentParagraph.push(formatted);
  }

  if (currentParagraph.length) {
    blocks.push('<p style="margin:0 0 14px 0;line-height:1.65;font-size:14.5px;color:#1e293b;">' + currentParagraph.join('<br>') + '</p>');
  }

  return blocks.join('');
}

export function renderCorporateEmailHtml({ subject, body, toAddr, sellerName, sellerPhone, imgUrl }) {
  const bodyHtml = formatBodyToCorporateHtml(body);
  if (!bodyHtml || bodyHtml.trim().length < 15) {
    throw new Error('renderCorporateEmailHtml: el cuerpo formateado no puede estar vacío');
  }
  const sName = sellerName || 'Keyder Salazar';
  const sPhone = sellerPhone || '0412-4676073 / 0212-7531777';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:24px 10px;">
    <tr>
      <td align="center">
        <!-- Contenedor Principal (Tarjeta Corporativa) -->
        <table role="presentation" width="100%" style="max-width:620px;background-color:#ffffff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.05);text-align:left;">
          <!-- Banner Superior Corporativo con Logo y RIF -->
          <tr>
            <td style="background:linear-gradient(135deg, #16604A 0%, #0d4433 100%);padding:22px 28px;border-bottom:3px solid #A7D7A0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="64" valign="middle">
                    <img src="https://jjpaper.pages.dev/assets/img/logo.svg" alt="JJ Paper" width="56" height="56" style="display:block;border-radius:50%;border:2px solid #A7D7A0;background:#16604A;">
                  </td>
                  <td valign="middle" style="padding-left:14px;">
                    <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1px;line-height:1.1;font-family:'Playfair Display',Georgia,serif;">
                      JJ PAPER <span style="font-size:14px;font-weight:400;color:#A7D7A0;letter-spacing:0.5px;">C.A.</span>
                    </div>
                    <div style="font-size:12px;color:#d1fae5;margin-top:4px;letter-spacing:0.3px;">
                      RIF: <strong>J-29537545-0</strong> · Importador &amp; Distribuidor Mayorista Directo
                    </div>
                    <div style="font-size:11px;color:#a7f3d0;margin-top:2px;">
                      📍 Caracas, Venezuela · Despacho Corporativo en 24h
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Asunto Formal -->
          ${subject ? `
          <tr>
            <td style="background:#f8fafc;padding:12px 28px;border-bottom:1px solid #e2e8f0;font-size:12.5px;font-weight:700;color:#16604A;">
              📄 ${escapeHtml(subject)}
            </td>
          </tr>` : ''}

          <!-- Flyer o Imagen Adjunta (si existe) -->
          ${imgUrl ? `
          <tr>
            <td style="padding:20px 28px 0;text-align:center;">
              <img src="${imgUrl}" alt="Catálogo / Oferta Comercial" style="max-width:100%;height:auto;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 3px 8px rgba(0,0,0,0.06);">
            </td>
          </tr>` : ''}

          <!-- Cuerpo del Mensaje -->
          <tr>
            <td style="padding:26px 28px 20px;font-size:14.5px;color:#1e293b;line-height:1.65;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Cuadro de Ventajas de la Empresa -->
          <tr>
            <td style="padding:0 28px 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
                <tr>
                  <td>
                    <div style="font-size:12px;font-weight:700;color:#16604A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">
                      ⭐ Respaldo &amp; Garantía JJ Paper C.A.
                    </div>
                    <div style="font-size:12px;color:#475569;line-height:1.5;">
                      • <strong>Facturación Fiscal Formal SENIAT</strong> en bolívares calculada a Tasa Oficial BCV.<br>
                      • <strong>Despacho Directo en 24 Horas</strong> directamente en su sede en Caracas.<br>
                      • <strong>Servicio de Procura Especial:</strong> si requiere algún insumo, medida o marca fuera de lista, se lo ubicamos y cotizamos de inmediato.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botón de Acción a Catálogo -->
          <tr>
            <td style="padding:0 28px 26px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:8px;background:#16604A;text-align:center;">
                    <a href="https://jjpaper.pages.dev/catalogo" target="_blank" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">
                      🌐 Ver Catálogo Digital Completo (+2.000 Productos)
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Huella de la Empresa: Firma Corporativa Formal -->
          <tr>
            <td style="background:#f8fafc;padding:22px 28px;border-top:1px solid #e2e8f0;border-bottom-left-radius:14px;border-bottom-right-radius:14px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="top">
                    <div style="font-size:14px;font-weight:700;color:#0f172a;">
                      ${escapeHtml(sName)}
                    </div>
                    <div style="font-size:12px;color:#475569;margin-top:2px;">
                      Dirección Comercial &amp; Ventas Mayoristas · <strong>JJ Paper C.A.</strong>
                    </div>
                    <div style="font-size:12px;color:#16604A;font-weight:600;margin-top:4px;">
                      📱 WhatsApp / Celular: ${escapeHtml(sPhone)}
                    </div>
                    <div style="font-size:11.5px;color:#64748b;margin-top:2px;">
                      🏢 Central: +58 412 2830185 / 0212 7531777 · <strong>RIF: J-29537545-0</strong>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:14px;font-size:10px;color:#94a3b8;line-height:1.4;border-top:1px solid #e2e8f0;margin-top:12px;">
                    Mensaje comercial B2B remitido por JJ Paper C.A. para presentar oportunidades de abastecimiento corporativo directo. Para no recibir más comunicaciones, responda con la palabra 'Baja'.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

      // Limpieza de saludos robóticos generados por scraping de bases de datos
      let cleanBody = body;
      const compName = realVars.empresa || t.name || '';
      if (cleanBody && /Hola\s+(?:Correo\s+directo|Administraci[oó]n\s+General|Atenci[oó]n\s+al\s+Cliente|Departamento|Contacto|Ventas|Compras)/i.test(cleanBody)) {
        cleanBody = cleanBody.replace(
          /^Hola\s+(?:Correo\s+directo|Administraci[oó]n\s+General|Atenci[oó]n\s+al\s+Cliente|Departamento|Contacto|Ventas|Compras)[^,\n]*[,\s]*(?:👋)?/im,
          `Estimado equipo de ${compName}:`
        );
      }

      // Eliminar únicamente firmas finales redundantes al pie (ej. "\n\nAtentamente,\nKeyder...")
      // para evitar duplicidad con la tarjeta corporativa oficial al pie
      cleanBody = cleanBody.replace(/(?:\r?\n)+\s*(?:Atentamente|Cordialmente|Quedo a su orden|Quedamos a su orden|Saludos cordiales)\s*,?[\s\S]*$/i, '').trim();

      // PROTECCIÓN CRÍTICA: NUNCA permitir que cleanBody quede vacío o excesivamente corto
      if (!cleanBody || cleanBody.trim().length < 40) {
        cleanBody = (body || '').trim();
      }

      if (!cleanBody || cleanBody.length < 20) {
        throw new Error(`Cuerpo de correo vacío para destinatario ${toAddr}. Abortando preventivamente.`);
      }

      // Filtrar el viejo PDF tabular de 50 páginas si está presente para no saturar bandejas
      const activeAttachments = (camp.attachments || []).filter(a => {
        const name = String(a?.name || a?.filename || a?.path || '').toLowerCase();
        return !name.includes('catalogo_y_lista_de_precios_jj_paper');
      });

      const imgAtt = (activeAttachments || []).find(a => 
        (a.mime && a.mime.startsWith('image/')) || 
        (a.contentType && a.contentType.startsWith('image/')) || 
        (a.path && a.path.includes('/campaigns/'))
      );
      const STORAGE_BASE = `${process.env.SUPABASE_URL_CORE || "https://166-0-112-247.sslip.io"}/storage/v1/object/public/`;
      const imgUrl = imgAtt?.path ? (imgAtt.path.startsWith('http') ? imgAtt.path : `${STORAGE_BASE}${imgAtt.bucket || 'jjp-email-media'}/${imgAtt.path}`) : '';
      
      const sName = (camp.seller_name || realVars.vendedor || 'Keyder Salazar');
      const sPhone = (camp.seller_phone || '0412-4676073');

      // Siempre renderizar con la huella corporativa completa: Logo oficial, RIF J-29537545-0, diseño de tabla y firma formal
      let html = renderCorporateEmailHtml({
        subject,
        body: cleanBody,
        toAddr,
        sellerName: sName,
        sellerPhone: sPhone,
        imgUrl
      });

      const { id: msgId, from } = await sendEmailNow(camp.owner_id, {
        to_addr: toAddr, subject, body: cleanBody, html, attachments: activeAttachments
      });

      // Historial en jjp_emails (aparece en "Enviados"). 
      // Mantiene la BD liviana: NUNCA copia payloads base64 gigantes a cada fila.
      const safeAttachments = (camp.attachments || []).map(a => {
        if (!a) return a;
        const { data, base64, content, ...clean } = a;
        return clean;
      });

      const emPayload = {
        owner_id: camp.owner_id, direction: 'out', status: 'sent',
        to_addr: toAddr, from_addr: from, subject, body: cleanBody, html,
        attachments: safeAttachments, customer_id: t.customer_id || null,
        gmail_id: msgId, campaign_id: camp.id
      };
      let { data: em, error: emErr } = await db.from('jjp_emails').insert(emPayload).select('id').single();
      if (emErr && emErr.message && emErr.message.includes('customer_id')) {
        delete emPayload.customer_id;
        const retry = await db.from('jjp_emails').insert(emPayload).select('id').single();
        em = retry.data;
      }

      await db.from('jjp_email_campaign_targets')
        .update({ status: 'sent', email_id: em?.id || null, sent_at: new Date().toISOString(), error: null })
        .eq('id', t.id);
      if (t.customer_id) await dbCore.from('jjp_customers').update({ last_email_at: new Date().toISOString() }).eq('id', t.customer_id);
      const prospectId = t.vars?.prospect_id || (!t.customer_id && t.vars?.b2b_id) || null;
      if (prospectId) {
        try {
          await dbCore.from('jjp_prospects').update({
            contacted: true,
            status: 'contactado_email',
            last_contact_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', prospectId);
        } catch (_) {}
      }
      await syncCounts(camp.id);

      // Ritmo de correo electrónico: 3 a 7 segundos entre envíos para fluidez y total seguridad con cuota Google
      const minD = Math.max(3, camp.delay_min_s ? Math.min(camp.delay_min_s, 6) : 3);
      const maxD = Math.max(minD, camp.delay_max_s ? Math.min(camp.delay_max_s, 10) : 7);
      const delayMs = 1000 * (minD + Math.random() * (maxD - minD));
      nextSendAt.set(camp.owner_id, Date.now() + delayMs);
      log.info({ campaign: camp.name, to: t.to_addr, nextInS: Math.round(delayMs / 1000) }, 'campaña correo: enviado');
    } catch (e) {
      if (e.message && e.message.toLowerCase().includes('limit for sending mail')) {
         await db.from('jjp_email_campaigns').update({ status: 'paused', pause_reason: 'Límite de Gmail alcanzado' }).eq('id', camp.id);
         log.warn({ campaign: camp.name, target: t.id }, 'Campaña auto-pausada por límite de envío');
      }
      await db.from('jjp_email_campaign_targets').update({ status: 'failed', error: e.message }).eq('id', t.id);
      await syncCounts(camp.id);
      log.warn({ campaign: camp.name, target: t.id, err: e.message }, 'campaña correo: target falló');
      
      const errMsg = String(e.message || '').toLowerCase();
      if (errMsg.includes('recipient address rejected') || errMsg.includes('550') || errMsg.includes('user unknown') || errMsg.includes('mailbox not found') || errMsg.includes('does not exist')) {
        try {
          await dbCore.from('jjp_email_suppression_list').upsert({
            email: toAddr.toLowerCase(),
            reason: e.message.slice(0, 300),
            bounce_type: 'hard',
            source: 'smtp_error',
            created_at: new Date().toISOString()
          }, { onConflict: 'email' });
          await Promise.allSettled([
            dbCore.from('jjp_customers').update({
              email_status: 'bounced_hard',
              bounce_reason: e.message.slice(0, 200),
              bounced_at: new Date().toISOString()
            }).ilike('email', toAddr),
            dbCore.from('jjp_prospects').update({
              email_status: 'bounced_hard',
              bounce_reason: e.message.slice(0, 200),
              bounced_at: new Date().toISOString()
            }).ilike('email', toAddr)
          ]);
        } catch (_) {}
      }

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
