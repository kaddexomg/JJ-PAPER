/* ======================================================
   JJ Paper — Chatbot v2
   - Búsqueda inteligente de productos (sinónimos, plurales,
     cantidades, alternativas por categoría)
   - Carrito y pedidos desde el chat
   - Cotizaciones al mayor guiadas (flujo paso a paso → RPC)
   - Rastreo de pedidos y cotizaciones dentro del chat
   ====================================================== */

let chatOpen   = false;
let cbGreeted  = false;
let cbProducts = null;   // caché de productos para búsqueda en el chat

// Flujos activos (máquinas de estado simples)
let cbQuote = { active: false, step: '', type: '', items: [], name: '', phone: '', pendingText: '' };
let cbTrack = { active: false, step: '', num: '' };

/* ------------------------------------------------------
   Utilidades
   ------------------------------------------------------ */

function cbWa(label = 'WhatsApp →', msg = '') {
  const txt = msg || APP.WA_MSG || '';
  return `<a href="#" onclick="openWA('${txt.replace(/'/g, "\\'")}');return false" style="color:var(--gm);font-weight:600">${label}</a>`;
}

// Grupos de sinónimos comunes en papelería venezolana
const CB_SYN = [
  ['boligrafo','lapicero','pluma','birome','esfero','boli'],
  ['resma','papel bond','hojas blancas'],
  ['cuaderno','libreta','bloc','block'],
  ['carpeta','folder','folders'],
  ['archivador','palanca'],
  ['engrapadora','grapadora','corchetera'],
  ['grapa','corchete'],
  ['pega','adhesivo','cola blanca'],
  ['cinta adhesiva','teipe','tirro','celoven'],
  ['cloro','lejia'],
  ['jabon','detergente'],
  ['papel toalla','toalla de papel','servilleta'],
  ['marcador','rotulador','plumon'],
  ['resaltador','destacador','subrayador'],
  ['borrador','goma de borrar'],
  ['sacapuntas','tajalapiz','tajador'],
  ['corrector','liquid paper','tipex'],
  ['clip','sujetapapeles','gancho'],
  ['notas adhesivas','post it','postit','taco de notas'],
  ['tijera','tijeras'],
];

function cbSingular(w) {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s'))  return w.slice(0, -1);
  return w;
}

// Distancia de Levenshtein acotada (para tolerar errores de escritura)
function cbLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

// Similitud 0..1 entre dos palabras ("resna" ≈ "resma" → 0.8)
function cbSim(a, b) {
  if (!a || !b) return 0;
  const d = cbLev(a, b);
  return d >= 99 ? 0 : 1 - d / Math.max(a.length, b.length);
}

// Expande una palabra con sus sinónimos (todo normalizado).
// Acepta errores de escritura: "resna" activa el grupo de "resma".
function cbExpand(word) {
  const out = new Set([word]);
  for (const group of CB_SYN) {
    const toks = group.flatMap(g => normTxt(g).split(' ').map(cbSingular));
    if (toks.includes(word) || toks.some(t => t.length >= 4 && word.length >= 4 && cbSim(t, word) >= 0.8)) {
      toks.forEach(t => out.add(t));
    }
  }
  return [...out];
}

// Extrae cantidad y texto: "10 resmas", "resma x10", "quiero 5 cloros"
function cbParseQty(text) {
  let qty = null, rest = text;
  let m = /^(?:quiero|necesito|dame|busco)?\s*(\d{1,5})\s+(?:de\s+)?(.{3,})$/i.exec(text.trim());
  if (m) { qty = parseInt(m[1]); rest = m[2]; }
  else {
    m = /^(.{3,}?)\s*[x×]\s*(\d{1,5})$/i.exec(text.trim());
    if (m) { qty = parseInt(m[2]); rest = m[1]; }
  }
  return { qty, rest: rest.trim() };
}

// Detecta listas grandes: "50 resmas, 20 cloros y 10 cuadernos" o varias líneas.
// strict=true (fuera de cotización): exige 2+ renglones con cantidad, para no
// confundir frases con comas ("hola, buenos días") con listas de productos.
// strict=false (dentro de cotización): basta con 2+ renglones.
function cbParseList(text, strict = true) {
  const parts = String(text)
    .split(/\n|,|;|·|•|\s+y\s+(?=\d)/i)
    .map(s => s.replace(/^[-*]?\s*\d*[.)]\s*/, '').trim())
    .filter(s => s.length >= 3);
  if (parts.length < 2) return null;
  const parsed = parts.map(seg => cbParseQty(seg));
  const withQty = parsed.filter(x => x.qty).length;
  if (strict && withQty < 2) return null;
  return parsed;
}

/* ------------------------------------------------------
   Búsqueda de productos con puntaje + alternativas
   ------------------------------------------------------ */

async function cbLoadProducts() {
  if (cbProducts) return cbProducts;
  // Incluye variantes (marcas): el chatbot agrega la más barata disponible
  const { data } = await sb.from('jjp_products')
    .select('id,name,price_usd,unit,emoji,stock,min_qty,category_id,jjp_categories(name,slug),jjp_product_variants(id,brand_id,variant_name,price_usd,stock,min_qty,active,jjp_brands(name))')
    .eq('active', true);
  cbProducts = (data || []).map(p => {
    p.variants = (p.jjp_product_variants || [])
      .filter(v => v.active !== false)
      .sort((a, b) => a.price_usd - b.price_usd);
    return p;
  });
  return cbProducts;
}

// Devuelve { exact: [productos], alt: [productos], catName }
async function cbSearchSmart(query) {
  const list  = await cbLoadProducts();
  const words = normTxt(query).split(/\s+/)
    .map(cbSingular)
    .filter(w => w.length > 2 && !['para','con','los','las','del','que','una','unos','unas'].includes(w));
  if (!words.length) return { exact: [], alt: [], catName: '' };

  const expanded = words.map(cbExpand); // array de arrays de variantes

  const scored = list.map(p => {
    const name = normTxt(p.name).split(/\s+/).map(cbSingular);
    const cat  = normTxt(p.jjp_categories?.name || '');
    let score = 0;
    for (const variants of expanded) {
      let hit = 0;
      for (const v of variants) {
        if (name.includes(v)) hit = Math.max(hit, 3);
        else if (v.length >= 4 && name.some(n => n.startsWith(v) || v.startsWith(n) && n.length >= 4)) hit = Math.max(hit, 2);
        // Tolerancia a errores de escritura: "resna"→"resma", "cuaderno"→"cuadreno"
        else if (v.length >= 4 && name.some(n => n.length >= 4 && cbSim(n, v) >= 0.75)) hit = Math.max(hit, 2);
        else if (cat.includes(v)) hit = Math.max(hit, 1);
      }
      score += hit;
    }
    return { p, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  const strong = scored.filter(x => x.score >= 2).slice(0, 3).map(x => x.p);
  if (strong.length) return { exact: strong, alt: [], catName: '' };

  // Sin match fuerte: ofrecer alternativas de la categoría detectada
  const weak = scored.slice(0, 4).map(x => x.p);
  if (weak.length) {
    return { exact: [], alt: weak, catName: weak[0].jjp_categories?.name || '' };
  }
  return { exact: [], alt: [], catName: '' };
}

/* ------------------------------------------------------
   UI del chat
   ------------------------------------------------------ */

function injectChatbot() {
  const html = `
<button class="cb-fab" onclick="toggleChat()" title="Asistente JJ Paper" aria-label="Abrir asistente de chat" aria-expanded="false" aria-controls="cbWin">
  💬
  <span class="cb-badge" id="cbBadge" aria-hidden="true">1</span>
</button>
<div class="cb-win" id="cbWin" role="dialog" aria-modal="false" aria-label="Asistente JJ Paper">
  <div class="cb-hd">
    <div class="cb-av" aria-hidden="true">🤖</div>
    <div class="cb-hd-i"><h4>Asistente JJ Paper</h4><p>En línea ahora ✅</p></div>
    <button class="cb-x" onclick="toggleChat()" aria-label="Cerrar chat">✕</button>
  </div>
  <div class="cb-msgs" id="cbMsgs" role="log" aria-live="polite" aria-atomic="false"></div>
  <div class="cb-qbtns" id="cbQuick">
    <button class="qb-btn" onclick="cbQ('Cotización al mayor')">📋 Cotizar</button>
    <button class="qb-btn" onclick="cbQ('Ver carrito')">🛒 Carrito</button>
    <button class="qb-btn" onclick="cbQ('Rastrear mi pedido')">🔎 Rastrear</button>
    <button class="qb-btn" onclick="cbQ('Métodos de pago')">💳 Pagos</button>
    <button class="qb-btn" onclick="cbQ('Horario')">🕐 Horario</button>
  </div>
  <div class="cb-ia">
    <label class="sr-only" for="cbIn">Escribe tu mensaje al asistente</label>
    <input type="text" class="cb-in" id="cbIn" placeholder="Ej: 10 resmas carta, cotizar, rastrear..."
      onkeypress="if(event.key==='Enter')cbSend()">
    <button class="cb-send" onclick="cbSend()" aria-label="Enviar mensaje">➤</button>
  </div>
</div>`;

  const placeholder = document.getElementById('chatbot-placeholder');
  if (placeholder) placeholder.outerHTML = html;
}

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('cbWin')?.classList.toggle('op', chatOpen);
  const badge = document.getElementById('cbBadge');
  if (badge) badge.style.display = 'none';
  const fab = document.querySelector('.cb-fab');
  if (fab) {
    fab.setAttribute('aria-expanded', chatOpen ? 'true' : 'false');
    fab.setAttribute('aria-label', chatOpen ? 'Cerrar asistente de chat' : 'Abrir asistente de chat');
  }
  if (chatOpen) setTimeout(() => document.getElementById('cbIn')?.focus(), 60);
  if (chatOpen && !cbGreeted) {
    cbGreeted = true;
    setTimeout(() => cbBotMsg(
      `¡Hola! 👋 Soy el asistente de <strong>JJ Paper</strong>. Puedo:<br>
       • Buscar productos y precios (ej: <em>"10 resmas carta"</em>)<br>
       • Armar tu <strong>cotización al mayor o al detal</strong> 📋<br>
       • Procesar <strong>listas completas</strong>: pégame algo como <em>"50 resmas, 20 cloros, 10 cuadernos"</em> 📝<br>
       • Agregar al carrito y completar tu pedido 🛒<br>
       • Rastrear tu pedido o cotización 🔎`), 400);
  }
}

function cbQ(text)   { cbUserMsg(text); cbProcess(text); }
function cbSend() {
  const inp  = document.getElementById('cbIn');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  cbUserMsg(text);
  cbProcess(text);
}

function cbUserMsg(text) {
  const msgs = document.getElementById('cbMsgs');
  msgs.innerHTML += `<div class="msg u"><div class="msg-bub">${escapeHTML(text)}</div></div>`;
  msgs.scrollTop  = msgs.scrollHeight;
}

function cbBotMsg(html, delay = 600) {
  const msgs = document.getElementById('cbMsgs');
  const typing = document.createElement('div');
  typing.className = 'msg b';
  typing.innerHTML = `<div class="msg-typing">
    <span class="dot-typing"></span><span class="dot-typing"></span><span class="dot-typing"></span>
  </div>`;
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  setTimeout(() => {
    typing.remove();
    msgs.innerHTML += `<div class="msg b"><div class="msg-bub">${html}</div></div>`;
    msgs.scrollTop  = msgs.scrollHeight;
  }, delay);
}

/* ------------------------------------------------------
   Tarjetas de producto en el chat
   ------------------------------------------------------ */

function cbProductHTML(p, qty = null, forQuote = false) {
  const soldOut = p.stock === 0;
  const n = qty || Math.max(1, p.min_qty || 1);
  const nmA = escapeHTML(p.name);
  const btn = forQuote
    ? `<button class="cb-prod-add" onclick="cbQuoteAdd('${p.id}',${n})" aria-label="Anotar ${n} de ${nmA} en la cotización">📋 x${n}</button>`
    : soldOut
      ? '<span style="font-size:10px;color:var(--danger);font-weight:700">Agotado</span>'
      : `<button class="cb-prod-add" onclick="cbAddProduct('${p.id}',${n})" aria-label="Agregar ${n} de ${nmA} al carrito">🛒 +${n}</button>`;
  return `<div class="cb-prod">
    <span class="cb-prod-ico">${p.emoji || '📦'}</span>
    <span class="cb-prod-info">
      <b>${escapeHTML(p.name)}</b><br>
      <span style="color:var(--gd);font-weight:700">${fmtPrice(p.price_usd)}</span>
      <span style="color:var(--gr);font-size:11px"> · ${fmtBs(p.price_usd)} /${escapeHTML(p.unit || 'unid')}</span>
      ${p.min_qty > 1 ? `<span style="color:var(--gr);font-size:10px"> · mín. ${p.min_qty}</span>` : ''}
    </span>
    ${btn}
  </div>`;
}

function cbAddProduct(id, qty = 1) {
  const p = (cbProducts || []).find(x => x.id === id);
  if (!p) return;
  // Variante más barata con stock (o la primera si todas registran stock)
  const variant = (p.variants || []).find(v => v.stock !== 0) || p.variants?.[0] || null;
  if (variant?.stock === 0 || (!variant && p.stock === 0)) {
    cbBotMsg(`😔 <strong>${escapeHTML(p.name)}</strong> está agotado por ahora.`);
    return;
  }
  addCart(p, qty, true, variant);
  const brand  = [variant?.jjp_brands?.name, variant?.variant_name].filter(Boolean).join(' · ') || null;
  const inCart = cart[variant?.id || id]?.qty || 0;
  cbBotMsg(`✅ <strong>${escapeHTML(p.name)}</strong>${brand ? ` <small>(${escapeHTML(brand)})</small>` : ''} agregado (tienes ${inCart} en el carrito).<br>
    <span class="cb-acts">
      <button class="cb-act" onclick="cbShowCart()">🛒 Ver carrito</button>
      <button class="cb-act p" onclick="location.href='checkout.html'">🧾 Finalizar pedido</button>
    </span>`, 250);
}

/* ------------------------------------------------------
   Carrito y pedido desde el chat
   ------------------------------------------------------ */

function cbShowCart() {
  const items = Object.values(cart);
  if (!items.length) {
    cbBotMsg(`Tu carrito está vacío 🛒. Escríbeme un producto (ej: <em>"20 cuadernos"</em>) y te lo agrego.`);
    return;
  }
  const total = cartTotal();
  const lines = items.map(i =>
    `<div class="cb-sum-row"><span>${escapeHTML(i.name)}${i.brand ? ` <small>(${escapeHTML(i.brand)})</small>` : ''} <b>x${i.qty}</b></span><span>${fmtPrice(i.price_usd * i.qty)}</span></div>`
  ).join('');
  cbBotMsg(`<div class="cb-sum">
      <div class="cb-sum-hd">🛒 Tu carrito (${items.length} producto${items.length !== 1 ? 's' : ''})</div>
      ${lines}
      <div class="cb-sum-row total"><span>Total</span><span>${fmtPrice(total)} · ${fmtBs(total)}</span></div>
    </div>
    <span class="cb-acts">
      <button class="cb-act p" onclick="location.href='checkout.html'">🧾 Finalizar pedido</button>
      <button class="cb-act" onclick="cbQuoteFromCart()">📋 Cotizar este carrito</button>
      <button class="cb-act" onclick="openCart()">Ver en detalle</button>
    </span>`);
}

/* ------------------------------------------------------
   Flujo guiado de COTIZACIÓN al mayor
   ------------------------------------------------------ */

function cbQuoteStart(prefillFromCart = false, pendingText = '') {
  cbTrack.active = false;
  cbQuote = { active: true, step: 'type', type: '', items: [], name: '', phone: '', pendingText };

  if (prefillFromCart) {
    cbQuote.items = Object.values(cart).map(i => ({
      product: i.name, qty: i.qty, unit: i.unit || 'unid',
      product_id: i.id, price_usd: i.price_usd,
    }));
  }

  cbBotMsg(`¡Armemos tu cotización! 📋 ¿La necesitas <b>al mayor</b> (grandes cantidades, mejor precio) o <b>al detal</b> (compra pequeña)?
    <span class="cb-acts">
      <button class="cb-act p" onclick="cbQuoteSetType('mayor')">🏪 Al mayor</button>
      <button class="cb-act p" onclick="cbQuoteSetType('detal')">🛍️ Al detal</button>
      <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
    </span>`);
}

async function cbQuoteSetType(type) {
  if (!cbQuote.active) return;
  cbQuote.type = type;
  cbQuote.step = 'items';
  const tLabel = type === 'detal' ? 'al detal' : 'al mayor';

  // Si el usuario ya había pegado una lista, la proceso de una vez
  if (cbQuote.pendingText) {
    const txt = cbQuote.pendingText;
    cbQuote.pendingText = '';
    await cbQuoteBulk(txt);
    return;
  }

  const intro = cbQuote.items.length
    ? `Perfecto, cotización <strong>${tLabel}</strong> 📋. Ya incluí lo de tu carrito:${cbQuoteListHTML()}`
    : `Perfecto, cotización <strong>${tLabel}</strong> 📋.<br>
       Puedes escribir los productos <b>uno por uno</b> (ej: <em>"50 resmas carta"</em>)
       o <b>pegarme la lista completa</b> separada por comas o líneas (ej: <em>"50 resmas, 20 cloros, 10 cuadernos"</em>).<br>
       También puedes <b>consultar precios sin agregar</b>: <em>"precio de resma carta"</em>.`;

  cbBotMsg(`${intro}<br>Cuando termines pulsa <b>Listo</b>.
    <span class="cb-acts">
      ${cbQuote.items.length ? `<button class="cb-act p" onclick="cbQuoteNext()">✅ Listo, continuar</button>` : ''}
      <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
    </span>`);
}

// Procesa una lista grande dentro de la cotización: agrega lo que encuentra,
// anota tal cual lo que no, y muestra el resumen completo.
async function cbQuoteBulk(text) {
  const parts = cbParseList(text, false) || [cbParseQty(text)];
  const added = [], noted = [];
  for (const { qty, rest } of parts) {
    if (!rest || rest.length < 3) continue;
    const { exact } = await cbSearchSmart(rest);
    if (exact.length) {
      const p = exact[0];
      const n = Math.max(qty || 1, p.min_qty || 1);
      cbQuote.items.push({ product: p.name, qty: n, unit: p.unit || 'unid', product_id: p.id, price_usd: p.price_usd });
      added.push(`${p.name} x${n}`);
    } else {
      cbQuote.items.push({ product: rest, qty: qty || 1, unit: '', product_id: null, price_usd: null });
      noted.push(`${rest} x${qty || 1}`);
    }
  }
  cbBotMsg(`Listo, procesé tu lista 📝:
    ${added.length ? `<br>✅ <b>${added.length}</b> del catálogo (con precio)` : ''}
    ${noted.length ? `<br>📋 <b>${noted.length}</b> anotado${noted.length !== 1 ? 's' : ''} tal cual (el asesor confirma precio)` : ''}
    ${cbQuoteListHTML()}
    ¿Agrego algo más? Escríbelo, o:
    <span class="cb-acts">
      <button class="cb-act p" onclick="cbQuoteNext()">✅ Listo, continuar</button>
      <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
    </span>`);
}

function cbQuoteFromCart() {
  if (!Object.keys(cart).length) { cbBotMsg('Tu carrito está vacío, agreguemos productos primero 😉'); return; }
  cbQuoteStart(true);
}

function cbQuoteListHTML() {
  if (!cbQuote.items.length) return '<br><em style="font-size:11px;color:var(--gr)">— aún sin productos —</em>';
  const est = cbQuote.items.reduce((s, it) => s + (it.price_usd ? it.price_usd * it.qty : 0), 0);
  const pending = cbQuote.items.filter(it => !it.price_usd).length;
  return `<div class="cb-sum" style="margin-top:6px">${cbQuote.items.map((it, i) =>
    `<div class="cb-sum-row"><span>${escapeHTML(it.product)} <b>x${it.qty}</b>${it.price_usd ? ` <span style="color:var(--gr)">(${fmtPrice(it.price_usd * it.qty)})</span>` : ' <span style="color:var(--gr);font-size:10px">(por confirmar)</span>'}</span>
     <button class="cb-del" onclick="cbQuoteRemove(${i})" title="Quitar">✕</button></div>`
  ).join('')}
  ${est > 0 ? `<div class="cb-sum-row total"><span>Estimado${pending ? ` (${pending} por confirmar)` : ''}</span><span>${fmtPrice(est)} · ${fmtBs(est)}</span></div>` : ''}</div>`;
}

function cbQuoteAdd(id, qty) {
  const p = (cbProducts || []).find(x => x.id === id);
  if (!p || !cbQuote.active) return;
  qty = Math.max(qty || 1, p.min_qty || 1);
  cbQuote.items.push({ product: p.name, qty, unit: p.unit || 'unid', product_id: p.id, price_usd: p.price_usd });
  cbBotMsg(`📋 Anotado: <strong>${escapeHTML(p.name)} x${qty}</strong>.${cbQuoteListHTML()}
    ¿Algo más? Escríbelo, o:
    <span class="cb-acts">
      <button class="cb-act p" onclick="cbQuoteNext()">✅ Listo, continuar</button>
      <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
    </span>`, 250);
}

function cbQuoteAddFree(text, qty) {
  if (!cbQuote.active) return;
  cbQuote.items.push({ product: text, qty: qty || 1, unit: '', product_id: null, price_usd: null });
  cbBotMsg(`📋 Anotado tal cual: <strong>${escapeHTML(text)} x${qty || 1}</strong> (el asesor te confirmará precio).${cbQuoteListHTML()}
    ¿Algo más? O pulsa:
    <span class="cb-acts">
      <button class="cb-act p" onclick="cbQuoteNext()">✅ Listo, continuar</button>
      <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
    </span>`, 250);
}

function cbQuoteRemove(i) {
  cbQuote.items.splice(i, 1);
  cbBotMsg(`Quitado.${cbQuoteListHTML()}`, 200);
}

function cbQuoteNext() {
  if (!cbQuote.active) return;
  if (cbQuote.step === 'items') {
    if (!cbQuote.items.length) { cbBotMsg('Aún no tienes productos en la cotización. Escríbeme al menos uno 😉'); return; }
    cbQuote.step = 'name';
    cbBotMsg('¿A nombre de quién va la cotización? (nombre o empresa) 🏢');
  }
}

function cbQuoteCancel() {
  cbQuote.active = false;
  cbBotMsg('Cotización cancelada. Cuando quieras la retomamos 😊');
}

async function cbQuoteSubmit() {
  if (!cbQuote.active) return;
  const est = cbQuote.items.reduce((s, it) => s + (it.price_usd ? it.price_usd * it.qty : 0), 0);
  const { data, error } = await sb.rpc('jjp_create_quote', {
    p_client_name: cbQuote.name,
    p_phone:       cbQuote.phone,
    p_items:       cbQuote.items,
    p_notes:       `Cotización ${cbQuote.type === 'detal' ? 'AL DETAL' : 'AL MAYOR'} solicitada desde el chat del sitio`,
    p_source:      'chat',
    p_estimated_total_usd: est > 0 ? +est.toFixed(2) : null,
  });
  cbQuote.active = false;

  if (error || !data?.quote_number) {
    console.warn('quote rpc error:', error);
    cbBotMsg(`No pude registrar la cotización 😔. Intenta de nuevo o ${cbWa('envíala por WhatsApp', 'Hola JJ Paper, quiero una cotización al mayor: ' + cbQuote.items.map(i => `${i.product} x${i.qty}`).join(', '))}.`);
    return;
  }

  // Guardar para rastreo rápido
  try {
    const mine = JSON.parse(localStorage.getItem('jjp_my_quotes') || '[]');
    mine.unshift({ n: data.quote_number, tel: cbQuote.phone, at: Date.now() });
    localStorage.setItem('jjp_my_quotes', JSON.stringify(mine.slice(0, 10)));
  } catch (e) {}

  const waMsg = `Hola JJ Paper, envié la cotización ${data.quote_number} desde el sitio web. Quedo atento a la pre-factura.`;
  cbBotMsg(`🎉 ¡Cotización registrada!<br>
    <div class="cb-sum"><div class="cb-sum-hd">N° <b>${escapeHTML(data.quote_number)}</b></div>
    <div class="cb-sum-row"><span>Productos</span><span>${cbQuote.items.length}</span></div>
    ${est > 0 ? `<div class="cb-sum-row total"><span>Estimado</span><span>${fmtPrice(est)} · ${fmtBs(est)}</span></div>` : ''}</div>
    Un asesor te contactará con la <strong>pre-factura ${cbQuote.type === 'detal' ? 'al detal' : 'al mayor'}</strong>. Guarda tu número.
    <span class="cb-acts">
      <button class="cb-act p" onclick="openWA('${waMsg.replace(/'/g, "\\'")}')">💬 Avisar por WhatsApp</button>
      <button class="cb-act" onclick="location.href='rastreo.html?c=${encodeURIComponent(data.quote_number)}'">🔎 Rastrear cotización</button>
    </span>`);
}

// Maneja el texto del usuario cuando el flujo de cotización está activo
async function cbQuoteHandle(text) {
  const t = text.trim();
  if (/^(cancelar|salir|no)$/i.test(t)) { cbQuoteCancel(); return; }

  if (cbQuote.step === 'type') {
    const n = normTxt(t);
    if (/(mayor|grande|bulto|caja)/.test(n))  { cbQuoteSetType('mayor'); return; }
    if (/(detal|detall|pequen|poco|menor)/.test(n)) { cbQuoteSetType('detal'); return; }
    cbBotMsg('Elige una opción: <b>al mayor</b> 🏪 o <b>al detal</b> 🛍️ (usa los botones de arriba).');
    return;
  }

  if (cbQuote.step === 'items') {
    if (/^(listo|ya|termine|continuar|siguiente|cerrar|enviar)$/i.test(normTxt(t))) { cbQuoteNext(); return; }
    if (/^(ver lista|mi lista|lista|resumen)$/i.test(normTxt(t))) {
      cbBotMsg(`Así va tu cotización 👇${cbQuoteListHTML()}
        <span class="cb-acts"><button class="cb-act p" onclick="cbQuoteNext()">✅ Listo, continuar</button></span>`, 250);
      return;
    }

    // Consulta de precio SIN agregar: "precio de resma", "cuánto cuesta el cloro", "tienes cuadernos?"
    const consulta = /^(?:precio(?:s)?\s+(?:de(?:l)?\s+)?|cuanto\s+(?:cuesta|vale|sale)n?\s+(?:el|la|los|las|un|una)?\s*|tienes|hay|consulta(?:r)?\s+)(.{3,})$/i
      .exec(normTxt(t).replace(/[?¿!¡]/g, '').trim());
    if (consulta) {
      const { exact, alt } = await cbSearchSmart(consulta[1]);
      const found = exact.length ? exact : alt;
      cbBotMsg(found.length
        ? `Te muestro (aún <b>no</b> lo agregué a la lista) 👇<br>${found.slice(0, 3).map(p => cbProductHTML(p, null, true)).join('')}
           <span style="font-size:11px;color:var(--gr)">Pulsa 📋 para sumarlo a la cotización, o sigue consultando.</span>`
        : `No encontré <em>"${escapeHTML(consulta[1])}"</em> 😔. Puedes anotarlo tal cual escribiendo la cantidad (ej: <em>"10 ${escapeHTML(consulta[1])}"</em>).`);
      return;
    }

    // Lista grande pegada dentro de la cotización (criterio flexible)
    if (cbParseList(t, false)) { await cbQuoteBulk(t); return; }

    const { qty, rest } = cbParseQty(t);
    const { exact, alt } = await cbSearchSmart(rest);
    const found = exact.length ? exact : alt;
    if (found.length) {
      cbBotMsg(`${exact.length ? 'Encontré esto' : 'No lo tengo exacto, pero mira estas opciones similares'}:<br>
        ${found.slice(0, 3).map(p => cbProductHTML(p, qty, true)).join('')}
        <span class="cb-acts">
          <button class="cb-act" onclick="cbQuoteAddFree('${rest.replace(/'/g, "\\'")}',${qty || 1})">➕ Anotar "${escapeHTML(rest)}" tal cual</button>
        </span>`);
    } else {
      cbQuoteAddFree(rest, qty);
    }
    return;
  }

  if (cbQuote.step === 'name') {
    if (t.length < 3) { cbBotMsg('Escríbeme un nombre o empresa válido 🙏'); return; }
    cbQuote.name = t.slice(0, 120);
    cbQuote.step = 'phone';
    cbBotMsg(`Gracias, <strong>${escapeHTML(cbQuote.name)}</strong>. Ahora tu teléfono 📱 (ej: 0412-1234567):`);
    return;
  }

  if (cbQuote.step === 'phone') {
    const digits = t.replace(/\D/g, '');
    if (!/^(0?4\d{9}|584\d{9}|0?2\d{9})$/.test(digits)) {
      cbBotMsg('Ese teléfono no parece válido 😅. Ejemplo: <em>0412-1234567</em>');
      return;
    }
    cbQuote.phone = t.slice(0, 30);
    cbQuote.step = 'confirm';
    cbBotMsg(`Revisa tu cotización 👇${cbQuoteListHTML()}
      <div class="cb-sum-row"><span><b>Tipo</b></span><span>${cbQuote.type === 'detal' ? '🛍️ Al detal' : '🏪 Al mayor'}</span></div>
      <div class="cb-sum-row"><span><b>Cliente</b></span><span>${escapeHTML(cbQuote.name)}</span></div>
      <div class="cb-sum-row"><span><b>Teléfono</b></span><span>${escapeHTML(cbQuote.phone)}</span></div>
      <span class="cb-acts">
        <button class="cb-act p" onclick="cbQuoteSubmit()">📨 Cerrar y enviar cotización</button>
        <button class="cb-act" onclick="cbQuote.step='items';cbBotMsg('Dale, sigue agregando o consultando productos 😉'+cbQuoteListHTML())">➕ Agregar más</button>
        <button class="cb-act" onclick="cbQuoteCancel()">✕ Cancelar</button>
      </span>`);
    return;
  }

  if (cbQuote.step === 'confirm') {
    if (/^(si|sí|enviar|ok|dale|confirmo)$/i.test(normTxt(t))) { cbQuoteSubmit(); return; }
    cbBotMsg('Pulsa <b>Enviar cotización</b> para confirmarla, o <b>Cancelar</b>.');
  }
}

/* ------------------------------------------------------
   Rastreo dentro del chat (pedidos y cotizaciones)
   ------------------------------------------------------ */

function cbTrackStart(num = '') {
  cbQuote.active = false;
  cbTrack = { active: true, step: num ? 'phone' : 'num', num };
  cbBotMsg(num
    ? `Vi el número <b>${escapeHTML(num)}</b> 👀. Confírmame el teléfono con el que registraste el pedido/cotización 📱:`
    : 'Claro 🔎. Escríbeme tu número de pedido o cotización (ej: <em>JJP-260701-1234</em>):');
}

async function cbTrackHandle(text) {
  const t = text.trim();
  if (/^(cancelar|salir)$/i.test(t)) { cbTrack.active = false; cbBotMsg('Listo, cancelado.'); return; }

  if (cbTrack.step === 'num') {
    const m = /JJP-\d{6}-\d{4}/i.exec(t);
    if (!m) { cbBotMsg('Ese número no tiene el formato <em>JJP-XXXXXX-XXXX</em>. Revísalo 🙏'); return; }
    cbTrack.num = m[0].toUpperCase();
    cbTrack.step = 'phone';
    cbBotMsg('Perfecto. Ahora el teléfono con el que lo registraste 📱:');
    return;
  }

  if (cbTrack.step === 'phone') {
    if (t.replace(/\D/g, '').length < 7) { cbBotMsg('Necesito un teléfono válido (mínimo 7 dígitos) 😅'); return; }
    cbTrack.active = false;

    // Primero como pedido; si no existe, como cotización
    let { data } = await sb.rpc('jjp_track_order', { p_order_number: cbTrack.num, p_phone: t });
    if (data) {
      const STATUS_TXT = {
        pendiente_pago: '🕐 Pendiente de pago', verificando: '🔍 Verificando pago',
        pagado: '✅ Pago confirmado', preparando: '📦 En preparación',
        entregado: '🚚 Entregado', rechazado: '❌ Pago rechazado', cancelado: '🚫 Cancelado',
      };
      cbBotMsg(`<div class="cb-sum"><div class="cb-sum-hd">Pedido <b>${escapeHTML(data.order_number)}</b></div>
        <div class="cb-sum-row"><span>Estado</span><span><b>${STATUS_TXT[data.status] || data.status}</b></span></div>
        <div class="cb-sum-row"><span>Total</span><span>${fmtPrice(data.total_usd)} · ${fmtBsNum(data.total_bs)}</span></div></div>
        <span class="cb-acts">
          <button class="cb-act" onclick="location.href='rastreo.html?n=${encodeURIComponent(data.order_number)}'">Ver línea de tiempo completa →</button>
        </span>`);
      return;
    }
    ({ data } = await sb.rpc('jjp_track_quote', { p_quote_number: cbTrack.num, p_phone: t }));
    if (data) {
      const QS = { pendiente: '⏳ Pendiente (en revisión)', contactado: '📞 Contactado por un asesor',
                   confirmado: '✅ Confirmada', cancelado: '🚫 Cancelada' };
      cbBotMsg(`<div class="cb-sum"><div class="cb-sum-hd">Cotización <b>${escapeHTML(data.quote_number)}</b></div>
        <div class="cb-sum-row"><span>Estado</span><span><b>${QS[data.status] || data.status}</b></span></div>
        <div class="cb-sum-row"><span>Productos</span><span>${(data.items || []).length}</span></div>
        ${data.estimated_total_usd ? `<div class="cb-sum-row"><span>Estimado</span><span>${fmtPrice(data.estimated_total_usd)}</span></div>` : ''}</div>`);
      return;
    }
    cbBotMsg(`No encontré nada con <b>${escapeHTML(cbTrack.num)}</b> y ese teléfono 😔. Verifica los datos o ${cbWa('escríbenos por WhatsApp', 'Hola JJ Paper, necesito ayuda con mi número ' + cbTrack.num)}.`);
  }
}

/* ------------------------------------------------------
   Intents fijos
   ------------------------------------------------------ */

const CB_KB = [
  { keys:['hola','buenos dias','buenas','saludos','buen dia'],
    res:() => '¡Hola! 👋 ¿Qué necesitas hoy? Puedo buscarte productos (ej: <em>"50 resmas"</em>), armar una <b>cotización al mayor</b> 📋 o rastrear tu pedido 🔎'},
  { keys:['metodos de pago','metodo de pago','como pago','formas de pago','pago movil','transferencia','zelle','efectivo','pagar'],
    res:() => '💳 Aceptamos <strong>Pago Móvil</strong>, <strong>transferencia bancaria</strong> (ambos en Bs a tasa BCV) y <strong>efectivo</strong> contra entrega. Al finalizar tu pedido subes el comprobante y verificamos el pago.'},
  { keys:['envio','entrega','delivery','despacho','enviar'],
    res:() => '🚚 Entregamos en Caracas y enviamos a todo Venezuela por encomienda. El costo varía según la zona. Para pedidos al mayor coordinamos el despacho contigo.'},
  { keys:['horario','a que hora','atienden','abren','cierran'],
    res:() => `🕐 Atendemos <strong>${APP.SETTINGS?.hours_weekday || 'Lun–Vie 8am–6pm'}</strong> y <strong>${APP.SETTINGS?.hours_saturday || 'Sáb 8am–1pm'}</strong>.`},
  { keys:['ubicacion','donde estan','direccion','mapa'],
    res:() => `📍 ${APP.SETTINGS?.address || 'Estamos en Caracas, Venezuela'}. <a href="index.html#contacto" style="color:var(--gm);font-weight:600">Ver mapa →</a>`},
  { keys:['whatsapp','numero de telefono','contacto','telefono de'],
    res:() => `📞 WhatsApp: ${cbWa(APP.SETTINGS?.phone_display || '+58 412-1234567')}<br>Email: ${APP.SETTINGS?.email || 'ventas@jjpaper.com.ve'}`},
  { keys:['mayor','al por mayor','mayorista','docena','bulto','cajas'],
    res:() => `🏪 ¡Somos mayoristas! Mientras mayor la cantidad, mejor el precio. Pide tu <b>cotización personalizada</b>: <span class="cb-acts"><button class="cb-act p" onclick="cbQuoteStart()">📋 Cotizar ahora</button></span>`},
  { keys:['catalogo','que venden','que tienen','productos'],
    res:() => '📦 Manejamos 6 categorías: Cuadernos, Escritura, Carpetas, Papel, Suministros y Limpieza. <a href="catalogo.html" style="color:var(--gm);font-weight:600">Ver catálogo →</a><br>O escríbeme el producto y te lo busco al instante.'},
  { keys:['gracias','perfecto','excelente','genial','muy bien'],
    res:() => `¡Con gusto! 😊 Cualquier otra cosa, aquí estoy. Para atención personalizada: ${cbWa('WhatsApp →')}`},
];

/* ------------------------------------------------------
   Router principal
   ------------------------------------------------------ */

async function cbProcess(text) {
  const q = normTxt(text);

  // 0) Flujos activos capturan el texto
  if (cbQuote.active) { await cbQuoteHandle(text); return; }
  if (cbTrack.active) { await cbTrackHandle(text); return; }

  // 1) Número de pedido/cotización pegado directamente
  const numMatch = /JJP-\d{6}-\d{4}/i.exec(text);
  if (numMatch) { cbTrackStart(numMatch[0].toUpperCase()); return; }

  // 1.5) Lista grande pegada directamente → arranca cotización con la lista
  if (cbParseList(text)) {
    cbQuoteStart(false, text);
    return;
  }

  // 2) Intents de flujo
  if (/(cotiz|presupuesto|pre factura|prefactura)/.test(q)) { cbQuoteStart(); return; }
  if (/(rastre|seguimiento|estado de mi|donde va mi|track)/.test(q)) { cbTrackStart(); return; }
  if (/(ver carrito|mi carrito|carrito)/.test(q)) { cbShowCart(); return; }
  if (/(hacer pedido|comprar|finalizar|checkout|pedido)/.test(q) && !/rastre/.test(q)) {
    const n = Object.keys(cart).length;
    cbBotMsg(n
      ? `Tienes ${n} producto${n !== 1 ? 's' : ''} en el carrito. <span class="cb-acts"><button class="cb-act p" onclick="location.href='checkout.html'">🧾 Finalizar pedido</button><button class="cb-act" onclick="cbShowCart()">🛒 Ver carrito</button></span>`
      : `Para hacer un pedido, dime qué necesitas (ej: <em>"30 carpetas manila"</em>) y lo agrego al carrito, o visita el <a href="catalogo.html" style="color:var(--gm);font-weight:600">catálogo →</a>`);
    return;
  }

  // 3) Base de conocimiento
  for (const item of CB_KB) {
    if (item.keys.some(k => q.includes(normTxt(k)))) {
      cbBotMsg(typeof item.res === 'function' ? item.res() : item.res);
      return;
    }
  }

  // 4) Búsqueda inteligente de productos (con cantidad y alternativas)
  const { qty, rest } = cbParseQty(text);
  const { exact, alt, catName } = await cbSearchSmart(rest);

  if (exact.length) {
    // Relacionados: misma categoría, no repetidos (cross-sell)
    const catId = exact[0].category_id;
    const related = (cbProducts || [])
      .filter(p => p.category_id === catId && !exact.some(e => e.id === p.id) && p.stock !== 0)
      .slice(0, 2);
    cbBotMsg(`Encontré esto en el catálogo:<br>${exact.map(p => cbProductHTML(p, qty)).join('')}
      ${related.length ? `<span style="font-size:11px;color:var(--gr)">También te puede interesar:</span><br>${related.map(p => cbProductHTML(p)).join('')}` : ''}
      <span class="cb-acts">
        <button class="cb-act" onclick="cbQuoteStart()">📋 Cotizar (mayor o detal)</button>
        <a class="cb-act" href="catalogo.html">Ver catálogo →</a>
      </span>`);
    return;
  }
  if (alt.length) {
    cbBotMsg(`No tengo <em>"${escapeHTML(rest)}"</em> exacto, pero ${catName ? `en <b>${escapeHTML(catName)}</b> ` : ''}tenemos estas alternativas:<br>
      ${alt.slice(0, 3).map(p => cbProductHTML(p, qty)).join('')}
      <span class="cb-acts"><button class="cb-act" onclick="cbQuoteStart()">📋 Pedir cotización con eso</button></span>`);
    return;
  }

  // 5) Fallback
  cbBotMsg(`No encontré <em>"${escapeHTML(rest)}"</em> en el catálogo 😔. Puedo anotarlo en una <b>cotización</b> para que un asesor te confirme precio y disponibilidad:
    <span class="cb-acts">
      <button class="cb-act p" onclick="cbQuoteStart()">📋 Crear cotización</button>
      <button class="cb-act" onclick="openWA('Hola JJ Paper, estoy buscando: ${text.replace(/'/g, "\\'")}')">💬 WhatsApp</button>
    </span>`);
}

document.addEventListener('DOMContentLoaded', injectChatbot);
