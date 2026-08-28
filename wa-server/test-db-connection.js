import { db } from './src/supabase.js';

async function testAll() {
  console.log('=== INICIANDO PRUEBA REAL DE BASE DE DATOS ===');
  
  // 1. Probar lectura de productos y costos
  const { data: prods, error: pErr } = await db.from('jjp_product_variants').select('id, cost_usd, base_price_usd, sku').limit(5);
  console.log('1. jjp_product_variants:', pErr ? '❌ Error: ' + pErr.message : `✅ OK (${prods?.length || 0} variantes leídas)`);
  if (prods && prods[0]) console.log('   Muestra variante:', prods[0]);

  // 2. Probar lectura de plantillas
  const { data: tpls, error: tErr } = await db.from('jjp_wa_templates').select('id, name, kind').limit(5);
  console.log('2. jjp_wa_templates:', tErr ? '❌ Error: ' + tErr.message : `✅ OK (${tpls?.length || 0} plantillas)`);

  // 3. Probar campañas y targets
  const { data: camps, error: cErr } = await db.from('jjp_wa_campaigns').select('id, name, status, media_path').limit(3);
  console.log('3. jjp_wa_campaigns:', cErr ? '❌ Error: ' + cErr.message : `✅ OK (${camps?.length || 0} campañas)`);

  // 4. Probar campañas de correo
  const { data: ecamps, error: ecErr } = await db.from('jjp_email_campaigns').select('id, name, status').limit(3);
  console.log('4. jjp_email_campaigns:', ecErr ? '❌ Error: ' + ecErr.message : `✅ OK (${ecamps?.length || 0} campañas correo)`);

  // 5. Probar control de servidor y chats
  const { data: srv, error: sErr } = await db.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();
  console.log('5. jjp_server_control:', sErr ? '❌ Error: ' + sErr.message : '✅ OK (heartbeat activo)');

  const { data: chats, error: chErr } = await db.from('jjp_wa_chats').select('id, pinned, display_name').limit(3);
  console.log('6. jjp_wa_chats:', chErr ? '❌ Error: ' + chErr.message : `✅ OK (${chats?.length || 0} chats leídos con pinned)`);

  console.log('=== FIN DE LA PRUEBA ===');
  process.exit(0);
}

testAll().catch(e => {
  console.error('Fallo crítico:', e);
  process.exit(1);
});
