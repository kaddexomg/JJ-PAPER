/* ======================================================
   JJ Paper — Control del servidor (wa-server) desde el panel
   Lee jjp_server_control (heartbeat) y pide comandos restart/stop.
   OJO: prender desde apagado NO se puede por web — eso lo hace
   START-SERVIDOR.bat en la PC de la tienda (o el arranque de Windows).
   ====================================================== */

let _srvRow = null;
let _srvTimer = null;

// 🟢 si el último latido llegó hace < 70s (late cada 20s)
function srvOnline(row) {
  if (!row?.heartbeat_at) return false;
  return (Date.now() - new Date(row.heartbeat_at).getTime()) < 70_000;
}

function srvAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

async function srvLoad() {
  const { data } = await sb.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();
  _srvRow = data;
  srvRenderChip();
  srvRenderModal();
}

function srvRenderChip() {
  const chip = document.getElementById('srvChip');
  if (!chip) return;
  const on = srvOnline(_srvRow);
  chip.textContent = on ? '🖥️ Servidor 🟢' : '🖥️ Servidor 🔴';
  chip.className = 'wa-chip' + (on ? ' ok' : '');
  chip.title = on ? 'El servidor está corriendo' : 'El servidor está apagado o sin conexión';
}

function srvRenderModal() {
  const box = document.getElementById('srvBody');
  if (!box) return;
  const on = srvOnline(_srvRow);
  const mods = _srvRow?.modules || {};
  const modLabel = { whatsapp: 'WhatsApp', email: 'Correo', rates: 'Tasas', invoices: 'Facturas', campaigns: 'Difusión', countLan: 'Conteo LAN', outbox: 'Cola de envío' };
  const modChips = Object.keys(modLabel).map(k =>
    `<span class="srv-mod ${mods[k] ? 'on' : 'off'}">${mods[k] ? '✅' : '⛔'} ${modLabel[k]}</span>`).join('');

  box.innerHTML = `
    <div class="srv-state ${on ? 'on' : 'off'}">
      <div class="srv-dot"></div>
      <div>
        <strong>${on ? 'Servidor ENCENDIDO' : 'Servidor APAGADO'}</strong><br>
        <small>${on ? 'Último latido ' + srvAgo(_srvRow?.heartbeat_at) : 'Sin latidos recientes'}
        ${_srvRow?.host ? ' · PC: ' + escapeHTML(_srvRow.host) : ''}</small>
      </div>
    </div>
    ${on ? `<div class="srv-mods">${modChips}</div>` : ''}
    ${CURRENT_PROFILE?.role === 'admin' ? `<div class="srv-actions">
      <button class="btn-p" onclick="srvCommand('restart')" ${on ? '' : 'disabled'}>🔄 Reiniciar</button>
      <button class="btn-o srv-stop" onclick="srvCommand('stop')" ${on ? '' : 'disabled'}>⏹️ Detener</button>
    </div>` : ''}
    <div class="srv-help">
      ${on
        ? 'Reiniciar = vuelve a levantar el puente solo (útil si un chat se traba). Detener = lo apaga; para prenderlo de nuevo hay que ir a la PC de la tienda.'
        : '⚠️ Para <strong>PRENDER</strong> el servidor no basta con la web: en la PC de la tienda haz doble clic en <code>wa-server/START-SERVIDOR.bat</code> (o déjalo en arranque automático de Windows). Mientras esté apagado, los mensajes escritos quedan en cola y salen al reconectar.'}
    </div>`;
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
  // Refresco del chip cada 20s (el "hace Xs" y el 🟢/🔴 se recalculan)
  _srvTimer = setInterval(srvLoad, 20_000);
  // Cambios en vivo (arranque, comandos, módulos)
  sb.channel('srv-ui')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_server_control', filter: 'id=eq.1' },
      p => { _srvRow = p.new; srvRenderChip(); srvRenderModal(); })
    .subscribe();
}
