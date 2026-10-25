/* ======================================================
   JJ Paper — Control del servidor (wa-server) desde el panel
   Lee jjp_server_control (heartbeat) y pide comandos restart/stop.
   OJO: prender desde apagado NO se puede por web — eso lo hace
   START-SERVIDOR.bat en la PC de la tienda (o el arranque de Windows).
   ====================================================== */

let _srvRow = null;
let _win7Row = null;
let _srvTimer = null;

// 🟢 si el último latido llegó hace < 180s (late cada 30s; tolera latencia VPS/Supabase)
function srvOnline(row) {
  if (row?.status === 'stopped') return false;
  const ts = row?.heartbeat_at || row?.heartbeat;
  if (!ts) return false;
  return (Date.now() - new Date(ts).getTime()) < 180_000;
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
  let { data, error } = await sb.from('jjp_server_control').select('id,status,heartbeat_at,host,modules,started_at,command').eq('id', 1).maybeSingle();
  if (error) {
    const res = await sb.from('jjp_server_control').select('id,heartbeat_at,modules,updated_at').eq('id', 1).maybeSingle();
    if (res.data) {
      data = {
        ...res.data,
        status: res.data.modules?.status || (res.data.heartbeat_at && (Date.now() - new Date(res.data.heartbeat_at).getTime()) < 180000 ? 'online' : 'offline'),
        host: res.data.modules?.host || 'JJ-SERVER',
        started_at: res.data.modules?.started_at || null,
        command: res.data.modules?.command || null
      };
      error = null;
    }
  }
  if (error || !data) return;
  _srvRow = data;
  srvRenderChip();
  srvRenderModal();
}

function srvRenderChip() {
  const chip = document.getElementById('srvChip');
  if (!chip) return;
  const onVps = srvOnline(_srvRow);
  const onWin7 = Boolean(_win7Row && (_win7Row.status === 'online' || (_win7Row.heartbeat_at && Math.abs(Date.now() - new Date(_win7Row.heartbeat_at).getTime()) < 300_000)));
  const on = onVps || onWin7;
  chip.textContent = on ? '🖥️ Servidor 🟢' : '🖥️ Servidor 🔴';
  chip.className = 'wa-chip' + (on ? ' ok' : '');
  chip.title = on
    ? `Servidor Activo (${[onVps ? 'VPS Truobox' : null, onWin7 ? 'Win7 Tienda' : null].filter(Boolean).join(' + ')})`
    : 'El servidor está apagado o sin conexión';
}

function srvRenderModal() {
  const box = document.getElementById('srvBody');
  if (!box) return;
  const onVps = srvOnline(_srvRow);
  const onWin7 = Boolean(_win7Row && (_win7Row.status === 'online' || (_win7Row.heartbeat_at && Math.abs(Date.now() - new Date(_win7Row.heartbeat_at).getTime()) < 300_000)));
  const on = onVps || onWin7;
  const mods = _srvRow?.modules || {};
  const modLabel = { whatsapp: 'WhatsApp', email: 'Correo', rates: 'Tasas', invoices: 'Facturas', campaigns: 'Difusión', countLan: 'Conteo LAN', outbox: 'Cola de envío', mixer: 'Puente MixNet' };
  const mixerInfo = typeof mods.mixer === 'object' && mods.mixer !== null ? mods.mixer : null;
  const modChips = Object.keys(modLabel).map(k => {
    const isAct = k === 'mixer' ? (mods.mixer === true || mixerInfo?.online === true) : !!mods[k];
    return `<span class="srv-mod ${isAct ? 'on' : 'off'}">${isAct ? '✅' : '⛔'} ${modLabel[k]}</span>`;
  }).join('');

  const hbIso = _srvRow?.heartbeat_at || _srvRow?.heartbeat;
  box.innerHTML = `
    <!-- Nodo 1: Servidor VPS Cloud -->
    <div class="srv-state ${onVps ? 'on' : 'off'}" style="margin-bottom:8px;">
      <div class="srv-dot"></div>
      <div>
        <div style="font-weight:700;font-size:12px;">☁️ Nodo 1: Servidor VPS Central (Truobox · wa-server 24/7)</div>
        <small>${onVps ? '🟢 Activo · Latido ' + srvAgo(hbIso) : '⚪ Sin latidos recientes'}
        ${_srvRow?.host ? ' · ' + escapeHTML(_srvRow.host) : ''}
        ${mods?.lan_ip ? ' (' + escapeHTML(mods.lan_ip) + ')' : ''}</small>
        ${onVps ? `
        <div style="margin-top:6px;font-size:12px;display:flex;gap:10px;">
          <a href="/admin/monitor.html" style="color:#059669;font-weight:600;text-decoration:none;">📊 Abrir Monitor Cuotas & VPS</a>
          <a href="/admin/whatsapp.html" style="color:#0284c7;font-weight:600;text-decoration:none;">💬 CRM WhatsApp</a>
        </div>` : ''}
      </div>
    </div>
    ${on ? `<div class="srv-mods">${modChips}</div>` : ''}
    ${(mixerInfo || mods.lan_bridge) ? `
    <div style="margin: 8px 0; padding: 10px 12px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; font-size: 11.5px; color: #166534; line-height: 1.45;">
      <div style="font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
        <span>📁 Puente LAN MixNet ERP: <b style="color:#059669">${mods.lan_bridge?.online ? '🟢 EN LÍNEA' : '🟡 CONECTADO'}</b></span>
        ${mods.lan_bridge?.current_cot_serial ? `<span style="font-family: monospace; background:#dcfce7; padding: 1px 6px; border-radius: 4px;">Cotiz: #${mods.lan_bridge.current_cot_serial}</span>` : ''}
      </div>
      <div style="margin-top: 4px;">
        <span>💾 <b>Carpetas DBF Activas:</b> <code>${escapeHTML(mods.lan_bridge?.active_dirs?.join(' | ') || mixerInfo?.dbf_dir || 'M:/comp01')}</code></span><br>
        <span>📤 <b>Sincronizados:</b> Cotizaciones: <b>${mods.lan_bridge?.exported_count || mixerInfo?.exported_quotes_count || 0}</b> · Pedidos: <b>${mods.lan_bridge?.exported_count || mixerInfo?.exported_orders_count || 0}</b></span>
        ${mods.lan_bridge?.last_exported_quote ? `<br><span>⚡ <b>Última cotización inyectada:</b> <code style="font-weight:700">${escapeHTML(mods.lan_bridge.last_exported_quote)}</code></span>` : ''}
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" style="background:#15803d;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;" onclick="srvSyncMixnetNow()">🔄 Sincronizar Existencias, Precios y Cotizaciones Ahora</button>
        <a href="mixnet.html" style="background:#0284c7;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:4px">📊 Panel MixNet & Agente IA</a>
      </div>
    </div>` : ''}
    ${CURRENT_PROFILE?.role === 'admin' ? `<div class="srv-actions">
      <button class="btn-p" onclick="srvCommand('restart')" ${on ? '' : 'disabled'}>🔄 Reiniciar Servidor</button>
      <button class="btn-o srv-stop" onclick="srvCommand('stop')" ${on ? '' : 'disabled'}>⏹️ Detener</button>
    </div>` : ''}
    <div class="srv-help">
      ${on
        ? 'El servidor y el puente LAN se sincronizan de forma continua cada 25 segundos respetando los correlativos y las carpetas de red de MixNet.'
        : '⚠️ Para <strong>PRENDER</strong> el puente MixNet en esta PC, haz doble clic en <code>INICIAR-PUENTE-MIXNET.bat</code> en el Escritorio. Queda configurado para arrancar solo a las 8:00 AM.'}
    </div>`;
}

async function srvSyncMixnetNow() {
  showToast('Iniciando sincronización forzada de MixNet...', 'info');
  // 1. Intentar trigger directo al demonio local en puerto 8790
  try {
    fetch('http://127.0.0.1:8790/sync-now', { mode: 'no-cors' }).catch(() => {});
  } catch (_) {}

  // 2. Orden vía Supabase jjp_server_control
  const { error } = await sb.from('jjp_server_control')
    .update({ command: 'sync_mixnet', command_at: new Date().toISOString(), command_by: CURRENT_PROFILE?.id || null })
    .eq('id', 1);
  if (error) { showToast('Aviso: ' + error.message, 'warn'); return; }
  showToast('✅ Sincronización lanzada con éxito hacia MixNet', 'ok');
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

