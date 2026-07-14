// Normalización de teléfonos venezolanos — MISMA lógica que assets/js/wa/wa-common.js
// '0412-123.45.67' → '584121234567' ; '+58 412…' → '58412…' ; '4121234567' → '58412…'
export function normVePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('58') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '58' + d.slice(1);
  if (d.length === 10 && /^[24]/.test(d)) return '58' + d;
  return d;
}

// '584121234567' → '04121234567' (formato en que el CRM guarda jjp_customers.phone)
export function localVePhone(raw) {
  const d = normVePhone(raw);
  return (d.startsWith('58') && d.length === 12) ? '0' + d.slice(2) : d;
}

export const phoneToJid = p => normVePhone(p) + '@s.whatsapp.net';

// '584121234567:12@s.whatsapp.net' → '584121234567'
export const jidToPhone = jid => String(jid || '').split('@')[0].split(':')[0];
