const { createClient } = require('@supabase/supabase-js');

const PROJ_A = {
  name: 'Proyecto A (Core)',
  url: 'https://qxgdrfkobbhdzgtoiavv.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2RyZmtvYmJoZHpndG9pYXZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkzNzE5MiwiZXhwIjoyMTAzNTEzMTkyfQ.6TW5y4D46tbb6X3aF1Pfo0oNOmXg4dyTDCD97geYKRw'
};

const PROJ_B = {
  name: 'Proyecto B (Comunicaciones)',
  url: 'https://klcibjwleiqppedefpxw.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtsY2liandsZWlxcHBlZGVmcHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzc1MTc5NiwiZXhwIjoyMTAzMzI3Nzk2fQ.gk-Ch2njS3f-GUvqRzS5v4hH3tJ56bdo5ixOs_xOuWA'
};

const PROJ_C = {
  name: 'Proyecto C (Storage/Inventario)',
  url: 'https://nmcamjxhyysmmvgxgabo.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg'
};

async function inspect(proj) {
  console.log(`\n========================================`);
  console.log(`INSPECCIONANDO: ${proj.name} (${proj.url})`);
  console.log(`========================================`);
  const sb = createClient(proj.url, proj.key);

  // 1. Buckets
  const { data: buckets, error: bErr } = await sb.storage.listBuckets();
  if (bErr) {
    console.log('Error listando buckets:', bErr.message);
  } else {
    console.log('Buckets existentes:');
    for (const b of buckets) {
      const { data: files, error: fErr } = await sb.storage.from(b.id).list('', { limit: 100 });
      console.log(`  - Bucket "${b.id}" (public: ${b.public}): ${files ? files.length : 0} archivos en raiz`);
    }
  }

  // 2. Tablas principales
  const tables = ['jjp_customers', 'jjp_products', 'jjp_product_variants', 'jjp_orders', 'jjp_profiles', 'jjp_wa_messages', 'jjp_wa_chats', 'jjp_emails', 'jjp_counts', 'jjp_server_control'];
  for (const t of tables) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    if (!error) {
      console.log(`  - Tabla ${t}: ${count} filas`);
    }
  }
}

async function run() {
  await inspect(PROJ_A);
  await inspect(PROJ_B);
  await inspect(PROJ_C);
}

run().catch(console.error);
