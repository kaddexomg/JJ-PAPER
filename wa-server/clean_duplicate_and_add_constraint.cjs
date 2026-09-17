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
  const client = new Client(DS_B);
  await client.connect();

  // 1. Eliminar duplicados dejando solo el más reciente
  await client.query(`
    DELETE FROM public.jjp_wa_messages
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id, wa_msg_id ORDER BY created_at DESC) as rnum
        FROM public.jjp_wa_messages
        WHERE wa_msg_id IS NOT NULL
      ) t
      WHERE t.rnum > 1
    );
  `);
  console.log('✅ Duplicados eliminados de jjp_wa_messages');

  // 2. Crear índice único para prevenir duplicados
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jjp_wa_messages_owner_msg_id
    ON public.jjp_wa_messages (owner_id, wa_msg_id)
    WHERE wa_msg_id IS NOT NULL;
    NOTIFY pgrst, 'reload schema';
  `);
  console.log('✅ Índice único creado en (owner_id, wa_msg_id)');

  await client.end();
}

run().catch(console.error);
