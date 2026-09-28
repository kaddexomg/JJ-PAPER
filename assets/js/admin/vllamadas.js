/**
 * ============================================================================
 * JJ Paper — Motor de Llamadas B2B, Cartera y Centralita Comercial
 * Compatible con Windows 7 · Headset · Puente GSM USB ($0 Inversión)
 * Soporta Carteras 010 y 020 · Cola Secuencial (Power Dialer) · Asistente IA
 * ============================================================================
 */

let activeCallTarget = null;
let pageCallSeconds = 0;
let pageCallTimer = null;
let pageIsCallActive = false;
let gsmBridgeConnected = false;
let gsmMonitorInterval = null;
let lastKnownGsmCallState = 0; // 0=IDLE, 1=RINGING, 2=OFFHOOK
let isRemoteServerActive = false;

// Estado del Motor de Cartera (Power Dialer)
let rawCustomersList = [];
let filteredQueue = [];
let queueIndex = 0;
let isQueueRunning = false;
let lastGeneratedWaMessage = '';
let countdownTimer = null;
let countdownSeconds = 3;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Inicializar sesión y permisos
  if (typeof requireAuth === 'function') {
    const session = await requireAuth(['admin', 'vendedor']).catch(() => null);
    if (session && typeof renderUserBar === 'function') renderUserBar(session);
  }

  // 2. Inicializar Puente GSM
  checkGsmBridgeOnPage();
  if (gsmMonitorInterval) clearInterval(gsmMonitorInterval);
  gsmMonitorInterval = setInterval(checkGsmBridgeOnPage, 3500);

  // 3. Cargar Cartera Inicial según la selección del select HTML
  const initialSource = document.getElementById('queueSourceSelect')?.value || 'zona_010';
  await loadQueueFromSource(initialSource);

  // 4. Cargar Historial y Agenda Local
  loadCallbacksList();
  loadCallHistory();

  // 5. Configurar preset inicial de fecha en tipificador
  setPagePreset('tomorrow_am');

  // 6. Restaurar llamada activa si el usuario recargó o volvió de otra pestaña
  try {
    const saved = localStorage.getItem('jjp_active_call_session');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.is_active && parsed.started_at) {
        const elapsed = Math.floor((Date.now() - parsed.started_at) / 1000);
        if (elapsed < 3600) {
          pageCallSeconds = elapsed;
          pageIsCallActive = true;
          startConversationTimer();
          const badgeEl = document.getElementById('pageCallStateBadge');
          if (badgeEl) {
            badgeEl.textContent = '🟢 En Llamada Activa';
            badgeEl.style.background = '#dcfce7';
            badgeEl.style.color = '#15803d';
          }
          const btnStart = document.getElementById('pageBtnStart');
          const btnHang = document.getElementById('pageBtnHang');
          if (btnStart) btnStart.style.display = 'none';
          if (btnHang) btnHang.style.display = 'inline-flex';
          const alertEl = document.getElementById('pageCallDialingAlert');
          if (alertEl) alertEl.style.display = 'none';
          const dialerInput = document.getElementById('pageDialerInput');
          if (dialerInput && parsed.phone) dialerInput.value = parsed.phone;
        } else {
          localStorage.removeItem('jjp_active_call_session');
        }
      }
    }
  } catch (_) {}
});

// ----------------------------------------------------------------------------
// 1. CARGA DE CARTERAS Y LISTAS DE CLIENTES
// ----------------------------------------------------------------------------
async function onQueueSourceChange() {
  const source = document.getElementById('queueSourceSelect')?.value || 'zona_010';
  await loadQueueFromSource(source);
}

async function loadQueueFromSource(source) {
  const progressText = document.getElementById('queueProgressText');
  if (progressText) progressText.textContent = 'Cargando clientes de la base de datos...';

  rawCustomersList = [];

  // A. Rellamadas Agendadas
  if (source === 'rellamadas') {
    const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]');
    rawCustomersList = callbacks.map(cb => ({
      id: cb.targetId || null,
      company: cb.company || 'Cliente',
      name: cb.name || '',
      phone: cb.phone || '',
      zone: 'Agenda',
      city: 'Rellamada',
      address: cb.reason || 'Rellamada programada',
      email: '',
      total_orders: 0,
      total_usd: 0,
      last_order_at: null,
      notes: cb.reason || '',
      last_contact_at: cb.callback_at,
      last_contact_channel: 'agenda',
      contact_count: 1,
      type: 'callback'
    }));
    applyQueueFilters();
    return;
  }

  // B. Prospectos B2B (Empresas y Cuentas Clave de Keyder)
  if (source === 'prospectos_b2b') {
    if (typeof sb !== 'undefined') {
      try {
        const { data, error } = await sb.from('jjp_prospects')
          .select('id,company_name,contact_name,phone_1,phone_2,email,address,city,sector,notes,status,last_contact_at,contact_count')
          .order('company_name', { ascending: true })
          .limit(1000);
        if (error) {
          console.warn('Error cargando prospectos de Supabase:', error);
        }
        if (data && !error) {
          rawCustomersList = data.map(p => {
            const primaryPhone = (p.phone_1 || p.phone_2 || '').trim();
            const altPhone = (p.phone_1 && p.phone_2 && p.phone_1 !== p.phone_2) ? p.phone_2.trim() : '';
            return {
              id: p.id,
              company: p.company_name || 'Empresa Prospecto',
              name: p.contact_name ? `${p.contact_name}${altPhone ? ` (Alt: ${altPhone})` : ''}` : (altPhone ? `Alt: ${altPhone}` : ''),
              rif: p.sector || 'B2B',
              phone: primaryPhone,
              alt_phone: altPhone,
              zone: p.sector || 'Prospecto',
              city: p.city || 'Caracas',
              address: p.address || 'Venezuela',
              email: p.email || '',
              total_orders: 0,
              total_usd: 0,
              last_order_at: null,
              notes: p.notes || (altPhone ? `Teléfono alternativo: ${altPhone}` : ''),
              last_contact_at: p.last_contact_at,
              last_contact_channel: 'prospect_b2b',
              contact_count: p.contact_count || 0,
              type: 'prospect'
            };
          });
        }
      } catch (e) {
        console.warn('Error cargando prospectos:', e);
      }
    }
    applyQueueFilters();
    return;
  }

  // C. Cartera de Clientes Supabase con paginación por lotes (010, 020, 008, 014, 004, 006, etc.)
  if (typeof sb !== 'undefined') {
    try {
      const seller = (typeof SELLER !== 'undefined' && SELLER) ? SELLER : (window.SELLER || null);
      const isAdmin = seller?.role === 'admin' || seller?.is_admin;
      const CUST_COLS = 'id,name,phone,rif,zone,city,total_orders,total_usd,last_order_at,seller_id,email,address,notes';

      // 1. Verificar si ya tenemos la cartera en caché de sesión para carga inmediata (<10ms)
      let cachedPool = null;
      try {
        const rawAdmin = sessionStorage.getItem('jjp_admin_cust_cache_v1');
        const rawV = sessionStorage.getItem('jjp_vcust_cache_v1');
        const pool = rawAdmin ? JSON.parse(rawAdmin) : (rawV ? JSON.parse(rawV) : null);
        if (Array.isArray(pool) && pool.length > 50) {
          cachedPool = pool;
        }
      } catch (_) {}

      let allData = [];

      if (cachedPool && cachedPool.length > 0) {
        // Filtrar desde caché si está disponible
        if (source === 'zona_010') {
          allData = cachedPool.filter(c => c.zone === '010');
        } else if (source === 'zona_020') {
          allData = cachedPool.filter(c => c.zone === '020');
        } else if (source === 'zona_008') {
          allData = cachedPool.filter(c => c.zone === '008');
        } else if (source === 'zona_014') {
          allData = cachedPool.filter(c => c.zone === '014');
        } else if (source === 'zona_006') {
          allData = cachedPool.filter(c => c.zone === '006');
        } else if (source === 'zona_004') {
          allData = cachedPool.filter(c => c.zone === '004');
        } else if (source === 'mi_cartera') {
          if (isAdmin) {
            allData = cachedPool.filter(c => c.zone === '010' || c.zone === '020');
          } else if (seller?.id) {
            allData = cachedPool.filter(c => c.seller_id === seller.id);
          } else {
            allData = cachedPool;
          }
        } else {
          allData = cachedPool;
        }
      }

      // 2. Si no estaba en caché o la caché vino vacía para esa zona, consultar directamente a Supabase con paginación
      if (!allData || allData.length === 0) {
        const PAGE = 1000;
        let from = 0;
        allData = [];

        for (;;) {
          let query = sb.from('jjp_customers').select(CUST_COLS).order('name', { ascending: true });

          if (source === 'zona_010') {
            query = query.eq('zone', '010');
          } else if (source === 'zona_020') {
            query = query.eq('zone', '020');
          } else if (source === 'zona_008') {
            query = query.eq('zone', '008');
          } else if (source === 'zona_014') {
            query = query.eq('zone', '014');
          } else if (source === 'zona_006') {
            query = query.eq('zone', '006');
          } else if (source === 'zona_004') {
            query = query.eq('zone', '004');
          } else if (source === 'mi_cartera') {
            if (isAdmin) {
              query = query.or('zone.eq.010,zone.eq.020');
            } else if (seller?.id) {
              query = query.eq('seller_id', seller.id);
            }
          } else if (source === 'todos_clientes') {
            if (!isAdmin) {
              query = query.neq('zone', '020');
            }
          }

          const { data, error } = await query.range(from, from + PAGE - 1);
          if (error) {
            console.warn('Error en consulta de clientes:', error);
            break;
          }
          if (!data || data.length === 0) break;
          allData.push(...data);
          if (data.length < PAGE || from > 8000) break;
          from += PAGE;
        }
      }

      if (allData && allData.length > 0) {
        rawCustomersList = allData.map(c => {
          const notesStr = c.notes || '';
          const hasCallNote = notesStr.includes('[Llamada');
          return {
            id: c.id,
            company: c.name || 'Cliente',
            name: '',
            rif: c.rif || '',
            phone: c.phone || '',
            zone: c.zone || 'Sin zona',
            city: c.city || 'Caracas',
            address: c.address || '',
            email: c.email || '',
            total_orders: c.total_orders || 0,
            total_usd: Number(c.total_usd || 0),
            last_order_at: c.last_order_at,
            notes: notesStr,
            last_contact_at: hasCallNote ? c.last_order_at : null,
            last_contact_channel: hasCallNote ? 'llamada_gsm' : '',
            contact_count: hasCallNote ? 1 : 0,
            seller_id: c.seller_id,
            type: 'customer'
          };
        });
      }
    } catch (err) {
      console.error('Error cargando cartera en el motor de llamadas:', err);
    }
  }

  applyQueueFilters();
}

// ----------------------------------------------------------------------------
// 2. FILTRADO Y GESTIÓN DE LA COLA DEL MOTOR DE LLAMADAS
// ----------------------------------------------------------------------------
function applyQueueFilters() {
  const filterType = document.getElementById('queueFilterSelect')?.value || 'todos';
  const searchTerm = (document.getElementById('queueSearchInput')?.value || '').trim().toLowerCase();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

  filteredQueue = rawCustomersList.filter(item => {
    // 1. Debe tener teléfono para poder llamar
    if (!item.phone || item.phone.trim().length < 6) return false;

    // 2. Filtro por Estado
    if (filterType === 'pendientes') {
      // Sin llamadas o nunca contactado
      if (item.contact_count && item.contact_count > 0) return false;
      if (item.notes && item.notes.includes('[Llamada')) return false;
    } else if (filterType === 'sin_contacto_30d') {
      if (item.last_contact_at) {
        const lastDate = new Date(item.last_contact_at);
        if (lastDate > thirtyDaysAgo) return false;
      }
    } else if (filterType === 'interesados') {
      const n = (item.notes || '').toLowerCase();
      if (!n.includes('interesado') && !n.includes('cotización') && !n.includes('cotizacion')) return false;
    } else if (filterType === 'no_contesta') {
      const n = (item.notes || '').toLowerCase();
      if (!n.includes('no contesta') && !n.includes('buzón')) return false;
    }

    // 3. Filtro por Buscador de Texto
    if (searchTerm) {
      const matchComp = (item.company || '').toLowerCase().includes(searchTerm);
      const matchRif = (item.rif || '').toLowerCase().includes(searchTerm);
      const matchPhone = (item.phone || '').toLowerCase().includes(searchTerm);
      const matchCity = (item.city || '').toLowerCase().includes(searchTerm);
      if (!matchComp && !matchRif && !matchPhone && !matchCity) return false;
    }

    return true;
  });

  queueIndex = 0;
  updateQueueUI();

  if (filteredQueue.length > 0) {
    loadCustomerAt(0);
  } else {
    clearDossierView();
  }
}

function updateQueueUI() {
  const total = filteredQueue.length;
  const current = total > 0 ? queueIndex + 1 : 0;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  const textEl = document.getElementById('queueProgressText');
  const barEl = document.getElementById('queueProgressBar');

  if (textEl) {
    textEl.textContent = `Contacto ${current} de ${total} (${pct}%)`;
  }
  if (barEl) {
    barEl.style.width = `${pct}%`;
  }
}

function startQueueExecution() {
  if (!filteredQueue.length) {
    if (typeof showToast === 'function') showToast('La lista seleccionada no tiene contactos pendientes.', 'warn');
    return;
  }
  isQueueRunning = true;
  const btnStart = document.getElementById('btnQueueStart');
  const btnPause = document.getElementById('btnQueuePause');
  if (btnStart) btnStart.style.display = 'none';
  if (btnPause) btnPause.style.display = 'inline-flex';

  loadCustomerAt(queueIndex);
  if (typeof showToast === 'function') {
    showToast(`⚡ Cola iniciada: ${activeCallTarget?.company}. Iniciando marcación...`, 'info');
  }
  startCallCountdown();
}

function pauseQueueExecution() {
  isQueueRunning = false;
  cancelCallCountdown();
  const btnStart = document.getElementById('btnQueueStart');
  const btnPause = document.getElementById('btnQueuePause');
  if (btnStart) btnStart.style.display = 'inline-flex';
  if (btnPause) btnPause.style.display = 'none';
  if (typeof showToast === 'function') showToast('Motor de llamadas en pausa.', 'info');
}

function startCallCountdown() {
  cancelCallCountdown();
  if (!isQueueRunning || !activeCallTarget || !activeCallTarget.phone) return;

  const banner = document.getElementById('dialerCountdownBanner');
  const nameEl = document.getElementById('countdownTargetName');
  const timerEl = document.getElementById('countdownTimerText');

  const compName = activeCallTarget.company || 'Cliente';
  const cleanPhone = activeCallTarget.phone || '';

  if (banner && nameEl && timerEl) {
    nameEl.textContent = `⚡ Marcando a: ${compName} (${cleanPhone})`;
    countdownSeconds = 3;
    timerEl.textContent = `Iniciando llamada en ${countdownSeconds} segundos...`;
    banner.style.display = 'flex';

    countdownTimer = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds > 0) {
        timerEl.textContent = `Iniciando llamada en ${countdownSeconds} segundo${countdownSeconds > 1 ? 's' : ''}...`;
      } else {
        cancelCallCountdown();
        pageStartCall();
      }
    }, 1000);
  } else {
    pageStartCall();
  }
}

function cancelCallCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  const banner = document.getElementById('dialerCountdownBanner');
  if (banner) banner.style.display = 'none';
}

function triggerCallNow() {
  cancelCallCountdown();
  pageStartCall();
}

function queueNext() {
  cancelCallCountdown();
  if (!filteredQueue.length) {
    if (typeof showToast === 'function') showToast('No hay clientes disponibles en esta lista.', 'warn');
    return;
  }
  queueIndex = (queueIndex + 1) % filteredQueue.length;
  loadCustomerAt(queueIndex);
  if (isQueueRunning) {
    startCallCountdown();
  }
}

function queuePrev() {
  cancelCallCountdown();
  if (!filteredQueue.length) {
    if (typeof showToast === 'function') showToast('No hay clientes disponibles en esta lista.', 'warn');
    return;
  }
  queueIndex = (queueIndex - 1 + filteredQueue.length) % filteredQueue.length;
  loadCustomerAt(queueIndex);
}

function queueRandom() {
  cancelCallCountdown();
  if (filteredQueue.length <= 1) return;
  const nextIdx = Math.floor(Math.random() * filteredQueue.length);
  queueIndex = nextIdx;
  loadCustomerAt(queueIndex);
  if (isQueueRunning) {
    startCallCountdown();
  }
}

// ----------------------------------------------------------------------------
// 3. CARGA DE LA FICHA EN VIVO (DOSSIER DEL CLIENTE)
// ----------------------------------------------------------------------------
function loadCustomerAt(idx) {
  if (idx < 0 || idx >= filteredQueue.length) return;
  const target = filteredQueue[idx];
  activeCallTarget = target;

  // Actualizar Marcador
  const dialerInput = document.getElementById('pageDialerInput');
  if (dialerInput) {
    dialerInput.value = target.phone || '';
    onPageNumberChange(target.phone || '');
  }

  // Actualizar Dossier
  document.getElementById('dossierCompanyName').textContent = target.company || 'Cliente';
  document.getElementById('dossierZoneBadge').textContent = `Zona ${target.zone || '—'}`;
  document.getElementById('dossierRifLine').textContent = `RIF: ${target.rif || 'Sin RIF'} · Ciudad: ${target.city || 'Caracas'}`;
  document.getElementById('dossierContact').textContent = target.name || 'Sin contacto registrado';
  document.getElementById('dossierPhone').textContent = target.phone || '—';
  document.getElementById('dossierEmail').textContent = target.email || 'Sin correo';
  document.getElementById('dossierCity').textContent = target.city || 'Caracas';
  document.getElementById('dossierAddress').textContent = target.address || 'Sin dirección fiscal registrada';

  const purchasesText = target.total_orders > 0
    ? `${target.total_orders} pedido(s) · $${target.total_usd.toFixed(2)} USD comprados ${target.last_order_at ? `(Último: ${target.last_order_at})` : ''}`
    : 'Sin compras previas registradas';
  document.getElementById('dossierPurchases').textContent = purchasesText;

  // Contacto Omnicanal
  let lastContactStr = 'Nunca contactado previamente';
  if (target.last_contact_at) {
    const formattedDate = new Date(target.last_contact_at).toLocaleDateString('es-VE');
    const channelLabel = target.last_contact_channel === 'llamada_gsm' ? '📞 Llamada B2B' :
                         (target.last_contact_channel === 'whatsapp' ? '💬 WhatsApp' :
                         (target.last_contact_channel === 'email' ? '📧 Correo' : target.last_contact_channel));
    lastContactStr = `Último: ${formattedDate} vía ${channelLabel} (${target.contact_count || 1} contacto(s) en total)`;
  }
  document.getElementById('dossierLastContact').textContent = lastContactStr;

  // Ocultar caja IA previa y limpiar notas
  document.getElementById('aiCallResultBox').style.display = 'none';
  document.getElementById('pageCallNotes').value = '';

  // Actualizar botón directo de llamada
  const btnDirect = document.getElementById('btnDirectCallCustomer');
  if (btnDirect) {
    const shortName = target.company ? (target.company.length > 20 ? target.company.slice(0, 18) + '...' : target.company) : 'Cliente';
    btnDirect.innerHTML = `📞 Llamar a ${shortName}`;
    btnDirect.title = `Llamar a ${target.company} (${target.phone || 'Sin número'})`;
  }

  updateQueueUI();
}

function clearDossierView() {
  activeCallTarget = null;
  const totalRaw = (rawCustomersList || []).length;
  const msg = totalRaw > 0 
    ? `Esta lista tiene ${totalRaw} cliente(s), pero ninguno coincide con el filtro o tiene teléfono.`
    : 'No hay clientes registrados en esta cartera.';
  document.getElementById('dossierCompanyName').textContent = msg;
  document.getElementById('dossierZoneBadge').textContent = 'Zona —';
  document.getElementById('dossierRifLine').textContent = 'Prueba cambiando el filtro de contacto o seleccionando otra cartera.';
  document.getElementById('dossierContact').textContent = '—';
  document.getElementById('dossierPhone').textContent = '—';
  document.getElementById('dossierEmail').textContent = '—';
  document.getElementById('dossierCity').textContent = '—';
  document.getElementById('dossierAddress').textContent = '—';
  document.getElementById('dossierPurchases').textContent = '—';
  document.getElementById('dossierLastContact').textContent = '—';
}

// ----------------------------------------------------------------------------
// 4. ACCIONES RÁPIDAS CON EL CLIENTE ACTUAL
// ----------------------------------------------------------------------------
function openQuoteForCurrentCustomer() {
  if (!activeCallTarget) {
    if (typeof showToast === 'function') showToast('Selecciona un cliente primero.', 'warn');
    return;
  }
  const url = `cotizador.html?customer_id=${encodeURIComponent(activeCallTarget.id || '')}&name=${encodeURIComponent(activeCallTarget.company || '')}&phone=${encodeURIComponent(activeCallTarget.phone || '')}&rif=${encodeURIComponent(activeCallTarget.rif || '')}`;
  window.open(url, '_blank');
}

function openPosForCurrentCustomer() {
  if (!activeCallTarget) {
    if (typeof showToast === 'function') showToast('Selecciona un cliente primero.', 'warn');
    return;
  }
  const url = `pos.html?customer_id=${encodeURIComponent(activeCallTarget.id || '')}&name=${encodeURIComponent(activeCallTarget.company || '')}`;
  window.open(url, '_blank');
}

function openWhatsAppChatForCurrent() {
  const phone = document.getElementById('pageDialerInput')?.value || activeCallTarget?.phone || '';
  if (!phone) {
    if (typeof showToast === 'function') showToast('Ingresa un número telefónico.', 'warn');
    return;
  }
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '58' + clean.substring(1);
  else if (!clean.startsWith('58') && clean.length === 10) clean = '58' + clean;

  window.open(`https://wa.me/${clean}`, '_blank');
}

// ----------------------------------------------------------------------------
// 5. ESTADO DEL PUENTE GSM Y LLAMADA TELEFÓNICA EN TIEMPO REAL
// ----------------------------------------------------------------------------
async function checkGsmBridgeOnPage() {
  const badgeEl = document.getElementById('pageBridgeBadge');

  // 1. Intentar conexión directa por HTTP local (cuando wa-server corre en la misma PC)
  try {
    let res = await fetch('http://127.0.0.1:8789/status', { mode: 'cors' }).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch('/lan/gsm/status').catch(() => null);
    }

    if (res && res.ok) {
      const data = await res.json();
      gsmBridgeConnected = !!data.connected;
      isRemoteServerActive = false;
      const callState = data.call_state || 0; // 0=IDLE, 1=RINGING, 2=OFFHOOK

      if (badgeEl) {
        if (data.connected) {
          badgeEl.textContent = `🟢 Móvil Listo: ${data.model || 'Android'}`;
          badgeEl.className = 'of-chip on';
          badgeEl.style.background = '#dcfce7';
          badgeEl.style.color = '#15803d';
        } else if (data.state === 'unauthorized') {
          badgeEl.textContent = '🟡 Celular No Autorizado (Ver Pantalla)';
          badgeEl.className = 'of-chip';
          badgeEl.style.background = '#fef3c7';
          badgeEl.style.color = '#b45309';
        } else if (data.adb_installed) {
          badgeEl.textContent = '🟡 Esperando Celular USB';
          badgeEl.className = 'of-chip';
          badgeEl.style.background = '#fef3c7';
          badgeEl.style.color = '#b45309';
        } else {
          badgeEl.textContent = '⚪ Puente Offline';
          badgeEl.className = 'of-chip';
          badgeEl.style.background = '#f1f5f9';
          badgeEl.style.color = '#64748b';
        }
      }

      // Sincronización del estado de llamada
      handleGsmCallStateChange(callState, data);
      return;
    }
  } catch (_) {}

  // 2. Si falla en local (ej: Cloudflare Pages en HTTPS o servidor en la otra PC de la empresa)
  if (typeof sb !== 'undefined') {
    try {
      const { data: srv } = await sb.from('jjp_server_control')
        .select('status, heartbeat_at, updated_at, modules')
        .order('heartbeat_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (srv && srv.heartbeat_at) {
        const diffSec = Math.round((Date.now() - new Date(srv.heartbeat_at).getTime()) / 1000);
        if (diffSec < 75) {
          isRemoteServerActive = true;
          const gsmDevice = srv.modules?.gsm_device;

          if (gsmDevice && gsmDevice.connected) {
            gsmBridgeConnected = true;
            if (badgeEl) {
              badgeEl.textContent = `🟢 Celular Listo: ${gsmDevice.model || 'Android'}`;
              badgeEl.className = 'of-chip on';
              badgeEl.style.background = '#dcfce7';
              badgeEl.style.color = '#15803d';
            }
            if (gsmDevice.callState !== undefined) {
              handleGsmCallStateChange(gsmDevice.callState, gsmDevice);
            }
          } else if (gsmDevice && gsmDevice.state === 'unauthorized') {
            gsmBridgeConnected = false;
            if (badgeEl) {
              badgeEl.textContent = '🟡 Celular No Autorizado (Ver Pantalla)';
              badgeEl.className = 'of-chip';
              badgeEl.style.background = '#fef3c7';
              badgeEl.style.color = '#b45309';
            }
          } else if (gsmDevice && gsmDevice.adb_installed) {
            gsmBridgeConnected = false;
            if (badgeEl) {
              badgeEl.textContent = '🟡 Esperando Celular USB';
              badgeEl.className = 'of-chip';
              badgeEl.style.background = '#fef3c7';
              badgeEl.style.color = '#b45309';
            }
          } else {
            gsmBridgeConnected = true;
            if (badgeEl) {
              badgeEl.textContent = '🟢 Servidor GSM Online (Red JJ Paper)';
              badgeEl.className = 'of-chip on';
              badgeEl.style.background = '#dcfce7';
              badgeEl.style.color = '#15803d';
            }
          }
          return;
        }
      }
    } catch (_) {}
  }

  gsmBridgeConnected = false;
  isRemoteServerActive = false;
  if (badgeEl) {
    badgeEl.textContent = '⚪ Puente Desconectado';
    badgeEl.className = 'of-chip';
    badgeEl.style.background = '#f1f5f9';
    badgeEl.style.color = '#64748b';
  }
}

function handleGsmCallStateChange(newState, data) {
  const badgeEl = document.getElementById('pageCallStateBadge');
  const btnStart = document.getElementById('pageBtnStart');
  const btnHang = document.getElementById('pageBtnHang');
  const alertEl = document.getElementById('pageCallDialingAlert');

  // Transición 1: Llamada conectada y hablando (OFFHOOK = 2)
  if (newState === 2 && !pageIsCallActive) {
    pageIsCallActive = true;
    startConversationTimer();
    if (alertEl) alertEl.style.display = 'none';

    if (badgeEl) {
      badgeEl.textContent = '🟢 En Llamada Activa';
      badgeEl.style.background = '#dcfce7';
      badgeEl.style.color = '#15803d';
    }
    if (btnStart) btnStart.style.display = 'none';
    if (btnHang) btnHang.style.display = 'inline-flex';
  }

  // Transición 2: El teléfono cuelga (estaba en 2 y pasa a 0)
  if (newState === 0 && lastKnownGsmCallState === 2 && pageIsCallActive) {
    pageHangupCall(true); // Terminar automáticamente
  }

  lastKnownGsmCallState = newState;
}

// ----------------------------------------------------------------------------
// 6. INICIO Y FIN DE LLAMADA
// ----------------------------------------------------------------------------
async function pageStartCall() {
  const input = document.getElementById('pageDialerInput');
  const phone = input ? input.value.trim() : '';
  if (!phone) {
    if (typeof showToast === 'function') showToast('Ingresa un número antes de iniciar la llamada.', 'warn');
    return;
  }

  pageStopTimer();
  pageCallSeconds = 0;
  updateTimerDisplay();

  const badgeEl = document.getElementById('pageCallStateBadge');
  const btnStart = document.getElementById('pageBtnStart');
  const btnHang = document.getElementById('pageBtnHang');
  const alertEl = document.getElementById('pageCallDialingAlert');

  if (badgeEl) {
    badgeEl.textContent = '🟡 Marcando...';
    badgeEl.style.background = '#fef3c7';
    badgeEl.style.color = '#b45309';
  }
  if (btnStart) btnStart.style.display = 'none';
  if (btnHang) btnHang.style.display = 'inline-flex';
  if (alertEl) alertEl.style.display = 'block';

  // Iniciar Tono de Timbrado Telefónico (Ringback: tuuu... tuuu...) en el Headset de la PC
  window.JJPhoneAudio?.startRingback();

  let clean = phone.replace(/[^\d+]/g, '');

  try {
    const sessionData = {
      phone: clean,
      company: activeCallTarget?.company || phone,
      started_at: Date.now(),
      is_active: true,
      targetId: activeCallTarget?.id || null,
      zone: activeCallTarget?.zone || ''
    };
    localStorage.setItem('jjp_active_call_session', JSON.stringify(sessionData));
  } catch (_) {}

  let sentDirect = false;

  // A. Intentar por HTTP Local
  if (!isRemoteServerActive) {
    try {
      let res = await fetch('http://127.0.0.1:8789/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: clean })
      }).catch(() => null);

      if (!res || !res.ok) {
        res = await fetch('/lan/gsm/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: clean })
        }).catch(() => null);
      }

      if (res && res.ok) {
        sentDirect = true;
        const d = await res.json();
        if (d.requires_manual_tap) {
          if (typeof showToast === 'function') {
            showToast('📲 Número colocado en tu teléfono. Toca el botón verde en tu celular para hablar.', 'info');
          }
        } else {
          if (typeof showToast === 'function') {
            showToast(`📲 Marcando ${phone} por tu celular... ¡Habla desde tu Headset!`, 'info');
          }
        }
        return;
      }
    } catch (_) {}
  }

  // B. Fallback a Supabase para Servidor en otra PC o Cloudflare Pages (HTTPS)
  if (!sentDirect && typeof sb !== 'undefined') {
    try {
      await sb.from('jjp_server_control').update({
        command: 'call:' + clean,
        command_at: new Date().toISOString()
      }).eq('id', 1);

      if (typeof showToast === 'function') {
        showToast(`📲 Comando enviado al servidor GSM... Marcando ${phone}. ¡Habla desde tu Headset!`, 'info');
      }
      return;
    } catch (err) {
      console.warn('Error enviando comando a Supabase:', err);
    }
  }

  // C. Fallback para simulación o conteo manual
  if (typeof showToast === 'function') {
    showToast(`📲 Marcando ${phone}. Pulsa "Iniciar Conteo" cuando el cliente conteste.`, 'info');
  }
}

function manualStartTimer() {
  document.getElementById('pageCallDialingAlert').style.display = 'none';
  pageIsCallActive = true;
  startConversationTimer();
  const badgeEl = document.getElementById('pageCallStateBadge');
  if (badgeEl) {
    badgeEl.textContent = '🟢 En Llamada Activa';
    badgeEl.style.background = '#dcfce7';
    badgeEl.style.color = '#15803d';
  }
}

function startConversationTimer() {
  window.JJPhoneAudio?.playConnected(); // Detiene timbrado y avisa en headset
  if (pageCallTimer) clearInterval(pageCallTimer);
  pageCallTimer = setInterval(() => {
    pageCallSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function pageStopTimer() {
  if (pageCallTimer) {
    clearInterval(pageCallTimer);
    pageCallTimer = null;
  }
  pageIsCallActive = false;
}

function updateTimerDisplay() {
  const timerEl = document.getElementById('pageTimerDisplay');
  if (timerEl) {
    const mins = Math.floor(pageCallSeconds / 60).toString().padStart(2, '0');
    const secs = (pageCallSeconds % 60).toString().padStart(2, '0');
    timerEl.textContent = `${mins}:${secs} (${pageCallSeconds}s)`;
  }
}

async function pageHangupCall(autoHangup = false) {
  window.JJPhoneAudio?.playEnded(); // Reproduce tono de fin de llamada en headset
  pageStopTimer();

  try { localStorage.removeItem('jjp_active_call_session'); } catch (_) {}

  const alertEl = document.getElementById('pageCallDialingAlert');
  if (alertEl) alertEl.style.display = 'none';

  const badgeEl = document.getElementById('pageCallStateBadge');
  if (badgeEl) {
    badgeEl.textContent = `⏹️ Finalizada (${pageCallSeconds}s)`;
    badgeEl.style.background = '#f1f5f9';
    badgeEl.style.color = '#64748b';
  }

  const btnStart = document.getElementById('pageBtnStart');
  const btnHang = document.getElementById('pageBtnHang');
  if (btnStart) btnStart.style.display = 'inline-flex';
  if (btnHang) btnHang.style.display = 'none';

  // Intentar colgar local
  if (!isRemoteServerActive) {
    try {
      await fetch('http://127.0.0.1:8789/hangup', { method: 'POST' }).catch(() => null);
      await fetch('/lan/gsm/hangup', { method: 'POST' }).catch(() => null);
    } catch (_) {}
  }

  // Colgar remoto vía Supabase
  if (typeof sb !== 'undefined') {
    try {
      await sb.from('jjp_server_control').update({
        command: 'hangup',
        command_at: new Date().toISOString()
      }).eq('id', 1);
    } catch (_) {}
  }

  if (typeof showToast === 'function') {
    showToast(autoHangup 
      ? `Llamada finalizada por el celular (${pageCallSeconds}s). Procede a tipificar.`
      : `Llamada colgada (${pageCallSeconds}s). Procede a tipificar.`, 'info');
  }

  // Scroll suave hacia la sección de notas y tipificador
  document.getElementById('tipificadorSection')?.scrollIntoView({ behavior: 'smooth' });
}

// ----------------------------------------------------------------------------
// 7. ASISTENTE IA PARA LLAMADA (RESUMEN, INTERÉS Y PERSUASIÓN)
// ----------------------------------------------------------------------------
async function analyzeCallWithAi() {
  const notes = (document.getElementById('pageCallNotes')?.value || '').trim();
  const btn = document.getElementById('btnAiAnalyzeCall');
  const resultBox = document.getElementById('aiCallResultBox');
  const badgeEl = document.getElementById('aiInterestBadge');
  const summaryEl = document.getElementById('aiSummaryText');
  const waPreviewEl = document.getElementById('aiWaMessagePreview');

  if (!notes || notes.length < 5) {
    if (typeof showToast === 'function') {
      showToast('Escribe algunas notas de lo conversado antes de analizar con IA.', 'warn');
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Analizando con IA...';
  }

  const customerName = activeCallTarget?.company || 'Cliente';
  const duration = pageCallSeconds;

  try {
    let aiResult = null;

    // A. Si GeminiClient está disponible
    if (typeof GeminiClient !== 'undefined' && typeof GeminiClient.callGemini === 'function') {
      const prompt = `Actúa como Director Comercial de JJ Paper (Distribuidora de Papelería Mayorista en Venezuela).
Analiza las siguientes notas de una llamada telefónica B2B recién sostenida con el cliente "${customerName}" (Duración: ${duration} segundos).

NOTAS DE LA LLAMADA:
"""
${notes}
"""

Responde ESTRICTAMENTE con un objeto JSON sin markdown exterior con esta estructura:
{
  "interest_level": "alto" | "medio" | "bajo",
  "recommended_outcome": "interesado" | "cotizacion" | "rellamar" | "encargado" | "no_interesa",
  "detected_objections": ["Pide descuento o mejor precio por bulto", "Pide crédito a 15 o 30 días", "Tiene suficiente inventario por ahora", "Pide enviar catálogo por WhatsApp", "Pide cotización formal por correo", "El encargado solo atiende en la mañana", "Consulta condiciones de despacho y flete"],
  "executive_summary": "Resumen ejecutivo en 1-2 oraciones de lo acordado para el CRM.",
  "whatsapp_message": "Mensaje cordial y persuasivo para enviar por WhatsApp al cliente retomando lo conversado, confirmando disponibilidad de productos y ofreciendo cotización formal."
}`;

      const respText = await GeminiClient.callGemini({ prompt, maxTokens: 800, temperature: 0.3 });
      if (respText) {
        const cleanJson = respText.replace(/```json/g, '').replace(/```/g, '').trim();
        aiResult = JSON.parse(cleanJson);
      }
    }

    // B. Heurística de respaldo si no hay conexión externa
    if (!aiResult) {
      aiResult = heuristicAnalyzeCall(notes, customerName);
    }

    // Aplicar tipificación sugerida
    if (aiResult.recommended_outcome) {
      const chip = document.querySelector(`#tipificadorSection [data-outcome="${aiResult.recommended_outcome}"]`);
      if (chip) selectPageOutcome(chip);
    }

    // Activar argumentos detectados
    if (Array.isArray(aiResult.detected_objections)) {
      document.querySelectorAll('#tipificadorSection [data-arg]').forEach(btn => {
        const argText = btn.dataset.arg;
        if (aiResult.detected_objections.includes(argText)) {
          btn.classList.add('on');
          btn.style.background = '#dbeafe';
          btn.style.borderColor = '#3b82f6';
          btn.style.color = '#1d4ed8';
        }
      });
    }

    // Mostrar Tarjeta Visual de Resultados IA
    if (resultBox && badgeEl && summaryEl && waPreviewEl) {
      const lvl = (aiResult.interest_level || 'medio').toLowerCase();
      if (lvl === 'alto') {
        badgeEl.textContent = '🔥 INTERÉS COMERCIAL: ALTO (CALIENTE)';
        badgeEl.style.background = '#fee2e2';
        badgeEl.style.color = '#991b1b';
      } else if (lvl === 'medio') {
        badgeEl.textContent = '⚡ INTERÉS COMERCIAL: MEDIO (TIBIO)';
        badgeEl.style.background = '#fef3c7';
        badgeEl.style.color = '#92400e';
      } else {
        badgeEl.textContent = '❄️ INTERÉS COMERCIAL: BAJO / FRÍO';
        badgeEl.style.background = '#f1f5f9';
        badgeEl.style.color = '#475569';
      }

      summaryEl.textContent = aiResult.executive_summary || 'Resumen registrado.';
      waPreviewEl.textContent = aiResult.whatsapp_message || '';
      lastGeneratedWaMessage = aiResult.whatsapp_message || '';
      resultBox.style.display = 'block';
    }

    if (typeof showToast === 'function') {
      showToast('✨ Notas analizadas con IA: Tipificación y mensaje listos.', 'info');
    }

  } catch (err) {
    console.warn('Error en análisis IA:', err);
    if (typeof showToast === 'function') showToast('Análisis heurístico aplicado.', 'info');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🪄 Resumir & Tipificar con IA';
    }
  }
}

function heuristicAnalyzeCall(notes, customerName) {
  const n = notes.toLowerCase();
  let interest = 'medio';
  let outcome = 'interesado';
  const objections = [];

  if (n.includes('compr') || n.includes('factur') || n.includes('apart') || n.includes('precio') || n.includes('caja') || n.includes('bulto')) {
    interest = 'alto';
    outcome = 'interesado';
  } else if (n.includes('no') && (n.includes('interesa') || n.includes('tenemos') || n.includes('proveedor'))) {
    interest = 'bajo';
    outcome = 'no_interesa';
  }

  if (n.includes('cotiz') || n.includes('presupuesto')) outcome = 'cotizacion';
  if (n.includes('descuento') || n.includes('rebaja') || n.includes('mejor precio')) objections.push('Pide descuento o mejor precio por bulto');
  if (n.includes('crédito') || n.includes('credito') || n.includes('días') || n.includes('dias')) objections.push('Pide crédito a 15 o 30 días');
  if (n.includes('stock') || n.includes('inventario')) objections.push('Tiene suficiente inventario por ahora');
  if (n.includes('whatsapp') || n.includes('catálogo') || n.includes('catalogo')) objections.push('Pide enviar catálogo por WhatsApp');
  if (n.includes('flete') || n.includes('despacho') || n.includes('envío') || n.includes('envio')) objections.push('Consulta condiciones de despacho y flete');

  return {
    interest_level: interest,
    recommended_outcome: outcome,
    detected_objections: objections,
    executive_summary: `Contacto con ${customerName}: ${notes.slice(0, 120)}...`,
    whatsapp_message: `Hola ${customerName}, un gusto saludarte. Conforme a lo conversado hace un momento, con gusto te compartimos nuestra disponibilidad y cotización formal de JJ Paper con despacho directo. ¡Quedamos atentos a tus comentarios!`
  };
}

function copyAiWaMessage() {
  if (!lastGeneratedWaMessage) return;
  navigator.clipboard.writeText(lastGeneratedWaMessage).then(() => {
    if (typeof showToast === 'function') showToast('Mensaje de seguimiento copiado al portapapeles. 📋');
  });
}

function sendAiFollowupViaWa() {
  const phone = document.getElementById('pageDialerInput')?.value || activeCallTarget?.phone || '';
  if (!phone || !lastGeneratedWaMessage) {
    if (typeof showToast === 'function') showToast('Falta teléfono o mensaje para enviar.', 'warn');
    return;
  }
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) clean = '58' + clean.substring(1);
  else if (!clean.startsWith('58') && clean.length === 10) clean = '58' + clean;

  const url = `https://wa.me/${clean}?text=${encodeURIComponent(lastGeneratedWaMessage)}`;
  window.open(url, '_blank');
}

// ----------------------------------------------------------------------------
// 8. GUARDADO OMNICANAL EN BITÁCORA Y AUTO-AVANCE
// ----------------------------------------------------------------------------
async function savePageCallLog() {
  const selectedBtn = document.querySelector('#tipificadorSection .of-chip.on');
  const outcomeCode = selectedBtn ? selectedBtn.dataset.outcome : 'interesado';
  const outcomeText = selectedBtn ? selectedBtn.textContent.trim() : 'Llamada realizada';
  const rawNotes = (document.getElementById('pageCallNotes')?.value || '').trim();
  const phone = (document.getElementById('pageDialerInput')?.value || '').trim();

  const activeArgs = Array.from(document.querySelectorAll('#tipificadorSection [data-arg].on')).map(c => c.dataset.arg);
  const argsText = activeArgs.length ? ` [Argumentos: ${activeArgs.join('; ')}]` : '';

  const hasCallback = document.getElementById('pageEnableCallback')?.checked;
  const cbDate = hasCallback ? document.getElementById('pageCallbackDateTime')?.value : null;
  const cbReason = hasCallback ? document.getElementById('pageCallbackReason')?.value.trim() : '';

  pageStopTimer();

  const target = activeCallTarget || {
    id: null,
    company: 'Cliente Directo',
    name: '',
    phone,
    type: 'manual'
  };

  const timestamp = new Date().toLocaleString('es-VE');
  const summaryEntry = `[Llamada B2B ${timestamp} | ${pageCallSeconds}s]: ${outcomeText}.${argsText} ${rawNotes}${cbDate ? ` | Próxima Rellamada: ${new Date(cbDate).toLocaleString('es-VE')}` : ''}`;

  // 1. Guardar en Historial Local
  const history = JSON.parse(localStorage.getItem('jjp_call_history_v1') || '[]');
  history.unshift({
    id: 'call_' + Date.now(),
    phone,
    company: target.company,
    name: target.name,
    duration_seconds: pageCallSeconds,
    outcome: outcomeCode,
    outcome_text: outcomeText,
    arguments: activeArgs,
    notes: rawNotes,
    callback_at: cbDate,
    created_at: new Date().toISOString()
  });
  localStorage.setItem('jjp_call_history_v1', JSON.stringify(history.slice(0, 300)));

  // 2. Guardar en Agenda de Rellamadas
  if (hasCallback && cbDate) {
    const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]');
    callbacks.unshift({
      id: 'cb_' + Date.now(),
      targetId: target.id,
      phone,
      company: target.company,
      name: target.name,
      callback_at: cbDate,
      reason: cbReason || outcomeText
    });
    localStorage.setItem('jjp_callbacks_agenda_v1', JSON.stringify(callbacks.slice(0, 200)));
  }

  // 3. Persistir en Supabase (jjp_customers o jjp_prospects)
  try {
    if (target.id && typeof sb !== 'undefined') {
      const table = target.type === 'prospect' ? 'jjp_prospects' : 'jjp_customers';
      const { data: record } = await sb.from(table).select('notes, contact_count').eq('id', target.id).single();
      const currentNotes = (record && record.notes) ? record.notes : '';
      const newNotes = currentNotes ? `${summaryEntry}\n${currentNotes}` : summaryEntry;

      const updateData = {
        notes: newNotes,
        last_contact_at: new Date().toISOString(),
        last_contact_channel: 'llamada_gsm',
        contact_count: ((record && record.contact_count) || 0) + 1
      };

      if (table === 'jjp_prospects') {
        updateData.status = outcomeCode === 'interesado' ? 'interesado' : (outcomeCode === 'cotizacion' ? 'cotizacion_solicitada' : 'contactado_llamada');
        updateData.contacted = true;
      }
      if (cbDate) updateData.scheduled_callback_at = new Date(cbDate).toISOString();

      await sb.from(table).update(updateData).eq('id', target.id);
    }
  } catch (err) {
    console.warn('Error sincronizando bitácora con Supabase:', err);
  }

  if (typeof showToast === 'function') {
    showToast(`✅ Llamada de ${pageCallSeconds}s registrada en la bitácora.`);
  }

  // Refrescar widgets de historial
  loadCallbacksList();
  loadCallHistory();

  // Reset del cronómetro y notas
  pageCallSeconds = 0;
  updateTimerDisplay();
  document.getElementById('pageCallNotes').value = '';
  document.getElementById('aiCallResultBox').style.display = 'none';

  // 4. Auto-avanzar al siguiente cliente si está activado
  const autoAdvance = document.getElementById('queueAutoAdvance')?.checked;
  if (autoAdvance) {
    queueNext();
  }
}

// ----------------------------------------------------------------------------
// 9. FUNCIONES AUXILIARES DE TECLADO Y TIPIFICACIÓN
// ----------------------------------------------------------------------------
function onPageNumberChange(val) {
  const locInfo = window.JJDialer?.detectPhoneLocation ? window.JJDialer.detectPhoneLocation(val) : detectPhoneLocationLocal(val);
  const locEl = document.getElementById('pageLocDisplay');
  if (locEl) {
    locEl.textContent = locInfo?.label ? `📍 ${locInfo.label}` : 'Ingresa el número a marcar';
  }
}

function detectPhoneLocationLocal(raw) {
  if (!raw) return { label: 'Sin número' };
  const d = raw.replace(/\D/g, '');
  if (d.includes('414') || d.includes('424')) return { label: 'Móvil Movistar Venezuela' };
  if (d.includes('412')) return { label: 'Móvil Digitel Venezuela' };
  if (d.includes('416') || d.includes('426')) return { label: 'Móvil Movilnet Venezuela' };
  if (d.includes('212')) return { label: 'Fijo Caracas / La Guaira' };
  if (d.includes('241') || d.includes('242')) return { label: 'Fijo Carabobo' };
  if (d.includes('243') || d.includes('244')) return { label: 'Fijo Aragua' };
  return { label: 'Línea Telefónica Nacional' };
}

function pagePressKey(char) {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value += char;
  onPageNumberChange(input.value);
  window.JJPhoneAudio?.playDtmf(char);
}

function pageBackspace() {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value = input.value.slice(0, -1);
  onPageNumberChange(input.value);
}

function pageClearNumber() {
  const input = document.getElementById('pageDialerInput');
  if (!input) return;
  input.value = '';
  onPageNumberChange('');
}

function togglePageArg(btn) {
  btn.classList.toggle('on');
  if (btn.classList.contains('on')) {
    btn.style.background = '#dbeafe';
    btn.style.borderColor = '#3b82f6';
    btn.style.color = '#1d4ed8';
  } else {
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

function selectPageOutcome(btn) {
  document.querySelectorAll('#tipificadorSection .of-chip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');

  const code = btn.dataset.outcome;
  const cbBox = document.getElementById('pageCallbackBox');
  const chk = document.getElementById('pageEnableCallback');
  if (cbBox && chk) {
    if (code === 'rellamar' || code === 'encargado' || code === 'cotizacion') {
      chk.checked = true;
      cbBox.style.display = 'block';
      if (!document.getElementById('pageCallbackDateTime').value) {
        setPagePreset(code === 'cotizacion' ? '2d' : 'tomorrow_am');
      }
    }
  }
}

function setPagePreset(preset) {
  const dtInput = document.getElementById('pageCallbackDateTime');
  if (!dtInput) return;

  const targetDate = new Date();
  if (preset === '2h') targetDate.setHours(targetDate.getHours() + 2);
  else if (preset === 'tomorrow_am') {
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(9, 0, 0, 0);
  } else if (preset === 'tomorrow_pm') {
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setHours(14, 30, 0, 0);
  } else if (preset === '2d') {
    targetDate.setDate(targetDate.getDate() + 2);
    targetDate.setHours(10, 0, 0, 0);
  } else if (preset === 'next_week') {
    targetDate.setDate(targetDate.getDate() + 7);
    targetDate.setHours(10, 0, 0, 0);
  }

  const pad = n => String(n).padStart(2, '0');
  dtInput.value = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}T${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}`;
}

function toggleAudioGuide() {
  const g = document.getElementById('pageAudioHelp');
  if (g) g.style.display = g.style.display === 'block' ? 'none' : 'block';
}

function loadCallbacksList() {
  const container = document.getElementById('pageCallbacksList');
  if (!container) return;

  const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]');
  if (!callbacks.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;font-size:12px">No hay rellamadas agendadas pendientes.</div>';
    return;
  }

  const now = new Date();
  container.innerHTML = callbacks.map(cb => {
    let badge = '🟢 Programada';
    let badgeColor = '#15803d';
    let badgeBg = '#dcfce7';

    if (cb.callback_at) {
      const d = new Date(cb.callback_at);
      if (d < now) { badge = '🔴 Vencida'; badgeColor = '#b91c1c'; badgeBg = '#fee2e2'; }
      else if (d.toDateString() === now.toDateString()) { badge = '🟡 Para Hoy'; badgeColor = '#b45309'; badgeBg = '#fef3c7'; }
    }

    return `
      <div style="background:var(--theme-item-bg, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:12.5px;color:var(--theme-text-main, #0f172a)">${escapeHTML(cb.company)} <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor};font-weight:800">${badge}</span></div>
          <div style="font-size:11px;color:var(--theme-text-muted, #64748b)">📞 <strong>${escapeHTML(cb.phone)}</strong> · ⏰ ${cb.callback_at ? new Date(cb.callback_at).toLocaleString('es-VE') : ''}</div>
          ${cb.reason ? `<div style="font-size:10.5px;color:#0284c7;margin-top:2px"><em>${escapeHTML(cb.reason)}</em></div>` : ''}
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-p sm" onclick="loadSingleCustomerToDialer('${escapeHTML(cb.phone)}', '${escapeHTML(cb.company)}', '${escapeHTML(cb.name || '')}', '${cb.targetId || ''}')" style="background:#059669;padding:4px 8px;font-size:11px;font-weight:800">📞 Marcar</button>
          <button type="button" class="btn-o sm" onclick="deleteCallback('${cb.id}')" style="padding:4px 6px;font-size:11px">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function loadCallHistory() {
  const container = document.getElementById('pageHistoryList');
  if (!container) return;

  const history = JSON.parse(localStorage.getItem('jjp_call_history_v1') || '[]');
  if (!history.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--theme-text-muted, #64748b);font-size:12px">No hay llamadas registradas hoy.</div>';
    return;
  }

  container.innerHTML = history.slice(0, 15).map(h => `
    <div style="background:var(--theme-item-bg, #f8fafc);border:1px solid var(--theme-border-subtle, #e2e8f0);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="font-weight:700;font-size:12px;color:var(--theme-text-main, #0f172a)">${escapeHTML(h.company || 'Directo')} (${escapeHTML(h.phone)})</span>
        <span style="font-size:11px;font-weight:800;color:#0284c7">${h.duration_seconds}s</span>
      </div>
      <div style="font-size:11px;color:#10b981;font-weight:700">${escapeHTML(h.outcome_text || 'Llamada')}</div>
      ${h.notes ? `<div style="font-size:11px;color:var(--theme-text-muted, #64748b);margin-top:2px">${escapeHTML(h.notes)}</div>` : ''}
      <div style="font-size:10px;color:var(--theme-text-muted, #94a3b8);margin-top:4px">${new Date(h.created_at).toLocaleTimeString('es-VE')}</div>
    </div>
  `).join('');
}

function loadSingleCustomerToDialer(phone, company, name, id) {
  const dialerInput = document.getElementById('pageDialerInput');
  if (dialerInput) dialerInput.value = phone;
  onPageNumberChange(phone);
  activeCallTarget = { id, company, name, phone, type: id ? 'customer' : 'manual' };
  pageStartCall();
}

function deleteCallback(id) {
  const callbacks = JSON.parse(localStorage.getItem('jjp_callbacks_agenda_v1') || '[]').filter(x => x.id !== id);
  localStorage.setItem('jjp_callbacks_agenda_v1', JSON.stringify(callbacks));
  loadCallbacksList();
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Atajos de teclado para navegar entre clientes sin tocar el ratón
window.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
  
  // Alt+Right o ArrowRight (si no está escribiendo): Siguiente cliente
  if ((e.altKey && e.key === 'ArrowRight') || (!isTyping && e.key === 'ArrowRight')) {
    e.preventDefault();
    queueNext();
  }
  // Alt+Left o ArrowLeft (si no está escribiendo): Cliente anterior
  if ((e.altKey && e.key === 'ArrowLeft') || (!isTyping && e.key === 'ArrowLeft')) {
    e.preventDefault();
    queuePrev();
  }
});

