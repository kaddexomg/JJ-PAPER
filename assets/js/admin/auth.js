/* ======================================================
   JJ Paper — Authentication & Roles (admin / vendedor)
   ====================================================== */

let CURRENT_PROFILE = null;

// Raíz del sitio calculada desde la URL actual (funciona en dominio raíz,
// en subcarpeta y con file://). Las páginas de staff viven en /admin/ y
// /vendedor/, un nivel bajo la raíz.
function siteBase() {
  const path = location.pathname;
  const m = path.match(/^(.*?\/)(admin|vendedor)\//);
  if (m) return m[1];                       // ".../"  (raíz real del sitio)
  return path.replace(/[^/]*$/, '');        // página pública en la raíz
}

// URL absoluta a una ruta del sitio, respetando la raíz real
function siteURL(rel) {
  return location.origin + siteBase() + rel.replace(/^\/+/, '');
}

// Carga (y cachea) el perfil del usuario logueado desde jjp_profiles
async function loadProfile(passedSession) {
  if (CURRENT_PROFILE) return CURRENT_PROFILE;
  let session = passedSession;
  if (!session) {
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session;
    } catch (_) {}
  }
  if (!session) {
    try {
      const raw = localStorage.getItem('sb-166-0-112-247-auth-token');
      if (raw) session = JSON.parse(raw);
    } catch (_) {}
  }
  const uid = session?.user?.id || session?.id;
  if (!uid) return null;
  const { data, error } = await sb.from('jjp_profiles')
    .select('id,role,name,phone,ref_code,commission_pct,max_discount_pct,monthly_goal_usd,active')
    .eq('id', uid).single();
  if (error) {
    console.warn('loadProfile error from PostgREST:', error);
  }
  CURRENT_PROFILE = data || null;
  if (typeof window !== 'undefined') {
    window.CURRENT_PROFILE = CURRENT_PROFILE;
    window.SELLER = CURRENT_PROFILE;
  }
  if (typeof SELLER !== 'undefined') {
    try { SELLER = CURRENT_PROFILE; } catch (e) {}
  }
  return CURRENT_PROFILE;
}

// Protege páginas por rol.
//  - requiredRole 'admin': solo admins (vendedor es redirigido a su panel)
//  - requiredRole 'vendedor': staff activo (vendedor o admin)
async function requireAuth(requiredRole = 'admin') {
  let session = null;
  try {
    const { data } = await sb.auth.getSession();
    session = data?.session;
  } catch (_) {}
  if (!session) {
    try {
      const raw = localStorage.getItem('sb-166-0-112-247-auth-token');
      if (raw) session = JSON.parse(raw);
    } catch (_) {}
  }
  if (!session || (!session.access_token && !session.user)) {
    window.location.href = siteURL('admin/login');
    return null;
  }
  const profile = await loadProfile(session);

  // Sin perfil o desactivado → fuera
  if (!profile || !profile.active) {
    await sb.auth.signOut().catch(() => {});
    try { localStorage.removeItem('sb-166-0-112-247-auth-token'); } catch (_) {}
    window.location.href = siteURL('admin/login');
    return null;
  }
  // Un vendedor no puede entrar a páginas de admin → a su propio panel
  if (requiredRole === 'admin' && profile.role !== 'admin') {
    window.location.href = siteURL('vendedor/');
    return null;
  }
  return session;
}

async function adminLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function adminLogout() {
  CURRENT_PROFILE = null;
  try { localStorage.removeItem('sb-166-0-112-247-auth-token'); } catch (_) {}
  await sb.auth.signOut().catch(() => {});
  window.location.href = siteURL('admin/login');
}

function renderUserBar(session) {
  const el = document.getElementById('adminUserEmail');
  if (el && (session?.user || session)) {
    el.textContent = CURRENT_PROFILE?.name || session?.user?.email || session?.email || '—';
  }
}

// Ruta principal según el rol con el que se inició sesión (post-login)
function roleHome(profile) {
  return siteURL(profile?.role === 'admin' ? 'admin/' : 'vendedor/');
}
