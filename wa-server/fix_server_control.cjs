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
  console.log('Conectado a Proyecto B...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.jjp_server_control (
      id INT PRIMARY KEY DEFAULT 1,
      command TEXT,
      command_at TIMESTAMPTZ,
      command_by UUID,
      command_res TEXT,
      heartbeat_at TIMESTAMPTZ,
      status TEXT DEFAULT 'stopped',
      version TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS command TEXT;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS command_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS command_by UUID;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS command_res TEXT;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'stopped';
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS version TEXT;
    ALTER TABLE public.jjp_server_control ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

    -- Insert row 1 if not exists
    INSERT INTO public.jjp_server_control (id, status, heartbeat_at)
    VALUES (1, 'running', now())
    ON CONFLICT (id) DO NOTHING;

    -- Permisos
    GRANT ALL ON public.jjp_server_control TO anon, authenticated, service_role;

    ALTER TABLE public.jjp_server_control REPLICA IDENTITY FULL;
    DO $$
    BEGIN
      BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_server_control;
      EXCEPTION WHEN duplicate_object THEN END;
    END $$;

    NOTIFY pgrst, 'reload schema';
  `);

  const res = await client.query(`SELECT * FROM public.jjp_server_control WHERE id = 1;`);
  console.log('Registro jjp_server_control:', res.rows[0]);

  await client.end();
  console.log('✅ Esquema jjp_server_control actualizado');
}

run().catch(console.error);
