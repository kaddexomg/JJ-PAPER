const { Client } = require('pg');
const c = new Client({ host:'aws-0-us-west-2.pooler.supabase.com', port:5432, user:'postgres.czzvsqnmxtjzqzioknnn', password:'Samily*30909109', database:'postgres', ssl:{rejectUnauthorized:false} });
(async () => {
  await c.connect();
  for (const t of ['jjp_email_accounts','jjp_email_company','jjp_customers']) {
    console.log('=== '+t+' ===');
    const r = await c.query(`select a.attname, format_type(a.atttypid,a.atttypmod) as type, a.attgenerated,
      (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum) as def
      from pg_attribute a where a.attrelid=('public.'||quote_ident($1))::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`, [t]);
    r.rows.forEach(x=>console.log('  '+x.attname+' : '+x.type+'  gen='+(x.attgenerated||'-')+'  def='+(x.def||'-')));
  }
  await c.end();
})().catch(e=>console.log('ERR',e.message));
