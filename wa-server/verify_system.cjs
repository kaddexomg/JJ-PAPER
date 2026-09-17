const { Client } = require('pg');

const DS_A = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv',
  password: '30909109KJSP',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function test() {
  const cA = new Client(DS_A);
  const cB = new Client(DS_B);
  await cA.connect();
  await cB.connect();

  console.log('--- 1. PROBANDO PROYECTO A (CORE) ---');
  const cust = await cA.query(`
    SELECT id, name, email, email_opt_out, wa_opt_out 
    FROM public.jjp_customers 
    WHERE email IS NOT NULL AND email != '' 
    LIMIT 3;
  `);
  console.log('Clientes con email (Proyecto A):', cust.rows);

  console.log('\n--- 2. PROBANDO PROYECTO B (COMUNICACIONES) ---');
  // Probar crear una campana de prueba
  const camp = await cB.query(`
    INSERT INTO public.jjp_email_campaigns (name, subject, body, html, kind, status)
    VALUES ('Campana Test Antigravity', 'Prueba Asunto', 'Prueba Cuerpo', '<p>Prueba Cuerpo</p>', 'general', 'draft')
    RETURNING id;
  `);
  const campId = camp.rows[0].id;
  console.log('Campana insertada exitosamente con ID:', campId);

  const tgt = await cB.query(`
    INSERT INTO public.jjp_email_campaign_targets (campaign_id, owner_id, email, to_addr, name, status)
    VALUES ($1, 'bddc57dc-5bf9-4a72-9e1c-751d07b03164', 'test@example.com', 'test@example.com', 'Cliente Test', 'pending')
    RETURNING id;
  `, [campId]);
  console.log('Target insertado exitosamente con ID:', tgt.rows[0].id);

  // Limpiar prueba
  await cB.query(`DELETE FROM public.jjp_email_campaigns WHERE id = $1`, [campId]);
  console.log('Campana y target de prueba eliminados limpiamente.');

  // Probar lectura de buckets de storage
  const bA = await cA.query(`SELECT id, name, public FROM storage.buckets WHERE id IN ('jjp-email-media', 'jjp-wa-media');`);
  console.log('\nBuckets en Proyecto A:', bA.rows);
  const bB = await cB.query(`SELECT id, name, public FROM storage.buckets WHERE id IN ('jjp-email-media', 'jjp-wa-media');`);
  console.log('Buckets en Proyecto B:', bB.rows);

  // Comprobar heartbeat del servidor
  const srv = await cB.query(`SELECT id, status, heartbeat_at, started_at, modules FROM public.jjp_server_control WHERE id = 1;`);
  console.log('\nEstado actual de jjp_server_control:', {
    status: srv.rows[0].status,
    heartbeat_at: srv.rows[0].heartbeat_at,
    started_at: srv.rows[0].started_at,
    emailModule: srv.rows[0].modules?.email,
    whatsappModule: srv.rows[0].modules?.whatsapp,
    waSanas: srv.rows[0].modules?.waSanas
  });

  await cA.end();
  await cB.end();
  console.log('\n✅ ¡TODOS LOS TESTS DE VERIFICACIÓN PASARON CON ÉXITO!');
}

test().catch(console.error);
