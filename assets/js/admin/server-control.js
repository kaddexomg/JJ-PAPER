/* ======================================================
   JJ Paper — Control del servidor (wa-server) desde el panel
   Lee jjp_server_control (heartbeat) y pide comandos restart/stop.
   OJO: prender desde apagado NO se puede por web — eso lo hace
   START-SERVIDOR.bat en la PC de la tienda (o el arranque de Windows).
   ====================================================== */

let _srvRow = null;
let _win7Row = null;
let _srvTimer = null;

// 🟢 si el último latido llegó hace < 180s (late cada 30s, tolerante a desfase horario)
function srvOnline(row) {
  const ts = row?.heartbeat_at || row?.heartbeat;
  if (!ts) return false;
  return Math.abs(Date.now() - new Date(ts).getTime()) < 180_000;
}

function srvAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor(Math.abs(Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

async function srvLoad() {
  const sbClient = typeof sbCore !== 'undefined' ? sbCore : sb;
  const [{ data: srvData }, { data: win7Data }] = await Promise.all([
    sb.from('jjp_server_control').select('id,status,heartbeat_at,host,modules,started_at,command').eq('id', 1).maybeSingle(),
    sbClient.from('jjp_settings').select('value').eq('key', 'win7_agent_status').maybeSingle().catch(() => ({ data: null }))
  ]);
  _srvRow = srvData;
  _win7Row = null;
  try {
    if (win7Data?.value) _win7Row = JSON.parse(win7Data.value);
  } catch (_) {}
  srvRenderChip();
  srvRenderModal();
}

function srvRenderChip() {
  const chip = document.getElementById('srvChip');
  if (!chip) return;
  const onLaptop = srvOnline(_srvRow);
  const onWin7 = _win7Row?.heartbeat_at && Math.abs(Date.now() - new Date(_win7Row.heartbeat_at).getTime()) < 180_000;
  const on = onLaptop || onWin7;
  chip.textContent = on ? '🖥️ Servidor 🟢' : '🖥️ Servidor 🔴';
  chip.className = 'wa-chip' + (on ? ' ok' : '');
  chip.title = on
    ? `Servidor Activo (${[onLaptop ? 'Laptop Central' : null, onWin7 ? 'Win7 Tienda' : null].filter(Boolean).join(' + ')})`
    : 'El servidor está apagado o sin conexión';
}

function srvRenderModal() {
  const box = document.getElementById('srvBody');
  if (!box) return;
  const onLaptop = srvOnline(_srvRow);
  const onWin7 = _win7Row?.heartbeat_at && Math.abs(Date.now() - new Date(_win7Row.heartbeat_at).getTime()) < 180_000;
  const on = onLaptop || onWin7;
  const mods = _srvRow?.modules || {};
  const modLabel = { whatsapp: 'WhatsApp', email: 'Correo', rates: 'Tasas', invoices: 'Facturas', campaigns: 'Difusión', countLan: 'Conteo LAN', outbox: 'Cola de envío', mixer: 'Puente MixNet' };
  const mixerInfo = typeof mods.mixer === 'object' && mods.mixer !== null ? mods.mixer : null;
  const modChips = Object.keys(modLabel).map(k => {
    const isAct = k === 'mixer' ? (mods.mixer === true || mixerInfo?.online === true) : !!mods[k];
    return `<span class="srv-mod ${isAct ? 'on' : 'off'}">${isAct ? '✅' : '⛔'} ${modLabel[k]}</span>`;
  }).join('');

  const hbIso = _srvRow?.heartbeat_at || _srvRow?.heartbeat;
  box.innerHTML = `
    <!-- Nodo 1: Laptop Central -->
    <div class="srv-state ${onLaptop ? 'on' : 'off'}" style="margin-bottom:8px;">
      <div class="srv-dot"></div>
      <div>
        <div style="font-weight:700;font-size:12px;">💻 Nodo 1: Laptop Central (wa-server)</div>
        <small>${onLaptop ? '🟢 Activo · Latido ' + srvAgo(hbIso) : '⚪ Sin latidos recientes'}
        ${_srvRow?.host ? ' · ' + escapeHTML(_srvRow.host) : ''}
        ${mods?.lan_ip ? ' (' + escapeHTML(mods.lan_ip) + ')' : ''}</small>
        ${onLaptop && mods?.lan_url ? `
        <div style="margin-top:6px;font-size:12px;display:flex;gap:10px;">
          <a href="${mods.lan_url}/admin/monitor.html" target="_blank" style="color:#059669;font-weight:600;text-decoration:none;">📊 Abrir Monitor Local</a>
          <a href="${mods.lan_url}/lan/start" target="_blank" style="color:#0284c7;font-weight:600;text-decoration:none;">📱 QR Conteo Offline</a>
        </div>` : ''}
      </div>
    </div>

    <!-- Nodo 2: Windows 7 Tienda -->
    <div class="srv-state ${onWin7 ? 'on' : 'off'}" style="margin-bottom:8px;border-left-color:#0284c7;">
      <div class="srv-dot" style="${onWin7 ? 'background:#0284c7;' : ''}"></div>
      <div>
        <div style="font-weight:700;font-size:12px;">🤖 Nodo 2: Micro-Nodo Tienda (Windows 7 / MixNet)</div>
        <small>${onWin7 ? '🟢 Conectado · Latido ' + srvAgo(_win7Row.heartbeat_at) : '⚪ Desconectado'}
        ${_win7Row?.host ? ' · ' + escapeHTML(_win7Row.host) : ''}
        ${_win7Row?.lan_ip ? ' (' + escapeHTML(_win7Row.lan_ip) + ')' : ''}</small>
        ${_win7Row ? `
        <div style="font-size:11px;color:#64748b;margin-top:4px;">
          📁 C:\\pedidos: <b>${_win7Row.orders_count || 0}</b> pedidos · <b>${_win7Row.quotes_count || 0}</b> cotizaciones · MixNet: <b>${_win7Row.active_mixnet_dir || 'Detectado'}</b>
        </div>` : ''}
      </div>
    </div>

    ${onLaptop ? `<div class="srv-mods">${modChips}</div>` : ''}
    ${onLaptop && mixerInfo ? `
    <div style="margin: 8px 0; padding: 6px 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; font-size: 11px; color: #166534; line-height: 1.4;">
      <strong>📁 Puente MixNet Activo:</strong> <code>${escapeHTML(mixerInfo.primary_dir || 'C:/JJ-PAPER-MIXER')}</code><br>
      <span>📤 Pedidos exportados: <b>${mixerInfo.exported_orders_count || 0}</b> · Cotizaciones: <b>${mixerInfo.exported_quotes_count || 0}</b> · 📥 Importados: <b>${mixerInfo.imported_count || 0}</b></span>
      ${mixerInfo.dbf_dir ? `<br><span>💾 Base de datos DBF conectada: <code>${escapeHTML(mixerInfo.dbf_dir)}</code></span>` : ''}
      <div style="margin-top:6px;display:flex;gap:8px;">
        <button type="button" style="background:#15803d;color:#fff;border:none;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;" onclick="srvSyncMixnetNow()">🔄 Sincronizar Existencias y Precios Ahora</button>
      </div>
    </div>` : ''}
    ${CURRENT_PROFILE?.role === 'admin' ? `<div class="srv-actions">
      <button class="btn-p" onclick="srvCommand('restart')" ${onLaptop ? '' : 'disabled'}>🔄 Reiniciar Laptop</button>
      <button class="btn-o srv-stop" onclick="srvCommand('stop')" ${onLaptop ? '' : 'disabled'}>⏹️ Detener Laptop</button>
    </div>` : ''}
    <div class="srv-help">
      ${on
        ? 'Arquitectura Dual JJ Paper: El sistema opera con la Laptop Central (servicios WhatsApp/Correo) y el Micro-Nodo Windows 7 en la tienda física (MixNet ERP + C:\\pedidos).'
        : '⚠️ Ambos nodos están desconectados. Para iniciar en la tienda: ejecuta <code>INICIAR-PANEL-TIENDA.bat</code> en la PC Windows 7 o <code>wa-server/START-SERVIDOR.bat</code> en la laptop.'}
    </div>`;
}

async function srvSyncMixnetNow() {
  if (!srvOnline(_srvRow)) { showToast('El servidor de la PC debe estar encendido para sincronizar con MixNet', 'warn'); return; }
  const { error } = await sb.from('jjp_server_control')
    .update({ command: 'sync_mixnet', command_at: new Date().toISOString(), command_by: CURRENT_PROFILE?.id || null })
    .eq('id', 1);
  if (error) { showToast('Error enviando sincronización: ' + error.message, 'err'); return; }
  showToast('Iniciando sincronización de catálogo y precios MixNet...', 'ok');
}

async function srvCommand(cmd) {
  if (!srvOnline(_srvRow)) { showToast('El servidor está apagado; prende con START-SERVIDOR.bat en la PC', 'warn'); return; }
  const txt = cmd === 'stop' ? 'DETENER el servidor' : 'REINICIAR el servidor';
  if (!confirm(`¿${txt}?\n\n${cmd === 'stop' ? 'Se apaga hasta que alguien lo prenda en la PC de la tienda.' : 'Se corta y vuelve solo en unos segundos.'}`)) return;
  const { error } = await sb.from('jjp_server_control')
    .update({ command: cmd, command_at: new Date().toISOString(), command_by: CURRENT_PROFILE?.id || null })
    .eq('id', 1);
  if (error) { showToast('No se pudo enviar el comando: ' + error.message, 'err'); return; }
  showToast(cmd === 'stop' ? 'Deteniendo servidor…' : 'Reiniciando servidor…');
}

function openSrvModal() {
  // waOpenModal (whatsapp.html) libera la trampa de foco al cerrar; en las demás
  // páginas del admin no existe y se usa el camino directo.
  if (typeof waOpenModal === 'function') waOpenModal('srvModal');
  else {
    document.getElementById('srvModal')?.classList.add('op');
    if (typeof trapFocus === 'function') trapFocus(document.getElementById('srvModal'));
  }
  srvLoad();
}
function closeSrvModal() {
  if (typeof waCloseModal === 'function') waCloseModal('srvModal');
  else document.getElementById('srvModal')?.classList.remove('op');
}

function srvInit() {
  srvLoad();
  // Refresco del chip cada 2 min (el "hace Xs" y el 🟢/🔴 se recalculan; los cambios reales vienen por Realtime)
  _srvTimer = setInterval(srvLoad, 300_000);
  // Cambios en vivo (arranque, comandos, módulos)
  sb.channel('srv-ui')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_server_control', filter: 'id=eq.1' },
      p => { _srvRow = p.new; srvRenderChip(); srvRenderModal(); })
    .subscribe();
}

