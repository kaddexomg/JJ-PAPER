/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Módulo de Conciliación de Clientes y Backups
   ======================================================================
   Concilia el maestro físico de clientes de MixNet (MXCTACLI.DBF) con la
   base de datos en la nube (Supabase jjp_customers), actualizando notas
   con código MixNet oficial y sincronizando correos electrónicos válidos.
   ====================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbGet, sbPatch } from './supabase-client.js';
import { reindexNtx } from './ntx-builder.js';
import { log } from './config.js';

/**
 * Normaliza y limpia un RIF venezolano al número base comparable.
 * Ejemplos:
 *   'J-40678577-6' -> '40678577'
 *   'J-300364119'  -> '30036411'
 *   'V-01875469-0' -> '1875469'
 *   '40678577'     -> '40678577'
 */
export function isTestEntity(name = '', rif = '', notes = '') {
  const str = `${name || ''} ${rif || ''} ${notes || ''}`.toLowerCase();
  return /\b(e2e|prueba|test|verificacion|verificación|mps|dummy|tester|testing)\b/i.test(str) ||
         /cliente\s+(prueba|test|e2e)/i.test(str);
}

export function cleanRif(raw) {
  if (!raw) return '';
  const str = String(raw).trim().toUpperCase();
  // Caso con guion antes del digito verificador: ej. J-40678577-6 o V-01875469-0
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

/**
 * Valida si una dirección de correo es legítima y no es un marcador genérico o inválido.
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  if (e.length < 6 || !e.includes('@') || !e.includes('.')) return false;
  if (/^(noreply|noemail|sinemail|sincorreo|nocorreo|no@|none@|prueba|test|admin@mixnet)/.test(e)) return false;
  if (e.includes('c.i') || e.includes('rif') || e.includes('tlf') || e.includes('telefono') || e.includes(' ')) return false;
  return /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(e);
}

/**
 * Ejecuta la conciliación completa de clientes entre MixNet y Supabase.
 * @param {string} compDir - Ruta de comp01 (ej. 'M:/MIX11/comp01')
 * @returns {Promise<{ matched: number, updated: number, pendingReview: number, details?: any }>}
 */
export async function reconcileClients(compDir) {
  const cliPath = path.join(compDir, 'MXCTACLI.DBF');
  if (!fs.existsSync(cliPath)) {
    throw new Error(`Archivo no encontrado: ${cliPath}`);
  }

  log(`[CONCILIACION] Leyendo maestro MXCTACLI.DBF desde ${compDir}...`);
  const sCli = readDbfStruct(cliPath);
  const mixRows = readDbfRows(sCli, ['codcli', 'nomcli', 'cif', 'email', 'vendedor', 'zona'], sCli.numRecords, false);

  // Mapear clientes de Mixnet por RIF limpio
  const mixMap = new Map();
  for (const r of mixRows) {
    const cr = cleanRif(r.cif);
    if (cr && cr !== '0') {
      if (!mixMap.has(cr)) mixMap.set(cr, []);
      mixMap.get(cr).push(r);
    }
  }

  log(`[CONCILIACION] ${mixRows.length} registros en MixNet (${mixMap.size} RIFs limpios únicos).`);

  // Leer todos los clientes de Supabase con paginación
  log('[CONCILIACION] Leyendo clientes de Supabase (jjp_customers)...');
  let offset = 0;
  const limit = 1000;
  let allCustomers = [];
  while (true) {
    const batch = await sbGet('jjp_customers', `select=id,name,rif,email,notes,phone,seller_id&limit=${limit}&offset=${offset}&order=id.asc`);
    if (!batch || batch.length === 0) break;
    allCustomers.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  log(`[CONCILIACION] ${allCustomers.length} clientes cargados desde Supabase.`);

  let matched = 0;
  let updated = 0;
  let pendingReview = 0;
  const pendingList = [];
  const updateQueue = [];

  for (const c of allCustomers) {
    if (isTestEntity(c.name, c.rif, c.notes)) {
      continue; // Cero sincronización de clientes de prueba / E2E
    }
    const cr = cleanRif(c.rif);
    if (!cr || cr === '0') {
      pendingReview++;
      pendingList.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        reason: 'RIF_INVALIDO_O_VACIO'
      });
      continue;
    }

    const matches = mixMap.get(cr);
    if (!matches || matches.length === 0) {
      pendingReview++;
      pendingList.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        cleanRif: cr,
        reason: 'NO_ENCONTRADO_EN_MIXNET'
      });
      continue;
    }

    // Si hay más de un registro en Mixnet con el mismo RIF
    let bestMix = null;
    if (matches.length === 1) {
      bestMix = matches[0];
    } else {
      // Intentar desambiguar por coincidencia de nombre
      const custNorm = (c.name || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const exactNameMatch = matches.find(m => {
        const mNorm = (m.nomcli || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        return mNorm && (custNorm.includes(mNorm) || mNorm.includes(custNorm));
      });

      if (exactNameMatch) {
        bestMix = exactNameMatch;
      } else {
        // Conflicto de múltiples fichas en Mixnet sin desambiguar
        pendingReview++;
        pendingList.push({
          id: c.id,
          name: c.name,
          rif: c.rif,
          cleanRif: cr,
          reason: 'MULTIPLES_FICHAS_MIXNET',
          matches: matches.map(m => ({ codcli: m.codcli, nomcli: m.nomcli }))
        });
        continue;
      }
    }

    matched++;
    const codcli = String(bestMix.codcli || '').trim();
    const notesStr = c.notes ? String(c.notes).trim() : '';
    const hasMixnetCode = /MixNet[:\s]+[0-9]{3}-[0-9]+/i.test(notesStr) || /Codigo MixNet/i.test(notesStr) || /MixNet:/i.test(notesStr);

    let needsNotesUpdate = false;
    let newNotes = notesStr;
    if (!hasMixnetCode && codcli) {
      needsNotesUpdate = true;
      if (!newNotes) {
        newNotes = `MixNet: ${codcli}`;
      } else {
        newNotes = `MixNet: ${codcli} | ${newNotes}`;
      }
    }

    let needsEmailUpdate = false;
    const mixEmail = String(bestMix.email || '').trim();
    let newEmail = c.email;
    if (isValidEmail(mixEmail)) {
      const supaEmail = (c.email || '').trim().toLowerCase();
      if (!supaEmail || !supaEmail.includes('@') || supaEmail !== mixEmail.toLowerCase()) {
        needsEmailUpdate = true;
        newEmail = mixEmail;
      }
    }

    if (needsNotesUpdate || needsEmailUpdate) {
      const patchData = {};
      if (needsNotesUpdate) patchData.notes = newNotes;
      if (needsEmailUpdate) patchData.email = newEmail;
      updateQueue.push({ id: c.id, data: patchData, name: c.name, codcli });
    }
  }

  log(`[CONCILIACION] Matched: ${matched}, Por actualizar: ${updateQueue.length}, Pendientes de revisión: ${pendingReview}`);

  // Ejecutar actualizaciones en chunks concurrentes controlados
  const CHUNK_SIZE = 15;
  for (let i = 0; i < updateQueue.length; i += CHUNK_SIZE) {
    const chunk = updateQueue.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(async u => {
      try {
        await sbPatch('jjp_customers', `id=eq.${u.id}`, u.data);
        updated++;
      } catch (err) {
        log(`Error actualizando cliente ${u.id} (${u.name}): ${err.message}`, 'WARN');
      }
    }));
  }

  log(`[CONCILIACION] Finalizada exitosamente. Matched: ${matched}, Updated: ${updated}, PendingReview: ${pendingReview}`);

  return {
    matched,
    updated,
    pendingReview,
    totalEvaluated: allCustomers.length,
    pendingSample: pendingList.slice(0, 10)
  };
}

/**
 * Lista las discrepancias de clientes (sin código MixNet o con conflictos).
 */
export async function getClientsDiscrepancies(compDir) {
  const cliPath = path.join(compDir, 'MXCTACLI.DBF');
  const sCli = readDbfStruct(cliPath);
  const mixRows = sCli ? readDbfRows(sCli, ['codcli', 'nomcli', 'cif', 'email', 'vendedor'], sCli.numRecords, false) : [];

  const mixMap = new Map();
  for (const r of mixRows) {
    const cr = cleanRif(r.cif);
    if (cr && cr !== '0') {
      if (!mixMap.has(cr)) mixMap.set(cr, []);
      mixMap.get(cr).push(r);
    }
  }

  // Leer clientes de Supabase con paginación
  let offset = 0;
  const limit = 1000;
  let allCustomers = [];
  while (true) {
    const batch = await sbGet('jjp_customers', `select=id,name,rif,email,notes,phone,seller_id&limit=${limit}&offset=${offset}&order=id.asc`);
    if (!batch || batch.length === 0) break;
    allCustomers.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  const discrepancies = [];

  // Mapear duplicados en Supabase
  const supaRifMap = new Map();
  for (const c of allCustomers) {
    if (isTestEntity(c.name, c.rif, c.notes)) {
      continue; // Cero sincronización de clientes de prueba / E2E
    }
    const cr = cleanRif(c.rif);
    if (cr && cr !== '0') {
      if (!supaRifMap.has(cr)) supaRifMap.set(cr, []);
      supaRifMap.get(cr).push(c);
    }
  }

  for (const c of allCustomers) {
    if (isTestEntity(c.name, c.rif, c.notes)) {
      continue; // Cero sincronización de clientes de prueba / E2E
    }
    const cr = cleanRif(c.rif);
    const notesStr = c.notes ? String(c.notes).trim() : '';
    const hasCode = /MixNet[:\s]+[0-9]{3}-[0-9]+/i.test(notesStr) || /Codigo MixNet/i.test(notesStr) || /MixNet:/i.test(notesStr);

    // 1. RIF inválido o ausente
    if (!cr || cr === '0') {
      discrepancies.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        type: 'INVALID_RIF',
        message: 'Cliente con RIF inválido, nulo o 0.'
      });
      continue;
    }

    // 2. Duplicado en Supabase
    const supaDups = supaRifMap.get(cr) || [];
    if (supaDups.length > 1) {
      discrepancies.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        cleanRif: cr,
        type: 'DUPLICATE_IN_SUPABASE',
        message: `RIF compartido con otros ${supaDups.length - 1} registros en Supabase.`,
        relatedIds: supaDups.filter(d => d.id !== c.id).map(d => d.id)
      });
    }

    // 3. No existe en MixNet
    const matches = mixMap.get(cr);
    if (!matches || matches.length === 0) {
      discrepancies.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        cleanRif: cr,
        type: 'NOT_IN_MIXNET',
        message: 'RIF no existe en el maestro de clientes MXCTACLI.DBF.'
      });
      continue;
    }

    // 4. Múltiples fichas en MixNet
    if (matches.length > 1) {
      discrepancies.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        cleanRif: cr,
        type: 'MULTIPLE_MIXNET_RECORDS',
        message: `RIF asociado a ${matches.length} fichas distintas en MixNet.`,
        mixnetRecords: matches.map(m => ({ codcli: m.codcli, nomcli: m.nomcli }))
      });
    }

    // 5. Sin código MixNet asignado
    if (!hasCode) {
      discrepancies.push({
        id: c.id,
        name: c.name,
        rif: c.rif,
        cleanRif: cr,
        type: 'MISSING_MIXNET_CODE',
        message: 'Cliente no tiene código MixNet asignado en el campo notes.',
        suggestedCode: matches[0].codcli
      });
    }
  }

  return {
    count: discrepancies.length,
    discrepancies
  };
}

/**
 * Genera un snapshot completo de las tablas críticas en comp01/backups/.
 */
export function createBackup(compDir, label = '') {
  const bDir = path.join(compDir, 'backups');
  if (!fs.existsSync(bDir)) {
    fs.mkdirSync(bDir, { recursive: true });
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cleanLabel = (label || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapshotId = `SNAPSHOT_${ts}${cleanLabel ? '_' + cleanLabel : ''}`;
  const snapshotDir = path.join(bDir, snapshotId);

  fs.mkdirSync(snapshotDir, { recursive: true });

  const coreFiles = [
    'MXCTACLI.DBF',
    'MXENCCOT.DBF',
    'MXRENCOT.DBF',
    'MXENCPED.DBF',
    'MXRENPED.DBF',
    'MXNUMCOT.DBF',
    'MXNUMPED.DBF',
    'MXCTAINV.DBF',
    'MXCTAVDD.DBF',
    'MXCTVDX1.NTX',
    'JJ_USER_PERMISSIONS.json',
    'MXENCZX1.NTX',
    'MXENCZX2.NTX',
    'MXENCZX3.NTX',
    'MXRECZX1.NTX',
    'MXRECZX2.NTX',
    'MXENPEX1.NTX',
    'MXENPEX2.NTX',
    'MXENPEX3.NTX',
    'MXREPEX1.NTX',
    'MXREPEX2.NTX'
  ];

  const copiedFiles = [];
  let totalBytes = 0;

  for (const f of coreFiles) {
    const src = path.join(compDir, f);
    if (fs.existsSync(src)) {
      const dest = path.join(snapshotDir, f);
      fs.copyFileSync(src, dest);
      const st = fs.statSync(dest);
      totalBytes += st.size;
      copiedFiles.push({ file: f, size: st.size });
    }
  }

  // Crear archivo .BAK de manifiesto para list_snapshots
  const bakManifestPath = path.join(bDir, `${snapshotId}.BAK`);
  const manifestData = {
    snapshot: snapshotId,
    createdAt: now.toISOString(),
    filesCount: copiedFiles.length,
    totalBytes,
    files: copiedFiles
  };
  fs.writeFileSync(bakManifestPath, JSON.stringify(manifestData, null, 2), 'utf8');

  log(`[BACKUP] Snapshot creado exitosamente: ${snapshotId} (${copiedFiles.length} archivos, ${(totalBytes / 1024).toFixed(1)} KB)`);

  return {
    ok: true,
    snapshot: snapshotId,
    backupFile: `${snapshotId}.BAK`,
    directory: snapshotDir,
    filesCount: copiedFiles.length,
    totalBytes,
    files: copiedFiles
  };
}

/**
 * Revierte el estado de MixNet al snapshot indicado.
 */
export function rollbackBackup(compDir, snapshotId) {
  if (!snapshotId) {
    throw new Error('Debe especificar un snapshotId para ejecutar rollback.');
  }

  const bDir = path.join(compDir, 'backups');
  const cleanId = snapshotId.replace(/\.BAK$/i, '');
  const snapshotDir = path.join(bDir, cleanId);

  if (!fs.existsSync(snapshotDir)) {
    throw new Error(`Directorio de snapshot no encontrado: ${snapshotDir}`);
  }

  const filesToRestore = fs.readdirSync(snapshotDir);
  if (filesToRestore.length === 0) {
    throw new Error(`El snapshot ${cleanId} está vacío.`);
  }

  // Crear snapshot de seguridad previo al rollback
  const preRollbackDir = path.join(bDir, `PRE_ROLLBACK_${Date.now()}`);
  fs.mkdirSync(preRollbackDir, { recursive: true });

  const restoredFiles = [];
  for (const f of filesToRestore) {
    const currentFile = path.join(compDir, f);
    if (fs.existsSync(currentFile)) {
      fs.copyFileSync(currentFile, path.join(preRollbackDir, f));
    }
    const snapFile = path.join(snapshotDir, f);
    fs.copyFileSync(snapFile, currentFile);
    restoredFiles.push(f);
  }

  // Reindexar NTX
  try {
    const encCot = path.join(compDir, 'MXENCCOT.DBF');
    const renCot = path.join(compDir, 'MXRENCOT.DBF');
    const encPed = path.join(compDir, 'MXENCPED.DBF');
    const renPed = path.join(compDir, 'MXRENPED.DBF');

    if (fs.existsSync(encCot)) {
      reindexNtx(encCot, path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
      reindexNtx(encCot, path.join(compDir, 'MXENCZX2.NTX'), 'DTOS(EMISION)', 8);
      reindexNtx(encCot, path.join(compDir, 'MXENCZX3.NTX'), 'CLIENTE', 8);
    }
    if (fs.existsSync(renCot)) {
      reindexNtx(renCot, path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
      reindexNtx(renCot, path.join(compDir, 'MXRECZX2.NTX'), 'ITEM+NUMCOT', 23);
    }
    if (fs.existsSync(encPed)) {
      reindexNtx(encPed, path.join(compDir, 'MXENPEX1.NTX'), 'NUMPED', 8);
      reindexNtx(encPed, path.join(compDir, 'MXENPEX2.NTX'), 'DTOS(EMISION)', 8);
      reindexNtx(encPed, path.join(compDir, 'MXENPEX3.NTX'), 'CLIENTE', 8);
    }
    if (fs.existsSync(renPed)) {
      reindexNtx(renPed, path.join(compDir, 'MXREPEX1.NTX'), 'NUMPED', 8);
      reindexNtx(renPed, path.join(compDir, 'MXREPEX2.NTX'), 'ITEM+NUMPED', 23);
    }
  } catch (reindexErr) {
    log(`Aviso reindexando tras rollback: ${reindexErr.message}`, 'WARN');
  }

  log(`[ROLLBACK] Revertido exitosamente al snapshot: ${cleanId} (${restoredFiles.length} archivos restaurados).`);

  return {
    ok: true,
    restoredSnapshot: cleanId,
    restoredFilesCount: restoredFiles.length,
    restoredFiles
  };
}
