/* ====================================================================
   JJ Paper — Ficha y Historial 360° del Cliente (Compras & Cotizaciones)
   Compatible con Admin y Vendedor. Consulta RPC jjp_customer_360.
   ==================================================================== */

let currentChData = null;
let currentChTab = 'orders';

function ensureCustomerHistoryModal() {
  if (document.getElementById('customerHistoryModal')) return;

  const modalHtml = `
  <div class="modal-overlay" id="customerHistoryModal" onclick="if(event.target===this)closeCustomerHistoryModal()">
    <div class="modal-box" style="max-width:880px;width:95%;max-height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.2)">
      <!-- Encabezado Ficha -->
      <div class="modal-hd" style="border-bottom:1px solid #e2e8f0;padding:16px 20px;background:#fff;display:flex;justify-content:space-between;align-items:flex-start">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="background:#e6f4ea;color:#137333;width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:24px">🏢</div>
          <div>
            <h3 id="chCustName" style="margin:0;font-size:18px;font-weight:700;color:#1a202c">Ficha del Cliente</h3>
            <div id="chCustMeta" style="font-size:12.5px;color:#718096;margin-top:3px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">—</div>
          </div>
        </div>
        <button class="modal-close" onclick="closeCustomerHistoryModal()" style="font-size:20px;background:none;border:none;cursor:pointer;color:#a0aec0">✕</button>
      </div>

      <!-- Barra de KPIs -->
      <div id="chKpiGrid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:10px;padding:12px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
        <!-- Inyectado dinámicamente -->
      </div>

      <!-- Pestañas de navegación -->
      <div style="display:flex;gap:4px;padding:0 20px;background:#fff;border-bottom:1px solid #e2e8f0">
        <button class="ch-tab-btn active" id="chTabBtnOrders" onclick="switchChTab('orders')" style="padding:11px 18px;border:none;border-bottom:3px solid #16604A;background:none;font-weight:700;color:#16604A;cursor:pointer;font-size:13px">
          🛒 Pedidos & Compras (<span id="chCountOrders">0</span>)
        </button>
        <button class="ch-tab-btn" id="chTabBtnQuotes" onclick="switchChTab('quotes')" style="padding:11px 18px;border:none;border-bottom:3px solid transparent;background:none;font-weight:600;color:#718096;cursor:pointer;font-size:13px">
          📋 Cotizaciones (<span id="chCountQuotes">0</span>)
        </button>
        <button class="ch-tab-btn" id="chTabBtnInfo" onclick="switchChTab('info')" style="padding:11px 18px;border:none;border-bottom:3px solid transparent;background:none;font-weight:600;color:#718096;cursor:pointer;font-size:13px">
          📝 Ficha & Contacto
        </button>
      </div>

      <!-- Cuerpo / Tablas -->
      <div class="modal-body" style="padding:18px 20px;overflow-y:auto;flex:1;background:#fff">
        <div id="chTabOrders"></div>
        <div id="chTabQuotes" style="display:none"></div>
        <div id="chTabInfo" style="display:none"></div>
      </div>

      <!-- Acciones rápidas en Pie -->
      <div class="modal-ft" style="border-top:1px solid #e2e8f0;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;background:#f8fafc">
        <div id="chActionsLeft" style="display:flex;gap:8px;flex-wrap:wrap"></div>
        <button class="btn-o" onclick="closeCustomerHistoryModal()">Cerrar</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function openCustomerHistory(customerId) {
  if (!customerId) return;
  ensureCustomerHistoryModal();
  const modal = document.getElementById('customerHistoryModal');
  modal.classList.add('op');

  // Estado de carga
  document.getElementById('chCustName').textContent = 'Cargando cliente…';
  document.getElementById('chCustMeta').innerHTML = '⏳ Obteniendo historial de compras y cotizaciones…';
  document.getElementById('chKpiGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#666;padding:10px">Consultando base de datos…</div>';
  document.getElementById('chTabOrders').innerHTML = '<div style="text-align:center;padding:30px;color:#777">Cargando pedidos…</div>';
  document.getElementById('chTabQuotes').innerHTML = '<div style="text-align:center;padding:30px;color:#777">Cargando cotizaciones…</div>';
  document.getElementById('chTabInfo').innerHTML = '';
  document.getElementById('chActionsLeft').innerHTML = '';

  try {
    const { data, error } = await sb.rpc('jjp_customer_360', { p_customer: customerId });
    if (error || !data || !data.cliente) {
      document.getElementById('chCustName').textContent = 'Error al cargar ficha';
      document.getElementById('chCustMeta').textContent = error?.message || 'No se encontró el registro del cliente.';
      return;
    }

    currentChData = data;
    renderCustomer360View(data);
  } catch (err) {
    console.error('Error in openCustomerHistory:', err);
    showToast?.('Error al obtener historial del cliente', 'err');
  }
}

function closeCustomerHistoryModal() {
  document.getElementById('customerHistoryModal')?.classList.remove('op');
}

function switchChTab(tab) {
  currentChTab = tab;
  ['orders', 'quotes', 'info'].forEach(t => {
    const btn = document.getElementById('chTabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    const pane = document.getElementById('chTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.style.borderBottomColor = (t === tab) ? '#16604A' : 'transparent';
      btn.style.color = (t === tab) ? '#16604A' : '#718096';
      btn.style.fontWeight = (t === tab) ? '700' : '600';
    }
    if (pane) {
      pane.style.display = (t === tab) ? 'block' : 'none';
    }
  });
}

function renderCustomer360View(data) {
  const c = data.cliente || {};
  const orders = data.pedidos || [];
  const quotes = data.cotizaciones || [];
  const kpis = data.kpis || {};

  // 1. Título y Subtítulo
  document.getElementById('chCustName').textContent = c.name || 'Cliente sin nombre';

  const zoneBadge = c.zone
    ? `<span style="background:#0d9488;color:#fff;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">Zona ${escapeHTML(c.zone)}</span>`
    : '<span style="background:#e2e8f0;color:#64748b;padding:2px 7px;border-radius:4px;font-size:11px">Sin Zona</span>';

  const sellerBadge = c.seller_name
    ? `<span style="background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600">👤 Asesor: ${escapeHTML(c.seller_name)}</span>`
    : '<span style="background:#f1f5f9;color:#94a3b8;padding:2px 7px;border-radius:4px;font-size:11px">🆓 Sin Vendedor</span>';

  const rifTxt = c.rif ? `<span><strong>RIF:</strong> ${escapeHTML(c.rif)}</span>` : '';
  const phoneTxt = c.phone ? `<span><strong>Tel:</strong> ${escapeHTML(c.phone)}</span>` : '';
  const cityTxt = c.city ? `<span>📍 ${escapeHTML(c.city)}</span>` : '';

  document.getElementById('chCustMeta').innerHTML = [zoneBadge, sellerBadge, rifTxt, phoneTxt, cityTxt].filter(Boolean).join(' · ');

  // 2. Conteo en pestañas
  document.getElementById('chCountOrders').textContent = orders.length;
  document.getElementById('chCountQuotes').textContent = quotes.length;

  // 3. Tarjetas de KPIs
  const totalSpentUsd = Number(kpis.total_spent_usd || c.total_usd || 0);
  const rate = (typeof getRate === 'function') ? getRate() : 40;
  const totalSpentBs = totalSpentUsd * rate;
  const lastOrderDate = kpis.last_order_at || c.last_order_at;

  const fmtDateShort = d => {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return String(d).slice(0, 10); }
  };

  const timeAgoTxt = d => {
    if (!d) return 'Sin compras previas';
    const ms = Date.now() - new Date(d).getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    if (days < 30) return `Hace ${days} días`;
    const months = Math.floor(days / 30);
    return `Hace ${months} mes${months > 1 ? 'es' : ''}`;
  };

  document.getElementById('chKpiGrid').innerHTML = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Total Histórico</div>
      <div style="font-size:18px;font-weight:800;color:#16604A;margin-top:2px">${fmtPrice(totalSpentUsd)}</div>
      <div style="font-size:11px;color:#94a3b8">Bs ${totalSpentBs.toLocaleString('es-VE', { maximumFractionDigits: 2 })}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Pedidos Registrados</div>
      <div style="font-size:18px;font-weight:800;color:#1e293b;margin-top:2px">${orders.length}</div>
      <div style="font-size:11px;color:#94a3b8">MixNet Caja + Web POS</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Cotizaciones</div>
      <div style="font-size:18px;font-weight:800;color:#0369a1;margin-top:2px">${quotes.length}</div>
      <div style="font-size:11px;color:#94a3b8">Historial de presupuestos</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700">Última Operación</div>
      <div style="font-size:15px;font-weight:700;color:#334155;margin-top:4px">${fmtDateShort(lastOrderDate)}</div>
      <div style="font-size:11px;color:#0d9488;font-weight:600">${timeAgoTxt(lastOrderDate)}</div>
    </div>
  `;

  // 4. Render Pestaña Pedidos
  if (!orders.length) {
    document.getElementById('chTabOrders').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#94a3b8">
        <div style="font-size:36px;margin-bottom:8px">🛒</div>
        <p style="font-size:14px;margin:0">Este cliente aún no registra pedidos de compra.</p>
        <p style="font-size:12px;color:#cbd5e1;margin-top:4px">Crea su primera venta con el botón POS abajo.</p>
      </div>`;
  } else {
    const rows = orders.map((o, idx) => {
      const isMix = (o.order_number || '').startsWith('MIX-');
      const originBadge = isMix
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">MixNet Caja</span>'
        : '<span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">Web POS</span>';

      let stColor = '#059669', stBg = '#ecfdf5', stLabel = 'Completado';
      if (o.status === 'pendiente_pago') { stColor = '#d97706'; stBg = '#fffbeb'; stLabel = 'Pendiente Pago'; }
      else if (o.status === 'cancelado') { stColor = '#dc2626'; stBg = '#fef2f2'; stLabel = 'Cancelado'; }

      const itemsArr = Array.isArray(o.items) ? o.items : [];
      const rowId = `chOrderDet_${o.id || idx}`;

      let itemsTable = '';
      if (itemsArr.length > 0) {
        itemsTable = `
          <tr id="${rowId}" style="display:none;background:#f8fafc">
            <td colspan="6" style="padding:10px 16px;border-bottom:1px solid #e2e8f0">
              <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">RENGLONES DEL PEDIDO (${itemsArr.length} artículos):</div>
              <table style="width:100%;font-size:11.5px;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
                <thead>
                  <tr style="background:#f1f5f9;color:#475569;text-align:left">
                    <th style="padding:5px 8px;width:100px">SKU</th>
                    <th style="padding:5px 8px">Producto</th>
                    <th style="padding:5px 8px;text-align:center;width:60px">Cant</th>
                    <th style="padding:5px 8px;text-align:right;width:80px">Precio</th>
                    <th style="padding:5px 8px;text-align:right;width:90px">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsArr.map(it => `
                    <tr style="border-bottom:1px solid #f1f5f9">
                      <td style="padding:4px 8px;font-family:monospace;color:#64748b">${escapeHTML(it.sku || '—')}</td>
                      <td style="padding:4px 8px;font-weight:600;color:#1e293b">${escapeHTML(it.name || 'Artículo')}</td>
                      <td style="padding:4px 8px;text-align:center;font-weight:700">${it.qty || 1}</td>
                      <td style="padding:4px 8px;text-align:right">${fmtPrice(it.price_usd || 0)}</td>
                      <td style="padding:4px 8px;text-align:right;font-weight:700;color:#16604A">${fmtPrice(it.subtotal_usd ?? ((it.qty || 1) * (it.price_usd || 0)))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${o.notes ? `<div style="font-size:11px;color:#64748b;margin-top:6px"><em>Nota: ${escapeHTML(o.notes)}</em></div>` : ''}
            </td>
          </tr>`;
      }

      return `
        <tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:10px 8px">
            <strong style="font-family:monospace;color:#1e293b;font-size:13px">${escapeHTML(o.order_number || '—')}</strong>
            <div style="margin-top:2px">${originBadge}</div>
          </td>
          <td style="padding:10px 8px;font-size:12px;color:#64748b">${fmtDateShort(o.created_at)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#334155">${escapeHTML(o.seller_name || 'JJ Paper')}</td>
          <td style="padding:10px 8px;text-align:right">
            <div style="font-weight:700;color:#16604A;font-size:13.5px">${fmtPrice(o.total_usd || 0)}</div>
            ${Number(o.total_bs) > 0 ? `<div style="font-size:10.5px;color:#94a3b8">Bs ${Number(o.total_bs).toLocaleString('es-VE', { maximumFractionDigits: 2 })}</div>` : ''}
          </td>
          <td style="padding:10px 8px;text-align:center">
            <span style="background:${stBg};color:${stColor};padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700">${stLabel}</span>
          </td>
          <td style="padding:10px 8px;text-align:right">
            ${itemsArr.length > 0 ? `<button class="btn-o sm" onclick="toggleChDetail('${rowId}', this)" style="font-size:11px;padding:3px 8px">👁️ ${itemsArr.length} ítems</button>` : '<span style="color:#cbd5e1;font-size:11px">Sin renglones</span>'}
          </td>
        </tr>
        ${itemsTable}
      `;
    }).join('');

    document.getElementById('chTabOrders').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead>
          <tr style="background:#f8fafc;color:#475569;text-align:left;border-bottom:2px solid #e2e8f0">
            <th style="padding:8px">N° Orden</th>
            <th style="padding:8px">Fecha</th>
            <th style="padding:8px">Vendedor</th>
            <th style="padding:8px;text-align:right">Total</th>
            <th style="padding:8px;text-align:center">Estado</th>
            <th style="padding:8px;text-align:right">Detalle</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // 5. Render Pestaña Cotizaciones
  if (!quotes.length) {
    document.getElementById('chTabQuotes').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#94a3b8">
        <div style="font-size:36px;margin-bottom:8px">📋</div>
        <p style="font-size:14px;margin:0">No hay cotizaciones registradas para este cliente.</p>
        <p style="font-size:12px;color:#cbd5e1;margin-top:4px">Puedes preparar una con el botón "Nueva Cotización".</p>
      </div>`;
  } else {
    const qRows = quotes.map((q, idx) => {
      const isMix = (q.quote_number || '').startsWith('MIX-COT-');
      const originBadge = isMix
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">MixNet Cot</span>'
        : '<span style="background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">Web Cot</span>';

      const itemsArr = Array.isArray(q.items) ? q.items : [];
      const rowId = `chQuoteDet_${q.id || idx}`;

      let itemsTable = '';
      if (itemsArr.length > 0) {
        itemsTable = `
          <tr id="${rowId}" style="display:none;background:#f8fafc">
            <td colspan="5" style="padding:10px 16px;border-bottom:1px solid #e2e8f0">
              <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">ARTÍCULOS COTIZADOS (${itemsArr.length}):</div>
              <table style="width:100%;font-size:11.5px;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
                <thead>
                  <tr style="background:#f1f5f9;color:#475569;text-align:left">
                    <th style="padding:5px 8px;width:100px">SKU</th>
                    <th style="padding:5px 8px">Producto</th>
                    <th style="padding:5px 8px;text-align:center;width:60px">Cant</th>
                    <th style="padding:5px 8px;text-align:right;width:90px">Precio Unit</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsArr.map(it => `
                    <tr style="border-bottom:1px solid #f1f5f9">
                      <td style="padding:4px 8px;font-family:monospace;color:#64748b">${escapeHTML(it.sku || '—')}</td>
                      <td style="padding:4px 8px;font-weight:600;color:#1e293b">${escapeHTML(it.name || 'Artículo')}</td>
                      <td style="padding:4px 8px;text-align:center;font-weight:700">${it.qty || 1}</td>
                      <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtPrice(it.price_usd || it.price || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${q.notes ? `<div style="font-size:11px;color:#64748b;margin-top:6px"><em>Nota: ${escapeHTML(q.notes)}</em></div>` : ''}
            </td>
          </tr>`;
      }

      return `
        <tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:10px 8px">
            <strong style="font-family:monospace;color:#1e293b;font-size:13px">${escapeHTML(q.quote_number || '—')}</strong>
            <div style="margin-top:2px">${originBadge}</div>
          </td>
          <td style="padding:10px 8px;font-size:12px;color:#64748b">${fmtDateShort(q.created_at)}</td>
          <td style="padding:10px 8px;font-size:12px;color:#334155">${escapeHTML(q.seller_name || 'JJ Paper')}</td>
          <td style="padding:10px 8px;text-align:right;font-weight:700;color:#0369a1;font-size:13.5px">
            ${fmtPrice(q.total_usd || 0)}
          </td>
          <td style="padding:10px 8px;text-align:right">
            ${itemsArr.length > 0 ? `<button class="btn-o sm" onclick="toggleChDetail('${rowId}', this)" style="font-size:11px;padding:3px 8px">👁️ ${itemsArr.length} ítems</button>` : '<span style="color:#cbd5e1;font-size:11px">Sin renglones</span>'}
          </td>
        </tr>
        ${itemsTable}
      `;
    }).join('');

    document.getElementById('chTabQuotes').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead>
          <tr style="background:#f8fafc;color:#475569;text-align:left;border-bottom:2px solid #e2e8f0">
            <th style="padding:8px">N° Cotización</th>
            <th style="padding:8px">Fecha</th>
            <th style="padding:8px">Vendedor</th>
            <th style="padding:8px;text-align:right">Monto Estimado</th>
            <th style="padding:8px;text-align:right">Detalle</th>
          </tr>
        </thead>
        <tbody>${qRows}</tbody>
      </table>
    `;
  }

  // 6. Render Pestaña Ficha & Contacto
  document.getElementById('chTabInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:13px">
      <div style="background:#f8fafc;padding:12px 14px;border-radius:8px;border:1px solid #e2e8f0">
        <strong style="color:#475569;display:block;margin-bottom:6px">Datos Fiscales y Ubicación</strong>
        <div><strong>Razón Social:</strong> ${escapeHTML(c.name || '—')}</div>
        <div style="margin-top:3px"><strong>RIF:</strong> ${escapeHTML(c.rif || '—')}</div>
        <div style="margin-top:3px"><strong>Ciudad:</strong> ${escapeHTML(c.city || '—')}</div>
        <div style="margin-top:3px"><strong>Dirección:</strong> ${escapeHTML(c.address || '—')}</div>
      </div>
      <div style="background:#f8fafc;padding:12px 14px;border-radius:8px;border:1px solid #e2e8f0">
        <strong style="color:#475569;display:block;margin-bottom:6px">Asignación Comercial</strong>
        <div><strong>Zona:</strong> ${c.zone ? `Zona ${escapeHTML(c.zone)}` : 'Sin zona'}</div>
        <div style="margin-top:3px"><strong>Asesor de Ventas:</strong> ${escapeHTML(c.seller_name || 'Sin asignar')}</div>
        <div style="margin-top:3px"><strong>Teléfono:</strong> ${escapeHTML(c.phone || '—')}</div>
        <div style="margin-top:3px"><strong>Email:</strong> ${escapeHTML(c.email || '—')}</div>
      </div>
      <div style="grid-column:1/-1;background:#fff8e6;border:1px solid #fef08a;padding:12px 14px;border-radius:8px">
        <strong style="color:#854d0e;display:block;margin-bottom:4px">Notas de Seguimiento:</strong>
        <p style="margin:0;color:#713f12;line-height:1.5">${escapeHTML(c.notes || 'Sin notas registradas para este cliente.')}</p>
      </div>
    </div>
  `;

  // 7. Acciones Rápidas en Footer
  const cleanPhone = (c.phone || '').replace(/\D/g, '');
  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(`Hola ${c.name} 👋, le saludamos de JJ Paper.`)}` : null;

  // Determinar ruta según si estamos en /admin/ o /vendedor/
  const inAdmin = location.pathname.includes('/admin/');
  const posUrl = inAdmin ? `pos.html?cliente=${encodeURIComponent(c.id)}` : `pos.html?cliente=${encodeURIComponent(c.id)}`;
  const cotUrl = inAdmin ? `cotizador.html?cliente=${encodeURIComponent(c.id)}` : `cotizador.html?cliente=${encodeURIComponent(c.id)}`;

  document.getElementById('chActionsLeft').innerHTML = `
    <a href="${posUrl}" class="btn-p sm" style="text-decoration:none">🛍️ Nueva Venta POS</a>
    <a href="${cotUrl}" class="btn-o sm" style="text-decoration:none">📋 Nueva Cotización</a>
    ${waUrl ? `<a href="${waUrl}" target="_blank" class="btn-o sm" style="color:#059669;border-color:#059669;text-decoration:none">💬 WhatsApp</a>` : ''}
    ${typeof openCustomerAiFlow === 'function' ? `<button class="btn-o sm" style="color:#0f766e;border-color:#0f766e" onclick="openCustomerAiFlow('${c.id}')">🧠 Flujo IA</button>` : ''}
  `;

  // Abrir pestaña orders por defecto
  switchChTab('orders');
}

function toggleChDetail(rowId, btn) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const isHidden = row.style.display === 'none';
  row.style.display = isHidden ? 'table-row' : 'none';
  if (btn) {
    btn.textContent = isHidden ? '🔼 Ocultar' : btn.textContent.replace('🔼 Ocultar', '👁️ Ver');
  }
}
