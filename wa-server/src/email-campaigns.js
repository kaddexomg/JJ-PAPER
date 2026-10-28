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
  let sanitized = String(text);

  // Sanitización de bloques legacy "Ventajas de operar..." y viñetas repetitivas ya provistas en la plantilla
  sanitized = sanitized.replace(/Ventajas(?:\s+de\s+operar|\s+directas)?\s+con\s+JJ\s+Paper:?[\s\S]*?(?=\n\n\s*¿|\n\s*¿|¿Desea|¿Cuáles|¿Qué|¿Podríamos|¿Con\s+quién|Atentamente|Cordialmente|Saludos|$)/gi, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Adjuntamos\s+nuestro\s+catálogo\s+oficial\s+en\s+PDF[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Servicio\s+de\s+Procura\s+Especial:[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Facturación\s+fiscal\s+formal\s+SENIAT[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Importador\s+directo:[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Despacho\s+propio[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Precios\s+de\s+importador[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Disponibilidad\s+inmediata\s+en\s+nuestro\s+almacén[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Precios\s+transparentes[^\n]*/gim, '');
  sanitized = sanitized.replace(/^[•\-*▪]\s*Despacho\s+puntual[^\n]*/gim, '');
  sanitized = sanitized.replace(/👉\s*(?:Puede\s+consultar|Revise)[^\n]*\n?\{\{link\}\}/gim, '');
  sanitized = sanitized.replace(/(?:^|\n)\s*https?:\/\/jjpaper\.pages\.dev[^\s]*/gim, '');
  sanitized = sanitized.replace(/(?:\r?\n)+\s*(?:Atentamente|Cordialmente|Quedo a su orden|Quedamos a su orden|Saludos cordiales)\s*,?[\s\S]*$/i, '').trim();

  const lines = sanitized.split(/\r?\n/);
  const blocks = [];
  let currentParagraph = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      continue;
    }

    // Viñeta / Bloque de Solución o Insumo
    if (trimmed.startsWith('•') || trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('▪')) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      let content = trimmed.replace(/^[•\-*▪]\s*/, '');
      content = content.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
      content = content.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
      blocks.push(
        '<div style="margin:8px 0 10px;padding:12px 16px;background-color:#f8fafc;border:1px solid #e2e8f0;border-left:3.5px solid #16604A;border-radius:8px;font-size:14.5px;color:#1e293b;line-height:1.65;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>' +
            '<td width="20" valign="top" style="color:#16604A;font-weight:bold;font-size:15px;padding-right:8px;line-height:1.4;">✔</td>' +
            '<td valign="top" style="font-size:14px;color:#1e293b;line-height:1.65;">' + content + '</td>' +
          '</tr></table>' +
        '</div>'
      );
      continue;
    }

    // Título de sección destacado
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length < 80) {
      if (currentParagraph.length) {
        blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
        currentParagraph = [];
      }
      const title = trimmed.slice(1, -1);
      blocks.push('<div style="font-size:12.5px;font-weight:700;color:#16604A;margin:24px 0 10px;text-transform:uppercase;letter-spacing:0.8px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + title + '</div>');
      continue;
    }

    let formatted = trimmed
      .replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
    currentParagraph.push(formatted);
  }

  if (currentParagraph.length) {
    blocks.push('<p style="margin:0 0 16px 0;line-height:1.75;font-size:15px;color:#1e293b;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' + currentParagraph.join('<br>') + '</p>');
  }

  return blocks.join('');
}

export function renderCorporateEmailHtml({ subject, body, toAddr, sellerName, sellerPhone, imgUrl, companyName, suggestedProducts }) {
  let bodyHtml = formatBodyToCorporateHtml(body);
  if (!bodyHtml || bodyHtml.trim().length < 15) {
    throw new Error('renderCorporateEmailHtml: el cuerpo formateado no puede estar vacío');
  }

  // BLINDAJE ESTRUCTURAL: Si el cuerpo generado por la IA no trajo viñetas de productos (cajitas border-left),
  // se construyen e inyectan automáticamente las cajitas de soluciones clave recomendadas para que NUNCA salga texto plano.
  if (!bodyHtml.includes('border-left:3.5px solid #16604A') && !bodyHtml.includes('border-left:3px solid #16604A')) {
    const rawItems = suggestedProducts || [
      'Carpetas de fibra marrón con gancho y carpetas 3 aros para custodia y organización reglamentaria de expedientes e historiales.',
      'Fundas plásticas transparentes carta y oficio para protección de minutas, órdenes y documentos de trabajo continuo.',
      'Resmas Bond Carta y Oficio (HP / Report / Printon 75g de alta blancura) para facturación SENIAT e informes sin atascos.',
      'Bolígrafos por caja y marcadores especializados para dotación de oficinas y rotulación operativa.'
    ];
    let itemsList = [];
    if (typeof rawItems === 'string') {
      itemsList = rawItems.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(rawItems)) {
      itemsList = rawItems;
    }

    if (itemsList.length > 0) {
      const boxesHtml = itemsList.slice(0, 4).map(it => {
        let content = String(it).replace(/^[•\-*▪]\s*/, '');
        content = content.replace(/\*([^*]+)\*/g, '<strong style="color:#0f172a;">$1</strong>');
        content = content.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#16604A;font-weight:600;text-decoration:underline;">$1</a>');
        return (
          '<div style="margin:8px 0 10px;padding:12px 16px;background-color:#f8fafc;border:1px solid #e2e8f0;border-left:3.5px solid #16604A;border-radius:8px;font-size:14.5px;color:#1e293b;line-height:1.65;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
            '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>' +
              '<td width="20" valign="top" style="color:#16604A;font-weight:bold;font-size:15px;padding-right:8px;line-height:1.4;">✔</td>' +
              '<td valign="top" style="font-size:14px;color:#1e293b;line-height:1.65;">' + content + '</td>' +
            '</tr></table>' +
          '</div>'
        );
      }).join('');

      bodyHtml += (
        '<div style="margin:22px 0 14px;">' +
          '<div style="font-size:12.5px;font-weight:700;color:#16604A;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.7px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
            '📦 Soluciones e Insumos Clave para su Sede:' +
          '</div>' +
          boxesHtml +
        '</div>'
      );
    }
  }

  const sName = sellerName || 'Keyder Salazar';
  const sPhone = sellerPhone || '0412-4676073 / 0212-7531777';

  // Iniciales del asesor para el monograma ejecutivo
  const nameParts = sName.trim().split(/\s+/);
  const initials = (nameParts.length > 1
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0])
    : nameParts[0].slice(0, 2)).toUpperCase();

  // Limpiar teléfono para WhatsApp directo y garantizar formato internacional E.164
  const rawPhone = String(sellerPhone || '0412-4676073');
  const cleanPhoneDigits = (rawPhone.split('/')[0] || rawPhone).replace(/\D/g, '');
  let waNumber = cleanPhoneDigits;
  if (waNumber.startsWith('0')) {
    waNumber = '58' + waNumber.slice(1);
  } else if (!waNumber.startsWith('58')) {
    waNumber = '58' + waNumber;
  }
  if (waNumber.length < 10) waNumber = '584124676073';

  // Mensaje inteligente hiper-personalizado para WhatsApp
  const cleanCompName = String(companyName || '').trim();
  const waCustomMessage = cleanCompName
    ? `Hola ${sName}, le escribo de parte de ${cleanCompName} para solicitar la cotización formal de los insumos corporativos.`
    : `Hola ${sName}, me comunico con JJ Paper para solicitar una cotización formal.`;

  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @keyframes jjp-pulse {
      0% { box-shadow: 0 4px 14px rgba(22, 96, 74, 0.25); }
      50% { box-shadow: 0 6px 22px rgba(22, 96, 74, 0.50); }
      100% { box-shadow: 0 4px 14px rgba(22, 96, 74, 0.25); }
    }
    .jjp-btn-wa-main {
      display: inline-block !important;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%) !important;
      color: #ffffff !important;
      padding: 13px 26px !important;
      font-size: 14.5px !important;
      font-weight: 700 !important;
      text-decoration: none !important;
      border-radius: 8px !important;
      letter-spacing: 0.3px !important;
      box-shadow: 0 4px 14px rgba(37, 211, 102, 0.35) !important;
      transition: all 0.25s ease-in-out !important;
      animation: jjp-pulse 3s infinite ease-in-out !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      text-align: center !important;
    }
    .jjp-btn-wa-main:hover {
      background: linear-gradient(135deg, #1ea952 0%, #0e7064 100%) !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 8px 22px rgba(37, 211, 102, 0.5) !important;
    }
    .jjp-btn-cta {
      display: inline-block !important;
      background: linear-gradient(135deg, #16604A 0%, #1e7a5e 100%) !important;
      color: #ffffff !important;
      padding: 13px 26px !important;
      font-size: 14.5px !important;
      font-weight: 700 !important;
      text-decoration: none !important;
      border-radius: 8px !important;
      letter-spacing: 0.3px !important;
      box-shadow: 0 4px 14px rgba(22, 96, 74, 0.3) !important;
      transition: all 0.25s ease-in-out !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      text-align: center !important;
    }
    .jjp-btn-cta:hover {
      background: linear-gradient(135deg, #0f4b39 0%, #16604A 100%) !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 8px 24px rgba(22, 96, 74, 0.5) !important;
    }
    .jjp-btn-wa:hover {
      text-decoration: underline !important;
      color: #0f4b39 !important;
    }
    @media only screen and (max-width: 620px) {
      .jjp-container { width: 100% !important; }
      .jjp-card-body { padding: 22px 18px !important; }
      .jjp-header-cell { padding: 20px 18px !important; }
      .jjp-footer-cell { padding: 20px 18px !important; }
      .jjp-cta-cell { display: block !important; width: 100% !important; padding: 6px 0 !important; }
      .jjp-btn-cta, .jjp-btn-wa-main { width: 100% !important; padding: 14px 18px !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.75;-webkit-font-smoothing:antialiased;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;padding:32px 12px;">
    <tr>
      <td align="center">
        <!-- Tarjeta Ejecutiva Principal (680px) -->
        <table role="presentation" class="jjp-container" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.05),0 8px 10px -6px rgba(0,0,0,0.01);text-align:left;">
          <!-- Barra Superior Corporativa en Degradé Institucional -->
          <tr>
            <td style="height:5px;background:linear-gradient(90deg, #16604A 0%, #208b6b 50%, #A7D7A0 100%);background-color:#16604A;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Cabecera Institucional con Logo en Alta Definición y RIF Oficial -->
          <tr>
            <td class="jjp-header-cell" style="background-color:#ffffff;padding:26px 32px 22px 32px;border-bottom:2px solid #16604A;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="60" valign="middle" style="padding-right:16px;">
                    <a href="https://jjpaper.pages.dev" target="_blank" style="text-decoration:none;display:inline-block;">
                      <img src="https://jjpaper.pages.dev/assets/img/logo.svg" alt="JJ Paper C.A." width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;">
                    </a>
                  </td>
                  <td valign="middle" align="left">
                    <div style="font-size:21px;font-weight:800;color:#0f172a;letter-spacing:0.5px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      JJ PAPER <span style="font-size:14px;font-weight:700;color:#16604A;">C.A.</span>
                    </div>
                    <div style="font-size:12.5px;color:#64748b;margin-top:4px;font-weight:500;line-height:1.4;">
                      RIF: <strong style="color:#0f172a;">J-29537545-0</strong> · Importador &amp; Distribuidor Mayorista Directo
                    </div>
                    <div style="margin-top:5px;">
                      <span style="display:inline-block;padding:2px 8px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:11px;color:#16604A;font-weight:600;">
                        📍 Caracas, Venezuela · Despacho Corporativo en 24h
                      </span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Asunto Formal / Cintillo de Comunicación B2B -->
          ${subject ? `
          <tr>
            <td style="background-color:#f8fafc;padding:12px 32px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#334155;">
              <span style="color:#16604A;margin-right:6px;">📋</span> Ref: ${escapeHtml(subject)}
            </td>
          </tr>` : ''}

          <!-- Flyer o Imagen Adjunta (si aplica) -->
          ${imgUrl ? `
          <tr>
            <td style="padding:24px 32px 0 32px;text-align:center;">
              <img src="${imgUrl}" alt="Catálogo Comercial" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.05);display:block;margin:0 auto;">
            </td>
          </tr>` : ''}

          <!-- Cuerpo del Mensaje -->
          <tr>
            <td class="jjp-card-body" style="padding:28px 32px 20px 32px;font-size:15px;color:#1e293b;line-height:1.75;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Cuadro Institucional de Respaldo & Garantía Operativa JJ Paper -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #16604A;border-radius:8px;padding:18px 20px;">
                <tr>
                  <td>
                    <div style="font-size:12.5px;font-weight:700;color:#16604A;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">
                      🛡️ Respaldo &amp; Garantía Operativa JJ Paper C.A.
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:13.5px;color:#334155;line-height:1.65;">
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Facturación Fiscal Formal SENIAT:</strong> Emitida legalmente en bolívares calculada a Tasa Oficial BCV del día.
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Despacho Directo en 24 Horas:</strong> Flota propia con entrega ágil y puntual en su sede (Caracas y La Guaira).
                        </td>
                      </tr>
                      <tr>
                        <td valign="top" style="padding:3px 0;">
                          <span style="color:#16604A;font-weight:bold;margin-right:6px;">✔</span> <strong>Servicio de Procura Especial:</strong> Si requiere algún insumo, medida o formato fuera de lista, se lo ubicamos y cotizamos de inmediato.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Botones de Acción Principal (Dual CTA: WhatsApp Directo + Catálogo Digital) -->
          <tr>
            <td style="padding:0 32px 28px 32px;text-align:center;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;max-width:100%;">
                <tr>
                  <td align="center" class="jjp-cta-cell" style="padding:4px 6px;">
                    <a href="https://wa.me/${waNumber}?text=${encodeURIComponent(waCustomMessage)}" target="_blank" class="jjp-btn-wa-main">
                      💬 Solicitar Cotización por WhatsApp ↗
                    </a>
                  </td>
                  <td align="center" class="jjp-cta-cell" style="padding:4px 6px;">
                    <a href="https://jjpaper.pages.dev/catalogo" target="_blank" class="jjp-btn-cta">
                      🌐 Ver Catálogo Digital (+2.400) ↗
                    </a>
                  </td>
                </tr>
              </table>
              <div style="margin-top:14px;font-size:12.5px;color:#64748b;line-height:1.5;">
                ¿Desea atención directa con su asesor? 
                <a href="https://wa.me/${waNumber}?text=${encodeURIComponent(waCustomMessage)}" target="_blank" class="jjp-btn-wa" style="color:#16604A;font-weight:700;text-decoration:underline;">Escríbanos directamente a WhatsApp (${escapeHtml(sPhone.split('/')[0].trim())})</a>
              </div>
            </td>
          </tr>

          <!-- Firma Corporativa y Pie Institucional B2B -->
          <tr>
            <td class="jjp-footer-cell" style="background-color:#f8fafc;padding:24px 32px;border-top:1px solid #e2e8f0;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="48" valign="top" style="padding-right:14px;">
                    <div style="width:44px;height:44px;border-radius:50%;background-color:#16604A;color:#ffffff;font-weight:800;font-size:16px;text-align:center;line-height:44px;letter-spacing:0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      ${initials}
                    </div>
                  </td>
                  <td valign="top" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.2;">
                      ${escapeHtml(sName)}
                    </div>
                    <div style="font-size:13px;color:#64748b;margin-top:2px;">
                      Dirección Comercial &amp; Cuentas Corporativas · <strong>JJ Paper C.A.</strong>
                    </div>
                    <div style="font-size:13px;color:#16604A;font-weight:600;margin-top:6px;">
                      📱 WhatsApp / Celular: <a href="https://wa.me/${waNumber}" target="_blank" style="color:#16604A;text-decoration:none;font-weight:600;">${escapeHtml(sPhone)}</a>
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:3px;">
                      🏢 Central Corporativa: +58 412 2830185 / 0212 7531777 · <strong>RIF: J-29537545-0</strong>
                    </div>
                    <div style="font-size:12px;color:#64748b;margin-top:2px;">
                      📍 Caracas, Venezuela · Despacho y Distribución Mayorista Directa
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:16px;border-top:1px solid #e2e8f0;margin-top:14px;font-size:11px;color:#94a3b8;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    Este mensaje institucional B2B ha sido remitido por JJ Paper C.A. exclusivamente para presentar oportunidades de suministro corporativo directo. Si no desea recibir más comunicaciones, responda con la palabra 'Baja' y su dirección será excluida de inmediato.
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
    const prospectId = t.vars?.prospect_id || (!t.customer_id && t.vars?.b2b_id) || null;
    let prospectRecord = null;
    if (prospectId) {
      try {
        const { data: pData } = await dbCore.from('jjp_prospects')
          .select('*')
          .eq('id', prospectId)
          .maybeSingle();
        prospectRecord = pData;
      } catch (_) {}
    }

    let customerRecord = null;
    if (t.customer_id) {
      try {
        const { data: cData } = await dbCore.from('jjp_customers')
          .select('*')
          .eq('id', t.customer_id)
          .maybeSingle();
        customerRecord = cData;
      } catch (_) {}
    }

    // Respetar opt-out del cliente aunque cambie después de crear la campaña
    if (customerRecord?.email_opt_out) {
      await skip(camp, t, 'cliente sin correos (opt-out)');
      continue;
    }

    // 1. Extraer todas las direcciones de correo candidatas en orden de prioridad
    const candidateEmails = getCandidateEmails(t, prospectRecord, customerRecord);
    if (!candidateEmails.length) {
      await skip(camp, t, 'correo inválido o ausente');
      continue;
    }

    // 2. Verificar contra lista de supresión (jjp_email_suppression_list)
    let suppressedSet = new Set();
    try {
      const { data: bounceRows } = await dbCore.from('jjp_email_suppression_list')
        .select('email')
        .in('email', candidateEmails);
      if (bounceRows?.length) {
        for (const r of bounceRows) {
          if (r.email) suppressedSet.add(String(r.email).toLowerCase().trim());
        }
      }
    } catch (supErr) {
      log.warn({ err: supErr.message }, 'error consultando lista de supresión');
    }

    // Filtrar direcciones disponibles que no estén en lista de supresión
    const availableEmails = candidateEmails.filter(em => !suppressedSet.has(em));

    if (!availableEmails.length) {
      log.info({ campaign: camp.name, target: t.id, candidateEmails }, 'todos los correos en lista de supresión');
      await skip(camp, t, 'correo(s) rebotado previamente (lista de supresión)');
      if (prospectId) {
        await safelyUpdateProspectBounce(prospectId, candidateEmails, 'Correos previamente en lista de supresión');
      }
      continue;
    }

    if (candidateEmails[0] !== availableEmails[0]) {
      log.info({
        campaign: camp.name,
        target: t.id,
        suppressedPrimary: candidateEmails[0],
        selectedAlternate: availableEmails[0]
      }, 'cascada multi-correo: correo principal suprimido, conmutando a alternativo');
    }

    await db.from('jjp_email_campaign_targets').update({ status: 'sending' }).eq('id', t.id);

    try {
      const realVars = {
        ...(t.vars || {}),
        nombre: t.name || (t.vars || {}).nombre || prospectRecord?.contact_name || '',
        empresa: (t.vars || {}).empresa || t.name || prospectRecord?.company_name || customerRecord?.name || '',
      };

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

      // Eliminar firmas finales redundantes al pie
      cleanBody = cleanBody.replace(/(?:\r?\n)+\s*(?:Atentamente|Cordialmente|Quedo a su orden|Quedamos a su orden|Saludos cordiales)\s*,?[\s\S]*$/i, '').trim();

      // PROTECCIÓN CRÍTICA: NUNCA permitir que cleanBody quede vacío o excesivamente corto
      if (!cleanBody || cleanBody.trim().length < 40) {
        cleanBody = (body || '').trim();
      }

      if (!cleanBody || cleanBody.length < 20) {
        log.warn({ target: t.id }, 'Cuerpo de correo vacío para destinatario');
        await skip(camp, t, 'cuerpo de correo vacío');
        continue;
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
      
      // Obtener datos del asesor desde jjp_profiles si no vienen en la campaña
      let sellerProf = null;
      if (camp.owner_id) {
        try {
          const { data: prof } = await dbCore.from('jjp_profiles')
            .select('id, full_name, phone')
            .eq('id', camp.owner_id)
            .maybeSingle();
          sellerProf = prof;
        } catch (_) {}
      }

      const sName = (camp.seller_name || sellerProf?.full_name || realVars.vendedor || 'Keyder Salazar');
      const sPhone = (camp.seller_phone || sellerProf?.phone || realVars.telefono || '0412-4676073');

      // 3. Cascada de despacho multi-correo sobre availableEmails
      let sendSuccess = false;
      let lastError = null;
      const attemptedEmails = [];

      for (let i = 0; i < availableEmails.length; i++) {
        const currentEmail = availableEmails[i];
        attemptedEmails.push(currentEmail);

        // Renderizar con la huella corporativa completa para la dirección destino actual
        let html = renderCorporateEmailHtml({
          subject,
          body: cleanBody,
          toAddr: currentEmail,
          sellerName: sName,
          sellerPhone: sPhone,
          imgUrl,
          companyName: compName,
          suggestedProducts: realVars.productos_oferta || realVars.insumos_core
        });

        try {
          const { id: msgId, from } = await sendEmailNow(camp.owner_id, {
            to_addr: currentEmail, subject, body: cleanBody, html, attachments: activeAttachments
          });

          // Historial en jjp_emails (aparece en "Enviados"). 
          const safeAttachments = (camp.attachments || []).map(a => {
            if (!a) return a;
            const { data, base64, content, ...clean } = a;
            return clean;
          });

          const emPayload = {
            owner_id: camp.owner_id, direction: 'out', status: 'sent',
            to_addr: currentEmail, from_addr: from, subject, body: cleanBody, html,
            attachments: safeAttachments, customer_id: t.customer_id || null,
            gmail_id: msgId, campaign_id: camp.id
          };
          let { data: em, error: emErr } = await db.from('jjp_emails').insert(emPayload).select('id').single();
          if (emErr && emErr.message && emErr.message.includes('customer_id')) {
            delete emPayload.customer_id;
            const retry = await db.from('jjp_emails').insert(emPayload).select('id').single();
            em = retry.data;
          }

          const isAlternate = currentEmail !== candidateEmails[0];
          await safelyUpdateTargetSent(t.id, currentEmail, em?.id, isAlternate, candidateEmails[0], t.vars);

          if (t.customer_id) {
            try {
              await dbCore.from('jjp_customers').update({ last_email_at: new Date().toISOString() }).eq('id', t.customer_id);
            } catch (_) {}
          }
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

          // Ritmo de correo: 3 a 7 segundos entre envíos para fluidez y seguridad de cuota Google
          const minD = Math.max(3, camp.delay_min_s ? Math.min(camp.delay_min_s, 6) : 3);
          const maxD = Math.max(minD, camp.delay_max_s ? Math.min(camp.delay_max_s, 10) : 7);
          const delayMs = 1000 * (minD + Math.random() * (maxD - minD));
          nextSendAt.set(camp.owner_id, Date.now() + delayMs);
          log.info({
            campaign: camp.name,
            to: currentEmail,
            alternateUsed: isAlternate,
            attempts: i + 1,
            nextInS: Math.round(delayMs / 1000)
          }, 'campaña correo: enviado con éxito');

          sendSuccess = true;
          break; // Éxito en envío, fin del ciclo de cascada
        } catch (e) {
          lastError = e;
          const errMsg = String(e?.message || '').toLowerCase();

          // Si es límite de cuota Gmail, pausar campaña y abortar cascada
          if (errMsg.includes('limit for sending mail') || errMsg.includes('daily user sending quota')) {
            try {
              await db.from('jjp_email_campaigns').update({
                status: 'paused',
                pause_reason: 'Límite de Gmail alcanzado'
              }).eq('id', camp.id);
            } catch (_) {}
            log.warn({ campaign: camp.name, target: t.id }, 'Campaña auto-pausada por límite de envío');
            break;
          }

          // Si es rebote definitivo
          if (isHardBounceError(e)) {
            log.warn({
              campaign: camp.name,
              target: t.id,
              email: currentEmail,
              err: e.message
            }, 'rebote definitivo detectado en dirección de correo');

            // 1. Agregar a lista de supresión
            await safelyAddToSuppressionList(currentEmail, e.message);

            // 2. Marcar rebote en clientes y prospectos
            await safelyMarkEmailBouncedAcrossEntities(currentEmail, e.message);

            // 3. Si quedan más correos alternativos en availableEmails:
            const hasMoreAlternates = i < availableEmails.length - 1;
            if (hasMoreAlternates) {
              log.info({
                campaign: camp.name,
                target: t.id,
                failedEmail: currentEmail,
                nextEmail: availableEmails[i + 1]
              }, 'cascada multi-correo: reintentando con correo alternativo no probado');
              await new Promise(r => setTimeout(r, 800));
              continue;
            }
          }

          // Si no es un error de rebote definitivo o ya no quedan más alternativos, terminar cascada
          break;
        }
      }

      if (!sendSuccess) {
        const errMsg = lastError?.message || 'Error en envío';
        await safelyUpdateTargetFailed(t.id, errMsg);
        await syncCounts(camp.id);
        log.warn({ campaign: camp.name, target: t.id, attempted: attemptedEmails, err: errMsg }, 'campaña correo: target falló tras cascada');

        if (isHardBounceError(lastError) || attemptedEmails.length > 0) {
          if (prospectId) {
            await safelyUpdateProspectBounce(prospectId, attemptedEmails, errMsg);
          }
        }

        // Si es fallo de credenciales o error general, pausa de 30s para no saturar
        nextSendAt.set(camp.owner_id, Date.now() + 30_000);
      }
    } catch (unexpectedErr) {
      log.error({ err: unexpectedErr.message, target: t.id }, 'error inesperado en step()');
      await safelyUpdateTargetFailed(t.id, unexpectedErr.message);
      await syncCounts(camp.id);
      nextSendAt.set(camp.owner_id, Date.now() + 30_000);
    }
    
    break; // solo 1 envío real por tick
  }
}

// -----------------------------------------------------------------------------
// HELPERS PARA CASCADA MULTI-CORREO Y TOLERANCIA DEFENSIVA
// -----------------------------------------------------------------------------

/**
 * Extrae todas las direcciones de correo válidas desde cadenas, arrays u objetos.
 */
function extractEmailsFromValue(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.flatMap(v => extractEmailsFromValue(v));
  }
  if (typeof val === 'object') {
    return Object.values(val).flatMap(v => extractEmailsFromValue(v));
  }
  const s = String(val);
  const matches = s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  if (!matches) return [];
  return matches.map(e => e.trim().toLowerCase());
}

/**
 * Reúne todas las direcciones candidatas en orden de prioridad sin duplicados:
 * 1. to_addr / email del target (soporta comas, barras, etc.)
 * 2. alternate_emails en vars del target
 * 3. email_2, email2, email_secundario del prospecto
 * 4. correos del cliente
 */
function getCandidateEmails(target, prospectData, customerData) {
  const rawSources = [
    target?.to_addr,
    target?.email,
    target?.vars?.alternate_emails,
    target?.vars?.alternate_email,
    target?.vars?.emails,
    target?.vars?.email2,
    target?.vars?.email_2,
    target?.vars?.email_secundario,
    target?.vars?.correo_secundario,
    prospectData?.email,
    prospectData?.email_2,
    prospectData?.email2,
    prospectData?.email_secundario,
    prospectData?.alternate_emails,
    customerData?.email,
    customerData?.email_2,
    customerData?.email2
  ];

  const seen = new Set();
  const list = [];
  for (const src of rawSources) {
    const emails = extractEmailsFromValue(src);
    for (const em of emails) {
      if (!seen.has(em)) {
        seen.add(em);
        list.push(em);
      }
    }
  }
  return list;
}

/**
 * Determina si el error devuelto por SMTP o Gmail corresponde a un rebote definitivo (Hard Bounce).
 */
function isHardBounceError(err) {
  if (!err) return false;
  const msg = String(err?.message || err).toLowerCase();

  // Exclusiones: No confundir límites de cuenta o problemas de conexión locales con rebotes
  if (
    msg.includes('limit for sending mail') ||
    msg.includes('daily user sending quota') ||
    msg.includes('quota exceeded') ||
    msg.includes('sin correo vinculado') ||
    msg.includes('token has been expired') ||
    msg.includes('invalid_grant') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout')
  ) {
    return false;
  }

  const bouncePatterns = [
    'recipient address rejected',
    '550',
    '551',
    '552',
    '553',
    '554',
    'mailbox not found',
    'mailbox unavailable',
    'user unknown',
    'does not exist',
    'unrouteable',
    'unroutable',
    'no such user',
    'invalid recipient',
    'address rejected',
    'unknown user',
    'account disabled',
    'bad destination mailbox',
    'relay access denied',
    'domain not found',
    'no mailbox by that name',
    'address does not exist',
    'recipient rejected',
    'enotfound'
  ];

  return bouncePatterns.some(p => msg.includes(p));
}

/**
 * Agrega defensivamente una dirección fallida a la lista de supresión.
 */
async function safelyAddToSuppressionList(email, reason) {
  if (!email) return;
  const cleanEmail = email.toLowerCase().trim();
  try {
    await dbCore.from('jjp_email_suppression_list').upsert({
      email: cleanEmail,
      reason: String(reason || 'Rebote definitivo').slice(0, 300),
      bounce_type: 'hard',
      source: 'smtp_error',
      created_at: new Date().toISOString()
    }, { onConflict: 'email' });
  } catch (err) {
    log.warn({ err: err?.message, email: cleanEmail }, 'safelyAddToSuppressionList falló');
  }
}

/**
 * Marca defensivamente el correo como rebotado en jjp_customers y jjp_prospects.
 */
async function safelyMarkEmailBouncedAcrossEntities(email, reason) {
  if (!email) return;
  const cleanEmail = email.toLowerCase().trim();
  const safeReason = String(reason || 'Rebote definitivo').slice(0, 200);
  const now = new Date().toISOString();
  try {
    await Promise.allSettled([
      dbCore.from('jjp_customers').update({
        email_status: 'bounced_hard',
        bounce_reason: safeReason,
        bounced_at: now
      }).ilike('email', cleanEmail),
      dbCore.from('jjp_prospects').update({
        email_status: 'bounced_hard',
        bounce_reason: safeReason,
        bounced_at: now
      }).ilike('email', cleanEmail)
    ]);
  } catch (err) {
    log.warn({ err: err?.message, email: cleanEmail }, 'safelyMarkEmailBouncedAcrossEntities falló');
  }
}

/**
 * Actualiza defensivamente el prospecto a status = 'correo_rebotado',
 * agregando advertencia a las notas para contacto manual telefónico o por WhatsApp.
 */
async function safelyUpdateProspectBounce(prospectId, failedEmails, errorMsg) {
  if (!prospectId) return;
  try {
    let currentNotes = '';
    try {
      const { data: pCur } = await dbCore.from('jjp_prospects')
        .select('notes')
        .eq('id', prospectId)
        .maybeSingle();
      currentNotes = pCur?.notes || '';
    } catch (_) {}

    const dateStr = new Date().toLocaleDateString('es-VE');
    const emailListStr = Array.isArray(failedEmails) ? failedEmails.join(', ') : String(failedEmails || '');
    const bounceNote = `[ALERTA REBOTE CORREO ${dateStr}] Correos rebotados: ${emailListStr}. Error: ${(errorMsg || '').slice(0, 100)}. REQUIERE CONTACTO TELEFÓNICO O POR WHATSAPP.`;

    let newNotes = currentNotes;
    if (!currentNotes.includes(emailListStr)) {
      newNotes = currentNotes ? `${currentNotes}\n${bounceNote}` : bounceNote;
    }

    // Intento 1: Actualización completa con todas las columnas estándar
    const fullPayload = {
      status: 'correo_rebotado',
      email_status: 'bounced_hard',
      bounce_reason: String(errorMsg || 'Rebote definitivo').slice(0, 200),
      bounced_at: new Date().toISOString(),
      notes: newNotes,
      updated_at: new Date().toISOString()
    };

    const { error: fullErr } = await dbCore.from('jjp_prospects')
      .update(fullPayload)
      .eq('id', prospectId);

    if (!fullErr) return;

    log.warn({ err: fullErr.message, prospectId }, 'Fallo actualización completa de prospecto; intentando payload reducido');

    // Intento 2: Sin email_status ni bounce_reason por si difieren en VPS
    const fallbackPayload = {
      status: 'correo_rebotado',
      notes: newNotes,
      updated_at: new Date().toISOString()
    };
    const { error: fbErr } = await dbCore.from('jjp_prospects')
      .update(fallbackPayload)
      .eq('id', prospectId);

    if (!fbErr) return;

    // Intento 3: Solo status
    await dbCore.from('jjp_prospects')
      .update({ status: 'correo_rebotado' })
      .eq('id', prospectId);
  } catch (err) {
    log.warn({ err: err?.message, prospectId }, 'safelyUpdateProspectBounce defensivo capturó excepción');
  }
}

/**
 * Actualiza defensivamente el target cuando el envío resulta exitoso.
 */
async function safelyUpdateTargetSent(targetId, currentEmail, emailId, isAlternate, originalEmail, existingVars) {
  try {
    const payload = {
      status: 'sent',
      to_addr: currentEmail,
      sent_at: new Date().toISOString(),
      error: null
    };
    if (emailId) payload.email_id = emailId;
    if (isAlternate) {
      payload.vars = {
        ...(existingVars || {}),
        delivered_to: currentEmail,
        alternate_used: true,
        original_to_addr: originalEmail
      };
    }
    const { error } = await db.from('jjp_email_campaign_targets').update(payload).eq('id', targetId);
    if (error) {
      log.warn({ err: error.message, targetId }, 'Error actualizando target sent con payload completo; intentando básico');
      await db.from('jjp_email_campaign_targets').update({
        status: 'sent',
        to_addr: currentEmail,
        sent_at: new Date().toISOString()
      }).eq('id', targetId);
    }
  } catch (err) {
    log.warn({ err: err?.message, targetId }, 'safelyUpdateTargetSent defensivo capturó excepción');
  }
}

/**
 * Actualiza defensivamente el target cuando falla el envío.
 */
async function safelyUpdateTargetFailed(targetId, errorMsg) {
  try {
    const safeError = String(errorMsg || 'Error en envío').slice(0, 500);
    const { error } = await db.from('jjp_email_campaign_targets').update({
      status: 'failed',
      error: safeError
    }).eq('id', targetId);
    if (error) {
      log.warn({ err: error.message, targetId }, 'Error actualizando target failed; reintentando sin mensaje de error');
      await db.from('jjp_email_campaign_targets').update({ status: 'failed' }).eq('id', targetId);
    }
  } catch (err) {
    log.warn({ err: err?.message, targetId }, 'safelyUpdateTargetFailed defensivo capturó excepción');
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
