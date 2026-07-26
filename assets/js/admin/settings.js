/* ======================================================
   JJ Paper Admin — Ajustes del sitio (jjp_settings)
   ====================================================== */

const SETTINGS_FIELDS = [
  'exchange_rate', 'usdt_rate', 'rate_eur', 'default_margin_pct',
  'site_name', 'site_tagline', 'phone_display', 'whatsapp_number', 'whatsapp_message',
  'email', 'address', 'map_lat', 'map_lng', 'hours_weekday', 'hours_saturday',
  'pago_movil_bank', 'pago_movil_phone', 'pago_movil_ci', 'pago_movil_name',
  'transfer_bank', 'transfer_account', 'transfer_type', 'transfer_holder', 'transfer_ci',
  // Delivery cotizado por distancia (checkout)
  'delivery_base_usd', 'delivery_per_km_usd', 'delivery_free_over_usd',
  // Formato del comprobante/factura (comprobante.html)
  'business_name', 'rif', 'iva_pct', 'doc_title', 'doc_color', 'doc_accent',
  'doc_logo_url', 'doc_paper', 'doc_show_bs', 'doc_footer_legal', 'doc_footer_note',
  'doc_control_serie',
];

// Defaults visuales del comprobante (inputs type=color no aceptan vacío)
const DOC_COLOR_DEFAULTS = { doc_color: '#16604A', doc_accent: '#C9A24B' };

async function loadSettingsForm() {
  const { data, error } = await sb.from('jjp_settings').select('key,value');
  if (error) { showToast('Error cargando ajustes', 'err'); return; }
  const map = Object.fromEntries((data || []).map(r => [r.key, r.value]));
  SETTINGS_FIELDS.forEach(k => {
    const el = document.getElementById('set-' + k);
    if (el) el.value = map[k] || DOC_COLOR_DEFAULTS[k] || '';
  });
  const upd = document.getElementById('ratesUpdatedAt');
  if (upd) upd.textContent = map.rates_updated_at
    ? `Última actualización: ${map.rates_updated_at}` : '';
  renderGap();
  renderMapPreview();
}

/* ------------------------------------------------------
   Mapa de la distribuidora
   - "Ubicar en el mapa" geocodifica la dirección con Nominatim
     (OpenStreetMap) y llena lat/lng.
   - La vista previa se arma desde esas coords. Al guardar,
     el mapa del sitio (index.html) usa las mismas coords.
   ------------------------------------------------------ */
async function geocodeAddress() {
  const addr = document.getElementById('set-address')?.value.trim();
  if (!addr) { showToast('Escribe la dirección primero', 'warn'); return; }

  const btn = document.getElementById('geocodeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ve&q=${encodeURIComponent(addr)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    if (!data?.length) {
      showToast('No se encontró la dirección. Afina el texto o pon las coordenadas a mano.', 'warn');
      return;
    }
    document.getElementById('set-map_lat').value = (+data[0].lat).toFixed(6);
    document.getElementById('set-map_lng').value = (+data[0].lon).toFixed(6);
    renderMapPreview();
    showToast('📍 Ubicación encontrada. Revisa el mapa y pulsa "Guardar".');
  } catch (e) {
    showToast('Error consultando el mapa. Intenta de nuevo.', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📍 Ubicar en el mapa'; }
  }
}

function renderMapPreview() {
  const lat = parseFloat(document.getElementById('set-map_lat')?.value);
  const lng = parseFloat(document.getElementById('set-map_lng')?.value);
  const box = document.getElementById('mapPreview');
  const link = document.getElementById('mapPreviewLink');
  if (!box) return;
  if (isNaN(lat) || isNaN(lng)) {
    box.innerHTML = '';
    if (link) link.style.display = 'none';
    return;
  }
  box.innerHTML = `<iframe src="${osmEmbed(lat, lng)}" loading="lazy" title="Vista previa del mapa"
    style="width:100%;max-width:440px;height:230px;border:1px solid #ddd;border-radius:10px;display:block"></iframe>`;
  if (link) { link.href = osmLink(lat, lng); link.style.display = 'inline'; }
}

// Live gap between BCV and Binance/USDT rates
function renderGap() {
  const bcv  = parseFloat(document.getElementById('set-exchange_rate')?.value);
  const usdt = parseFloat(document.getElementById('set-usdt_rate')?.value);
  const box  = document.getElementById('gapInfo');
  if (!box) return;
  if (!bcv || !usdt) { box.textContent = ''; return; }
  const gap = (usdt / bcv - 1) * 100;
  const eur = parseFloat(document.getElementById('set-rate_eur')?.value);
  // 1 EUR = eur/bcv dólares (ambas son Bs/divisa a tasa BCV)
  const eurInfo = (eur && bcv) ? ` · 1 € = <strong>$${(eur / bcv).toFixed(3)}</strong> (para costos en euros)` : '';
  box.innerHTML = `Brecha Binance vs BCV: <strong>${gap.toFixed(2)}%</strong>
    <span style="color:var(--gr)">— este % se suma al costo automáticamente (invisible al cliente).</span>${eurInfo}`;
}

// Fetch official (BCV) + parallel (~Binance) rates from the public API
async function fetchRatesToForm() {
  const btn = document.getElementById('fetchRatesBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando...'; }
  const rates = await fetchRates();
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Actualizar tasas (BCV + Binance + Euro)'; }

  if (!rates || (!rates.bcv && !rates.binance)) {
    showToast('No se pudieron obtener las tasas. Ingrésalas manualmente.', 'warn');
    return;
  }
  if (rates.bcv)     document.getElementById('set-exchange_rate').value = Number(rates.bcv).toFixed(2);
  if (rates.binance) document.getElementById('set-usdt_rate').value     = Number(rates.binance).toFixed(2);
  if (rates.eur) { const e = document.getElementById('set-rate_eur'); if (e) e.value = Number(rates.eur).toFixed(2); }
  renderGap();
  const mon = rates.monitor ? ` · Monitor: Bs ${Number(rates.monitor).toFixed(2)}` : '';
  const eu  = rates.eur ? ` · Euro: Bs ${Number(rates.eur).toFixed(2)}` : '';
  showToast(`Tasas cargadas (Binance P2P real${mon}${eu}). Revisa y pulsa "Guardar".`);
}

// Vista previa del comprobante con el pedido más reciente
async function docPreview(fmt) {
  const { data } = await sb.from('jjp_orders')
    .select('order_number').order('created_at', { ascending: false }).limit(1);
  if (!data?.length) { showToast('Aún no hay pedidos para previsualizar. Guarda y crea un pedido primero.', 'warn'); return; }
  showToast('Guarda los cambios antes de previsualizar si editaste algo.', 'ok', 3000);
  window.open(`../comprobante.html?n=${encodeURIComponent(data[0].order_number)}${fmt ? '&f=' + fmt : ''}`, '_blank');
}

async function saveSettings() {
  const btn = document.getElementById('saveSettingsBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  const rows = SETTINGS_FIELDS.map(k => {
    const el = document.getElementById('set-' + k);
    return { key: k, value: (el?.value ?? '').trim(), updated_at: new Date().toISOString() };
  });
  // Timestamp of last rate update (shown in the panel)
  rows.push({ key: 'rates_updated_at',
    value: new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }),
    updated_at: new Date().toISOString() });

  const { error } = await sb.from('jjp_settings').upsert(rows, { onConflict: 'key' });
  if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar cambios'; }

  if (error) { showToast('Error al guardar: ' + error.message, 'err'); return; }
  // Bust the public-site cache so changes show immediately
  sessionStorage.removeItem('jjp_settings');
  showToast('✅ Ajustes guardados');
}
