const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbComms = createClient(process.env.SUPABASE_URL_COMM, process.env.SUPABASE_SERVICE_ROLE_KEY_COMM);
const dbCore = createClient(process.env.SUPABASE_URL_CORE, process.env.SUPABASE_SERVICE_ROLE_KEY_CORE);

const ANDREINA_OLD = 'b0cd93c5-e2f0-4322-9d35-e374109d284f';
const ANDREINA_NEW = '68c29cd3-760a-4282-8214-4e7c60413ec5';

const MARIANELA_OLD = 'd9608291-1363-4790-a7b0-0d6fd426564f';
const MARIANELA_NEW = '3c9b7ddd-4b98-45c6-a646-5c557a2bc043';

async function consolidate() {
  console.log('=== INICIANDO CONSOLIDACIÓN DE PERFILES ===\n');

  // 1. Core: jjp_customers
  console.log('1. Migrando jjp_customers...');
  const { data: cA, error: errCA } = await dbCore.from('jjp_customers')
    .update({ seller_id: ANDREINA_NEW })
    .eq('seller_id', ANDREINA_OLD)
    .select('id');
  console.log(`   - Clientes de Andreina reasignados: ${cA ? cA.length : 0} (Error: ${errCA?.message || 'ninguno'})`);

  const { data: cM, error: errcM } = await dbCore.from('jjp_customers')
    .update({ seller_id: MARIANELA_NEW })
    .eq('seller_id', MARIANELA_OLD)
    .select('id');
  console.log(`   - Clientes de Marianela reasignados: ${cM ? cM.length : 0} (Error: ${errcM?.message || 'ninguno'})`);

  // 2. Core: jjp_quotes
  console.log('2. Migrando jjp_quotes...');
  const { data: qA } = await dbCore.from('jjp_quotes').update({ seller_id: ANDREINA_NEW }).eq('seller_id', ANDREINA_OLD).select('id');
  console.log(`   - Cotizaciones de Andreina reasignadas: ${qA ? qA.length : 0}`);
  const { data: qM } = await dbCore.from('jjp_quotes').update({ seller_id: MARIANELA_NEW }).eq('seller_id', MARIANELA_OLD).select('id');
  console.log(`   - Cotizaciones de Marianela reasignadas: ${qM ? qM.length : 0}`);

  // 3. Core: jjp_orders
  console.log('3. Migrando jjp_orders...');
  const { data: oA } = await dbCore.from('jjp_orders').update({ seller_id: ANDREINA_NEW }).eq('seller_id', ANDREINA_OLD).select('id');
  console.log(`   - Pedidos de Andreina reasignados: ${oA ? oA.length : 0}`);
  const { data: oM } = await dbCore.from('jjp_orders').update({ seller_id: MARIANELA_NEW }).eq('seller_id', MARIANELA_OLD).select('id');
  console.log(`   - Pedidos de Marianela reasignados: ${oM ? oM.length : 0}`);

  // 4. Core: jjp_profiles
  console.log('4. Actualizando jjp_profiles...');
  await dbCore.from('jjp_profiles').update({
    name: 'ANDREINA JJ VENTAS',
    role: 'vendedor',
    active: true,
    ref_code: 'andreina'
  }).eq('id', ANDREINA_NEW);

  await dbCore.from('jjp_profiles').update({
    name: 'MANIANELA VENTAS JJ',
    role: 'vendedor',
    active: true,
    ref_code: 'marianela08'
  }).eq('id', MARIANELA_NEW);

  // Eliminar perfiles fantasma
  await dbCore.from('jjp_profiles').delete().eq('id', ANDREINA_OLD);
  await dbCore.from('jjp_profiles').delete().eq('id', MARIANELA_OLD);
  console.log('   - Perfiles fantasma eliminados de jjp_profiles.');

  // 5. Comms: jjp_wa_chats
  console.log('5. Migrando jjp_wa_chats...');
  const { data: wcA } = await dbComms.from('jjp_wa_chats').update({ owner_id: ANDREINA_NEW }).eq('owner_id', ANDREINA_OLD).select('id');
  console.log(`   - Chats de Andreina reasignados: ${wcA ? wcA.length : 0}`);
  const { data: wcM } = await dbComms.from('jjp_wa_chats').update({ owner_id: MARIANELA_NEW }).eq('owner_id', MARIANELA_OLD).select('id');
  console.log(`   - Chats de Marianela reasignados: ${wcM ? wcM.length : 0}`);

  // 6. Comms: jjp_wa_messages
  console.log('6. Migrando jjp_wa_messages...');
  const { data: wmA } = await dbComms.from('jjp_wa_messages').update({ owner_id: ANDREINA_NEW }).eq('owner_id', ANDREINA_OLD).select('id');
  console.log(`   - Mensajes de Andreina reasignados: ${wmA ? wmA.length : 0}`);
  const { data: wmM } = await dbComms.from('jjp_wa_messages').update({ owner_id: MARIANELA_NEW }).eq('owner_id', MARIANELA_OLD).select('id');
  console.log(`   - Mensajes de Marianela reasignados: ${wmM ? wmM.length : 0}`);

  // 7. Comms: jjp_wa_campaigns y targets
  console.log('7. Migrando jjp_wa_campaigns...');
  await dbComms.from('jjp_wa_campaigns').update({ owner_id: ANDREINA_NEW }).eq('owner_id', ANDREINA_OLD);
  await dbComms.from('jjp_wa_campaigns').update({ owner_id: MARIANELA_NEW }).eq('owner_id', MARIANELA_OLD);
  await dbComms.from('jjp_wa_campaign_targets').update({ owner_id: ANDREINA_NEW }).eq('owner_id', ANDREINA_OLD);
  await dbComms.from('jjp_wa_campaign_targets').update({ owner_id: MARIANELA_NEW }).eq('owner_id', MARIANELA_OLD);

  // 8. Comms: jjp_wa_sessions
  console.log('8. Actualizando jjp_wa_sessions...');
  // Copiar estado conectado de Andreina a su ID real
  const { data: oldWaA } = await dbComms.from('jjp_wa_sessions').select('*').eq('profile_id', ANDREINA_OLD).single();
  if (oldWaA) {
    await dbComms.from('jjp_wa_sessions').upsert({
      profile_id: ANDREINA_NEW,
      status: oldWaA.status || 'connected',
      wa_number: oldWaA.wa_number || '584122911237',
      wa_name: oldWaA.wa_name || '😍Andreina😍',
      last_connected_at: oldWaA.last_connected_at || new Date().toISOString(),
      last_error: null,
      enabled: true
    }, { onConflict: 'profile_id' });
    await dbComms.from('jjp_wa_sessions').delete().eq('profile_id', ANDREINA_OLD);
    console.log('   - Sesión WA de Andreina migrada a UID real.');
  }

  const { data: oldWaM } = await dbComms.from('jjp_wa_sessions').select('*').eq('profile_id', MARIANELA_OLD).single();
  if (oldWaM) {
    await dbComms.from('jjp_wa_sessions').upsert({
      profile_id: MARIANELA_NEW,
      status: oldWaM.status || 'logged_out',
      wa_number: oldWaM.wa_number || '584142868513',
      wa_name: oldWaM.wa_name || 'Nela Bermudez',
      last_connected_at: oldWaM.last_connected_at,
      last_error: null,
      enabled: true
    }, { onConflict: 'profile_id' });
    await dbComms.from('jjp_wa_sessions').delete().eq('profile_id', MARIANELA_OLD);
    console.log('   - Sesión WA de Marianela migrada a UID real.');
  }

  // 9. Comms: jjp_email_accounts (eliminar cuentas fantasma obsoletas)
  console.log('9. Depurando cuentas duplicadas en jjp_email_accounts...');
  await dbComms.from('jjp_email_accounts').delete().eq('profile_id', ANDREINA_OLD);
  await dbComms.from('jjp_email_accounts').delete().eq('profile_id', MARIANELA_OLD);
  console.log('   - Cuentas de correo obsoletas eliminadas.');

  // 10. Mover carpetas de sesión en disco
  console.log('10. Moviendo directorios de sesión en disco...');
  const dirAndreinaOld = path.join(__dirname, 'sessions', ANDREINA_OLD);
  const dirAndreinaNew = path.join(__dirname, 'sessions', ANDREINA_NEW);
  if (fs.existsSync(dirAndreinaOld)) {
    if (fs.existsSync(dirAndreinaNew)) {
      fs.rmSync(dirAndreinaNew, { recursive: true, force: true });
    }
    fs.renameSync(dirAndreinaOld, dirAndreinaNew);
    console.log(`   - Carpeta de Andreina movida: ${ANDREINA_OLD} -> ${ANDREINA_NEW}`);
  }

  const dirMarianelaOld = path.join(__dirname, 'sessions', MARIANELA_OLD);
  const dirMarianelaNew = path.join(__dirname, 'sessions', MARIANELA_NEW);
  if (fs.existsSync(dirMarianelaOld)) {
    if (fs.existsSync(dirMarianelaNew)) {
      fs.rmSync(dirMarianelaNew, { recursive: true, force: true });
    }
    fs.renameSync(dirMarianelaOld, dirMarianelaNew);
    console.log(`   - Carpeta de Marianela movida: ${MARIANELA_OLD} -> ${MARIANELA_NEW}`);
  }

  console.log('\n=== CONSOLIDACIÓN COMPLETADA CON ÉXITO ===');
}

consolidate().catch(e => console.error('Error fatal en consolidación:', e));
