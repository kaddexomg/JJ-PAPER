const { Client } = require('pg');

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function run() {
  const c = new Client(DS_B);
  await c.connect();

  const pol = await c.query(`
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jjp_emails';
  `);
  console.log('Políticas en jjp_emails:', pol.rows);

  const rls = await c.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname = 'jjp_emails';
  `);
  console.log('RLS activo en jjp_emails:', rls.rows);

  await c.end();
}

run().catch(console.error);
