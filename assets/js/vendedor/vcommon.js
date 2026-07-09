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
  refreshSellerNotifBadge();
  return SELLER;
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
