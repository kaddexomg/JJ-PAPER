// Verificar conectividad a los 3 proyectos Supabase nuevos (sin dependencias)
// Ejecutar: node verify-supabase.mjs

const projects = [
  {
    name: 'A — Core (qxgdrfko)',
    url: 'https://qxgdrfkobbhdzgtoiavv.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2RyZmtvYmJoZHpndG9pYXZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkzNzE5MiwiZXhwIjoyMTAzNTEzMTkyfQ.6TW5y4D46tbb6X3aF1Pfo0oNOmXg4dyTDCD97geYKRw'
  },
  {
    name: 'B — Comunicación (klcibjwl)',
    url: 'https://klcibjwleiqppedefpxw.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsY2liandsZWlxcHBlZGVmcHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzc1MTc5NiwiZXhwIjoyMTAzMzI3Nzk2fQ.gk-Ch2njS3f-GUvqRzS5v4hH3tJ56bdo5ixOs_xOuWA'
  },
  {
    name: 'C — Inventario (nmcamjxh)',
    url: 'https://nmcamjxhyysmmvgxgabo.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg'
  },
  {
    name: 'ACTUAL (czzvsqnm) — para migrar datos',
    url: 'https://czzvsqnmxtjzqzioknnn.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enZzcW5teHRqenF6aW9rbm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzI5MzYsImV4cCI6MjEwMzE0ODkzNn0.OcwmkYAP0Ax2_UI3kXAg5C6T-mf4aIeEf__Nz7EAhbc'
  }
];

console.log('=== Verificación de conectividad — Proyectos Supabase ===\n');

async function check(p) {
  try {
    const res = await fetch(`${p.url}/rest/v1/`, {
      headers: {
        'apikey': p.key,
        'Authorization': `Bearer ${p.key}`
      }
    });
    if (res.ok) {
      const tables = await res.json();
      const count = Array.isArray(tables) ? tables.length : '?';
      console.log(`✅ ${p.name}`);
      console.log(`   URL: ${p.url}`);
      console.log(`   Estado: CONECTADO — ${count} tabla(s) expuestas via PostgREST`);
    } else {
      console.log(`⚠️  ${p.name}`);
      console.log(`   URL: ${p.url}`);
      console.log(`   Estado: HTTP ${res.status} — ${res.statusText}`);
    }
  } catch (e) {
    console.log(`❌ ${p.name}`);
    console.log(`   URL: ${p.url}`);
    console.log(`   Error: ${e.message}`);
  }
  console.log();
}

for (const p of projects) await check(p);
console.log('=== Verificación completada ===');
