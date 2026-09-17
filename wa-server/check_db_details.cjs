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
  console.log('Connected to PG A and B');

  // Check jjp_email_campaigns columns in B
  const { rows: ecCols } = await cB.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'jjp_email_campaigns'");
  console.log('jjp_email_campaigns cols in B:', ecCols.map(c => c.column_name));

  // Check jjp_email_campaign_targets cols in B
  const { rows: ectCols } = await cB.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'jjp_email_campaign_targets'");
  console.log('jjp_email_campaign_targets cols in B:', ectCols.map(c => c.column_name));

  // Check storage buckets in B
  const { rows: bBuckets } = await cB.query("SELECT id, name, public FROM storage.buckets");
  console.log('Buckets in B:', bBuckets);

  // Check storage buckets in A
  const { rows: aBuckets } = await cA.query("SELECT id, name, public FROM storage.buckets");
  console.log('Buckets in A:', aBuckets);

  // Check jjp_customers columns in A
  const { rows: custCols } = await cA.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jjp_customers'");
  console.log('jjp_customers cols in A:', custCols.map(c => c.column_name));

  await cA.end();
  await cB.end();
}
test().catch(console.error);
