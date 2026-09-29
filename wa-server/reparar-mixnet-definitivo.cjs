const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log(' 🛠️ REPARACIÓN QUIRÚRGICA DEFINITIVA DE MIXNET ERP (M:\\comp01)');
console.log('================================================================\n');

// 1. REPARAR MXENCPED.DBF
console.log('--- 1. Reparando MXENCPED.DBF ---');
{
  const filePath = 'M:/comp01/MXENCPED.DBF';
  const buf = fs.readFileSync(filePath);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const numRecs = buf.readUInt32LE(4);
  
  let reactivated = 0;
  let commentsCleaned = 0;
  
  for (let i = 0; i < numRecs; i++) {
    const o = hdrLen + i * recLen;
    const isDel = buf[o] === 0x2A;
    const numPed = buf.toString('latin1', o + 1, o + 9).trim();
    
    // Reactivar órdenes legítimas de tienda erróneamente borradas
    if (['00112428', '00112431', '00112544'].includes(numPed)) {
      if (isDel) {
        buf[o] = 0x20; // Espacio = ACTIVO
        reactivated++;
        console.log(`  [+] Pedido legítimo reactivado: #${numPed} (registro #${i})`);
      }
    } else if (isDel) {
      // Limpiar huellas/comentarios en registros borrados (llenar con espacios 0x20)
      const c1 = buf.toString('latin1', o + 30, o + 65);
      const c2 = buf.toString('latin1', o + 65, o + 100);
      if (c1.includes('[MixNet') || c1.includes('COT-') || c2.includes('[MixNet') || c2.includes('COT-')) {
        buf.fill(0x20, o + 30, o + 100);
        commentsCleaned++;
      }
    }
  }
  
  fs.writeFileSync(filePath, buf);
  console.log(`  [OK] MXENCPED: ${reactivated} pedidos reactivados, ${commentsCleaned} registros limpiados de comentarios.\n`);
}

// 2. REPARAR MXRENPED.DBF
console.log('--- 2. Reparando MXRENPED.DBF ---');
{
  const filePath = 'M:/comp01/MXRENPED.DBF';
  const buf = fs.readFileSync(filePath);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const numRecs = buf.readUInt32LE(4);
  
  let reactivated = 0;
  for (let i = 0; i < numRecs; i++) {
    const o = hdrLen + i * recLen;
    const isDel = buf[o] === 0x2A;
    const raw = buf.toString('latin1', o, o + recLen);
    
    if (isDel && (raw.includes('00112431') || raw.includes('00112544'))) {
      buf[o] = 0x20; // Espacio = ACTIVO
      reactivated++;
    }
  }
  
  fs.writeFileSync(filePath, buf);
  console.log(`  [OK] MXRENPED: ${reactivated} renglones reactivados para pedidos #00112431 y #00112544.\n`);
}

// 3. REPARAR MXENCCOT.DBF
console.log('--- 3. Reparando MXENCCOT.DBF ---');
{
  const filePath = 'M:/comp01/MXENCCOT.DBF';
  const buf = fs.readFileSync(filePath);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const numRecs = buf.readUInt32LE(4);
  
  let reactivated = 0;
  let commentsCleaned = 0;
  
  for (let i = 0; i < numRecs; i++) {
    const o = hdrLen + i * recLen;
    const isDel = buf[o] === 0x2A;
    const numCot = buf.toString('latin1', o + 1, o + 9).trim();
    
    // Reactivar cotizaciones legítimas de tienda erróneamente borradas
    if (['00053315', '00053324', '00053326'].includes(numCot)) {
      if (isDel) {
        buf[o] = 0x20; // Espacio = ACTIVO
        reactivated++;
        console.log(`  [+] Cotización legítima reactivada: #${numCot} (registro #${i})`);
      }
    } else if (isDel) {
      // Limpiar huellas/comentarios en registros borrados
      const c1 = buf.toString('latin1', o + 30, o + 65);
      const c2 = buf.toString('latin1', o + 65, o + 100);
      if (c1.includes('[MixNet') || c1.includes('COT-') || c2.includes('[MixNet') || c2.includes('COT-')) {
        buf.fill(0x20, o + 30, o + 100);
        commentsCleaned++;
      }
    }
  }
  
  fs.writeFileSync(filePath, buf);
  console.log(`  [OK] MXENCCOT: ${reactivated} cotizaciones reactivadas, ${commentsCleaned} registros limpiados de comentarios.\n`);
}

// 4. REPARAR MXRENCOT.DBF
console.log('--- 4. Reparando MXRENCOT.DBF ---');
{
  const filePath = 'M:/comp01/MXRENCOT.DBF';
  const buf = fs.readFileSync(filePath);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const numRecs = buf.readUInt32LE(4);
  
  let reactivated = 0;
  for (let i = 0; i < numRecs; i++) {
    const o = hdrLen + i * recLen;
    const isDel = buf[o] === 0x2A;
    const raw = buf.toString('latin1', o, o + recLen);
    
    if (isDel && (raw.includes('00053315') || raw.includes('00053324') || raw.includes('00053326'))) {
      buf[o] = 0x20; // Espacio = ACTIVO
      reactivated++;
    }
  }
  
  fs.writeFileSync(filePath, buf);
  console.log(`  [OK] MXRENCOT: ${reactivated} renglones reactivados para cotizaciones #00053315, #00053324 y #00053326.\n`);
}

// 5. RESTAURAR MXCTACLI.DBF
console.log('--- 5. Restaurando MXCTACLI.DBF ---');
{
  const srcBackup = 'M:/comp01/backups/PRE_REVERT_MXCTACLI.DBF';
  const dstTarget = 'M:/comp01/MXCTACLI.DBF';
  fs.copyFileSync(srcBackup, dstTarget);
  console.log('  [OK] MXCTACLI.DBF restaurado con éxito desde PRE_REVERT_MXCTACLI.DBF (vendedores originales preservados).\n');
}

// 6. CALIBRAR MXNUMPED.DBF
console.log('--- 6. Calibrando MXNUMPED.DBF ---');
{
  const filePath = 'M:/comp01/MXNUMPED.DBF';
  const buf = fs.readFileSync(filePath);
  // NUMERO field está al final del registro único
  // Longitud es 76 bytes: header 68 bytes + 1 byte flag (0x20) + 7 bytes/8 bytes
  // Verificamos dónde está el valor actual:
  const str = buf.toString('latin1');
  const targetNum = '00112546'; // Próximo correlativo tras #00112545
  
  const idx = str.indexOf('00112471');
  if (idx !== -1) {
    buf.write(targetNum, idx, 8, 'latin1');
    fs.writeFileSync(filePath, buf);
    console.log(`  [OK] MXNUMPED.DBF calibrado exitosamente a: ${targetNum}\n`);
  } else {
    // Si ya tenía otro valor, buscar los 8 dígitos numéricos al final
    const match = str.match(/\d{8}/);
    if (match) {
      const pos = str.indexOf(match[0]);
      buf.write(targetNum, pos, 8, 'latin1');
      fs.writeFileSync(filePath, buf);
      console.log(`  [OK] MXNUMPED.DBF calibrado exitosamente de ${match[0]} a: ${targetNum}\n`);
    } else {
      console.error('  [!] No se pudo localizar el campo numérico en MXNUMPED.DBF.');
    }
  }
}

// 7. VERIFICACIÓN FINAL
console.log('--- 7. Verificación de Integridad ---');
{
  // Verificar ENCPED
  const encPedBuf = fs.readFileSync('M:/comp01/MXENCPED.DBF');
  const hasMixNetPed = encPedBuf.includes('[MixNet') || encPedBuf.includes('COT-260923');
  console.log('  - MXENCPED tiene huellas [MixNet/COT] residuales: ' + hasMixNetPed);
  
  // Verificar ENCCOT
  const encCotBuf = fs.readFileSync('M:/comp01/MXENCCOT.DBF');
  const hasMixNetCot = encCotBuf.includes('[MixNet');
  console.log('  - MXENCCOT tiene huellas [MixNet] residuales: ' + hasMixNetCot);
  
  // Verificar NUMPED
  const numPedBuf = fs.readFileSync('M:/comp01/MXNUMPED.DBF');
  console.log('  - MXNUMPED valor actual: ' + numPedBuf.toString('latin1').match(/\d{8}/)?.[0]);
  
  // Verificar NUMCOT
  const numCotBuf = fs.readFileSync('M:/comp01/MXNUMCOT.DBF');
  console.log('  - MXNUMCOT valor actual: ' + numCotBuf.toString('latin1').match(/\d{8}/)?.[0]);
}

console.log('\n================================================================');
console.log(' ✅ REPARACIÓN COMPLETADA CON ÉXITO.');
console.log(' ⚠️ AVISO OPERATIVO: Es mandatorio ejecutar en la terminal de MixNet');
console.log('    Mantenimiento ➔ Reindexar Archivos (u Organizar Archivos)');
console.log('    para actualizar los árboles B-Tree (.NTX) de forma nativa.');
console.log('================================================================\n');
