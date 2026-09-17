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

const DS_C = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.nmcamjxhyysmmvgxgabo',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

async function setupPolicies() {
  console.log('--- Configurando políticas de Storage en Proyectos A, B y C ---');

  // Proyecto A
  const cA = new Client(DS_A);
  await cA.connect();
  await cA.query(`
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES 
      ('jjp-products', 'jjp-products', true, 52428800),
      ('jjp-receipts', 'jjp-receipts', true, 52428800),
      ('jjp-email-media', 'jjp-email-media', true, 52428800),
      ('jjp-wa-media', 'jjp-wa-media', true, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = true;

    DROP POLICY IF EXISTS "Public Storage A" ON storage.objects;
    CREATE POLICY "Public Storage A" ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true);
    NOTIFY pgrst, 'reload schema';
  `);
  await cA.end();
  console.log('✅ Proyecto A: Buckets y políticas listos');

  // Proyecto B
  const cB = new Client(DS_B);
  await cB.connect();
  await cB.query(`
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES 
      ('jjp-email-media', 'jjp-email-media', true, 52428800),
      ('jjp-wa-media', 'jjp-wa-media', true, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = true;

    DROP POLICY IF EXISTS "Public Storage B" ON storage.objects;
    CREATE POLICY "Public Storage B" ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true);
    NOTIFY pgrst, 'reload schema';
  `);
  await cB.end();
  console.log('✅ Proyecto B: Buckets y políticas listos');

  // Proyecto C
  const cC = new Client(DS_C);
  await cC.connect();
  await cC.query(`
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES 
      ('jjp-products', 'jjp-products', true, 52428800),
      ('jjp-receipts', 'jjp-receipts', true, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = true;

    DROP POLICY IF EXISTS "Public Storage C" ON storage.objects;
    CREATE POLICY "Public Storage C" ON storage.objects FOR ALL TO public USING (true) WITH CHECK (true);
    NOTIFY pgrst, 'reload schema';
  `);
  await cC.end();
  console.log('✅ Proyecto C: Buckets y políticas listos');
}

setupPolicies().catch(console.error);
