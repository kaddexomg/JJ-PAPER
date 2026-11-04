/* ======================================================================
   JJ Paper — JJ-MIXNET-AGENT: Motor Agéntico de Ejecución de Tareas
   ======================================================================
   Consume y ejecuta tareas de la tabla jjp_mixnet_tasks de Supabase,
   reportando resultados estructurados y diagnósticos en tiempo real.
   ====================================================================== */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pollPendingTasks, updateTaskStatus, sbGet, sbPatch } from './supabase-client.js';
import { syncCatalogFromMixnet } from './sync-catalog.js';
import { syncSuppliersFromMixnet } from './sync-suppliers.js';
import { importMixnetDocuments, exportPendingDocumentsToMixnet } from './sync-documents.js';
import { reindexNtx } from './ntx-builder.js';
import { injectQuoteToMixnet, injectOrderToMixnet, readDbfStruct } from './dbf-driver.js';
import { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup } from './client-reconciler.js';
import { getMixnetUsers, updateMixnetUserPermissions } from './mixnet-usuar.js';
import { SELLER_CODVEN_TO_PROFILE, PROFILE_ID_TO_CODVEN, log } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Procesa la cola de tareas pendientes en jjp_mixnet_tasks
 */
export async function processAgentTasks(compDir) {
  const tasks = await pollPendingTasks();
  if (tasks.length === 0) return 0;

  for (const task of tasks) {
        const { id, action, payload = {} } = task;
    // Si la tarea está destinada exclusivamente al VPS, Supervisor-PC la ignora
    if (payload.target && payload.target !== 'supervisor' && payload.target !== 'lan' && payload.target !== 'all') {
      continue;
    }
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

        case 'sync_suppliers': {
          log('[AGENTE] Sincronizando catálogo de proveedores de MixNet...');
          const res = await syncSuppliersFromMixnet(compDir);
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
          let quote = payload.quote;
          if (!quote && payload.quote_id) {
            const rows = await sbGet('jjp_quotes', `id=eq.${payload.quote_id}&limit=1`);
            if (Array.isArray(rows) && rows.length > 0) quote = rows[0];
          }
          if (!quote) throw new Error('Falta payload.quote o payload.quote_id para inyectar cotización.');
          if (!quote.codven && quote.seller_id) {
            quote.codven = PROFILE_ID_TO_CODVEN[quote.seller_id] || '';
          }
          if (!quote.codven) {
            log(`[SEGURIDAD NÓMINA] Cotización #${quote.quote_number || quote.id} no posee vendedor asignado. Cero auto-adjudicación a admin.`, 'WARN');
          } else {
            log(`[SEGURIDAD NÓMINA] Inyectando cotización #${quote.quote_number || quote.id} estrictamente bajo CODVEN '${quote.codven}'.`);
          }

          // Snapshot preventivo obligatorio antes de tocar tablas de cotizaciones
          try {
            createBackup(compDir, `pre_quote_${quote.quote_number || 'new'}`);
          } catch (bErr) {
            log(`Aviso generando backup preventivo: ${bErr.message}`, 'WARN');
          }

          const res = injectQuoteToMixnet(compDir, quote);
          if (res && res.ok && (payload.quote_id || quote.id)) {
            const qId = payload.quote_id || quote.id;
            await sbPatch('jjp_quotes', `id=eq.${qId}`, {
              quote_number: res.numcot,
              status: 'confirmado_mixnet',
              source: 'mixnet'
            }).catch(e => log(`Aviso actualizando cotización en Supabase: ${e.message}`, 'WARN'));
          }
          result = { ok: true, ...res };
          break;
        }

        case 'inject_order': {
          let order = payload.order;
          if (!order && payload.order_id) {
            const rows = await sbGet('jjp_orders', `id=eq.${payload.order_id}&limit=1`);
            if (Array.isArray(rows) && rows.length > 0) order = rows[0];
          }
          if (!order) throw new Error('Falta payload.order o payload.order_id para inyectar pedido.');
          if (!order.codven && order.seller_id) {
            order.codven = PROFILE_ID_TO_CODVEN[order.seller_id] || '';
          }
          if (!order.codven) {
            log(`[SEGURIDAD NÓMINA] Pedido #${order.order_number || order.id} no posee vendedor asignado. Cero auto-adjudicación a admin.`, 'WARN');
          } else {
            log(`[SEGURIDAD NÓMINA] Inyectando pedido #${order.order_number || order.id} estrictamente bajo CODVEN '${order.codven}'.`);
          }

          // Snapshot preventivo obligatorio antes de tocar tablas de pedidos
          try {
            createBackup(compDir, `pre_order_${order.order_number || 'new'}`);
          } catch (bErr) {
            log(`Aviso generando backup preventivo: ${bErr.message}`, 'WARN');
          }

          const res = injectOrderToMixnet(compDir, order);
          if (res && res.ok && (payload.order_id || order.id)) {
            const oId = payload.order_id || order.id;
            await sbPatch('jjp_orders', `id=eq.${oId}`, {
              order_number: res.numped,
              status: 'confirmado_mixnet',
              source: 'mixnet'
            }).catch(e => log(`Aviso actualizando pedido en Supabase: ${e.message}`, 'WARN'));
          }
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
          log('[AGENTE] Consultando seguridad y nómina de MixNet (MXCTAVDD + MXUSER*.EXT + MXSECURI)...');
          const realUsers = getMixnetUsers(compDir);
          result = realUsers;
          break;
        }

        case 'update_user_permissions': {
          log(`[AGENTE] Solicitud de modificación de permisos de usuario recibida...`);
          const userCode = payload.user_code || payload.code || (payload.recordIndex ? String(payload.recordIndex).padStart(3, '0') : '');
          const permissions = payload.permissions || payload.values || {};
          const res = await updateMixnetUserPermissions(compDir, userCode, permissions);
          result = res;
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

                case 'exec_cmd':
        case 'terminal_command':
        case 'run_command': {
          const cmd = payload.command || payload.cmd;
          if (!cmd) throw new Error('Falta payload.command para ejecutar.');
          log(`[AGENTE] Ejecutando comando de terminal en Supervisor-Pc: ${cmd}`);
          const repoRoot = path.resolve(__dirname, '..');
          const runCwd = payload.cwd === 'comp01' ? compDir : (payload.cwd || repoRoot);
          let stdout = '';
          let stderr = '';
          let code = 0;
          try {
            stdout = execSync(cmd, {
              cwd: runCwd,
              encoding: 'utf8',
              timeout: payload.timeout || 45000,
              windowsHide: true
            });
          } catch (e) {
            code = e.status || 1;
            stdout = e.stdout ? String(e.stdout) : '';
            stderr = e.stderr ? String(e.stderr) : e.message;
          }
          result = {
            ok: code === 0,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            target: 'supervisor',
            platform: process.platform,
            executedAt: new Date().toISOString()
          };
          break;
        }

        case 'exec_python': {
          const pyCode = payload.code || payload.script;
          if (!pyCode) throw new Error('Falta payload.code para ejecutar Python.');
          log('[AGENTE] Ejecutando script Python en Supervisor-Pc...');
          const repoRoot = path.resolve(__dirname, '..');
          const scratchDir = path.join(repoRoot, 'scratch');
          if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
          const tmpScript = path.join(scratchDir, `agent_py_${Date.now()}.py`);
          fs.writeFileSync(tmpScript, pyCode, 'utf8');
          let stdout = '';
          let stderr = '';
          let code = 0;
          try {
            stdout = execSync(`python "${tmpScript}"`, {
              cwd: repoRoot,
              encoding: 'utf8',
              timeout: payload.timeout || 45000,
              windowsHide: true
            });
          } catch (e) {
            code = e.status || 1;
            stdout = e.stdout ? String(e.stdout) : '';
            stderr = e.stderr ? String(e.stderr) : e.message;
          } finally {
            try { fs.unlinkSync(tmpScript); } catch (_) {}
          }
          result = {
            ok: code === 0,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            target: 'supervisor'
          };
          break;
        }

        case 'exec_node': {
          const jsCode = payload.code || payload.script;
          if (!jsCode) throw new Error('Falta payload.code para ejecutar Node.js.');
          log('[AGENTE] Ejecutando script Node.js en Supervisor-Pc...');
          const repoRoot = path.resolve(__dirname, '..');
          const scratchDir = path.join(repoRoot, 'scratch');
          if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
          const tmpScript = path.join(scratchDir, `agent_node_${Date.now()}.cjs`);
          fs.writeFileSync(tmpScript, jsCode, 'utf8');
          let stdout = '';
          let stderr = '';
          let code = 0;
          try {
            stdout = execSync(`node "${tmpScript}"`, {
              cwd: repoRoot,
              encoding: 'utf8',
              timeout: payload.timeout || 45000,
              windowsHide: true
            });
          } catch (e) {
            code = e.status || 1;
            stdout = e.stdout ? String(e.stdout) : '';
            stderr = e.stderr ? String(e.stderr) : e.message;
          } finally {
            try { fs.unlinkSync(tmpScript); } catch (_) {}
          }
          result = {
            ok: code === 0,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            target: 'supervisor'
          };
          break;
        }

        case 'read_file': {
          const relPath = payload.path || payload.filePath;
          if (!relPath) throw new Error('Falta payload.path para leer archivo.');
          const repoRoot = path.resolve(__dirname, '..');
          const fullPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
          if (!fs.existsSync(fullPath)) throw new Error(`Archivo no encontrado: ${relPath}`);
          const content = fs.readFileSync(fullPath, 'utf8');
          result = {
            ok: true,
            path: relPath,
            sizeBytes: Buffer.byteLength(content, 'utf8'),
            content: content.slice(0, 500000)
          };
          break;
        }

        case 'patch_file': {
          const relPath = payload.path || payload.filePath;
          if (!relPath) throw new Error('Falta payload.path para modificar.');
          const repoRoot = path.resolve(__dirname, '..');
          const fullPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
          if (!fs.existsSync(fullPath)) throw new Error(`Archivo no encontrado: ${relPath}`);
          
          const bakPath = fullPath + '.bak';
          fs.copyFileSync(fullPath, bakPath);
          
          let content = fs.readFileSync(fullPath, 'utf8');
          if (payload.target && payload.replacement !== undefined) {
            if (!content.includes(payload.target)) {
              throw new Error('Target no encontrado en el archivo para reemplazar.');
            }
            content = content.replace(payload.target, payload.replacement);
          } else if (payload.content !== undefined) {
            content = payload.content;
          }
          fs.writeFileSync(fullPath, content, 'utf8');
          
          let syntaxCheck = 'skipped';
          if (fullPath.endsWith('.js') || fullPath.endsWith('.mjs') || fullPath.endsWith('.cjs')) {
            try {
              execSync(`node -c "${fullPath}"`, { timeout: 10000, encoding: 'utf8' });
              syntaxCheck = 'passed';
            } catch (syntErr) {
              fs.copyFileSync(bakPath, fullPath);
              throw new Error(`Autocorrección abortada: Falló verificación de sintaxis (${syntErr.message}). Archivo restaurado desde .bak.`);
            }
          }
          result = {
            ok: true,
            path: relPath,
            syntaxCheck,
            backupCreated: bakPath,
            modifiedAt: new Date().toISOString()
          };
          break;
        }

        case 'git_pull':
        case 'self_update': {
          log('[AGENTE] Ejecutando auto-actualización vía git pull...');
          let pullOutput = '';
          const repoRoot = path.resolve(__dirname, '..');
          try {
            pullOutput = execSync('git pull origin main', {
              cwd: repoRoot,
              encoding: 'utf8',
              timeout: 30000
            });
          } catch (e) {
            pullOutput = `git pull falló: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`;
          }
          result = { ok: true, output: pullOutput.trim() };
          await updateTaskStatus(id, 'completed', result);
          log(`[AGENTE] Auto-actualización completada: ${pullOutput.trim()}`);
          if (payload.restart !== false) {
            log('[AGENTE] Reiniciando proceso para cargar el código actualizado...');
            setTimeout(() => process.exit(1), 1000);
          }
          return tasks.length;
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

export { reconcileClients, getClientsDiscrepancies, createBackup, rollbackBackup, syncSuppliersFromMixnet };
