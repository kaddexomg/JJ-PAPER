const fs = require('fs');
const path = require('path');

const fileA = path.join(__dirname, 'sql', 'SQL_Proyecto_A.sql');
let sqlA = fs.readFileSync(path.join(__dirname, 'sql', 'INSTALACION_DEFINITIVA_TOTAL.sql'), 'utf8');

// Hay un error de orden en el SQL original: jjp_wa_campaign_targets (linea ~1625) 
// hace referencia a jjp_wa_messages, pero jjp_wa_messages (y jjp_wa_chats) se crean en la línea ~3700.
// Vamos a mover jjp_wa_chats y jjp_wa_messages (y jjp_wa_sessions) justo antes de jjp_wa_campaigns.

// Busquemos el bloque de wa_sessions, wa_chats, wa_messages
const blockStart = sqlA.indexOf('-- ---------- 22. WhatsApp: Sesiones, Chats y Mensajes ----------');
const blockEnd = sqlA.indexOf('-- ---------- 23. Precios y Tasas del Vendedor (Custom) ----------');

if (blockStart > -1 && blockEnd > -1) {
  const waBlock = sqlA.substring(blockStart, blockEnd);
  
  // Quitarlo de su posición original
  sqlA = sqlA.substring(0, blockStart) + sqlA.substring(blockEnd);
  
  // Insertarlo antes de jjp_wa_templates (que es antes de campaigns y targets)
  const targetPos = sqlA.indexOf('-- ---------- 13. Difusión y Campañas de WhatsApp ----------');
  if (targetPos > -1) {
    sqlA = sqlA.substring(0, targetPos) + waBlock + '\n\n' + sqlA.substring(targetPos);
  }
}

// Otro posible problema de orden: jjp_wa_messages (línea 3791) también hace FK a jjp_wa_campaigns?
// Veamos las dependencias:
// chats -> customers
// messages -> chats
// campaigns -> (none)
// targets -> campaigns, customers, messages

fs.writeFileSync(fileA, sqlA);
console.log('✅ SQL_Proyecto_A.sql corregido (orden de tablas arreglado).');
