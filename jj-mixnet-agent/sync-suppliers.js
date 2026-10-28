/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Sincronizador Seguro de Proveedores
   ======================================================================
   REGLA DE ORO DE JJ PAPER:
   Cero cruce entre clientes y proveedores.
   MXCTAPRO.DBF es un histórico de cuentas que contiene tanto proveedores
   como clientes de cuentas bilaterales. Esta sincronización NUNCA debe
   ejecutarse a ciegas ni en bucles automáticos.
   Solo procesa proveedores activos (ESTATUS === 'A') y DESCARTA
   estrictamente cualquier entidad que coincida en RIF o razón social
   con la cartera de clientes de JJ Paper (jjp_customers).
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbGet, sbPost, sbPatch } from './supabase-client.js';
import { log } from './config.js';

function cleanRif(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Sincroniza proveedores reales de MixNet hacia jjp_suppliers en VPS,
 * con filtro estricto anti-contaminación de clientes.
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
    log(`[PROVEEDORES] No se encontró tabla de proveedores en ${compDir}.`, 'INFO');
    return { ok: false, message: 'Archivo de proveedores no encontrado en comp01' };
  }

  const s = readDbfStruct(supplierFilePath);
  if (!s || s.numRecords === 0) {
    return { ok: true, synced: 0, message: 'Tabla de proveedores vacía' };
  }

  const fieldNames = s.fields.map(f => f.name.toLowerCase());
  const rows = readDbfRows(s, fieldNames, s.numRecords, false);

  log(`[PROVEEDORES] Inspeccionando ${rows.length} registros en ${path.basename(supplierFilePath)}...`);

  // 1. Cargar catálogo de clientes de JJ Paper para filtro anti-colisión
  let custRifs = new Set();
  let custNames = new Set();
  try {
    const custs = await sbGet('jjp_customers', 'select=name,rif&limit=10000');
    if (Array.isArray(custs)) {
      for (const c of custs) {
        const cr = cleanRif(c.rif);
        if (cr.length > 5) custRifs.add(cr);
        const cn = (c.name || '').trim().toLowerCase();
        if (cn.length > 3) custNames.add(cn);
      }
    }
    log(`[PROVEEDORES] Filtro anti-colisión activo con ${custRifs.size} RIFs y ${custNames.size} nombres de clientes.`);
  } catch (err) {
    log(`Aviso cargando clientes para filtro de proveedores: ${err.message}`, 'WARN');
  }

  // 2. Cargar proveedores existentes en VPS
  const existing = await sbGet('jjp_suppliers', 'select=id,name,notes');
  const existingMap = new Map();
  for (const sup of (existing || [])) {
    const norm = (sup.name || '').trim().toLowerCase();
    if (norm) existingMap.set(norm, sup);
  }

  let createdCount = 0;
  let updatedCount = 0;
  let discardedCustomersCount = 0;
  let inactiveSkipped = 0;

  for (const r of rows) {
    // 1. Filtrar inactivos (en Clipper MixNet ESTATUS === 'A' es Activo)
    const status = String(r.estatus || '').trim().toUpperCase();
    if (status && status !== 'A') {
      inactiveSkipped++;
      continue;
    }

    const code = String(r.codcli || r.codpro || r.codigo || r.cod_pro || r.cod || '').trim();
    const name = String(r.nomcli || r.nompro || r.nombre || r.nom_pro || r.razon || '').trim();
    if (!name || name.length < 3) continue;

    const rawRif = String(r.cif || r.rif || r.cedula || '').trim();
    const cRif = cleanRif(rawRif);
    const normName = name.toLowerCase();

    // 2. GUARDA ABSOLUTA ANTI-CLIENTES:
    // Si la entidad existe en jjp_customers por RIF o Nombre exacto, DESCARTAR.
    if ((cRif && custRifs.has(cRif)) || custNames.has(normName)) {
      discardedCustomersCount++;
      continue;
    }

    const phone = String(r.tlf1 || r.telefono || r.tlf || r.telef || '').trim();
    const contact = String(r.contacto || r.contac || rawRif || '').trim();
    const daysRaw = String(r.dia_cre || r.dias || r.plazo || '30').trim();
    const default_terms_days = parseInt(daysRaw, 10) || 30;

    const notesStr = [
      code ? `MixNet: ${code}` : '',
      rawRif ? `RIF: ${rawRif}` : ''
    ].filter(Boolean).join(' | ');

    if (existingMap.has(normName)) {
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

  log(`[PROVEEDORES] Sincronización finalizada: ${createdCount} creados, ${updatedCount} actualizados, ${discardedCustomersCount} clientes descartados, ${inactiveSkipped} inactivos omitidos.`);
  return {
    ok: true,
    file: path.basename(supplierFilePath),
    totalRows: rows.length,
    created: createdCount,
    updated: updatedCount,
    discardedCustomers: discardedCustomersCount,
    inactiveSkipped
  };
}
