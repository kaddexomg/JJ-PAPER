import { db } from './src/supabase.js';

async function testCampaignInsert() {
  console.log('=== PROBANDO CREACIÓN REAL DE CAMPAÑA ===');
  
  // 1. Obtener un usuario de prueba (admin o vendedor)
  const { data: prof, error: prErr } = await db.from('jjp_profiles').select('id, name').limit(1).single();
  if (prErr || !prof) {
    console.error('No se pudo obtener perfil:', prErr);
    process.exit(1);
  }
  console.log('Usuario de prueba:', prof.name, `(${prof.id})`);

  // 2. Insertar una campaña de prueba
  const { data: camp, error: cErr } = await db.from('jjp_wa_campaigns').insert({
    owner_id: prof.id,
    created_by: prof.id,
    name: 'Campaña de Prueba Diagnóstico',
    body: 'Hola {{nombre}}, prueba de sistema.',
    message: 'Hola {{nombre}}, prueba de sistema.',
    status: 'pending',
    total: 1,
    total_count: 1
  }).select('id').single();

  if (cErr) {
    console.error('❌ Error creando campaña:', cErr.message);
    process.exit(1);
  }
  console.log('✅ Campaña creada exitosamente con ID:', camp.id);

  // 3. Insertar target
  const { error: tErr } = await db.from('jjp_wa_campaign_targets').insert({
    campaign_id: camp.id,
    owner_id: prof.id,
    phone: '04121234567',
    name: 'Cliente Prueba',
    status: 'pending',
    vars: { nombre: 'Cliente' }
  });

  if (tErr) {
    console.error('❌ Error insertando target:', tErr.message);
    process.exit(1);
  }
  console.log('✅ Destinatario insertado exitosamente.');

  // 4. Limpiar prueba
  await db.from('jjp_wa_campaigns').delete().eq('id', camp.id);
  console.log('✅ Registro de prueba limpiado.');
  console.log('=== CONCLUSIÓN: LA INSERCIÓN DE CAMPAÑAS FUNCIONA 100% ===');
  process.exit(0);
}

testCampaignInsert().catch(e => {
  console.error('Fallo en test:', e);
  process.exit(1);
});
