// Inyección optimizada por lotes de costos
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const row = [];
    let insideQuote = false;
    let entry = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') insideQuote = !insideQuote;
      else if (char === ',' && !insideQuote) {
        row.push(entry.trim().replace(/^"|"$/g, ''));
        entry = '';
      } else entry += char;
    }
    row.push(entry.trim().replace(/^"|"$/g, ''));
    if (row.length >= header.length) {
      const obj = {};
      header.forEach((h, idx) => obj[h] = row[idx]);
      rows.push(obj);
    }
  }
  return rows;
}

async function run() {
  console.log('Obteniendo todas las variantes de la base de datos...');
  const { data: variants, error: vErr } = await sb
    .from('jjp_product_variants')
    .select('id, product_id, sku, price_usd');

  if (vErr || !variants) {
    console.error('Error obteniendo variantes:', vErr);
    process.exit(1);
  }
  console.log(`Variantes encontradas en DB: ${variants.length}`);

  // Mapa de SKU normalizado -> variantes
  const varMap = new Map();
  for (const v of variants) {
    if (v.sku) {
      const norm = v.sku.trim().toUpperCase();
      if (!varMap.has(norm)) varMap.set(norm, []);
      varMap.get(norm).push(v);
    }
  }

  const path1 = 'C:\\Users\\PC\\Desktop\\proveedoresapp\\COSTOS\\costos_para_importar_admin.csv';
  const csv1 = fs.readFileSync(path1, 'utf8');
  const items1 = parseCSV(csv1);

  let updated = 0;
  for (const row of items1) {
    const sku = (row.sku || '').trim().toUpperCase();
    const cost = parseFloat(row.cost_usd);
    if (!sku || isNaN(cost) || cost <= 0) continue;

    const matched = varMap.get(sku);
    if (matched && matched.length > 0) {
      for (const v of matched) {
        let margin = null;
        const price = v.price_usd || parseFloat(row.price_usd);
        if (price > 0 && price > cost) {
          margin = Math.round(((price - cost) / cost) * 100);
        }

        await sb.from('jjp_product_variants').update({ cost_usd: cost, margin_pct: margin }).eq('id', v.id);
        if (v.product_id) {
          await sb.from('jjp_products').update({ cost_usd: cost }).eq('id', v.product_id);
        }
        updated++;
      }
    }
  }

  console.log(`✓ ¡Costos y márgenes actualizados exitosamente en ${updated} variantes!`);
}

run();
