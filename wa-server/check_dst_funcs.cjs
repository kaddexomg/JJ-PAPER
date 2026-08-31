const { Client } = require('pg');
const c = new Client({ host:'aws-0-us-east-2.pooler.supabase.com', port:5432, user:'postgres.qxgdrfkobbhdzgtoiavv', password:'30909109KJSP', database:'postgres', ssl:{rejectUnauthorized:false} });
(async () => {
  await c.connect();
  const r = await c.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname`);
  console.log('Funciones en DESTINO ('+r.rows.length+'):');
  r.rows.forEach(x=>console.log('  '+x.proname+'('+x.args+')'));
  await c.end();
})().catch(e=>console.log('ERR',e.message));
