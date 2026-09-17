const { createClient } = require('@supabase/supabase-js');

const sbC = createClient(
  'https://nmcamjxhyysmmvgxgabo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2FtanhoeXlzbW12Z3hnYWJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjA2MTQ2NCwiZXhwIjoyMDk3NjM3NDY0fQ.QvuDcLSJleatqDcglU_w0fRnXbz9N6scGaDVqCUgoXg'
);

const sbA = createClient(
  'https://qxgdrfkobbhdzgtoiavv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z2RyZmtvYmJoZHpndG9pYXZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzkzNzE5MiwiZXhwIjoyMTAzNTEzMTkyfQ.6TW5y4D46tbb6X3aF1Pfo0oNOmXg4dyTDCD97geYKRw'
);

async function run() {
  const filename = 'faf4d607-4a56-428c-90fa-05176fd95d95.jpg';
  const url = `https://czzvsqnmxtjzqzioknnn.supabase.co/storage/v1/object/public/jjp-products/${filename}`;
  console.log('Descargando imagen desde proyecto viejo:', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Descargado ${buf.length} bytes`);

  // Subir a Proyecto C
  const upC = await sbC.storage.from('jjp-products').upload(filename, buf, { contentType: 'image/jpeg', upsert: true });
  console.log('Subida a Proyecto C:', upC.error ? upC.error.message : 'OK ✅');

  // Subir a Proyecto A
  const upA = await sbA.storage.from('jjp-products').upload(filename, buf, { contentType: 'image/jpeg', upsert: true });
  console.log('Subida a Proyecto A:', upA.error ? upA.error.message : 'OK ✅');

  // Probar acceso público
  const testUrlC = `https://nmcamjxhyysmmvgxgabo.supabase.co/storage/v1/object/public/jjp-products/${filename}`;
  const testResC = await fetch(testUrlC);
  console.log('Test descarga publica Proyecto C:', testResC.status);

  const testUrlA = `https://qxgdrfkobbhdzgtoiavv.supabase.co/storage/v1/object/public/jjp-products/${filename}`;
  const testResA = await fetch(testUrlA);
  console.log('Test descarga publica Proyecto A:', testResA.status);
}

run().catch(console.error);
