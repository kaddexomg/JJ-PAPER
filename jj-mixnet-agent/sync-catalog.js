/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Sincronizador de Catálogo, Precios y Stock
   ======================================================================
   Sincroniza existencias físicas reales (MXCTAINV.DBF -> existe_act)
   y listas de precios (precio_a, precio_b, precio_c, precio_d) con
   PostgreSQL jjp_products usando Dirty-Checking para cero spam.
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbPatch } from './supabase-client.js';
import { log } from './config.js';

let catalogFingerprints = new Map(); // sku -> hash

function computeProductHash(p) {
  const sku = String(p.codart || p.codigo || '').trim();
  return `${sku}|${p.existe_act}|${p.precio_a}|${p.precio_b}|${p.precio_c}|${p.precio_d}|${p.costo_act}`;
}

/**
 * Ejecuta un barrido de sincronización de inventario y precios desde MixNet hacia PostgreSQL.
 * @param {string} compDir - Directorio comp01 de MixNet
 * @param {boolean} forceAll - Si es true, ignora el dirty check y sincroniza todo
 */
export async function syncCatalogFromMixnet(compDir, forceAll = false) {
  const invPath = path.join(compDir, 'MXCTAINV.DBF');
  if (!fs.existsSync(invPath)) {
    throw new Error(`MXCTAINV.DBF no existe en ${compDir}`);
  }

  const struct = readDbfStruct(invPath);
  if (!struct) throw new Error('No se pudo leer la estructura de MXCTAINV.DBF');

  // Leer campos canónicos de MXCTAINV.DBF
  const rows = readDbfRows(struct, [
    'codart', 'nomart', 'marca', 'precio_a', 'precio_b', 'precio_c', 'precio_d',
    'existe_act', 'costo_act', 'unidad'
  ], null, false);

  log(`Catálogo MixNet: ${rows.length} artículos activos leídos de MXCTAINV.DBF.`);

  // Detectar cuáles productos han cambiado realmente
  const changedProducts = [];
  for (const r of rows) {
    const sku = String(r.codart || r.codigo || '').trim();
    if (!sku) continue;

    const hash = computeProductHash(r);
    if (forceAll || catalogFingerprints.get(sku) !== hash) {
      changedProducts.push({ row: r, hash, sku });
    }
  }

  if (changedProducts.length === 0) {
    log('Catálogo e inventario: Sin cambios desde el último ciclo.');
    return { totalRead: rows.length, updatedCount: 0 };
  }

  log(`Detectados ${changedProducts.length} productos con cambios en stock o precio. Sincronizando con VPS...`);

  let updatedCount = 0;
  let batchErrors = 0;

  // Lotes concurrentes controlados
  const batchSize = 25;
  for (let i = 0; i < changedProducts.length; i += batchSize) {
    const chunk = changedProducts.slice(i, i + batchSize);

    await Promise.all(chunk.map(async (item) => {
      const r = item.row;
      const sku = item.sku;
      const stock = Math.max(0, Math.round(parseFloat(r.existe_act || 0) || 0));
      const priceA = parseFloat(r.precio_a || 0) || 0;
      const priceB = parseFloat(r.precio_b || 0) || 0;
      const priceC = parseFloat(r.precio_c || 0) || 0;
      const priceD = parseFloat(r.precio_d || 0) || 0;
      const costUsd = parseFloat(r.costo_act || 0) || 0;

      const payload = {
        stock: stock,
        stock_qty: stock,
        price_a: priceA,
        price_b: priceB,
        price_usd: priceB > 0 ? priceB : priceA,
        price_c_bs: priceC,
        price_d_bs: priceD,
        cost_usd: costUsd > 0 ? costUsd : undefined
      };

      try {
        const res = await sbPatch('jjp_products', `sku=eq.${encodeURIComponent(sku)}`, payload);
        if (res && res.length > 0) {
          catalogFingerprints.set(sku, item.hash);
          updatedCount++;
        }
      } catch (err) {
        batchErrors++;
      }
    }));
  }

  log(`Catálogo sincronizado: ${updatedCount} productos actualizados en VPS (${batchErrors} avisos).`);
  return { totalRead: rows.length, updatedCount, batchErrors };
}
