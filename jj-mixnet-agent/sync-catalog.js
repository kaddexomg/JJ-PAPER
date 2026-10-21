/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Sincronizador de Catálogo, Precios y Stock
   ======================================================================
   Sincroniza existencias físicas reales (MXCTAINV.DBF -> existe_act)
   y listas de precios (precio_a, precio_b, precio_c, precio_d) con
   Supabase jjp_products usando Dirty-Checking para cero spam de cuotas.
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { readDbfStruct, readDbfRows } from './dbf-driver.js';
import { sbGet, sbPatch, sbPost } from './supabase-client.js';
import { log } from './config.js';

let catalogFingerprints = new Map(); // sku -> hash

function computeProductHash(p) {
  return `${p.codigo}|${p.existe_act}|${p.precio_a}|${p.precio_b}|${p.precio_c}|${p.precio_d}`;
}

/**
 * Ejecuta un barrido de sincronización de inventario y precios desde MixNet hacia Supabase.
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

  // Leer campos clave de todos los artículos activos
  const rows = readDbfRows(struct, [
    'codigo', 'descrip', 'precio_a', 'precio_b', 'precio_c', 'precio_d',
    'existe_act', 'costo_act', 'unidad'
  ], null, false);

  log(`Catálogo MixNet: ${rows.length} artículos activos leídos de MXCTAINV.DBF.`);

  // Detectar cuáles productos han cambiado realmente
  const changedProducts = [];
  for (const r of rows) {
    const sku = String(r.codigo || '').trim();
    if (!sku) continue;

    const hash = computeProductHash(r);
    if (forceAll || catalogFingerprints.get(sku) !== hash) {
      changedProducts.push({ row: r, hash });
    }
  }

  if (changedProducts.length === 0) {
    log('Catálogo e inventario: Sin cambios desde el último ciclo (0 egress Supabase).');
    return { totalRead: rows.length, updatedCount: 0 };
  }

  log(`Detectados ${changedProducts.length} productos con cambios en stock o precio. Sincronizando con Supabase...`);

  let updatedCount = 0;
  let batchErrors = 0;

  // Procesar en lotes de 25 para evitar sobrecarga HTTP
  const batchSize = 25;
  for (let i = 0; i < changedProducts.length; i += batchSize) {
    const chunk = changedProducts.slice(i, i + batchSize);

    for (const item of chunk) {
      const r = item.row;
      const sku = String(r.codigo || '').trim();
      const stock = parseFloat(r.existe_act || 0) || 0;
      const priceA = parseFloat(r.precio_a || 0) || 0;
      const priceB = parseFloat(r.precio_b || 0) || 0;
      const priceC = parseFloat(r.precio_c || 0) || 0;
      const priceD = parseFloat(r.precio_d || 0) || 0;

      const payload = {
        stock_qty: stock,
        price_a: priceA,
        price_b: priceB,
        price_usd: priceB > 0 ? priceB : priceA, // Nivel B mayorista por defecto
        price_c_bs: priceC,
        price_d_bs: priceD,
        updated_at: new Date().toISOString()
      };

      try {
        // Actualizar en jjp_products por SKU
        const res = await sbPatch('jjp_products', `sku=eq.${encodeURIComponent(sku)}`, payload);
        if (res) {
          catalogFingerprints.set(sku, item.hash);
          updatedCount++;
        }
      } catch (err) {
        batchErrors++;
        // No bloquear el ciclo por un error individual
      }
    }
  }

  log(`Catálogo sincronizado: ${updatedCount} productos actualizados en Supabase (${batchErrors} avisos).`);
  return { totalRead: rows.length, updatedCount, batchErrors };
}
