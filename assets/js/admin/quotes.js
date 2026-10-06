/* ======================================================
   JJ Paper Admin — Quotes Management
   ====================================================== */

let adminQuotes  = [];
let quoteSellers = [];
let quotePage    = 1;
const QUOTES_PER = 20;
let quotesSellerFilter = '';
let currentQuotesStatusFilter = '';

async function loadQuotes(statusFilter = currentQuotesStatusFilter) {
  currentQuotesStatusFilter = statusFilter;
  let query = sb.from('jjp_quotes')
    .select('id,quote_number,client_name,phone,rif,email,city,estimated_total_usd,discount_pct,status,source,created_at,customer_id,seller_id,items,notes,jjp_profiles(name)')
    .order('created_at', { ascending: false });
  if (statusFilter) query = query.eq('status', statusFilter);
  const [{ data, error }, sellersRes] = await Promise.all([
    query,
    quoteSellers.length ? Promise.resolve({ data: quoteSellers })
      : sb.from('jjp_profiles').select('id,name,role').eq('active', true).order('name')
  ]);
  if (error) { showToast('Error cargando cotizaciones', 'err'); return; }
  adminQuotes  = data || [];
  quoteSellers = sellersRes.data || [];
  updateQuotesSellerOptions();
  quotePage = 1;
  renderQuotesTable();
}

function updateQuotesSellerOptions() {
  const sel = document.getElementById('quotesSellerSelect');
  if (!sel) return;
  const currentVal = sel.value || quotesSellerFilter;
  let html = `<option value="">🧑‍💼 Todos los vendedores</option>
<option value="bddc57dc-5bf9-4a72-9e1c-751d07b03164">⭐ Keyder Salazar (Mis Cotizaciones)</option>
<option value="mostrador">🏪 Mostrador / Sin asignar</option>`;
  (quoteSellers || []).forEach(s => {
    if (s.id === 'bddc57dc-5bf9-4a72-9e1c-751d07b03164') return;
    html += `<option value="${s.id}">${escapeHTML(s.name || 'Vendedor')}</option>`;
  });
  sel.innerHTML = html;
  if (currentVal) sel.value = currentVal;
}

function onQuotesSellerChange(val) {
  quotesSellerFilter = val || '';
  quotePage = 1;
  renderQuotesTable();
}

function quoteItemsOf(q) {
  const items = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);
  return Array.isArray(items) ? items : [];
}

// Nombre del producto tolerante: el chatbot guarda `product`, el vendedor/POS `name`.
function qItemName(i) { return i.name || i.product || '—'; }

// Total estimado: usa estimated_total_usd o lo calcula de los items con precio
function quoteEstTotal(q) {
  if (q.estimated_total_usd) return Number(q.estimated_total_usd);
  return quoteItemsOf(q).reduce((s, i) => s + (i.price_usd ? i.price_usd * i.qty : 0), 0);
}

function renderQuotesTable() {
  const tbody = document.getElementById('quotesTableBody');
  const count = document.getElementById('quotesCount');
  if (!tbody) return;

  let filtered = adminQuotes;
  if (quotesSellerFilter === 'mostrador') {
    filtered = filtered.filter(q => !q.seller_id);
  } else if (quotesSellerFilter) {
    filtered = filtered.filter(q => q.seller_id === quotesSellerFilter);
  }

  if (count) count.textContent = `${filtered.length}${quotesSellerFilter ? ' de ' + adminQuotes.length : ''} cotizaciones`;

  const start = (quotePage - 1) * QUOTES_PER;
  const page  = filtered.slice(start, start + QUOTES_PER);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${quotesSellerFilter ? 'No se encontraron cotizaciones para el filtro de vendedor seleccionado' : 'No hay cotizaciones'}</td></tr>`;
    renderQuotesPag(filtered.length);
    return;
  }

  tbody.innerHTML = page.map(q => {
    const items = quoteItemsOf(q);
    const itemsPreview = items.slice(0,2).map(i => `${escapeHTML(qItemName(i))} x${i.qty}`).join(', ')
      + (items.length > 2 ? '…' : '');
    const est = quoteEstTotal(q);
    return `<tr>
      <td><strong>${escapeHTML(q.quote_number || '—')}</strong>
        ${q.source === 'chat' ? '<div class="td-sub">🤖 vía chat</div>' : ''}</td>
      <td>
        <div class="td-name">${escapeHTML(q.client_name)}</div>
        <div class="td-sub">${escapeHTML(q.city || '')}</div>
      </td>
      <td>
        <div>${escapeHTML(q.phone || '—')}</div>
        <div class="td-sub">${q.jjp_profiles?.name ? `🧑‍💼 ${escapeHTML(q.jjp_profiles.name)}` : '<span style="color:#94a3b8">🏪 Sin asignar</span>'}</div>
      </td>
      <td style="max-width:170px;font-size:11px;color:var(--gr)">${itemsPreview}</td>
      <td>${est > 0 ? `<strong>${fmtPrice(est)}</strong>` : '<span style="color:#bbb">—</span>'}</td>
      <td>${fmtDate(q.created_at)}</td>
      <td>
        <select class="sort-sel" style="min-width:120px;padding:6px 10px;font-size:12px"
          onchange="updateQuoteStatus('${q.id}',this.value)">
          ${['pendiente','contactado','confirmado','confirmado_mixnet','convertido','cancelado'].map(s =>
            `<option value="${s}" ${q.status===s?'selected':''}>${s === 'confirmado_mixnet' ? '✅ Confirmar → MixNet' : s.charAt(0).toUpperCase()+s.slice(1)}</option>`
          ).join('')}
        </select>
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-p sm" onclick="viewQuoteDetail('${q.id}')" title="Ver detalle">👁️</button>
          <a class="btn-o sm" href="cotizador.html?edit=${q.id}" title="Editar cotización">✏️</a>
          <a class="btn-o sm" href="pos.html?quote=${encodeURIComponent(q.quote_number || q.id)}" title="Cargar y facturar en POS">💰</a>
          <button class="btn-send sm" onclick="sendMenuAbrir(event, quoteCtx('${q.id}'))"
                  title="Enviar la cotización al cliente" aria-haspopup="menu">📤</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderQuotesPag();
}

function renderQuotesPag() {
  const el    = document.getElementById('quotesPag');
  const total = adminQuotes.length;
  const pages = Math.ceil(total / QUOTES_PER);
  if (!el || pages <= 1) { if(el) el.innerHTML=''; return; }
  let html = '';
  if (quotePage > 1) html += `<button class="pg arrow" onclick="quotesGoPage(${quotePage-1})">‹</button>`;
  for (let i=1; i<=pages; i++)
    html += `<button class="pg${i===quotePage?' on':''}" onclick="quotesGoPage(${i})">${i}</button>`;
  if (quotePage < pages) html += `<button class="pg arrow" onclick="quotesGoPage(${quotePage+1})">›</button>`;
  el.innerHTML = html;
}

function quotesGoPage(p) { quotePage = p; renderQuotesTable(); }

async function updateQuoteStatus(id, status) {
  if (status === 'confirmado_mixnet') {
    if (!confirm('¿Confirmar esta cotización para enviarla a MixNet?\n\nSe le asignará el número correlativo real de MixNet.')) {
      renderQuotesTable();
      return;
    }
  }
  const { error } = await sb.from('jjp_quotes').update({ status }).eq('id', id);
  if (error) { showToast('Error al actualizar estado'); renderQuotesTable(); return; }
  const q = adminQuotes.find(x => x.id === id);
  if (q) q.status = status;
  showToast(status === 'confirmado_mixnet' ? '✅ Cotización confirmada · se enviará a MixNet' : `Estado → ${status}`);
  renderQuotesTable();
}

// Pre-factura por WhatsApp con precios y totales en USD + Bs
function buildPrefacturaMsg(q) {
  const items = quoteItemsOf(q);
  const rate  = getRate();
  let total = 0, pending = 0;
  let msg = `📃 *PRE-FACTURA JJ PAPER*\n*Cotización:* ${q.quote_number || ''}\n*Cliente:* ${q.client_name}\n\n*Detalle:*\n`;
  items.forEach((i, idx) => {
    if (i.price_usd) {
      const sub = i.price_usd * i.qty;
      total += sub;
      msg += `${idx+1}. ${qItemName(i)} x${i.qty}${i.unit ? ' ' + i.unit : ''} — $${sub.toFixed(2)}\n`;
    } else {
      pending++;
      msg += `${idx+1}. ${qItemName(i)} x${i.qty}${i.unit ? ' ' + i.unit : ''} — (precio por confirmar)\n`;
    }
  });
  if (total > 0) {
    msg += `\n💰 *Total: $${total.toFixed(2)}*`;
    msg += `\n💴 *En bolívares: ${fmtBsNum(total * rate)}* (tasa BCV ${rate.toFixed(2)})`;
  }
  if (pending) msg += `\n\n⚠️ ${pending} producto(s) con precio por confirmar.`;
  msg += `\n\nPara confirmar su pedido responda este mensaje o complete el pago en nuestra web. ¡Gracias por preferirnos! 💚`;
  return msg;
}

/* Convertir cotización en pedido.
   Lo hace la base de datos (jjp_convert_quote): así el pedido conserva la
   presentación de cada línea (variant_id) y el stock puede descontarse de
   verdad. Antes esta copia y la del vendedor armaban el pedido por su
   cuenta, perdían la variante y aplicaban reglas de descuento distintas. */
async function convertQuoteToOrder(id) {
  const q = adminQuotes.find(x => x.id === id);
  if (!q) return;
  if (['convertido', 'convertida'].includes(q.status)) {
    showToast('Esta cotización ya fue convertida en pedido', 'warn');
    return;
  }
  const discNote = Number(q.discount_pct) > 0
    ? `\n\nIncluye ${q.discount_pct}% de descuento propuesto — al convertir queda APROBADO.` : '';
  if (!confirm(`¿Crear un pedido a partir de la cotización ${q.quote_number}?${discNote}`)) return;

  const realOrderNumber = (typeof fetchNextDocSerial === 'function')
    ? await fetchNextDocSerial('pedido')
    : null;

  const { data, error } = await sb.rpc('jjp_convert_quote', { p_quote: id });
  if (error) { console.error(error); showToast('No se pudo convertir: ' + error.message, 'err'); return; }
  const order = Array.isArray(data) ? data[0] : data;

  if (order && order.id && realOrderNumber) {
    await sb.from('jjp_orders').update({ order_number: realOrderNumber }).eq('id', order.id);
    order.order_number = realOrderNumber;
  }

  q.status = 'convertido';
  renderQuotesTable();
  closeQuoteDetail();
  showToast(`✅ Pedido #${order?.order_number || ''} creado desde la cotización`);
}

function viewQuoteDetail(id) {
  const q = adminQuotes.find(x => x.id === id);
  if (!q) return;
  const items = quoteItemsOf(q);
  const modal = document.getElementById('quoteDetailModal');
  const body  = document.getElementById('quoteDetailBody');
  if (!modal || !body) return;

  const rate = getRate();
  const est  = quoteEstTotal(q);
  const allPriced = items.length && items.every(i => i.price_usd);

  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div><label class="fl">N° Cotización</label><p>${escapeHTML(q.quote_number || '—')} ${q.source === 'chat' ? ' <span class="badge badge-blue">🤖 chat</span>' : ''}</p></div>
      <div><label class="fl">Fecha</label><p>${fmtDate(q.created_at)}</p></div>
      <div><label class="fl">Cliente</label><p><strong>${escapeHTML(q.client_name)}</strong></p></div>
      <div><label class="fl">RIF/CI</label><p id="qModalRif"><strong>${escapeHTML(q.rif || '—')}</strong></p></div>
      <div><label class="fl">Domicilio Fiscal</label><p id="qModalAddr">${escapeHTML(q.address || '—')}</p></div>
      <div><label class="fl">Ciudad</label><p id="qModalCity">${escapeHTML(q.city || '—')}</p></div>
      <div><label class="fl">Teléfono</label><p id="qModalPhone">${escapeHTML(q.phone || '—')}</p></div>
      <div><label class="fl">Email</label><p id="qModalEmail">${escapeHTML(q.email || '—')}</p></div>
      <div style="grid-column: span 2">
        <label class="fl">Vendedor Asignado</label>
        <select class="sort-sel" style="width:100%;max-width:320px;padding:6px 10px;font-size:12px;margin-top:4px" onchange="assignQuoteSeller('${q.id}', this.value)">
          <option value="">— Sin vendedor asignado —</option>
          ${quoteSellers.map(s => `<option value="${s.id}" ${q.seller_id === s.id ? 'selected' : ''}>${s.role === 'admin' ? '👑 ' : '🧑‍💼 '}${escapeHTML(s.name)}${s.role === 'admin' ? ' (Admin)' : ''}</option>`).join('')}
        </select>
      </div>
    </div>
    <label class="fl">Productos solicitados</label>
    <table class="admin-table" style="margin-top:8px">
      <thead><tr><th>#</th><th>Producto</th><th>Cant.</th><th>Unidad</th><th style="text-align:right">Precio est.</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>
        ${items.map((i, idx) => `<tr>
          <td>${i.line || idx + 1}</td>
          <td>${escapeHTML(qItemName(i))}</td>
          <td>${i.qty}</td>
          <td>${escapeHTML(i.unit || '—')}</td>
          <td style="text-align:right">${i.price_usd ? fmtPrice(i.price_usd) : '<span style="color:#bbb">por confirmar</span>'}</td>
          <td style="text-align:right">${i.price_usd ? `<strong>${fmtPrice(i.price_usd * i.qty)}</strong>` : '—'}</td>
        </tr>`).join('')}
      </tbody>
      ${est > 0 ? `<tfoot>
        <tr><td colspan="5" style="text-align:right;font-weight:700">Total estimado</td>
            <td style="text-align:right"><strong>${fmtPrice(est)}</strong></td></tr>
        <tr><td colspan="5" style="text-align:right;color:var(--gm);font-weight:700">En bolívares (tasa ${rate.toFixed(2)})</td>
            <td style="text-align:right;color:var(--gm)"><strong>${fmtBsNum(est * rate)}</strong></td></tr>
      </tfoot>` : ''}
    </table>
    ${q.notes ? `<div style="margin-top:16px"><label class="fl">Observaciones</label><p style="font-size:13px;color:#555">${escapeHTML(q.notes)}</p></div>` : ''}
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn-wa" style="width:auto;padding:12px 20px"
        href="https://wa.me/${(q.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent(buildPrefacturaMsg(q))}"
        target="_blank">📃 Enviar pre-factura por WhatsApp</a>
      <a class="btn-o" style="width:auto;padding:12px 20px;text-decoration:none" target="_blank"
        href="../comprobante.html?q=${encodeURIComponent(q.quote_number || '')}&print=1">🖨️ Imprimir presupuesto</a>
      ${sendBotonHTML(`quoteCtx('${q.id}')`)}
      <a class="btn-o" style="width:auto;padding:12px 20px;text-decoration:none" 
href="cotizador.html?edit=${q.id}">✏️ Editar Cotización</a>
      <a class="btn-p" style="width:auto;padding:12px 20px;text-decoration:none;font-weight:700" 
href="pos.html?quote=${encodeURIComponent(q.quote_number || q.id)}">📋 Pasar a Pedido</a>
      <button class="btn-o" onclick="convertQuoteToOrder('${q.id}')" ${allPriced ? '' : 'disabled title="Todos los productos necesitan precio"'}
        style="${allPriced ? '' : 'opacity:.5;cursor:not-allowed'}">🛒 Convertir en pedido</button>
    </div>`;

  modal.classList.add('op');

  // Resolver domicilio fiscal real y datos del cliente si faltan en la cotización
  (async () => {
    try {
      let cust = null;
      if (q.customer_id) {
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email').eq('id', q.customer_id).maybeSingle();
        if (data) cust = data;
      }
      if ((!cust || !cust.address) && q.rif) {
        const rawRif = String(q.rif).trim();
        const cleanRif = rawRif.replace(/[^a-zA-Z0-9]/g, '');
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email')
          .or(`rif.eq."${rawRif}",rif.eq."${cleanRif}"`)
          .limit(1);
        if (data?.[0]) cust = cust ? { ...data[0], ...cust, address: data[0].address || cust.address } : data[0];
      }
      if ((!cust || !cust.address) && q.client_name) {
        const qName = q.client_name.trim().slice(0, 18);
        const { data } = await sb.from('jjp_customers').select('name,rif,address,city,phone,email')
          .ilike('name', `%${qName}%`)
          .limit(1);
        if (data?.[0]) cust = cust ? { ...data[0], ...cust, address: data[0].address || cust.address } : data[0];
      }
      if (cust) {
        const addrEl  = document.getElementById('qModalAddr');
        const cityEl  = document.getElementById('qModalCity');
        const rifEl   = document.getElementById('qModalRif');
        const phoneEl = document.getElementById('qModalPhone');
        const emailEl = document.getElementById('qModalEmail');
        if (addrEl && cust.address && (!q.address || q.address === '—')) addrEl.textContent = cust.address;
        if (cityEl && cust.city && (!q.city || q.city === '—')) cityEl.textContent = cust.city;
        if (rifEl && cust.rif && (!q.rif || q.rif === '—')) rifEl.innerHTML = `<strong>${escapeHTML(cust.rif)}</strong>`;
        if (phoneEl && cust.phone && (!q.phone || q.phone === '—')) phoneEl.textContent = cust.phone;
        if (emailEl && cust.email && (!q.email || q.email === '—')) emailEl.textContent = cust.email;
      }
    } catch (_) {}
  })();
}

function closeQuoteDetail() {
  document.getElementById('quoteDetailModal')?.classList.remove('op');
}

async function assignQuoteSeller(id, sellerId) {
  const { error } = await sb.from('jjp_quotes')
    .update({ seller_id: sellerId || null })
    .eq('id', id);
  if (error) { showToast('No se pudo asignar el vendedor a la cotización', 'err'); return; }
  const q = adminQuotes.find(x => x.id === id);
  if (q) q.seller_id = sellerId || null;
  showToast(sellerId ? 'Vendedor asignado a la cotización ✔' : 'Cotización sin vendedor asignado');
}

/* Contexto para el hub de envío: la cotización se manda en PDF, no como
   texto suelto. El presupuesto viaja con la misma forma que un pedido. */
function quoteCtx(id) {
  const q = adminQuotes.find(x => x.id === id) || {};
  const items = quoteItemsOf(q);
  return {
    nombre: q.client_name, telefono: q.phone, email: q.email,
    customerId: q.customer_id || null,
    quote: {
      order_number: q.quote_number, client_name: q.client_name, rif: q.rif,
      phone: q.phone, email: q.email, city: q.city, address: q.address,
      items, subtotal_usd: items.reduce((s, i) => s + (i.price_usd || 0) * i.qty, 0),
      total_usd: quoteEstTotal(q), discount_pct: q.discount_pct,
      discount_status: Number(q.discount_pct) > 0 ? 'approved' : 'none',
      exchange_rate: q.exchange_rate, notes: q.notes,
      status: q.status, created_at: q.created_at,
    },
    docs: ['cotizacion', 'catalogo', 'lista'],
  };
}

// Dashboard stats
async function loadDashboardStats() {
  const [{ count: totalProds }, { count: totalQuotes }, { count: pendingQuotes }] =
    await Promise.all([
      sb.from('jjp_products').select('id', { count:'exact', head:true }),
      sb.from('jjp_quotes').select('id',   { count:'exact', head:true }),
      sb.from('jjp_quotes').select('id',   { count:'exact', head:true }).eq('status','pendiente'),
    ]);

  setText('stat-products', totalProds ?? 0);
  setText('stat-quotes',   totalQuotes ?? 0);
  setText('stat-pending',  pendingQuotes ?? 0);

  // Recent quotes
  const { data: recent } = await sb.from('jjp_quotes')
    .select('quote_number,client_name,phone,status,created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  const tbody = document.getElementById('recentQuotesBody');
  if (tbody && recent) {
    tbody.innerHTML = recent.map(q => `<tr>
      <td><strong>${q.quote_number||'—'}</strong></td>
      <td>${q.client_name}</td>
      <td>${q.phone}</td>
      <td><span class="status-badge status-${q.status}">${q.status}</span></td>
      <td>${fmtDate(q.created_at)}</td>
    </tr>`).join('');
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
