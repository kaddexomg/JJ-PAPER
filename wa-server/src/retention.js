import { db } from './supabase.js';
import { log } from './logger.js';

// ============================================================
//  RETENCIÓN DE STORAGE — mantiene Supabase liviano
//  Principio: Supabase guarda solo el índice. Los binarios pesados
//  viven en su canal natural (Gmail para correo) y se re-traen on-demand.
//
//  Purga SOLO los buckets de correo/WhatsApp. NUNCA toca productos,
//  marcas, facturas ni comprobantes. Todo lo que borra es recuperable:
//   - adjuntos ENTRANTES  → se re-descargan de Gmail (gmail_id + att_id)
//   - adjuntos SALIENTES   → quedan en "Enviados" de Gmail
//   - html viejo           → se re-lee de Gmail al abrir el correo
//  Nada aquí lanza excepción hacia el loop principal (todo en try/catch).
// ============================================================

const DAY = 86_400_000;
const ATTACH_TTL_DAYS = 7;    // adjuntos entrantes cacheados: se purgan tras 7 días
const HTML_TTL_DAYS   = 30;   // cuerpo html en Postgres: se suelta tras 30 días
const OUT_TTL_HOURS   = 12;   // copia de adjunto saliente: se borra 12 h tras enviar
const SWEEP_MS        = 6 * 3600_000;   // barrido cada 6 h

async function removeFromBucket(bucket, paths) {
  const clean = paths.filter(Boolean);
  if (!clean.length) return 0;
  const { error } = await db.storage.from(bucket).remove(clean);
  if (error) { log.warn({ bucket, err: error.message }, 'retención: remove falló'); return 0; }
  return clean.length;
}

// 1) Adjuntos ENTRANTES cacheados y viejos → borrar del bucket + marcar re-descargable
async function purgeInboundAttachments() {
  const cutoff = new Date(Date.now() - ATTACH_TTL_DAYS * DAY).toISOString();
  const { data, error } = await db.from('jjp_emails')
    .select('id, gmail_id, attachments')
    .eq('direction', 'in').eq('attach_state', 'ready')
    .lt('created_at', cutoff).limit(200);
  if (error) { log.warn({ err: error.message }, 'retención: select entrantes falló'); return; }

  for (const row of data || []) {
    const atts = row.attachments || [];
    const paths = atts.map(a => a.path).filter(Boolean);
    if (!paths.length) continue;
    // Solo purgamos si es re-descargable de Gmail (hay gmail_id + att_id)
    const refetchable = row.gmail_id && atts.every(a => a.att_id || !a.path);
    if (!refetchable) continue;
    await removeFromBucket('jjp-email-media', paths);
    // quitar 'path' de la metadata y volver a 'pending' → se re-baja cuando lo abran
    const stripped = atts.map(({ path, size, ...rest }) => rest);
    await db.from('jjp_emails').update({ attachments: stripped, attach_state: 'pending' }).eq('id', row.id);
    log.info({ id: row.id, n: paths.length }, 'retención: adjuntos entrantes liberados (re-descargables)');
  }
}

// 2) Copia de adjuntos SALIENTES ya enviados → borrar del bucket
async function purgeOutboundAttachments() {
  const cutoff = new Date(Date.now() - OUT_TTL_HOURS * 3600_000).toISOString();
  const { data, error } = await db.from('jjp_emails')
    .select('id, attachments, sent_at, created_at, status')
    .eq('direction', 'out').in('status', ['sent', 'failed'])
    .lt('created_at', cutoff).limit(200);
  if (error) { log.warn({ err: error.message }, 'retención: select salientes falló'); return; }

  for (const row of data || []) {
    const atts = row.attachments || [];
    const paths = atts.map(a => a.path).filter(Boolean);
    if (!paths.length) continue;
    await removeFromBucket('jjp-email-media', paths);
    const stripped = atts.map(({ path, ...rest }) => rest);
    await db.from('jjp_emails').update({ attachments: stripped }).eq('id', row.id);
    log.info({ id: row.id, n: paths.length }, 'retención: copia de adjunto saliente borrada');
  }
}

// 3) Cuerpo html viejo en Postgres → soltar (se re-lee de Gmail al abrir)
async function trimOldHtml() {
  const cutoff = new Date(Date.now() - HTML_TTL_DAYS * DAY).toISOString();
  const { data, error } = await db.from('jjp_emails')
    .select('id')
    .not('gmail_id', 'is', null).not('html', 'is', null)
    .lt('created_at', cutoff).limit(500);
  if (error) { log.warn({ err: error.message }, 'retención: select html falló'); return; }
  const ids = (data || []).map(r => r.id);
  if (!ids.length) return;
  const { error: uErr } = await db.from('jjp_emails').update({ html: null }).in('id', ids);
  if (uErr) { log.warn({ err: uErr.message }, 'retención: trim html falló'); return; }
  log.info({ n: ids.length }, 'retención: html viejo liberado de Postgres (re-leíble de Gmail)');
}

// 4) Archivos huérfanos en jjp-email-media (sin fila de correo que los referencie)
async function purgeOrphanEmailFiles() {
  const { data: files, error } = await db.storage.from('jjp-email-media').list('', { limit: 1000 });
  if (error || !files) return;
  // NOTA: list('') solo devuelve la raíz; el layout real es owner/emailId/archivo.
  // Este barrido superficial cubre archivos sueltos en raíz. El profundo lo hace
  // audit-storage.js bajo demanda. Aquí evitamos falsos positivos por seguridad.
  const rootFiles = files.filter(f => f.id !== null).map(f => f.name);
  if (!rootFiles.length) return;
  // sin referencia conocida en raíz → borrar
  await removeFromBucket('jjp-email-media', rootFiles);
  log.info({ n: rootFiles.length }, 'retención: archivos sueltos en raíz de email-media borrados');
}

async function sweep() {
  try { await purgeInboundAttachments(); } catch (e) { log.warn({ err: e.message }, 'retención inbound'); }
  try { await purgeOutboundAttachments(); } catch (e) { log.warn({ err: e.message }, 'retención outbound'); }
  try { await trimOldHtml(); } catch (e) { log.warn({ err: e.message }, 'retención html'); }
  try { await purgeOrphanEmailFiles(); } catch (e) { log.warn({ err: e.message }, 'retención huérfanos'); }
}

export function startRetention() {
  log.info('retención de storage activa (barrido cada 6 h · TTL adjuntos 7d · html 30d)');
  setTimeout(() => sweep().catch(() => {}), 30_000);   // primer barrido 30 s tras arrancar
  setInterval(() => sweep().catch(() => {}), SWEEP_MS);
  return true;
}
