/* ======================================================
   JJ Paper — Correo del CRM (envío por Gmail SMTP vía wa-server)
   Insert jjp_emails 'pending' → el server lo despacha → estado por Realtime.
   ====================================================== */

let MAIL_ME = null;
let mailRows = [];

const MAIL_STATUS = {
  pending: '🕓 En cola', sending: '📤 Enviando…', sent: '✅ Enviado', failed: '⚠️ Falló'
};

let MAIL_IS_ADMIN = false;

async function mailInit(me) {
  MAIL_ME = me;
  MAIL_IS_ADMIN = me.role === 'admin';
  await mailCaptureGmailLink();       // ¿volvemos de vincular con Google?
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN') mailCaptureGmailLink(); });
  await mailLoadAccount();
  await mailLoad();
  const cb = document.getElementById('mailCompanyBtn');
  if (cb) cb.style.display = 'none';   // método empresa/SMTP retirado: ahora es OAuth por usuario

  // Vincular Gmail con Google (OAuth, permiso gmail.send) — sin contraseñas
  window.linkGmailStart = async function () {
    localStorage.setItem('jjp_link_gmail', '1');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
        redirectTo: location.href.split('#')[0],
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
    if (error) { localStorage.removeItem('jjp_link_gmail'); showToast('No se pudo abrir Google: ' + error.message, 'err'); }
  };
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

// Captura el permiso de Google al volver de "Vincular con Google"
async function mailCaptureGmailLink() {
  if (localStorage.getItem('jjp_link_gmail') !== '1') return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  localStorage.removeItem('jjp_link_gmail');
  const refresh = session.provider_refresh_token;
  const email = session.user?.email;
  if (!refresh || !email) {
    showToast('Google no devolvió el permiso de envío. Reintenta "Vincular con Google" y acepta el permiso.', 'warn', 6000);
    return;
  }
  const { error } = await sb.from('jjp_email_accounts').upsert({
    profile_id: MAIL_ME.id, email, provider: 'google',
    oauth_refresh: refresh, app_pass: null, enabled: true, verified: false, last_error: null
  }, { onConflict: 'profile_id' });
  if (error) { showToast('No se pudo guardar el vínculo: ' + error.message, 'err'); return; }
  showToast('Correo vinculado con Google ✅ (se verifica al prender el servidor)');
  await mailLoadAccount();
}

async function mailLoadAccount() {
  const { data } = await sb.from('jjp_email_accounts')
    .select('email,from_name,enabled,verified,last_error,app_pass,oauth_refresh')
    .eq('profile_id', MAIL_ME.id).maybeSingle();
  MAIL_ACCT = data || null;
  mailRenderAcctChip();
}

function mailAcctConfigured() { return !!(MAIL_ACCT?.email && (MAIL_ACCT?.oauth_refresh || MAIL_ACCT?.app_pass)); }
function mailCanSend() { return mailAcctConfigured(); }

function mailRenderAcctChip() {
  const chip = document.getElementById('mailAcctChip');
  if (!chip) return;
  if (!mailAcctConfigured()) { chip.textContent = '✉️ Vincular mi correo'; chip.className = 'wa-chip'; return; }
  if (MAIL_ACCT.verified) { chip.textContent = '✉️ ' + MAIL_ACCT.email + ' 🟢'; chip.className = 'wa-chip ok'; }
  else if (MAIL_ACCT.last_error) { chip.textContent = '✉️ ' + MAIL_ACCT.email + ' 🔴'; chip.className = 'wa-chip'; chip.title = MAIL_ACCT.last_error; }
  else { chip.textContent = '✉️ ' + MAIL_ACCT.email + ' 🕓'; chip.className = 'wa-chip'; chip.title = 'Se verifica al prender el servidor'; }
}

/* ---------- cuenta de EMPRESA (solo admin) ---------- */
let MAIL_COMPANY = null;
async function openMailCompany() {
  if (!MAIL_IS_ADMIN) return;
  const { data } = await sb.from('jjp_email_company').select('*').eq('id', 1).maybeSingle();
  MAIL_COMPANY = data || null;
  document.getElementById('coEmail').value = MAIL_COMPANY?.email || '';
  document.getElementById('coFromName').value = MAIL_COMPANY?.from_name || '';
  document.getElementById('coPass').value = '';
  document.getElementById('coPass').placeholder = (MAIL_COMPANY?.email && MAIL_COMPANY?.app_pass) ? '•••••••• (dejar vacío = no cambiar)' : 'contraseña de aplicación de Google';
  const st = document.getElementById('coState');
  if (st) st.innerHTML = MAIL_COMPANY?.verified ? '🟢 Verificada' : MAIL_COMPANY?.last_error ? ('🔴 ' + escapeHTML(MAIL_COMPANY.last_error)) : (MAIL_COMPANY?.app_pass ? '🕓 Verificando…' : '');
  document.getElementById('mailCompanyModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('mailCompanyModal'));
}
function closeMailCompany() { document.getElementById('mailCompanyModal')?.classList.remove('op'); }

async function mailSaveCompany() {
  const email = (document.getElementById('coEmail')?.value || '').trim();
  const fromName = (document.getElementById('coFromName')?.value || '').trim();
  const passIn = document.getElementById('coPass')?.value || '';
  if (!validEmail(email)) { showToast('Correo inválido', 'warn'); return; }
  const has = !!(MAIL_COMPANY?.app_pass);
  const row = { id: 1, email, from_name: fromName || null, enabled: true, verified: false, last_error: null };
  if (passIn) row.app_pass = passIn.replace(/\s+/g, '');
  else if (!has) { showToast('Pega la contraseña de aplicación', 'warn'); return; }
  const { error } = await sb.from('jjp_email_company').upsert(row, { onConflict: 'id' });
  if (error) { showToast('No se pudo guardar: ' + error.message, 'err'); return; }
  showToast('Correo de empresa guardado. Verificando… (necesita el servidor encendido)');
  closeMailCompany();
  setTimeout(mailLoadCompanyFlag, 4000);
}

function openMailAccount() {
  const m = document.getElementById('mailAcctModal');
  if (!m) return;
  const st = document.getElementById('acctState');
  if (st) st.innerHTML = mailAcctConfigured()
    ? `Vinculado: <strong>${escapeHTML(MAIL_ACCT.email)}</strong> ${MAIL_ACCT.verified ? '🟢 listo' : MAIL_ACCT.last_error ? ('🔴 ' + escapeHTML(MAIL_ACCT.last_error)) : '🕓 se verifica al prender el servidor'}`
    : 'Aún no vinculas tu correo. Toca <strong>Vincular con Google</strong>.';
  const fn = document.getElementById('acctFromName'); if (fn) fn.value = MAIL_ACCT?.from_name || '';
  const ae = document.getElementById('acctEmail'); if (ae) ae.value = MAIL_ACCT?.email || '';
  const ap = document.getElementById('acctPass'); if (ap) ap.value = '';
  m.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(m);
}
function closeMailAccount() { document.getElementById('mailAcctModal')?.classList.remove('op'); }

// Guardar solo el nombre visible (remitente)
async function mailSaveFromName() {
  const fromName = (document.getElementById('acctFromName')?.value || '').trim();
  if (!mailAcctConfigured()) { showToast('Primero vincula tu correo con Google', 'warn'); return; }
  const { error } = await sb.from('jjp_email_accounts').update({ from_name: fromName || null }).eq('profile_id', MAIL_ME.id);
  if (error) { showToast('No se pudo guardar: ' + error.message, 'err'); return; }
  if (MAIL_ACCT) MAIL_ACCT.from_name = fromName;
  showToast('Nombre visible guardado ✅');
}

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
      <div class="mail-subj">${escapeHTML(m.subject || '(sin asunto)')}${(m.attachments && m.attachments.length) ? ` <span style="font-size:11px;color:var(--gr,#888)">📎 ${m.attachments.length}</span>` : ''}</div>
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

/* ---------- redactar: estado, picker de clientes y adjuntos ---------- */
let mailCompose = { attachments: [], customerId: null };

function openMailCompose(prefill) {
  mailCompose = { attachments: [], customerId: prefill?.customerId || null };
  ['mailTo', 'mailSubject', 'mailBody'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (prefill?.to) document.getElementById('mailTo').value = prefill.to;
  if (prefill?.subject) document.getElementById('mailSubject').value = prefill.subject;
  mailRenderAttach();
  const res = document.getElementById('mailToResults'); if (res) res.classList.remove('op');
  document.getElementById('mailModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('mailModal'));
  document.getElementById('mailTo')?.focus();
}
function closeMailCompose() {
  document.getElementById('mailModal')?.classList.remove('op');
}

// Buscar clientes con correo para el campo "Para"
let _mailPickTimer = null;
function mailSearchClients() {
  clearTimeout(_mailPickTimer);
  mailCompose.customerId = null;   // al escribir, deja de ser un cliente elegido
  _mailPickTimer = setTimeout(async () => {
    const term = (document.getElementById('mailTo')?.value || '').trim();
    const box = document.getElementById('mailToResults');
    if (!box) return;
    if (term.length < 2 || term.includes('@')) { box.classList.remove('op'); box.innerHTML = ''; return; }
    let q = sb.from('jjp_customers').select('id,name,email,phone')
      .not('email', 'is', null).eq('email_opt_out', false)
      .or(`name.ilike.%${term}%,email.ilike.%${term}%`).limit(8);
    if (!MAIL_IS_ADMIN) q = q.eq('seller_id', MAIL_ME.id);
    const { data } = await q;
    if (!data?.length) { box.classList.remove('op'); box.innerHTML = ''; return; }
    box.innerHTML = data.map(c =>
      `<button type="button" class="mail-pick-item" onclick="mailPickClient('${c.id}','${escapeHTML(c.email)}','${escapeHTML((c.name||'').replace(/'/g,''))}')">
        <strong>${escapeHTML(c.name || '—')}</strong> · ${escapeHTML(c.email)}<br><small>${escapeHTML(waPrettyPhoneSafe(c.phone))}</small>
      </button>`).join('');
    box.classList.add('op');
  }, 250);
}
function waPrettyPhoneSafe(p) { return typeof waPrettyPhone === 'function' ? waPrettyPhone(p) : (p || ''); }

function mailPickClient(id, email, name) {
  document.getElementById('mailTo').value = email;
  mailCompose.customerId = id;
  const box = document.getElementById('mailToResults');
  if (box) { box.classList.remove('op'); box.innerHTML = ''; }
}

// Subir adjuntos al bucket privado y guardarlos en el estado
async function mailAttachFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) { showToast(`"${file.name}" supera 20 MB`, 'warn'); continue; }
    const path = `${MAIL_ME.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    showToast('Subiendo ' + file.name + '…');
    const { error } = await sb.storage.from('jjp-email-media')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) { showToast('No se pudo subir ' + file.name + ': ' + error.message, 'err'); continue; }
    mailCompose.attachments.push({ path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size });
  }
  mailRenderAttach();
}
function mailRemoveAttach(i) {
  const a = mailCompose.attachments[i];
  if (a?.path) sb.storage.from('jjp-email-media').remove([a.path]).catch(() => {});
  mailCompose.attachments.splice(i, 1);
  mailRenderAttach();
}
function mailRenderAttach() {
  const box = document.getElementById('mailAttachList');
  if (!box) return;
  box.innerHTML = mailCompose.attachments.map((a, i) =>
    `<span class="mail-chip">📎 ${escapeHTML(a.name)} <button type="button" onclick="mailRemoveAttach(${i})" title="Quitar">✕</button></span>`).join('');
}

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

async function mailSend() {
  const to = (document.getElementById('mailTo')?.value || '').trim();
  const subject = (document.getElementById('mailSubject')?.value || '').trim();
  const body = (document.getElementById('mailBody')?.value || '').trim();
  if (!validEmail(to)) { showToast('Correo destino inválido', 'warn'); return; }
  if (!body) { showToast('Escribe el mensaje', 'warn'); return; }
  if (!mailCanSend()) {
    if (MAIL_IS_ADMIN) { showToast('Configura el correo de la empresa (🏢) o el tuyo (⚙️ Mi correo)', 'warn'); openMailCompany(); }
    else { showToast('Aún no hay correo disponible. Pide a un admin que configure el correo de la empresa.', 'warn'); }
    return;
  }

  const { error } = await sb.from('jjp_emails').insert({
    owner_id: MAIL_ME.id, direction: 'out',
    to_addr: to, subject: subject || '(sin asunto)', body, status: 'pending',
    customer_id: mailCompose.customerId || null,
    attachments: mailCompose.attachments
  });
  if (error) { showToast('No se pudo encolar: ' + error.message, 'err'); return; }
  mailCompose = { attachments: [], customerId: null };
  closeMailCompose();
  ['mailTo', 'mailSubject', 'mailBody'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  showToast('Correo en cola 📤 (sale cuando el servidor esté encendido)');
}

async function mailRetry(id) {
  const m = mailRows.find(x => x.id === id);
  if (!m) return;
  const { error } = await sb.from('jjp_emails').insert({
    owner_id: MAIL_ME.id, direction: 'out',
    to_addr: m.to_addr, subject: m.subject, body: m.body, html: m.html, status: 'pending',
    customer_id: m.customer_id || null, attachments: m.attachments || []
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
