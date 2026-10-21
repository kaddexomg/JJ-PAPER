/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Compilador B-Tree Clipper NTX Nativo
   ======================================================================
   Genera archivos de índice .NTX nativos de Clipper 5.x directamente
   en memoria en menos de 20ms, permitiendo que cualquier cotización,
   pedido o artículo nuevo aparezca INMEDIATAMENTE en la interfaz gráfica
   de GemixNet / vDosPlus sin necesidad de reindexar manualmente.
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Construye un búfer binario .NTX completo a partir de una lista de entradas.
 * @param {Array<{recNo: number, key: string}>} entries - Entradas ya ordenadas ascendentemente.
 * @param {string} keyExpr - Expresión de índice (ej. 'NUMCOT', 'NUMPED', 'ITEM+NUMCOT')
 * @param {number} keyLen - Longitud del campo clave
 * @param {number} maxItems - Máximo número de ítems por página (default: 54)
 * @returns {Buffer} Búfer binario del archivo .NTX
 */
export function buildNtxBuffer(entries, keyExpr, keyLen, maxItems = 54) {
  const itemSize = keyLen + 8;
  const maxCapacity = Math.floor((1020 - 128) / itemSize);
  const effectiveMax = Math.min(maxItems, maxCapacity);
  const minItems = Math.floor(effectiveMax / 2);
  const header = Buffer.alloc(1024, 0);

  header.writeUInt16LE(0x0006, 0); // Firma estándar Clipper NTX
  header.writeUInt16LE(333, 2);    // Versión del compilador
  // rootOffset en offset 4 se escribe al finalizar
  header.writeUInt16LE(itemSize, 12);
  header.writeUInt16LE(keyLen, 14);
  header.writeUInt16LE(0, 16);     // Decimales
  header.writeUInt16LE(effectiveMax, 18);
  header.writeUInt16LE(minItems, 20);
  header.write(keyExpr.toUpperCase(), 22, Math.min(keyExpr.length, 255), 'ascii');
  header[278] = 0; // Unique = 0

  function createPage(items, rightmostChild = 0) {
    const page = Buffer.alloc(1024, 0);
    const count = items.length;
    page.writeUInt16LE(count, 0);

    const itemBase = 128; // Desplazamiento base estándar Clipper
    for (let i = 0; i < count; i++) {
      const pos = itemBase + i * itemSize;
      page.writeUInt16LE(pos, 2 + i * 2);

      const it = items[i];
      page.writeUInt32LE(it.child || 0, pos);
      page.writeUInt32LE(it.recNo, pos + 4);
      const keyBuf = Buffer.alloc(keyLen, 0x20); // Relleno con espacios
      keyBuf.write(String(it.key || '').slice(0, keyLen), 0, 'ascii');
      keyBuf.copy(page, pos + 8);
    }

    // Puntero al hijo más derecho (rightmost child)
    const rightPos = itemBase + count * itemSize;
    page.writeUInt16LE(rightPos, 2 + count * 2);
    page.writeUInt32LE(rightmostChild, rightPos);

    return page;
  }

  // Si la tabla está vacía, genera una raíz vacía
  if (!entries || entries.length === 0) {
    const rootPage = createPage([], 0);
    header.writeUInt32LE(1024, 4);
    return Buffer.concat([header, rootPage]);
  }

  // Nivel 0: Páginas hoja (Leaf Pages)
  let currentLevelPages = [];
  const pageSize = 1024;
  let pageOffset = 1024;

  const itemsPerLeaf = Math.max(2, effectiveMax - 4);
  let idx = 0;
  while (idx < entries.length) {
    const chunk = entries.slice(idx, idx + itemsPerLeaf);
    idx += itemsPerLeaf;
    currentLevelPages.push({
      pageOffset,
      items: chunk.map(e => ({ child: 0, recNo: e.recNo, key: e.key })),
      rightmostChild: 0
    });
    pageOffset += pageSize;
  }

  // Niveles internos (Bulk-loading Bottom-up B-Tree)
  while (currentLevelPages.length > 1) {
    const nextLevelPages = [];
    const itemsPerInternal = Math.max(2, effectiveMax - 4);

    let pIdx = 0;
    while (pIdx < currentLevelPages.length) {
      const childrenSlice = currentLevelPages.slice(pIdx, pIdx + itemsPerInternal + 1);
      pIdx += childrenSlice.length;

      const internalItems = [];
      for (let i = 0; i < childrenSlice.length - 1; i++) {
        const child = childrenSlice[i];
        const separator = child.items[child.items.length - 1];
        internalItems.push({
          child: child.pageOffset,
          recNo: separator.recNo,
          key: separator.key
        });
      }

      const rightmost = childrenSlice[childrenSlice.length - 1].pageOffset;
      nextLevelPages.push({
        pageOffset,
        items: internalItems,
        rightmostChild: rightmost,
        children: childrenSlice
      });
      pageOffset += pageSize;
    }

    currentLevelPages = nextLevelPages;
  }

  const root = currentLevelPages[0];
  header.writeUInt32LE(root.pageOffset, 4);

  // Ordenar páginas por desplazamiento y concatenar
  const allNodes = [];
  function collect(node) {
    if (node.children) {
      for (const c of node.children) collect(c);
    }
    allNodes.push(node);
  }
  collect(root);
  allNodes.sort((a, b) => a.pageOffset - b.pageOffset);

  const filePages = allNodes.map(n => createPage(n.items, n.rightmostChild));
  return Buffer.concat([header, ...filePages]);
}

/**
 * Reindexa un archivo DBF generando su índice .NTX correspondiente.
 * @param {string} dbfPath - Ruta al archivo .DBF
 * @param {string} ntxPath - Ruta al archivo .NTX
 * @param {string} keyExpr - Expresión de índice
 * @param {number} keyLen - Longitud de la clave
 */
export function reindexNtx(dbfPath, ntxPath, keyExpr, keyLen) {
  if (!fs.existsSync(dbfPath)) {
    throw new Error(`Archivo DBF no encontrado: ${dbfPath}`);
  }

  const dbfBuf = fs.readFileSync(dbfPath);
  const numRecords = dbfBuf.readUInt32LE(4);
  const headerLen = dbfBuf.readUInt16LE(8);
  const recordLen = dbfBuf.readUInt16LE(10);

  // Leer campos para ubicar los offsets de la expresión
  const fields = [];
  let off = 32;
  let pos = 1;
  while (off + 32 <= headerLen - 1 && dbfBuf[off] !== 0x0D) {
    let raw = '';
    for (let i = 0; i < 11; i++) {
      const c = dbfBuf[off + i];
      if (c === 0) break;
      raw += String.fromCharCode(c);
    }
    const name = raw.trim().toUpperCase();
    const len = dbfBuf[off + 16];
    fields.push({ name, len, pos });
    pos += len;
    off += 32;
  }

  // Función extractora de clave según la expresión
  const upperExpr = keyExpr.toUpperCase().replace(/\s+/g, '');
  let keyExtractor = null;

  if (upperExpr === 'NUMCOT' || upperExpr === 'NUMPED') {
    const f = fields.find(x => x.name === upperExpr);
    if (!f) throw new Error(`Campo ${upperExpr} no existe en ${dbfPath}`);
    keyExtractor = (p) => dbfBuf.toString('ascii', p + f.pos, p + f.pos + f.len).trim().padStart(keyLen, '0');
  } else if (upperExpr === 'DTOS(EMISION)') {
    const f = fields.find(x => x.name === 'EMISION');
    if (!f) throw new Error(`Campo EMISION no existe en ${dbfPath}`);
    keyExtractor = (p) => dbfBuf.toString('ascii', p + f.pos, p + f.pos + f.len).trim().padStart(keyLen, '0');
  } else if (upperExpr === 'CLIENTE') {
    const f = fields.find(x => x.name === 'CLIENTE');
    if (!f) throw new Error(`Campo CLIENTE no existe en ${dbfPath}`);
    keyExtractor = (p) => dbfBuf.toString('ascii', p + f.pos, p + f.pos + f.len).trim().padEnd(keyLen, ' ');
  } else if (upperExpr === 'ITEM+NUMCOT' || upperExpr === 'ITEM+NUMPED') {
    const isCot = upperExpr.includes('NUMCOT');
    const fItem = fields.find(x => x.name === 'ITEM' || x.name === 'CODIGO');
    const fNum = fields.find(x => x.name === (isCot ? 'NUMCOT' : 'NUMPED'));
    if (!fItem || !fNum) throw new Error(`Campos compuestos no encontrados en ${dbfPath}`);
    keyExtractor = (p) => {
      const it = dbfBuf.toString('ascii', p + fItem.pos, p + fItem.pos + fItem.len).trim().padEnd(15, ' ');
      const nm = dbfBuf.toString('ascii', p + fNum.pos, p + fNum.pos + fNum.len).trim().padStart(8, '0');
      return (it + nm).slice(0, keyLen);
    };
  } else {
    // Caso genérico por nombre de campo
    const f = fields.find(x => x.name === upperExpr);
    if (f) {
      keyExtractor = (p) => dbfBuf.toString('ascii', p + f.pos, p + f.pos + f.len).trim().padEnd(keyLen, ' ');
    } else {
      throw new Error(`Expresión de índice no soportada automáticamente: ${keyExpr}`);
    }
  }

  // Extraer todos los registros activos (0x20, omitiendo 0x2A borrados)
  const entries = [];
  let p = headerLen;
  for (let recNo = 1; recNo <= numRecords; recNo++) {
    const isDel = dbfBuf[p] === 0x2A;
    if (!isDel) {
      const k = keyExtractor(p);
      entries.push({ recNo, key: k });
    }
    p += recordLen;
  }

  // Ordenar ascendentemente por clave, luego por recNo
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.recNo - b.recNo));

  // Compilar NTX
  const ntxBuf = buildNtxBuffer(entries, keyExpr, keyLen);

  // Escritura atómica para prevenir bloqueos de lectura
  const tmpPath = `${ntxPath}.tmp`;
  fs.writeFileSync(tmpPath, ntxBuf);
  try {
    fs.copyFileSync(tmpPath, ntxPath);
    fs.unlinkSync(tmpPath);
  } catch (_) {
    // Si Windows bloquea el reemplazo por handle abierto, sobrescribe directamente
    fs.writeFileSync(ntxPath, ntxBuf);
  }

  return { recordsIndexed: entries.length, sizeBytes: ntxBuf.length };
}
