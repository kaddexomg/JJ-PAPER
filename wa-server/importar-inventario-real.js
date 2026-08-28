import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Faltan credenciales en .env');
  process.exit(1);
}

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
  console.log('=== IMPORTANDO INVENTARIO REAL COMPLETO (602 PRODUCTOS) ===\n');

  // 1. Cargar archivo maestro de inventario
  const invPath = 'C:/Users/PC/Desktop/productos/jjpaper_inventario_2026-07-31.csv';
  if (!fs.existsSync(invPath)) {
    console.error('No se encontró el archivo:', invPath);
    return;
  }
  const items = parseCSV(fs.readFileSync(invPath, 'utf8'));
  console.log(`Leídos ${items.length} productos reales con inventario.`);

  // 2. Cargar archivo de conteo valorizado con códigos de barra
  const barPath = 'C:/Users/PC/Downloads/jjpaper_conteo_valorizado_2026-07-20.csv';
  const barcodeMap = {}; // sku -> { barcode, contadas }
  if (fs.existsSync(barPath)) {
    const barItems = parseCSV(fs.readFileSync(barPath, 'utf8'));
    barItems.forEach(b => {
      if (b.sku) {
        barcodeMap[b.sku.trim()] = {
          barcode: (b.codigo || '').trim() || null,
          contadas: parseInt(b.contadas) || 0,
          costo: parseFloat(b.costo_unit_usd) || null,
          precio: parseFloat(b.precio_unit_usd) || null
        };
      }
    });
    console.log(`Leídos ${Object.keys(barcodeMap).length} códigos de barras y conteos detallados.`);
  }

  // 3. Crear Categorías
  const catSlugs = [...new Set(items.map(i => (i.category_slug || '').trim()).filter(Boolean))];
  const catMap = {};
  for (const slug of catSlugs) {
    const name = slug.replace(/_/g, ' ').toUpperCase();
    const { data } = await sb.from('jjp_categories').upsert({ slug, name }, { onConflict: 'slug' }).select('id').single();
    if (data) catMap[slug] = data.id;
  }
  console.log(`Categorías listas en Supabase: ${Object.keys(catMap).length}`);

  // 4. Crear Marcas
  const brandNames = [...new Set(items.map(i => (i.brand || '').trim()).filter(Boolean))];
  const brandMap = {};
  for (const name of brandNames) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const { data } = await sb.from('jjp_brands').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single();
    if (data) brandMap[name] = data.id;
  }
  console.log(`Marcas listas en Supabase: ${Object.keys(brandMap).length}`);

  // 5. Limpiar productos anteriores de prueba para no duplicar
  console.log('\nActualizando catálogo con los 602 productos reales...');
  await sb.from('jjp_product_variants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('jjp_products').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  let insertedCount = 0;

  for (const item of items) {
    const catId = catMap[(item.category_slug || '').trim()] || null;
    const brandId = brandMap[(item.brand || '').trim()] || null;
    const sku = (item.sku || '').trim() || null;
    const priceUsd = parseFloat(item.price_usd) || 0;
    const costUsd = parseFloat(item.cost_usd) || null;
    const stockVal = item.stock !== undefined && item.stock !== '' ? parseInt(item.stock) : -1;
    const barInfo = sku ? barcodeMap[sku] : null;

    // Crear Producto
    const { data: prod, error: pErr } = await sb.from('jjp_products').insert({
      name: item.name.trim(),
      description: item.description ? item.description.trim() : null,
      price_usd: priceUsd,
      cost_usd: costUsd,
      category_id: catId,
      brand_id: brandId,
      sku: sku,
      stock: stockVal,
      emoji: item.emoji || '📦',
      tag: item.tag || null,
      unit: item.unit_abbr || 'und',
      min_qty: parseInt(item.min_qty) || 1,
      active: item.active !== 'false',
      featured: item.featured === 'true'
    }).select('id').single();

    if (pErr) {
      console.error(`Error producto ${item.name}:`, pErr.message);
      continue;
    }

    if (prod) {
      insertedCount++;
      // Crear Variante
      const { data: variant, error: vErr } = await sb.from('jjp_product_variants').insert({
        product_id: prod.id,
        brand_id: brandId,
        variant_name: item.variant || 'Estándar',
        sku: sku,
        barcode: barInfo?.barcode || null,
        price_usd: priceUsd,
        cost_usd: costUsd || barInfo?.costo || null,
        stock: stockVal,
        min_qty: parseInt(item.min_qty) || 1,
        active: true
      }).select('id').single();

      if (vErr) {
        console.error(`Error variante ${item.name}:`, vErr.message);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`✓ ÉXITO TOTAL: ${insertedCount} productos y variantes reales importados`);
  console.log(`======================================================`);
}

run();
