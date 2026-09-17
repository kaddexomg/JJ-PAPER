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

  const msgRes = await client.query(`
    SELECT m.id, m.chat_id, m.owner_id, m.wa_msg_id, m.direction, m.type, m.body, m.status, m.error, m.wa_timestamp, m.created_at,
           c.jid, c.phone, c.display_name
    FROM public.jjp_wa_messages m
    LEFT JOIN public.jjp_wa_chats c ON c.id = m.chat_id
    ORDER BY m.created_at DESC
    LIMIT 5;
  `);
  const emRes = await client.query(`
    SELECT id, owner_id, to_addr, subject, status, error, created_at
    FROM public.jjp_emails
    WHERE direction = 'out'
    ORDER BY created_at DESC
    LIMIT 5;
  `);
  console.log('\nÚltimos 5 correos salientes:');
  console.log(JSON.stringify(emRes.rows, null, 2));

  await client.end();
}

run().catch(console.error);
