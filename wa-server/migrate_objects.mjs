// Aplica al DESTINO: views, funciones, triggers, RLS/policies, indexes, sequences
// del ORIGEN (DDL fiel copiado del catalogo real).
import { Client } from 'pg';

const SR = { host:'aws-0-us-west-2.pooler.supabase.com', port:5432, user:'postgres.czzvsqnmxtjzqzioknnn', password:'Samily*30909109', database:'postgres', ssl:{rejectUnauthorized:false} };
const DS = { host:'aws-0-us-east-2.pooler.supabase.com', port:5432, user:'postgres.qxgdrfkobbhdzgtoiavv', password:'30909109KJSP', database:'postgres', ssl:{rejectUnauthorized:false} };

async function q(c, sql, p){ const r = await c.query(sql, p); return r.rows; }

const ok = [];
const fail = [];
async function run(dst, label, sql) {
  try { await dst.query(sql); ok.push(label); }
  catch (e) { fail.push(label + ' :: ' + e.message.split('\n')[0].slice(0,140)); }
}

async function main() {
  const src = new Client(SR); await src.connect();
  const dst = new Client(DS); await dst.connect();

  // 1) VIEWS
  const views = await q(src, `select c.relname as name, pg_get_viewdef(c.oid, true) as def
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='v' order by c.relname`);
  for (const v of views) {
    await run(dst, 'view ' + v.name, `create or replace view public.${v.name} as\n${v.def}`);
  }

  // 2) FUNCIONES (solo las que no son triggers internos; incluye todas prokind f)
  const funcs = await q(src, `select p.oid,
      pg_get_function_identity_arguments(p.oid) as args,
      p.prorettype, p.prokind
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' order by p.proname`);
  for (const f of funcs) {
    const defs = await q(src, `select pg_get_functiondef($1) as d`, [f.oid]);
    const def = defs[0].d;
    await run(dst, 'func ' + (def.match(/function\s+([^(]+)/)?.[1]?.trim()), def);
  }

  // 3) TRIGGERS + sus funciones trigger
  const trg = await q(src, `select t.tgname, c.relname as tbl,
      pg_get_triggerdef(t.oid, true) as d
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by c.relname`);
  for (const t of trg) {
    await run(dst, 'trigger ' + t.tgname, t.d);
  }

  // 4) SEQUENCES
  const seqs = await q(src, `select c.relname as name, pg_get_serial_sequence('public.'||c.relname,'') as x
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='S'`);
  // (las sequences suelen ir ligadas a serial en tablas ya creadas)

  // 5) INDEXES (no de constraint PK para evitar duplicados)
  const idxs = await q(src, `select i.relname as name, pg_get_indexdef(i.oid) as d, pg_get_indexdef(i.oid,0,true) as short
    from pg_class i join pg_index ix on ix.indexrelid=i.oid
    join pg_class t on t.oid=ix.indrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and not ix.indisprimary and i.relname not like '%_pkey'
    order by t.relname`);
  const seenIdx = new Set();
  for (const idx of idxs) {
    const base = idx.d.split('(')[0];
    if (seenIdx.has(base)) continue;
    seenIdx.add(base);
    await run(dst, 'index ' + idx.name, idx.d);
  }

  // 6) RLS: habilitar + policies
  // 6a. habilitar rls en todas las tablas que lo tienen
  const rlsTables = await q(src, `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity=true`);
  for (const t of rlsTables) { await run(dst, 'rls ' + t.relname, `alter table public.${t.relname} enable row level security`); }
  // 6b. policies exactas
  const pols = await q(src, `select polname, polrelid::regclass::text as tbl,
      polcmd, polpermissive,
      pg_get_expr(polqual, polrelid) as using_expr,
      pg_get_expr(polwithcheck, polrelid) as check_expr,
      (select coalesce(string_agg(rolname, ','), '') from unnest(polroles) r join pg_roles on oid=r)
    from pg_policy where polrelid::regclass::text like 'public.%' order by tbl, polname`);
  for (const p of pols) {
    const tbl = p.tbl.replace('public.','');
    const cmd = ['ALL','SELECT','INSERT','UPDATE','DELETE'][p.polcmd];
    const perm = p.polpermissive ? '' : ' as restrictive';
    const roles = p.roles ? ' to ' + p.roles.split(',')[0].replace(/["']/g,'') + '' : '';
    const rolesClause = p.roles ? ' to ' + p.roles.split(',').map(r=>r).join(',') : '';
    let sql = `create policy "${p.polname}" on public.${tbl}${perm} for ${cmd}${rolesClause}`;
    if (p.using_expr) sql += ` using (${p.using_expr})`;
    if (p.check_expr) sql += ` with check (${p.check_expr})`;
    await run(dst, 'policy ' + tbl + '.' + p.polname, sql);
  }

  console.log('== OK (' + ok.length + ') ==');
  console.log('== FALLO (' + fail.length + ') ==');
  fail.forEach(f => console.log('  ⚠️ ' + f));
  await src.end(); await dst.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
