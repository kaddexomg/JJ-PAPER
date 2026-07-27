/* ======================================================
   JJ Paper — Enviar ficha de producto al cliente

   El cliente pregunta "¿tienen X?" y el vendedor (o el admin) le manda
   en un toque: la FOTO del producto + una reseña corta (nombre,
   descripción, precio $ y Bs, marcas) + el enlace directo a la ficha
   pública (producto.html?id=…) para comprar o cotizar de una vez.

   Sale por el CRM propio (jjp_wa_messages / jjp_emails) igual que el
   resto del hub de envío, así queda registrado en el historial del
   cliente. Por WhatsApp la foto va como IMAGEN con el texto de caption;
   por correo va una tarjeta HTML con la foto y un botón.

   Depende de: config.js (sb, escapeHTML, fmtPrice, toBs) y
   send-hub.js (sendPorWhatsApp, sendPorCorreo, sendServerOnline, sendToast).
   No toca doc-engine: aquí no hay PDF.
   ====================================================== */

let _fichaProd = null;      // producto cargado en el modal
let _fichaCust = null;      // cliente elegido { id, name, phone, email }
let _fichaBusy = false;

/* ---------------- Utilidades ---------------- */

// Base pública del sitio: quita /admin/... o /vendedor/... de la ruta actual
function fichaPublicBase() {
  return location.origin + location.pathname.replace(/\/(admin|vendedor)\/.*$/, '').replace(/\/[^/]*$/, '');
}

function fichaLink(p) {
  return `${fichaPublicBase()}/producto.html?id=${p.id}`;
}

// Marcas activas del producto (para la reseña)
function fichaMarcas(p) {
  const names = (p.jjp_product_variants || [])
    .filter(v => v.active !== false)
    .map(v => v.jjp_brands?.name || v.variant_name)
    .filter(Boolean);
  return [...new Set(names)];
}

// Precio a mostrar: el menor entre producto y variantes activas
function fichaPrecio(p) {
  const de = (p.jjp_product_variants || []).filter(v => v.active !== false).map(v => +v.price_usd);
  const todos = [+p.price_usd, ...de].filter(n => Number.isFinite(n) && n > 0);
  return todos.length ? Math.min(...todos) : +p.price_usd || 0;
}

// Mensaje que acompaña la foto (editable por el vendedor antes de enviar)
function fichaTextoDefault(p) {
  const marcas = fichaMarcas(p);
  const usd = fichaPrecio(p);
  const bs = (typeof toBs === 'function') ? toBs(usd) : null;
  const lineas = [
    `🛍️ *${p.name}* — JJ Paper`,
    '',
  ];
  if (p.description) lineas.push(p.description, '');
  lineas.push(`💰 Precio: ${fmtPrice(usd)}${bs ? ` (Bs ${Number(bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })})` : ''} por ${p.unit || 'unidad'}`);
  if (marcas.length) lineas.push(`🏷️ Marcas disponibles: ${marcas.join(', ')}`);
  lineas.push('', '🛒 Cómpralo o cotízalo directo aquí:', fichaLink(p));
  return lineas.join('\n');
}

/* ---------------- Modal ---------------- */

function fichaCSS() {
  if (document.getElementById('jjp-ficha-css')) return;
  const st = document.createElement('style');
  st.id = 'jjp-ficha-css';
  st.textContent = `
  .ficha-ovl{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:14px}
  .ficha-box{background:var(--card,#fff);border-radius:14px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.3)}
  .ficha-hd{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .ficha-hd img{width:54px;height:54px;object-fit:cover;border-radius:10px}
  .ficha-hd .fi-emoji{font-size:36px}
  .ficha-hd h3{margin:0;font-size:16px;flex:1}
  .ficha-close{border:0;background:none;font-size:18px;cursor:pointer;color:var(--gr,#888)}
  .ficha-lbl{font-size:12px;font-weight:600;color:var(--gr,#777);margin:10px 0 4px;display:block}
  .ficha-txt{width:100%;min-height:150px;font:inherit;font-size:13px;padding:10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;resize:vertical}
  .ficha-cust-res{border:1px solid rgba(0,0,0,.1);border-radius:10px;max-height:170px;overflow:auto;margin-top:4px}
  .ficha-cust-res button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:none;cursor:pointer;font:inherit;font-size:13px}
  .ficha-cust-res button:hover{background:rgba(0,0,0,.05)}
  .ficha-inputs{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  .ficha-inputs input{flex:1;min-width:140px;padding:9px 10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;font:inherit;font-size:13px}
  .ficha-actions{display:flex;gap:10px;margin-top:14px}
  .ficha-actions button{flex:1;padding:11px;border:0;border-radius:10px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  .ficha-wa{background:#25D366;color:#fff}
  .ficha-mail{background:var(--dg,#16604A);color:#fff}
  .ficha-actions button:disabled{opacity:.45;cursor:not-allowed}
  .ficha-foot{margin-top:10px;font-size:12px;color:var(--gr,#888);min-height:16px}
  .ficha-chip{display:inline-block;background:rgba(22,96,74,.1);color:var(--dg,#16604A);border-radius:20px;padding:3px 10px;font-size:12px;margin-top:6px}`;
  document.head.appendChild(st);
}

async function fichaAbrir(ev, productId) {
  ev?.stopPropagation?.();
  fichaCSS();
  fichaCerrar();

  // Siempre traer la fila fresca: aquí sí necesitamos description e image_url
  const { data: p, error } = await sb.from('jjp_products')
    .select('id,name,description,price_usd,unit,emoji,image_url,jjp_product_variants(variant_name,price_usd,active,jjp_brands(name))')
    .eq('id', productId).single();
  if (error || !p) { sendToast('No se pudo cargar el producto', 'err'); return; }

  _fichaProd = p;
  _fichaCust = null;

  const ovl = document.createElement('div');
  ovl.className = 'ficha-ovl';
  ovl.id = 'fichaOvl';
  ovl.innerHTML = `
  <div class="ficha-box" role="dialog" aria-modal="true" aria-label="Enviar ficha de producto">
    <div class="ficha-hd">
      ${p.image_url
        ? `<img src="${encodeURI(p.image_url)}" alt="">`
        : `<span class="fi-emoji">${p.emoji || '📦'}</span>`}
      <h3>📤 Enviar ficha: ${escapeHTML(p.name)}</h3>
      <button class="ficha-close" aria-label="Cerrar">✕</button>
    </div>

    <label class="ficha-lbl" for="fichaMsg">Mensaje (puedes editarlo antes de enviar)</label>
    <textarea class="ficha-txt" id="fichaMsg"></textarea>

    <label class="ficha-lbl" for="fichaCustQ">Cliente</label>
    <input id="fichaCustQ" class="fi" style="width:100%;padding:9px 10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;font:inherit;font-size:13px"
           placeholder="Buscar por nombre, teléfono o correo…" autocomplete="off">
    <div class="ficha-cust-res" id="fichaCustRes" hidden></div>
    <div id="fichaCustChip"></div>
    <div class="ficha-inputs">
      <input id="fichaTel" placeholder="Teléfono (WhatsApp)" inputmode="tel">
      <input id="fichaMail" placeholder="Correo" inputmode="email">
    </div>

    <div class="ficha-actions">
      <button class="ficha-wa" id="fichaBtnWa">💬 WhatsApp</button>
      <button class="ficha-mail" id="fichaBtnMail">📧 Correo</button>
    </div>
    <div class="ficha-foot" id="fichaFoot">${p.image_url ? 'La foto del producto va adjunta al mensaje.' : 'Este producto no tiene foto: va solo el texto con el enlace.'}</div>
  </div>`;
  document.body.appendChild(ovl);

  document.getElementById('fichaMsg').value = fichaTextoDefault(p);

  ovl.addEventListener('click', e => { if (e.target === ovl) fichaCerrar(); });
  ovl.querySelector('.ficha-close').addEventListener('click', fichaCerrar);
  document.addEventListener('keydown', fichaEsc);

  let debounce;
  document.getElementById('fichaCustQ').addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => fichaBuscarCliente(e.target.value), 250);
  });
  document.getElementById('fichaBtnWa').addEventListener('click', () => fichaEnviar('wa'));
  document.getElementById('fichaBtnMail').addEventListener('click', () => fichaEnviar('mail'));

  // Aviso honesto del estado del servidor, igual que el hub de envío
  sendServerOnline().then(on => {
    const foot = document.getElementById('fichaFoot');
    if (foot && !on) foot.innerHTML = '🔴 Servidor apagado — el envío queda en cola y saldrá al encenderlo.';
  });
}

function fichaCerrar() {
  document.getElementById('fichaOvl')?.remove();
  document.removeEventListener('keydown', fichaEsc);
  _fichaProd = null;
  _fichaCust = null;
}
function fichaEsc(e) { if (e.key === 'Escape') fichaCerrar(); }

/* ---------------- Búsqueda de cliente (respeta RLS) ---------------- */
async function fichaBuscarCliente(q) {
  const box = document.getElementById('fichaCustRes');
  if (!box) return;
  q = String(q || '').trim();
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }

  const dig = q.replace(/\D/g, '');
  const ors = [`name.ilike.%${q}%`, `email.ilike.%${q}%`];
  if (dig.length >= 4) ors.push(`phone.ilike.%${dig}%`);
  const { data } = await sb.from('jjp_customers')
    .select('id,name,phone,email').or(ors.join(',')).limit(8);

  if (!data?.length) { box.hidden = false; box.innerHTML = '<button disabled>Sin resultados</button>'; return; }
  box.hidden = false;
  box.innerHTML = '';
  data.forEach(c => {
    const b = document.createElement('button');
    b.innerHTML = `<strong>${escapeHTML(c.name)}</strong> · ${escapeHTML(c.phone || 'sin tel')}${c.email ? ' · ' + escapeHTML(c.email) : ''}`;
    b.addEventListener('click', () => fichaElegirCliente(c));
    box.appendChild(b);
  });
}

function fichaElegirCliente(c) {
  _fichaCust = c;
  const box = document.getElementById('fichaCustRes');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  const q = document.getElementById('fichaCustQ');
  if (q) q.value = c.name;
  const chip = document.getElementById('fichaCustChip');
  if (chip) chip.innerHTML = `<span class="ficha-chip">👤 ${escapeHTML(c.name)} — quedará en su historial</span>`;
  const tel = document.getElementById('fichaTel');
  const mail = document.getElementById('fichaMail');
  if (tel && c.phone) tel.value = c.phone;
  if (mail && c.email) mail.value = c.email;
}

/* ---------------- Foto → blob ---------------- */
async function fichaFotoBlob(p) {
  if (!p.image_url) return null;
  try {
    const res = await fetch(encodeURI(p.image_url));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').split(';')[0];
    return { blob, mime, filename: `producto-${p.id}.${ext}` };
  } catch (e) {
    console.warn('foto del producto no descargó:', e.message);
    return null;   // sin foto no se pierde el envío: sale solo el texto
  }
}

/* ---------------- Correo: tarjeta HTML ---------------- */
function fichaHtmlCorreo(p) {
  const usd = fichaPrecio(p);
  const bs = (typeof toBs === 'function') ? toBs(usd) : null;
  const marcas = fichaMarcas(p);
  const link = fichaLink(p);
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e3e3e3;border-radius:12px;overflow:hidden">
  <div style="background:#16604A;color:#fff;padding:14px 18px;font-size:16px;font-weight:bold">JJ Paper</div>
  ${p.image_url ? `<img src="${encodeURI(p.image_url)}" alt="${escapeHTML(p.name)}" style="width:100%;max-height:320px;object-fit:contain;background:#f7f7f7;display:block">` : ''}
  <div style="padding:18px">
    <h2 style="margin:0 0 8px;font-size:18px;color:#003333">${escapeHTML(p.name)}</h2>
    ${p.description ? `<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.5">${escapeHTML(p.description)}</p>` : ''}
    <p style="margin:0 0 4px;font-size:16px;color:#16604A"><strong>${fmtPrice(usd)}</strong>${bs ? ` <span style="color:#888;font-size:13px">(Bs ${Number(bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })})</span>` : ''} <span style="color:#888;font-size:13px">por ${escapeHTML(p.unit || 'unidad')}</span></p>
    ${marcas.length ? `<p style="margin:0 0 14px;font-size:13px;color:#666">🏷️ Marcas: ${escapeHTML(marcas.join(', '))}</p>` : ''}
    <a href="${link}" style="display:inline-block;background:#99CC33;color:#003333;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px;font-size:14px">🛒 Comprar o cotizar</a>
    <p style="margin:14px 0 0;font-size:12px;color:#999">Si el botón no abre, copia este enlace:<br><a href="${link}" style="color:#16604A">${link}</a></p>
  </div>
</div>`;
}

/* ---------------- Enviar ---------------- */
async function fichaEnviar(via) {
  if (_fichaBusy || !_fichaProd) return;
  const p = _fichaProd;
  const texto = document.getElementById('fichaMsg')?.value?.trim() || fichaTextoDefault(p);
  const tel = document.getElementById('fichaTel')?.value?.trim();
  const mail = document.getElementById('fichaMail')?.value?.trim();
  const foot = document.getElementById('fichaFoot');

  if (via === 'wa' && !tel) { sendToast('Falta el teléfono del cliente', 'warn'); return; }
  if (via === 'mail' && !mail) { sendToast('Falta el correo del cliente', 'warn'); return; }

  _fichaBusy = true;
  if (foot) foot.textContent = '⏳ Preparando el envío…';

  try {
    if (via === 'wa') {
      const foto = await fichaFotoBlob(p);
      await sendPorWhatsApp({
        telefono: tel, nombre: _fichaCust?.name || null, texto,
        blob: foto?.blob || null, filename: foto?.filename,
        mime: foto?.mime, tipoMedia: 'image',
        customerId: _fichaCust?.id || null,
      });
    } else {
      await sendPorCorreo({
        email: mail,
        asunto: `${p.name} — JJ Paper`,
        cuerpo: texto.replace(/\*/g, ''),
        html: fichaHtmlCorreo(p),
        customerId: _fichaCust?.id || null,
      });
    }
    fichaCerrar();
    const on = await sendServerOnline();
    sendToast(on
      ? (via === 'wa' ? '📤 Ficha enviada por WhatsApp' : '📧 Ficha enviada por correo')
      : '📤 En cola: saldrá cuando enciendas el servidor', on ? 'ok' : 'warn');
  } catch (e) {
    console.error('envío de ficha falló:', e);
    sendToast('No se pudo enviar: ' + (e.message || e), 'err');
    if (foot) foot.textContent = e.message || 'Error';
  } finally {
    _fichaBusy = false;
  }
}
