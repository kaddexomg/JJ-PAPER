/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Motor Agéntico de Ejecución de Tareas
   ======================================================================
   Consume y ejecuta tareas de la tabla jjp_mixnet_tasks de Supabase,
   reportando resultados estructurados y diagnósticos en tiempo real.
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { pollPendingTasks, updateTaskStatus } from './supabase-client.js';
import { syncCatalogFromMixnet } from './sync-catalog.js';
import { importMixnetDocuments, exportPendingDocumentsToMixnet } from './sync-documents.js';
import { reindexNtx } from './ntx-builder.js';
import { injectQuoteToMixnet, injectOrderToMixnet, readDbfStruct } from './dbf-driver.js';
import { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup } from './client-reconciler.js';
import { SELLER_CODVEN_TO_PROFILE, log } from './config.js';

/**
 * Procesa la cola de tareas pendientes en jjp_mixnet_tasks
 */
export async function processAgentTasks(compDir) {
  const tasks = await pollPendingTasks();
  if (tasks.length === 0) return 0;

  for (const task of tasks) {
    const { id, action, payload = {} } = task;
    log(`[AGENTE] Iniciando tarea agéntica #${id}: '${action}'`);
    await updateTaskStatus(id, 'running');

    try {
      let result = null;

      switch (action) {
        case 'sync_all':
        case 'sync_mixnet': {
          const catRes = await syncCatalogFromMixnet(compDir, payload.force === true);
          const docRes = await importMixnetDocuments(compDir);
          const expRes = await exportPendingDocumentsToMixnet(compDir);
          result = { ok: true, catalog: catRes, imported: docRes, exported: expRes };
          break;
        }

        case 'sync_inventory':
        case 'sync_catalog': {
          const res = await syncCatalogFromMixnet(compDir, payload.force === true);
          result = { ok: true, ...res };
          break;
        }

        case 'sync_documents': {
          const imp = await importMixnetDocuments(compDir);
          const exp = await exportPendingDocumentsToMixnet(compDir);
          result = { ok: true, imported: imp, exported: exp };
          break;
        }

        case 'inject_quote': {
          if (!payload.quote) throw new Error('Falta payload.quote para inyectar cotización.');
          const res = injectQuoteToMixnet(compDir, payload.quote);
          result = { ok: true, ...res };
          break;
        }

        case 'inject_order': {
          if (!payload.order) throw new Error('Falta payload.order para inyectar pedido.');
          const res = injectOrderToMixnet(compDir, payload.order);
          result = { ok: true, ...res };
          break;
        }

        case 'reindex_all': {
          log('[AGENTE] Reindexando todos los índices principales de MixNet...');
          const encCot = path.join(compDir, 'MXENCCOT.DBF');
          const renCot = path.join(compDir, 'MXRENCOT.DBF');
          const encPed = path.join(compDir, 'MXENCPED.DBF');
          const renPed = path.join(compDir, 'MXRENPED.DBF');

          const r1 = reindexNtx(encCot, path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
          const r2 = reindexNtx(encCot, path.join(compDir, 'MXENCZX2.NTX'), 'DTOS(EMISION)', 8);
          const r3 = reindexNtx(encCot, path.join(compDir, 'MXENCZX3.NTX'), 'CLIENTE', 8);
          const r4 = reindexNtx(renCot, path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
          const r5 = reindexNtx(renCot, path.join(compDir, 'MXRECZX2.NTX'), 'ITEM+NUMCOT', 23);

          const r6 = reindexNtx(encPed, path.join(compDir, 'MXENPEX1.NTX'), 'NUMPED', 8);
          const r7 = reindexNtx(encPed, path.join(compDir, 'MXENPEX2.NTX'), 'DTOS(EMISION)', 8);
          const r8 = reindexNtx(encPed, path.join(compDir, 'MXENPEX3.NTX'), 'CLIENTE', 8);
          const r9 = reindexNtx(renPed, path.join(compDir, 'MXREPEX1.NTX'), 'NUMPED', 8);
          const r10 = reindexNtx(renPed, path.join(compDir, 'MXREPEX2.NTX'), 'ITEM+NUMPED', 23);

          result = {
            ok: true,
            indexesRebuilt: 10,
            details: { r1, r2, r3, r4, r5, r6, r7, r8, r9, r10 }
          };
          break;
        }

        case 'audit_health': {
          const numCotBuf = fs.readFileSync(path.join(compDir, 'MXNUMCOT.DBF'));
          const numPedBuf = fs.readFileSync(path.join(compDir, 'MXNUMPED.DBF'));
          const sCot = readDbfStruct(path.join(compDir, 'MXENCCOT.DBF'));
          const sPed = readDbfStruct(path.join(compDir, 'MXENCPED.DBF'));
          const sInv = readDbfStruct(path.join(compDir, 'MXCTAINV.DBF'));

          result = {
            ok: true,
            correlatives: {
              cot: numCotBuf.toString('ascii', sCot ? sCot.headerLen + 1 : 33, sCot ? sCot.headerLen + 9 : 41).trim(),
              ped: numPedBuf.toString('ascii', sPed ? sPed.headerLen + 1 : 33, sPed ? sPed.headerLen + 9 : 41).trim()
            },
            tables: {
              quotes_records: sCot ? sCot.numRecords : 0,
              orders_records: sPed ? sPed.numRecords : 0,
              catalog_records: sInv ? sInv.numRecords : 0
            }
          };
          break;
        }

        case 'list_users': {
          const userList = Object.entries(SELLER_CODVEN_TO_PROFILE).map(([codven, u]) => ({
            codven,
            id: u.id,
            name: u.name
          }));
          result = { ok: true, count: userList.length, users: userList };
          break;
        }

        case 'list_snapshots': {
          const bDir = path.join(compDir, 'backups');
          const snaps = [];
          if (fs.existsSync(bDir)) {
            const files = fs.readdirSync(bDir).filter(f => f.endsWith('.BAK'));
            for (const f of files) {
              const st = fs.statSync(path.join(bDir, f));
              snaps.push({ file: f, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() });
            }
          }
          result = { ok: true, count: snaps.length, snapshots: snaps };
          break;
        }

        case 'reconcile_clients':
        case 'clients_reconcile': {
          log('[AGENTE] Ejecutando tarea de conciliación de clientes...');
          const res = await reconcileClients(compDir);
          result = { ok: true, ...res };
          break;
        }

        case 'clients_discrepancies':
        case 'get_discrepancies': {
          log('[AGENTE] Consultando discrepancias de clientes...');
          const res = await getClientsDiscrepancies(compDir);
          result = { ok: true, ...res };
          break;
        }

        case 'backup':
        case 'create_backup': {
          log('[AGENTE] Creando snapshot de seguridad en comp01/backups/...');
          const res = createBackup(compDir, payload.label || '');
          result = { ok: true, ...res };
          break;
        }

        case 'rollback':
        case 'rollback_snapshot': {
          if (!payload.snapshot && !payload.snapshotId) {
            throw new Error('Falta payload.snapshot o payload.snapshotId para ejecutar rollback.');
          }
          log(`[AGENTE] Ejecutando rollback al snapshot: ${payload.snapshot || payload.snapshotId}...`);
          const res = rollbackBackup(compDir, payload.snapshot || payload.snapshotId);
          result = { ok: true, ...res };
          break;
        }

        default:
          throw new Error(`Acción agéntica desconocida: '${action}'`);
      }

      await updateTaskStatus(id, 'completed', result);
      log(`[AGENTE] Tarea #${id} completada exitosamente.`);
    } catch (err) {
      log(`[AGENTE] Tarea #${id} falló: ${err.message}`, 'ERROR');
      await updateTaskStatus(id, 'failed', { ok: false, error: err.message });
    }
  }

  return tasks.length;
}

export { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup };

