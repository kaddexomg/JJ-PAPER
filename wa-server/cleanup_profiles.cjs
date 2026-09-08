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

async function fix() {
  const cA = new Client(DS_A);
  const cB = new Client(DS_B);
  await cA.connect();
  await cB.connect();

  console.log('Conectados a Proyecto A y Proyecto B.');

  const oldAdminId = '24fd4fb8-e291-4ff9-8b77-83c2e842d502';
  const newAdminId = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164';

  // En B: Reasignar referencias del viejo admin al nuevo admin real
  await cB.query(`
    UPDATE public.jjp_emails SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_email_accounts SET profile_id = '${newAdminId}' WHERE profile_id = '${oldAdminId}';
    UPDATE public.jjp_wa_sessions SET profile_id = '${newAdminId}' WHERE profile_id = '${oldAdminId}';
    UPDATE public.jjp_wa_chats SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_wa_messages SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_wa_campaigns SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_wa_campaign_targets SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
  `);

  // En A: Reasignar referencias en jjp_emails y demás tablas
  await cA.query(`
    UPDATE public.jjp_emails SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_email_accounts SET profile_id = '${newAdminId}' WHERE profile_id = '${oldAdminId}';
    UPDATE public.jjp_orders SET seller_id = '${newAdminId}' WHERE seller_id = '${oldAdminId}';
    UPDATE public.jjp_quotes SET seller_id = '${newAdminId}' WHERE seller_id = '${oldAdminId}';
    UPDATE public.jjp_customers SET seller_id = '${newAdminId}' WHERE seller_id = '${oldAdminId}';
    UPDATE public.jjp_count_tally SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
    UPDATE public.jjp_count_log SET owner_id = '${newAdminId}' WHERE owner_id = '${oldAdminId}';
  `);

  // Eliminar referencias huérfanas en jjp_emails si quedaron algunas
  await cA.query(`
    UPDATE public.jjp_emails SET owner_id = '${newAdminId}' WHERE owner_id IN ('f4f48e48-ac6c-4c1a-a780-b65053194bb7', '${oldAdminId}');
  `);
  await cB.query(`
    UPDATE public.jjp_emails SET owner_id = '${newAdminId}' WHERE owner_id IN ('f4f48e48-ac6c-4c1a-a780-b65053194bb7', '${oldAdminId}');
  `);

  // Eliminar los perfiles obsoletos en A y B:
  await cB.query(`
    DELETE FROM public.jjp_profiles WHERE id IN (
      'f4f48e48-ac6c-4c1a-a780-b65053194bb7',
      '${oldAdminId}'
    );
  `);
  await cA.query(`
    DELETE FROM public.jjp_profiles WHERE id IN (
      'f4f48e48-ac6c-4c1a-a780-b65053194bb7',
      '${oldAdminId}'
    );
  `);
  console.log('✅ Reasignación y eliminación de perfiles completada.');

  // En B: Asegurar que jjp_profiles tenga las columnas necesarias (role, active, ref_code, etc)
  await cB.query(`
    ALTER TABLE public.jjp_profiles ADD COLUMN IF NOT EXISTS ref_code text;
    ALTER TABLE public.jjp_profiles ADD COLUMN IF NOT EXISTS active boolean DEFAULT false;
    ALTER TABLE public.jjp_profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'vendedor';
  `);

  // Sincronizar perfiles de A hacia B
  const profsA = await cA.query('SELECT id, name, role, ref_code, active FROM public.jjp_profiles');
  console.log('Sincronizando perfiles a B...');
  for (const p of profsA.rows) {
    await cB.query(`
      INSERT INTO public.jjp_profiles (id, name, role, ref_code, active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          role = EXCLUDED.role,
          ref_code = EXCLUDED.ref_code,
          active = EXCLUDED.active
    `, [p.id, p.name, p.role, p.ref_code, p.active]);
  }
  console.log('✅ Perfiles sincronizados en B.');

  // Aplicar RLS y políticas en B
  await cB.query(`
    ALTER TABLE public.jjp_server_control ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_server_control_all ON public.jjp_server_control;
    CREATE POLICY jjp_server_control_all ON public.jjp_server_control FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_email_accounts_all ON public.jjp_email_accounts;
    CREATE POLICY jjp_email_accounts_all ON public.jjp_email_accounts FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_emails ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_emails_all ON public.jjp_emails;
    CREATE POLICY jjp_emails_all ON public.jjp_emails FOR ALL USING (true) WITH CHECK (true);

    ALTER TABLE public.jjp_profiles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS jjp_profiles_all ON public.jjp_profiles;
    CREATE POLICY jjp_profiles_all ON public.jjp_profiles FOR ALL USING (true) WITH CHECK (true);

    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    NOTIFY pgrst, 'reload schema';
  `);
  console.log('✅ RLS y permisos aplicados en B.');

  const finalA = await cA.query('SELECT id, name, role, active, ref_code FROM public.jjp_profiles ORDER BY role, name');
  console.log('Perfiles definitivos en A:');
  console.table(finalA.rows);

  const finalB = await cB.query('SELECT id, name, role, active, ref_code FROM public.jjp_profiles ORDER BY role, name');
  console.log('Perfiles definitivos en B:');
  console.table(finalB.rows);

  await cA.end();
  await cB.end();
}
fix().catch(console.error);
