/* ======================================================
   JJ Paper Vendedor — Ajustes del vendedor
   ------------------------------------------------------
   Página de configuración personal del vendedor:
     · Tasa del día (la suya, con botón para consultar y
       actualizar como hace el admin; aplica a TODO su panel).
     · Perfil: nombre, correo de login y su teléfono.
     · Su enlace de referido (ver/copiar).
     · Firma que se agrega al pie de sus mensajes y envíos.
     · Mostrar u ocultar precios en bolívares en sus documentos.
     · Cambiar su contraseña.

   Guarda en jjp_seller_settings (tabla nueva, RLS por vendedor)
   y en jjp_profiles (teléfono). Requiere correr primero
   sql/2026-08-19-seller-settings.sql en el SQL editor de Supabase.
   ====================================================== */

/* ---------------- Utilidades de guardado ---------------- */

async function vajUpsert(key, value) {
  const { error } = await sb.from('jjp_seller_settings').upsert(
    { seller_id: SELLER.id, key, value, updated_at: new Date().toISOString() },
    { onConflict: 'seller_id,key' }
  );
  return error;
}

async function vajBorrar(key) {
  const { error } = await sb.from('jjp_seller_settings')
    .delete().eq('seller_id', SELLER.id).eq('key', key);
  return error;
}

/* ---------------- Carga inicial ---------------- */

async function vajInit() {
  await loadSellerSettings();
  vajFillTasa();
  vajFillPerfil();
  vajFillMsgs();
}

/* ---------------- Tasa del día ---------------- */

function vajTasaOficial() {
  const oficial = APP.EXCHANGE_RATE || parseFloat(sessionStorage.getItem(APP.RATE_KEY)) || 40;
  return oficial;
}

function vajFillTasa() {
  const oficial = vajTasaOficial();
  const propia  = APP.SELLER_RATE;
  const fecha   = APP.SELLER_RATE_AT || '';
  const upd     = APP.SETTINGS?.rates_updated_at || '';

  const info = document.getElementById('ajTasaInfo');
  if (info) {
    info.innerHTML = propia
      ? `<strong>Tu tasa del día: Bs ${Number(propia).toFixed(2)}</strong>${fecha ? ' · fijada ' + escapeHTML(fecha) : ''}<br>
         <span style="color:var(--gr)">Tasa oficial BCV: Bs ${oficial.toFixed(2)}${upd ? ' · actualizada ' + escapeHTML(upd) : ''}</span>`
      : `<span style="color:var(--gr)">Estás usando la <strong>tasa oficial BCV: Bs ${oficial.toFixed(2)}</strong>${upd ? ' · actualizada ' + escapeHTML(upd) : ''}</span>`;
  }
  const input = document.getElementById('ajTasa');
  if (input) input.value = propia ? Number(propia).toFixed(2) : oficial.toFixed(2);
  vajTasaHint('');
}

// Consulta las tasas del día (BCV + Binance/paralelo) y precarga la suya
async function vajConsultarTasas() {
  const btn = document.getElementById('ajTasasBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Consultando…'; }
  const rates = await fetchRates();
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Consultar tasas hoy'; }

  const input = document.getElementById('ajTasa');
  if (rates?.bcv) input.value = Number(rates.bcv).toFixed(2);
  const extra = [];
  if (rates?.paralelo) extra.push(`paralelo Bs ${Number(rates.paralelo).toFixed(2)}`);
  if (rates?.eur)      extra.push(`euro Bs ${Number(rates.eur).toFixed(2)}`);
  if (rates?.binance)  extra.push(`Binance P2P Bs ${Number(rates.binance).toFixed(2)}`);

  if (!rates || (!rates.bcv && !rates.binance)) {
    vajTasaHint('No se pudieron consultar las tasas. Escríbela a mano o inténtalo de nuevo.', true);
    return;
  }
  vajTasaHint(`Tasas consultadas: BCV Bs ${Number(rates.bcv || 0).toFixed(2)} · ${extra.join(' · ')}.
    Ajusta el valor si quieres y pulsa "Guardar mi tasa".`);
  showToast('Tasas consultadas. Revisa y guarda tu tasa.', 'ok');
}

function vajTasaHint(msg, error) {
  const el = document.getElementById('ajTasaHint');
  if (!el) return;
  el.textContent = msg;
  el.style.color = error ? '#c0392b' : 'var(--gr)';
}

async function vajGuardarTasa() {
  const val = parseFloat(document.getElementById('ajTasa')?.value);
  if (isNaN(val) || val <= 0) { showToast('Escribe una tasa válida', 'warn'); return; }
  const err = await vajUpsert('rate_usd', val.toFixed(2));
  if (err) return showToast('No se pudo guardar: ' + err.message, 'err');

  await vajUpsert('rate_updated_at',
    new Date().toLocaleString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }));
  APP.SELLER_RATE = +val.toFixed(2);
  vajFillTasa();
  showToast('✅ Tasa guardada: se usará en todo tu panel (POS, cotizaciones y catálogo)');
}

async function vajUsarOficial() {
  await vajBorrar('rate_usd');
  await vajBorrar('rate_updated_at');
  APP.SELLER_RATE = null;
  vajFillTasa();
  showToast('Usando la tasa oficial BCV', 'ok');
}

/* ---------------- Perfil ---------------- */

async function vajFillPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  const email = session?.user?.email;
  if (email) document.getElementById('ajEmail').textContent = email;
  if (SELLER?.name) document.getElementById('ajName').textContent = SELLER.name;

  const tel = document.getElementById('ajPhone');
  if (tel) tel.value = SELLER?.phone || '';

  const link = sellerRefLink();
  const ref = document.getElementById('ajRef');
  if (ref) ref.textContent = link ? link : 'Sin link de referido (pídelo al administrador)';
}

async function vajGuardarPerfil() {
  const phone = document.getElementById('ajPhone').value.trim() || null;
  const { error } = await sb.from('jjp_profiles')
    .update({ phone, updated_at: new Date().toISOString() }).eq('id', SELLER.id);
  if (error) return showToast('No se pudo guardar tu teléfono: ' + error.message, 'err');
  SELLER.phone = phone;
  if (CURRENT_PROFILE) CURRENT_PROFILE.phone = phone;
  showToast('✅ Teléfono actualizado');
}

async function vajCopiarRef() {
  const link = sellerRefLink();
  if (!link) return showToast('No tienes link de referido', 'warn');
  navigator.clipboard?.writeText(link).then(() => showToast('Link copiado ✔'));
}

/* ---------------- Mensajes y documentos ---------------- */

function vajFillMsgs() {
  const firma = document.getElementById('ajFirma');
  if (firma) firma.value = APP.SELLER_SIGNATURE || '';
  const chk = document.getElementById('ajShowBs');
  if (chk) chk.checked = sellerShowBs();
}

async function vajGuardarMsgs() {
  const firma = document.getElementById('ajFirma').value.trim();
  const showBs = document.getElementById('ajShowBs').checked ? '1' : '0';

  let err = await vajUpsert('signature', firma);
  if (err) return showToast('No se pudo guardar la firma: ' + err.message, 'err');
  err = await vajUpsert('show_bs', showBs);
  if (err) return showToast('No se pudo guardar la preferencia: ' + err.message, 'err');

  APP.SELLER_SIGNATURE = firma;
  APP.SELLER_SHOW_BS = showBs === '1';
  showToast('✅ Preferencias de mensajes guardadas');
}

/* ---------------- Seguridad ---------------- */

async function vajCambiarClave() {
  const pass = document.getElementById('ajPass').value;
  const conf = document.getElementById('ajPass2').value;
  const btn  = document.getElementById('ajPassBtn');

  if (pass.length < 6) return showToast('La contraseña debe tener al menos 6 caracteres', 'warn');
  if (pass !== conf) return showToast('Las contraseñas no coinciden', 'warn');

  btn.disabled = true; btn.textContent = 'Cambiando…';
  const { error } = await sb.auth.updateUser({ password: pass });
  btn.disabled = false; btn.textContent = '🔒 Cambiar contraseña';
  if (error) return showToast('No se pudo cambiar: ' + error.message, 'err');

  document.getElementById('ajPass').value = '';
  document.getElementById('ajPass2').value = '';
  showToast('✅ Contraseña actualizada. Úsala la próxima vez que entres.');
}