const { Client } = require('pg');
const c = new Client({ host:'aws-0-us-west-2.pooler.supabase.com', port:5432, user:'postgres.czzvsqnmxtjzqzioknnn', password:'Samily*30909109', database:'postgres', ssl:{rejectUnauthorized:false} });
(async () => {
  await c.connect();
  const rels = await c.query(`
    select c.relname, c.relkind, obj_description(c.oid) as comment
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m','f')
    order by c.relkind, c.relname`);
  console.log('=== VIEWS/MATERIALIZED/FOREIGN (relkind v/m/f) ===');
  rels.rows.forEach(r=>console.log(r.relkind+'\t'+r.relname));

  const funcs = await c.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
    order by p.proname`);
  console.log('\n=== FUNCIONES (prokind f) total='+funcs.rows.length+' ===');
  funcs.rows.forEach(r=>console.log(r.proname+'('+r.args+')'));

  const trg = await c.query(`
    select t.tgname, c.relname as table_name
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal
    order by c.relname`);
  console.log('\n=== TRIGGERS (no internos) total='+trg.rows.length+' ===');
  trg.rows.forEach(r=>console.log(r.table_name+'\t'+r.tgname));

  const pol = await c.query(`
    select tablename, policyname, cmd
    from pg_policies where schemaname='public'
    order by tablename`);
  console.log('\n=== POLITICAS RLS total='+pol.rows.length+' ===');
  pol.rows.forEach(r=>console.log(r.tablename+'\t'+r.policyname+'\t'+r.cmd));
  await c.end();
})().catch(e=>console.log('ERR',e.message));
