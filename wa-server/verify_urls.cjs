const { Client } = require('pg');

const DS_A = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv',
  password: '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function run() {
  const c = new Client(DS_A);
  await c.connect();
  const res = await c.query("SELECT id, name, image_url FROM jjp_products WHERE image_url IS NOT NULL LIMIT 3");
  console.log('Muestra de productos actualizados:', res.rows);
  const oldDomainCount = await c.query("SELECT count(id) FROM jjp_products WHERE image_url LIKE '%czzvsqnmxtjzqzioknnn%'");
  console.log('Imágenes apuntando al proyecto viejo (debe ser 0):', oldDomainCount.rows[0].count);
  await c.end();
}

run().catch(console.error);
