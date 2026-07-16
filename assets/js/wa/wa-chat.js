/* ======================================================
   JJ Paper — CRM WhatsApp · bandeja + hilo + composer
   Flujo: insert 'pending' → wa-server envía → estados por Realtime.
   Admin puede VER chats de todo el equipo (solo lectura en ajenos).
   ====================================================== */

let WA_ME = null;          // perfil logueado (dueño de la sesión propia)
let WA_IS_ADMIN = false;
let waChats = [];          // bandeja
let waActive = null;       // chat abierto
let waMsgs = [];           // mensajes del chat abierto
let waHasOlder = false;
let waOwnerFilter = 'me';  // admin: 'me' | 'all' | <profile_id>
let waProfiles = [];       // admin: perfiles staff para filtros/sesiones

const WA_PAGE = 50;

/* ---------- init ---------- */
async function waInit(opts) {
  WA_ME = opts.me;
  WA_IS_ADMIN = WA_ME.role === 'admin';

  waRequestNotifPerm();
  await waLinkInit(WA_ME.id);
  if (WA_IS_ADMIN) await waLoadProfiles();
  await waLoadChats();
  waSubscribe();
  await waHandleParams();

  const ci = document.getElementById('waComposerInput');
  ci?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); waSendText(); }
  });
  // Mic ↔ Enviar según haya texto (como WhatsApp) + autosize del textarea
  ci?.addEventListener('input', () => {
    waComposerButtons();
    ci.style.height = 'auto';
    ci.style.height = Math.min(ci.scrollHeight, 110) + 'px';
  });
  waComposerButtons();
}

function waComposerButtons() {
  const hasText = !!(document.getElementById('waComposerInput')?.value || '').trim();
  const mic = document.getElementById('waMicBtn');
  const send = document.getElementById('waSendBtn');
  if (mic)  mic.style.display  = hasText || !waRecSupported() ? 'none' : 'inline-flex';
  if (send) send.style.display = hasText || !waRecSupported() ? 'inline-flex' : 'none';
}

function waSubscribe() {
  sb.channel('wa-ui-' + WA_ME.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_wa_messages' },
      p => waOnNewMessage(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_wa_messages' },
      p => waOnMessageUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_wa_chats' },
      () => waLoadChats())
    .subscribe();
}

/* ---------- bandeja ---------- */
async function waLoadChats() {
  let q = sb.from('jjp_wa_chats').select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (!WA_IS_ADMIN || waOwnerFilter === 'me') q = q.eq('owner_id', WA_ME.id);
  else if (waOwnerFilter !== 'all') q = q.eq('owner_id', waOwnerFilter);
  const { data, error } = await q;
  if (error) { showToast('Error cargando chats: ' + error.message, 'err'); return; }
  waChats = data || [];
  waRenderChatList();
}

function waRenderChatList() {
  const list = document.getElementById('waChatList');
  if (!list) return;
  const term = normTxt(document.getElementById('waSearch')?.value || '');
  const rows = waChats.filter(c =>
    !term || normTxt(c.display_name || '').includes(term) || (c.phone || '').includes(term));

  if (!rows.length) {
    list.innerHTML = '<div class="wa-empty">Sin chats todavía.<br>Usa <strong>＋ Nuevo chat</strong> o espera mensajes entrantes.</div>';
    return;
  }
  list.innerHTML = rows.map(c => {
    const mine = c.owner_id === WA_ME.id;
    const owner = !mine ? waProfiles.find(p => p.id === c.owner_id)?.name : null;
    return `
    <button class="wa-chat-item ${waActive?.id === c.id ? 'on' : ''}" onclick="waOpenChat('${c.id}')">
      <div class="wa-avatar">${escapeHTML((c.display_name || '?').charAt(0).toUpperCase())}</div>
      <div class="wa-chat-info">
        <div class="wa-chat-top">
          <span class="wa-chat-name">${escapeHTML(c.display_name || waPrettyPhone(c.phone))}</span>
          <span class="wa-chat-time">${waTime(c.last_message_at)}</span>
        </div>
        <div class="wa-chat-bottom">
          <span class="wa-chat-preview">${c.last_message_from === 'me' ? 'Tú: ' : ''}${escapeHTML(c.last_message_preview || '')}</span>
          ${c.unread_count ? `<span class="wa-unread">${c.unread_count}</span>` : ''}
        </div>
        ${owner ? `<div class="wa-chat-owner">👤 ${escapeHTML(owner)}</div>` : ''}
      </div>
    </button>`;
  }).join('');
}

/* ---------- hilo ---------- */
async function waOpenChat(chatId) {
  const chat = waChats.find(c => c.id === chatId);
  if (!chat) return;
  waActive = chat;
  waMsgs = [];
  waHasOlder = false;

  document.getElementById('waWrap')?.classList.add('thread-open');
  waRenderThreadHeader();
  waRenderChatList();
  await waLoadMessages();
  waMarkRead();
}

function waCloseThread() {
  waActive = null;
  document.getElementById('waWrap')?.classList.remove('thread-open');
  waRenderChatList();
}

function waRenderThreadHeader() {
  const hd = document.getElementById('waThreadHead');
  if (!hd || !waActive) return;
  const mine = waActive.owner_id === WA_ME.id;
  const owner = !mine ? waProfiles.find(p => p.id === waActive.owner_id)?.name : null;
  hd.innerHTML = `
    <button class="wa-back" onclick="waCloseThread()" aria-label="Volver a la lista">←</button>
    <div class="wa-avatar">${escapeHTML((waActive.display_name || '?').charAt(0).toUpperCase())}</div>
    <div class="wa-thread-title">
      <strong>${escapeHTML(waActive.display_name || waPrettyPhone(waActive.phone))}</strong>
      <small>${escapeHTML(waPrettyPhone(waActive.phone))}${owner ? ' · sesión de ' + escapeHTML(owner) : ''}</small>
    </div>
    ${!mine ? ''
      : waActive.customer_id
        ? `<a class="btn-o wa-cust-btn" href="${(WA_IS_ADMIN ? '../vendedor/' : '') + 'pos.html?tel=' + encodeURIComponent(waActive.phone)}" title="Nueva venta a este cliente">🛍️ Venta</a>`
        : `<button class="btn-o wa-cust-btn" onclick="waLinkCustomer()" title="Crear cliente en el CRM">＋ CRM</button>`}
    ${(mine || WA_IS_ADMIN)
      ? `<button class="btn-o wa-cust-btn wa-del-btn" onclick="waDeleteChat()" title="Borrar chat del CRM" aria-label="Borrar chat">🗑️</button>` : ''}
  `;
  const composer = document.getElementById('waComposer');
  if (composer) composer.style.display = mine ? 'flex' : 'none';
  const roNote = document.getElementById('waReadonlyNote');
  if (roNote) roNote.style.display = mine ? 'none' : 'block';
}

async function waLoadMessages(older) {
  if (!waActive) return;
  let q = sb.from('jjp_wa_messages').select('*')
    .eq('chat_id', waActive.id)
    .order('created_at', { ascending: false })
    .limit(WA_PAGE);
  if (older && waMsgs.length) q = q.lt('created_at', waMsgs[0].created_at);
  const { data, error } = await q;
  if (error) { showToast('Error cargando mensajes', 'err'); return; }
  const batch = (data || []).reverse();
  waHasOlder = (data || []).length === WA_PAGE;
  waMsgs = older ? batch.concat(waMsgs) : batch;
  waRenderThread(older ? 'keep' : 'bottom');
}

function waMsgBubble(m) {
  const out = m.direction === 'out';
  let inner = '';
  if (m.type !== 'text' && m.media_path) {
    inner += `<div class="wa-media" data-path="${escapeHTML(m.media_path)}" data-type="${m.type}"
                   data-mime="${escapeHTML(m.media_mime || '')}" data-name="${escapeHTML(m.media_filename || '')}">
                ${WA_TYPE_ICON[m.type] || '📄'} Cargando ${WA_TYPE_LABEL[m.type] || 'archivo'}…
              </div>`;
  } else if (m.type !== 'text') {
    inner += `<div class="wa-media-miss">${WA_TYPE_ICON[m.type] || ''} ${WA_TYPE_LABEL[m.type] || ''}</div>`;
  }
  if (m.body) inner += `<div class="wa-body">${escapeHTML(m.body)}</div>`;
  const tick = out ? `<span class="wa-tick ${m.status}">${WA_STATUS_TICK[m.status] || ''}</span>` : '';
  const failed = m.status === 'failed'
    ? `<div class="wa-failed">No se envió${m.error ? ': ' + escapeHTML(m.error) : ''} <button class="wa-retry" onclick="waRetry('${m.id}')">Reintentar</button></div>` : '';
  return `
    <div class="wam ${out ? 'out' : 'in'}" id="wam-${m.id}">
      <div class="wam-bubble">${inner}
        <span class="wam-meta">${waTime(m.wa_timestamp || m.created_at)} ${tick}</span>
      </div>${failed}
    </div>`;
}

function waRenderThread(scroll) {
  const box = document.getElementById('waThread');
  if (!box) return;
  const prevH = box.scrollHeight;

  let html = waHasOlder
    ? '<div class="wa-load-more"><button class="btn-o" onclick="waLoadMessages(true)">↑ Cargar anteriores</button></div>' : '';
  let lastDay = '';
  for (const m of waMsgs) {
    const day = new Date(m.wa_timestamp || m.created_at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      html += `<div class="wa-day">${waDayLabel(m.wa_timestamp || m.created_at)}</div>`;
    }
    html += waMsgBubble(m);
  }
  if (!waMsgs.length) html += '<div class="wa-empty">Sin mensajes aún. ¡Escribe el primero!</div>';
  box.innerHTML = html;

  if (scroll === 'bottom') box.scrollTop = box.scrollHeight;
  else if (scroll === 'keep') box.scrollTop = box.scrollHeight - prevH;

  waHydrateMedia(box);
}

// Reemplaza placeholders de media por el contenido real (URL firmada)
async function waHydrateMedia(root) {
  for (const el of root.querySelectorAll('.wa-media[data-path]')) {
    const path = el.dataset.path, type = el.dataset.type;
    const url = await waSignedUrl(path);
    if (!url) { el.textContent = '⚠️ No se pudo cargar el archivo'; continue; }
    if (type === 'image' || type === 'sticker') {
      el.innerHTML = `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Imagen recibida" loading="lazy"></a>`;
    } else if (type === 'video') {
      el.innerHTML = `<video src="${url}" controls preload="metadata"></video>`;
    } else if (type === 'audio') {
      el.innerHTML = `<audio src="${url}" controls preload="metadata"></audio>`;
    } else {
      const name = el.dataset.name || 'documento';
      el.innerHTML = `<a class="wa-doc" href="${url}" target="_blank" rel="noopener">📄 ${escapeHTML(name)}</a>`;
    }
    el.removeAttribute('data-path');
  }
}

/* ---------- notificaciones de escritorio ---------- */
function waRequestNotifPerm() {
  if ('Notification' in window && Notification.permission === 'default') {
    // Se pide al primer clic del usuario (los navegadores exigen gesto)
    document.addEventListener('click', function once() {
      document.removeEventListener('click', once);
      Notification.requestPermission().catch(() => {});
    }, { once: true });
  }
}

let _waAudioCtx = null;
function waBeep() {
  try {
    _waAudioCtx = _waAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _waAudioCtx.createOscillator(), g = _waAudioCtx.createGain();
    o.type = 'sine'; o.frequency.value = 660; g.gain.value = 0.04;
    o.connect(g); g.connect(_waAudioCtx.destination);
    o.start(); o.stop(_waAudioCtx.currentTime + 0.12);
  } catch (e) {}
}

function waMaybeNotify(m) {
  const active = waActive && m.chat_id === waActive.id;
  if (active && !document.hidden) return;            // ya lo estás viendo
  waBeep();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const chat = waChats.find(c => c.id === m.chat_id);
  const who = chat?.display_name || (chat ? waPrettyPhone(chat.phone) : 'Cliente');
  const preview = m.body || WA_TYPE_LABEL[m.type] || 'Nuevo mensaje';
  try {
    const n = new Notification('WhatsApp · ' + who, {
      body: preview, tag: 'wa-' + m.chat_id, renotify: true, icon: '/assets/img/logo.svg'
    });
    n.onclick = () => { window.focus(); waOpenChat(m.chat_id); n.close(); };
  } catch (e) {}
}

/* ---------- eventos Realtime ---------- */
function waOnNewMessage(m) {
  if (m.direction === 'in') waMaybeNotify(m);
  if (waActive && m.chat_id === waActive.id) {
    if (waMsgs.some(x => x.id === m.id)) return;   // eco del optimista
    // Sustituir burbuja optimista (id temporal) si coincide
    const optIdx = waMsgs.findIndex(x => x._optimistic && x.body === m.body && x.type === m.type);
    if (optIdx >= 0) waMsgs.splice(optIdx, 1);
    waMsgs.push(m);
    waRenderThread('bottom');
    if (m.direction === 'in') waMarkRead();
  }
}

function waOnMessageUpdate(m) {
  const i = waMsgs.findIndex(x => x.id === m.id);
  if (i >= 0) {
    waMsgs[i] = m;
    const el = document.getElementById('wam-' + m.id);
    if (el) el.outerHTML = waMsgBubble(m);
  }
}

async function waMarkRead() {
  if (!waActive || waActive.owner_id !== WA_ME.id || !waActive.unread_count) return;
  waActive.unread_count = 0;
  await sb.from('jjp_wa_chats').update({ unread_count: 0 }).eq('id', waActive.id);
}

/* ---------- enviar ---------- */
async function waSendText() {
  const input = document.getElementById('waComposerInput');
  const body = (input?.value || '').trim();
  if (!body || !waActive) return;
  if (waActive.owner_id !== WA_ME.id) { showToast('Solo puedes enviar desde tus propios chats', 'warn'); return; }
  input.value = '';
  input.style.height = 'auto';
  waComposerButtons();

  const optimistic = {
    id: 'tmp-' + Date.now(), _optimistic: true,
    chat_id: waActive.id, direction: 'out', type: 'text',
    body, status: 'pending', created_at: new Date().toISOString()
  };
  waMsgs.push(optimistic);
  waRenderThread('bottom');

  const { error } = await sb.from('jjp_wa_messages').insert({
    chat_id: waActive.id, owner_id: WA_ME.id,
    direction: 'out', type: 'text', body, status: 'pending'
  });
  if (error) {
    waMsgs = waMsgs.filter(m => m.id !== optimistic.id);
    waRenderThread('bottom');
    showToast('No se pudo enviar: ' + error.message, 'err');
    input.value = body;
  } else if (!waSessionConnected()) {
    showToast('Mensaje en cola: tu WhatsApp no está conectado ahora (saldrá al conectar)', 'warn');
  }
}

async function waAttach() {
  document.getElementById('waFileInput')?.click();
}

async function waFileChosen(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file || !waActive) return;
  if (waActive.owner_id !== WA_ME.id) { showToast('Solo puedes enviar desde tus propios chats', 'warn'); return; }
  if (file.size > 30 * 1024 * 1024) { showToast('Archivo muy grande (máx 30 MB)', 'warn'); return; }

  const type = waTypeFromMime(file.type);
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${WA_ME.id}/${waActive.id}/${Date.now()}.${ext}`;

  showToast('Subiendo ' + WA_TYPE_LABEL[type].toLowerCase() + '…');
  const { error: upErr } = await sb.storage.from('jjp-wa-media')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (upErr) { showToast('Error subiendo archivo: ' + upErr.message, 'err'); return; }

  const caption = (document.getElementById('waComposerInput')?.value || '').trim() || null;
  const { error } = await sb.from('jjp_wa_messages').insert({
    chat_id: waActive.id, owner_id: WA_ME.id,
    direction: 'out', type, body: caption,
    media_path: path, media_mime: file.type || null,
    media_size: file.size, media_filename: file.name,
    status: 'pending'
  });
  if (error) { showToast('No se pudo enviar: ' + error.message, 'err'); return; }
  const ci = document.getElementById('waComposerInput'); if (ci) ci.value = '';
}

/* ---------- notas de voz (MediaRecorder) ---------- */
let waRec = null;          // { recorder, chunks, timer, secs, cancelled }

function waRecSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function waRecMime() {
  const prefs = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return prefs.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

async function waRecStart() {
  if (!waActive || waActive.owner_id !== WA_ME.id) return;
  if (waRec) return;
  if (!waRecSupported()) { showToast('Tu navegador no soporta grabar audio', 'warn'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    showToast('No se pudo acceder al micrófono (revisa permisos)', 'err');
    return;
  }
  const mime = waRecMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  waRec = { recorder, chunks: [], secs: 0, cancelled: false };
  recorder.ondataavailable = e => { if (e.data.size) waRec?.chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const rec = waRec; waRec = null;
    waRecRenderBar(false);
    if (!rec || rec.cancelled || !rec.chunks.length) return;
    waRecSend(new Blob(rec.chunks, { type: recorder.mimeType || mime || 'audio/webm' }), rec.secs);
  };
  recorder.start(250);
  waRec.timer = setInterval(() => {
    if (!waRec) return;
    waRec.secs++;
    const el = document.getElementById('waRecTime');
    if (el) el.textContent = waRecFmt(waRec.secs);
    if (waRec.secs >= 300) waRecStop();     // tope 5 min
  }, 1000);
  waRecRenderBar(true);
}

function waRecFmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function waRecStop() {                      // detener y ENVIAR
  if (!waRec) return;
  clearInterval(waRec.timer);
  waRec.recorder.stop();
}

function waRecCancel() {                    // detener y DESCARTAR
  if (!waRec) return;
  waRec.cancelled = true;
  clearInterval(waRec.timer);
  waRec.recorder.stop();
}

function waRecRenderBar(on) {
  const bar = document.getElementById('waRecBar');
  const composer = document.getElementById('waComposer');
  if (bar) bar.style.display = on ? 'flex' : 'none';
  if (composer) composer.style.display = on ? 'none' : 'flex';
  if (on) {
    const el = document.getElementById('waRecTime');
    if (el) el.textContent = '0:00';
  }
}

async function waRecSend(blob, secs) {
  if (!waActive) return;
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  const path = `${WA_ME.id}/${waActive.id}/${Date.now()}.${ext}`;
  showToast('Enviando nota de voz…');
  const { error: upErr } = await sb.storage.from('jjp-wa-media')
    .upload(path, blob, { contentType: blob.type || 'audio/webm' });
  if (upErr) { showToast('Error subiendo el audio: ' + upErr.message, 'err'); return; }
  const { error } = await sb.from('jjp_wa_messages').insert({
    chat_id: waActive.id, owner_id: WA_ME.id,
    direction: 'out', type: 'audio', body: null,
    media_path: path, media_mime: blob.type || 'audio/webm',
    media_size: blob.size, media_filename: `nota-de-voz-${waRecFmt(secs)}.${ext}`,
    status: 'pending'
  });
  if (error) showToast('No se pudo enviar: ' + error.message, 'err');
}

/* ---------- borrar chat ---------- */
async function waDeleteChat() {
  if (!waActive) return;
  const mine = waActive.owner_id === WA_ME.id;
  if (!mine && !WA_IS_ADMIN) { showToast('Solo el dueño del chat o un admin puede borrarlo', 'warn'); return; }
  const who = waActive.display_name || waPrettyPhone(waActive.phone);
  if (!confirm(`¿Borrar el chat con ${who}?\n\nSe eliminan los mensajes y archivos del CRM (NO se borra nada en el teléfono del cliente). Esta acción no se puede deshacer.`)) return;
  const id = waActive.id;
  const { data, error } = await sb.rpc('jjp_wa_delete_chat', { p_chat_id: id });
  if (error || data === false) { showToast('No se pudo borrar: ' + (error?.message || 'sin permiso'), 'err'); return; }
  waChats = waChats.filter(c => c.id !== id);
  waCloseThread();
  showToast('Chat borrado 🗑️');
}

async function waRetry(msgId) {
  const m = waMsgs.find(x => x.id === msgId);
  if (!m) return;
  // Re-encolar: nuevo insert (el original queda como 'failed'; RLS no deja editarlo)
  const { error } = await sb.from('jjp_wa_messages').insert({
    chat_id: m.chat_id, owner_id: WA_ME.id, direction: 'out',
    type: m.type, body: m.body, media_path: m.media_path,
    media_mime: m.media_mime, media_size: m.media_size,
    media_filename: m.media_filename, status: 'pending'
  });
  if (error) showToast('No se pudo reintentar: ' + error.message, 'err');
  else showToast('Reintentando envío…');
}

/* ---------- nuevo chat ---------- */
function openWaNewChat() {
  document.getElementById('waNewChatModal')?.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(document.getElementById('waNewChatModal'));
  document.getElementById('waNewPhone')?.focus();
}
function closeWaNewChat() {
  document.getElementById('waNewChatModal')?.classList.remove('op');
  const res = document.getElementById('waCustResults'); if (res) res.innerHTML = '';
}

async function waSearchCustomers() {
  const term = (document.getElementById('waNewCustSearch')?.value || '').trim();
  const box = document.getElementById('waCustResults');
  if (!box) return;
  if (term.length < 2) { box.innerHTML = ''; return; }
  const { data } = await sb.from('jjp_customers')
    .select('id,name,phone,city')
    .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
    .limit(8);
  box.innerHTML = (data || []).map(c => `
    <button class="wa-cust-result" onclick="waStartChat('${escapeHTML(c.phone)}','${c.id}')">
      <strong>${escapeHTML(c.name)}</strong> · ${escapeHTML(waPrettyPhone(c.phone))}${c.city ? ' · ' + escapeHTML(c.city) : ''}
    </button>`).join('') || '<p class="wa-link-note">Sin resultados</p>';
}

async function waNewChatFromPhone() {
  const phone = document.getElementById('waNewPhone')?.value;
  if (normVePhone(phone).length !== 12) { showToast('Número inválido (ej: 04121234567)', 'warn'); return; }
  await waStartChat(phone, null);
}

// Crea (o encuentra) el chat y lo abre
async function waStartChat(phone, customerId) {
  const norm = normVePhone(phone);
  const jid = waPhoneToJid(phone);

  let display = null;
  if (customerId) {
    const { data: c } = await sb.from('jjp_customers').select('name').eq('id', customerId).maybeSingle();
    display = c?.name || null;
  } else {
    // ¿existe cliente con ese teléfono? (formato local u internacional)
    const local = norm.startsWith('58') ? '0' + norm.slice(2) : norm;
    const { data: c } = await sb.from('jjp_customers')
      .select('id,name').in('phone', [norm, local]).limit(1).maybeSingle();
    if (c) { customerId = c.id; display = c.name; }
  }

  const { data, error } = await sb.from('jjp_wa_chats')
    .upsert({
      owner_id: WA_ME.id, jid, phone: norm,
      customer_id: customerId || null,
      display_name: display || waPrettyPhone(norm)
    }, { onConflict: 'owner_id,jid' })
    .select().single();
  if (error) { showToast('No se pudo crear el chat: ' + error.message, 'err'); return; }

  closeWaNewChat();
  if (!waChats.some(c => c.id === data.id)) waChats.unshift(data);
  await waOpenChat(data.id);
}

// Vincular el chat abierto a un cliente nuevo del CRM
async function waLinkCustomer() {
  if (!waActive) return;
  const name = prompt('Nombre del cliente para el CRM:', waActive.display_name || '');
  if (!name) return;
  const local = waActive.phone.startsWith('58') ? '0' + waActive.phone.slice(2) : waActive.phone;
  const { data, error } = await sb.from('jjp_customers')
    .insert({ name: name.trim(), phone: local, seller_id: WA_ME.id })
    .select('id,name').single();
  if (error) { showToast('No se pudo crear el cliente: ' + error.message, 'err'); return; }
  await sb.from('jjp_wa_chats')
    .update({ customer_id: data.id, display_name: data.name }).eq('id', waActive.id);
  waActive.customer_id = data.id;
  waActive.display_name = data.name;
  waRenderThreadHeader();
  showToast('Cliente creado y vinculado al chat ✅');
}

/* ---------- admin: filtros y sesiones del equipo ---------- */
async function waLoadProfiles() {
  const { data } = await sb.from('jjp_profiles').select('id,name,role,active').eq('active', true).order('name');
  waProfiles = data || [];
  const sel = document.getElementById('waOwnerFilter');
  if (sel) {
    sel.innerHTML = `<option value="me">Mis chats</option><option value="all">Todo el equipo</option>` +
      waProfiles.filter(p => p.id !== WA_ME.id)
        .map(p => `<option value="${p.id}">${escapeHTML(p.name || '—')}</option>`).join('');
  }
}

async function waSetOwnerFilter(v) {
  waOwnerFilter = v;
  waActive = null;
  document.getElementById('waWrap')?.classList.remove('thread-open');
  await waLoadChats();
}

async function openWaSessionsModal() {
  const modal = document.getElementById('waSessionsModal');
  if (!modal) return;
  modal.classList.add('op');
  if (typeof trapFocus === 'function') trapFocus(modal);
  await waRenderSessions();
}
function closeWaSessionsModal() {
  document.getElementById('waSessionsModal')?.classList.remove('op');
}

async function waRenderSessions() {
  const body = document.getElementById('waSessionsBody');
  if (!body) return;
  const { data: sess } = await sb.from('jjp_wa_sessions').select('*');
  const rows = waProfiles.map(p => {
    const s = (sess || []).find(x => x.profile_id === p.id);
    return `<tr>
      <td><strong>${escapeHTML(p.name || '—')}</strong><br><small>${p.role === 'admin' ? 'Admin' : 'Vendedor'}</small></td>
      <td>${s ? (WA_SESSION_LABEL[s.status] || s.status) : '—'}</td>
      <td>${s?.wa_number ? escapeHTML(waPrettyPhone(s.wa_number)) : '—'}</td>
      <td>
        <label class="wa-switch">
          <input type="checkbox" ${s?.enabled ? 'checked' : ''}
                 onchange="waToggleSession('${p.id}', this.checked)">
          <span></span>
        </label>
      </td>
      <td>${s?.status === 'connected' || s?.status === 'disconnected'
            ? `<button class="btn-o" onclick="waAdminLogout('${p.id}')">Desvincular</button>` : ''}</td>
    </tr>`;
  }).join('');
  body.innerHTML = `<table class="admin-table">
    <thead><tr><th>Usuario</th><th>Estado</th><th>Número</th><th>Habilitada</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="wa-link-note">Habilitar = ese usuario puede vincular SU cuenta desde su panel. Cada cuenta es individual.</p>`;
}

async function waToggleSession(profileId, enabled) {
  // La semilla crea la fila; upsert cubre perfiles creados después
  const { error } = await sb.from('jjp_wa_sessions')
    .upsert({ profile_id: profileId, enabled }, { onConflict: 'profile_id' });
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast(enabled ? 'Sesión habilitada' : 'Sesión deshabilitada');
  waRenderSessions();
}

async function waAdminLogout(profileId) {
  if (!confirm('¿Desvincular el WhatsApp de este usuario?')) return;
  await sb.from('jjp_wa_sessions')
    .update({ requested_action: 'logout', requested_at: new Date().toISOString() })
    .eq('profile_id', profileId);
  showToast('Desvinculando…');
}

/* ---------- deep links (?cust= / ?tel=) ---------- */
async function waHandleParams() {
  const params = new URLSearchParams(location.search);
  const custId = params.get('cust');
  const tel = params.get('tel');
  if (custId) {
    const { data: c } = await sb.from('jjp_customers').select('id,phone').eq('id', custId).maybeSingle();
    if (c?.phone) await waStartChat(c.phone, c.id);
  } else if (tel && normVePhone(tel).length === 12) {
    await waStartChat(tel, null);
  }
}
