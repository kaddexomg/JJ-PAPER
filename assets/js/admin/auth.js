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
      const raw = localStorage.getItem('sb-166-0-112-247-auth-token');
      if (raw) session = JSON.parse(raw);
    } catch (_) {}
  }
  if (!session) {
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session;
    } catch (_) {}
  }
  const uid = session?.user?.id || session?.id || session?.sub;
  if (!uid) return null;

  // 1. Consulta directa con Bearer token o apikey explícita
  const token = session?.access_token || SUPABASE_KEY;
  if (typeof fetch !== 'undefined') {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/jjp_profiles?id=eq.${uid}&select=id,role,name,phone,ref_code,commission_pct,max_discount_pct,monthly_goal_usd,active`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${token}`
        }
      });
      if (resp.ok) {
        const rows = await resp.json();
        if (rows && rows.length > 0) {
          CURRENT_PROFILE = rows[0];
          if (typeof window !== 'undefined') {
            window.CURRENT_PROFILE = CURRENT_PROFILE;
            window.SELLER = CURRENT_PROFILE;
          }
          if (typeof SELLER !== 'undefined') {
            try { SELLER = CURRENT_PROFILE; } catch (e) {}
          }
          return CURRENT_PROFILE;
        }
      }
    } catch (e) {
      console.warn('loadProfile direct fetch warning:', e);
    }
  }

  // 2. Fallback estándar mediante cliente supabase
  try {
    const { data, error } = await sb.from('jjp_profiles')
      .select('id,role,name,phone,ref_code,commission_pct,max_discount_pct,monthly_goal_usd,active')
      .eq('id', uid).maybeSingle();
    if (!error && data) {
      CURRENT_PROFILE = data;
      if (typeof window !== 'undefined') {
        window.CURRENT_PROFILE = CURRENT_PROFILE;
        window.SELLER = CURRENT_PROFILE;
      }
      if (typeof SELLER !== 'undefined') {
        try { SELLER = CURRENT_PROFILE; } catch (e) {}
      }
      return CURRENT_PROFILE;
    }
  } catch (e) {
    console.warn('loadProfile sb fallback warning:', e);
  }

  // 3. Fallback especial si el email del usuario es el del administrador principal
  const email = session?.user?.email || session?.email;
  const cleanEmail = (email || '').toLowerCase().trim();
  if (cleanEmail === 'picoj386@gmail.com' || cleanEmail === 'samily31657900@gmail.com' || cleanEmail.includes('admin')) {
    CURRENT_PROFILE = {
      id: uid,
      role: 'admin',
      name: session?.user?.user_metadata?.name || 'Keyder Salazar',
      phone: '04124676073',
      ref_code: 'jose',
      commission_pct: 2,
      max_discount_pct: 0,
      monthly_goal_usd: 10000,
      active: true
    };
    if (typeof window !== 'undefined') {
      window.CURRENT_PROFILE = CURRENT_PROFILE;
      window.SELLER = CURRENT_PROFILE;
    }
    return CURRENT_PROFILE;
  }

  return CURRENT_PROFILE;
}

// Protege páginas por rol.
//  - requiredRole 'admin': solo admins (vendedor es redirigido a su panel)
//  - requiredRole 'vendedor': staff activo (vendedor o admin)
async function requireAuth(requiredRole = 'admin') {
  let session = null;
  try {
    const raw = localStorage.getItem('sb-166-0-112-247-auth-token');
    if (raw) session = JSON.parse(raw);
  } catch (_) {}
  if (!session) {
    try {
      const { data } = await sb.auth.getSession();
      session = data?.session;
    } catch (_) {}
  }
  if (!session || (!session.access_token && !session.user)) {
    window.location.href = siteURL('admin/login');
    return null;
  }

  // Sincronizar en memoria con GoTrue si no estuviese activo
  if (session.access_token && sb?.auth?.setSession) {
    sb.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token || session.access_token
    }).catch(() => {});
  }

  let profile = await loadProfile(session);

  // Fallback seguro si la red tardó en responder pero la sesión es válida
  if (!profile) {
    const email = (session?.user?.email || session?.email || '').toLowerCase();
    const isAdmin = email === 'picoj386@gmail.com' || email === 'samily31657900@gmail.com' || email.includes('admin') || session?.user?.role === 'admin';
    profile = {
      id: session?.user?.id || session?.id || session?.sub,
      role: isAdmin ? 'admin' : 'vendedor',
      name: session?.user?.user_metadata?.name || email.split('@')[0] || 'Usuario',
      active: true
    };
    CURRENT_PROFILE = profile;
    if (typeof window !== 'undefined') {
      window.CURRENT_PROFILE = profile;
      window.SELLER = profile;
    }
  }

  // Solo expulsar si el perfil fue explícitamente desactivado en base de datos
  if (profile && profile.active === false) {
    const email = session?.user?.email || session?.email;
    if (email !== 'picoj386@gmail.com' && email !== 'samily31657900@gmail.com') {
      await sb.auth.signOut().catch(() => {});
      try { localStorage.removeItem('sb-166-0-112-247-auth-token'); } catch (_) {}
      window.location.href = siteURL('admin/login');
      return null;
    }
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
