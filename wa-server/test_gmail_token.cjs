const { Client } = require('pg');

const DS_B = {
  host: 'aws-0-us-east-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.klcibjwleiqppedefpxw',
  password: 'Samily*30909109',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const GOOGLE_CLIENT_ID = '966811384264-4ciph62d7inqh38t90ig98omsa6jj326.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

async function test() {
  const c = new Client(DS_B);
  await c.connect();
  const res = await c.query("SELECT * FROM jjp_email_accounts WHERE profile_id = 'bddc57dc-5bf9-4a72-9e1c-751d07b03164'");
  const acct = res.rows[0];
  console.log('Cuenta encontrada:', acct.email, 'Refresh token:', acct.oauth_refresh ? acct.oauth_refresh.slice(0, 15) + '...' : null);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: acct.oauth_refresh,
      grant_type: 'refresh_token'
    })
  });

  const j = await tokenRes.json();
  console.log('Respuesta de Google OAuth:', {
    status: tokenRes.status,
    ok: tokenRes.ok,
    has_access_token: !!j.access_token,
    error: j.error,
    error_description: j.error_description
  });

  await c.end();
}

test().catch(console.error);
