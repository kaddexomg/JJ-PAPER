import { db } from './supabase.js';
import { log } from './logger.js';
import { normVePhone, localVePhone } from './phone.js';

// Busca el cliente del CRM por teléfono (el CRM guarda formato local '0412…',
// pero puede haber registros con '58412…' — probamos ambos)
async function findCustomer(phone) {
  const full = normVePhone(phone);
  const local = localVePhone(phone);
  const { data, error } = await db.from('jjp_customers')
    .select('id,name').in('phone', [full, local]).limit(1);
  if (error) { log.warn({ error: error.message }, 'lookup jjp_customers falló'); return null; }
  return data?.[0] || null;
}

// Devuelve (creando si hace falta) el chat de (owner, jid)
export async function upsertChat(ownerId, jid, phone, pushName) {
  const norm = normVePhone(phone);
  const { data: existing } = await db.from('jjp_wa_chats')
    .select('*').eq('owner_id', ownerId).eq('jid', jid).maybeSingle();
  if (existing) {
    // Enlazar cliente/nombre si el chat aún no lo tiene
    if (!existing.customer_id) {
      const cust = await findCustomer(norm);
      if (cust) {
        const { data } = await db.from('jjp_wa_chats')
          .update({ customer_id: cust.id, display_name: cust.name })
          .eq('id', existing.id).select().single();
        return data || existing;
      }
    }
    if (!existing.display_name && pushName) {
      await db.from('jjp_wa_chats').update({ display_name: pushName }).eq('id', existing.id);
      existing.display_name = pushName;
    }
    return existing;
  }
  const cust = await findCustomer(norm);
  const { data, error } = await db.from('jjp_wa_chats')
    .upsert({
      owner_id: ownerId, jid, phone: norm,
      customer_id: cust?.id || null,
      display_name: cust?.name || pushName || norm
    }, { onConflict: 'owner_id,jid' })
    .select().single();
  if (error) { log.error({ error: error.message, jid }, 'upsert chat falló'); return null; }
  return data;
}

// Actualiza preview/unread del chat tras un mensaje
export async function touchChat(chatId, preview, from, incUnread) {
  const { error } = await db.rpc('jjp_wa_touch_chat', {
    p_chat: chatId,
    p_preview: preview || '',
    p_from: from,
    p_inc: incUnread ? 1 : 0
  });
  if (error) log.warn({ error: error.message, chatId }, 'touch chat falló');
}

export const PREVIEW_BY_TYPE = {
  image: '📷 Imagen', video: '🎬 Video', audio: '🎵 Audio',
  document: '📄 Documento', sticker: '🩵 Sticker', unsupported: 'Mensaje no soportado'
};
