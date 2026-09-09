// Normalización y clasificación de teléfonos — MISMA lógica que assets/js/wa/wa-common.js

/**
 * Analiza, limpia y clasifica un número telefónico.
 * Detecta si es celular venezolano (0412, 0414, 0424, 0416, 0426),
 * teléfono fijo CANTV (0212, 0241, 0251...), internacional o inválido.
 */
export function parsePhoneInfo(raw) {
  const clean = String(raw || '').trim();
  let digits = clean.replace(/\D/g, '');

  if (!digits) {
    return { isValid: false, isMobile: false, isLandline: false, norm: '', display: '', type: 'empty' };
  }

  // Corregir prefijo de vendedor pegado por error durante importación previa (004, 006, 008, 010, 014)
  if (/^(?:004|006|008|010|014)0?4(12|14|24|16|26)\d{7}$/.test(digits)) {
    digits = digits.slice(3);
  }

  // Corregir prefijo 5804... -> 584...
  if (/^580(4\d{9})$/.test(digits)) {
    digits = '58' + digits.slice(3);
  }

  // Corregir prefijo 0058... -> 58...
  if (/^0058(\d+)$/.test(digits)) {
    digits = '58' + digits.slice(4);
  }

  // Celular venezolano estándar con 0 inicial (ej: 04121234567 -> 11 dígitos)
  if (/^0(412|414|424|416|426)\d{7}$/.test(digits)) {
    return {
      isValid: true,
      isMobile: true,
      isLandline: false,
      country: 'VE',
      norm: '58' + digits.slice(1),
      display: digits,
      type: 'mobile_ve'
    };
  }

  // Celular venezolano con código 58 (ej: 584121234567 -> 12 dígitos)
  if (/^58(412|414|424|416|426)\d{7}$/.test(digits)) {
    return {
      isValid: true,
      isMobile: true,
      isLandline: false,
      country: 'VE',
      norm: digits,
      display: '0' + digits.slice(2),
      type: 'mobile_ve'
    };
  }

  // Celular venezolano sin cero inicial (ej: 4121234567 -> 10 dígitos)
  if (/^(412|414|424|416|426)\d{7}$/.test(digits)) {
    return {
      isValid: true,
      isMobile: true,
      isLandline: false,
      country: 'VE',
      norm: '58' + digits,
      display: '0' + digits,
      type: 'mobile_ve'
    };
  }

  // Teléfono Fijo CANTV / Local de Venezuela (0212, 0241, 0251, etc. -> NO TIENEN WHATSAPP ESTÁNDAR)
  if (/^(?:58|0)?(?:2\d{2})\d{7}$/.test(digits)) {
    const local = digits.startsWith('58') ? '0' + digits.slice(2) : (digits.startsWith('0') ? digits : '0' + digits);
    return {
      isValid: true,
      isMobile: false,
      isLandline: true,
      country: 'VE',
      norm: '58' + local.slice(1),
      display: local,
      type: 'landline_ve'
    };
  }

  // Número Internacional (ej: +1, +57, +34... con longitud entre 10 y 15 dígitos)
  if ((clean.startsWith('+') || digits.length >= 11) && digits.length <= 15 && !digits.startsWith('0')) {
    return {
      isValid: true,
      isMobile: true,
      isLandline: false,
      country: 'INTL',
      norm: digits,
      display: '+' + digits,
      type: 'international'
    };
  }

  return {
    isValid: false,
    isMobile: false,
    isLandline: false,
    country: null,
    norm: digits,
    display: clean,
    type: 'invalid'
  };
}

export function normVePhone(raw) {
  const info = parsePhoneInfo(raw);
  return info.norm || String(raw || '').replace(/\D/g, '');
}

export function localVePhone(raw) {
  const info = parsePhoneInfo(raw);
  return info.display || String(raw || '').replace(/\D/g, '');
}

export function isMobileVePhone(raw) {
  return parsePhoneInfo(raw).isMobile;
}

export const phoneToJid = p => normVePhone(p) + '@s.whatsapp.net';

// '584121234567:12@s.whatsapp.net' → '584121234567'
export const jidToPhone = jid => String(jid || '').split('@')[0].split(':')[0];

