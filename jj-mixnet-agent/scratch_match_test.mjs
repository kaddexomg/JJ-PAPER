import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbGet } from './supabase-client.js';

export function cleanRif(raw) {
  if (!raw) return '';
  const str = String(raw).trim().toUpperCase();
  // Caso con guión antes del dígito verificador: ej. J-40678577-6 o V-01875469-0
  const m = str.match(/^[JVGEPC]?[-]?(\d{6,9})[-](\d)$/);
  if (m) {
    return String(parseInt(m[1], 10));
  }
  // Extraer sólo dígitos
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9) {
    // 8 dígitos de cédula/RIF + 1 verificador
    return String(parseInt(digits.slice(0, 8), 10));
  }
  return String(parseInt(digits, 10));
}

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  if (e.length < 6 || !e.includes('@') || !e.includes('.')) return false;
  if (/^(noreply|noemail|sinemail|sincorreo|nocorreo|no@|none@|prueba|test|admin@mixnet)/.test(e)) return false;
  if (e.includes('c.i') || e.includes('rif') || e.includes('tlf') || e.includes('telefono')) return false;
  // Formato basico regex
  return /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(e);
}

async function testFull() {
  const sCli = readDbfStruct('M:/MIX11/comp01/MXCTACLI.DBF');
  const mixRows = readDbfRows(sCli, ['codcli', 'nomcli', 'cif', 'email', 'vendedor', 'zona'], sCli.numRecords, false);
  console.log('Total MixNet clients in DBF:', mixRows.length);

  const mixMap = new Map();
  for (const r of mixRows) {
    const cr = cleanRif(r.cif);
    if (cr && cr !== '0') {
      if (!mixMap.has(cr)) mixMap.set(cr, []);
      mixMap.get(cr).push(r);
    }
  }

  // Cargar todos los clientes de Supabase con paginacion
  let offset = 0;
  const limit = 1000;
  let allCustomers = [];
  while (true) {
    const batch = await sbGet('jjp_customers', `select=id,name,rif,email,notes&limit=${limit}&offset=${offset}&order=id.asc`);
    if (!batch || batch.length === 0) break;
    allCustomers.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  console.log('Total Supabase customers loaded:', allCustomers.length);

  let matched = 0;
  let wouldUpdateNotes = 0;
  let wouldUpdateEmail = 0;
  let alreadyHasMixnetCode = 0;
  let conflicts = 0;
  let noMatch = 0;
  let invalidRif = 0;

  for (const c of allCustomers) {
    const cr = cleanRif(c.rif);
    if (!cr || cr === '0') {
      invalidRif++;
      continue;
    }

    const matches = mixMap.get(cr);
    if (!matches || matches.length === 0) {
      noMatch++;
      continue;
    }

    if (matches.length > 1) {
      conflicts++;
      // Podria ser conflicto o mismo cliente repetido
    }

    matched++;
    const bestMix = matches[0];
    const codcli = String(bestMix.codcli || '').trim();

    // Check notes
    const notesStr = c.notes ? String(c.notes).trim() : '';
    const hasCode = /MixNet[:\s]+[0-9]{3}-[0-9]+/i.test(notesStr) || /Codigo MixNet/i.test(notesStr);
    if (hasCode) {
      alreadyHasMixnetCode++;
    } else {
      wouldUpdateNotes++;
    }

    // Check email
    const mixEmail = String(bestMix.email || '').trim();
    if (isValidEmail(mixEmail)) {
      const supaEmail = String(c.email || '').trim().toLowerCase();
      if (!supaEmail || supaEmail !== mixEmail.toLowerCase()) {
        wouldUpdateEmail++;
      }
    }
  }

  console.log({
    totalCustomers: allCustomers.length,
    matched,
    alreadyHasMixnetCode,
    wouldUpdateNotes,
    wouldUpdateEmail,
    conflicts,
    noMatch,
    invalidRif
  });
}

testFull().catch(console.error);
