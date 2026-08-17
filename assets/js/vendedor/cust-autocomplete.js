/* ======================================================
   JJ Paper Vendedor — Autocompletado de cliente
   Enlazado al campo "Nombre / empresa" del POS y del
   cotizador: al escribir muestra abajo los clientes que
   coinciden (por nombre o teléfono) y al elegir uno
   rellena los demás campos vía el callback de cada página.
   ====================================================== */

let custAc = { timer: null, results: {}, sel: -1 };

function custAcBind(opts) {
  const input = document.getElementById(opts.nameId);
  const box   = document.getElementById(opts.boxId);
  if (!input || !box) return;
  custAc.handlers = custAc.handlers || {};
  custAc.handlers[opts.boxId] = opts.onPick;

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    custAcSearch(opts.nameId, opts.boxId, opts);
    if (opts.onChange) opts.onChange();
  });
  input.addEventListener('keydown', e => custAcKey(e, opts));
  input.addEventListener('blur', () => setTimeout(() => custAcHide(opts.boxId), 150));
  document.addEventListener('mousedown', e => {
    if (e.target !== input && !box.contains(e.target)) custAcHide(opts.boxId);
  });
}

async function custAcSearch(nameId, boxId, opts) {
  const input = document.getElementById(nameId);
  const box   = document.getElementById(boxId);
  const q     = input.value.trim();
  if (q.length < ((opts && opts.minLen) || 2)) { custAcHide(boxId); return; }
  clearTimeout(custAc.timer);
  custAc.timer = setTimeout(async () => {
    const digits = q.replace(/\D/g, '');
    const or = (digits && digits.length >= 3)
      ? `name.ilike.%${q}%,phone.ilike.%${digits}%`
      : `name.ilike.%${q}%`;
    const { data, error } = await sb.from('jjp_customers')
      .select('id,name,phone,rif,city,total_orders,total_usd')
      .or(or)
      .limit((opts && opts.limit) || 6);
    if (error) { console.error('autocompletado cliente:', error); custAcHide(boxId); return; }
    custAc.results[boxId] = data || [];
    custAc.sel = -1;
    if (!(data || []).length) {
      box.innerHTML = '<p style="font-size:12px;color:var(--gr);margin:8px 0">Cliente nuevo — completa sus datos manualmente.</p>';
      box.style.display = 'block';
      return;
    }
    box.innerHTML = data.map((c, i) => `
      <div class="pos-result cust-ac-item" data-i="${i}"
           onmouseover="custAcHover('${boxId}',${i})"
           onmousedown="custAcPick('${boxId}',${i})">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escapeHTML(c.name)}</div>
          <div style="font-size:11px;color:var(--gr)">${escapeHTML(c.phone || '')}${c.city ? ' · ' + escapeHTML(c.city) : ''}</div>
        </div>
        <span class="btn-o sm">Elegir</span>
      </div>`).join('');
    box.style.display = 'block';
  }, 250);
}

function custAcHover(boxId, i) {
  custAc.sel = i;
  const box = document.getElementById(boxId);
  box.querySelectorAll('.cust-ac-item').forEach(el =>
    el.classList.toggle('on', Number(el.dataset.i) === i));
}

function custAcPick(boxId, i) {
  const c = (custAc.results[boxId] || [])[i];
  custAcHide(boxId);
  if (c && custAc.handlers && custAc.handlers[boxId]) custAc.handlers[boxId](c);
}

function custAcKey(e, opts) {
  if (e.key === 'Escape') { custAcHide(opts.boxId); return; }
  const items = document.getElementById(opts.boxId).querySelectorAll('.cust-ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    custAc.sel = Math.min(custAc.sel + 1, items.length - 1);
    custAcHover(opts.boxId, custAc.sel);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    custAc.sel = Math.max(custAc.sel - 1, 0);
    custAcHover(opts.boxId, custAc.sel);
  } else if (e.key === 'Enter' && custAc.sel >= 0) {
    e.preventDefault();
    custAcPick(opts.boxId, custAc.sel);
  }
}

function custAcHide(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = '';
  box.style.display = 'none';
}