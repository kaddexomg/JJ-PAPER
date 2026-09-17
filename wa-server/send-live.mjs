import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const TEST_PHONE = process.argv[2];          // número local ej 04141234567 o 584141234567
const OWNER = '24fd4fb8-e291-4ff9-8b77-83c2e842d502';

if (!TEST_PHONE) { console.log('uso: node send-live.mjs <telefono>'); process.exit(1); }

// normalizar
let d = String(TEST_PHONE).replace(/\D/g,'');
if (d.startsWith('0') && d.length===11) d = '58'+d.slice(1);
else if (d.length===10 && /^[24]/.test(d)) d = '58'+d;
if (!/^58\d{10}$/.test(d)) { console.log('número inválido: '+TEST_PHONE); process.exit(1); }
const jid = d + '@s.whatsapp.net';
const phoneLocal = '0' + d.slice(2);

// asegurar chat
const { data: chat, error: ce } = await db.from('jjp_wa_chats')
  .upsert({ owner_id: OWNER, jid, phone: phoneLocal, display_name: 'PRUEBA LMS' },
    { onConflict: 'owner_id,jid', ignoreDuplicates: false }).select('id').single();
if (ce) { console.log('chat ERR: '+ce.message); process.exit(1); }

const body = `PRUEBA ${new Date().toISOString()} - si recibes esto, el envío real funciona.`;
const { data: msg, error: me } = await db.from('jjp_wa_messages')
  .insert({ chat_id: chat.id, owner_id: OWNER, direction:'out', type:'text', body, status:'pending' })
  .select('id').single();
if (me) { console.log('insert ERR: '+me.message); process.exit(1); }

console.log(`insertado mensaje ${msg.id} hacia ${jid}`);
console.log('esperando a que outbox lo envíe (max 45s)...');

const start = Date.now();
while (Date.now() - start < 45000) {
  const { data: m } = await db.from('jjp_wa_messages')
    .select('id,status,error,wa_msg_id,wa_timestamp').eq('id', msg.id).single();
  const st = m ? `${m.status} wa=${m.wa_msg_id||'NULL'} err=${m.error||'-'}` : 'no encontrado';
  console.log(`  [${Math.round((Date.now()-start)/1000)}s] ${st}`);
  if (m && (m.status==='sent' || m.status==='delivered' || m.status==='read' || m.status==='failed')) break;
  await new Promise(r=>setTimeout(r, 3000));
}
process.exit(0);
