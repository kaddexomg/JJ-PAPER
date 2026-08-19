/* ======================================================
   JJ Paper Vendedor — Catálogo con fotos
   ------------------------------------------------------
   Vista en tarjetas del catálogo para el vendedor: foto,
   nombre, descripción corta, código (SKU), marca y precio
   en $ y Bs con semáforo de existencias. Permite:

     · 💱 Editar precios  → cada tarjeta muestra su precio
       editable; los cambios se usan al generar el PDF.
     · 🖨️ Imprimir        → imprime la vista actual (con SKU).
     · 📤 Enviar          → modal de chequeo: busca/elige
       cliente, edita el mensaje y envía por WhatsApp o
       correo el PDF SIN costo ni SKU (versión cliente).
     · ⬇️ Descargar       → PDF interno (con SKU) para el
       negocio.

   Depende de: config.js, toast.js, doc-engine.js, send-hub.js,
   admin/auth.js, vcommon.js (SELLER).
   ====================================================== */

let VCAT = {
  products: [],       // productos cargados (precios personalizados aplicados)
  groups: [],         // grupos de catálogo
  categories: [],     // categorías
  q: '',              // texto de búsqueda
  grupo: 'all',       // filtro por grupo
  cat: 'all',         // filtro por categoría
  editing: false,     // modo edición de precios
  overrides: {},      // { 'p::<id>': precioUSD } — precios editados por el vendedor
  cliente: null,      // cliente elegido en el modal de envío
  busy: false,        // evita doble envío
};

/* ---------------- Carga de datos ---------------- */

async function vcCargar() {
  const [g, c, prods, sp] = await Promise.all([
    sb.from('jjp_category_groups').select('id,name,slug,sort_order').order('sort_order'),
    sb.from('jjp_categories').select('id,name,slug,group_id,sort_order').order('sort_order'),
    sb.from('jjp_products')
      .select('id,name,description,sku,price_usd,unit,emoji,image_url,stock,min_qty,category_id,' +
              'jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,stock,min_qty,active,image_url,jjp_brands(name))')
      .eq('active', true),
    (SELLER?.id
      ? sb.from('jjp_seller_prices').select('product_id,variant_id,price_usd').eq('seller_id', SELLER.id)
      : Promise.resolve({ data: [] })),
  ]);

  VCAT.groups = g.data || [];
  VCAT.categories = c.data || [];
  const products = prods.data || [];

  // Precios personalizados del vendedor (misma lógica que product-finder.js)
  const mapa = {};
  (sp.data || []).forEach(p => {
    const k = p.variant_id ? `v::${p.variant_id}` : `p::${p.product_id}`;
    mapa[k] = p.price_usd;
  });
  products.forEach(p => {
    if (mapa[`p::${p.id}`] !== undefined) p.price_usd = mapa[`p::${p.id}`];
    (p.jjp_product_variants || []).forEach(v => {
      if (mapa[`v::${v.id}`] !== undefined) v.price_usd = mapa[`v::${v.id}`];
    });
  });

  VCAT.products = products;
}

/* ---------------- Filtros ---------------- */

function vcNorm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function vcFiltered() {
  let list = VCAT.products.slice();
  if (VCAT.grupo !== 'all') {
    list = list.filter(p => {
      const cat = VCAT.categories.find(c => c.id === p.category_id);
      return cat && cat.group_id === VCAT.grupo;
    });
  }
  if (VCAT.cat !== 'all') {
    list = list.filter(p => p.category_id === VCAT.cat);
  }
  const q = vcNorm(VCAT.q);
  if (q) {
    list = list.filter(p => {
      const vs = p.jjp_product_variants || [];
      const hay = [p.name, p.sku, p.description,
        ...vs.map(v => v.sku), ...vs.map(v => v.barcode), ...vs.map(v => v.jjp_brands?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

/* ---------------- Precio efectivo y stock ---------------- */

// Precio a mostrar/editar del producto: si el vendedor lo editó aquí, ese;
// si no, el mínimo entre sus variantes (con precios personalizados aplicados).
function vcPrecio(p) {
  const key = 'p::' + p.id;
  if (VCAT.overrides[key] !== undefined) return VCAT.overrides[key];
  const vs = (p.jjp_product_variants || []).filter(v => v.active);
  const de = vs.map(v => +v.price_usd).filter(n => n > 0);
  return de.length ? Math.min(...de) : (+p.price_usd || 0);
}

function vcStock(p) {
  const vs = (p.jjp_product_variants || []).filter(v => v.active);
  const st = vs.length ? vs.map(v => +v.stock) : [+p.stock];
  const min = vs.length ? Math.min(...st) : (+p.stock || 0);
  if (!Number.isFinite(min) || min <= 0) return { cls: 'pf-out', txt: '✕ Agotado' };
  const minQty = Math.min(...vs.map(v => +v.min_qty || 0), +p.min_qty || 0);
  if (min <= (minQty || 3)) return { cls: 'pf-low', txt: '⚠ Pocas unidades' };
  return { cls: 'pf-ok', txt: '✔ Disponible' };
}

function vcBs(usd) {
  if (typeof sellerShowBs === 'function' && !sellerShowBs()) return '';
  const bs = (typeof toBs === 'function') ? toBs(usd) : null;
  return bs ? 'Bs ' + Number(bs).toLocaleString('es-VE', { maximumFractionDigits: 2 }) : '';
}

// Descripción corta para la tarjeta (no romper el diseño)
function vcCorta(txt, max) {
  const s = String(txt || '').replace(/\s+/g, ' ').trim();
  const n = max || 90;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* ---------------- Render ---------------- */

function vcRender() {
  const box = document.getElementById('vcGrid');
  if (!box) return;
  const list = vcFiltered();

  const count = document.getElementById('vcCount');
  if (count) count.textContent = list.length + ' producto' + (list.length === 1 ? '' : 's');

  if (!list.length) {
    box.innerHTML = '<div class="wa-empty">Sin productos con esos filtros.</div>';
    return;
  }

  document.body.classList.toggle('vc-editing', VCAT.editing);
  box.innerHTML = list.map(vcCardHTML).join('');
}

function vcCardHTML(p) {
  const vs = (p.jjp_product_variants || []).filter(v => v.active);
  const img = p.image_url || vs.find(v => v.image_url)?.image_url || '';
  const imgTag = img
    ? `<img src="${escapeHTML(img)}" alt="${escapeHTML(p.name)}" loading="lazy" class="vc-img">`
    : `<div class="vc-img vc-noimg"><span>${escapeHTML(p.emoji || '📦')}</span></div>`;

  const marcas = [...new Set(vs.map(v => v.jjp_brands?.name).filter(Boolean))];
  const sku = p.sku || vs[0]?.sku || '';
  const precio = vcPrecio(p);
  const st = vcStock(p);
  const hasOv = VCAT.overrides['p::' + p.id] !== undefined;
  const bs = vcBs(precio);

  return `
  <article class="vc-card">
    ${imgTag}
    <div class="vc-body">
      <div class="vc-titulo">${escapeHTML(p.name)}</div>
      ${sku ? `<div class="vc-sku">Cód: ${escapeHTML(sku)}</div>` : ''}
      ${marcas.length ? `<div class="vc-marca">🏷️ ${escapeHTML(marcas.join(', '))}</div>` : ''}
      ${p.description ? `<div class="vc-desc">${escapeHTML(vcCorta(p.description))}</div>` : ''}
    </div>
    <div class="vc-pie">
      <div class="vc-precio">
        <span class="vc-precio-num">${fmtPrice(precio)}</span>
        <input class="vc-price-input" type="number" step="0.01" min="0" value="${precio}"
               onchange="vcSetPrecio('${p.id}', this)" onfocus="this.select()" aria-label="Precio de ${escapeHTML(p.name)}">
        <button class="vc-reset${hasOv ? ' vc-has-ov' : ''}" type="button"
                onclick="vcResetPrecio('${p.id}')" title="Volver al precio del catálogo">↩️</button>
        <div class="vc-bs">${bs}</div>
      </div>
      <span class="vc-stock ${st.cls}">${st.txt}</span>
    </div>
  </article>`;
}

function vcSetPrecio(pid, el) {
  const key = 'p::' + pid;
  const val = parseFloat(el.value);
  if (isNaN(val) || val < 0) delete VCAT.overrides[key];
  else VCAT.overrides[key] = +val.toFixed(2);
  const p = VCAT.products.find(x => x.id === pid);
  const bsEl = el.closest('.vc-card')?.querySelector('.vc-bs');
  if (bsEl) bsEl.textContent = vcBs(vcPrecio(p || { id: pid, price_usd: 0, jjp_product_variants: [] }));
}

function vcResetPrecio(pid) {
  delete VCAT.overrides['p::' + pid];
  vcRender();
}

/* ---------------- Barra de herramientas ---------------- */

function vcSetSearch(v) { VCAT.q = v; vcRender(); }

function vcSetGrupo(v) {
  VCAT.grupo = v;
  VCAT.cat = 'all';
  const sel = document.getElementById('vcCat');
  if (sel) sel.value = 'all';
  vcRender();
}

function vcSetCat(v) { VCAT.cat = v; vcRender(); }

function vcToggleEdicion() {
  VCAT.editing = !VCAT.editing;
  const btn = document.getElementById('vcEditBtn');
  if (btn) {
    btn.classList.toggle('btn-p', VCAT.editing);
    btn.classList.toggle('btn-g', !VCAT.editing);
    btn.textContent = VCAT.editing ? '💱 Editando precios (click para salir)' : '💱 Editar precios';
  }
  const aviso = document.getElementById('vcEditWarn');
  if (aviso) aviso.style.display = VCAT.editing ? 'block' : 'none';
  vcRender();
}

/* ---------------- PDF: filas con precios vigentes ---------------- */

function vcFilasPdf() {
  return vcFiltered().map(p => {
    const vs = (p.jjp_product_variants || []).filter(v => v.active);
    const marcas = [...new Set(vs.map(v => v.jjp_brands?.name).filter(Boolean))];
    return {
      name: p.name,
      desc: p.description || '',
      sku: p.sku || vs[0]?.sku || '',
      img: p.image_url || vs.find(v => v.image_url)?.image_url || '',
      emoji: p.emoji,
      brand: marcas.join(' · '),
      usd: vcPrecio(p),
      unit: p.unit || 'unid',
    };
  });
}

async function vcDescargar() {
  const filas = vcFilasPdf();
  if (!filas.length) return showToast('No hay productos para descargar', 'warn');
  showToast('⏳ Generando PDF con fotos…', 'warn');
  try {
    const archivo = await docPdfCatalogoFotos({ filas, conSku: true, titulo: 'Catálogo interno', showBs: sellerShowBs() });
    docDescargar(archivo.blob, archivo.filename);
    showToast('⬇️ PDF descargado', 'ok');
  } catch (e) {
    console.error('PDF catálogo falló:', e);
    showToast('No se pudo generar el PDF: ' + (e.message || e), 'err');
  }
}

/* ---------------- Envío al cliente (chequeo) ---------------- */

function vcMsgDefault(n) {
  const base = `📗 *Catálogo JJ Paper*\n\nHola, te compartimos nuestro catálogo con los precios del día.\n\n*${n} producto${n === 1 ? '' : 's'}* · Precios en $${sellerShowBs() ? ' y Bs' : ''}.\n\nCualquier producto que necesites, escríbenos por aquí. 📄`;
  return typeof sellerSign === 'function' ? sellerSign(base) : base;
}

function vcCSS() {
  if (document.getElementById('jjp-vc-css')) return;
  const st = document.createElement('style');
  st.id = 'jjp-vc-css';
  st.textContent = `
  .vc-ovl{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:14px}
  .vc-box{background:var(--card,#fff);border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.3)}
  .vc-box h3{margin:0 0 4px;font-size:16px}
  .vc-box .sub{font-size:12.5px;color:var(--gr,#888);margin-bottom:12px}
  .vc-lbl{font-size:12px;font-weight:600;color:var(--gr,#777);margin:10px 0 4px;display:block}
  .vc-txt{width:100%;min-height:110px;font:inherit;font-size:13px;padding:10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;resize:vertical}
  .vc-cust-res{border:1px solid rgba(0,0,0,.1);border-radius:10px;max-height:170px;overflow:auto;margin-top:4px}
  .vc-cust-res button{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:none;cursor:pointer;font:inherit;font-size:13px}
  .vc-cust-res button:hover{background:rgba(0,0,0,.05)}
  .vc-inputs{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  .vc-inputs input{flex:1;min-width:140px;padding:9px 10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;font:inherit;font-size:13px}
  .vc-chip{display:inline-block;background:rgba(22,96,74,.1);color:var(--dg,#16604A);border-radius:20px;padding:3px 10px;font-size:12px;margin-top:6px}
  .vc-sum{margin-top:12px;background:#f0f4f2;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#333;line-height:1.5}
  .vc-sum b{color:var(--dg,#16604A)}
  .vc-actions{display:flex;gap:10px;margin-top:14px}
  .vc-actions button{flex:1;padding:11px;border:0;border-radius:10px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;color:#fff}
  .vc-wa{background:#25D366}
  .vc-mail{background:var(--dg,#16604A)}
  .vc-actions button:disabled{opacity:.45;cursor:not-allowed}
  .vc-foot{margin-top:10px;font-size:12px;color:var(--gr,#888);min-height:16px}
  .vc-close{border:0;background:none;font-size:18px;cursor:pointer;color:var(--gr,#888);float:right;line-height:1}`;
  document.head.appendChild(st);
}

function vcAbrirEnvio() {
  const filas = vcFilasPdf();
  if (!filas.length) return showToast('No hay productos en el catálogo para enviar', 'warn');

  vcCSS();
  vcCerrarEnvio();
  VCAT.cliente = null;

  const ovl = document.createElement('div');
  ovl.className = 'vc-ovl';
  ovl.id = 'vcOvl';
  ovl.innerHTML = `
  <div class="vc-box" role="dialog" aria-modal="true" aria-label="Enviar catálogo">
    <button class="vc-close" onclick="vcCerrarEnvio()" aria-label="Cerrar">✕</button>
    <h3>📤 Enviar catálogo al cliente</h3>
    <div class="sub">Chequea antes de enviar: destinatario, mensaje y resumen del PDF.</div>

    <label class="vc-lbl" for="vcCustQ">Cliente</label>
    <input id="vcCustQ" class="fi" style="width:100%;padding:9px 10px;border:1px solid rgba(0,0,0,.15);border-radius:10px;font:inherit;font-size:13px"
           placeholder="Buscar por nombre, teléfono o correo…" autocomplete="off">
    <div class="vc-cust-res" id="vcCustRes" hidden></div>
    <div id="vcCustChip"></div>
    <div class="vc-inputs">
      <input id="vcTel" placeholder="Teléfono (WhatsApp)" inputmode="tel">
      <input id="vcMail" placeholder="Correo" inputmode="email">
    </div>

    <label class="vc-lbl" for="vcMsg">Mensaje (puedes editarlo)</label>
    <textarea class="vc-txt" id="vcMsg">${escapeHTML(vcMsgDefault(filas.length))}</textarea>

    <div class="vc-sum">
      <b>📄 Resumen:</b> ${filas.length} producto${filas.length === 1 ? '' : 's'} con foto, nombre, descripción y precio en $ y Bs.<br>
      <b>🔒 Sin costo ni código interno.</b> El PDF se genera al momento con los precios que ves en el catálogo.
      ${VCAT.editing ? '<br>✏️ <b>Con precios editados</b> por ti en esta vista.' : ''}
    </div>

    <div class="vc-actions">
      <button class="vc-wa" id="vcBtnWa" onclick="vcEnviar('wa')">💬 WhatsApp</button>
      <button class="vc-mail" id="vcBtnMail" onclick="vcEnviar('mail')">📧 Correo</button>
    </div>
    <div class="vc-foot" id="vcFoot"></div>
  </div>`;
  document.body.appendChild(ovl);

  ovl.addEventListener('click', e => { if (e.target === ovl) vcCerrarEnvio(); });
  document.addEventListener('keydown', vcEsc);

  let debounce;
  document.getElementById('vcCustQ').addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => vcBuscarCliente(e.target.value), 250);
  });

  sendServerOnline().then(on => {
    const foot = document.getElementById('vcFoot');
    if (foot) foot.innerHTML = on
      ? '<span style="color:#2e8b57">🟢 Servidor encendido — saldrá de inmediato</span>'
      : '<span style="color:#b00">🔴 Servidor apagado — queda en cola y saldrá al encenderlo</span>';
  });
}

function vcCerrarEnvio() {
  document.getElementById('vcOvl')?.remove();
  document.removeEventListener('keydown', vcEsc);
  VCAT.cliente = null;
}
function vcEsc(e) { if (e.key === 'Escape') vcCerrarEnvio(); }

// Búsqueda de cliente respetando RLS (solo su cartera + libres)
async function vcBuscarCliente(q) {
  const box = document.getElementById('vcCustRes');
  if (!box) return;
  q = String(q || '').trim();
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }

  const dig = q.replace(/\D/g, '');
  const ors = [`name.ilike.%${q}%`, `email.ilike.%${q}%`];
  if (dig.length >= 4) ors.push(`phone.ilike.%${dig}%`);
  const { data } = await sb.from('jjp_customers')
    .select('id,name,phone,email').or(ors.join(',')).limit(8);

  if (!data?.length) { box.hidden = false; box.innerHTML = '<button disabled>Sin resultados — escribe teléfono o correo manualmente</button>'; return; }
  box.hidden = false;
  box.innerHTML = '';
  data.forEach(c => {
    const b = document.createElement('button');
    b.innerHTML = `<strong>${escapeHTML(c.name)}</strong> · ${escapeHTML(c.phone || 'sin tel')}${c.email ? ' · ' + escapeHTML(c.email) : ''}`;
    b.addEventListener('click', () => vcElegirCliente(c));
    box.appendChild(b);
  });
}

function vcElegirCliente(c) {
  VCAT.cliente = c;
  const box = document.getElementById('vcCustRes');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  const q = document.getElementById('vcCustQ');
  if (q) q.value = c.name;
  const chip = document.getElementById('vcCustChip');
  if (chip) chip.innerHTML = `<span class="vc-chip">👤 ${escapeHTML(c.name)} — el envío quedará en su historial</span>`;
  const tel = document.getElementById('vcTel');
  const mail = document.getElementById('vcMail');
  if (tel && c.phone) tel.value = c.phone;
  if (mail && c.email) mail.value = c.email;
}

async function vcEnviar(via) {
  if (VCAT.busy) return;
  const tel = document.getElementById('vcTel')?.value?.trim();
  const mail = document.getElementById('vcMail')?.value?.trim();
  const msg = document.getElementById('vcMsg')?.value?.trim() || vcMsgDefault(0);
  if (via === 'wa' && !tel) return showToast('Falta el teléfono del cliente', 'warn');
  if (via === 'mail' && !mail) return showToast('Falta el correo del cliente', 'warn');

  const filas = vcFilasPdf();
  if (!filas.length) return showToast('No hay productos en el catálogo para enviar', 'warn');

  VCAT.busy = true;
  const btnWa = document.getElementById('vcBtnWa');
  const btnMail = document.getElementById('vcBtnMail');
  if (btnWa) btnWa.disabled = true;
  if (btnMail) btnMail.disabled = true;
  const foot = document.getElementById('vcFoot');
  if (foot) foot.textContent = '⏳ Generando el PDF con fotos…';

  try {
    const archivo = await docPdfCatalogoFotos({ filas, conSku: false, titulo: 'Catálogo', showBs: sellerShowBs() });
    if (foot) foot.textContent = '⏳ Enviando…';

    if (via === 'wa') {
      await sendPorWhatsApp({
        telefono: tel, nombre: VCAT.cliente?.name || null,
        texto: msg, blob: archivo.blob, filename: archivo.filename,
        customerId: VCAT.cliente?.id || null,
      });
    } else {
      await sendPorCorreo({
        email: mail, asunto: 'Catálogo JJ Paper',
        cuerpo: msg.replace(/\*/g, ''),
        blob: archivo.blob, filename: archivo.filename,
        customerId: VCAT.cliente?.id || null,
      });
    }

    vcCerrarEnvio();
    const on = await sendServerOnline();
    showToast(on
      ? (via === 'wa' ? '📤 Catálogo enviado por WhatsApp' : '📧 Catálogo enviado por correo')
      : '📤 En cola: saldrá cuando enciendas el servidor', on ? 'ok' : 'warn');
  } catch (e) {
    console.error('envío de catálogo falló:', e);
    showToast('No se pudo enviar: ' + (e.message || e), 'err');
    if (foot) foot.textContent = e.message || 'Error';
  } finally {
    VCAT.busy = false;
    if (btnWa) btnWa.disabled = false;
    if (btnMail) btnMail.disabled = false;
  }
}

/* ---------------- Arranque ---------------- */

async function vcInit() {
  await loadSettings();
  await vcCargar();

  // Filtro de grupos → categorías dependientes
  const grupoSel = document.getElementById('vcGrupo');
  const catSel = document.getElementById('vcCat');
  if (grupoSel) {
    grupoSel.innerHTML = '<option value="all">Todos los grupos</option>' +
      VCAT.groups.map(g => `<option value="${escapeHTML(g.id)}">${escapeHTML(g.name)}</option>`).join('');
  }
  if (catSel) {
    catSel.innerHTML = '<option value="all">Todas las categorías</option>' +
      VCAT.categories.map(c => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('');
  }

  vcRender();
}