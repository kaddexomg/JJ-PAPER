/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Sincronizador de Proveedores MixNet ERP
   ======================================================================
   Lee el maestro de proveedores físicos de MixNet (MXCTAPRO.DBF / MXPROV.DBF)
   y los sincroniza de forma transparente hacia jjp_suppliers en el VPS.
   Conecta directamente con Cuentas por Pagar (admin/facturas.html).
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbGet, sbPost, sbPatch } from './supabase-client.js';
import { log } from './config.js';

/**
 * Detecta y sincroniza proveedores desde MixNet a jjp_suppliers.
 */
export async function syncSuppliersFromMixnet(compDir) {
  const candidateFiles = ['MXCTAPRO.DBF', 'mxctapro.dbf', 'MXPROV.DBF', 'mxprov.dbf', 'MXPROVE.DBF'];
  let supplierFilePath = null;

  for (const cand of candidateFiles) {
    const full = path.join(compDir, cand);
    if (fs.existsSync(full)) {
      supplierFilePath = full;
      break;
    }
  }

  if (!supplierFilePath) {
    log(`[PROVEEDORES] No se encontró tabla de proveedores en ${compDir} (probados: ${candidateFiles.join(', ')}).`, 'WARN');
    return { ok: false, message: 'Archivo de proveedores no encontrado en comp01' };
  }

  const s = readDbfStruct(supplierFilePath);
  if (!s || s.numRecords === 0) {
    return { ok: true, synced: 0, message: 'Tabla de proveedores vacía' };
  }

  // Detectar nombres de campos dinámicamente
  const fieldNames = s.fields.map(f => f.name.toLowerCase());
  const rows = readDbfRows(s, fieldNames, s.numRecords, false);

  log(`[PROVEEDORES] Leídos ${rows.length} registros desde ${path.basename(supplierFilePath)}.`);

  // Cargar proveedores existentes en Supabase
  const existing = await sbGet('jjp_suppliers', 'select=id,name,notes');
  const existingMap = new Map();
  for (const sup of (existing || [])) {
    const norm = (sup.name || '').trim().toLowerCase();
    if (norm) existingMap.set(norm, sup);
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (const r of rows) {
    // Resolver código
    const code = String(r.codpro || r.codigo || r.cod_pro || r.cod || '').trim();
    // Resolver nombre
    const name = String(r.nompro || r.nombre || r.nom_pro || r.razon || r.nomcli || '').trim();
    if (!name || name.length < 3) continue;

    // Resolver RIF / CIF
    const rif = String(r.cif || r.rif || r.cedula || '').trim();
    // Resolver teléfono
    const phone = String(r.telefono || r.tlf || r.telef || '').trim();
    // Resolver contacto
    const contact = String(r.contacto || r.contac || rif || '').trim();
    // Resolver plazo habitual
    const daysRaw = String(r.dias || r.plazo || r.credito || '30').trim();
    const default_terms_days = parseInt(daysRaw, 10) || 30;

    const normName = name.toLowerCase();
    const notesStr = [
      code ? `MixNet: ${code}` : '',
      rif ? `RIF: ${rif}` : ''
    ].filter(Boolean).join(' | ');

    if (existingMap.has(normName)) {
      // Actualizar si no tiene código MixNet en notas
      const curr = existingMap.get(normName);
      if (notesStr && (!curr.notes || !curr.notes.includes(code))) {
        await sbPatch('jjp_suppliers', `id=eq.${curr.id}`, {
          notes: curr.notes ? `${curr.notes} | ${notesStr}` : notesStr,
          default_terms_days: curr.default_terms_days || default_terms_days,
          phone: curr.phone || (phone || null)
        }).catch(() => {});
        updatedCount++;
      }
    } else {
      // Crear nuevo proveedor en jjp_suppliers
      await sbPost('jjp_suppliers', {
        name,
        phone: phone || null,
        contact: contact || null,
        default_terms_days,
        notes: notesStr || null,
        active: true
      }).catch(err => {
        log(`Aviso insertando proveedor "${name}": ${err.message}`, 'WARN');
      });
      createdCount++;
      existingMap.set(normName, { name, notes: notesStr });
    }
  }

  log(`[PROVEEDORES] Sincronización finalizada: ${createdCount} creados, ${updatedCount} actualizados.`);
  return {
    ok: true,
    file: path.basename(supplierFilePath),
    totalRows: rows.length,
    created: createdCount,
    updated: updatedCount
  };
}
