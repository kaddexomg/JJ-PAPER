/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Sincronizador Bidireccional de Documentos
   ======================================================================
   Maneja la importación de ventas/cotizaciones de mostrador hacia la web
   y la inyección de cotizaciones/pedidos de la web hacia MixNet con
   reindexación automática de los archivos .NTX.
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { readDbfStruct, readDbfRows, injectQuoteToMixnet, injectOrderToMixnet } from './dbf-driver.js';
import { sbGet, sbPost, sbPatch } from './supabase-client.js';
import { SELLER_CODVEN_TO_PROFILE, PROFILE_ID_TO_CODVEN, log } from './config.js';

let importedDocuments = new Set(); // serials already processed

/**
 * Importa cotizaciones y pedidos recientes emitidos físicamente en MixNet hacia Supabase.
 */
export async function importMixnetDocuments(compDir) {
  let importedQuotes = 0;
  let importedOrders = 0;

  // 1. Cotizaciones
  const encCotPath = path.join(compDir, 'MXENCCOT.DBF');
  const renCotPath = path.join(compDir, 'MXRENCOT.DBF');

  if (fs.existsSync(encCotPath) && fs.existsSync(renCotPath)) {
    const sEnc = readDbfStruct(encCotPath);
    const sRen = readDbfStruct(renCotPath);

    if (sEnc && sRen && sEnc.numRecords > 0) {
      // Leer las últimas 50 cotizaciones
      const encRows = readDbfRows(sEnc, ['numcot', 'emision', 'cliente', 'nomcli', 'cif', 'codven', 'comen1', 'tot_cot', 'cambio'], 50, true);

      // Agrupar renglones por numcot para los documentos a evaluar
      const wantedSerials = new Set(encRows.map(r => r.numcot).filter(Boolean));
      const renRows = readDbfRows(sRen, ['numcot', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], 500, true);

      const itemsMap = new Map();
      for (const d of renRows) {
        const num = String(d.numcot || '').trim().padStart(8, '0');
        if (!itemsMap.has(num)) itemsMap.set(num, []);
        itemsMap.get(num).push(d);
      }

      for (const r of encRows) {
        const num = String(r.numcot || '').trim().padStart(8, '0');
        if (!num || num === '00000000') continue;
        if (r.cliente === '00-000' || r.cliente === '00000') continue; // Omitir basura histórica

        const docKey = `cot:${num}`;
        if (importedDocuments.has(docKey)) continue;

        const total = parseFloat(String(r.tot_cot || '0').replace(/,/g, '.')) || 0;
        if (total <= 0) continue;

        // Verificar si ya existe en Supabase
        const existing = await sbGet('jjp_quotes', `quote_number=eq.${num}&select=id`);
        if (existing && existing.length > 0) {
          importedDocuments.add(docKey);
          continue;
        }

        const codven = String(r.codven || '').trim();
        const sellerProfile = SELLER_CODVEN_TO_PROFILE[codven] || SELLER_CODVEN_TO_PROFILE['010'];
        const sellerId = sellerProfile.id;

        const rawItems = itemsMap.get(num) || [];
        const items = rawItems.map(i => ({
          sku: String(i.item || '').trim(),
          name: String(i.descrip || 'Articulo').trim(),
          qty: parseFloat(String(i.cantidad || '1').replace(/,/g, '.')) || 1,
          price_usd: parseFloat(String(i.precio || '0').replace(/,/g, '.')) || 0,
          subtotal_usd: parseFloat(String(i.tot_ren || '0').replace(/,/g, '.')) || 0
        }));

        const payload = {
          quote_number: num,
          client_name: String(r.nomcli || 'Cliente MixNet').trim(),
          rif: String(r.cif || '').trim() || null,
          items,
          estimated_total_usd: total,
          exchange_rate: parseFloat(String(r.cambio || '0').replace(/,/g, '.')) || 0,
          notes: String(r.comen1 || '').trim() || null,
          source: 'mixnet',
          status: 'confirmado',
          seller_id: sellerId
        };

        try {
          await sbPost('jjp_quotes', payload);
          importedDocuments.add(docKey);
          importedQuotes++;
          log(`Cotización #${num} importada de MixNet: $${total.toFixed(2)} [Vendedor: ${sellerProfile.name}]`);
        } catch (err) {
          log(`Aviso importando cotización #${num}: ${err.message}`, 'WARN');
        }
      }
    }
  }

  // 2. Pedidos
  const encPedPath = path.join(compDir, 'MXENCPED.DBF');
  const renPedPath = path.join(compDir, 'MXRENPED.DBF');

  if (fs.existsSync(encPedPath) && fs.existsSync(renPedPath)) {
    const sEnc = readDbfStruct(encPedPath);
    const sRen = readDbfStruct(renPedPath);

    if (sEnc && sRen && sEnc.numRecords > 0) {
      const encRows = readDbfRows(sEnc, ['numped', 'emision', 'cliente', 'nomcli', 'cif', 'codven', 'comen1', 'tot_ped', 'cambio'], 50, true);
      const renRows = readDbfRows(sRen, ['numped', 'item', 'descrip', 'cantidad', 'precio', 'tot_ren'], 500, true);

      const itemsMap = new Map();
      for (const d of renRows) {
        const num = String(d.numped || '').trim().padStart(8, '0');
        if (!itemsMap.has(num)) itemsMap.set(num, []);
        itemsMap.get(num).push(d);
      }

      for (const r of encRows) {
        const num = String(r.numped || '').trim().padStart(8, '0');
        if (!num || num === '00000000') continue;
        if (r.cliente === '00-000' || r.cliente === '00000') continue;

        const docKey = `ped:${num}`;
        if (importedDocuments.has(docKey)) continue;

        const total = parseFloat(String(r.tot_ped || '0').replace(/,/g, '.')) || 0;
        if (total <= 0) continue;

        const existing = await sbGet('jjp_orders', `order_number=eq.${num}&select=id`);
        if (existing && existing.length > 0) {
          importedDocuments.add(docKey);
          continue;
        }

        const codven = String(r.codven || '').trim();
        const sellerProfile = SELLER_CODVEN_TO_PROFILE[codven] || SELLER_CODVEN_TO_PROFILE['010'];
        const sellerId = sellerProfile.id;
        const rate = parseFloat(String(r.cambio || '0').replace(/,/g, '.')) || 0;

        const rawItems = itemsMap.get(num) || [];
        const items = rawItems.map(i => ({
          sku: String(i.item || '').trim(),
          name: String(i.descrip || 'Articulo').trim(),
          qty: parseFloat(String(i.cantidad || '1').replace(/,/g, '.')) || 1,
          price_usd: parseFloat(String(i.precio || '0').replace(/,/g, '.')) || 0,
          subtotal_usd: parseFloat(String(i.tot_ren || '0').replace(/,/g, '.')) || 0
        }));

        const payload = {
          order_number: num,
          client_name: String(r.nomcli || 'Cliente MixNet').trim(),
          rif: String(r.cif || '').trim() || null,
          items,
          subtotal_usd: total,
          total_usd: total,
          exchange_rate: rate,
          total_bs: rate > 0 ? +(total * rate).toFixed(2) : 0,
          payment_method: 'efectivo',
          notes: String(r.comen1 || '').trim() || null,
          source: 'mixnet',
          status: 'pagado',
          seller_id: sellerId
        };

        try {
          await sbPost('jjp_orders', payload);
          importedDocuments.add(docKey);
          importedOrders++;
          log(`Pedido #${num} importado de MixNet: $${total.toFixed(2)} [Vendedor: ${sellerProfile.name}]`);
        } catch (err) {
          log(`Aviso importando pedido #${num}: ${err.message}`, 'WARN');
        }
      }
    }
  }

  return { importedQuotes, importedOrders };
}

/**
 * Exporta cotizaciones y pedidos pendientes creados en la web hacia MixNet.
 */
export async function exportPendingDocumentsToMixnet(compDir) {
  let exportedQuotes = 0;
  let exportedOrders = 0;

  // 1. Cotizaciones expresamente solicitadas para confirmación e inyección en MixNet
  try {
    const pendingQuotes = await sbGet(
      'jjp_quotes',
      'status=eq.pendiente_mixnet&source=neq.mixnet&order=created_at.asc&limit=5'
    );

    if (Array.isArray(pendingQuotes) && pendingQuotes.length > 0) {
      for (const q of pendingQuotes) {
        if (q.source === 'mixnet') continue; // Doble guarda contra duplicación

        // Bloqueo atómico inmediato para evitar re-inyección en ciclos paralelos
        await sbPatch('jjp_quotes', `id=eq.${q.id}`, { status: 'procesando_mixnet' });

        // Validar datos básicos
        const items = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items || '[]') : []);
        if (items.length === 0 || !q.client_name || q.client_name === '00-000' || q.client_name === '00000') {
          await sbPatch('jjp_quotes', `id=eq.${q.id}`, { status: 'error_validacion' });
          continue;
        }

        const codven = (q.seller_id && PROFILE_ID_TO_CODVEN[q.seller_id]) ? PROFILE_ID_TO_CODVEN[q.seller_id] : '';

        const res = injectQuoteToMixnet(compDir, {
          quote_number: q.quote_number,
          client_name: q.client_name,
          rif: q.rif,
          items,
          estimated_total_usd: q.estimated_total_usd,
          exchange_rate: q.exchange_rate,
          notes: q.notes,
          codven
        });

        if (res && res.ok) {
          // Actualizar estado soberano en Supabase
          await sbPatch('jjp_quotes', `id=eq.${q.id}`, {
            quote_number: res.numcot,
            status: 'confirmado_mixnet',
            source: 'mixnet'
          });
          importedDocuments.add(`cot:${res.numcot}`);
          exportedQuotes++;
        }
      }
    }
  } catch (err) {
    log(`Aviso en exportación de cotizaciones: ${err.message}`, 'WARN');
  }

  // 2. Pedidos expresamente solicitados para confirmación e inyección en MixNet
  try {
    const pendingOrders = await sbGet(
      'jjp_orders',
      'status=eq.pendiente_mixnet&source=neq.mixnet&order=created_at.asc&limit=5'
    );

    if (Array.isArray(pendingOrders) && pendingOrders.length > 0) {
      for (const o of pendingOrders) {
        if (o.source === 'mixnet') continue; // Doble guarda

        // Bloqueo atómico inmediato
        await sbPatch('jjp_orders', `id=eq.${o.id}`, { status: 'procesando_mixnet' });

        const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || '[]') : []);
        if (items.length === 0 || !o.client_name || o.client_name === '00-000' || o.client_name === '00000') {
          await sbPatch('jjp_orders', `id=eq.${o.id}`, { status: 'error_validacion' });
          continue;
        }

        const codven = (o.seller_id && PROFILE_ID_TO_CODVEN[o.seller_id]) ? PROFILE_ID_TO_CODVEN[o.seller_id] : '';

        const res = injectOrderToMixnet(compDir, {
          order_number: o.order_number,
          client_name: o.client_name,
          rif: o.rif,
          items,
          total_usd: o.total_usd,
          exchange_rate: o.exchange_rate,
          notes: o.notes,
          codven
        });

        if (res && res.ok) {
          await sbPatch('jjp_orders', `id=eq.${o.id}`, {
            order_number: res.numped,
            status: 'confirmado_mixnet',
            source: 'mixnet'
          });
          importedDocuments.add(`ped:${res.numped}`);
          exportedOrders++;
        }
      }
    }
  } catch (err) {
    log(`Aviso en exportación de pedidos: ${err.message}`, 'WARN');
  }

  return { exportedQuotes, exportedOrders };
}
