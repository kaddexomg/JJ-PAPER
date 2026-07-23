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
  await mailLoadAccount();
  await mailLoad();
  sb.channel('mail-ui-' + MAIL_ME.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_emails' },
      () => mailLoadDebounced())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_email_accounts', filter: `profile_id=eq.${MAIL_ME.id}` },
      p => { MAIL_ACCT = p.new || null; mailRenderAcctChip(); })
    .subscribe();
  // Estado del servidor (para avisar si el correo está apagado)
  if (typeof srvInit === 'function') srvInit();
}

/* ---------- Mi correo (cuenta Gmail por usuario) ---------- */
let MAIL_ACCT = null;

async function mailLoadAccount() {
  const { data } = await sb.from('jjp_email_accounts')
    .select('email,from_name,enabled,verified,last_error,app_pass')
    .eq('profile_id', MAIL_ME.id).maybeSingle();
  MAIL_ACCT = data || null;
  mailRenderAcctChip();
}

function mailAcctConfigured() { return !!(MAIL_ACCT?.email && MAIL_ACCT?.app_pass); }

function mailRenderAcctChip() {
  const chip = document.getElementById('mailAcctChip');
  if (!chip) return;
  if (!mailAcctConfigured()) { chip.textContent = '⚙️ Configura tu correo'; chip.className = 'wa-chip'; return; }
  if (MAIL_ACCT.verified) { chip.textContent = '✉️ ' + MAIL_ACCT.email + ' 🟢'; chip.className = 'wa-chip ok'; }
  else if (MAIL_ACCT.last_error) { chip.textContent = '✉️ correo 🔴'; chip.className = 'wa-chip'; chip.title = MAIL_ACCT.last_error; }
  else { chip.textContent = '✉️ verificando… 🕓'; chip.className = 'wa-chip'; }
}

function openMailAccount() {
  const m = document.getElementById('mailAcctModal');
  if (!m) return;
  document.getElementById('acctEmail').value = MAIL_ACCT?.email || '';
  document.getElementById('acctFromName').value = MAIL_ACCT?.from_name || '';
  document.getElementById('acctPass').value = '';   // nunca precargar la contraseña
  document.getElementById('acctPass').placeholder = mailAcctConfigured() ? '•••••••• (dejar vacío = no cambiar)' : 'contraseña de aplicación de Google';
  const st = document.getElementById('acctState');
  if (st) st.innerHTML = mailAcctConfigured()
    ? (MAIL_ACCT.verified ? '🟢 Verificada' : MAIL_ACCT.last_error ? ('🔴 ' + escapeHTML(MAIL_ACCT.last_error)) : '🕓 Verificando…')
    : '';
  m.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(m);
}
function closeMailAccount() { document.getElementById('mailAcctModal')?.classList.remove('op'); }

async function mailSaveAccount() {
  const email = (document.getElementById('acctEmail')?.value || '').trim();
  const fromName = (document.getElementById('acctFromName')?.value || '').trim();
  const passIn = document.getElementById('acctPass')?.value || '';
  if (!validEmail(email)) { showToast('Correo inválido', 'warn'); return; }

  const row = { profile_id: MAIL_ME.id, email, from_name: fromName || null, enabled: true, verified: false, last_error: null };
  if (passIn) row.app_pass = passIn.replace(/\s+/g, '');   // Google muestra la app pass con espacios
  else if (!mailAcctConfigured()) { showToast('Pega tu contraseña de aplicación', 'warn'); return; }

  const { error } = await sb.from('jjp_email_accounts').upsert(row, { onConflict: 'profile_id' });
  if (error) { showToast('No se pudo guardar: ' + error.message, 'err'); return; }
  showToast('Correo guardado. Verificando con Google… (necesita el servidor encendido)');
  closeMailAccount();
  await mailLoadAccount();
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
  if (!mailAcctConfigured()) {
    showToast('Primero configura tu correo (⚙️ Mi correo)', 'warn');
    openMailAccount();
    return;
  }

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
