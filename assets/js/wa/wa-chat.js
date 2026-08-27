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

  waTrackErrors();
  waRequestNotifPerm();
  await waLinkInit(WA_ME.id);
  if (WA_IS_ADMIN) await waLoadProfiles();
  await waLoadChats();
  waSubscribe();
  waSubscribePresence();
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
    if ((ci.value || '').trim()) waTypingPing(); else waTypingStop();
  });
  waBindMic();

  // La barra de escribir se re-sincroniza al volver a la pestaña o a la ventana:
  // así nunca queda oculta por un estado viejo (ver waSyncComposer).
  document.addEventListener('visibilitychange', () => {
    waSyncComposer('visibilidad');
    if (document.visibilityState === 'visible') waGoOnline(); else waGoOffline();
  });
  window.addEventListener('focus', () => waSyncComposer('foco'));
  window.addEventListener('pagehide', () => waGoOffline());
  // La página del chat no debe scrollear: el chat se ajusta al hueco real
  document.body.classList.add('wa-page');
  // Panel derecho con una nota de bienvenida en vez de un hueco gris
  const hilo = document.getElementById('waThread');
  if (hilo && !hilo.innerHTML.trim()) hilo.innerHTML = waSinChat();
  waFitHeight(true);
  window.addEventListener('resize', () => waFitHeight(true));
  window.addEventListener('orientationchange', () => setTimeout(() => waFitHeight(true), 300));
  setInterval(waComposerWatchdog, 3000);
  waGoOnline();
  waSyncComposer('inicio');
}

/* ---------- composer: UNA sola fuente de verdad ----------
   Antes la visibilidad de la barra de escribir se tocaba desde dos sitios con
   style.display inline (render de la cabecera y grabación de voz). Si una
   grabación fallaba a medias la barra quedaba oculta PARA SIEMPRE — solo volvía
   al cambiar de chat. Ese era el "se traba y desaparece la barra". Ahora un
   único estado manda, se re-aplica en cada evento y un watchdog lo corrige.   */
let _waComposerState = null;

function waComposerState() {
  if (!waActive) return 'none';                                   // sin chat abierto
  if (waRec) return 'recording';                                  // grabando nota de voz
  return waActive.owner_id === WA_ME.id ? 'edit' : 'readonly';    // ajeno = solo lectura
}

function waSyncComposer(why) {
  const st = waComposerState();
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.removeProperty('display');   // mata cualquier inline viejo
    el.classList.toggle('wa-hide', !on);
  };
  show('waComposer',     st === 'edit');
  show('waRecBar',       st === 'recording');
  show('waReadonlyNote', st === 'readonly');
  if (st === 'none' || st === 'readonly') waCancelReply();
  if (_waComposerState !== st) {
    _waComposerState = st;
    waLog(`composer → ${st}${why ? ' (' + why + ')' : ''}`);
  }
  waComposerButtons();
}

// Red de seguridad: si algo deja la barra oculta sin motivo (bug, extensión del
// navegador, grabación fantasma) vuelve sola en ≤3 s en vez de dejar el panel
// inservible hasta recargar la página. También vigila que no se salga de la
// pantalla, que era la otra forma de "desaparecer".
function waComposerWatchdog() {
  const c = document.getElementById('waComposer');
  if (!c) return;
  const oculto = c.classList.contains('wa-hide') || c.style.display === 'none';
  if (waComposerState() === 'edit' && oculto) {
    waLog('watchdog: barra oculta sin motivo → restaurada');
    waSyncComposer('watchdog');
  }
  waFitHeight();
}

/* Ajuste de alto a prueba de todo.
   El CSS ya reparte el espacio con flex (body.wa-page), pero si alguna regla lo
   pisa —o el navegador es viejo— esto mide de verdad y recorta el chat para que
   la barra de escribir SIEMPRE quede dentro de la ventana. Es la última línea
   de defensa del fallo que reportó el dueño. */
let _waFitLast = 0, _waTight = null;
function waFitHeight(force) {
  const wrap = document.getElementById('waWrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const alto = (id, extra) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('wa-hide')) return 0;
    return el.getBoundingClientRect().height + (extra || 0);
  };
  // Mínimo con el que el chat sigue siendo usable: cabecera + barra de escribir
  // + barra de respuesta + un pedazo de hilo.
  const minimo = Math.ceil(alto('waThreadHead') + alto('waComposer') + alto('waReplyBar') + 110);
  const disponible = Math.round(window.innerHeight - r.top - 12);   // 12px de respiro

  // Ventana tan baja que la barra de escribir no cabe ni recortando el hilo:
  // la página scrollea y la barra se ancla al fondo (CSS .wa-tight). Nunca se
  // pierde. La histéresis de 48px evita que el modo oscile en el límite, porque
  // entrar en modo apretado cambia el layout y cambiaría la medida otra vez.
  const apretado = _waTight ? disponible < minimo + 48 : disponible < minimo;
  if (apretado !== _waTight) {
    _waTight = apretado;
    document.body.classList.toggle('wa-tight', apretado);
    waLog(apretado ? `ventana muy baja (${disponible}px < ${minimo}px): la página pasa a scroll`
                   : 'ventana con espacio suficiente: chat a pantalla completa');
  }
  const objetivo = apretado ? minimo : disponible;
  if (objetivo < 200) return;                              // tamaño absurdo: no tocar
  if (!force && Math.abs(objetivo - r.height) < 4) return;
  if (Math.abs(objetivo - r.height) < 2) return;
  wrap.style.height = objetivo + 'px';
  wrap.style.minHeight = '0';
  if (!_waFitLast) waLog(`alto ajustado: chat ${Math.round(r.height)} → ${objetivo}px`);
  _waFitLast = objetivo;
}

function waComposerButtons() {
  const hasText = !!(document.getElementById('waComposerInput')?.value || '').trim();
  const canRec = waRecSupported();
  document.getElementById('waMicBtn')?.classList.toggle('wa-hide', hasText || !canRec);
  document.getElementById('waSendBtn')?.classList.toggle('wa-hide', !hasText && canRec);
}

/* ---------- caja negra (diagnóstico) ----------
   Deja rastro de los últimos eventos del panel en localStorage. Si algo vuelve
   a fallar, el botón 🩺 de la barra superior copia el rastro completo y no hay
   que reproducir el fallo para saber qué pasó. */
const WA_LOG_KEY = 'jjp_wa_log';

function waLog(msg) {
  try {
    const arr = JSON.parse(localStorage.getItem(WA_LOG_KEY) || '[]');
    arr.push(new Date().toISOString().slice(11, 19) + ' · ' + msg);
    localStorage.setItem(WA_LOG_KEY, JSON.stringify(arr.slice(-60)));
  } catch (e) { /* localStorage lleno o bloqueado: el panel sigue igual */ }
}

function waTrackErrors() {
  window.addEventListener('error', e =>
    waLog('error JS: ' + (e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e =>
    waLog('promesa rechazada: ' + (e.reason?.message || e.reason)));
}

async function waCopyDiag() {
  const eventos = (() => { try { return JSON.parse(localStorage.getItem(WA_LOG_KEY) || '[]'); } catch (e) { return []; } })();
  const info = [
    'JJ Paper · diagnóstico del CRM WhatsApp',
    'fecha: ' + new Date().toLocaleString('es-VE'),
    'usuario: ' + (WA_ME?.name || '—') + ' (' + (WA_ME?.role || '—') + ')',
    'navegador: ' + navigator.userAgent,
    'ventana: ' + window.innerWidth + '×' + window.innerHeight,
    'chat abierto: ' + (waActive ? waActive.phone + (waActive.owner_id === WA_ME.id ? ' (mío)' : ' (de otra sesión)') : 'ninguno'),
    'estado de la barra: ' + waComposerState(),
    'grabando: ' + (waRec ? 'sí (' + waRec.secs + 's)' : 'no'),
    'mensajes cargados: ' + waMsgs.length + ' · chats: ' + waChats.length,
    '--- últimos eventos ---',
    ...eventos
  ].join('\n');
  try {
    await navigator.clipboard.writeText(info);
    showToast('Diagnóstico copiado ✅ pégalo en el chat de soporte');
  } catch (e) {
    prompt('Copia este diagnóstico (Ctrl+C):', info);
  }
}

/* ---------- modales: abrir/cerrar liberando la trampa de foco ----------
   trapFocus() devuelve una función para liberar el foco; antes se descartaba,
   así que al cerrar un modal el foco quedaba dentro de un contenedor oculto y
   escribir en el composer no hacía nada hasta hacer clic. */
const _waTraps = new Map();

function waOpenModal(id) {
  const m = document.getElementById(id);
  if (!m) return null;
  m.classList.add('op');
  if (typeof trapFocus === 'function') _waTraps.set(id, trapFocus(m));
  return m;
}

function waCloseModal(id) {
  document.getElementById(id)?.classList.remove('op');
  const liberar = _waTraps.get(id);
  if (liberar) { _waTraps.delete(id); try { liberar(); } catch (e) {} }
  if (waComposerState() === 'edit') document.getElementById('waComposerInput')?.focus();
}

// Recarga de bandeja agrupada: durante una ráfaga (sync de historial, varios
// mensajes juntos) llegan decenas de eventos de jjp_wa_chats. Sin esto el panel
// recargaba los 200 chats por CADA evento y se quedaba "cargando" sin dejar
// escribir. Ahora recarga UNA vez ~700ms después del último cambio.
let _waChatsReloadTimer = null;
function waLoadChatsDebounced() {
  clearTimeout(_waChatsReloadTimer);
  _waChatsReloadTimer = setTimeout(() => waLoadChats(), 700);
}

function waSubscribe() {
  // Solo escucho MIS mensajes salvo que sea admin (que puede ver los del equipo).
  // Filtrar por owner_id evita recibir el firehose de todo el sistema.
  const msgFilter = WA_IS_ADMIN ? {} : { filter: `owner_id=eq.${WA_ME.id}` };
  sb.channel('wa-ui-' + WA_ME.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jjp_wa_messages', ...msgFilter },
      p => waOnNewMessage(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jjp_wa_messages', ...msgFilter },
      p => waOnMessageUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jjp_wa_chats' },
      () => waLoadChatsDebounced())
    .subscribe();
}

/* ---------- bandeja ---------- */
async function waLoadChats() {
  let q = sb.from('jjp_wa_chats').select('*')
    .order('pinned', { ascending: false })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);
  if (!WA_IS_ADMIN || waOwnerFilter === 'me') q = q.eq('owner_id', WA_ME.id);
  else if (waOwnerFilter !== 'all') q = q.eq('owner_id', waOwnerFilter);
  
  let { data, error } = await q;
  if (error && error.message && error.message.includes('pinned')) {
    console.warn('Fallback: reintentando carga de chats sin ordenar por pinned');
    let q2 = sb.from('jjp_wa_chats').select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200);
    if (!WA_IS_ADMIN || waOwnerFilter === 'me') q2 = q2.eq('owner_id', WA_ME.id);
    else if (waOwnerFilter !== 'all') q2 = q2.eq('owner_id', waOwnerFilter);
    const res2 = await q2;
    data = res2.data;
    error = res2.error;
  }

  if (error) { showToast('Error cargando chats: ' + error.message, 'err'); return; }
  waChats = data || [];
  waRenderChatList();
  // La bandeja se acaba de re-dibujar: volver a pintar quién está escribiendo
  for (const id of Object.keys(waPresence)) waPaintPresence(id);
}

function waRenderChatList() {
  const list = document.getElementById('waChatList');
  if (!list) return;
  const term = normTxt(document.getElementById('waSearch')?.value || '');
  const rows = waChats.filter(c =>
    !term || normTxt(c.display_name || '').includes(term) || (c.phone || '').includes(term)
    || normTxt(c.label || '').includes(term));

  if (!rows.length) {
    list.innerHTML = '<div class="wa-empty">Sin chats todavía.<br>Usa <strong>＋ Nuevo chat</strong> o espera mensajes entrantes.</div>';
    return;
  }
  list.innerHTML = rows.map(c => {
    const mine = c.owner_id === WA_ME.id;
    const owner = !mine ? waProfiles.find(p => p.id === c.owner_id)?.name : null;
    const nombre = c.display_name || waPrettyPhone(c.phone) || '?';
    return `
    <button class="wa-chat-item ${waActive?.id === c.id ? 'on' : ''}" onclick="waOpenChat('${c.id}')">
      <div class="wa-avatar" style="${waAvatarStyle(nombre)}">${escapeHTML(nombre.charAt(0).toUpperCase())}</div>
      <div class="wa-chat-info">
        <div class="wa-chat-top">
          <span class="wa-chat-name">${c.pinned ? '📌 ' : ''}${escapeHTML(c.display_name || waPrettyPhone(c.phone))}</span>
          <span class="wa-chat-time">${waTime(c.last_message_at)}</span>
        </div>
        ${c.label ? `<span class="wa-label" style="background:${escapeHTML(c.label_color || '#16604A')}">${escapeHTML(c.label)}</span>` : ''}
        <div class="wa-chat-bottom">
          <span class="wa-chat-preview" data-pv="${c.id}">${c.last_message_from === 'me' ? 'Tú: ' : ''}${escapeHTML(c.last_message_preview || '')}</span>
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

  waCancelReply();
  document.getElementById('waWrap')?.classList.add('thread-open');
  waRenderThreadHeader();
  waRenderChatList();
  await waLoadMessages();
  waMarkRead();
  waCargarFicha();           // historial del cliente, para la ficha y el correo
  if (waActive.owner_id === WA_ME.id) {
    waSendAction('read');    // recibo de lectura en el teléfono del cliente
    waSendAction('watch');   // pedir la presencia del cliente ("escribiendo…")
  }
}

/* ====================================================================
   Ficha del cliente dentro del chat
   El vendedor ya no tiene que salirse del chat para saber qué le compró
   esta persona: pedidos y cotizaciones se ven aquí mismo.
   ==================================================================== */
let waFicha = null;   // { cliente, pedidos, cotizaciones } del chat abierto

async function waCargarFicha() {
  waFicha = null;
  if (!waActive?.customer_id) return;
  const idAlAbrir = waActive.id;
  const { data, error } = await sb.rpc('jjp_customer_360', { p_customer: waActive.customer_id });
  if (error || !data) return;
  if (waActive?.id !== idAlAbrir) return;   // el vendedor ya cambió de chat
  waFicha = data;
}

// Contexto para el hub de envío (send-hub.js)
function waSendCtx() {
  const docs = ['catalogo', 'lista'];
  const ctx = {
    nombre: waActive?.display_name || waPrettyPhone(waActive?.phone),
    telefono: waActive?.phone,
    email: waFicha?.cliente?.email || null,
    customerId: waActive?.customer_id || null,
    docs,
  };
  // Si tiene documentos recientes, se ofrecen también desde el chat
  const ped = waFicha?.pedidos?.[0];
  const cot = waFicha?.cotizaciones?.[0];
  if (ped) { ctx.order = { ...ped, order_number: ped.numero }; }
  if (cot) { ctx.quote = { ...cot, order_number: cot.numero }; }
  return ctx;
}

function waVerFicha() {
  if (!waActive) return;
  if (!waActive.customer_id) {
    showToast('Este chat aún no está vinculado a un cliente del CRM', 'warn');
    return;
  }
  const f = waFicha;
  const c = f?.cliente || {};
  const base = WA_IS_ADMIN ? '../vendedor/' : '';
  const fecha = iso => iso ? new Date(iso).toLocaleDateString('es-VE') : '';
  const linea = (d, tipo) => `
    <div class="c360-item">
      <div><span class="c360-num">${escapeHTML(d.numero || '—')}</span>
        <div class="c360-fecha">${fecha(d.fecha)} · ${escapeHTML(d.estado || '')}</div></div>
      <div style="text-align:right">
        <strong>${fmtPrice(d.total_usd || 0)}</strong><br>
        <a href="../comprobante.html?${tipo === 'pedido' ? 'n' : 'q'}=${encodeURIComponent(d.numero || '')}"
           target="_blank" style="font-size:11px;color:var(--gd)">🖨️ imprimir</a>
      </div>
    </div>`;

  const html = `
    <div class="c360">
      <div class="c360-tot">
        <span>🛒 ${c.total_orders || 0} compras</span>
        <span>💵 ${fmtPrice(c.total_usd || 0)} total</span>
        ${c.last_order_at ? `<span>📅 última ${fecha(c.last_order_at)}</span>` : ''}
        ${c.email ? `<span>📧 ${escapeHTML(c.email)}</span>` : ''}
      </div>
      <h4 style="font-size:13px;margin:10px 0 6px">Pedidos</h4>
      ${f?.pedidos?.length ? f.pedidos.map(p => linea(p, 'pedido')).join('')
                           : '<p class="c360-empty">Todavía no te ha comprado.</p>'}
      <h4 style="font-size:13px;margin:12px 0 6px">Cotizaciones</h4>
      ${f?.cotizaciones?.length ? f.cotizaciones.map(q => linea(q, 'cotizacion')).join('')
                                : '<p class="c360-empty">Sin cotizaciones.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <a class="btn-p" style="width:auto;padding:9px 14px;text-decoration:none"
           href="${base}pos.html?cliente=${encodeURIComponent(waActive.customer_id)}">🛍️ Venderle ahora</a>
        <a class="btn-o" style="width:auto;padding:9px 14px;text-decoration:none"
           href="${base}cotizador.html?cliente=${encodeURIComponent(waActive.customer_id)}">📋 Cotizarle</a>
      </div>
    </div>`;

  waModalSimple(`Ficha de ${escapeHTML(c.name || waActive.display_name || '')}`, html);
}

/* Modal ligero creado al vuelo (no hace falta tocar los dos whatsapp.html) */
function waModalSimple(titulo, html) {
  document.getElementById('waSimpleModal')?.remove();
  const el = document.createElement('div');
  el.id = 'waSimpleModal';
  el.className = 'modal-overlay op';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-box" style="max-width:520px">
      <div class="modal-hd">
        <h3>${titulo}</h3>
        <button class="modal-close" onclick="document.getElementById('waSimpleModal').remove()" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body">${html}</div>
    </div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  if (typeof trapFocus === 'function') trapFocus(el);
}

function waCloseThread() {
  waActive = null;
  document.getElementById('waWrap')?.classList.remove('thread-open');
  waSyncComposer('cerrar hilo');
  waRenderChatList();
  const hd = document.getElementById('waThreadHead');
  if (hd) hd.innerHTML = '<div class="wa-empty" style="padding:10px">Elige un chat para empezar</div>';
  const box = document.getElementById('waThread');
  if (box) box.innerHTML = waSinChat();
}

function waRenderThreadHeader() {
  const hd = document.getElementById('waThreadHead');
  if (!hd || !waActive) return;
  const mine = waActive.owner_id === WA_ME.id;
  const owner = !mine ? waProfiles.find(p => p.id === waActive.owner_id)?.name : null;
  const nombreHilo = waActive.display_name || waPrettyPhone(waActive.phone) || '?';
  hd.innerHTML = `
    <button class="wa-back" onclick="waCloseThread()" aria-label="Volver a la lista">←</button>
    <div class="wa-avatar" style="${waAvatarStyle(nombreHilo)}">${escapeHTML(nombreHilo.charAt(0).toUpperCase())}</div>
    <div class="wa-thread-title">
      <strong>${escapeHTML(waActive.display_name || waPrettyPhone(waActive.phone))}</strong>
      <small id="waPresence" class="wa-pres" aria-live="polite">${escapeHTML(waPrettyPhone(waActive.phone))}${owner ? ' · sesión de ' + escapeHTML(owner) : ''}</small>
    </div>
    ${!mine ? '' : `<button class="btn-o wa-cust-btn" onclick="sendMenuAbrir(event, waSendCtx())"
        title="Enviar catálogo, lista de precios o un documento" aria-label="Enviar documento" aria-haspopup="menu">📤</button>`}
    ${!mine ? ''
      : waActive.customer_id
        ? `<a class="btn-o wa-cust-btn" href="${(WA_IS_ADMIN ? '../vendedor/' : '') + 'pos.html?tel=' + encodeURIComponent(waActive.phone)}" title="Nueva venta a este cliente">🛍️ Venta</a>`
        : `<button class="btn-o wa-cust-btn" onclick="waLinkCustomer()" title="Crear cliente en el CRM">＋ CRM</button>`}
    ${!mine ? '' : `<button class="btn-o wa-cust-btn" onclick="waVerFicha()"
        title="Historial de compras y cotizaciones" aria-label="Ficha del cliente">📇</button>`}
    ${(mine || WA_IS_ADMIN) ? `
      <button class="btn-o wa-cust-btn ${waActive.pinned ? 'on-pin' : ''}" onclick="waTogglePin()"
        title="${waActive.pinned ? 'Desanclar chat' : 'Anclar chat arriba'}" aria-label="Anclar chat">📌</button>
      <button class="btn-o wa-cust-btn" onclick="waSetLabel()" title="Etiqueta del chat" aria-label="Etiqueta del chat">🏷️</button>
      <button class="btn-o wa-cust-btn wa-del-btn" onclick="waDeleteChat()" title="Borrar chat del CRM" aria-label="Borrar chat">🗑️</button>` : ''}
  `;
  waSyncComposer('cabecera');
  waPaintPresence(waActive.id);
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

// pos = posición dentro de un grupo de mensajes seguidos del mismo lado:
// 'solo' | 'primero' | 'medio' | 'ultimo'. Solo el último lleva pico y hora,
// como en WhatsApp: así una ráfaga de 5 mensajes se lee como un bloque.
function waMsgBubble(m, pos) {
  const out = m.direction === 'out';
  let inner = '';
  if (m.forwarded) inner += `<div class="wam-fwd">↪ Reenviado</div>`;
  if (m.reply_preview) inner += `<div class="wam-quote">${escapeHTML(m.reply_preview).slice(0, 120)}</div>`;
  if (m.type !== 'text' && m.media_path) {
    inner += `<div class="wa-media" data-path="${escapeHTML(m.media_path)}" data-type="${m.type}"
                   data-mime="${escapeHTML(m.media_mime || '')}" data-name="${escapeHTML(m.media_filename || '')}">
                ${WA_TYPE_ICON[m.type] || '📄'} Cargando ${WA_TYPE_LABEL[m.type] || 'archivo'}…
              </div>`;
  } else if (m.type !== 'text') {
    inner += `<div class="wa-media-miss">${WA_TYPE_ICON[m.type] || ''} ${WA_TYPE_LABEL[m.type] || ''}</div>`;
  }
  if (m.body) inner += `<div class="wa-body">${escapeHTML(m.body)}</div>`;
  const tick = out
    ? `<span class="wa-tick ${m.status}" role="img" aria-label="${WA_STATUS_LABEL[m.status] || m.status}">${WA_STATUS_TICK[m.status] || ''}</span>`
    : '';
  const failed = m.status === 'failed'
    ? `<div class="wa-failed">No se envió${m.error ? ': ' + escapeHTML(m.error) : ''} <button class="wa-retry" onclick="waRetry('${m.id}')">Reintentar</button></div>` : '';
  const canDel = waActive && (waActive.owner_id === WA_ME.id || WA_IS_ADMIN) && !m._optimistic;
  const mine = waActive && waActive.owner_id === WA_ME.id;
  // Barra de acciones: responder / reaccionar / reenviar / borrar
  let acts = '<span class="wam-acts">';
  if (mine && m.wa_msg_id && !m._optimistic) {
    acts += `<button onclick="waStartReply('${m.id}')" title="Responder">↩</button>`;
    acts += `<button onclick="waReactPick('${m.id}',event)" title="Reaccionar">😊</button>`;
    acts += `<button onclick="waForward('${m.id}')" title="Reenviar">↪</button>`;
  }
  if (canDel) acts += `<button onclick="waDeleteMsg('${m.id}')" title="Borrar mensaje del CRM" aria-label="Borrar mensaje">🗑️</button>`;
  acts += '</span>';
  const react = m.reaction ? `<span class="wam-react">${escapeHTML(m.reaction)}</span>` : '';
  const p = pos || 'solo';
  const conPico = p === 'solo' || p === 'primero';   // el pico va arriba, en el primero del grupo
  const soloMedia = !m.body && m.type !== 'text' && m.media_path;   // la hora va encima de la foto
  return `
    <div class="wam ${out ? 'out' : 'in'} g-${p}" id="wam-${m.id}">
      ${acts}<div class="wam-bubble${conPico ? ' con-pico' : ''}${soloMedia ? ' solo-media' : ''}">${inner}
        <span class="wam-meta">${waTime(m.wa_timestamp || m.created_at)}${tick}</span>${react}
      </div>${failed}
    </div>`;
}

// Estado vacío del hilo: mejor una nota amable con la marca que una línea gris
function waHiloVacio() {
  const quien = waActive ? escapeHTML(waActive.display_name || waPrettyPhone(waActive.phone)) : 'este cliente';
  return `<div class="wa-vacio">
    <svg viewBox="0 0 64 64" aria-hidden="true" class="wa-vacio-ico">
      <path d="M12 14h40a4 4 0 014 4v22a4 4 0 01-4 4H27l-11 9v-9h-4a4 4 0 01-4-4V18a4 4 0 014-4z"
            fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M20 24h24M20 32h16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
    <p><strong>Todavía no hay mensajes con ${quien}</strong></p>
    <p class="wa-vacio-sub">Escribe abajo para empezar la conversación.</p>
  </div>`;
}

// Panel derecho sin chat elegido
function waSinChat() {
  return `<div class="wa-vacio">
    <svg viewBox="0 0 64 64" aria-hidden="true" class="wa-vacio-ico">
      <circle cx="32" cy="32" r="25" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <path d="M22 30h20M22 38h13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M32 7v6M32 51v6M7 32h6M51 32h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </svg>
    <p><strong>Elige un chat de la lista</strong></p>
    <p class="wa-vacio-sub">O toca <strong>＋</strong> para escribirle a un número nuevo.</p>
  </div>`;
}

/* ---------- responder (citar) ---------- */
let waReplyTo = null;   // { wa_msg_id, preview, from }

function waStartReply(msgId) {
  const m = waMsgs.find(x => x.id === msgId);
  if (!m) return;
  waReplyTo = {
    wa_msg_id: m.wa_msg_id,
    preview: m.body || WA_TYPE_LABEL[m.type] || 'Mensaje',
    from: m.direction === 'out' ? 'me' : 'them'
  };
  const bar = document.getElementById('waReplyBar');
  if (bar) {
    bar.classList.remove('wa-hide');
    bar.innerHTML = `<div class="wa-reply-info"><strong>Respondiendo</strong>
        <span>${escapeHTML(waReplyTo.preview.slice(0, 90))}</span></div>
      <button class="wa-reply-x" onclick="waCancelReply()" aria-label="Cancelar respuesta">✕</button>`;
  }
  document.getElementById('waComposerInput')?.focus();
}
function waCancelReply() {
  waReplyTo = null;
  const bar = document.getElementById('waReplyBar');
  if (bar) { bar.classList.add('wa-hide'); bar.innerHTML = ''; }
}

/* ---------- reaccionar ---------- */
const WA_REACT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function waReactPick(msgId, ev) {
  ev?.stopPropagation();
  document.getElementById('waReactPop')?.remove();
  const pop = document.createElement('div');
  pop.id = 'waReactPop';
  pop.className = 'wa-react-pop';
  pop.innerHTML = WA_REACT_EMOJIS.map(e => `<button onclick="waReact('${msgId}','${e}')">${e}</button>`).join('')
    + `<button onclick="waReact('${msgId}','')" title="Quitar reacción">✖</button>`;
  document.body.appendChild(pop);
  const r = (ev?.target || document.getElementById('wam-' + msgId)).getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
  pop.style.top = Math.max(8, r.top - 48) + 'px';
  setTimeout(() => document.addEventListener('click', function h() { pop.remove(); document.removeEventListener('click', h); }), 0);
}

async function waReact(msgId, emoji) {
  document.getElementById('waReactPop')?.remove();
  const m = waMsgs.find(x => x.id === msgId);
  if (!m || !waActive || waActive.owner_id !== WA_ME.id) return;
  m.reaction = emoji; m.reaction_from = 'me';        // optimista
  const el = document.getElementById('wam-' + m.id);
  if (el) el.outerHTML = waMsgBubble(m);
  const { error } = await sb.from('jjp_wa_actions').insert({
    owner_id: WA_ME.id, chat_id: waActive.id, jid: waActive.jid,
    kind: 'react', target_wa_id: m.wa_msg_id, emoji
  });
  if (error) showToast('No se pudo reaccionar: ' + error.message, 'err');
}

/* ---------- reenviar ---------- */
let waForwardMsgId = null;

function waForward(msgId) {
  waForwardMsgId = msgId;
  const box = document.getElementById('waFwdList');
  if (!box) return;
  const mine = waChats.filter(c => c.owner_id === WA_ME.id && c.id !== waActive?.id);
  box.innerHTML = mine.length
    ? mine.map(c => `<button class="wa-cust-result" onclick="waDoForward('${c.id}')">
        ${escapeHTML(c.display_name || waPrettyPhone(c.phone))}</button>`).join('')
    : '<p class="wa-link-note">No tienes otros chats. Abre uno nuevo primero.</p>';
  waOpenModal('waFwdModal');
}
function closeWaFwd() { waCloseModal('waFwdModal'); }

async function waDoForward(chatId) {
  const m = waMsgs.find(x => x.id === waForwardMsgId);
  if (!m) return;
  const { error } = await sb.from('jjp_wa_messages').insert({
    chat_id: chatId, owner_id: WA_ME.id, direction: 'out', type: m.type, body: m.body,
    media_path: m.media_path, media_mime: m.media_mime, media_size: m.media_size,
    media_filename: m.media_filename, status: 'pending', forwarded: true
  });
  if (error) { showToast('No se pudo reenviar: ' + error.message, 'err'); return; }
  closeWaFwd();
  showToast('Reenviado ↪');
}

/* ---------- presencia SALIENTE: el cliente ve nuestro "escribiendo…" ---------- */
let _waTypingActive = false, _waTypingTimer = null;
function waTypingPing() {
  if (!waActive || waActive.owner_id !== WA_ME.id) return;
  if (!_waTypingActive) { _waTypingActive = true; waSendAction('typing'); }
  clearTimeout(_waTypingTimer);
  _waTypingTimer = setTimeout(waTypingStop, 3500);
}
function waTypingStop() {
  clearTimeout(_waTypingTimer);
  if (_waTypingActive) { _waTypingActive = false; waSendAction('stop_typing'); }
}
function waSendAction(kind, jid) {
  if (!waActive && !jid) return;
  sb.from('jjp_wa_actions').insert({
    owner_id: WA_ME.id,
    chat_id: jid ? null : waActive.id,
    jid: jid || waActive.jid,
    kind
  }).then(() => {});
}

/* ---------- presencia ENTRANTE: "escribiendo…" del cliente ----------
   Llega por Realtime Broadcast (canal efímero que publica wa-server): NO se
   escribe nada en la base de datos, así que no consume cuota de Supabase.
   WhatsApp solo entrega la presencia del cliente si nuestra sesión está
   "disponible", por eso avisamos online/offline según el panel esté a la vista.
*/
let waPresence = {};              // chat_id → { state, lastSeen, at }
const _waPresTimers = {};         // chat_id → temporizador de caducidad
let _waOnlineTimer = null;

function waSubscribePresence() {
  sb.channel('wa-presence-' + WA_ME.id)
    .on('broadcast', { event: 'presence' }, ({ payload }) => waOnPresence(payload))
    .subscribe();
}

function waOnPresence(p) {
  if (!p?.jid) return;
  const owner = p.owner || WA_ME.id;
  const chat = waChats.find(c => c.owner_id === owner && (c.jid === p.jid || (p.phone && c.phone === p.phone)));
  if (!chat) return;
  const st = p.state || 'unavailable';
  waPresence[chat.id] = {
    state: st,
    at: Date.now(),
    lastSeen: p.lastSeen || waPresence[chat.id]?.lastSeen || null
  };
  // WhatsApp no siempre manda el "dejó de escribir": caduca solo a los 12 s
  clearTimeout(_waPresTimers[chat.id]);
  if (st === 'composing' || st === 'recording') {
    _waPresTimers[chat.id] = setTimeout(() => {
      if (waPresence[chat.id]) waPresence[chat.id].state = 'available';
      waPaintPresence(chat.id);
    }, 12_000);
  }
  waPaintPresence(chat.id);
}

// Texto a mostrar; '' = nada que mostrar
function waPresenceText(chatId) {
  const p = waPresence[chatId];
  if (!p) return '';
  if (p.state === 'composing') return 'escribiendo…';
  if (p.state === 'recording') return 'grabando audio…';
  if (p.state === 'available') return 'en línea';
  if (p.lastSeen) return 'últ. vez ' + waTime(new Date(p.lastSeen * 1000).toISOString());
  return '';
}

// Pinta sin re-renderizar el hilo ni la bandeja (evita parpadeos al escribir)
function waPaintPresence(chatId) {
  const txt = waPresenceText(chatId);
  const activo = txt === 'escribiendo…' || txt === 'grabando audio…';

  if (waActive && waActive.id === chatId) {
    const el = document.getElementById('waPresence');
    if (el) {
      const owner = waActive.owner_id !== WA_ME.id
        ? waProfiles.find(pr => pr.id === waActive.owner_id)?.name : null;
      const base = waPrettyPhone(waActive.phone) + (owner ? ' · sesión de ' + owner : '');
      el.textContent = txt ? base + ' · ' + txt : base;
      el.classList.toggle('on', activo);
    }
  }
  const row = document.querySelector(`[data-pv="${chatId}"]`);
  if (row) {
    const chat = waChats.find(c => c.id === chatId);
    row.textContent = activo
      ? txt
      : (chat?.last_message_from === 'me' ? 'Tú: ' : '') + (chat?.last_message_preview || '');
    row.classList.toggle('typing', activo);
  }
}

// "Disponible" solo mientras el panel está a la vista (no aparecemos en línea 24/7)
function waGoOnline() {
  if (document.visibilityState === 'hidden') return;
  waSendAction('online', 'self');
  clearInterval(_waOnlineTimer);
  // El servidor da la disponibilidad por vencida a los 5 min sin señal
  _waOnlineTimer = setInterval(() => {
    if (document.visibilityState === 'visible') waSendAction('online', 'self');
  }, 240_000);
}

function waGoOffline() {
  clearInterval(_waOnlineTimer);
  _waOnlineTimer = null;
  waSendAction('offline', 'self');
}

function waRenderThread(scroll) {
  const box = document.getElementById('waThread');
  if (!box) return;
  const prevH = box.scrollHeight;

  let html = waHasOlder
    ? '<div class="wa-load-more"><button class="btn-o" onclick="waLoadMessages(true)">↑ Cargar anteriores</button></div>' : '';
  let lastDay = '';
  // Agrupar mensajes seguidos del mismo lado y del mismo día: solo el último del
  // grupo lleva pico y hora. Un mensaje corta el grupo si pasan más de 5 min.
  const HUECO = 5 * 60 * 1000;
  const ts = m => new Date(m.wa_timestamp || m.created_at).getTime();
  const mismoGrupo = (a, b) => a && b && a.direction === b.direction
    && new Date(ts(a)).toDateString() === new Date(ts(b)).toDateString()
    && Math.abs(ts(b) - ts(a)) < HUECO;

  for (let i = 0; i < waMsgs.length; i++) {
    const m = waMsgs[i];
    const day = new Date(m.wa_timestamp || m.created_at).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      html += `<div class="wa-day">${waDayLabel(m.wa_timestamp || m.created_at)}</div>`;
    }
    const conAnterior = i > 0 && mismoGrupo(waMsgs[i - 1], m)
      && new Date(ts(waMsgs[i - 1])).toDateString() === day;
    const conSiguiente = mismoGrupo(m, waMsgs[i + 1]);
    const pos = conAnterior && conSiguiente ? 'medio'
      : conAnterior ? 'ultimo' : conSiguiente ? 'primero' : 'solo';
    html += waMsgBubble(m, pos);
  }
  if (!waMsgs.length) html += waHiloVacio();
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
  if (m.direction === 'in') {
    waMaybeNotify(m);
    // Ya envió: deja de estar "escribiendo…"
    if (waPresence[m.chat_id]) {
      clearTimeout(_waPresTimers[m.chat_id]);
      waPresence[m.chat_id].state = 'available';
      waPresence[m.chat_id].at = Date.now();
      waPaintPresence(m.chat_id);
    }
  }
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
  waTypingStop();
  const reply = waReplyTo;   // capturar antes de limpiar
  waCancelReply();

  const optimistic = {
    id: 'tmp-' + Date.now(), _optimistic: true,
    chat_id: waActive.id, direction: 'out', type: 'text',
    body, status: 'pending', created_at: new Date().toISOString(),
    reply_preview: reply?.preview || null
  };
  waMsgs.push(optimistic);
  waRenderThread('bottom');

  const insert = {
    chat_id: waActive.id, owner_id: WA_ME.id,
    direction: 'out', type: 'text', body, status: 'pending'
  };
  if (reply?.wa_msg_id) { insert.reply_to_wa_id = reply.wa_msg_id; insert.reply_preview = reply.preview; insert.reply_from = reply.from; }
  const { error } = await sb.from('jjp_wa_messages').insert(insert);
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
  const reply = waReplyTo; waCancelReply();
  const insert = {
    chat_id: waActive.id, owner_id: WA_ME.id,
    direction: 'out', type, body: caption,
    media_path: path, media_mime: file.type || null,
    media_size: file.size, media_filename: file.name,
    status: 'pending'
  };
  if (reply?.wa_msg_id) { insert.reply_to_wa_id = reply.wa_msg_id; insert.reply_preview = reply.preview; insert.reply_from = reply.from; }
  const { error } = await sb.from('jjp_wa_messages').insert(insert);
  if (error) { showToast('No se pudo enviar: ' + error.message, 'err'); return; }
  const ci = document.getElementById('waComposerInput'); if (ci) ci.value = '';
}

/* ---------- notas de voz (MediaRecorder) ----------
   El mic se maneja MANTENIENDO PULSADO, como en WhatsApp. Antes bastaba un clic
   y, con el campo vacío, el mic ocupa el sitio del botón Enviar: era facilísimo
   arrancar una grabación sin querer y creer que la barra de escribir se había
   ido. Además cualquier fallo del micrófono ahora devuelve la barra.          */
let waRec = null;          // { recorder, stream, chunks, timer, secs, cancelled }
let _waMicHeld = false;    // el botón del mic está pulsado ahora mismo
let _waRecStarting = false;

function waRecSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function waRecMime() {
  const prefs = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return prefs.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

function waBindMic() {
  const mic = document.getElementById('waMicBtn');
  if (!mic || mic.dataset.bound) return;
  mic.dataset.bound = '1';
  mic.removeAttribute('onclick');            // el onclick del HTML ya no manda
  mic.title = 'Mantén pulsado para grabar una nota de voz';
  mic.setAttribute('aria-label', 'Mantén pulsado para grabar una nota de voz');

  mic.addEventListener('pointerdown', e => {
    e.preventDefault();
    _waMicHeld = true;
    waRecStart();
  });
  const soltar = enviar => {
    if (!_waMicHeld) return;
    _waMicHeld = false;
    if (waRec) { enviar ? waRecStop() : waRecCancel(); }
    else if (!_waRecStarting) waRecHint();   // pulsación demasiado corta
  };
  mic.addEventListener('pointerup', e => { e.preventDefault(); soltar(true); });
  mic.addEventListener('pointercancel', () => soltar(false));
  mic.addEventListener('pointerleave', () => soltar(false));
  // Teclado (accesibilidad): Enter/Espacio alterna grabar ↔ enviar
  mic.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (waRec) { _waMicHeld = false; waRecStop(); }
    else { _waMicHeld = true; waRecStart(); }
  });
}

function waRecHint() {
  showToast('Mantén pulsado el 🎙️ para grabar una nota de voz', 'warn');
}

async function waRecStart() {
  if (!waActive || waActive.owner_id !== WA_ME.id) return;
  if (waRec || _waRecStarting) return;
  if (!waRecSupported()) { showToast('Tu navegador no soporta grabar audio', 'warn'); return; }
  _waRecStarting = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    _waRecStarting = false;
    waLog('micrófono rechazado: ' + (e?.name || e?.message || '?'));
    showToast('No se pudo acceder al micrófono (revisa los permisos del navegador)', 'err');
    waSyncComposer('fallo mic');
    return;
  }
  _waRecStarting = false;
  // Soltó el botón antes de que el micrófono estuviera listo: no grabamos nada
  if (!_waMicHeld) { stream.getTracks().forEach(t => t.stop()); waRecHint(); return; }

  const mime = waRecMime();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    waLog('MediaRecorder no arrancó: ' + (e?.message || '?'));
    showToast('Este navegador no pudo iniciar la grabación', 'err');
    waSyncComposer('fallo grabadora');
    return;
  }
  waRec = { recorder, stream, chunks: [], secs: 0, cancelled: false };
  recorder.ondataavailable = e => { if (e.data.size) waRec?.chunks.push(e.data); };
  recorder.onerror = e => {
    waLog('error de grabación: ' + (e?.error?.name || '?'));
    waRecAbort('El micrófono falló');
  };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const rec = waRec; waRec = null;
    waSyncComposer('fin grabación');
    if (!rec || rec.cancelled || !rec.chunks.length) return;
    waRecSend(new Blob(rec.chunks, { type: recorder.mimeType || mime || 'audio/webm' }), rec.secs);
  };
  // Si el micrófono se desconecta o el sistema corta el audio, no dejamos la
  // barra de escribir escondida esperando un onstop que nunca llega.
  stream.getTracks().forEach(t => t.addEventListener('ended', () => {
    if (waRec) waRecAbort('El micrófono se desconectó');
  }));

  try { recorder.start(250); }
  catch (e) { waRecAbort('No se pudo iniciar la grabación'); return; }

  const el = document.getElementById('waRecTime');
  if (el) el.textContent = '0:00';
  waRec.timer = setInterval(() => {
    if (!waRec) return;
    waRec.secs++;
    const t = document.getElementById('waRecTime');
    if (t) t.textContent = waRecFmt(waRec.secs);
    if (waRec.secs >= 300) waRecStop();     // tope 5 min
  }, 1000);
  waSyncComposer('grabando');
}

function waRecFmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function waRecStop() {                      // detener y ENVIAR
  if (!waRec) return;
  clearInterval(waRec.timer);
  try { waRec.recorder.stop(); } catch (e) { waRecAbort('No se pudo cerrar la grabación'); }
}

function waRecCancel() {                    // detener y DESCARTAR
  if (!waRec) return;
  waRec.cancelled = true;
  clearInterval(waRec.timer);
  try { waRec.recorder.stop(); } catch (e) { waRecAbort(); }
}

// Corta todo y DEVUELVE la barra de escribir (red de seguridad ante cualquier fallo)
function waRecAbort(msg) {
  const rec = waRec;
  waRec = null;
  _waMicHeld = false;
  if (rec) {
    clearInterval(rec.timer);
    try { rec.recorder.stop(); } catch (e) {}
    try { rec.stream?.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  waSyncComposer('grabación abortada');
  if (msg) showToast(msg + ' — barra de escribir restaurada', 'warn');
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

/* ---------- vaciar TODOS mis chats (reset de sincronización) ---------- */
// Borra la copia del CRM (chats + mensajes) sin desvincular WhatsApp: la sesión
// sigue conectada y los mensajes NUEVOS vuelven a entrar. No toca el teléfono.
async function waPurgeAllChats() {
  if (!confirm('¿Vaciar TODOS tus chats del CRM?\n\nSe borran los chats y mensajes sincronizados (NO se borra nada en tu teléfono ni se desvincula WhatsApp). Los mensajes nuevos volverán a entrar. Esta acción no se puede deshacer.')) return;
  showToast('Vaciando chats…');
  // Limpieza best-effort de la media en Storage (los huérfanos no bloquean)
  try {
    const { data: chats } = await sb.from('jjp_wa_chats').select('id,owner_id').eq('owner_id', WA_ME.id);
    for (const c of chats || []) await waPurgeChatMedia(c.owner_id, c.id);
  } catch (e) { /* seguir igual */ }
  const { data, error } = await sb.rpc('jjp_wa_purge_chats', { p_owner: WA_ME.id });
  if (error) { showToast('No se pudo vaciar: ' + error.message, 'err'); return; }
  waChats = [];
  waActive = null;
  waPresence = {};
  document.getElementById('waWrap')?.classList.remove('thread-open');
  waSyncComposer('chats vaciados');
  waRenderChatList();
  showToast(`Listo: ${data || 0} chats vaciados 🧹`);
}

/* ---------- borrar chat ---------- */
// Supabase no permite borrar storage.objects desde SQL: la media se limpia
// aquí con la Storage API (política wa_media_delete) y luego el RPC borra el chat.
async function waPurgeChatMedia(ownerId, chatId) {
  try {
    const folder = `${ownerId}/${chatId}`;
    for (let i = 0; i < 20; i++) {                       // hasta 2000 archivos
      const { data: files, error } = await sb.storage.from('jjp-wa-media')
        .list(folder, { limit: 100 });
      if (error || !files?.length) break;
      await sb.storage.from('jjp-wa-media').remove(files.map(f => `${folder}/${f.name}`));
      if (files.length < 100) break;
    }
  } catch (e) { /* huérfanos no bloquean el borrado del chat */ }
}

async function waDeleteChat() {
  if (!waActive) return;
  const mine = waActive.owner_id === WA_ME.id;
  if (!mine && !WA_IS_ADMIN) { showToast('Solo el dueño del chat o un admin puede borrarlo', 'warn'); return; }
  const who = waActive.display_name || waPrettyPhone(waActive.phone);
  if (!confirm(`¿Borrar el chat con ${who}?\n\nSe eliminan los mensajes y archivos del CRM (NO se borra nada en el teléfono del cliente). Esta acción no se puede deshacer.`)) return;
  const id = waActive.id, owner = waActive.owner_id;
  showToast('Borrando chat…');
  await waPurgeChatMedia(owner, id);
  const { data, error } = await sb.rpc('jjp_wa_delete_chat', { p_chat_id: id });
  if (error || data === false) { showToast('No se pudo borrar: ' + (error?.message || 'sin permiso'), 'err'); return; }
  waChats = waChats.filter(c => c.id !== id);
  waCloseThread();
  showToast('Chat borrado 🗑️');
}

/* ---------- borrar mensaje individual (del CRM) ---------- */
async function waDeleteMsg(msgId) {
  const m = waMsgs.find(x => x.id === msgId);
  if (!m || !waActive) return;
  if (waActive.owner_id !== WA_ME.id && !WA_IS_ADMIN) return;
  if (!confirm('¿Borrar este mensaje del CRM?\n(No se borra en el teléfono del cliente)')) return;
  const { error } = await sb.from('jjp_wa_messages').delete().eq('id', msgId);
  if (error) { showToast('No se pudo borrar: ' + error.message, 'err'); return; }
  if (m.media_path) sb.storage.from('jjp-wa-media').remove([m.media_path]).catch(() => {});
  waMsgs = waMsgs.filter(x => x.id !== msgId);
  waRenderThread('keep');
  showToast('Mensaje borrado');
}

/* ---------- anclar chat ---------- */
async function waTogglePin() {
  if (!waActive || (waActive.owner_id !== WA_ME.id && !WA_IS_ADMIN)) return;
  const pinned = !waActive.pinned;
  const { error } = await sb.from('jjp_wa_chats').update({ pinned }).eq('id', waActive.id);
  if (error) { showToast('No se pudo anclar: ' + error.message, 'err'); return; }
  waActive.pinned = pinned;
  waRenderThreadHeader();
  await waLoadChats();
  showToast(pinned ? '📌 Chat anclado' : 'Chat desanclado');
}

/* ---------- etiqueta del chat ---------- */
const WA_LABEL_COLORS = ['#16604A', '#C9A24B', '#1565C0', '#C2185B', '#6A1B9A', '#E65100'];
function waLabelColor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WA_LABEL_COLORS[h % WA_LABEL_COLORS.length];
}

async function waSetLabel() {
  if (!waActive || (waActive.owner_id !== WA_ME.id && !WA_IS_ADMIN)) return;
  const label = prompt('Etiqueta del chat (vacío = quitar):\nEj: cliente frecuente, mayorista, pendiente pago…', waActive.label || '');
  if (label === null) return;
  const clean = label.trim().slice(0, 30);
  const upd = { label: clean || null, label_color: clean ? waLabelColor(clean) : null };
  const { error } = await sb.from('jjp_wa_chats').update(upd).eq('id', waActive.id);
  if (error) { showToast('No se pudo etiquetar: ' + error.message, 'err'); return; }
  Object.assign(waActive, upd);
  waRenderThreadHeader();
  waRenderChatList();
  showToast(clean ? `🏷️ Etiqueta: ${clean}` : 'Etiqueta quitada');
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
  waOpenModal('waNewChatModal');
  document.getElementById('waNewPhone')?.focus();
}
function closeWaNewChat() {
  waCloseModal('waNewChatModal');
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
  waSyncComposer('cambio de filtro');
  await waLoadChats();
}

async function openWaSessionsModal() {
  if (!waOpenModal('waSessionsModal')) return;
  await waRenderSessions();
}
function closeWaSessionsModal() {
  waCloseModal('waSessionsModal');
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
