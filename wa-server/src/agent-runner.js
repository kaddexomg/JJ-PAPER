/* ======================================================================
   JJ Paper wa-server — Agente de Ejecución de Código en VPS (Ubuntu)
   ======================================================================
   Ejecuta comandos de terminal Bash, scripts en Python/Node, lectura
   y edición quirúrgica de archivos en el VPS cuando se envía una tarea
   desde la Consola Agéntica con target 'vps' o 'all'.
   ====================================================================== */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbCore } from './supabase.js';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vpsRoot = path.resolve(__dirname, '../..');

let isProcessing = false;

export async function processVpsAgentTasks() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { data: tasks, error } = await dbCore
      .from('jjp_mixnet_tasks')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error || !tasks || tasks.length === 0) return;

    for (const task of tasks) {
      const { id, action, payload = {} } = task;
      // Solo atender tareas destinadas al VPS o a todos
      if (payload.target !== 'vps' && payload.target !== 'all') {
        continue;
      }

      log.info({ taskId: id, action }, '[VPS-AGENTE] Procesando tarea agéntica en Ubuntu');
      await dbCore.from('jjp_mixnet_tasks').update({ status: 'running' }).eq('id', id);

      let result = null;
      let hasError = false;
      let errorMsg = null;

      try {
        switch (action) {
          case 'exec_cmd':
          case 'terminal_command':
          case 'run_command': {
            const cmd = payload.command || payload.cmd;
            if (!cmd) throw new Error('Falta payload.command para ejecutar.');
            const runCwd = payload.cwd ? (path.isAbsolute(payload.cwd) ? payload.cwd : path.join(vpsRoot, payload.cwd)) : vpsRoot;
            let stdout = '';
            let stderr = '';
            let code = 0;
            try {
              stdout = execSync(cmd, {
                cwd: runCwd,
                encoding: 'utf8',
                timeout: payload.timeout || 45000,
                shell: '/bin/bash'
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
              target: 'vps',
              platform: process.platform,
              executedAt: new Date().toISOString()
            };
            break;
          }

          case 'exec_python': {
            const pyCode = payload.code || payload.script;
            if (!pyCode) throw new Error('Falta payload.code para ejecutar Python.');
            const scratchDir = path.join(vpsRoot, 'scratch');
            if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
            const tmpScript = path.join(scratchDir, `vps_py_${Date.now()}.py`);
            fs.writeFileSync(tmpScript, pyCode, 'utf8');
            let stdout = '';
            let stderr = '';
            let code = 0;
            try {
              stdout = execSync(`python3 "${tmpScript}"`, {
                cwd: vpsRoot,
                encoding: 'utf8',
                timeout: payload.timeout || 45000,
                shell: '/bin/bash'
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
              target: 'vps'
            };
            break;
          }

          case 'exec_node': {
            const jsCode = payload.code || payload.script;
            if (!jsCode) throw new Error('Falta payload.code para ejecutar Node.');
            const scratchDir = path.join(vpsRoot, 'scratch');
            if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
            const tmpScript = path.join(scratchDir, `vps_node_${Date.now()}.cjs`);
            fs.writeFileSync(tmpScript, jsCode, 'utf8');
            let stdout = '';
            let stderr = '';
            let code = 0;
            try {
              stdout = execSync(`node "${tmpScript}"`, {
                cwd: vpsRoot,
                encoding: 'utf8',
                timeout: payload.timeout || 45000,
                shell: '/bin/bash'
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
              target: 'vps'
            };
            break;
          }

          case 'git_pull': {
            let pullOut = '';
            try {
              pullOut = execSync('git pull origin main', { cwd: vpsRoot, encoding: 'utf8', timeout: 30000 });
            } catch (e) {
              pullOut = `git pull falló: ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`;
            }
            result = { ok: true, output: pullOut.trim(), target: 'vps' };
            break;
          }

          default:
            throw new Error(`Acción desconocida para el agente VPS: '${action}'`);
        }

        await dbCore.from('jjp_mixnet_tasks').update({
          status: 'completed',
          result,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', id);

        log.info({ taskId: id }, '[VPS-AGENTE] Tarea completada con éxito');
      } catch (err) {
        log.error({ taskId: id, err: err.message }, '[VPS-AGENTE] Error ejecutando tarea');
        await dbCore.from('jjp_mixnet_tasks').update({
          status: 'failed',
          error: err.message,
          result: { ok: false, error: err.message, target: 'vps' },
          updated_at: new Date().toISOString()
        }).eq('id', id);
      }
    }
  } finally {
    isProcessing = false;
  }
}

export function startVpsAgentRunner() {
  log.info('[VPS-AGENTE] Iniciando servicio agéntico de ejecución de código en VPS');
  setInterval(() => {
    processVpsAgentTasks().catch(e => log.error({ err: e.message }, 'Error en sweep de tareas VPS'));
  }, 4000);
}
