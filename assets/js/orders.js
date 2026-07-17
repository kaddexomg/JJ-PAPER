/* ======================================================
   JJ Paper — Cotizaciones al mayor (formulario web)
   - Autocompletado de productos del catálogo (datalist)
   - Precio estimado por línea y total en vivo
   - Registro vía RPC (devuelve N° de cotización) + WhatsApp
   ====================================================== */

let quoteProducts = [];   // catálogo para autocompletar/estimar

async function initQuoteForm() {
  const { data } = await sb.from('jjp_products')
    .select('id,name,price_usd,unit,min_qty')
    .eq('active', true)
    .order('name');
  quoteProducts = data || [];

  // Datalist para autocompletar en todas las líneas
  const dl = document.createElement('datalist');
  dl.id = 'prodList';
  dl.innerHTML = quoteProducts.map(p => `<option value="${escapeHTML(p.name)}"></option>`).join('');
  document.body.appendChild(dl);

  document.querySelectorAll('#orderItems .oi-prod').forEach(wireQuoteLine);

  // Prellenado desde el catálogo: pedidos.html?prod=<nombre>&qty=<cant>
  const qs      = new URLSearchParams(location.search);
  const preName = qs.get('prod');
  if (preName) {
    const first = document.querySelector('#orderItems .oi-prod');
    if (first && !first.value) {
      first.value = preName;
      const row = first.closest('.oi-row');
      const qty = parseInt(qs.get('qty'), 10);
      if (row && qty > 0) row.querySelector('.oi-qty').value = qty;
      const p = findQuoteProduct(preName);
      if (p && row) {
        const un = row.querySelector('.oi-un');
        if (un && !un.value) un.value = p.unit || '';
      }
      first.scrollIntoView({ behavior:'smooth', block:'center' });
      showToast(`${preName} agregado a tu cotización`);
    }
  }

  updateQuoteEstimate();
}

function findQuoteProduct(name) {
  const n = normTxt(name);
  if (!n) return null;
  return quoteProducts.find(p => normTxt(p.name) === n)
      || quoteProducts.find(p => normTxt(p.name).includes(n) && n.length >= 4)
      || null;
}

// Conecta una línea del formulario: autocompleta unidad y estima precio
function wireQuoteLine(input) {
  input.setAttribute('list', 'prodList');
  input.addEventListener('input', () => {
    const row = input.closest('.oi-row');
    const p   = findQuoteProduct(input.value);
    if (p && row) {
      const un = row.querySelector('.oi-un');
      if (un && !un.value) un.value = p.unit || '';
      const qy = row.querySelector('.oi-qty');
      if (qy && p.min_qty > 1 && (+qy.value || 1) < p.min_qty) qy.value = p.min_qty;
    }
    updateQuoteEstimate();
  });
  const row = input.closest('.oi-row');
  row?.querySelector('.oi-qty')?.addEventListener('input', updateQuoteEstimate);
}

// Calcula el estimado por línea y el total (solo productos del catálogo)
function updateQuoteEstimate() {
  let total = 0, matched = 0, lines = 0;
  document.querySelectorAll('#orderItems .oi-row').forEach(row => {
    const name = row.querySelector('.oi-prod')?.value.trim();
    const qty  = parseFloat(row.querySelector('.oi-qty')?.value) || 1;
    const est  = row.querySelector('.oi-est');
    if (!name) { if (est) est.textContent = ''; return; }
    lines++;
    const p = findQuoteProduct(name);
    if (p) {
      matched++;
      const sub = p.price_usd * qty;
      total += sub;
      if (est) { est.textContent = fmtPrice(sub); est.title = `${fmtPrice(p.price_usd)} c/u`; }
    } else if (est) {
      est.textContent = '—';
      est.title = 'Precio a confirmar por un asesor';
    }
  });

  const box = document.getElementById('quoteEstimate');
  if (box) {
    if (total > 0) {
      box.style.display = 'flex';
      box.innerHTML = `<span>Total estimado (${matched} de ${lines} con precio)</span>
        <b>${fmtPrice(total)} · ${fmtBs(total)}</b>`;
    } else {
      box.style.display = 'none';
    }
  }
  return total;
}

function addOrderItem() {
  const row = document.createElement('div');
  row.className = 'oi-row';
  row.innerHTML = `
    <input type="text"   class="fi oi-prod" placeholder="Producto / descripción">
    <input type="number" class="fi oi-qty"  placeholder="Cant." min="1" value="1">
    <input type="text"   class="fi oi-un"   placeholder="Unid.">
    <span  class="oi-est" title="Estimado"></span>
    <button class="btn-del-i" onclick="removeOrderItem(this)">✕</button>`;
  document.getElementById('orderItems')?.appendChild(row);
  wireQuoteLine(row.querySelector('.oi-prod'));
}

function removeOrderItem(btn) {
  const rows = document.querySelectorAll('#orderItems .oi-row');
  if (rows.length <= 1) { showToast('Debe haber al menos una línea', 'warn'); return; }
  btn.closest('.oi-row')?.remove();
  updateQuoteEstimate();
}

// Recolecta las líneas con datos de catálogo si hay match
function collectQuoteItems() {
  const items = [];
  document.querySelectorAll('#orderItems .oi-row').forEach(r => {
    const prod = r.querySelector('.oi-prod')?.value.trim();
    const qty  = parseFloat(r.querySelector('.oi-qty')?.value) || 1;
    const un   = r.querySelector('.oi-un')?.value.trim() || '';
    if (!prod) return;
    const p = findQuoteProduct(prod);
    items.push({
      product: prod, qty, unit: un || p?.unit || '',
      product_id: p?.id || null,
      price_usd: p?.price_usd ?? null,
    });
  });
  return items;
}

async function sendOrder() {
  const name  = document.getElementById('o-name')?.value.trim();
  const tel   = document.getElementById('o-tel')?.value.trim();

  if (!name) { showToast('Ingresa tu nombre o empresa', 'warn'); return; }
  if (!tel)  { showToast('Ingresa tu teléfono',         'warn'); return; }
  const telDigits = tel.replace(/\D/g, '');
  if (!/^(0?4\d{9}|584\d{9}|0?2\d{9})$/.test(telDigits)) {
    showToast('Revisa el teléfono (ej: 0412-1234567)', 'warn'); return;
  }

  const rif   = document.getElementById('o-rif')?.value.trim()   || null;
  const city  = document.getElementById('o-city')?.value.trim()  || null;
  const email = document.getElementById('o-email')?.value.trim() || null;
  const notes = document.getElementById('o-notes')?.value.trim() || null;

  const items = collectQuoteItems();
  if (!items.length) { showToast('Agrega al menos un producto', 'warn'); return; }

  const btn = document.querySelector('.f-sub');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  const est = items.reduce((s, i) => s + (i.price_usd ? i.price_usd * i.qty : 0), 0);
  const { data, error } = await sb.rpc('jjp_create_quote', {
    p_client_name: name, p_phone: tel, p_items: items,
    p_rif: rif, p_city: city, p_email: email, p_notes: notes,
    p_source: 'web',
    p_estimated_total_usd: est > 0 ? +est.toFixed(2) : null,
  });

  if (btn) { btn.disabled = false; btn.textContent = '📲 Enviar Cotización por WhatsApp'; }

  if (error || !data?.quote_number) {
    console.warn('quote rpc error:', error);
    showToast('No se pudo registrar. Se enviará solo por WhatsApp.', 'warn');
  }
  const quoteNumber = data?.quote_number || null;

  // Guardar en este navegador para el rastreo rápido
  if (quoteNumber) {
    try {
      const mine = JSON.parse(localStorage.getItem('jjp_my_quotes') || '[]');
      mine.unshift({ n: quoteNumber, tel, at: Date.now() });
      localStorage.setItem('jjp_my_quotes', JSON.stringify(mine.slice(0, 10)));
    } catch (e) {}
  }

  // Mensaje de WhatsApp (pre-factura al mayor)
  const date = new Date().toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
  let msg = `📋 *SOLICITUD DE COTIZACIÓN AL MAYOR*\n_JJ Paper · ${date}_\n`;
  if (quoteNumber) msg += `*N°:* ${quoteNumber}\n`;
  msg += `\n*Cliente:* ${name}\n`;
  if (rif)   msg += `*RIF/CI:* ${rif}\n`;
  msg += `*Teléfono:* ${tel}\n`;
  if (city)  msg += `*Ciudad:* ${city}\n`;
  if (email) msg += `*Email:* ${email}\n`;
  msg += `\n*Productos solicitados:*\n`;
  items.forEach((it, i) => {
    msg += `   ${i + 1}. ${it.product} — ${it.qty}${it.unit ? ' ' + it.unit : ''}`;
    if (it.price_usd) msg += ` (≈${fmtPrice(it.price_usd * it.qty)})`;
    msg += `\n`;
  });
  if (est > 0) msg += `\n💰 *Estimado: ${fmtPrice(est)}* (${fmtBs(est)})`;
  if (notes) msg += `\n📝 *Observaciones:* ${notes}`;
  msg += `\n\n_Enviado desde JJPaper.com.ve_`;

  showQuoteSuccess(quoteNumber, items.length, est, msg);
  openWA(msg);
}

// Panel de éxito con el número y enlace de rastreo
function showQuoteSuccess(quoteNumber, nItems, est, waMsg) {
  const box = document.getElementById('quoteSuccess');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = `
    <div class="qs-ico">✅</div>
    <h3>¡Cotización ${quoteNumber ? 'registrada' : 'enviada'}!</h3>
    ${quoteNumber ? `<p class="qs-num">N° <strong>${escapeHTML(quoteNumber)}</strong></p>` : ''}
    <p class="qs-msg">${nItems} producto${nItems !== 1 ? 's' : ''} solicitado${nItems !== 1 ? 's' : ''}${est > 0 ? ` · Estimado <b>${fmtPrice(est)}</b>` : ''}.<br>
    Un asesor te enviará la <strong>pre-factura al mayor</strong> a la brevedad.</p>
    <div class="qs-acts">
      ${quoteNumber ? `<a class="btn-o" href="rastreo.html?c=${encodeURIComponent(quoteNumber)}">🔎 Rastrear cotización</a>` : ''}
      <button class="btn-wa" style="width:auto" onclick='openWA(${JSON.stringify(waMsg)})'>💬 Reenviar por WhatsApp</button>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Pre-fill order form from cart items
function fillOrderFromCart() {
  const items = Object.values(cart);
  if (!items.length) return;
  const container = document.getElementById('orderItems');
  if (!container) return;
  container.innerHTML = '';
  items.forEach(i => {
    const row = document.createElement('div');
    row.className = 'oi-row';
    row.innerHTML = `
      <input type="text"   class="fi oi-prod">
      <input type="number" class="fi oi-qty" min="1">
      <input type="text"   class="fi oi-un">
      <span  class="oi-est" title="Estimado"></span>
      <button class="btn-del-i" onclick="removeOrderItem(this)">✕</button>`;
    // Asignar por .value evita que nombres con comillas rompan el HTML
    row.querySelector('.oi-prod').value = i.name;
    row.querySelector('.oi-qty').value  = i.qty;
    row.querySelector('.oi-un').value   = i.unit || '';
    container.appendChild(row);
    wireQuoteLine(row.querySelector('.oi-prod'));
  });
  updateQuoteEstimate();
}
