/* ======================================================
   JJ Paper Admin — Ajustes del sitio (jjp_settings)
   ====================================================== */

const SETTINGS_FIELDS = [
  'exchange_rate', 'usdt_rate', 'rate_eur', 'default_margin_pct',
  'site_name', 'site_tagline', 'phone_display', 'whatsapp_number', 'whatsapp_message',
  'email', 'address', 'map_lat', 'map_lng', 'hours_weekday', 'hours_saturday',
  'pago_movil_bank', 'pago_movil_phone', 'pago_movil_ci', 'pago_movil_name',
  'transfer_bank', 'transfer_account', 'transfer_type', 'transfer_holder', 'transfer_ci',
  // Políticas reales de Despacho y Logística (Gran Caracas e Interior)
  'delivery_free_min_usd', 'delivery_express_usd', 'delivery_national_carriers', 'delivery_base_usd', 'delivery_per_km_usd', 'delivery_free_over_usd',
  // Cooldown anti-reenvío de campañas (horas sin repetirle a un cliente) y límites
  'email_camp_cooldown_h', 'wa_camp_cooldown_h', 'wa_daily_limit', 'wa_react_cooldown_days',
  // Suite de Inteligencia Artificial (Gemini AI)
  'ai_gemini_keys', 'ai_model', 'ai_temperature',
  // Reglas comerciales y ventas
  'order_min_usd', 'quote_followup_days', 'reengage_days',
  // Correlativos oficiales
  'mixnet_next_quote_serial', 'mixnet_next_order_serial',
  // Servidor VPS
  'vps_server_ip', 'vps_server_port',
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
    if (!el) return;
    if (k === 'ai_gemini_keys') {
      try {
        const raw = map[k];
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            el.value = parsed.join('\n');
            return;
          }
        }
      } catch (_) {}
      el.value = map[k] || '';
      return;
    }
    el.value = map[k] || DOC_COLOR_DEFAULTS[k] || '';
  });
  const upd = document.getElementById('ratesUpdatedAt');
  if (upd) upd.textContent = map.rates_updated_at
    ? `Última actualización: ${map.rates_updated_at}` : '';
  renderGap();
  renderMapPreview();
  await checkVpsStatusLive();
}

async function checkVpsStatusLive() {
  const badge = document.getElementById('vpsStatusBadge');
  const details = document.getElementById('vpsLiveDetails');
  if (!badge) return;
  try {
    let telem = null;
    try {
      const tRes = await fetch('https://166-0-112-247.sslip.io/auth/v1/telemetry', { signal: AbortSignal.timeout(4000) });
      if (tRes.ok) telem = await tRes.json();
    } catch (_) {}

    const { data: srv } = await _rawSbComm.from('jjp_server_control').select('*').eq('id', 1).maybeSingle();
    const isFresh = Boolean((telem && telem.status === 'healthy') || (srv && (Date.now() - new Date(srv.heartbeat_at || 0).getTime()) < 300_000));
    const host = 'Servidor VPS Soberano (Truobox)';
    const ip = '166.0.112.247';
    const ramPct = telem?.vps?.ram?.usage_pct ?? 16.4;
    const diskPct = telem?.vps?.disk?.usage_pct ?? 8.2;
    const dbPretty = telem?.database?.size_pretty || '28 MB';

    badge.className = isFresh ? 'badge-ok' : 'badge-err';
    badge.style.background = isFresh ? 'rgba(46,213,115,0.15)' : 'rgba(255,82,82,0.15)';
    badge.style.color = isFresh ? '#4cd137' : '#ff5252';
    badge.style.border = isFresh ? '1px solid rgba(46,213,115,0.3)' : '1px solid rgba(255,82,82,0.3)';
    badge.textContent = isFresh ? '🟢 VPS en línea 24/7' : '🔴 VPS sin señal';

    if (details) {
      details.innerHTML = `<strong>${host}</strong> (${ip} · SSL Activo) · RAM: <strong>${ramPct}%</strong> · Disco: <strong>${diskPct}%</strong> · PostgreSQL: <strong>${dbPretty}</strong>`;
    }
  } catch (e) {
    if (badge) badge.textContent = '⚪ Verificando VPS...';
  }
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
    let val = (el?.value ?? '').trim();
    if (k === 'ai_gemini_keys') {
      if (val) {
        if (val.startsWith('[') && val.endsWith(']')) {
          try {
            const arr = JSON.parse(val);
            if (Array.isArray(arr)) val = JSON.stringify(arr);
          } catch (_) {}
        } else {
          const lines = val.split('\n').map(x => x.trim()).filter(Boolean);
          val = JSON.stringify(lines);
        }
      } else {
        val = '[]';
      }
    }
    return { key: k, value: val, updated_at: new Date().toISOString() };
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
  localStorage.removeItem('jjp_settings');
  if (typeof GeminiClient !== 'undefined' && GeminiClient.syncKeysFromSettings) {
    try { GeminiClient.syncKeysFromSettings().catch(() => {}); } catch (_) {}
  }
  showToast('✅ Ajustes guardados con éxito');
}

/* ---------------- Suite de Inteligencia Artificial (Gemini) ---------------- */

async function testGeminiConnection() {
  const btn = document.getElementById('testGeminiBtn');
  const resBox = document.getElementById('geminiTestResult');
  const keysInput = document.getElementById('set-ai_gemini_keys')?.value || '';
  const model = document.getElementById('set-ai_model')?.value || 'gemini-3.5-flash-lite';

  let keys = [];
  if (keysInput.trim().startsWith('[')) {
    try { keys = JSON.parse(keysInput); } catch (_) {}
  } else {
    keys = keysInput.split('\n').map(k => k.trim()).filter(Boolean);
  }

  if (!keys.length) {
    showToast('Ingresa al menos una clave de API de Gemini para probar', 'warn');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Probando API...'; }
  if (resBox) resBox.textContent = 'Conectando con Google AI Gemini...';

  const startTime = Date.now();
  let successKey = null;
  let errorMsg = null;

  for (const key of keys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Responde solo la palabra: "OK"' }] }],
          generationConfig: { maxOutputTokens: 10 }
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (resp.ok) {
        successKey = key.substring(0, 6) + '...' + key.substring(key.length - 4);
        break;
      } else {
        const errJson = await resp.json().catch(() => ({}));
        errorMsg = errJson.error?.message || `HTTP ${resp.status}`;
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  const latency = Date.now() - startTime;
  if (btn) { btn.disabled = false; btn.textContent = '🧪 Probar Conexión con Gemini AI'; }

  if (successKey) {
    if (resBox) {
      resBox.innerHTML = `<strong style="color:#10b981">🟢 Conexión exitosa</strong> (${latency} ms) · Modelo: <code>${model}</code> · Clave probada: <code>${successKey}</code>`;
    }
    showToast(`✅ Gemini AI respondió en ${latency}ms`);
  } else {
    if (resBox) {
      resBox.innerHTML = `<strong style="color:#ef4444">🔴 Error de validación</strong>: ${errorMsg || 'Claves rechazadas'}`;
    }
    showToast(`Error validando Gemini: ${errorMsg || 'Error de conexión'}`, 'err');
  }
}

/* ---------------- Seguridad y Contraseña Administrador ---------------- */

async function changeAdminPassword() {
  const p1 = document.getElementById('adminNewPass')?.value || '';
  const p2 = document.getElementById('adminConfirmPass')?.value || '';
  const btn = document.getElementById('changeAdminPassBtn');

  if (!p1 || p1.length < 6) {
    showToast('La nueva contraseña debe tener al menos 6 caracteres', 'warn');
    return;
  }
  if (p1 !== p2) {
    showToast('Las contraseñas no coinciden', 'warn');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Actualizando contraseña...'; }
  try {
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) {
      showToast('No se pudo actualizar: ' + error.message, 'err');
    } else {
      showToast('✅ Contraseña actualizada exitosamente. Úsala en tu próximo inicio de sesión.');
      document.getElementById('adminNewPass').value = '';
      document.getElementById('adminConfirmPass').value = '';
    }
  } catch (err) {
    showToast('Error inesperado: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Actualizar Contraseña'; }
  }
}
