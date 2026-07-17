/* ======================================================
   JJ Paper Admin — Cuentas por Pagar (facturas de proveedores)
   Solo admin: los vendedores no tienen acceso (RLS lo bloquea en la BD).
   ====================================================== */

const INV_BUCKET = 'jjp-invoices';

let invList      = [];
let invSuppliers = [];
let editingInvId = null;
let payingInvId  = null;
let editingSupId = null;
let invFilters   = { status: 'abiertas', supplier: '', q: '' };

/* ------------------------------------------------------
   Fechas — SIEMPRE en hora de Caracas.
   El equipo puede tener otra zona horaria configurada; el negocio no.
   ------------------------------------------------------ */
function todayVE() {
  // 'en-CA' entrega YYYY-MM-DD, que es justo el formato de las columnas date
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
}

// Días desde hoy (Caracas) hasta la fecha dada. Negativo = ya venció.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const hoy = new Date(todayVE() + 'T00:00:00');
  const due = new Date(dateStr + 'T00:00:00');
  return Math.round((due - hoy) / 86400000);
}

// El lapso en palabras: es lo que el dueño necesita leer de un vistazo
function lapseText(days) {
  if (days === null) return '—';
  if (days < 0)  return `Vencida hace ${Math.abs(days)}d`;
  if (days === 0) return 'Vence HOY';
  if (days === 1) return 'Vence mañana';
  return `En ${days} días`;
}

// Semáforo: rojo vencida/hoy · naranja ≤3d · amarillo ≤7d · verde el resto
function urgencyClass(days) {
  if (days === null) return '';
  if (days <= 0) return 'fac-red';
  if (days <= 3) return 'fac-orange';
  if (days <= 7) return 'fac-yellow';
  return 'fac-green';
}

function invMoney(amount, currency) {
  const n = Number(amount || 0).toFixed(2);
  return currency === 'Bs' ? `Bs ${n}` : `$${n}`;
}

// Estado real de la factura (vencida es derivado, no una columna)
function invState(inv) {
  if (inv.status === 'pagada')  return 'pagada';
  if (inv.status === 'anulada') return 'anulada';
  return daysUntil(inv.due_date) < 0 ? 'vencida' : 'pendiente';
}

function invBalance(inv) {
  return Math.max(Number(inv.amount || 0) - Number(inv.amount_paid || 0), 0);
}

/* ------------------------------------------------------
   Carga
   ------------------------------------------------------ */
async function initInvoicesPage() {
  await Promise.all([loadSuppliers(), loadInvoices()]);
}

async function loadSuppliers() {
  const { data, error } = await sb.from('jjp_suppliers').select('*').order('name');
  if (error) { showToast('Error cargando proveedores: ' + error.message, 'err'); return; }
  invSuppliers = data || [];
  renderSupplierOptions();
}

async function loadInvoices() {
  const { data, error } = await sb.from('jjp_supplier_invoices')
    .select('*, jjp_suppliers(name)')
    .order('due_date', { ascending: true });
  if (error) { showToast('Error cargando facturas: ' + error.message, 'err'); return; }
  invList = data || [];
  renderInvKpis();
  renderInvTable();
}

function supName(inv) {
  return inv.jjp_suppliers?.name || inv.supplier_name || 'Sin proveedor';
}

/* ------------------------------------------------------
   KPIs
   ------------------------------------------------------ */
function renderInvKpis() {
  const abiertas = invList.filter(i => i.status === 'pendiente');
  // USD y Bs se muestran por separado a propósito: sumarlos daría un número falso
  const usd = abiertas.filter(i => i.currency === 'USD').reduce((s, i) => s + invBalance(i), 0);
  const bs  = abiertas.filter(i => i.currency === 'Bs').reduce((s, i) => s + invBalance(i), 0);
  const vencidas = abiertas.filter(i => daysUntil(i.due_date) < 0);
  const semana   = abiertas.filter(i => { const d = daysUntil(i.due_date); return d >= 0 && d <= 7; });

  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('kpiUsd',      `$${usd.toFixed(2)}`);
  set('kpiBs',       `Bs ${bs.toFixed(2)}`);
  set('kpiSemana',   semana.length);
  set('kpiVencidas', vencidas.length);
  set('kpiUsdSub',   `${abiertas.length} factura(s) abiertas`);

  const vc = document.getElementById('kpiVencidasCard');
  if (vc) vc.classList.toggle('fac-alert', vencidas.length > 0);
}

/* ------------------------------------------------------
   Tabla
   ------------------------------------------------------ */
function applyInvFilters() {
  invFilters.status   = document.getElementById('filtStatus')?.value || 'abiertas';
  invFilters.supplier = document.getElementById('filtSupplier')?.value || '';
  invFilters.q        = (document.getElementById('filtQ')?.value || '').trim();
  renderInvTable();
}

function filteredInvoices() {
  const q = normTxt(invFilters.q);
  return invList.filter(i => {
    const st = invState(i);
    if (invFilters.status === 'abiertas'  && i.status !== 'pendiente') return false;
    if (invFilters.status === 'vencidas'  && st !== 'vencida')  return false;
    if (invFilters.status === 'pagadas'   && st !== 'pagada')   return false;
    if (invFilters.status === 'anuladas'  && st !== 'anulada')  return false;
    if (invFilters.supplier && i.supplier_id !== invFilters.supplier) return false;
    if (q && !normTxt(`${supName(i)} ${i.invoice_number || ''} ${i.notes || ''}`).includes(q)) return false;
    return true;
  });
}

function renderInvTable() {
  const tbody = document.getElementById('invTableBody');
  const count = document.getElementById('invCount');
  if (!tbody) return;

  const rows = filteredInvoices();
  if (count) count.textContent = `${rows.length} factura(s)`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No hay facturas con este filtro</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(i => {
    const days  = daysUntil(i.due_date);
    const st    = invState(i);
    const cerrada = st === 'pagada' || st === 'anulada';
    const chip  = cerrada
      ? `<span class="fac-chip ${st === 'pagada' ? 'fac-green' : 'fac-mute'}">${st === 'pagada' ? '✅ Pagada' : '⛔ Anulada'}</span>`
      : `<span class="fac-chip ${urgencyClass(days)}">${escapeHTML(lapseText(days))}</span>`;
    const abono = Number(i.amount_paid) > 0 && st !== 'pagada'
      ? `<div class="fac-sub">Abonado ${invMoney(i.amount_paid, i.currency)}</div>` : '';

    return `<tr class="${st === 'vencida' ? 'fac-row-red' : ''}">
      <td>
        <strong>${escapeHTML(supName(i))}</strong>
        ${i.invoice_number ? `<div class="fac-sub">#${escapeHTML(i.invoice_number)}</div>` : ''}
      </td>
      <td>
        <strong>${invMoney(invBalance(i), i.currency)}</strong>
        ${abono}
      </td>
      <td>${fmtDate(i.due_date + 'T00:00:00')}</td>
      <td>${chip}</td>
      <td>${i.image_path
            ? `<button class="btn-ghost sm" onclick="viewInvPhoto('${i.id}')">🖼️ Ver</button>`
            : '<span class="fac-sub">—</span>'}</td>
      <td>
        <div class="td-actions">
          ${cerrada ? '' : `<button class="btn-p sm" onclick="openPayment('${i.id}')">💵 Abonar</button>`}
          <button class="btn-ghost sm" onclick="editInvoice('${i.id}')">✏️</button>
          <button class="btn-danger sm" onclick="deleteInvoice('${i.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ------------------------------------------------------
   Formulario de factura
   ------------------------------------------------------ */
function renderSupplierOptions() {
  const sel  = document.getElementById('f-inv-supplier');
  const filt = document.getElementById('filtSupplier');
  const opts = invSuppliers.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
  if (sel)  sel.innerHTML  = `<option value="">— Selecciona proveedor —</option>${opts}`;
  if (filt) {
    const cur = filt.value;
    filt.innerHTML = `<option value="">Todos los proveedores</option>${opts}`;
    filt.value = cur;
  }
}

function openNewInvoice() {
  editingInvId = null;
  document.getElementById('invFormTitle').textContent = 'Nueva Factura';
  document.getElementById('invForm')?.reset();
  document.getElementById('f-inv-issue').value = todayVE();
  document.getElementById('f-inv-terms').value = APP.SETTINGS?.invoice_default_terms || 30;
  document.getElementById('invPhotoPrev').style.display = 'none';
  recalcDue();
  showInvForm();
}

function showInvForm() {
  const p = document.getElementById('invFormPanel');
  p.style.display = 'block';
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelInvForm() {
  document.getElementById('invFormPanel').style.display = 'none';
  editingInvId = null;
}

// Al elegir proveedor se hereda su plazo habitual (menos escritura para el dueño)
function onSupplierPick() {
  const s = invSuppliers.find(x => x.id === document.getElementById('f-inv-supplier').value);
  if (s && !editingInvId) {
    document.getElementById('f-inv-terms').value = s.default_terms_days ?? 30;
    recalcDue();
  }
}

// emisión + plazo = vencimiento. El dueño piensa en "30 días", no en fechas.
function recalcDue() {
  const issue = document.getElementById('f-inv-issue')?.value;
  const terms = parseInt(document.getElementById('f-inv-terms')?.value, 10);
  const dueEl = document.getElementById('f-inv-due');
  if (!issue || !Number.isFinite(terms) || !dueEl) return;
  const d = new Date(issue + 'T00:00:00');
  d.setDate(d.getDate() + terms);
  dueEl.value = d.toLocaleDateString('en-CA');
  renderDueHint();
}

function renderDueHint() {
  const hint = document.getElementById('dueHint');
  const due  = document.getElementById('f-inv-due')?.value;
  if (!hint) return;
  if (!due) { hint.textContent = ''; return; }
  const days = daysUntil(due);
  hint.textContent = lapseText(days);
  hint.className = 'fac-chip ' + urgencyClass(days);
}

function editInvoice(id) {
  const i = invList.find(x => x.id === id);
  if (!i) return;
  editingInvId = id;
  document.getElementById('invFormTitle').textContent = 'Editar Factura';
  document.getElementById('f-inv-supplier').value = i.supplier_id || '';
  document.getElementById('f-inv-number').value   = i.invoice_number || '';
  document.getElementById('f-inv-issue').value    = i.issue_date;
  document.getElementById('f-inv-due').value      = i.due_date;
  document.getElementById('f-inv-terms').value    = i.terms_days ?? '';
  document.getElementById('f-inv-amount').value   = i.amount;
  document.getElementById('f-inv-currency').value = i.currency;
  document.getElementById('f-inv-notes').value    = i.notes || '';
  document.getElementById('f-inv-photo').value    = '';
  document.getElementById('invPhotoPrev').style.display = i.image_path ? 'block' : 'none';
  renderDueHint();
  showInvForm();
}

async function saveInvoice() {
  const supplier_id = document.getElementById('f-inv-supplier').value || null;
  const due_date    = document.getElementById('f-inv-due').value;
  const amount      = parseFloat(document.getElementById('f-inv-amount').value);

  if (!supplier_id) { showToast('Elige el proveedor', 'warn'); return; }
  if (!due_date)    { showToast('La fecha de vencimiento es obligatoria', 'warn'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { showToast('Monto inválido', 'warn'); return; }

  const btn = document.getElementById('btnSaveInv');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    const payload = {
      supplier_id,
      invoice_number: document.getElementById('f-inv-number').value.trim() || null,
      issue_date:     document.getElementById('f-inv-issue').value || todayVE(),
      due_date,
      terms_days:     parseInt(document.getElementById('f-inv-terms').value, 10) || null,
      amount,
      currency:       document.getElementById('f-inv-currency').value,
      notes:          document.getElementById('f-inv-notes').value.trim() || null,
    };

    const file = document.getElementById('f-inv-photo').files?.[0];
    if (file) payload.image_path = await uploadInvPhoto(file);

    let error;
    if (editingInvId) {
      ({ error } = await sb.from('jjp_supplier_invoices').update(payload).eq('id', editingInvId));
    } else {
      ({ error } = await sb.from('jjp_supplier_invoices').insert(payload));
    }
    if (error) throw new Error(error.message);

    showToast(editingInvId ? '✅ Factura actualizada' : '✅ Factura registrada');
    cancelInvForm();
    await loadInvoices();
  } catch (e) {
    // El índice único evita registrar dos veces la misma factura del proveedor
    const dup = /duplicate key|jjp_invoices_number_uq/i.test(e.message);
    showToast(dup ? 'Ese número de factura ya existe para este proveedor' : 'Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar Factura'; }
  }
}

async function deleteInvoice(id) {
  const i = invList.find(x => x.id === id);
  if (!i) return;
  if (!confirm(`¿Eliminar la factura ${i.invoice_number ? '#' + i.invoice_number : ''} de ${supName(i)}?\n\nSe borran también sus abonos y recordatorios. Esta acción no se puede deshacer.`)) return;
  const { error } = await sb.from('jjp_supplier_invoices').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Factura eliminada');
  await loadInvoices();
}

/* ------------------------------------------------------
   Foto de la factura
   ------------------------------------------------------ */
// Comprime pensando en LEGIBILIDAD del documento (no es una miniatura de
// producto): lado mayor 1800px y calidad alta, para que se lea el vencimiento.
async function compressInvoiceImage(file, maxSide = 1800) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const toBlob = (t, q) => new Promise(res => canvas.toBlob(res, t, q));
    let blob = await toBlob('image/webp', 0.9);
    if (blob?.type === 'image/webp') return { blob, ext: 'webp' };
    blob = await toBlob('image/jpeg', 0.92);
    if (blob) return { blob, ext: 'jpg' };
  } catch (e) {
    console.warn('compressInvoiceImage: se sube el original', e);
  }
  return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
}

async function uploadInvPhoto(file) {
  const { blob, ext } = await compressInvoiceImage(file);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(INV_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg', upsert: false,
  });
  if (error) throw new Error('No pude subir la foto: ' + error.message);
  return path;
}

// El bucket es privado: se pide una URL firmada temporal para poder verla
async function viewInvPhoto(id) {
  const i = invList.find(x => x.id === id);
  if (!i?.image_path) return;
  const { data, error } = await sb.storage.from(INV_BUCKET).createSignedUrl(i.image_path, 3600);
  if (error || !data?.signedUrl) { showToast('No pude abrir la foto: ' + (error?.message || ''), 'err'); return; }

  document.getElementById('lbImg').src = data.signedUrl;
  document.getElementById('lbCap').textContent = `${supName(i)} · ${i.invoice_number ? '#' + i.invoice_number : ''} · vence ${fmtDate(i.due_date + 'T00:00:00')}`;
  const lb = document.getElementById('invLightbox');
  lb.style.display = 'flex';
  lb.dataset.release = '1';
  invLbRelease = trapFocus(lb);
}

let invLbRelease = null;
function closeInvLightbox() {
  const lb = document.getElementById('invLightbox');
  if (lb) lb.style.display = 'none';
  document.getElementById('lbImg').src = '';
  if (invLbRelease) { invLbRelease(); invLbRelease = null; }
}

/* ------------------------------------------------------
   Abonos
   ------------------------------------------------------ */
function openPayment(id) {
  const i = invList.find(x => x.id === id);
  if (!i) return;
  payingInvId = id;
  const bal = invBalance(i);
  document.getElementById('payTitle').textContent = `Abonar a ${supName(i)}${i.invoice_number ? ' · #' + i.invoice_number : ''}`;
  document.getElementById('paySub').textContent   = `Saldo pendiente: ${invMoney(bal, i.currency)}`;
  document.getElementById('f-pay-amount').value   = bal.toFixed(2);
  document.getElementById('f-pay-method').value   = '';
  document.getElementById('f-pay-ref').value      = '';
  const m = document.getElementById('payModal');
  m.style.display = 'flex';
  payRelease = trapFocus(m);
}

let payRelease = null;
function closePayment() {
  const m = document.getElementById('payModal');
  if (m) m.style.display = 'none';
  payingInvId = null;
  if (payRelease) { payRelease(); payRelease = null; }
}

async function savePayment() {
  const i = invList.find(x => x.id === payingInvId);
  if (!i) return;
  const amount = parseFloat(document.getElementById('f-pay-amount').value);
  if (!Number.isFinite(amount) || amount <= 0) { showToast('Monto de abono inválido', 'warn'); return; }

  const btn = document.getElementById('btnSavePay');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const { error } = await sb.from('jjp_invoice_payments').insert({
      invoice_id: payingInvId,
      amount,
      method:     document.getElementById('f-pay-method').value.trim() || null,
      reference:  document.getElementById('f-pay-ref').value.trim() || null,
      created_by: session?.user?.id || null,
    });
    if (error) throw new Error(error.message);
    // El trigger de la BD recalcula lo abonado y cierra la factura si ya está cubierta
    showToast('✅ Abono registrado');
    closePayment();
    await loadInvoices();
  } catch (e) {
    showToast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Registrar abono'; }
  }
}

/* ------------------------------------------------------
   Proveedores
   ------------------------------------------------------ */
function openSuppliers() {
  editingSupId = null;
  renderSuppliersList();
  document.getElementById('f-sup-name').value  = '';
  document.getElementById('f-sup-phone').value = '';
  document.getElementById('f-sup-terms').value = 30;
  const m = document.getElementById('supModal');
  m.style.display = 'flex';
  supRelease = trapFocus(m);
}

let supRelease = null;
function closeSuppliers() {
  const m = document.getElementById('supModal');
  if (m) m.style.display = 'none';
  if (supRelease) { supRelease(); supRelease = null; }
}

function renderSuppliersList() {
  const el = document.getElementById('supList');
  if (!el) return;
  if (!invSuppliers.length) {
    el.innerHTML = '<p class="fac-sub" style="padding:8px">Aún no hay proveedores. Agrega el primero abajo.</p>';
    return;
  }
  el.innerHTML = invSuppliers.map(s => {
    const abiertas = invList.filter(i => i.supplier_id === s.id && i.status === 'pendiente').length;
    return `<div class="fac-sup-row">
      <div>
        <strong>${escapeHTML(s.name)}</strong>
        <div class="fac-sub">${s.phone ? escapeHTML(s.phone) + ' · ' : ''}plazo ${s.default_terms_days}d${abiertas ? ` · ${abiertas} abierta(s)` : ''}</div>
      </div>
      <div class="td-actions">
        <button class="btn-ghost sm" onclick="editSupplier('${s.id}')">✏️</button>
        <button class="btn-danger sm" onclick="deleteSupplier('${s.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function editSupplier(id) {
  const s = invSuppliers.find(x => x.id === id);
  if (!s) return;
  editingSupId = id;
  document.getElementById('f-sup-name').value  = s.name;
  document.getElementById('f-sup-phone').value = s.phone || '';
  document.getElementById('f-sup-terms').value = s.default_terms_days ?? 30;
  document.getElementById('btnSaveSup').textContent = '💾 Actualizar proveedor';
}

async function saveSupplier() {
  const name = document.getElementById('f-sup-name').value.trim();
  if (!name) { showToast('El nombre del proveedor es obligatorio', 'warn'); return; }
  const payload = {
    name,
    phone: document.getElementById('f-sup-phone').value.trim() || null,
    default_terms_days: parseInt(document.getElementById('f-sup-terms').value, 10) || 30,
  };

  let error;
  if (editingSupId) {
    ({ error } = await sb.from('jjp_suppliers').update(payload).eq('id', editingSupId));
  } else {
    ({ error } = await sb.from('jjp_suppliers').insert(payload));
  }
  if (error) {
    const dup = /duplicate key|jjp_suppliers_name_uq/i.test(error.message);
    showToast(dup ? 'Ya existe un proveedor con ese nombre' : 'Error: ' + error.message, 'err');
    return;
  }

  showToast(editingSupId ? '✅ Proveedor actualizado' : '✅ Proveedor agregado');
  editingSupId = null;
  document.getElementById('btnSaveSup').textContent = '＋ Agregar proveedor';
  document.getElementById('f-sup-name').value  = '';
  document.getElementById('f-sup-phone').value = '';
  document.getElementById('f-sup-terms').value = 30;
  await loadSuppliers();
  await loadInvoices();       // el nombre del proveedor se muestra en la tabla
  renderSuppliersList();
}

async function deleteSupplier(id) {
  const s = invSuppliers.find(x => x.id === id);
  if (!s) return;
  const conFacturas = invList.filter(i => i.supplier_id === id).length;
  const aviso = conFacturas
    ? `\n\n⚠️ Tiene ${conFacturas} factura(s). NO se borran: quedan guardadas a nombre de "${s.name}" pero sin proveedor vinculado.`
    : '';
  if (!confirm(`¿Eliminar el proveedor "${s.name}"?${aviso}`)) return;

  const { error } = await sb.from('jjp_suppliers').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'err'); return; }
  showToast('Proveedor eliminado');
  await loadSuppliers();
  await loadInvoices();
  renderSuppliersList();
}
