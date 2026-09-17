/* Transferir imágenes de productos inactivos → activos sin imagen */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = !process.argv.includes('--execute');

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

async function rest(path, opts = {}) {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H, ...opts });
  const t = await r.text();
  let b; try { b = t ? JSON.parse(t) : null; } catch { b = t; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(t).slice(0, 300)}`);
  return b;
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
  console.log(`\n📸 RECUPERACIÓN DE IMÁGENES`);
  console.log(`   Modo: ${DRY_RUN ? '🔍 DRY-RUN' : '⚡ EJECUTAR'}\n`);

  // Load all products
  const inactive = await rest('jjp_products?select=id,name,sku,image_url&active=eq.false&image_url=not.is.null');
  const active = await rest('jjp_products?select=id,name,sku,image_url&active=eq.true');

  console.log(`   Inactivos con imagen: ${inactive.length}`);
  console.log(`   Activos: ${active.length}\n`);

  const toTransfer = [];

  for (const dead of inactive) {
    // Find active product without image that matches
    let bestMatch = null, bestScore = 0;
    for (const a of active) {
      if (a.image_url) continue; // skip if already has image
      const s = similarity(dead.name, a.name);
      if (s > bestScore) { bestScore = s; bestMatch = a; }
    }
    if (bestMatch && bestScore >= 0.7) {
      toTransfer.push({ from: dead, to: bestMatch, score: bestScore });
    }
  }

  console.log(`   Imágenes a transferir: ${toTransfer.length}\n`);

  for (const t of toTransfer) {
    const pct = Math.round(t.score * 100);
    console.log(`   ${pct}% "${t.from.name}" → "${t.to.name}"`);
    console.log(`      URL: ${t.from.image_url}`);
  }

  if (DRY_RUN) {
    console.log(`\n🔍 DRY-RUN completado. Para ejecutar: node recuperar_imagenes.mjs --execute`);
    return;
  }

  console.log(`\n⚡ Ejecutando transferencias...\n`);

  let ok = 0, err = 0;
  for (const t of toTransfer) {
    try {
      await rest(`jjp_products?id=eq.${t.to.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ image_url: t.from.image_url }),
      });
      ok++;
      console.log(`   ✅ ${t.to.name}`);
    } catch (e) {
      err++;
      console.error(`   ❌ ${t.to.name}: ${e.message}`);
    }
  }

  console.log(`\n   ✅ Transferidas: ${ok}`);
  console.log(`   ❌ Errores: ${err}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
