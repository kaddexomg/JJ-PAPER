/* ======================================================
   JJ Paper Vendedor — utilidades compartidas del panel
   ====================================================== */

let SELLER = null;   // perfil del vendedor logueado

// Inicializa una página del panel vendedor: auth, barra, menú, badge
async function initSellerPage() {
  const session = await requireAuth('vendedor');
  if (!session) return null;
  SELLER = CURRENT_PROFILE;

  const el = document.getElementById('sellerName');
  if (el) el.textContent = SELLER.name || session.user.email;

  document.getElementById('menuToggleBtn')?.addEventListener('click', () => {
    document.getElementById('adminAside')?.classList.toggle('op');
  });

  await loadSettings();
  await loadSellerSettings();
  refreshSellerNotifBadge();
  return SELLER;
}

// Carga los ajustes personales del vendedor (jjp_seller_settings):
//   rate_usd (tasa del día), signature (firma) y show_bs.
// Los expone en APP.SELLER_RATE / APP.SELLER_SIGNATURE / APP.SELLER_SHOW_BS.
// Cada vendedor solo lee sus propias filas (RLS).
async function loadSellerSettings() {
  APP.SELLER_RATE = null;
  APP.SELLER_SIGNATURE = '';
  APP.SELLER_SHOW_BS = true;   // por defecto se muestran los Bs
  if (!SELLER?.id) return;

  try {
    const { data } = await sb.from('jjp_seller_settings')
      .select('key,value').eq('seller_id', SELLER.id);
    const map = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    if (map.rate_usd) {
      const r = parseFloat(map.rate_usd);
      if (r > 0) {
        APP.SELLER_RATE = r;
        APP.SELLER_RATE_AT = map.rate_updated_at || '';
      }
    }
    APP.SELLER_SIGNATURE = String(map.signature || '').trim();
    APP.SELLER_SHOW_BS = map.show_bs !== '0';
  } catch (e) {
    console.warn('No se pudieron cargar los ajustes del vendedor:', e);
  }
}

// Firma del vendedor para sus mensajes a clientes (o cadena vacía).
function sellerSign(texto) {
  const firma = APP.SELLER_SIGNATURE || '';
  if (!firma) return texto || '';
  const t = texto || '';
  return t.includes(firma) ? t : `${t}\n\n— ${firma}`;
}

// ¿El vendedor quiere ver los precios en bolívares? (por defecto sí)
function sellerShowBs() {
  return APP.SELLER_SHOW_BS !== false;
}

// Badge de notificaciones no leídas en el sidebar
async function refreshSellerNotifBadge() {
  const badge = document.getElementById('vNotifBadge');
  if (!badge) return;
  const { count } = await sb.from('jjp_notifications')
    .select('id', { count: 'exact', head: true }).eq('read', false);
  badge.style.display = count ? 'inline-block' : 'none';
  badge.textContent = count || '';
}

// Link de venta del vendedor (atribución por referido)
function sellerRefLink() {
  if (!SELLER?.ref_code) return null;
  return `${location.origin}/catalogo.html?ref=${encodeURIComponent(SELLER.ref_code)}`;
}

// Estados que cuentan como venta confirmada
const V_PAID = ['pagado', 'preparando', 'entregado'];

// Etiquetas compartidas
const V_STATUS_LABEL = {
  pendiente_pago: 'Pendiente de pago',
  verificando:    'Verificando pago',
  pagado:         'Pagado',
  preparando:     'Preparando',
  entregado:      'Entregado',
  rechazado:      'Rechazado',
  cancelado:      'Cancelado',
};
