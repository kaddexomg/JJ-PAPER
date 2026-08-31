const { Client } = require('pg');
const SR = { host:'aws-0-us-west-2.pooler.supabase.com', port:5432, user:'postgres.czzvsqnmxtjzqzioknnn', password:'Samily*30909109', database:'postgres', ssl:{rejectUnauthorized:false} };
const DS = { host:'aws-0-us-east-2.pooler.supabase.com', port:5432, user:'postgres.qxgdrfkobbhdzgtoiavv', password:'30909109KJSP', database:'postgres', ssl:{rejectUnauthorized:false} };
(async () => {
  const src = new Client(SR); await src.connect();
  const dst = new Client(DS); await dst.connect();
  const views = await src.query(`select c.relname as name, pg_get_viewdef(c.oid, true) as def
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v' and c.relname in
    ('jjp_count_conflicts','jjp_count_counters','jjp_count_log_view','jjp_count_totals','jjp_count_valued') order by c.relname`);
  for (const v of views.rows) {
    try {
      await dst.query(`create or replace view public.${v.name} as\n${v.def}`);
      console.log('OK view '+v.name);
    } catch (e) { console.log('FAIL view '+v.name+'\n  '+e.message.slice(0,200)); }
  }
  await src.end(); await dst.end();
})().catch(e=>console.log('ERR',e.message));
