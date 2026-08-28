import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(HERE, 'wa-server', '.env'), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal'
};

const ZONE_SELLER = {
  '008': 'd9608291-1363-4790-a7b0-0d6fd426564f', // Marianela (MANIANELA VENTAS JJ)
  '014': 'b0cd93c5-e2f0-4322-9d35-e374109d284f', // Andreina (ANDREINA JJ VENTAS)
  '006': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', // Giovanni (Yovanni Araujo)
  '004': '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6', // Giovanni (Yovanni Araujo)
};

console.log('Asignando clientes por zona a cada vendedor en Supabase...');

for (const [zone, sellerId] of Object.entries(ZONE_SELLER)) {
  const res = await fetch(`${URL}/rest/v1/jjp_customers?zone=eq.${zone}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ seller_id: sellerId, updated_at: new Date().toISOString() })
  });
  if (!res.ok) {
    console.error(`Error asignando zona ${zone}:`, await res.text());
  } else {
    console.log(`✓ Zona ${zone} asignada a vendedor UUID ${sellerId}`);
  }
}

// Resumen de asignación
const resAll = await fetch(`${URL}/rest/v1/jjp_customers?select=zone,seller_id`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
const customers = await resAll.json();
const summary = {};
for (const c of customers) {
  let sellerName = 'Sin Vendedor';
  if (c.seller_id === 'd9608291-1363-4790-a7b0-0d6fd426564f') sellerName = 'Marianela (008)';
  else if (c.seller_id === 'b0cd93c5-e2f0-4322-9d35-e374109d284f') sellerName = 'Andreina (014)';
  else if (c.seller_id === '95d5ad44-e844-4f4f-a9d0-2db7d162c8c6') sellerName = 'Giovanni (004/006)';
  
  const key = `Zona ${c.zone || 'sin'} → ${sellerName}`;
  summary[key] = (summary[key] || 0) + 1;
}

console.log('\n--- RESUMEN FINAL DE DISTRIBUCIÓN ---');
console.log(JSON.stringify(summary, null, 2));
