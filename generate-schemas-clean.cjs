const fs = require('fs');
const path = require('path');

const sqlDir = path.join(__dirname, 'sql');

// El problema principal fue que el archivo INSTALACION_DEFINITIVA_TOTAL.sql
// se generó concatenando archivos por ORDEN ALFABÉTICO (por lo que count-control
// se ejecutó antes que count-tally, y automations antes que rebuild-base).
// Para arreglarlo de forma DEFINITIVA y 100% segura, vamos a ensamblar el
// código fuente partiendo de los parches individuales en su ORDEN CRONOLÓGICO Y LÓGICO.

const filesOrder = [
  '2026-07-13-rebuild-base-schema.sql', // 1. Base absoluta
  '2026-07-automations.sql',            // 2. Depende de la base
  '2026-07-whatsapp-crm.sql',           // 3. Tablas de Chats y Mensajes (núcleo CRM WA)
  
  // Parches del 14
  '2026-07-14-order-discounts.sql',
  '2026-07-14-price-base.sql',
  '2026-07-14-scan-events.sql',
  
  // Parches del 16
  '2026-07-16-catalog-groups.sql',
  '2026-07-16-clients-reviews.sql',
  '2026-07-16-quote-discount-siteurl.sql',
  '2026-07-16-stock-kardex.sql',
  '2026-07-16-supplier-invoices.sql',
  '2026-07-16-wa-difusion.sql',         // 4. Campañas (depende del núcleo CRM)
  
  // Parches del 18 (Conteo de inventario, dependencias circulares resueltas)
  '2026-07-18-count-tally.sql',         // <- CREA la tabla jjp_count_tally
  '2026-07-18-count-log.sql',           // <- CREA la tabla jjp_count_log
  '2026-07-18-count-control.sql',       // <- Usa las tablas anteriores
  '2026-07-18-scan-bridge-v2.sql',
  '2026-07-18-sku-bridge.sql',
  
  // Parches del 19 en adelante
  '2026-07-19-count-batch.sql',
  '2026-07-19-count-multiuser.sql',
  '2026-07-19-security-hardening.sql',
  '2026-07-23-fx-rates-history.sql',
  '2026-07-25-delivery.sql',
  '2026-07-25-wa-presence.sql',
  '2026-07-26-factura-fiscal.sql',
  '2026-07-26-integraciones.sql',
  
  // Parches de Agosto
  '2026-08-06-seller-prices.sql',
  '2026-08-17-customers-zone.sql',
  '2026-08-19-seller-settings.sql',
  '2026-08-28-wa-campaigns-batch-columns.sql',
  '2026-08-28-wa-messages-columnas-faltantes.sql',
  '2026-08-31-eliminar-campanas.sql',
  '2026-08-31-email-skipped-count.sql',
  '2026-08-31-reparacion-backend.sql',
  '2026-08-31-skipped-count.sql'
];

let masterSql = '';

for (const file of filesOrder) {
  const filePath = path.join(sqlDir, file);
  if (fs.existsSync(filePath)) {
    masterSql += `\n\n-- =========================================\n`;
    masterSql += `-- FILE: ${file}\n`;
    masterSql += `-- =========================================\n`;
    masterSql += fs.readFileSync(filePath, 'utf8');
  } else {
    console.warn(`⚠️ Archivo no encontrado: ${file}`);
  }
}

// Strip strict foreign keys for projects B and C
function stripForeignKeys(sql) {
  let stripped = sql.replace(/references\s+public\.[a-z0-9_]+\s*\([^)]+\)(?:\s+on\s+(?:delete|update)\s+(?:cascade|set\s+null|restrict))?/gi, '');
  stripped = stripped.replace(/constraint\s+[a-z0-9_]+\s+foreign\s+key\s*\([^)]+\)\s+references\s+public\.[a-z0-9_]+\s*\([^)]+\)(?:\s+on\s+(?:delete|update)\s+(?:cascade|set\s+null|restrict))?/gi, '');
  return stripped;
}

fs.writeFileSync(path.join(sqlDir, 'SQL_Proyecto_A.sql'), masterSql);
fs.writeFileSync(path.join(sqlDir, 'SQL_Proyecto_B.sql'), stripForeignKeys(masterSql));
fs.writeFileSync(path.join(sqlDir, 'SQL_Proyecto_C.sql'), stripForeignKeys(masterSql));

console.log('✅ Los 3 scripts han sido regenerados ENSAMBLANDO LOS ARCHIVOS EN ORDEN CRONOLÓGICO Y LÓGICO PERFECTO.');
