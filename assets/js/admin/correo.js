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
    // Se re-consulta en vez de usar el payload: así el navegador nunca recibe
    // columnas de credenciales, ni siquiera por websocket.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_email_accounts', filter: `profile_id=eq.${MAIL_ME.id}` },
      () => mailLoadAccount())
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
    // has_cred = la base dice SI hay credencial, sin entregarla al navegador
    .select('email,from_name,enabled,verified,last_error,has_cred')
    .eq('profile_id', MAIL_ME.id).maybeSingle();
  MAIL_ACCT = data || null;
  mailRenderAcctChip();
}

function mailAcctConfigured() { return !!(MAIL_ACCT?.email && MAIL_ACCT?.has_cred); }
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
  const { data } = await sb.from('jjp_email_company')
    .select('id,email,from_name,enabled,verified,last_error,has_cred').eq('id', 1).maybeSingle();
  MAIL_COMPANY = data || null;
  document.getElementById('coEmail').value = MAIL_COMPANY?.email || '';
  document.getElementById('coFromName').value = MAIL_COMPANY?.from_name || '';
  document.getElementById('coPass').value = '';
  document.getElementById('coPass').placeholder = (MAIL_COMPANY?.email && MAIL_COMPANY?.has_cred) ? '•••••••• (dejar vacío = no cambiar)' : 'contraseña de aplicación de Google';
  const st = document.getElementById('coState');
  if (st) st.innerHTML = MAIL_COMPANY?.verified ? '🟢 Verificada' : MAIL_COMPANY?.last_error ? ('🔴 ' + escapeHTML(MAIL_COMPANY.last_error)) : (MAIL_COMPANY?.has_cred ? '🕓 Verificando…' : '');
  document.getElementById('mailCompanyModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('mailCompanyModal'));
}
function closeMailCompany() { document.getElementById('mailCompanyModal')?.classList.remove('op'); }

async function mailSaveCompany() {
  const email = (document.getElementById('coEmail')?.value || '').trim();
  const fromName = (document.getElementById('coFromName')?.value || '').trim();
  const passIn = document.getElementById('coPass')?.value || '';
  if (!validEmail(email)) { showToast('Correo inválido', 'warn'); return; }
  const has = !!(MAIL_COMPANY?.has_cred);
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
  // Si el lector está abierto y el server terminó de bajar adjuntos, refréscalos
  if (mailReadId && document.getElementById('mailReadModal')?.classList.contains('op')) {
    const m = mailRows.find(x => x.id === mailReadId);
    if (m) mailRenderAttachments(m);
  }
}

let mailFilter = 'all';   // 'all' | 'in' | 'out'
let mailExpanded = null;

function setMailFilter(f) {
  mailFilter = f;
  document.querySelectorAll('.mail-tab').forEach(b => b.classList.toggle('on', b.dataset.f === f));
  mailRender();
}

function mailUnreadCount() { return mailRows.filter(m => m.direction === 'in' && !m.is_read).length; }

function mailRenderTabs() {
  const n = mailUnreadCount();
  const badge = document.getElementById('mailInBadge');
  if (badge) { badge.textContent = n || ''; badge.style.display = n ? 'inline-block' : 'none'; }
}

function mailRender() {
  mailRenderTabs();
  const box = document.getElementById('mailList');
  if (!box) return;
  const rows = mailRows.filter(m => mailFilter === 'all' || m.direction === mailFilter);
  if (!rows.length) {
    box.innerHTML = '<div class="wa-empty">Sin correos en esta vista. Usa <strong>✉️ Nuevo correo</strong>.</div>';
    return;
  }
  box.innerHTML = rows.map(m => {
    const inbound = m.direction === 'in';
    const who = inbound ? (m.from_addr || '—') : (m.to_addr || '—');
    const unread = inbound && !m.is_read;
    const preview = escapeHTML((m.snippet || m.body || '').slice(0, 160));
    return `
    <div class="mail-item mail-${m.status}${unread ? ' mail-unread' : ''}" onclick="mailOpen('${m.id}')" style="cursor:pointer">
      <div class="mail-top">
        <span class="mail-to">${inbound ? '📥 ' : '📤 '}${escapeHTML(who)}</span>
        <span class="mail-st">${inbound ? (unread ? '🟢 Nuevo' : 'Recibido') : (MAIL_STATUS[m.status] || m.status)}</span>
      </div>
      <div class="mail-subj">${escapeHTML(m.subject || '(sin asunto)')}${(m.attachments && m.attachments.length) ? ` <span style="font-size:11px;color:var(--gr,#888)">📎 ${m.attachments.length}</span>` : ''}</div>
      <div class="mail-body">${preview}</div>
      ${m.error ? `<div class="mail-err">${escapeHTML(m.error)}</div>` : ''}
      <div class="mail-meta">
        ${mailTime(m.created_at)}
        <button class="wam-del" onclick="event.stopPropagation();mailDelete('${m.id}')" title="Borrar del CRM" aria-label="Borrar">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// Escapa y convierte URLs/correos en enlaces clicables (seguro, sin HTML crudo)
function mailLinkify(text) {
  let s = escapeHTML(text || '');
  s = s.replace(/\b(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, e => `<a href="mailto:${e}">${e}</a>`);
  return s;
}

let mailReadId = null;
async function mailOpen(id) {
  const m = mailRows.find(x => x.id === id);
  if (!m) return;
  mailReadId = id;
  const inbound = m.direction === 'in';
  if (inbound && !m.is_read) { m.is_read = true; sb.from('jjp_emails').update({ is_read: true }).eq('id', id).then(() => {}); }

  document.getElementById('mailReadSubject').textContent = m.subject || '(sin asunto)';
  document.getElementById('mailReadFrom').textContent = (inbound ? 'De: ' : 'Para: ') + (inbound ? (m.from_addr || '—') : (m.to_addr || '—'));
  document.getElementById('mailReadDate').textContent = new Date(m.created_at).toLocaleString('es-VE');

  mailRenderBody(m);
  mailRenderAttachments(m);

  document.getElementById('mailReadReply').style.display = inbound ? 'inline-flex' : 'none';
  const un = document.getElementById('mailReadUnread'); if (un) un.style.display = inbound ? 'inline-flex' : 'none';

  document.getElementById('mailReadModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('mailReadModal'));
  mailRender();   // refresca badge/negrita
}

// Cuerpo del correo: HTML del remitente en un marco AISLADO (sandbox SIN scripts,
// SIN acceso al mismo origen) → no puede ejecutar código ni leer nuestros datos.
function mailRenderBody(m) {
  const box = document.getElementById('mailReadBody');
  if (!box) return;
  if (m.html) {
    box.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    frame.style.cssText = 'width:100%;border:0;min-height:320px;background:#fff;border-radius:8px';
    box.appendChild(frame);
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank">
      <div style="font:14px/1.55 system-ui,Segoe UI,Arial;color:#111;padding:8px;word-break:break-word">${m.html}</div>`;
    frame.onload = () => { try { frame.style.height = Math.min((frame.contentWindow.document.body.scrollHeight || 320) + 28, 620) + 'px'; } catch (e) {} };
  } else {
    box.innerHTML = `<div class="mail-read-body">${mailLinkify(m.body || m.snippet || '(sin contenido)')}</div>`;
  }
}

// Adjuntos: entrantes se bajan on-demand (RPC → wa-server → Storage privado)
async function mailRenderAttachments(m) {
  const att = document.getElementById('mailReadAttach');
  if (!att) return;
  const list = m.attachments || [];
  if (!list.length) { att.innerHTML = ''; return; }

  if (m.attach_state === 'requested') { att.innerHTML = '<span class="mail-chip">📎 Descargando adjuntos…</span>'; return; }
  const needFetch = m.direction === 'in' && list.some(a => !a.path) && (m.attach_state === 'pending' || m.attach_state === 'error');
  if (needFetch) {
    att.innerHTML = `<button class="btn-o" onclick="mailFetchAttachments('${m.id}')">📎 Ver ${list.length} adjunto(s)</button>`;
    return;
  }
  const cards = await Promise.all(list.map(async a => {
    if (!a.path) return `<span class="mail-chip">📎 ${escapeHTML(a.name)}${a.error ? ' (error)' : ''}</span>`;
    const { data } = await sb.storage.from('jjp-email-media').createSignedUrl(a.path, 3600);
    const url = data?.signedUrl;
    if (!url) return `<span class="mail-chip">📎 ${escapeHTML(a.name)}</span>`;
    const prev = /^image\//.test(a.mime || '') ? `<img src="${url}" alt="" style="max-width:130px;max-height:130px;border-radius:8px;display:block;margin-bottom:4px">` : '';
    return `<a class="mail-att-card" href="${url}" target="_blank" rel="noopener">${prev}📎 ${escapeHTML(a.name)}</a>`;
  }));
  att.innerHTML = cards.join('');
}

async function mailFetchAttachments(id) {
  showToast('Trayendo adjuntos… (necesita el servidor encendido)');
  const { error } = await sb.rpc('jjp_email_request_attachments', { p_id: id });
  if (error) { showToast('No se pudo pedir: ' + error.message, 'err'); return; }
  const m = mailRows.find(x => x.id === id); if (m) m.attach_state = 'requested';
  mailRenderAttachments(m || { attach_state: 'requested' });
}

function closeMailRead() { document.getElementById('mailReadModal')?.classList.remove('op'); }

function mailReplyCurrent() {
  const m = mailRows.find(x => x.id === mailReadId);
  if (!m) return;
  closeMailRead();
  const from = /<([^>]+)>/.exec(m.from_addr || '');
  const to = from ? from[1] : (m.from_addr || '');
  const subj = /^re:/i.test(m.subject || '') ? m.subject : 'Re: ' + (m.subject || '');
  const quote = `\n\n-----\nEl ${new Date(m.created_at).toLocaleString('es-VE')}, ${m.from_addr || ''} escribió:\n${(m.body || m.snippet || '').split('\n').map(l => '> ' + l).join('\n')}`;
  openMailCompose({ to, subject: subj, customerId: m.customer_id, body: quote });
}

function mailForwardCurrent() {
  const m = mailRows.find(x => x.id === mailReadId);
  if (!m) return;
  closeMailRead();
  const subj = /^fwd:/i.test(m.subject || '') ? m.subject : 'Fwd: ' + (m.subject || '');
  const head = `\n\n----- Mensaje reenviado -----\nDe: ${m.from_addr || ''}\nFecha: ${new Date(m.created_at).toLocaleString('es-VE')}\nAsunto: ${m.subject || ''}\n\n`;
  openMailCompose({ subject: subj, body: head + (m.body || m.snippet || '') });
  // adjuntos ya descargados se reenvían
  mailCompose.attachments = (m.attachments || []).filter(a => a.path).map(a => ({ path: a.path, name: a.name, mime: a.mime, size: a.size }));
  mailRenderAttach();
}

async function mailMarkUnread() {
  const m = mailRows.find(x => x.id === mailReadId);
  if (!m) return;
  await sb.from('jjp_emails').update({ is_read: false }).eq('id', m.id);
  m.is_read = false;
  closeMailRead();
  mailRender();
}

function mailDeleteCurrent() {
  const id = mailReadId;
  closeMailRead();
  mailDelete(id);
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
  if (prefill?.body) document.getElementById('mailBody').value = prefill.body;
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
/* Adjuntar el catálogo o la lista de precios sin salir del compositor.
   El PDF se genera una vez al día y se reusa: en las PC de la tienda,
   rearmar 600 presentaciones en cada correo era demasiado. */
async function mailAdjuntarDoc(clase) {
  const etiqueta = clase === 'catalogo' ? 'catálogo' : 'lista de precios';
  showToast(`Preparando el ${etiqueta}…`);
  try {
    const f = await docArchivoDelDia(clase, 'jjp-email-media');
    if (mailCompose.attachments.some(a => a.path === f.path)) {
      showToast('Ese documento ya está adjunto', 'warn');
      return;
    }
    // shared: el archivo del día lo comparten todos los correos de hoy;
    // quitarlo del compositor NO debe borrarlo del Storage.
    mailCompose.attachments.push({
      path: f.path, name: f.filename, mime: 'application/pdf',
      size: f.blob?.size || null, shared: true,
    });
    mailRenderAttach();
    // Si el asunto está vacío, se rellena solo: un correo menos que escribir
    const subj = document.getElementById('mailSubject');
    if (subj && !subj.value.trim()) {
      subj.value = clase === 'catalogo' ? 'Catálogo JJ Paper' : 'Lista de precios — JJ Paper';
    }
    showToast(`📎 ${etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)} adjunto`, 'ok');
  } catch (e) {
    console.error('adjuntar documento:', e);
    showToast('No se pudo preparar el documento: ' + (e.message || e), 'err');
  }
}

function mailRemoveAttach(i) {
  const a = mailCompose.attachments[i];
  // Los compartidos (catálogo/lista del día) se quitan del correo pero
  // NO se borran: otros correos de hoy apuntan al mismo archivo.
  if (a?.path && !a.shared) sb.storage.from('jjp-email-media').remove([a.path]).catch(() => {});
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

/* ================= Campañas de correo ================= */
const ECAMP_KIND = { general: 'General', seguimiento: 'Seguimiento', captacion: 'Captación' };
const ECAMP_ST = { draft: '📝 Borrador', running: '📤 Enviando…', paused: '⏸️ Pausada', done: '✅ Completada', cancelled: '🚫 Cancelada' };

async function openCampaigns() {
  document.getElementById('ecampModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('ecampModal'));
  await ecampLoadTags();
  await ecampLoadList();
  await ecampLoadAutomations();
}

/* ---- Automatizaciones (solo admin) ---- */
async function ecampLoadAutomations() {
  const wrap = document.getElementById('ecampAuto');
  if (!wrap) return;
  if (!MAIL_IS_ADMIN) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const keys = ['email_auto_thanks', 'email_thanks_subject', 'email_thanks_body',
    'email_auto_reactivation', 'email_reactivation_days', 'email_reactivation_subject', 'email_reactivation_body'];
  const { data } = await sb.from('jjp_settings').select('key,value').in('key', keys);
  const m = {}; (data || []).forEach(r => m[r.key] = r.value);
  const set = (id, v, chk) => { const e = document.getElementById(id); if (!e) return; if (chk) e.checked = v === 'true'; else e.value = v || ''; };
  set('autoThanks', m.email_auto_thanks, true); set('thanksSubj', m.email_thanks_subject); set('thanksBody', m.email_thanks_body);
  set('autoReact', m.email_auto_reactivation, true); set('reactDays', m.email_reactivation_days); set('reactSubj', m.email_reactivation_subject); set('reactBody', m.email_reactivation_body);
}
async function ecampSaveAutomations() {
  const g = id => document.getElementById(id);
  const rows = [
    { key: 'email_auto_thanks', value: g('autoThanks').checked ? 'true' : 'false' },
    { key: 'email_thanks_subject', value: g('thanksSubj').value },
    { key: 'email_thanks_body', value: g('thanksBody').value },
    { key: 'email_auto_reactivation', value: g('autoReact').checked ? 'true' : 'false' },
    { key: 'email_reactivation_days', value: g('reactDays').value || '45' },
    { key: 'email_reactivation_subject', value: g('reactSubj').value },
    { key: 'email_reactivation_body', value: g('reactBody').value },
  ];
  const { error } = await sb.from('jjp_settings').upsert(rows, { onConflict: 'key' });
  if (error) { showToast('No se pudo guardar: ' + error.message, 'err'); return; }
  showToast('Automatizaciones guardadas ✅');
}
function closeCampaigns() { document.getElementById('ecampModal')?.classList.remove('op'); }

async function ecampLoadTags() {
  const sel = document.getElementById('ecampAudience');
  if (!sel || sel.dataset.filled) return;
  let q = sb.from('jjp_customers').select('tags').not('email', 'is', null);
  if (!MAIL_IS_ADMIN) q = q.eq('seller_id', MAIL_ME.id);
  const { data } = await q;
  const tags = new Set();
  (data || []).forEach(r => (r.tags || []).forEach(t => tags.add(t)));
  sel.innerHTML = `<option value="all">Todos mis clientes con correo</option>` +
    [...tags].map(t => `<option value="tag:${escapeHTML(t)}">Etiqueta: ${escapeHTML(t)}</option>`).join('');
  sel.dataset.filled = '1';
}

async function ecampAudienceRows() {
  const val = document.getElementById('ecampAudience')?.value || 'all';
  let q = sb.from('jjp_customers').select('id,name,email,tags')
    .not('email', 'is', null).eq('email_opt_out', false);
  if (!MAIL_IS_ADMIN) q = q.eq('seller_id', MAIL_ME.id);
  const { data } = await q;
  let rows = data || [];
  if (val.startsWith('tag:')) { const tag = val.slice(4); rows = rows.filter(c => (c.tags || []).includes(tag)); }
  return rows;
}

async function ecampPreview() {
  const rows = await ecampAudienceRows();
  const el = document.getElementById('ecampCount');
  if (el) el.textContent = `${rows.length} destinatario(s)`;
}

async function ecampCreate() {
  const name = (document.getElementById('ecampName')?.value || '').trim();
  const kind = document.getElementById('ecampKind')?.value || 'general';
  const subject = (document.getElementById('ecampSubject')?.value || '').trim();
  const body = (document.getElementById('ecampBody')?.value || '').trim();
  if (!name || !subject || !body) { showToast('Nombre, asunto y mensaje son obligatorios', 'warn'); return; }
  if (!mailAcctConfigured()) { showToast('Primero vincula tu correo (⚙️ Mi correo)', 'warn'); return; }
  const rows = await ecampAudienceRows();
  if (!rows.length) { showToast('No hay destinatarios con correo en esa audiencia', 'warn'); return; }
  if (!confirm(`Enviar "${name}" a ${rows.length} cliente(s)?\nSale poco a poco desde tu correo.`)) return;

  const { data: camp, error } = await sb.from('jjp_email_campaigns').insert({
    owner_id: MAIL_ME.id, name, kind, subject, body, status: 'draft', total: rows.length
  }).select('id').single();
  if (error) { showToast('No se pudo crear: ' + error.message, 'err'); return; }

  const targets = rows.map(c => ({
    campaign_id: camp.id, owner_id: MAIL_ME.id, customer_id: c.id,
    to_addr: c.email, name: c.name || '', vars: { nombre: (c.name || '').split(' ')[0] || 'cliente' }
  }));
  for (let i = 0; i < targets.length; i += 500) {
    const { error: te } = await sb.from('jjp_email_campaign_targets').insert(targets.slice(i, i + 500));
    if (te) { showToast('Error creando destinatarios: ' + te.message, 'err'); return; }
  }
  await sb.from('jjp_email_campaigns').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', camp.id);
  showToast(`Campaña "${name}" lanzada a ${rows.length} 📣 (necesita el servidor encendido)`);
  ['ecampName', 'ecampSubject', 'ecampBody'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  await ecampLoadList();
}

async function ecampLoadList() {
  const box = document.getElementById('ecampList');
  if (!box) return;
  let q = sb.from('jjp_email_campaigns').select('*').order('created_at', { ascending: false }).limit(30);
  const { data } = await q;
  if (!data?.length) { box.innerHTML = '<p class="wa-link-note">Sin campañas todavía.</p>'; return; }
  box.innerHTML = data.map(c => {
    const done = c.sent_count + c.failed_count;
    const pct = c.total ? Math.round(done / c.total * 100) : 0;
    return `<div class="ecamp-item">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <strong>${escapeHTML(c.name || '—')}</strong>
        <span style="font-size:12px">${ECAMP_ST[c.status] || c.status}</span>
      </div>
      <div style="font-size:12px;color:var(--gr,#888)">${ECAMP_KIND[c.kind] || c.kind} · ${escapeHTML(c.subject || '')}</div>
      <div style="background:#eee;border-radius:4px;height:6px;margin:6px 0"><div style="background:var(--gm,#16604A);height:6px;border-radius:4px;width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--gr,#888)">${c.sent_count}/${c.total} enviados${c.failed_count ? ` · ${c.failed_count} fallidos` : ''}
        ${(c.status === 'running' || c.status === 'paused') ? `<button class="wa-retry" style="margin-left:8px" onclick="ecampCancel('${c.id}')">Cancelar</button>` : ''}</div>
    </div>`;
  }).join('');
}

async function ecampCancel(id) {
  if (!confirm('¿Cancelar esta campaña? Los que faltan no se enviarán.')) return;
  const { error } = await sb.from('jjp_email_campaigns').update({ status: 'cancelled' }).eq('id', id);
  if (error) { showToast('No se pudo cancelar: ' + error.message, 'err'); return; }
  showToast('Campaña cancelada');
  await ecampLoadList();
}
