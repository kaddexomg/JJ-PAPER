/* Verificar productos con imagen que fueron desactivados */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  const m = {};
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const r = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (r) m[r[1]] = r[2].replace(/^"|"$/g, '');
  }
  return m;
}
const env = loadEnv(join(HERE, 'wa-server', '.env'));
const U = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

async function rest(path) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H });
  return r.json();
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  const tokA = na.split(' ').filter(t => t.length > 2);
  const tokB = nb.split(' ').filter(t => t.length > 2);
  if (!tokA.length || !tokB.length) return 0;
  let common = 0;
  for (const t of tokA) {
    if (tokB.some(tb => tb === t || t.includes(tb) || tb.includes(t))) common++;
  }
  return common / Math.max(tokA.length, tokB.length);
}

async function main() {
  // Get inactive products with images
  const inactiveWithImg = await rest('jjp_products?select=id,name,sku,image_url,price_usd,stock&active=eq.false&image_url=not.is.null&order=name');
  console.log(`Productos INACTIVOS con imagen: ${inactiveWithImg.length}\n`);

  // Get active products
  const active = await rest('jjp_products?select=id,name,sku,image_url&active=eq.true&order=name');
  console.log(`Productos ACTIVOS: ${active.length}`);

  const activeWithImg = active.filter(p => p.image_url);
  const activeNoImg = active.filter(p => !p.image_url);
  console.log(`  Con imagen: ${activeWithImg.length}`);
  console.log(`  Sin imagen: ${activeNoImg.length}\n`);

  // For each inactive product with image, try to find a match in active products
  let recovered = 0;
  let unmatched = [];

  for (const dead of inactiveWithImg) {
    // Try exact name match
    let match = active.find(p => norm(p.name) === norm(dead.name));

    // Try fuzzy
    if (!match) {
      let best = null, bestScore = 0;
      for (const a of active) {
        const s = similarity(dead.name, a.name);
        if (s > bestScore) { bestScore = s; best = a; }
      }
      if (best && bestScore >= 0.7) match = best;
    }

    if (match && !match.image_url) {
      console.log(`🔄 RECUPERAR: "${dead.name}" → "${match.name}" (${dead.image_url})`);
      recovered++;
    } else if (match && match.image_url) {
      // Both have images - the active one already has one, skip
    } else {
      unmatched.push(dead);
    }
  }

  console.log(`\n📊 Resumen:`);
  console.log(`  Imágenes recuperables: ${recovered}`);
  console.log(`  Sin match activo: ${unmatched.length}`);

  if (unmatched.length > 0) {
    console.log(`\n❌ Productos con imagen pero sin match activo (primeros 30):`);
    for (const p of unmatched.slice(0, 30)) {
      console.log(`  ${p.name} | SKU: ${p.sku || 'N/A'} | $${p.price_usd}`);
    }
  }

  // How many active products are missing images?
  console.log(`\n📸 Productos activos SIN imagen: ${activeNoImg.length}`);
  console.log(`   (deberían tener imagen del CSV o de la BD original)\n`);

  // Show active products missing images (first 30)
  console.log(`   Primeros 30 activos sin imagen:`);
  for (const p of activeNoImg.slice(0, 30)) {
    console.log(`   - ${p.name} | SKU: ${p.sku || 'N/A'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
