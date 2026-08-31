// Copia TODOS los datos (tablas public) del ORIGEN al DESTINO por pg con parámetros.
// - Columnas json/jsonb se leen como ::text y se insertan como texto (server castea a jsonb).
// - Columnas generated (STORED) se excluyen.
// - Resetea secuencias al final.
const { Client } = require('pg');
const SR = { host:'aws-0-us-west-2.pooler.supabase.com', port:5432, user:'postgres.czzvsqnmxtjzqzioknnn', password:'Samily*30909109', database:'postgres', ssl:{rejectUnauthorized:false} };
const DS = { host:'aws-0-us-east-2.pooler.supabase.com', port:5432, user:'postgres.qxgdrfkobbhdzgtoiavv', password:'30909109KJSP', database:'postgres', ssl:{rejectUnauthorized:false} };
(async () => {
  const src = new Client(SR); await src.connect();
  const dst = new Client(DS); await dst.connect();
  await src.query('set statement_timeout = 0');
  await dst.query('set statement_timeout = 0');

  const tables = await src.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'pg_%' order by c.relname`);
  let total = 0;
  for (const t of tables.rows) {
    const name = t.relname;
    const cols = await src.query(`select a.attname, format_type(a.atttypid,a.atttypmod) t
      from pg_attribute a where a.attrelid=('public.'||quote_ident($1))::regclass
      and a.attnum>0 and not a.attisdropped and a.attgenerated='' order by a.attnum`, [name]);
    const defs = cols.rows.map(r => {
      const isJson = /^jsonb?(\[|$)/.test(r.t);
      return { name: r.attname, json: isJson };
    });
    const colList = defs.map(d => d.name).join(', ');
    if (!colList) { console.log('· '+name+': (sin columnas)'); continue; }
    const cnt = await src.query(`select count(*)::int c from public.${name}`);
    const n = cnt.rows[0].c;
    if (!n) { console.log('· '+name+': 0'); continue; }
    const selCols = defs.map(d => d.json ? `"${d.name}"::text as "${d.name}"` : `"${d.name}"`).join(', ');
    const rows = await src.query(`select ${selCols} from public.${name}`);
    await dst.query(`truncate public.${name} cascade`);
    let ins = 0;
    const BATCH = 400;
    for (let i=0;i<rows.rows.length;i+=BATCH){
      const chunk = rows.rows.slice(i,i+BATCH);
      const ph = []; const params = [];
      let pi = 1;
      for (const row of chunk) {
        const rowPh = [];
        for (const d of defs) {
          rowPh.push('$'+pi++);
          let v = row[d.name];
          if (d.json && v !== null && typeof v === 'object') v = JSON.stringify(v);
          params.push(v);
        }
        ph.push('('+rowPh.join(',')+')');
      }
      const sql = `insert into public.${name} (${colList}) values ${ph.join(', ')}`;
      await dst.query(sql, params);
      ins += chunk.length;
    }
    total += ins;
    console.log('✓ '+name+': '+ins);
  }
  const seqs = await src.query(`select s.relname as seq, tc.table_name, a.attname as col
    from pg_class s join pg_depend d on d.objid=s.oid
    join pg_class tc on tc.oid=d.refobjid join pg_namespace n on n.oid=tc.relnamespace
    join pg_attribute a on a.attrelid=tc.oid and a.attnum=d.refobjsubid
    where s.relkind='S' and d.refclassid='pg_class'::regclass and n.nspname='public'`);
  for (const s of seqs.rows) {
    try { await dst.query(`select setval('public.${s.seq}', coalesce((select max("${s.col}") from public.${s.table_name}), 1))`); }
    catch(e){ console.log('   (seq '+s.seq+' -> '+e.message.slice(0,50)); }
  }
  console.log('\nTOTAL FILAS COPIADAS: '+total);
  await src.end(); await dst.end();
})().catch(e=>console.log('FATAL', e.message));
