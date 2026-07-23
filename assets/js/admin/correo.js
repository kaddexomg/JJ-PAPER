/* ======================================================
   JJ Paper — Correo del CRM (envío por Gmail SMTP vía wa-server)
   Insert jjp_emails 'pending' → el server lo despacha → estado por Realtime.
   ====================================================== */

let MAIL_ME = null;
let mailRows = [];

const MAIL_STATUS = {
  pending: '🕓 En cola', sending: '📤 Enviando…', sent: '✅ Enviado', failed: '⚠️ Falló'
};

async function mailInit(me) {
  MAIL_ME = me;
  await mailLoad();
  sb.channel('mail-ui-' + MAIL_ME.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_emails' },
      () => mailLoadDebounced())
    .subscribe();
  // Estado del servidor (para avisar si el correo está apagado)
  if (typeof srvInit === 'function') srvInit();
}

let _mailTimer = null;
function mailLoadDebounced() { clearTimeout(_mailTimer); _mailTimer = setTimeout(mailLoad, 500); }

async function mailLoad() {
  const { data, error } = await sb.from('jjp_emails')
    .select('*').order('created_at', { ascending: false }).limit(100);
  if (error) { showToast('Error cargando correos: ' + error.message, 'err'); return; }
  mailRows = data || [];
  mailRender();
}

function mailRender() {
  const box = document.getElementById('mailList');
  if (!box) return;
  if (!mailRows.length) {
    box.innerHTML = '<div class="wa-empty">Sin correos todavía. Usa <strong>✉️ Nuevo correo</strong>.</div>';
    return;
  }
  box.innerHTML = mailRows.map(m => `
    <div class="mail-item mail-${m.status}">
      <div class="mail-top">
        <span class="mail-to">${escapeHTML(m.to_addr || '—')}</span>
        <span class="mail-st">${MAIL_STATUS[m.status] || m.status}</span>
      </div>
      <div class="mail-subj">${escapeHTML(m.subject || '(sin asunto)')}</div>
      <div class="mail-body">${escapeHTML((m.body || '').slice(0, 160))}</div>
      ${m.error ? `<div class="mail-err">${escapeHTML(m.error)}</div>` : ''}
      <div class="mail-meta">
        ${mailTime(m.created_at)}
        ${m.status === 'failed' ? `<button class="wa-retry" onclick="mailRetry('${m.id}')">Reintentar</button>` : ''}
        <button class="wam-del" onclick="mailDelete('${m.id}')" title="Borrar del CRM" aria-label="Borrar">🗑️</button>
      </div>
    </div>`).join('');
}

function mailTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function openMailCompose() {
  document.getElementById('mailModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('mailModal'));
  document.getElementById('mailTo')?.focus();
}
function closeMailCompose() {
  document.getElementById('mailModal')?.classList.remove('op');
}

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

async function mailSend() {
  const to = (document.getElementById('mailTo')?.value || '').trim();
  const subject = (document.getElementById('mailSubject')?.value || '').trim();
  const body = (document.getElementById('mailBody')?.value || '').trim();
  if (!validEmail(to)) { showToast('Correo destino inválido', 'warn'); return; }
  if (!body) { showToast('Escribe el mensaje', 'warn'); return; }

  const { error } = await sb.from('jjp_emails').insert({
    owner_id: MAIL_ME.id, direction: 'out',
    to_addr: to, subject: subject || '(sin asunto)', body, status: 'pending'
  });
  if (error) { showToast('No se pudo encolar: ' + error.message, 'err'); return; }
  closeMailCompose();
  ['mailTo', 'mailSubject', 'mailBody'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  showToast('Correo en cola 📤 (sale cuando el servidor esté encendido)');
}

async function mailRetry(id) {
  const m = mailRows.find(x => x.id === id);
  if (!m) return;
  const { error } = await sb.from('jjp_emails').insert({
    owner_id: MAIL_ME.id, direction: 'out',
    to_addr: m.to_addr, subject: m.subject, body: m.body, html: m.html, status: 'pending'
  });
  if (error) showToast('No se pudo reintentar: ' + error.message, 'err');
  else showToast('Reintentando…');
}

async function mailDelete(id) {
  if (!confirm('¿Borrar este correo del CRM?')) return;
  const { error } = await sb.from('jjp_emails').delete().eq('id', id);
  if (error) { showToast('No se pudo borrar: ' + error.message, 'err'); return; }
  mailRows = mailRows.filter(x => x.id !== id);
  mailRender();
}
