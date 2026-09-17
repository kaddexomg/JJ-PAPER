const fs = require('fs');
const path = require('path');

const masterSqlPath = path.join(__dirname, 'sql', 'INSTALACION_DEFINITIVA_TOTAL.sql');
let masterSql = fs.readFileSync(masterSqlPath, 'utf8');

// The original file is a concatenation of patches.
// The campaigns patch ("Difusión WhatsApp para vendedores") is around line 1556.
// But the core WhatsApp tables (Chats, Messages, Sessions) were appended at the end of the file 
// under "sql/2026-07-whatsapp-crm.sql" (around line 3723).
// We must move the CRM WhatsApp patch to BEFORE the Campaigns patch.

const campaignsMarker = '-- JJ Paper — Difusión WhatsApp para vendedores (16-jul-2026)';
const crmMarker = '-- sql/2026-07-whatsapp-crm.sql';

const campaignsIndex = masterSql.indexOf(campaignsMarker);
const crmIndex = masterSql.indexOf(crmMarker);

if (campaignsIndex > -1 && crmIndex > -1) {
  // Extract the CRM block (from its start to the end of the file)
  const crmBlock = masterSql.substring(crmIndex);
  
  // Remove it from the end
  masterSql = masterSql.substring(0, crmIndex);
  
  // Insert it right before the Campaigns block
  masterSql = masterSql.substring(0, campaignsIndex) + 
              '\n\n' + crmBlock + '\n\n' + 
              masterSql.substring(campaignsIndex);
}

// Strip strict foreign keys for projects B and C
function stripForeignKeys(sql) {
  let stripped = sql.replace(/references\s+public\.[a-z0-9_]+\s*\([^)]+\)(?:\s+on\s+(?:delete|update)\s+(?:cascade|set\s+null|restrict))?/gi, '');
  stripped = stripped.replace(/constraint\s+[a-z0-9_]+\s+foreign\s+key\s*\([^)]+\)\s+references\s+public\.[a-z0-9_]+\s*\([^)]+\)(?:\s+on\s+(?:delete|update)\s+(?:cascade|set\s+null|restrict))?/gi, '');
  return stripped;
}

fs.writeFileSync(path.join(__dirname, 'sql', 'SQL_Proyecto_A.sql'), masterSql);
fs.writeFileSync(path.join(__dirname, 'sql', 'SQL_Proyecto_B.sql'), stripForeignKeys(masterSql));
fs.writeFileSync(path.join(__dirname, 'sql', 'SQL_Proyecto_C.sql'), stripForeignKeys(masterSql));

console.log('✅ Los 3 scripts han sido regenerados con el orden correcto.');
