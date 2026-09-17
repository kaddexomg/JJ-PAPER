const { Client } = require('pg');

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function check() {
  const client = new Client(DS_B);
  await client.connect();
  const res = await client.query('SELECT * FROM public.jjp_server_control WHERE id = 1');
  console.log('STATUS:', JSON.stringify(res.rows[0], null, 2));
  await client.end();
}

check().catch(console.error);
