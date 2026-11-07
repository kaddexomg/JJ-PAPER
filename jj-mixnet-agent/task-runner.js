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
import { injectQuoteToMixnet, injectOrderToMixnet, readDbfStruct, readDbfRows, resolveMixnetClientByCodcli } from './dbf-driver.js';
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
          const runCwd = (payload.cwd === 'comp01' && compDir) ? compDir : (payload.cwd || repoRoot);
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

          // Proveer módulo nativo dbf.py en scratch/ para que 'import dbf' o 'read_dbf()' jamás fallen
          const dbfShimPath = path.join(scratchDir, 'dbf.py');
          const safeCompDir = (compDir || '\\\\servidor\\MIX11\\comp01').replace(/\\/g, '\\\\');
          const dbfShimCode = `# Native zero-dependency DBF reader shim for JJ Paper OpenCode
import os, struct

COMP01_DIR = "${safeCompDir}"

def _resolve_path(name):
    if os.path.exists(name): return name
    base = name if name.upper().endswith('.DBF') else name + '.DBF'
    for cand_dir in [COMP01_DIR, r'M:\\MIX11\\comp01', r'\\\\servidor\\MIX11\\comp01', r'M:\\comp01', r'D:\\MIX11\\comp01']:
        p = os.path.join(cand_dir, base)
        if os.path.exists(p): return p
    return name

class DbfRow(dict):
    def __getattr__(self, k):
        lk = k.lower()
        if lk in self: return self[lk]
        if k.upper() in self: return self[k.upper()]
        raise AttributeError(k)
    def __getitem__(self, k):
        if isinstance(k, str):
            lk = k.lower()
            if dict.__contains__(self, lk): return dict.__getitem__(self, lk)
            if dict.__contains__(self, k.upper()): return dict.__getitem__(self, k.upper())
        return dict.__getitem__(self, k)

class Table:
    def __init__(self, filename, *args, **kwargs):
        self.filepath = _resolve_path(filename)
        self.fields = []
        self.field_names = []
        self._rows = None
        self._read_header()
    def _read_header(self):
        if not os.path.exists(self.filepath): return
        with open(self.filepath, 'rb') as f:
            hdr = f.read(32)
            self.num_records, self.header_len, self.record_len = struct.unpack('<IHH', hdr[4:12])
            f.seek(32)
            raw_fields = f.read(self.header_len - 32)
            off, pos = 0, 1
            while off + 32 <= len(raw_fields) and raw_fields[off] != 0x0D:
                name = raw_fields[off:off+11].split(b'\\x00')[0].decode('latin1', errors='ignore').strip().lower()
                ftype = chr(raw_fields[off+11])
                flen = raw_fields[off+16]
                fdec = raw_fields[off+17]
                self.fields.append((name, ftype, flen, fdec, pos))
                self.field_names.append(name)
                pos += flen
                off += 32
    def open(self, *args, **kwargs): return self
    def close(self): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def __len__(self): return getattr(self, 'num_records', 0)
    def read_rows(self, limit=None, backwards=False):
        if not os.path.exists(self.filepath): return []
        rows = []
        with open(self.filepath, 'rb') as f:
            indices = range(self.num_records - 1, -1, -1) if backwards else range(self.num_records)
            for idx in indices:
                f.seek(self.header_len + idx * self.record_len)
                rec = f.read(self.record_len)
                if not rec or len(rec) < self.record_len or rec[0] == 0x2A: continue
                r = DbfRow(_recno=idx+1)
                for name, ftype, flen, fdec, pos in self.fields:
                    val = rec[pos:pos+flen].decode('latin1', errors='ignore').strip()
                    r[name] = val
                    r[name.upper()] = val
                rows.append(r)
                if limit and len(rows) >= limit: break
        return rows
    def __iter__(self):
        return iter(self.read_rows())

def read_dbf(table_name, limit=100, backwards=True):
    return Table(table_name).read_rows(limit=limit, backwards=backwards)
`;
          fs.writeFileSync(dbfShimPath, dbfShimCode, 'utf8');

          const prelude = `import sys, os\nsys.path.insert(0, r"${scratchDir.replace(/\\/g, '\\\\')}")\nfrom dbf import Table, read_dbf, COMP01_DIR\n`;
          const tmpScript = path.join(scratchDir, `agent_py_${Date.now()}.py`);
          fs.writeFileSync(tmpScript, prelude + pyCode, 'utf8');
          const pyCandidates = [
            'C:\\Users\\Supervisor\\AppData\\Local\\Python\\bin\\python.exe',
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Python', 'bin', 'python.exe') : '',
            'C:\\Python312\\python.exe',
            'C:\\Python311\\python.exe',
            'C:\\Python310\\python.exe'
          ].filter(Boolean);
          let pyBin = 'python';
          for (const cand of pyCandidates) {
            if (fs.existsSync(cand)) { pyBin = `"${cand}"`; break; }
          }

          let stdout = '';
          let stderr = '';
          let code = 0;
          try {
            stdout = execSync(`${pyBin} "${tmpScript}"`, {
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
            stdout = execSync(`"${process.execPath}" "${tmpScript}"`, {
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
          const rawContent = fs.readFileSync(fullPath, 'utf8');
          const allLines = rawContent.split(/\r?\n/);
          const startL = Math.max(1, parseInt(payload.startLine || 1, 10));
          const endL = Math.min(allLines.length, parseInt(payload.endLine || Math.min(allLines.length, startL + 220), 10));
          const sliced = allLines.slice(startL - 1, endL).map((l, idx) => `${startL + idx}: ${l}`).join('\n');
          result = {
            ok: true,
            path: relPath,
            totalLines: allLines.length,
            range: `${startL}-${endL}`,
            sizeBytes: Buffer.byteLength(rawContent, 'utf8'),
            content: sliced
          };
          break;
        }

        case 'list_files': {
          const relDir = payload.dir || payload.path || '.';
          const repoRoot = path.resolve(__dirname, '..');
          const fullDir = (relDir === 'comp01' && compDir) ? compDir : (path.isAbsolute(relDir) ? relDir : path.join(repoRoot, relDir));
          if (!fs.existsSync(fullDir)) throw new Error(`Directorio no encontrado: ${relDir}`);
          const entries = fs.readdirSync(fullDir, { withFileTypes: true })
            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
            .map(e => ({
              name: e.name,
              type: e.isDirectory() ? 'dir' : 'file'
            }));
          result = {
            ok: true,
            dir: relDir,
            count: entries.length,
            stdout: entries.map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n')
          };
          break;
        }

        case 'write_file': {
          const relPath = payload.path || payload.filePath;
          if (!relPath || payload.content === undefined) throw new Error('Falta payload.path o payload.content para escribir archivo.');
          const repoRoot = path.resolve(__dirname, '..');
          const fullPath = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
          const dirName = path.dirname(fullPath);
          if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
          let bakPath = null;
          if (fs.existsSync(fullPath)) {
            bakPath = fullPath + '.bak';
            fs.copyFileSync(fullPath, bakPath);
          }
          fs.writeFileSync(fullPath, String(payload.content), 'utf8');
          let syntaxCheck = 'skipped';
          if (fullPath.endsWith('.js') || fullPath.endsWith('.mjs') || fullPath.endsWith('.cjs')) {
            try {
              execSync(`node -c "${fullPath}"`, { timeout: 10000, encoding: 'utf8', windowsHide: true });
              syntaxCheck = 'passed';
            } catch (syntErr) {
              if (bakPath && fs.existsSync(bakPath)) fs.copyFileSync(bakPath, fullPath);
              throw new Error(`Escritura abortada: Error de sintaxis JS (${syntErr.message}).`);
            }
          }
          result = {
            ok: true,
            path: relPath,
            syntaxCheck,
            backupCreated: bakPath,
            stdout: `Archivo ${relPath} escrito y verificado (${syntaxCheck}).`
          };
          break;
        }

        case 'deploy_changes': {
          log('[AGENTE] Ejecutando pipeline de Build y Deploy (build.sh + git commit + push)...');
          const repoRoot = path.resolve(__dirname, '..');
          const commitMsg = payload.message || payload.commitMessage || 'feat(opencode): actualización autónoma desde consola agéntica';
          const stepsLog = [];
          try {
            // 1. Empaquetar dist/ si existe bash
            try {
              const bOut = execSync('bash build.sh', { cwd: repoRoot, encoding: 'utf8', timeout: 30000, windowsHide: true });
              stepsLog.push(`[BUILD] ${bOut.trim().split('\n')[0] || 'dist/ actualizado'}`);
            } catch (_) {
              stepsLog.push('[BUILD] build.sh omitido en este entorno');
            }
            // 2. Git status & commit
            const stOut = execSync('git status -s', { cwd: repoRoot, encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
            if (!stOut) {
              stepsLog.push('[GIT] No hay cambios locales pendientes para comitear.');
            } else {
              execSync('git add -A', { cwd: repoRoot, encoding: 'utf8', timeout: 10000, windowsHide: true });
              const cOut = execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: repoRoot, encoding: 'utf8', timeout: 15000, windowsHide: true });
              stepsLog.push(`[COMMIT] ${cOut.trim()}`);
            }
            // 3. Git push
            const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
            try {
              const pOut = execSync('git push origin main', { cwd: repoRoot, encoding: 'utf8', timeout: 25000, windowsHide: true, env: gitEnv });
              stepsLog.push(`[PUSH] Cambios publicados en origin/main (Cloudflare Pages desplegando): ${pOut.trim() || 'OK'}`);
            } catch (pushErr) {
              stepsLog.push(`[AVISO PUSH] Commit guardado localmente. Para push directo desde este nodo configure credencial Git (${pushErr.message.split('\n')[0]}).`);
            }
          } catch (depErr) {
            throw new Error(`Fallo en pipeline deploy: ${depErr.message}`);
          }
          result = {
            ok: true,
            stdout: stepsLog.join('\n')
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
          
          const oldContent = fs.readFileSync(fullPath, 'utf8');
          let content = oldContent;
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
              execSync(`node -c "${fullPath}"`, { timeout: 10000, encoding: 'utf8', windowsHide: true });
              syntaxCheck = 'passed';
            } catch (syntErr) {
              fs.copyFileSync(bakPath, fullPath);
              throw new Error(`Autocorrección abortada: Falló verificación de sintaxis (${syntErr.message}). Archivo restaurado desde .bak.`);
            }
          }
          const diffPreview = [];
          if (payload.target !== undefined && payload.replacement !== undefined) {
            String(payload.target).split('\n').forEach(l => diffPreview.push(`- ${l}`));
            String(payload.replacement).split('\n').forEach(l => diffPreview.push(`+ ${l}`));
          }
          result = {
            ok: true,
            path: relPath,
            syntaxCheck,
            backupCreated: bakPath,
            diff: diffPreview.join('\n'),
            modifiedAt: new Date().toISOString()
          };
          break;
        }

        case 'sales_today': {
          log('[AGENTE] Ejecutando Skill Diario: Resumen de Ventas y Cotizaciones de Hoy...');
          if (!compDir) throw new Error('Directorio comp01 no detectado.');
          const todayStr = payload.date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const encPedPath = path.join(compDir, 'MXENCPED.DBF');
          const encCotPath = path.join(compDir, 'MXENCCOT.DBF');
          const sPed = readDbfStruct(encPedPath);
          const sCot = readDbfStruct(encCotPath);
          const pedRows = sPed ? readDbfRows(sPed, ['numped', 'emision', 'cliente', 'nomcli', 'codven', 'tot_ped', 'cambio', 'moneda', 'estatus'], 250, true) : [];
          const cotRows = sCot ? readDbfRows(sCot, ['numcot', 'emision', 'cliente', 'nomcli', 'codven', 'tot_cot', 'cambio', 'moneda', 'estatus'], 250, true) : [];

          const latestDate = pedRows[0]?.emision || cotRows[0]?.emision || todayStr;
          const targetDate = pedRows.some(r => r.emision === todayStr) || cotRows.some(r => r.emision === todayStr) ? todayStr : latestDate;

          const normUsd = (rawTot, rawRate, rawMon) => {
            let t = parseFloat(String(rawTot || '0').replace(/,/g, '.')) || 0;
            const rate = parseFloat(String(rawRate || '0').replace(/,/g, '.')) || 0;
            const mon = String(rawMon || '').toUpperCase();
            if (rate > 30 && (mon.includes('BS') || mon.includes('VES') || t > 15000)) {
              t = +(t / rate).toFixed(2);
            }
            return +t.toFixed(2);
          };

          const dayOrders = pedRows.filter(r => r.emision === targetDate && r.cliente !== '00-000').map(r => {
            const usd = normUsd(r.tot_ped, r.cambio, r.moneda);
            const seller = SELLER_CODVEN_TO_PROFILE[r.codven]?.name || `Vendedor ${r.codven || 'S/A'}`;
            const cliInfo = resolveMixnetClientByCodcli(compDir, r.cliente);
            return { num: r.numped, client: r.nomcli || cliInfo?.nomcli || r.cliente, codven: r.codven, seller, total_usd: usd, status: r.estatus };
          });

          const dayQuotes = cotRows.filter(r => r.emision === targetDate && r.cliente !== '00-000').map(r => {
            const usd = normUsd(r.tot_cot, r.cambio, r.moneda);
            const seller = SELLER_CODVEN_TO_PROFILE[r.codven]?.name || `Vendedor ${r.codven || 'S/A'}`;
            return { num: r.numcot, client: r.nomcli || r.cliente, codven: r.codven, seller, total_usd: usd, status: r.estatus };
          });

          const bySeller = {};
          for (const o of dayOrders) {
            if (!bySeller[o.seller]) bySeller[o.seller] = { ordersCount: 0, ordersUsd: 0, quotesCount: 0, quotesUsd: 0 };
            bySeller[o.seller].ordersCount++;
            bySeller[o.seller].ordersUsd = +(bySeller[o.seller].ordersUsd + o.total_usd).toFixed(2);
          }
          for (const q of dayQuotes) {
            if (!bySeller[q.seller]) bySeller[q.seller] = { ordersCount: 0, ordersUsd: 0, quotesCount: 0, quotesUsd: 0 };
            bySeller[q.seller].quotesCount++;
            bySeller[q.seller].quotesUsd = +(bySeller[q.seller].quotesUsd + q.total_usd).toFixed(2);
          }

          result = {
            ok: true,
            salesReport: {
              date: `${targetDate.slice(0,4)}-${targetDate.slice(4,6)}-${targetDate.slice(6,8)}`,
              ordersCount: dayOrders.length,
              ordersTotalUsd: +dayOrders.reduce((s, x) => s + x.total_usd, 0).toFixed(2),
              quotesCount: dayQuotes.length,
              quotesTotalUsd: +dayQuotes.reduce((s, x) => s + x.total_usd, 0).toFixed(2),
              bySeller,
              recentOrders: dayOrders.slice(0, 10),
              recentQuotes: dayQuotes.slice(0, 10)
            }
          };
          break;
        }

        case 'inspect_dbf': {
          if (!compDir) throw new Error('Directorio comp01 no detectado.');
          const rawTable = String(payload.table || '').trim().toUpperCase();
          if (!rawTable || rawTable === 'LIST' || rawTable === 'ALL') {
            const files = fs.readdirSync(compDir).filter(f => f.toUpperCase().endsWith('.DBF'));
            const summary = files.map(f => {
              const st = readDbfStruct(path.join(compDir, f));
              return {
                table: f,
                records: st ? st.numRecords : 0,
                fieldsCount: st ? st.fields.length : 0,
                recordBytes: st ? st.recordLen : 0
              };
            });
            result = { ok: true, dbfList: summary };
            break;
          }
          const fileName = rawTable.endsWith('.DBF') ? rawTable : `${rawTable}.DBF`;
          const dbfPath = path.join(compDir, fileName);
          if (!fs.existsSync(dbfPath)) throw new Error(`Tabla DBF no encontrada en comp01: ${fileName}`);
          const struct = readDbfStruct(dbfPath);
          const sampleRows = readDbfRows(struct, null, payload.limit || 5, true);
          result = {
            ok: true,
            dbfInspect: {
              table: fileName,
              numRecords: struct.numRecords,
              headerLen: struct.headerLen,
              recordLen: struct.recordLen,
              fields: struct.fields,
              sampleRows
            }
          };
          break;
        }

        case 'explore_mixnet':
        case 'grep_code': {
          const query = String(payload.query || payload.term || '').trim();
          const scope = payload.scope || 'both'; // 'mixnet' | 'jjpaper' | 'both'
          const matches = [];
          const mixnetRoot = compDir ? path.dirname(compDir) : 'M:\\MIX11';

          const searchDir = (dirPath, exts, maxDepth = 2, curDepth = 0) => {
            if (curDepth > maxDepth || !fs.existsSync(dirPath)) return;
            let entries = [];
            try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (_) { return; }
            for (const ent of entries) {
              if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'backups') continue;
              const full = path.join(dirPath, ent.name);
              if (ent.isDirectory()) {
                searchDir(full, exts, maxDepth, curDepth + 1);
              } else if (exts.some(ext => ent.name.toUpperCase().endsWith(ext))) {
                if (!query) {
                  matches.push({ file: full, line: 0, preview: `[Archivo detectado: ${ent.name}]` });
                } else {
                  try {
                    const stat = fs.statSync(full);
                    if (stat.size > 2 * 1024 * 1024) continue;
                    const text = fs.readFileSync(full, 'latin1');
                    const lines = text.split(/\r?\n/);
                    const qLower = query.toLowerCase();
                    for (let i = 0; i < lines.length; i++) {
                      if (lines[i].toLowerCase().includes(qLower)) {
                        matches.push({ file: full, line: i + 1, preview: lines[i].trim().slice(0, 140) });
                        if (matches.length >= 60) return;
                      }
                    }
                  } catch (_) {}
                }
              }
              if (matches.length >= 60) return;
            }
          };

          if (scope === 'mixnet' || scope === 'both') {
            searchDir(mixnetRoot, ['.PRG', '.CH', '.LNK', '.INI', '.BAT', '.CFG', '.TXT', '.EXT'], 2);
            // También buscar en nombres de columnas de todos los DBF de comp01
            if (compDir && query) {
              const dbfs = fs.readdirSync(compDir).filter(f => f.toUpperCase().endsWith('.DBF'));
              const qLow = query.toLowerCase();
              for (const f of dbfs) {
                const st = readDbfStruct(path.join(compDir, f));
                if (!st) continue;
                for (const fld of st.fields) {
                  if (fld.name.includes(qLow)) {
                    matches.push({
                      file: `comp01/${f}`,
                      line: fld.pos,
                      preview: `Columna DBF: ${fld.name.toUpperCase()} (${fld.type}, len=${fld.len}, dec=${fld.dec})`
                    });
                  }
                }
              }
            }
          }
          if ((scope === 'jjpaper' || scope === 'both') && query && matches.length < 60) {
            const repoRoot = path.resolve(__dirname, '..');
            searchDir(path.join(repoRoot, 'jj-mixnet-agent'), ['.JS', '.MJS'], 1);
            searchDir(path.join(repoRoot, 'assets', 'js'), ['.JS'], 2);
          }

          result = {
            ok: true,
            query: query || '*',
            matchesCount: matches.length,
            codeMatches: matches
          };
          break;
        }

        case 'schema_bridge': {
          if (!compDir) throw new Error('Directorio comp01 no detectado.');
          const dbfName = String(payload.dbf || 'MXCTACLI').toUpperCase().replace(/\.DBF$/, '') + '.DBF';
          const pgTable = String(payload.pgTable || 'jjp_customers').toLowerCase();
          const dbfPath = path.join(compDir, dbfName);
          if (!fs.existsSync(dbfPath)) throw new Error(`Tabla MixNet ${dbfName} no existe.`);
          const sDbf = readDbfStruct(dbfPath);
          const samplePg = await sbGet(pgTable, 'limit=1').catch(() => []);
          const pgCols = Array.isArray(samplePg) && samplePg.length > 0 ? Object.keys(samplePg[0]) : [];

          result = {
            ok: true,
            schemaBridge: {
              dbfTable: dbfName,
              dbfRecords: sDbf.numRecords,
              dbfFields: sDbf.fields.map(f => `${f.name.toUpperCase()}(${f.type}:${f.len})`),
              pgTable,
              pgColumns: pgCols
            }
          };
          break;
        }

        case 'mutate_dbf': {
          if (!compDir) throw new Error('Directorio comp01 no detectado.');
          const rawTable = String(payload.table || '').trim().toUpperCase();
          if (!rawTable) throw new Error('Debe especificar payload.table (ej. MXENCCOT, MXCTACLI).');
          const fileName = rawTable.endsWith('.DBF') ? rawTable : `${rawTable}.DBF`;
          const dbfPath = path.join(compDir, fileName);
          if (!fs.existsSync(dbfPath)) throw new Error(`Archivo DBF no existe: ${fileName}`);

          // 1. Snapshot .BAK obligatorio antes de cirugía de datos
          const snapRes = createBackup(compDir, `pre_mutate_${rawTable.replace('.DBF', '')}`);

          // 2. Leer buffer y buscar registro objetivo
          const s = readDbfStruct(dbfPath);
          const buf = fs.readFileSync(dbfPath);
          const whereField = String(payload.whereField || '').toLowerCase();
          const whereValue = String(payload.whereValue || '').trim();
          const recNoTarget = payload.recNo ? parseInt(payload.recNo, 10) : null;
          const updates = payload.updates || {};
          let updatedCount = 0;

          for (let i = 0; i < s.numRecords; i++) {
            const p = s.headerLen + i * s.recordLen;
            if (p + s.recordLen > buf.length) break;
            let isMatch = false;
            if (recNoTarget && (i + 1) === recNoTarget) {
              isMatch = true;
            } else if (whereField && whereValue) {
              const wf = s.fields.find(f => f.name === whereField);
              if (wf) {
                const curVal = buf.toString('latin1', p + wf.pos, p + wf.pos + wf.len).trim();
                if (curVal === whereValue) isMatch = true;
              }
            }
            if (!isMatch) continue;

            if (payload.deleteRecord === true) {
              buf[p] = 0x2A; // Marcar registro como borrado (*) en Clipper
            } else if (payload.undeleteRecord === true) {
              buf[p] = 0x20; // Restaurar registro activo (espacio)
            }

            for (const [k, v] of Object.entries(updates)) {
              const fld = s.fields.find(f => f.name === k.toLowerCase());
              if (!fld) continue;
              let strVal = String(v ?? '');
              if (fld.type === 'N') {
                const num = parseFloat(strVal.replace(/,/g, '.')) || 0;
                strVal = (fld.dec > 0 ? num.toFixed(fld.dec) : String(Math.round(num))).padStart(fld.len, ' ');
              } else {
                strVal = strVal
                  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                  .replace(/[\r\n\t]/g, ' ')
                  .replace(/[^\x20-\x7E]/g, ' ')
                  .trim()
                  .slice(0, fld.len)
                  .padEnd(fld.len, ' ');
              }
              buf.write(strVal, p + fld.pos, fld.len, 'latin1');
            }
            updatedCount++;
          }

          if (updatedCount > 0) {
            fs.writeFileSync(dbfPath, buf);
            // Reindexar automáticamente si se tocaron tablas de cotizaciones o pedidos
            if (fileName.includes('COT')) {
              reindexNtx(path.join(compDir, 'MXENCCOT.DBF'), path.join(compDir, 'MXENCZX1.NTX'), 'NUMCOT', 8);
              reindexNtx(path.join(compDir, 'MXRENCOT.DBF'), path.join(compDir, 'MXRECZX1.NTX'), 'NUMCOT', 8);
            } else if (fileName.includes('PED')) {
              reindexNtx(path.join(compDir, 'MXENCPED.DBF'), path.join(compDir, 'MXENPEX1.NTX'), 'NUMPED', 8);
              reindexNtx(path.join(compDir, 'MXRENPED.DBF'), path.join(compDir, 'MXREPEX1.NTX'), 'NUMPED', 8);
            }
          }

          result = {
            ok: true,
            table: fileName,
            updatedRecords: updatedCount,
            backupSnapshot: snapRes?.snapshotId || 'creado'
          };
          break;
        }

        case 'read_logs': {
          const logFile = path.join(__dirname, 'logs', 'agent.log');
          let lines = [];
          if (fs.existsSync(logFile)) {
            lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-(payload.lines || 60));
          }
          result = { ok: true, stdout: lines.join('\n') || 'Sin registros recientes en logs/agent.log' };
          break;
        }

        case 'git_pull':
        case 'self_update': {
          log('[AGENTE] Ejecutando auto-actualización silenciosa vía git fetch/reset...');
          let pullOutput = '';
          const repoRoot = path.resolve(__dirname, '..');
          const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
          try {
            execSync('git -c core.askPass= fetch origin main', {
              cwd: repoRoot,
              encoding: 'utf8',
              timeout: 30000,
              windowsHide: true,
              env: gitEnv
            });
            pullOutput = execSync('git -c core.askPass= reset --hard origin/main', {
              cwd: repoRoot,
              encoding: 'utf8',
              timeout: 30000,
              windowsHide: true,
              env: gitEnv
            });
          } catch (e) {
            pullOutput = `git update falló: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`;
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
