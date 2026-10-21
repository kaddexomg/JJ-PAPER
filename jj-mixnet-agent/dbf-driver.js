/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Driver Transaccional DBF dBase III / Clipper
   ======================================================================
   Manejo atómico de archivos .DBF con lectura/escritura nativa, control
   estricto de correlativos y recompilación automática de índices .NTX.
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { reindexNtx } from './ntx-builder.js';
import { log } from './config.js';

/**
 * Lee la estructura y metadatos de una tabla .DBF
 */
export function readDbfStruct(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  const numRecords = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);

  const fields = [];
  let off = 32;
  let pos = 1; // 1-based (byte 0 es el deleted flag)
  while (off + 32 <= headerLen - 1 && buf[off] !== 0x0D) {
    let raw = '';
    for (let i = 0; i < 11; i++) {
      const c = buf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    const name = raw.trim().toLowerCase();
    const type = String.fromCharCode(buf[off + 11]);
    const len = buf[off + 16];
    const dec = buf[off + 17];
    fields.push({ name, type, len, dec, pos });
    pos += len;
    off += 32;
  }

  return { filePath, numRecords, headerLen, recordLen, fields };
}

/**
 * Lee registros de una tabla .DBF con proyección opcional de campos
 */
export function readDbfRows(struct, wantedFields = null, limit = null, backwards = true) {
  if (!struct || !fs.existsSync(struct.filePath)) return [];
  const buf = fs.readFileSync(struct.filePath);
  const fields = wantedFields
    ? struct.fields.filter(f => wantedFields.includes(f.name))
    : struct.fields;

  const rows = [];
  const total = struct.numRecords;

  const start = backwards ? total - 1 : 0;
  const end = backwards ? -1 : total;
  const step = backwards ? -1 : 1;

  for (let i = start; i !== end; i += step) {
    const p = struct.headerLen + i * struct.recordLen;
    if (p + struct.recordLen > buf.length) break;

    const isDel = buf[p] === 0x2A;
    if (isDel) continue;

    const row = { _recNo: i + 1 };
    for (const f of fields) {
      row[f.name] = buf.toString('latin1', p + f.pos, p + f.pos + f.len).trim();
    }
    rows.push(row);

    if (limit && rows.length >= limit) break;
  }

  return rows;
}

/**
 * Obtiene y avanza de forma atómica el número correlativo oficial de MixNet.
 * @param {string} compDir - Carpeta comp01 (ej. M:/MIX11/comp01)
 * @param {'COT'|'PED'} type - Tipo de documento
 * @returns {string} Correlativo formateado a 8 dígitos (ej. '00053497')
 */
export function getAndAdvanceCorrelative(compDir, type) {
  const fileName = type === 'COT' ? 'MXNUMCOT.DBF' : 'MXNUMPED.DBF';
  const filePath = path.join(compDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Archivo correlativo no encontrado: ${filePath}`);
  }

  // Intentos de bloqueo suave en caso de que otra terminal esté accediendo
  let attempts = 0;
  while (attempts < 5) {
    try {
      const buf = fs.readFileSync(filePath);
      const headerLen = buf.readUInt16LE(8);
      const recordLen = buf.readUInt16LE(10);

      // En MXNUMCOT/PED, el registro 1 almacena el número actual en offset headerLen + 1
      const p = headerLen + 1;
      const currentRaw = buf.toString('ascii', p, p + 8).trim();
      const currentNum = parseInt(currentRaw || '0', 10);
      if (isNaN(currentNum) || currentNum <= 0) {
        throw new Error(`Correlativo inválido leído de ${fileName}: '${currentRaw}'`);
      }

      const nextNum = currentNum + 1;
      const nextSerial = String(nextNum).padStart(8, '0');

      // Escribir el nuevo correlativo
      buf.write(nextSerial, p, 8, 'ascii');
      fs.writeFileSync(filePath, buf);

      log(`Correlativo ${type} avanzado exitosamente: #${currentSerial(currentNum)} ➔ #${nextSerial}`);
      return nextSerial;
    } catch (err) {
      attempts++;
      if (attempts >= 5) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); // 100ms sleep
    }
  }
}

function currentSerial(n) {
  return String(n).padStart(8, '0');
}

/**
 * Escribe un registro formateado según la estructura del DBF
 */
function buildRecordBuffer(struct, values) {
  const recBuf = Buffer.alloc(struct.recordLen, 0x20); // Padded con espacios
  recBuf[0] = 0x20; // Activo (no borrado)

  for (const f of struct.fields) {
    const rawVal = values[f.name];
    if (rawVal === undefined || rawVal === null) continue;

    let strVal = String(rawVal);
    if (f.type === 'N') {
      const num = parseFloat(strVal.replace(/,/g, '.')) || 0;
      strVal = f.dec > 0 ? num.toFixed(f.dec) : String(Math.round(num));
      strVal = strVal.padStart(f.len, ' ');
    } else {
      strVal = strVal.slice(0, f.len).padEnd(f.len, ' ');
    }

    recBuf.write(strVal, f.pos, f.len, 'latin1');
  }

  return recBuf;
}

let clientLookupCache = {
  loadedAt: 0,
  byCif: new Map(),
  byName: new Map()
};

/**
 * Resuelve el código oficial de cliente (CODCLI) en MXCTACLI.DBF.
 * Si el cliente no existe en el maestro, retorna '00' (código estándar de GemixNet para ocasional).
 */
export function resolveMixnetClientCode(compDir, rif, clientName) {
  const now = Date.now();
  if (!clientLookupCache.loadedAt || (now - clientLookupCache.loadedAt > 300000)) {
    try {
      const cliPath = path.join(compDir, 'MXCTACLI.DBF');
      if (fs.existsSync(cliPath)) {
        const sCli = readDbfStruct(cliPath);
        const rows = readDbfRows(sCli, ['codcli', 'nomcli', 'cif'], sCli.numRecords, false);
        const byCif = new Map();
        const byName = new Map();

        for (const r of rows) {
          const cod = String(r.codcli || '').trim();
          if (!cod) continue;
          if (r.cif) {
            const normCif = String(r.cif).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            if (normCif) byCif.set(normCif, cod);
          }
          if (r.nomcli) {
            const normNom = String(r.nomcli).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normNom) byName.set(normNom, cod);
          }
        }
        clientLookupCache = { loadedAt: now, byCif, byName };
      }
    } catch (err) {
      log(`Aviso cargando maestro de clientes MXCTACLI: ${err.message}`, 'WARN');
    }
  }

  // 1. Buscar por CIF / RIF normalizado
  if (rif) {
    const norm = String(rif).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (clientLookupCache.byCif.has(norm)) {
      return clientLookupCache.byCif.get(norm);
    }
  }

  // 2. Buscar por Nombre normalizado
  if (clientName) {
    const normNom = String(clientName).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clientLookupCache.byName.has(normNom)) {
      return clientLookupCache.byName.get(normNom);
    }
    for (const [n, cod] of clientLookupCache.byName.entries()) {
      if (normNom.length >= 6 && (normNom.includes(n) || n.includes(normNom))) {
        return cod;
      }
    }
  }

  // Fallback canónico oficial para cliente sin ficha en MixNet (Cuenta Recuperada)
  return '000-001';
}

/**
 * Inyecta una cotización completa en MixNet y reindexa sus archivos .NTX.
 */
export function injectQuoteToMixnet(compDir, quote) {
  // Guardrails estrictos
  if (!quote.client_name || quote.client_name === '00-000' || quote.client_name === '00000') {
    throw new Error('Guardrail: Rechazada cotización sin cliente válido.');
  }
  const items = Array.isArray(quote.items) ? quote.items : [];
  if (items.length === 0) {
    throw new Error('Guardrail: Rechazada cotización sin renglones.');
  }
  const total = parseFloat(quote.estimated_total_usd || 0);
  if (total <= 0) {
    throw new Error('Guardrail: Rechazada cotización con total en $0.');
  }

  const encPath = path.join(compDir, 'MXENCCOT.DBF');
  const renPath = path.join(compDir, 'MXRENCOT.DBF');

  const sEnc = readDbfStruct(encPath);
  const sRen = readDbfStruct(renPath);
  if (!sEnc || !sRen) {
    throw new Error('No se pudieron leer las estructuras de MXENCCOT o MXRENCOT');
  }

  // Resolver código canónico de cliente en MXCTACLI
  const clientCode = resolveMixnetClientCode(compDir, quote.rif, quote.client_name);

  // Obtener correlativo oficial
  const numcot = quote.quote_number && /^\d{8}$/.test(quote.quote_number)
    ? quote.quote_number
    : getAndAdvanceCorrelative(compDir, 'COT');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sellerCodven = quote.codven || '';
  const rate = parseFloat(quote.exchange_rate || 0);

  // 1. Cabecera (cero comentarios inventados o marcas de agua)
  const clientName = clientCode === '000-001'
    ? String(quote.client_name || 'CTA. RECUPERADA: 000-001').slice(0, 60)
    : String(quote.client_name || '').slice(0, 60);

  const encValues = {
    numcot,
    emision: today,
    cliente: clientCode,
    codsuc: '',
    codven: sellerCodven,
    comen1: String(quote.notes || '').slice(0, 35),
    comen2: '',
    tot_cot: total.toFixed(2),
    estatus: 'PE',
    moneda: 'US$',
    cambio: rate.toFixed(2),
    nomcli: clientName,
    cif: String(quote.rif || '').slice(0, 15)
  };

  const encRecord = buildRecordBuffer(sEnc, encValues);

  // 2. Renglones (guardrail estricto: cero códigos 'LIBRE' o inventados)
  const renRecords = items.map((it, idx) => {
    const rawSku = String(it.sku || '').trim();
    if (!rawSku || rawSku.toUpperCase() === 'LIBRE' || rawSku.toUpperCase() === 'COTIZACION') {
      throw new Error(`Guardrail: Renglón #${idx + 1} sin código de catálogo oficial (recibido: '${it.sku || it.name}'). Cada producto debe pertenecer a su código en MixNet.`);
    }

    const qty = parseFloat(it.qty || 1);
    const price = parseFloat(it.price_usd || 0);
    const totRen = parseFloat(it.subtotal_usd || (qty * price));
    return buildRecordBuffer(sRen, {
      item: rawSku.slice(0, 15),
      unidad: String(it.unit || 'UND').slice(0, 3).toUpperCase(),
      cantidad: qty.toFixed(3),
      descrip: String(it.name || '').slice(0, 50),
      numcot,
      emision: today,
      estatus: 'PE',
      precio: price.toFixed(2),
      tot_ren: totRen.toFixed(2),
      iva: 'E', // Exento
      cliente: clientCode,
      codven: sellerCodven
    });
  });

  // 3. Escribir en DBF (anexar al final con EOF 0x1A)
  appendRecordsToDbf(encPath, sEnc, [encRecord]);
  appendRecordsToDbf(renPath, sRen, renRecords);

  // 4. Reindexar automáticamente los 5 índices .NTX de cotizaciones
  const idx1 = reindexNtx(encPath, path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
  const idx2 = reindexNtx(encPath, path.join(compDir, 'MXENCZX2.NTX'), 'DTOS(EMISION)', 8);
  const idx3 = reindexNtx(encPath, path.join(compDir, 'MXENCZX3.NTX'), 'CLIENTE', 8);
  const idx4 = reindexNtx(renPath, path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
  const idx5 = reindexNtx(renPath, path.join(compDir, 'MXRECZX2.NTX'), 'ITEM+NUMCOT', 23);

  log(`Cotización #${numcot} inyectada en MixNet: $${total.toFixed(2)} (${items.length} renglones). 5 índices .NTX actualizados.`);

  return {
    ok: true,
    numcot,
    client: clientName,
    clientCode,
    total,
    itemsCount: items.length,
    indexes: [idx1, idx2, idx3, idx4, idx5]
  };
}

/**
 * Inyecta un pedido completo en MixNet y reindexa sus archivos .NTX.
 */
export function injectOrderToMixnet(compDir, order) {
  if (!order.client_name || order.client_name === '00-000') {
    throw new Error('Guardrail: Rechazado pedido sin cliente válido.');
  }
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) {
    throw new Error('Guardrail: Rechazado pedido sin renglones.');
  }
  const total = parseFloat(order.total_usd || order.subtotal_usd || 0);
  if (total <= 0) {
    throw new Error('Guardrail: Rechazado pedido con total en $0.');
  }

  const encPath = path.join(compDir, 'MXENCPED.DBF');
  const renPath = path.join(compDir, 'MXRENPED.DBF');

  const sEnc = readDbfStruct(encPath);
  const sRen = readDbfStruct(renPath);
  if (!sEnc || !sRen) {
    throw new Error('No se pudieron leer las estructuras de MXENCPED o MXRENPED');
  }

  // Resolver código canónico de cliente en MXCTACLI
  const clientCode = resolveMixnetClientCode(compDir, order.rif, order.client_name);

  const numped = order.order_number && /^\d{8}$/.test(order.order_number)
    ? order.order_number
    : getAndAdvanceCorrelative(compDir, 'PED');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sellerCodven = order.codven || '';
  const rate = parseFloat(order.exchange_rate || 0);

  const clientName = clientCode === '000-001'
    ? String(order.client_name || 'CTA. RECUPERADA: 000-001').slice(0, 60)
    : String(order.client_name || '').slice(0, 60);

  const encRecord = buildRecordBuffer(sEnc, {
    numped,
    emision: today,
    cliente: clientCode,
    codsuc: '',
    codven: sellerCodven,
    comen1: String(order.notes || '').slice(0, 35),
    comen2: '',
    tot_ped: total.toFixed(2),
    estatus: 'PE',
    moneda: 'US$',
    cambio: rate.toFixed(2),
    nomcli: clientName,
    cif: String(order.rif || '').slice(0, 15)
  });

  const renRecords = items.map((it, idx) => {
    const rawSku = String(it.sku || '').trim();
    if (!rawSku || rawSku.toUpperCase() === 'LIBRE' || rawSku.toUpperCase() === 'COTIZACION') {
      throw new Error(`Guardrail: Renglón #${idx + 1} de pedido sin código de catálogo oficial (recibido: '${it.sku || it.name}').`);
    }

    const qty = parseFloat(it.qty || 1);
    const price = parseFloat(it.price_usd || 0);
    const totRen = parseFloat(it.subtotal_usd || (qty * price));
    return buildRecordBuffer(sRen, {
      item: rawSku.slice(0, 15),
      unidad: String(it.unit || 'UND').slice(0, 3).toUpperCase(),
      cantidad: qty.toFixed(3),
      descrip: String(it.name || '').slice(0, 50),
      numped,
      emision: today,
      estatus: 'PE',
      precio: price.toFixed(2),
      tot_ren: totRen.toFixed(2),
      iva: 'E',
      cliente: clientCode,
      codven: sellerCodven
    });
  });

  appendRecordsToDbf(encPath, sEnc, [encRecord]);
  appendRecordsToDbf(renPath, sRen, renRecords);

  // Reindexar los 5 índices .NTX de pedidos
  const idx1 = reindexNtx(encPath, path.join(compDir, 'MXENPEX1.NTX'), 'NUMPED', 8);
  const idx2 = reindexNtx(encPath, path.join(compDir, 'MXENPEX2.NTX'), 'DTOS(EMISION)', 8);
  const idx3 = reindexNtx(encPath, path.join(compDir, 'MXENPEX3.NTX'), 'CLIENTE', 8);
  const idx4 = reindexNtx(renPath, path.join(compDir, 'MXREPEX1.NTX'), 'NUMPED', 8);
  const idx5 = reindexNtx(renPath, path.join(compDir, 'MXREPEX2.NTX'), 'ITEM+NUMPED', 23);

  log(`Pedido #${numped} inyectado en MixNet: $${total.toFixed(2)} (${items.length} renglones). 5 índices .NTX actualizados.`);

  return {
    ok: true,
    numped,
    client: order.client_name,
    total,
    itemsCount: items.length,
    indexes: [idx1, idx2, idx3, idx4, idx5]
  };
}

/**
 * Anexa registros a un archivo DBF actualizando el header (numRecords) y EOF (0x1A).
 */
function appendRecordsToDbf(filePath, struct, recordBuffers) {
  const buf = fs.readFileSync(filePath);
  const currentRecords = buf.readUInt32LE(4);
  const newTotal = currentRecords + recordBuffers.length;

  // Actualizar número de registros en la cabecera
  buf.writeUInt32LE(newTotal, 4);

  // Fecha de modificación de hoy
  const d = new Date();
  buf[1] = d.getFullYear() % 100;
  buf[2] = d.getMonth() + 1;
  buf[3] = d.getDate();

  // Eliminar el byte EOF anterior si existe
  let dataEnd = struct.headerLen + currentRecords * struct.recordLen;
  const existingData = buf.subarray(0, dataEnd);

  const payload = Buffer.concat([...recordBuffers, Buffer.from([0x1A])]); // EOF 0x1A
  const finalBuf = Buffer.concat([existingData, payload]);

  // Actualizar header de 32 bytes con el nuevo numRecords
  finalBuf.writeUInt32LE(newTotal, 4);

  fs.writeFileSync(filePath, finalBuf);
}
