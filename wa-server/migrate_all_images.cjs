const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const DS_A = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv',
  password: '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const sbC = createClient(
  'https://nmcamjxhyysmmvgxgabo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg'
);

const sbA = createClient(
  'https://qxgdrfkobbhdzgtoiavv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2RyZmtvYmJoZHpndG9pYXZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkzNzE5MiwiZXhwIjoyMTAzNTEzMTkyfQ.6TW5y4D46tbb6X3aF1Pfo0oNOmXg4dyTDCD97geYKRw'
);

async function migrateImages() {
  const cA = new Client(DS_A);
  await cA.connect();

  console.log('--- OBTENIENDO IMÁGENES A MIGRAR ---');
  const resP = await cA.query("SELECT id, image_url FROM jjp_products WHERE image_url IS NOT NULL AND image_url != ''");
  const resV = await cA.query("SELECT id, image_url FROM jjp_product_variants WHERE image_url IS NOT NULL AND image_url != ''");

  const filesMap = new Map(); // filename -> original url
  for (const r of [...resP.rows, ...resV.rows]) {
    const url = r.image_url;
    if (!url) continue;
    const parts = url.split('/');
    const filename = parts[parts.length - 1].split('?')[0];
    if (filename && !filesMap.has(filename)) {
      filesMap.set(filename, url);
    }
  }

  console.log(`Total archivos únicos de imágenes a migrar: ${filesMap.size}`);

  let success = 0;
  let failed = 0;
  const entries = Array.from(filesMap.entries());

  for (let i = 0; i < entries.length; i++) {
    const [filename, originalUrl] = entries[i];
    try {
      // Descargar desde url original
      const r = await fetch(originalUrl);
      if (!r.ok) {
        console.warn(`[${i+1}/${entries.length}] Falló descarga de ${filename}: HTTP ${r.status}`);
        failed++;
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = filename.endsWith('.png') ? 'image/png' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

      // Subir a Proyecto C (Storage Principal)
      await sbC.storage.from('jjp-products').upload(filename, buf, { contentType: mime, upsert: true });

      // Subir a Proyecto A (Respaldo)
      await sbA.storage.from('jjp-products').upload(filename, buf, { contentType: mime, upsert: true });

      success++;
      if ((i + 1) % 25 === 0 || i === entries.length - 1) {
        console.log(`Progreso: [${i+1}/${entries.length}] (${Math.round((i+1)/entries.length*100)}%) imágenes subidas a Proyectos C y A.`);
      }
    } catch (e) {
      console.error(`Error procesando ${filename}:`, e.message);
      failed++;
    }
  }

  console.log(`\nMigración de archivos terminada: ${success} exitosos, ${failed} fallidos.`);

  // Actualizar URLs en Proyecto A a la nueva URL de Proyecto C
  console.log('\n--- ACTUALIZANDO URLS EN BASE DE DATOS (PROYECTO A) ---');
  const upP = await cA.query(`
    UPDATE jjp_products 
    SET image_url = REPLACE(image_url, 'https://czzvsqnmxtjzqzioknnn.supabase.co', 'https://nmcamjxhyysmmvgxgabo.supabase.co')
    WHERE image_url LIKE '%czzvsqnmxtjzqzioknnn.supabase.co%';
  `);
  console.log(`Productos actualizados: ${upP.rowCount}`);

  const upV = await cA.query(`
    UPDATE jjp_product_variants 
    SET image_url = REPLACE(image_url, 'https://czzvsqnmxtjzqzioknnn.supabase.co', 'https://nmcamjxhyysmmvgxgabo.supabase.co')
    WHERE image_url LIKE '%czzvsqnmxtjzqzioknnn.supabase.co%';
  `);
  console.log(`Variantes actualizadas: ${upV.rowCount}`);

  await cA.end();
  console.log('🎉 MIGRACIÓN COMPLETA DE IMÁGENES A PROYECTO C Y A FINALIZADA.');
}

migrateImages().catch(console.error);
