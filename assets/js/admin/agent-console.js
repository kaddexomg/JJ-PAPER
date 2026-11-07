/* ======================================================================
   JJ Paper — Consola Agéntica OpenCode v3 (Claude Code / Hermes Style)
   assets/js/admin/agent-console.js
   ----------------------------------------------------------------------
   Motor interactivo de doble carril:
   1. Supervisión del Sincronizador Continuo 24/7 (Incorruptible)
   2. Agente de Ingeniería de Código y Cirugía Autorizada (MixNet ⇄ JJ Paper)
   Incluye Paleta Flotante de Comandos Slash (/), Skills Diarios y Diffs.
   ====================================================================== */

(function () {
  let activeTarget = 'supervisor'; // 'supervisor' | 'vps' | 'all'
  let activeMode = 'ai'; // 'ai' | 'cmd' | 'python' | 'node'
  let commandHistory = [];
  let historyCursor = -1;
  let isExecuting = false;

  // Estado del menú desplegable Slash (/)
  let slashMenuOpen = false;
  let slashFiltered = [];
  let slashSelectedIndex = 0;

  const SLASH_COMMANDS = [
    {
      cmd: '/ventas-hoy',
      arg: '',
      cat: 'Skill Diario',
      desc: 'Resumen en vivo de pedidos y cotizaciones emitidas hoy en tienda por cada vendedor (CODVEN).'
    },
    {
      cmd: '/status',
      arg: '',
      cat: 'Sincronización',
      desc: 'Estado del puente 24/7, salud del ERP y correlativos actuales de Cotizaciones y Pedidos.'
    },
    {
      cmd: '/sync',
      arg: '',
      cat: 'Sincronización',
      desc: 'Fuerza un barrido inmediato de sincronización bidireccional (cotizaciones, pedidos y catálogo).'
    },
    {
      cmd: '/users',
      arg: '',
      cat: 'Operación',
      desc: 'Lista todos los vendedores, usuarios de caja y niveles de acceso en MixNet.'
    },
    {
      cmd: '/auditar-clientes',
      arg: '',
      cat: 'Skill Diario',
      desc: 'Detecta discrepancias o clientes nuevos en MXCTACLI.DBF pendientes de conciliar con la web.'
    },
    {
      cmd: '/conciliar-clientes',
      arg: '',
      cat: 'Skill Diario',
      desc: 'Sincroniza y concilia automáticamente las fichas de clientes entre MixNet y PostgreSQL.'
    },
    {
      cmd: '/inspeccionar-dbf',
      arg: '[TABLA o LIST]',
      cat: 'Ingeniería Código',
      desc: 'Radiografía completa de una tabla DBF (estructura binaria, columnas, bytes y últimos registros).'
    },
    {
      cmd: '/explorar-mixnet',
      arg: '[TÉRMINO]',
      cat: 'Ingeniería Código',
      desc: 'Busca funciones, variables o columnas dentro del código fuente (.PRG/.DBF) de MixNet y JJ Paper.'
    },
    {
      cmd: '/compatibilizar',
      arg: '[DBF] [TABLA_WEB]',
      cat: 'Ingeniería Código',
      desc: 'Compara el esquema de una tabla DBF de MixNet contra una tabla PostgreSQL de JJ Paper.'
    },
    {
      cmd: '/leer-archivo',
      arg: '[RUTA]',
      cat: 'Ingeniería Código',
      desc: 'Lee el código fuente de cualquier archivo de MixNet o del repositorio JJ Paper.'
    },
    {
      cmd: '/editar-datos',
      arg: '[INSTRUCCIÓN]',
      cat: 'Cirugía MixNet',
      desc: 'Ordena al agente modificar, corregir o eliminar registros específicos dentro de un DBF (con .BAK previo).'
    },
    {
      cmd: '/reindex',
      arg: '',
      cat: 'Seguridad ERP',
      desc: 'Reconstruye en caliente los 10 índices B-Tree (.NTX) de Clipper sin bloquear las 5 cajas.'
    },
    {
      cmd: '/backup',
      arg: '[ETIQUETA]',
      cat: 'Seguridad ERP',
      desc: 'Crea un snapshot sellado (.BAK) en comp01/backups/ antes de hacer cambios de código o datos.'
    },
    {
      cmd: '/snapshots',
      arg: '',
      cat: 'Seguridad ERP',
      desc: 'Lista todos los respaldos (.BAK) disponibles en comp01/backups/ con su fecha y tamaño.'
    },
    {
      cmd: '/rollback',
      arg: '[SNAPSHOT]',
      cat: 'Seguridad ERP',
      desc: 'Restaura inmediatamente las tablas DBF desde un snapshot (.BAK) previo.'
    },
    {
      cmd: '/logs',
      arg: '',
      cat: 'Diagnóstico',
      desc: 'Muestra en pantalla las últimas 60 líneas del log silencioso del agente en Supervisor-PC.'
    },
    {
      cmd: '/update-agent',
      arg: '',
      cat: 'Control Remoto',
      desc: 'Actualiza el código del agente en Supervisor-PC (git fetch/reset) y lo reinicia en modo silencioso.'
    },
    {
      cmd: '/clear',
      arg: '',
      cat: 'Consola',
      desc: 'Limpia toda la pantalla de la terminal.'
    }
  ];

  const terminalEl = () => document.getElementById('agTerminalOutput');
  const inputEl = () => document.getElementById('agCommandInput');
  const targetLabelEl = () => document.getElementById('agTargetLabel');
  const execBtnEl = () => document.getElementById('agExecBtn');
  const slashMenuEl = () => document.getElementById('agSlashMenu');

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
    else if (type === 'diff-add' || type === 'diff-del') prefix = '  ';
    else prefix += 'ℹ ';

    line.textContent = prefix + text;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
  }

  function appendDiffBlock(diffText) {
    if (!diffText) return;
    const lines = String(diffText).split('\n');
    appendTerminal('─── Diff de Código Aplicado ───', 'info');
    for (const l of lines) {
      if (l.startsWith('+')) appendTerminal(l, 'diff-add');
      else if (l.startsWith('-')) appendTerminal(l, 'diff-del');
      else appendTerminal(l, 'out');
    }
  }

  function clearTerminal() {
    const term = terminalEl();
    if (term) term.innerHTML = '';
    appendTerminal('Terminal reiniciada. Escribe "/" para desplegar la paleta de comandos y skills.', 'info');
  }
  window.agClearTerminal = clearTerminal;

  // ====================================================================
  // Paleta Desplegable de Comandos Slash (Estilo Claude Code)
  // ====================================================================
  function updateSlashMenu() {
    const inp = inputEl();
    const menu = slashMenuEl();
    if (!inp || !menu) return;

    const raw = inp.value;
    if (!raw.startsWith('/')) {
      closeSlashMenu();
      return;
    }

    // Si ya escribió un comando con espacio y argumentos, ocultar el menú para que escriba tranquilo
    const parts = raw.split(/\s+/);
    const typedCmd = parts[0].toLowerCase();
    const hasSpace = raw.includes(' ');

    if (hasSpace) {
      closeSlashMenu();
      return;
    }

    slashFiltered = SLASH_COMMANDS.filter(item =>
      item.cmd.toLowerCase().includes(typedCmd) ||
      item.desc.toLowerCase().includes(typedCmd.slice(1)) ||
      item.cat.toLowerCase().includes(typedCmd.slice(1))
    );

    if (slashFiltered.length === 0) {
      closeSlashMenu();
      return;
    }

    if (slashSelectedIndex >= slashFiltered.length) {
      slashSelectedIndex = 0;
    }

    slashMenuOpen = true;
    menu.classList.add('open');

    let html = `<div class="slash-palette-hd">
      <span>⚡ Comandos y Skills de OpenCode (${slashFiltered.length})</span>
      <span>↑↓ Navegar · Tab Completar · Enter Ejecutar</span>
    </div>`;

    slashFiltered.forEach((item, idx) => {
      const selClass = idx === slashSelectedIndex ? 'selected' : '';
      html += `
        <div class="slash-item ${selClass}" data-idx="${idx}">
          <div class="slash-item-left">
            <span class="slash-cmd-name">${item.cmd}</span>
            ${item.arg ? `<span class="slash-cmd-arg">${item.arg}</span>` : ''}
          </div>
          <div class="slash-cmd-desc">${item.desc}</div>
          <span class="slash-cmd-cat">${item.cat}</span>
        </div>
      `;
    });

    menu.innerHTML = html;

    menu.querySelectorAll('.slash-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        selectSlashItem(idx, true);
      });
    });

    const activeEl = menu.querySelector('.slash-item.selected');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  function closeSlashMenu() {
    slashMenuOpen = false;
    const menu = slashMenuEl();
    if (menu) menu.classList.remove('open');
  }

  function selectSlashItem(idx, executeIfNoArg = false) {
    const item = slashFiltered[idx];
    const inp = inputEl();
    if (!item || !inp) return;

    closeSlashMenu();
    if (item.arg) {
      inp.value = `${item.cmd} `;
      inp.focus();
    } else {
      inp.value = item.cmd;
      if (executeIfNoArg) {
        executeAgentPrompt();
      } else {
        inp.focus();
      }
    }
  }

  window.agRunSlash = function (cmdText) {
    const inp = inputEl();
    if (!inp) return;
    inp.value = cmdText;
    closeSlashMenu();
    executeAgentPrompt();
  };

  function setTarget(target) {
    activeTarget = target;
    document.querySelectorAll('.target-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.target === target);
    });

    const labelMap = {
      supervisor: 'Supervisor-PC (Windows LAN · M:\\comp01 · Invisible)',
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
      ai: 'Escribe "/" para ver comandos y skills, o pide cualquier cambio de código/datos en MixNet y JJ Paper...',
      cmd: activeTarget === 'vps' ? 'Escribe un comando Bash (ej. ls -la, git status, pm2 list)...' : 'Escribe un comando PowerShell (ej. Get-Process, git status, dir M:\\comp01)...',
      python: 'Escribe código Python para ejecutar en el entorno agéntico...',
      node: 'Escribe código Node.js para ejecutar...'
    };
    const inp = inputEl();
    if (inp) inp.placeholder = placeholders[mode] || 'Escribe tu comando...';
  }
  window.agSetMode = setMode;

  async function enqueueTask(action, payload = {}) {
    payload.target = payload.target || activeTarget;
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

  function renderTaskOutput(res) {
    if (res.stdout) appendTerminal(res.stdout, 'out');
    if (res.output) appendTerminal(res.output, 'out');
    if (res.content) appendTerminal(res.content, 'out');
    if (res.diff) appendDiffBlock(res.diff);
    if (res.stderr) appendTerminal(res.stderr, 'err');

    // 1. Usuarios de MixNet
    if (res.users && Array.isArray(res.users)) {
      appendTerminal(`📋 Nómina y Seguridad MixNet (${res.users.length} usuarios encontrados):`, 'ok');
      appendTerminal(' CÓDIGO │ NOMBRE DEL USUARIO          │ ROL / CARGO', 'out');
      appendTerminal('────────┼─────────────────────────────┼─────────────────────────', 'out');
      for (const u of res.users) {
        const code = String(u.code || '').padEnd(6, ' ');
        const name = String(u.name || '').slice(0, 27).padEnd(27, ' ');
        const role = String(u.role || u.seller_type || '').slice(0, 25);
        appendTerminal(` ${code} │ ${name} │ ${role}`, 'out');
      }
    }

    // 2. Salud y Correlativos
    if (res.correlatives) {
      appendTerminal(`📊 Estado en Vivo de MixNet ERP:`, 'ok');
      appendTerminal(`  Cotizaciones: #${res.correlatives.cot} (Registros en MXENCCOT: ${res.tables?.quotes_records || '—'})`, 'out');
      appendTerminal(`  Pedidos:      #${res.correlatives.ped} (Registros en MXENCPED: ${res.tables?.orders_records || '—'})`, 'out');
      appendTerminal(`  Inventario:   ${res.tables?.catalog_records || '—'} artículos activos en MXCTAINV`, 'out');
    }

    // 3. Reporte de Ventas del Día (/ventas-hoy)
    if (res.salesReport) {
      const sr = res.salesReport;
      appendTerminal(`📈 Resumen Operativo de Tienda (Fecha: ${sr.date}):`, 'ok');
      appendTerminal(`  • Pedidos Emitidos:      ${sr.ordersCount} pedidos  ➔ Total: $${sr.ordersTotalUsd.toFixed(2)} USD`, 'out');
      appendTerminal(`  • Cotizaciones Emitidas: ${sr.quotesCount} cotiz.   ➔ Total: $${sr.quotesTotalUsd.toFixed(2)} USD`, 'out');
      const sellers = Object.entries(sr.bySeller || {});
      if (sellers.length > 0) {
        appendTerminal('  ─── Desglose por Vendedor (CODVEN) ───', 'info');
        for (const [sName, st] of sellers) {
          appendTerminal(`  👤 ${sName.padEnd(26, ' ')} │ Pedidos: ${String(st.ordersCount).padStart(2)} ($${st.ordersUsd.toFixed(2)}) │ Cotiz: ${String(st.quotesCount).padStart(2)} ($${st.quotesUsd.toFixed(2)})`, 'out');
        }
      }
      if (Array.isArray(sr.recentOrders) && sr.recentOrders.length > 0) {
        appendTerminal('  ─── Últimos Pedidos en MixNet ───', 'info');
        for (const o of sr.recentOrders.slice(0, 6)) {
          appendTerminal(`  #${o.num} │ ${String(o.client).slice(0, 28).padEnd(28, ' ')} │ $${o.total_usd.toFixed(2).padStart(8, ' ')} │ ${o.seller}`, 'out');
        }
      }
    }

    // 4. Lista de Tablas DBF (/inspeccionar-dbf LIST)
    if (res.dbfList && Array.isArray(res.dbfList)) {
      appendTerminal(`🗄️ Tablas DBF en comp01 (${res.dbfList.length} archivos):`, 'ok');
      appendTerminal(' ARCHIVO DBF      │ REGISTROS  │ COLUMNAS │ BYTES/REG', 'out');
      appendTerminal('──────────────────┼────────────┼──────────┼──────────', 'out');
      for (const t of res.dbfList) {
        appendTerminal(` ${String(t.table).padEnd(16, ' ')} │ ${String(t.records).padStart(10, ' ')} │ ${String(t.fieldsCount).padStart(8, ' ')} │ ${String(t.recordBytes).padStart(9, ' ')}`, 'out');
      }
    }

    // 5. Radiografía de una Tabla DBF (/inspeccionar-dbf TABLA)
    if (res.dbfInspect) {
      const info = res.dbfInspect;
      appendTerminal(`🔬 Radiografía de ${info.table} (${info.numRecords} registros, ${info.recordLen} bytes/reg):`, 'ok');
      appendTerminal(' CAMPO        │ TIPO │ LONG │ DEC │ OFFSET', 'out');
      appendTerminal('──────────────┼──────┼──────┼─────┼───────', 'out');
      for (const f of info.fields) {
        appendTerminal(` ${f.name.toUpperCase().padEnd(12, ' ')} │  ${f.type}   │ ${String(f.len).padStart(4, ' ')} │ ${String(f.dec).padStart(3, ' ')} │ +${f.pos}`, 'out');
      }
      if (Array.isArray(info.sampleRows) && info.sampleRows.length > 0) {
        appendTerminal(` ─── Últimos ${info.sampleRows.length} registros en ${info.table} ───`, 'info');
        for (const r of info.sampleRows) {
          appendTerminal('  ' + JSON.stringify(r), 'out');
        }
      }
    }

    // 6. Coincidencias de Código (/explorar-mixnet)
    if (res.codeMatches && Array.isArray(res.codeMatches)) {
      appendTerminal(`🔍 Explorador de Código ("${res.query}") — ${res.matchesCount} hallazgos:`, 'ok');
      for (const m of res.codeMatches) {
        appendTerminal(` 📄 ${m.file}${m.line ? ':' + m.line : ''} ➔ ${m.preview}`, 'out');
      }
    }

    // 7. Puente de Compatibilidad de Esquemas (/compatibilizar)
    if (res.schemaBridge) {
      const sbData = res.schemaBridge;
      appendTerminal(`🌉 Puente de Esquemas: MixNet [${sbData.dbfTable}] ⇄ Web PostgreSQL [${sbData.pgTable}]`, 'ok');
      appendTerminal(`  • Columnas MixNet (${sbData.dbfRecords} regs): ${sbData.dbfFields.join(', ')}`, 'out');
      appendTerminal(`  • Columnas JJ Paper Web: ${sbData.pgColumns.join(', ')}`, 'out');
    }

    // 8. Snapshots (.BAK)
    if (res.snapshots && Array.isArray(res.snapshots)) {
      appendTerminal(`💾 Respaldos (.BAK) en comp01/backups/ (${res.snapshots.length}):`, 'ok');
      for (const s of res.snapshots.slice(-15)) {
        appendTerminal(`  • ${s.file} (${(s.sizeBytes / 1024).toFixed(1)} KB) — ${s.modifiedAt}`, 'out');
      }
    }

    // 9. Resultado de Cirugía DBF
    if (res.updatedRecords !== undefined && res.table) {
      appendTerminal(`🛠️ Cirugía en ${res.table}: ${res.updatedRecords} registro(s) modificados (Respaldo previo: ${res.backupSnapshot}).`, 'ok');
    }

    if (res.details) {
      appendTerminal(JSON.stringify(res.details, null, 2), 'out');
    }
  }

  async function pollTaskResult(taskId, maxSeconds = 45) {
    appendTerminal(`Tarea #${taskId} enviada a ${(activeTarget || 'supervisor').toUpperCase()}. Ejecutando...`, 'info');

    const startTime = Date.now();
    while (Date.now() - startTime < maxSeconds * 1000) {
      await new Promise(r => setTimeout(r, 1100));

      const { data: tRow, error } = await sb
        .from('jjp_mixnet_tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      if (error) continue;

      if (tRow.status === 'completed') {
        const res = tRow.result || {};
        renderTaskOutput(res);

        if (res.ok === false || (res.exitCode !== undefined && res.exitCode !== 0)) {
          appendTerminal(`Ejecución con error en ${res.target || activeTarget} (Código ${res.exitCode || 1}).`, 'err');
        } else {
          appendTerminal(`Ejecución completada en ${res.target || activeTarget}.`, 'ok');
        }
        return res;
      } else if (tRow.status === 'failed') {
        const err = tRow.error || tRow.result?.error || 'Fallo en la ejecución';
        appendTerminal(`Error en tarea #${taskId}: ${err}`, 'err');
        return { ok: false, error: err };
      }
    }

    appendTerminal(`Tiempo de espera agotado (${maxSeconds}s). La tarea continúa procesándose.`, 'err');
    return { ok: false, timeout: true };
  }

  function robustParseJson(str) {
    if (!str) return null;
    let clean = str.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const startIdx = clean.indexOf('{');
    const endIdx = clean.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      clean = clean.substring(startIdx, endIdx + 1);
    }
    try {
      return JSON.parse(clean);
    } catch (_) {}

    try {
      let inString = false;
      let escaped = false;
      let sanitized = '';
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (c === '"' && !escaped) {
          inString = !inString;
          sanitized += c;
        } else if (inString && (c === '\n' || c === '\r')) {
          sanitized += c === '\n' ? '\\n' : '';
        } else {
          sanitized += c;
        }
        escaped = (c === '\\' && !escaped);
      }
      return JSON.parse(sanitized);
    } catch (err) {
      throw err;
    }
  }

  async function executeAgentPrompt() {
    const inp = inputEl();
    if (!inp) return;
    const text = inp.value.trim();
    if (!text || isExecuting) return;

    closeSlashMenu();
    isExecuting = true;
    if (execBtnEl()) execBtnEl().disabled = true;

    commandHistory.push(text);
    historyCursor = commandHistory.length;

    appendTerminal(text, 'cmd');
    inp.value = '';

    try {
      const parts = text.trim().split(/\s+/);
      const cmdHead = parts[0].toLowerCase();
      const cmdArgs = parts.slice(1).join(' ').trim();

      // ================================================================
      // 1. Ejecución Instantánea de Comandos Slash y Skills Diarios
      // ================================================================
      if (cmdHead === '/ventas-hoy') {
        const taskId = await enqueueTask('sales_today', { target: 'supervisor', date: cmdArgs || undefined });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/users' || cmdHead === '/usuarios') {
        const taskId = await enqueueTask('list_users', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/status' || cmdHead === '/estado' || cmdHead === '/health') {
        const taskId = await enqueueTask('audit_health', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/sync' || cmdHead === '/sincronizar' || cmdHead === '/sync-now') {
        const taskId = await enqueueTask('sync_all', { target: 'supervisor', force: true });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/auditar-clientes') {
        const taskId = await enqueueTask('clients_discrepancies', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/conciliar-clientes') {
        const taskId = await enqueueTask('reconcile_clients', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/inspeccionar-dbf') {
        const taskId = await enqueueTask('inspect_dbf', { target: 'supervisor', table: cmdArgs || 'LIST' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/explorar-mixnet') {
        const taskId = await enqueueTask('explore_mixnet', { target: 'supervisor', query: cmdArgs });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/compatibilizar') {
        const [dbf, pgTable] = cmdArgs.split(/\s+/);
        const taskId = await enqueueTask('schema_bridge', {
          target: 'supervisor',
          dbf: dbf || 'MXCTACLI',
          pgTable: pgTable || 'jjp_customers'
        });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/leer-archivo') {
        if (!cmdArgs) {
          appendTerminal('Uso: /leer-archivo [ruta] (ej. /leer-archivo jj-mixnet-agent/sync-documents.js)', 'err');
          return;
        }
        const taskId = await enqueueTask('read_file', { target: activeTarget, path: cmdArgs });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/reindex' || cmdHead === '/reindexar') {
        const taskId = await enqueueTask('reindex_all', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/backup') {
        const taskId = await enqueueTask('create_backup', { target: 'supervisor', label: cmdArgs || 'consola_manual' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/snapshots') {
        const taskId = await enqueueTask('list_snapshots', { target: 'supervisor' });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/rollback') {
        if (!cmdArgs) {
          appendTerminal('Especifica el nombre del snapshot o usa /snapshots primero para ver la lista.', 'err');
          return;
        }
        const taskId = await enqueueTask('rollback', { target: 'supervisor', snapshot: cmdArgs });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/logs') {
        const taskId = await enqueueTask('read_logs', { target: 'supervisor', lines: 60 });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/update-agent') {
        const taskId = await enqueueTask('git_pull', { target: 'supervisor', restart: true });
        await pollTaskResult(taskId);
        return;
      }
      if (cmdHead === '/clear') {
        clearTerminal();
        return;
      }
      if (cmdHead === '/help' || cmdHead === '/ayuda') {
        appendTerminal('Comandos y Skills disponibles (también puedes pulsar "/" para abrir el menú interactivo):', 'ok');
        for (const c of SLASH_COMMANDS) {
          appendTerminal(`  ${(c.cmd + ' ' + c.arg).padEnd(28, ' ')} — ${c.desc}`, 'out');
        }
        return;
      }

      // Si usó /editar-datos [instrucción], pasamos la instrucción al Agente de Código con permiso explícito de mutación
      const effectivePrompt = cmdHead === '/editar-datos'
        ? `[ORDEN AUTORIZADA DE CIRUGÍA DE DATOS EN MIXNET]: ${cmdArgs}`
        : text;

      if (activeMode === 'cmd') {
        const taskId = await enqueueTask('exec_cmd', { command: effectivePrompt });
        await pollTaskResult(taskId);
      } else if (activeMode === 'python') {
        const taskId = await enqueueTask('exec_python', { code: effectivePrompt });
        await pollTaskResult(taskId);
      } else if (activeMode === 'node') {
        const taskId = await enqueueTask('exec_node', { code: effectivePrompt });
        await pollTaskResult(taskId);
      } else {
        // ================================================================
        // 2. MODO AGENTE DE INGENIERÍA DE CÓDIGO (Claude Code / Hermes)
        // ================================================================
        appendTerminal('🧠 Analizando código y estructura con el Agente de Ingeniería...', 'info');

        const agentSystemPrompt = `Eres OpenCode (estilo Claude Code / Hermes), el Agente de Ingeniería de Código y Datos Soberano de JJ Paper.
Tu misión es doble:
1. Entender tanto el código de MixNet ERP (Clipper/Harbour .PRG, tablas .DBF, índices .NTX en '\\\\servidor\\MIX11\\comp01' o 'M:\\MIX11\\comp01') como el código de JJ Paper Web (JS, HTML, Node.js y PostgreSQL 16 en el VPS) y hacerlos compatibles.
2. Mientras el demonio de sincronización automática cuida que las cotizaciones y pedidos fluyan sin corromper nada, TÚ eres el Agente de Ingeniería: si el usuario te pide expresamente inspeccionar, modificar código fuente, parchar funciones o alterar/limpiar registros en las bases .DBF de MixNet, TIENES AUTORIZACIÓN TOTAL para hacerlo usando tus herramientas.

HERRAMIENTAS Y ACCIONES NATIVAS ("action"):
- "sales_today": Resumen de ventas (pedidos y cotizaciones) de hoy en MixNet desglosado por vendedor.
- "list_users": Consultar usuarios, vendedores y permisos de MixNet.
- "audit_health": Correlativos actuales (MXNUMCOT, MXNUMPED) y conteo de registros.
- "inspect_dbf": Inspeccionar estructura binaria, columnas y registros de una tabla DBF. Usa "table": "MXCTAINV" (o "LIST" para listar todas).
- "explore_mixnet": Buscar código fuente (.PRG, .CH, .JS) o columnas DBF. Usa "query": "término".
- "schema_bridge": Comparar tabla DBF de MixNet con tabla PostgreSQL de JJ Paper. Usa "dbf": "MXCTACLI", "pgTable": "jjp_customers".
- "read_file": Leer un archivo del proyecto o de MixNet. Usa "path": "ruta/al/archivo".
- "patch_file": Modificar código fuente con respaldo .bak y verificación de sintaxis automática. Usa "path": "...", "target": "bloque exacto actual", "replacement": "bloque nuevo".
- "mutate_dbf": Cirugía autorizada sobre registros de un archivo .DBF en MixNet (crea snapshot .BAK automático y reindexa .NTX). Usa "table": "MXENCCOT", "whereField": "numcot", "whereValue": "00053628", "updates": {"nomcli": "NUEVO NOMBRE"}, o "deleteRecord": true / "undeleteRecord": true.
- "exec_python": Script Python autónomo para consultas avanzadas o cruces de datos sobre los DBF en '\\\\servidor\\MIX11\\comp01' o 'M:\\MIX11\\comp01'.
- "exec_node": Script Node.js para consultar/modificar PostgreSQL o el puente.
- "exec_cmd": Comando PowerShell o Bash.
- "sync_all", "reindex_all", "create_backup", "read_logs", "direct_answer".

VENDEDORES OFICIALES (CODVEN):
002: Luis Alarcón | 004/006: Yovanni Araujo | 008: Marianela | 014: Andreina | 005: Keyder Salazar.

Responde ESTRICTAMENTE un objeto JSON válido:
{
  "action": "sales_today" | "list_users" | "audit_health" | "inspect_dbf" | "explore_mixnet" | "schema_bridge" | "read_file" | "patch_file" | "mutate_dbf" | "exec_python" | "exec_node" | "exec_cmd" | "sync_all" | "reindex_all" | "create_backup" | "read_logs" | "direct_answer",
  "target": "supervisor" | "vps",
  "table": "nombre tabla DBF si aplica",
  "query": "término de búsqueda si aplica",
  "dbf": "tabla DBF si aplica en schema_bridge",
  "pgTable": "tabla postgres si aplica en schema_bridge",
  "path": "ruta archivo si aplica en read_file o patch_file",
  "patchTarget": "texto original si aplica en patch_file",
  "patchReplacement": "texto nuevo si aplica en patch_file",
  "whereField": "campo filtro si aplica en mutate_dbf",
  "whereValue": "valor filtro si aplica en mutate_dbf",
  "updates": {},
  "deleteRecord": false,
  "code": "código python o node si aplica",
  "command": "comando shell si aplica",
  "answer": "respuesta detallada si action es direct_answer",
  "explanation": "resumen claro en 1 línea del paso técnico a ejecutar"
}`;

        let aiPlan = null;
        if (typeof GeminiClient !== 'undefined' && GeminiClient.callGemini) {
          try {
            const rawJson = await GeminiClient.callGemini(effectivePrompt, {
              systemInstruction: agentSystemPrompt,
              temperature: 0.1,
              timeoutMs: 18000
            });
            aiPlan = robustParseJson(rawJson);
          } catch (e) {
            appendTerminal(`Aviso IA: No se pudo interpretar el plan con Gemini (${e.message}).`, 'info');
          }
        }

        if (aiPlan && aiPlan.action) {
          appendTerminal(`🤖 Plan de Ingeniería: ${aiPlan.explanation || aiPlan.action}`, 'info');

          if (aiPlan.action === 'direct_answer') {
            appendTerminal(aiPlan.answer || aiPlan.explanation || 'Consulta procesada.', 'ok');
            return;
          }

          const payload = {
            target: aiPlan.target || activeTarget,
            explanation: aiPlan.explanation,
            table: aiPlan.table,
            query: aiPlan.query,
            dbf: aiPlan.dbf,
            pgTable: aiPlan.pgTable,
            path: aiPlan.path,
            target: aiPlan.patchTarget || aiPlan.target || activeTarget,
            replacement: aiPlan.patchReplacement,
            whereField: aiPlan.whereField,
            whereValue: aiPlan.whereValue,
            updates: aiPlan.updates,
            deleteRecord: aiPlan.deleteRecord,
            code: aiPlan.code,
            command: aiPlan.command,
            label: aiPlan.label || 'ai_console'
          };

          if (aiPlan.action === 'patch_file') {
            payload.target = aiPlan.patchTarget;
          }

          const taskId = await enqueueTask(aiPlan.action, payload);
          await pollTaskResult(taskId);
        } else {
          const looksLikeShellCmd = /^(git\b|dir\b|ls\b|cd\b|python\b|node\b|pm2\b|npm\b|Get-|curl\b|cat\b|echo\b)/i.test(effectivePrompt);
          if (looksLikeShellCmd) {
            appendTerminal(`Ejecutando comando directo en terminal...`, 'info');
            const taskId = await enqueueTask('exec_cmd', { command: effectivePrompt });
            await pollTaskResult(taskId);
          } else {
            appendTerminal(`⚠️ No se pudo procesar la instrucción con la IA en este intento.`, 'err');
            appendTerminal(`Tip: Escribe "/" para elegir un comando directo de la lista desplegable o intenta nuevamente.`, 'info');
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

  async function checkEnginesHealth() {
    try {
      const vpsDot = document.getElementById('agVpsStatusDot');
      const vpsTxt = document.getElementById('agVpsStatusTxt');
      const lanDot = document.getElementById('agLanStatusDot');
      const lanTxt = document.getElementById('agLanStatusTxt');

      const { data: vpsControl } = await sb.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();

      let isVpsOnline = false;
      const lastHb = vpsControl?.heartbeat_at ? new Date(vpsControl.heartbeat_at).getTime() : 0;
      const isHbFresh = lastHb > 0 && Math.abs(Date.now() - lastHb) < 300000;
      const isStatusOnline = vpsControl?.modules?.status === 'online';

      if (isHbFresh || isStatusOnline) {
        isVpsOnline = true;
      } else {
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
        lanTxt.textContent = isLanActive ? `Conectado (#${mixnetAgent?.current_ped_serial || 'Tienda'})` : 'Listo';
      }
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    appendTerminal('Inicializando OpenCode v3 (Sincronizador 24/7 + Agente de Ingeniería MixNet ⇄ JJ Paper)...', 'info');
    appendTerminal('Conexión establecida. Escribe "/" en la barra inferior para desplegar todos los comandos y skills.', 'ok');

    const inp = inputEl();
    if (inp) {
      inp.addEventListener('input', () => {
        updateSlashMenu();
      });

      inp.addEventListener('keydown', (e) => {
        if (slashMenuOpen && slashFiltered.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            slashSelectedIndex = (slashSelectedIndex + 1) % slashFiltered.length;
            updateSlashMenu();
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            slashSelectedIndex = (slashSelectedIndex - 1 + slashFiltered.length) % slashFiltered.length;
            updateSlashMenu();
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            selectSlashItem(slashSelectedIndex, false);
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const chosen = slashFiltered[slashSelectedIndex];
            if (chosen && inp.value.trim() !== chosen.cmd && !inp.value.includes(' ')) {
              selectSlashItem(slashSelectedIndex, !chosen.arg);
            } else {
              closeSlashMenu();
              executeAgentPrompt();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            closeSlashMenu();
            return;
          }
        }

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

      document.addEventListener('click', (e) => {
        const menu = slashMenuEl();
        if (slashMenuOpen && menu && !menu.contains(e.target) && e.target !== inp) {
          closeSlashMenu();
        }
      });
    }

    checkEnginesHealth();
    setInterval(checkEnginesHealth, 15000);
  });
})();
