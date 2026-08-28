// Carga rápida de categorías, marcas y productos al nuevo Supabase
import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    // Parser simple de CSV respetando comillas
    const line = lines[i];
    const row = [];
    let insideQuote = false;
    let entry = '';
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        row.push(entry.trim().replace(/^"|"$/g, ''));
        entry = '';
      } else {
        entry += char;
      }
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
  console.log('=== IMPORTANDO CATALOGO Y PRODUCTOS ===');
  const csvText = fs.readFileSync('../sql/jjpaper_productos_import.csv', 'utf8');
  const items = parseCSV(csvText);
  console.log(`Leídos ${items.length} productos del CSV.`);

  // 1. Extraer categorías únicas
  const catSlugs = [...new Set(items.map(i => i.category_slug).filter(Boolean))];
  const catMap = {};
  for (const slug of catSlugs) {
    const name = slug.replace(/_/g, ' ').toUpperCase();
    const { data } = await sb.from('jjp_categories').upsert({ slug, name }, { onConflict: 'slug' }).select('id').single();
    if (data) catMap[slug] = data.id;
  }
  console.log(`Categorías listas: ${Object.keys(catMap).length}`);

  // 2. Extraer marcas únicas
  const brandNames = [...new Set(items.map(i => i.brand).filter(Boolean))];
  const brandMap = {};
  for (const name of brandNames) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const { data } = await sb.from('jjp_brands').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single();
    if (data) brandMap[name] = data.id;
  }
  console.log(`Marcas listas: ${Object.keys(brandMap).length}`);

  // 3. Insertar productos y variantes
  let pCount = 0;
  for (const item of items) {
    const catId = catMap[item.category_slug] || null;
    const brandId = brandMap[item.brand] || null;
    const priceUsd = parseFloat(item.price_usd) || 0;
    const sku = item.sku || null;

    // Crear o actualizar producto
    const { data: prod, error: pErr } = await sb.from('jjp_products').insert({
      name: item.name,
      description: item.description || null,
      price_usd: priceUsd,
      category_id: catId,
      brand_id: brandId,
      sku: sku,
      stock: -1,
      min_qty: parseInt(item.min_qty) || 1,
      active: item.active !== 'false'
    }).select('id').single();

    if (prod) {
      pCount++;
      // Crear variante principal
      await sb.from('jjp_product_variants').insert({
        product_id: prod.id,
        brand_id: brandId,
        variant_name: item.variant || 'Estándar',
        sku: sku,
        price_usd: priceUsd,
        stock: -1,
        min_qty: 1,
        active: true
      });
    }
  }

  console.log(`✓ ${pCount} productos y variantes importados exitosamente.`);
}

run();
