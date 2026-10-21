import path from 'node:path';
import fs from 'node:fs';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';

for (const compDir of ['M:/MIX11/comp01', 'M:/comp01']) {
  console.log(`\n=================== AUDITING: ${compDir} ===================`);
  if (!fs.existsSync(compDir)) {
    console.log(`Directory ${compDir} does not exist.`);
    continue;
  }

  // 1. Control numbers
  for (const numFile of ['MXNUMCOT.DBF', 'MXNUMPED.DBF']) {
    const fPath = path.join(compDir, numFile);
    if (fs.existsSync(fPath)) {
      const s = readDbfStruct(fPath);
      const rows = readDbfRows(s, s.fields.map(f => f.name), s.numRecords, false);
      console.log(`[${numFile}] records:`, rows);
    }
  }

  // 2. Pedidos Encabezado y Renglones
  const encPedPath = path.join(compDir, 'MXENCPED.DBF');
  if (fs.existsSync(encPedPath)) {
    const s = readDbfStruct(encPedPath);
    console.log(`[MXENCPED.DBF] total records: ${s.numRecords}, field count: ${s.fields.length}`);
    const rows = readDbfRows(s, s.fields.map(f => f.name), 10, true);
    console.log(`Last 10 rows in MXENCPED:`);
    for (const r of rows) {
      console.log(`RecNo: ${r._recNo}, numped: ${r.numped}, emision: ${r.emision}, cliente: ${r.cliente}, codven: ${r.codven}, nomcli: ${r.nomcli}, tot_ped: ${r.tot_ped || r.tot_net || ''}, comen1: ${r.comen1 || ''}`);
    }
  }

  const renPedPath = path.join(compDir, 'MXRENPED.DBF');
  if (fs.existsSync(renPedPath)) {
    const s = readDbfStruct(renPedPath);
    console.log(`[MXRENPED.DBF] total records: ${s.numRecords}`);
    const rows = readDbfRows(s, s.fields.map(f => f.name), 10, true);
    console.log(`Last 10 rows in MXRENPED:`);
    for (const r of rows) {
      console.log(`RecNo: ${r._recNo}, numped: ${r.numped}, item: ${r.item}, cantidad: ${r.cantidad}, despacho: ${r.despacho}, precio: ${r.precio}, tot_ren: ${r.tot_ren}, iva: ${r.iva}, codven: ${r.codven}`);
    }
  }

  // 3. Cotizaciones Encabezado
  const encCotPath = path.join(compDir, 'MXENCCOT.DBF');
  if (fs.existsSync(encCotPath)) {
    const s = readDbfStruct(encCotPath);
    console.log(`[MXENCCOT.DBF] total records: ${s.numRecords}`);
    const rows = readDbfRows(s, s.fields.map(f => f.name), 10, true);
    console.log(`Last 10 rows in MXENCCOT:`);
    for (const r of rows) {
      console.log(`RecNo: ${r._recNo}, numcot: ${r.numcot}, emision: ${r.emision}, cliente: ${r.cliente}, codven: ${r.codven}, nomcli: ${r.nomcli}, tot_cot: ${r.tot_cot || ''}, comen1: ${r.comen1 || ''}`);
    }
  }

  // 4. Cotizaciones Renglones
  const renCotPath = path.join(compDir, 'MXRENCOT.DBF');
  if (fs.existsSync(renCotPath)) {
    const s = readDbfStruct(renCotPath);
    console.log(`[MXRENCOT.DBF] total records: ${s.numRecords}`);
    const rows = readDbfRows(s, s.fields.map(f => f.name), 10, true);
    console.log(`Last 10 rows in MXRENCOT:`);
    for (const r of rows) {
      console.log(`RecNo: ${r._recNo}, numcot: ${r.numcot}, item: ${r.item}, cantidad: ${r.cantidad}, despacho: ${r.despacho}, precio: ${r.precio}, tot_ren: ${r.tot_ren}, iva: ${r.iva}, codven: ${r.codven}`);
    }
  }
}
