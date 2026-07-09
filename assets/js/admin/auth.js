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
async function loadProfile() {
  if (CURRENT_PROFILE) return CURRENT_PROFILE;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data } = await sb.from('jjp_profiles')
    .select('id,role,name,phone,ref_code,commission_pct,max_discount_pct,monthly_goal_usd,active')
    .eq('id', session.user.id).single();
  CURRENT_PROFILE = data || null;
  return CURRENT_PROFILE;
}

// Protege páginas por rol.
//  - requiredRole 'admin': solo admins (vendedor es redirigido a su panel)
//  - requiredRole 'vendedor': staff activo (vendedor o admin)
async function requireAuth(requiredRole = 'admin') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = siteURL('admin/login.html');
    return null;
  }
  const profile = await loadProfile();

  // Sin perfil o desactivado → fuera
  if (!profile || !profile.active) {
    await sb.auth.signOut();
    window.location.href = siteURL('admin/login.html');
    return null;
  }
  // Un vendedor no puede entrar a páginas de admin → a su propio panel
  if (requiredRole === 'admin' && profile.role !== 'admin') {
    window.location.href = siteURL('vendedor/index.html');
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
  await sb.auth.signOut();
  window.location.href = siteURL('admin/login.html');
}

function renderUserBar(session) {
  const el = document.getElementById('adminUserEmail');
  if (el && session?.user) el.textContent = CURRENT_PROFILE?.name || session.user.email;
}

// Ruta principal según el rol con el que se inició sesión (post-login)
function roleHome(profile) {
  return siteURL(profile?.role === 'admin' ? 'admin/index.html' : 'vendedor/index.html');
}
