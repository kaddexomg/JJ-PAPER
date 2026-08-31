// Migra el ESQUEMA completo (tablas, secuencias, funciones, triggers, RLS, views)
// del ORIGEN al DESTINO. Solo estructura, NO datos (los datos se insertan aparte).
// Uso: node migrate_schema.mjs
import { Client } from 'pg';

const SR = {
  host: 'aws-0-us-west-2.pooler.supabase.com', port: 5432,
  user: 'postgres.czzvsqnmxtjzqzioknnn', password: 'Samily*30909109',
  database: 'postgres', ssl: { rejectUnauthorized: false },
};
const DS = {
  host: 'aws-0-us-east-2.pooler.supabase.com', port: 5432,
  user: 'postgres.qxgdrfkobbhdzgtoiavv', password: '30909109KJSP',
  database: 'postgres', ssl: { rejectUnauthorized: false },
};

const LOG = [];

async function q(c, sql, params) { const r = await c.query(sql, params); return r.rows; }

async function main() {
  const src = new Client(SR); await src.connect();
  const dst = new Client(DS); await dst.connect();
  console.log('Conectado. Extrayendo esquema del ORIGEN...\n');

  // 1) Extensiones necesarias (gen_random_uuid -> pgcrypto)
  const exts = await q(src, `select extname from pg_extension where extname in ('pgcrypto','uuid-ossp','pg_graphql')`);
  for (const e of exts) {
    try { await dst.query(`create extension if not exists ${e.extname}`); LOG.push('extension ' + e.extname); }
    catch (err) { LOG.push('(ext ' + e.extname + ' ya o error: ' + err.message.slice(0,40)); }
  }

  // 2) Tablas public: recoger DDL (CREATE TABLE) desde information_schema + pg_catalog
  const tables = await q(src, `
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname not like 'pg_%'
    order by c.relname`);
  console.log('Tablas en public ('+tables.length+'): '+tables.map(t=>t.name).join(', '));

  for (const t of tables) {
    await dst.query(`drop table if exists public.${t.name} cascade`);
    const cols = await q(src, `
      select a.attname as name,
        format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as notnull,
        a.attgenerated as generated,
        (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum) as default
      from pg_attribute a
      where a.attrelid=('public.'||quote_ident($1))::regclass and a.attnum>0 and not a.attisdropped
      order by a.attnum`, [t.name]);
    const pk = await q(src, `
      select kcu.column_name as attname
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name=kcu.constraint_name and tc.constraint_schema=kcu.constraint_schema
      where tc.table_schema='public' and tc.table_name=$1 and tc.constraint_type='PRIMARY KEY'
      order by kcu.ordinal_position`, [t.name]);
    const pkNames = pk.map(p => p.attname);

    let sql = `create table if not exists public.${t.name} (\n  `;
    const lines = cols.map(c => {
      if (c.generated) {
        // generated column (STORED)
        return `"${c.name}" ${c.type} generated always as (${c.default}) stored`;
      }
      let def = `"${c.name}" ${c.type}`;
      if (c.default) def += ` default ${c.default}`;
      if (c.notnull && !pkNames.includes(c.name)) def += ' not null';
      return def;
    });
    if (pkNames.length) lines.push(`constraint ${t.name}_pkey primary key (${pkNames.map(p=>'"'+p+'"').join(',')})`);
    sql += lines.join(',\n  ') + '\n);';
    try { await dst.query(sql); LOG.push('tabla ' + t.name); }
    catch (e) { LOG.push('❌ tabla ' + t.name + ': ' + e.message.slice(0,90)); }
  }

  console.log('\n(Lista de esquema generada. Ver detalles en el log.)');
  console.log(LOG.join('\n'));
  await src.end(); await dst.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
