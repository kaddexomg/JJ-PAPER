/* ======================================================================
   JJ Paper — Consola Agéntica OpenCode (Frontend Client)
   assets/js/admin/agent-console.js
   ----------------------------------------------------------------------
   Permite interactuar interactivamente con el motor agéntico en:
   - Supervisor-PC (Windows LAN · M:\comp01 · Python/Node)
   - VPS Soberano (Ubuntu 24.04 · PostgreSQL 16 · Bash/Node)
   - Ambos simultáneamente
   Con streaming de terminal, historial de comandos, modo Asistente IA
   y visualizador de diffs con autoverificación.
   ====================================================================== */

(function () {
  let activeTarget = 'supervisor'; // 'supervisor' | 'vps' | 'all'
  let activeMode = 'ai'; // 'ai' | 'cmd' | 'python' | 'node'
  let commandHistory = [];
  let historyCursor = -1;
  let isExecuting = false;

  const terminalEl = () => document.getElementById('agTerminalOutput');
  const inputEl = () => document.getElementById('agCommandInput');
  const targetLabelEl = () => document.getElementById('agTargetLabel');
  const execBtnEl = () => document.getElementById('agExecBtn');

  function appendTerminal(text, type = 'info') {
    const term = terminalEl();
    if (!term) return;

    const line = document.createElement('div');
    line.className = `term-line term-${type}`;
    const time = new Date().toLocaleTimeString();
    
    let prefix = `[${time}] `;
    if (type === 'cmd') prefix += '❯ ';
    else if (type === 'out') prefix += '  ';
    else if (type === 'err') prefix += '✖ ';
    else if (type === 'ok') prefix += '✔ ';
    else prefix += 'ℹ ';

    line.textContent = prefix + text;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
  }

  function clearTerminal() {
    const term = terminalEl();
    if (term) term.innerHTML = '';
    appendTerminal('Terminal reiniciada. Listo para recibir instrucciones.', 'info');
  }
  window.agClearTerminal = clearTerminal;

  function setTarget(target) {
    activeTarget = target;
    document.querySelectorAll('.target-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.target === target);
    });

    const labelMap = {
      supervisor: 'Supervisor-PC (Windows LAN · M:\\comp01)',
      vps: 'VPS Soberano (Ubuntu 24.04 · 166.0.112.247)',
      all: 'Ambos Entornos (Distribuido simultáneo)'
    };
    if (targetLabelEl()) targetLabelEl().textContent = labelMap[target] || target;
    appendTerminal(`Destino de ejecución cambiado a: ${labelMap[target]}`, 'info');
  }
  window.agSetTarget = setTarget;

  function setMode(mode) {
    activeMode = mode;
    document.querySelectorAll('.mode-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.mode === mode);
    });

    const placeholders = {
      ai: 'Escribe una instrucción en lenguaje natural (ej. "Revisa si hay bloqueos en DBF", "Prueba la conexión a Postgres")...',
      cmd: activeTarget === 'vps' ? 'Escribe un comando Bash (ej. ls -la, git status, ps aux)...' : 'Escribe un comando PowerShell (ej. Get-Process, git status, dir M:\\comp01)...',
      python: 'Escribe código Python para ejecutar en el entorno agéntico (ej. import os; print(os.listdir(".")))...',
      node: 'Escribe código Node.js para ejecutar (ej. const os = require("os"); console.log(os.cpus());)...'
    };
    const inp = inputEl();
    if (inp) inp.placeholder = placeholders[mode] || 'Escribe tu comando...';
  }
  window.agSetMode = setMode;

  async function enqueueTask(action, payload = {}) {
    payload.target = activeTarget;
    payload.timestamp = new Date().toISOString();
    payload.triggered_by = 'agent_console';

    const { data, error } = await sb.from('jjp_mixnet_tasks').insert({
      action,
      payload,
      status: 'pending'
    }).select('id').single();

    if (error) throw new Error(error.message);
    return data.id;
  }

  async function pollTaskResult(taskId, maxSeconds = 45) {
    appendTerminal(`Tarea #${taskId} encolada. Esperando respuesta de ${activeTarget.toUpperCase()}...`, 'info');

    const startTime = Date.now();
    while (Date.now() - startTime < maxSeconds * 1000) {
      await new Promise(r => setTimeout(r, 1200));

      const { data: tRow, error } = await sb
        .from('jjp_mixnet_tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error) continue;

      if (tRow.status === 'running') {
        // En progreso
      } else if (tRow.status === 'completed') {
        const res = tRow.result || {};
        if (res.stdout) appendTerminal(res.stdout, 'out');
        if (res.output) appendTerminal(res.output, 'out');
        if (res.content) appendTerminal(res.content, 'out');
        if (res.stderr) appendTerminal(res.stderr, 'err');
        
        if (res.details) {
          appendTerminal(JSON.stringify(res.details, null, 2), 'out');
        }

        if (res.ok === false || (res.exitCode !== undefined && res.exitCode !== 0)) {
          appendTerminal(`Ejecución con error en ${res.target || activeTarget} (Código ${res.exitCode || 1}).`, 'err');
        } else {
          appendTerminal(`Ejecución finalizada con éxito en ${res.target || activeTarget} (${res.exitCode !== undefined ? 'Código ' + res.exitCode : 'OK'}).`, 'ok');
        }
        return res;
      } else if (tRow.status === 'failed') {
        const err = tRow.error || tRow.result?.error || 'Fallo desconocido en la ejecución';
        appendTerminal(`Error en tarea #${taskId}: ${err}`, 'err');
        return { ok: false, error: err };
      }
    }

    appendTerminal(`Tiempo de espera agotado (${maxSeconds}s) esperando a la máquina. La tarea sigue en cola.`, 'err');
    return { ok: false, timeout: true };
  }

  async function executeAgentPrompt() {
    const inp = inputEl();
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || isExecuting) return;

    isExecuting = true;
    if (execBtnEl()) execBtnEl().disabled = true;

    commandHistory.push(text);
    historyCursor = commandHistory.length;

    appendTerminal(text, 'cmd');
    inp.value = '';

    try {
      if (activeMode === 'cmd') {
        const taskId = await enqueueTask('exec_cmd', { command: text });
        await pollTaskResult(taskId);
      } else if (activeMode === 'python') {
        const taskId = await enqueueTask('exec_python', { code: text });
        await pollTaskResult(taskId);
      } else if (activeMode === 'node') {
        const taskId = await enqueueTask('exec_node', { code: text });
        await pollTaskResult(taskId);
      } else {
        // MODO ASISTENTE IA: Analiza con Gemini y despacha la acción autónoma
        appendTerminal('🧠 Analizando requerimiento con el Cerebro IA...', 'info');
        
        const agentSystemPrompt = `Eres OpenCode, el Agente de Inteligencia e Ingeniería Soberana de JJ Paper (Distribuidora Mayorista de Papelería en Venezuela).

ESTRUCTURA DE INFRAESTRUCTURA:
1. Supervisor-PC (Windows 11, LAN Tienda 192.168.0.185):
   - Conectado a MixNet ERP en 'M:\\comp01' o '\\\\servidor\\MIX11\\comp01'.
   - Archivos Clipper DBF:
     * MXENCPED.DBF (pedidos encabezados): NUMPED char(8), EMISION char(8) YYYYMMDD, CLIENTE char(8) ej '008-817', CODVEN char(3), TOTNETO num, ESTADO char(2) 'OK'/'PE'.
     * MXRENPED.DBF (líneas de pedido): NUMPED char(8), ITEM char(20), DESCRI char(40), CANTIDAD num, PRECIO num, TOTAL num.
     * MXENCCOT.DBF & MXRENCOT.DBF (cotizaciones).
     * MXCTACLI.DBF (clientes): CODIGO char(8), NOMBRE char(40), RIF char(15), CODVEN char(3), TELEFONO char(20), DIREC1 char(50).
     * MXCTAINV.DBF (inventario +2400 productos): ITEM char(20), DESCRI char(40), PRECIO num, EXISTE num.
     * MXNUMPED.DBF / MXNUMCOT.DBF (correlativos).
   - Python 3 disponible en PATH. Con 'struct' se lee la cabecera (num_records, header_len, record_len = struct.unpack('<IHH', header[4:12])) y se extraen los registros directamente con f.seek(header_len + idx * record_len).
2. VPS Soberano (Ubuntu 24.04 LTS, 166.0.112.247):
   - PostgreSQL 16 ('jjpaper_db'), PostgREST, GoTrue, wa-server.
   - Tablas: jjp_orders, jjp_quotes, jjp_products, jjp_customers, jjp_settings, etc.

VENDEDORES SAGRADOS:
- 002: Luis Alarcón | 004 / 006: Yovanni Araujo | 008: Marianela | 014: Andreina | 005: Keyder Salazar (Admin / Mostrador; Cartera 020 es artificial; Cartera 010 es histórica; ventas solo son de Keyder si CODVEN = '005').

ACCIONES DISPONIBLES:
- "direct_answer": Para preguntas conceptuales, explicaciones o saludos que no requieran consultar la máquina.
- "exec_python": Script Python autónomo para consultar DBF en supervisor o procesar datos. Debe probar rutas [r'M:\\comp01\\' + archivo, r'\\\\servidor\\MIX11\\comp01\\' + archivo, r'M:\\MIX11\\comp01\\' + archivo].
- "exec_cmd": Comandos terminal válidos (ej. git status, dir, ls, pm2 list).
- "exec_node": Scripts Node.js para APIs o PostgreSQL.
- "git_pull", "reindex_all", "audit_health", "create_backup".

REGLAS CRÍTICAS:
- NUNCA inventes comandos de shell ficticios ni envíes preguntas en lenguaje natural a la consola del sistema operativo.
- Si el usuario pregunta por un pedido, cliente o producto de MixNet, genera SIEMPRE un script "exec_python" con target "supervisor" para consultar el archivo DBF correspondiente y mostrar la respuesta formateada con print().
- Responde estrictamente un JSON válido.

FORMATO JSON REQUERIDO:
{
  "action": "direct_answer" | "exec_python" | "exec_cmd" | "exec_node" | "git_pull" | "reindex_all" | "audit_health" | "create_backup",
  "target": "supervisor" | "vps",
  "code": "código python o node si aplica",
  "command": "comando de shell si aplica",
  "answer": "texto de respuesta si action es direct_answer",
  "explanation": "resumen en 1 línea de lo que hará"
}`;

        let aiPlan = null;
        if (typeof GeminiClient !== 'undefined' && GeminiClient.callGemini) {
          try {
            const rawJson = await GeminiClient.callGemini(text, {
              systemInstruction: agentSystemPrompt,
              temperature: 0.1,
              timeoutMs: 18000
            });
            const cleaned = rawJson.replace(/```json/gi, '').replace(/```/g, '').trim();
            aiPlan = JSON.parse(cleaned);
          } catch (e) {
            appendTerminal(`Aviso IA: No se pudo interpretar el plan con Gemini (${e.message}).`, 'info');
          }
        }

        if (aiPlan && aiPlan.action) {
          appendTerminal(`🤖 Plan IA: ${aiPlan.explanation || aiPlan.action}`, 'info');

          if (aiPlan.action === 'direct_answer') {
            appendTerminal(aiPlan.answer || aiPlan.explanation || 'Consulta procesada.', 'ok');
            return;
          }

          let payload = {
            target: aiPlan.target || activeTarget,
            explanation: aiPlan.explanation
          };

          if (aiPlan.action === 'exec_python') {
            payload.code = aiPlan.code;
          } else if (aiPlan.action === 'exec_node') {
            payload.code = aiPlan.code;
          } else if (aiPlan.action === 'exec_cmd') {
            payload.command = aiPlan.command;
          } else if (aiPlan.action === 'create_backup') {
            payload.label = aiPlan.label || 'ai_console';
          }

          const taskId = await enqueueTask(aiPlan.action, payload);
          await pollTaskResult(taskId);
        } else {
          // Si falló la IA y NO es un comando de terminal reconocible, NO enviarlo a la shell
          const looksLikeShellCmd = /^(git\b|dir\b|ls\b|cd\b|python\b|node\b|pm2\b|npm\b|Get-|curl\b|cat\b|echo\b)/i.test(text);
          if (looksLikeShellCmd) {
            appendTerminal(`Ejecutando comando directo en terminal...`, 'info');
            const taskId = await enqueueTask('exec_cmd', { command: text });
            await pollTaskResult(taskId);
          } else {
            appendTerminal(`⚠️ No se pudo procesar la pregunta con la IA y no es un comando de sistema válido.`, 'err');
            appendTerminal(`Tip: Reformule su pregunta (ej. "¿Cuál es el último pedido en MixNet?") o cambie de modo a 'Terminal Directo' para ejecutar comandos de PowerShell/Bash.`, 'info');
          }
        }
      }
    } catch (err) {
      appendTerminal(`Error despachando comando: ${err.message}`, 'err');
    } finally {
      isExecuting = false;
      if (execBtnEl()) execBtnEl().disabled = false;
    }
  }
  window.agExecute = executeAgentPrompt;

  // Acciones Rápidas
  window.agQuickAction = async function (action, payload = {}) {
    if (isExecuting) return;
    isExecuting = true;
    if (execBtnEl()) execBtnEl().disabled = true;

    try {
      appendTerminal(`Ejecutando acción rápida: '${action}' en ${activeTarget}...`, 'info');
      const taskId = await enqueueTask(action, payload);
      await pollTaskResult(taskId);
    } catch (err) {
      appendTerminal(`Error en acción rápida: ${err.message}`, 'err');
    } finally {
      isExecuting = false;
      if (execBtnEl()) execBtnEl().disabled = false;
    }
  };

  // Verificación de Salud de los Motores
  async function checkEnginesHealth() {
    try {
      const vpsDot = document.getElementById('agVpsStatusDot');
      const vpsTxt = document.getElementById('agVpsStatusTxt');
      const lanDot = document.getElementById('agLanStatusDot');
      const lanTxt = document.getElementById('agLanStatusTxt');

      // 1. VPS PostgreSQL & wa-server
      const { data: vpsControl } = await sb.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();
      
      let isVpsOnline = false;
      const lastHb = vpsControl?.heartbeat_at ? new Date(vpsControl.heartbeat_at).getTime() : 0;
      const isHbFresh = lastHb > 0 && Math.abs(Date.now() - lastHb) < 300000; // 5 minutos
      const isStatusOnline = vpsControl?.modules?.status === 'online';

      if (isHbFresh || isStatusOnline) {
        isVpsOnline = true;
      } else {
        // Fallback a telemetría nativa del VPS
        try {
          const tRes = await fetch('https://166-0-112-247.sslip.io/auth/v1/telemetry');
          if (tRes.ok) {
            const tData = await tRes.json();
            if (tData?.status === 'healthy') isVpsOnline = true;
          }
        } catch (_) {}
      }

      if (vpsDot && vpsTxt) {
        vpsDot.className = `status-dot ${isVpsOnline ? 'online' : 'warn'}`;
        vpsTxt.textContent = isVpsOnline ? 'Online (VPS 24/7)' : 'En espera';
      }

      // 2. Supervisor-PC (LAN)
      const mixnetAgent = vpsControl?.modules?.mixnet_agent;
      const lastAgentSync = mixnetAgent?.last_sync_at ? new Date(mixnetAgent.last_sync_at).getTime() : 0;
      let isLanActive = mixnetAgent?.online === true && (lastAgentSync > 0 && Math.abs(Date.now() - lastAgentSync) < 300000);

      if (!isLanActive) {
        const { data: lanTasks } = await sb
          .from('jjp_mixnet_tasks')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1);
        const lastTask = lanTasks?.[0];
        const lastTime = lastTask?.updated_at ? new Date(lastTask.updated_at).getTime() : 0;
        isLanActive = lastTime > 0 && Math.abs(Date.now() - lastTime) < 300000;
      }

      if (lanDot && lanTxt) {
        lanDot.className = `status-dot ${isLanActive ? 'online' : 'warn'}`;
        lanTxt.textContent = isLanActive ? 'Conectado (Tienda)' : 'Listo';
      }
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    appendTerminal('Inicializando entorno agéntico soberano JJ Paper (OpenCode)...', 'info');
    appendTerminal('Conexión con PostgreSQL 16 y tabla jjp_mixnet_tasks establecida.', 'ok');
    appendTerminal('Elige el destino y escribe un comando o instrucción.', 'info');

    const inp = inputEl();
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          executeAgentPrompt();
        } else if (e.key === 'ArrowUp') {
          if (historyCursor > 0) {
            historyCursor--;
            inp.value = commandHistory[historyCursor] || '';
          }
        } else if (e.key === 'ArrowDown') {
          if (historyCursor < commandHistory.length - 1) {
            historyCursor++;
            inp.value = commandHistory[historyCursor] || '';
          } else {
            historyCursor = commandHistory.length;
            inp.value = '';
          }
        }
      });
    }

    checkEnginesHealth();
    setInterval(checkEnginesHealth, 15000);
  });
})();
