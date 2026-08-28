// Script de rescate y backup completo de la Base de Datos
// Exporta clientes, catálogo, productos, variantes, categorías, marcas y perfiles a JSON.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Error: Faltan credenciales en wa-server/.env');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

async function backupTable(tableName) {
  const { data, error } = await sb.from(tableName).select('*');
  if (error) {
    console.error(`Error exportando ${tableName}:`, error.message);
    return null;
  }
  return data;
}

async function run() {
  console.log('=== INICIANDO EXTRACCIÓN DE SEGURIDAD (BACKUP COMPLETO) ===');
  
  const tables = [
    'jjp_customers',
    'jjp_products',
    'jjp_product_variants',
    'jjp_categories',
    'jjp_brands',
    'jjp_units',
    'jjp_profiles',
    'jjp_settings',
    'jjp_clients'
  ];

  const backupDir = path.resolve('../backups/rescate_' + new Date().toISOString().slice(0,10));
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const table of tables) {
    const data = await backupTable(table);
    if (data) {
      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`✓ ${table}: ${data.length} registros respaldados en ${filePath}`);
    }
  }

  console.log('\n=== RESPALDO COMPLETADO EXITOSAMENTE ===');
  console.log(`Todos tus datos están a salvo localmente en: ${backupDir}`);
}

run();
