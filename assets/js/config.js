/* ======================================================
   JJ Paper — Supabase Config & App Constants
   ====================================================== */

const SUPABASE_URL = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Proyecto B — Comunicación (WhatsApp, Email, Difusión)
const SUPABASE_URL_COMM = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY_COMM = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Proyecto C — Storage e Inventario
const SUPABASE_URL_INV = 'https://166-0-112-247.sslip.io';
const SUPABASE_KEY_INV = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzI5NTAwMDAwLCJleHAiOjIwNDUwMDAwMDB9.N8ryyUns5c8oPlrV281Elg110i1eqZ8i5pN604bPW6w';

// Helper universal para extraer token Bearer de sesión de forma síncrona y segura
function getAuthToken() {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('sb-166-0-112-247-auth-token') : null;
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.access_token) return p.access_token;
    }
  } catch (_) {}
  return SUPABASE_KEY;
}

// Decodifica el payload de un JWT sin dependencias externas
function _decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

// Normaliza y lee la sesión activa desde localStorage
function _readStoredSession() {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('sb-166-0-112-247-auth-token') : null;
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || (!p.access_token && !p.user && !p.id)) return null;
    const claims = p.access_token ? (_decodeJwtPayload(p.access_token) || {}) : {};
    const uid = p.user?.id || p.id || p.sub || claims.sub || null;
    const email = p.user?.email || p.email || claims.email || '';
    const role = p.user?.role || p.role || claims.user_role || claims.role || 'authenticated';
    const user = p.user ? { ...p.user, id: uid, email, role } : {
      id: uid,
      email,
      role,
      user_metadata: p.user_metadata || claims.user_metadata || { name: p.name || email.split('@')[0] }
    };
    return {
      ...p,
      access_token: p.access_token || SUPABASE_KEY,
      refresh_token: p.refresh_token || p.access_token || '',
      user
    };
  } catch (_) {
    return null;
  }
}

// Fetch con inyección dinámica del JWT Bearer y limpieza de cabeceras bloqueadas por CORS en Nginx VPS
const _sovereignFetch = async (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  if (!headers.has('apikey')) headers.set('apikey', SUPABASE_KEY);
  const tok = getAuthToken();
  headers.set('Authorization', `Bearer ${tok}`);
  // Nginx en el VPS no incluye accept-profile ni content-profile en Access-Control-Allow-Headers;
  // PostgREST usa el esquema 'public' por defecto cuando se omiten.
  headers.delete('Accept-Profile');
  headers.delete('accept-profile');
  headers.delete('Content-Profile');
  headers.delete('content-profile');
  return fetch(input, { ...init, headers });
};

const _pgClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storageKey: 'sb-166-0-112-247-auth-token',
    detectSessionInUrl: false,
    persistSession: false,
    autoRefreshToken: false
  },
  global: {
    fetch: _sovereignFetch
  }
});

// Adaptador nativo de autenticación para el VPS soberano (compatible con las 30 llamadas a sb.auth.*)
const _authListeners = new Set();
function _notifyAuth(event, session) {
  for (const cb of _authListeners) {
    try { cb(event, session); } catch (_) {}
  }
}

const _sovereignAuth = {
  async getSession() {
    return { data: { session: _readStoredSession() }, error: null };
  },
  async getUser() {
    const s = _readStoredSession();
    return { data: { user: s?.user || null }, error: null };
  },
  async setSession(tokens = {}) {
    try {
      const current = _readStoredSession() || {};
      const nextTok = tokens.access_token || current.access_token;
      if (nextTok) {
        const claims = _decodeJwtPayload(nextTok) || {};
        const merged = {
          ...current,
          ...tokens,
          access_token: nextTok,
          refresh_token: tokens.refresh_token || current.refresh_token || nextTok,
          user: current.user || {
            id: claims.sub || current.id,
            email: claims.email || current.email || '',
            role: claims.user_role || claims.role || 'authenticated',
            user_metadata: claims.user_metadata || {}
          }
        };
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('sb-166-0-112-247-auth-token', JSON.stringify(merged));
        }
        _notifyAuth('TOKEN_REFRESHED', merged);
        return { data: { session: merged, user: merged.user }, error: null };
      }
    } catch (_) {}
    const s = _readStoredSession();
    return { data: { session: s, user: s?.user || null }, error: null };
  },
  async signInWithPassword({ email, password }) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/auth/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ email, password })
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok || !body.access_token) {
        return {
          data: { user: null, session: null },
          error: new Error(body.error_description || body.msg || body.error || 'Credenciales inválidas')
        };
      }
      const claims = _decodeJwtPayload(body.access_token) || {};
      const userObj = body.user || {
        id: claims.sub,
        email: claims.email || email,
        role: claims.user_role || claims.role || 'authenticated',
        user_metadata: claims.user_metadata || {}
      };
      const sessionObj = {
        access_token: body.access_token,
        refresh_token: body.refresh_token || body.access_token,
        token_type: 'bearer',
        expires_in: body.expires_in || 604800,
        user: userObj
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sb-166-0-112-247-auth-token', JSON.stringify(sessionObj));
      }
      _notifyAuth('SIGNED_IN', sessionObj);
      return { data: { user: userObj, session: sessionObj }, error: null };
    } catch (err) {
      return { data: { user: null, session: null }, error: err };
    }
  },
  async signInWithOAuth({ provider = 'google', options = {} } = {}) {
    const redirectTo = options.redirectTo || (typeof window !== 'undefined' ? window.location.origin + '/admin/login.html' : '');
    const qp = new URLSearchParams({ provider, redirect_to: redirectTo });
    if (options.scopes) qp.set('scopes', options.scopes);
    if (options.queryParams) {
      for (const [k, v] of Object.entries(options.queryParams)) qp.set(k, v);
    }
    const url = `${SUPABASE_URL}/auth/v1/authorize?${qp.toString()}`;
    if (typeof window !== 'undefined') window.location.href = url;
    return { data: { provider, url }, error: null };
  },
  async signOut() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('sb-166-0-112-247-auth-token');
      }
      _notifyAuth('SIGNED_OUT', null);
    } catch (_) {}
    return { error: null };
  },
  async updateUser(attrs = {}) {
    const s = _readStoredSession();
    if (s && s.user) {
      s.user = { ...s.user, ...attrs, user_metadata: { ...(s.user.user_metadata || {}), ...(attrs.data || {}) } };
      try { localStorage.setItem('sb-166-0-112-247-auth-token', JSON.stringify(s)); } catch (_) {}
    }
    return { data: { user: s?.user || null }, error: null };
  },
  onAuthStateChange(cb) {
    if (typeof cb === 'function') {
      _authListeners.add(cb);
      setTimeout(() => {
        const s = _readStoredSession();
        if (s) {
          try { cb('INITIAL_SESSION', s); } catch (_) {}
        }
      }, 0);
    }
    return {
      data: {
        subscription: {
          unsubscribe() { _authListeners.delete(cb); }
        }
      }
    };
  }
};

try {
  Object.defineProperty(_pgClient, 'auth', {
    value: _sovereignAuth,
    writable: true,
    configurable: true
  });
} catch (_) {
  _pgClient.auth = _sovereignAuth;
}

// Adaptador soberano de Storage para el VPS (convierte subidas a Data URI + KV en jjp_settings)
const _localMediaStore = new Map();

function _blobToDataUri(fileOrBlob, fallbackMime) {
  return new Promise((resolve, reject) => {
    if (typeof fileOrBlob === 'string') {
      if (fileOrBlob.startsWith('data:')) return resolve(fileOrBlob);
      return resolve(`data:${fallbackMime || 'application/octet-stream'};base64,${btoa(unescape(encodeURIComponent(fileOrBlob)))}`);
    }
    if (typeof FileReader !== 'undefined' && fileOrBlob instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(fileOrBlob);
      return;
    }
    reject(new Error('Objeto de archivo no soportado para conversión Base64'));
  });
}

function _createSovereignBucket(bucketName) {
  return {
    async upload(path, fileOrBlob, opts = {}) {
      try {
        const mime = opts.contentType || fileOrBlob?.type || 'application/octet-stream';
        const dataUri = await _blobToDataUri(fileOrBlob, mime);
        const cleanPath = String(path || '').replace(/^\/+/, '');
        const fullKey = `${bucketName}/${cleanPath}`;
        _localMediaStore.set(fullKey, dataUri);

        const settingKey = `storage:${bucketName}:${cleanPath}`;
        try {
          await _sovereignFetch(`${SUPABASE_URL}/rest/v1/jjp_settings?on_conflict=key`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify({ key: settingKey, value: dataUri })
          });
        } catch (_) {}

        return { data: { path: cleanPath, id: cleanPath, fullPath: fullKey, dataUri }, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },
    async createSignedUrl(path) {
      if (!path) return { data: null, error: new Error('Ruta vacía') };
      const cleanPath = String(path).replace(/^\/+/, '');
      if (cleanPath.startsWith('data:') || /^https?:\/\//i.test(cleanPath)) {
        return { data: { signedUrl: cleanPath }, error: null };
      }
      const fullKey = `${bucketName}/${cleanPath}`;
      if (_localMediaStore.has(fullKey)) {
        return { data: { signedUrl: _localMediaStore.get(fullKey) }, error: null };
      }
      try {
        const settingKey = `storage:${bucketName}:${cleanPath}`;
        const resp = await _sovereignFetch(`${SUPABASE_URL}/rest/v1/jjp_settings?key=eq.${encodeURIComponent(settingKey)}&select=value`);
        if (resp.ok) {
          const rows = await resp.json();
          if (rows && rows[0]?.value) {
            _localMediaStore.set(fullKey, rows[0].value);
            return { data: { signedUrl: rows[0].value }, error: null };
          }
        }
      } catch (_) {}
      return {
        data: { signedUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucketName}/${cleanPath}` },
        error: null
      };
    },
    getPublicUrl(path) {
      const cleanPath = String(path || '').replace(/^\/+/, '');
      if (cleanPath.startsWith('data:') || /^https?:\/\//i.test(cleanPath)) {
        return { data: { publicUrl: cleanPath } };
      }
      const fullKey = `${bucketName}/${cleanPath}`;
      if (_localMediaStore.has(fullKey)) {
        return { data: { publicUrl: _localMediaStore.get(fullKey) } };
      }
      return {
        data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${bucketName}/${cleanPath}` }
      };
    },
    async download(path) {
      const { data, error } = await this.createSignedUrl(path);
      if (error || !data?.signedUrl) return { data: null, error: error || new Error('No encontrado') };
      try {
        const resp = await fetch(data.signedUrl);
        if (!resp.ok) return { data: null, error: new Error(`HTTP ${resp.status}`) };
        return { data: await resp.blob(), error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },
    async list() {
      return { data: [], error: null };
    },
    async remove(paths = []) {
      for (const p of paths) {
        const cleanPath = String(p || '').replace(/^\/+/, '');
        _localMediaStore.delete(`${bucketName}/${cleanPath}`);
      }
      return { data: paths, error: null };
    }
  };
}

const _sovereignStorage = {
  from(bucketName) {
    return _createSovereignBucket(bucketName);
  },
  async listBuckets() {
    return {
      data: [
        { id: 'jjp-products', name: 'jjp-products', public: true },
        { id: 'jjp-wa-media', name: 'jjp-wa-media', public: false },
        { id: 'jjp-email-media', name: 'jjp-email-media', public: false },
        { id: 'jjp-receipts', name: 'jjp-receipts', public: false }
      ],
      error: null
    };
  },
  async getBucket(id) {
    return { data: { id, name: id, public: id === 'jjp-products' }, error: null };
  }
};

try {
  Object.defineProperty(_pgClient, 'storage', {
    value: _sovereignStorage,
    writable: true,
    configurable: true
  });
} catch (_) {}

const _FLAT_CATALOG_SELECT = 'id,name,description,price_usd,price_a,price_b,price_c_bs,price_d_bs,mixnet_status,unit,image_url,emoji,tag,featured,essential,stock,min_qty,category_id,sku,sort_order,jjp_categories(name,slug,color,group_id),jjp_product_variants(id,variant_name,sku,barcode,price_usd,price_a,price_b,price_c_bs,price_d_bs,active,stock,min_qty,image_url,sort_order,jjp_brands(name,logo_url))';

// Adaptador transparente para jjp_server_control (empaqueta/desempaqueta campos extra dentro de modules JSONB)
function _createServerControlQuery() {
  return {
    select() {
      const q = _pgClient.from('jjp_server_control').select('id,heartbeat_at,updated_at,modules');
      const wrap = (prom) => prom.then(res => {
        if (!res || !res.data) return res;
        const unpack = (r) => {
          if (!r || typeof r !== 'object') return r;
          const m = (r.modules && typeof r.modules === 'object') ? r.modules : {};
          return {
            ...r,
            heartbeat: r.heartbeat_at || m.heartbeat || null,
            status: m.status || (r.heartbeat_at ? 'online' : 'offline'),
            host: m.host || 'VPS-Soberano',
            started_at: m.started_at || r.updated_at || null,
            command: m.command || null,
            command_res: m.command_res || null,
            command_at: m.command_at || null
          };
        };
        return {
          ...res,
          data: Array.isArray(res.data) ? res.data.map(unpack) : unpack(res.data)
        };
      });
      const proxy = new Proxy(q, {
        get(t, p) {
          if (p === 'maybeSingle' || p === 'single') {
            return (...args) => wrap(t[p](...args));
          }
          if (p === 'eq' || p === 'limit' || p === 'order') {
            return (...args) => {
              t[p](...args);
              return proxy;
            };
          }
          if (p === 'then') {
            const w = wrap(Promise.resolve(t));
            return w.then.bind(w);
          }
          const v = Reflect.get(t, p);
          return typeof v === 'function' ? v.bind(t) : v;
        }
      });
      return proxy;
    },
    update(patch = {}) {
      return {
        async eq(col, val) {
          try {
            const { data: cur } = await _pgClient.from('jjp_server_control').select('modules').eq(col, val).maybeSingle();
            const curMods = (cur && cur.modules && typeof cur.modules === 'object') ? cur.modules : {};
            const nextMods = {
              ...curMods,
              ...(patch.modules && typeof patch.modules === 'object' ? patch.modules : {})
            };
            for (const k of ['command', 'command_at', 'command_by', 'command_res', 'status', 'host', 'started_at']) {
              if (k in patch) nextMods[k] = patch[k];
            }
            const dbPatch = {
              updated_at: new Date().toISOString(),
              modules: nextMods
            };
            if ('heartbeat_at' in patch) dbPatch.heartbeat_at = patch.heartbeat_at;
            else if ('heartbeat' in patch) dbPatch.heartbeat_at = patch.heartbeat;
            return await _pgClient.from('jjp_server_control').update(dbPatch).eq(col, val);
          } catch (err) {
            return { data: null, error: err };
          }
        }
      };
    },
    upsert(patch = {}, opts = {}) {
      return this.update(patch).eq('id', patch.id || 1);
    }
  };
}

// Adaptador transparente para jjp_catalog_flat -> consulta jjp_products con relaciones en vivo sin errores 404
function _createCatalogFlatQuery() {
  const base = _pgClient.from('jjp_products');
  return new Proxy(base, {
    get(t, p) {
      if (p === 'select') {
        return function () {
          return base.select(_FLAT_CATALOG_SELECT).eq('active', true);
        };
      }
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}

// Proxy transparente en `sb` unificado para el VPS soberano
const sb = new Proxy(_pgClient, {
  get(target, prop, receiver) {
    if (prop === 'auth') return _sovereignAuth;
    if (prop === 'storage') return _sovereignStorage;
    if (prop === 'from') {
      return function (tableName) {
        if (tableName === 'jjp_catalog_flat') return _createCatalogFlatQuery();
        if (tableName === 'jjp_server_control') return _createServerControlQuery();
        return _pgClient.from(tableName);
      };
    }
    if (prop === 'rpc') {
      return async function (fnName, params = {}, options) {
        if (fnName === 'jjp_next_doc_serial') {
          const serial = await fetchNextDocSerial(params.p_type || params.p_tipo || 'pedido');
          return { data: serial, error: serial ? null : new Error('No se pudo obtener serial') };
        }
        if (fnName === 'jjp_refresh_catalog_flat') {
          try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem('jjp_products_cache_v8');
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('jjp_products_cache_v8');
          } catch (_) {}
          return { data: true, error: null };
        }
        if (fnName === 'jjp_delete_order') {
          const oid = params.p_order_id || params.p_id;
          const { error } = await _pgClient.from('jjp_orders').delete().eq('id', oid);
          return { data: !error, error };
        }
        if (fnName === 'jjp_delete_email_campaign') {
          const cid = params.p_campaign_id || params.p_id;
          await _pgClient.from('jjp_email_campaign_targets').delete().eq('campaign_id', cid);
          const { error } = await _pgClient.from('jjp_email_campaigns').delete().eq('id', cid);
          return { data: !error, error };
        }
        if (fnName === 'jjp_wa_delete_chat') {
          const chatId = params.p_chat_id || params.p_id;
          await _pgClient.from('jjp_wa_messages').delete().eq('chat_id', chatId);
          const { error } = await _pgClient.from('jjp_wa_chats').delete().eq('id', chatId);
          return { data: !error, error };
        }
        if (fnName === 'jjp_wa_purge_chats') {
          const ownerId = params.p_owner || params.p_owner_id;
          const { data: chats } = await _pgClient.from('jjp_wa_chats').select('id').eq('owner_id', ownerId);
          const ids = (chats || []).map(c => c.id);
          if (ids.length) {
            await _pgClient.from('jjp_wa_messages').delete().in('chat_id', ids);
            await _pgClient.from('jjp_wa_chats').delete().in('id', ids);
          }
          return { data: true, error: null };
        }
        if (fnName === 'jjp_email_request_attachments') {
          const eid = params.p_id;
          const { error } = await _pgClient.from('jjp_emails').update({ attach_state: 'requested' }).eq('id', eid);
          return { data: !error, error };
        }
        return _pgClient.rpc(fnName, params, options);
      };
    }
    if (prop === 'channel') {
      return function (name, opts) {
        return _pgClient.channel(name, opts);
      };
    }
    const val = Reflect.get(target, prop, receiver);
    return typeof val === 'function' ? val.bind(target) : val;
  }
});

const _rawSbCore = sb;
const _rawSbComm = sb;
const _rawSbInv  = sb;
const sbCore = sb;
const sbComm = sb;
const sbInv  = sb;

if (typeof window !== 'undefined') {
  window.sb = sb;
  window.sbCore = sbCore;
  window.sbComm = sbComm;
  window.sbInv = sbInv;
}

// --- Cazador de retorno de OAuth (login con Google) ---------------------------
// Si Supabase, por su "Site URL", devuelve el token a una página pública en vez
// de al login, lo reenviamos a admin/login.html (conservando el #access_token)
// para que enrute por rol. NO da acceso a nada: login.html valida perfil+activo
// antes de entrar, y todas las páginas del panel exigen requireAuth. Corre ANTES
// de que supabase-js consuma el hash (misma vuelta síncrona).
(function routeOAuthToLogin() {
  try {
    const h = location.hash || '';
    if (!/[#&](access_token|error|error_description)=/.test(h)) return;
    const p = location.pathname;
    if (/\/(admin|vendedor)\//.test(p)) return;            // ya está en zona de login/panel
    const base = p.replace(/[^/]*$/, '');                  // carpeta actual (normalmente "/")
    location.replace(location.origin + base + 'admin/login.html' + location.search + h);
  } catch (e) { /* nunca bloquear la carga del sitio por esto */ }
})();

// App config
const APP = {
  WA_NUM:        '584121234567',
  WA_MSG:        'Hola JJ Paper, quisiera informacion sobre sus productos.',
  SITE_NAME:     'JJ Paper',
  STORAGE_URL:   `${SUPABASE_URL}/storage/v1/object/public/jjp-products/`,
  STORAGE_URL_INV: `${SUPABASE_URL_INV}/storage/v1/object/public/jjp-products/`,
  RECEIPTS_BUCKET: 'jjp-receipts',
  PER_PAGE:      12,
  CART_KEY:      'jjp_cart_v2',
  RATE_KEY:      'jjp_rate',     // sessionStorage key for exchange rate
  SETTINGS:      {},             // full settings map, populated by loadSettings()
};

// Load settings from Supabase, cache with 15-minute TTL and background revalidation
async function loadSettings(force = false) {
  const cached = sessionStorage.getItem('jjp_settings') || localStorage.getItem('jjp_settings');
  const cachedAt = parseInt(sessionStorage.getItem('jjp_settings_at') || localStorage.getItem('jjp_settings_at') || '0', 10);
  const isFresh = (Date.now() - cachedAt) < 15 * 60 * 1000;

  if (cached && !force) {
    try {
      const map = JSON.parse(cached);
      applySettings(map);
      if (isFresh) {
        ensureFreshRate().catch(() => {});
        return map;
      }
    } catch (_) {}
  }

  try {
    const { data, error } = await sb.from('jjp_settings').select('key,value').not('key', 'like', 'storage:%');
    if (!error && data) {
      const map = {};
      data.forEach(r => { map[r.key] = r.value; });
      try {
        const now = Date.now().toString();
        localStorage.setItem('jjp_settings', JSON.stringify(map));
        localStorage.setItem('jjp_settings_at', now);
        sessionStorage.setItem('jjp_settings', JSON.stringify(map));
        sessionStorage.setItem('jjp_settings_at', now);
      } catch (_) {}
      applySettings(map);
      ensureFreshRate().catch(() => {});
      return map;
    }
  } catch (e) {
    console.warn('loadSettings network warning:', e);
  }

  ensureFreshRate().catch(() => {});
  return {};
}

// Expose settings on APP for the whole app
function applySettings(map) {
  APP.SETTINGS = map;
  const rateVal = parseFloat(map.exchange_rate || map.rate_bcv || 0);
  if (rateVal > 0) {
    APP.EXCHANGE_RATE = rateVal;
    try { sessionStorage.setItem(APP.RATE_KEY, String(rateVal)); } catch (_) {}
  }
  if (map.whatsapp_number) APP.WA_NUM = map.whatsapp_number;
  if (map.whatsapp_message) APP.WA_MSG = map.whatsapp_message;
  // Todos los enlaces marcados con data-wa-msg usan el número configurado
  document.querySelectorAll('[data-wa-msg]').forEach(el => {
    el.href = `https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(el.dataset.waMsg || APP.WA_MSG)}`;
  });
  // Disparar evento de actualización de tasa para componentes reactivos
  try {
    window.dispatchEvent(new CustomEvent('jjp_rate_updated', { detail: { rate: getRate(), settings: map } }));
  } catch (_) {}
  // Keep injected footer/contact info in sync (nav.js)
  if (typeof refreshContactUI === 'function') refreshContactUI();
}

// Parse "DD/MM/YYYY HH:MM" (formato usado en rates_updated_at) → Date o null
function parseVeDate(str) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/.exec(String(str || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
}

// Si la tasa guardada tiene más de 3h, busca las tasas en vivo (dolarapi)
// y las usa para mostrar precios. No escribe en la base (el público no puede);
// el cron del servidor (cada hora) y el panel admin son quienes persisten.
async function ensureFreshRate() {
  try {
    // Preferir el timestamp ISO (UTC, sin ambigüedad de zona horaria);
    // el formato Caracas queda como fallback para datos viejos.
    const iso = APP.SETTINGS?.rates_updated_iso;
    const upd = iso ? new Date(iso) : parseVeDate(APP.SETTINGS?.rates_updated_at);
    const age = (upd && !isNaN(upd)) ? (Date.now() - upd.getTime()) : Infinity;
    if (age < 3 * 3600 * 1000) return;

    // Aplica tasas en vivo a la sesión: BCV (precios) y paralelo (costos/brecha)
    const applyLive = (r) => {
      if (r.bcv) {
        APP.EXCHANGE_RATE = r.bcv;
        try { sessionStorage.setItem(APP.RATE_KEY, String(r.bcv)); } catch (_) {}
        window.dispatchEvent(new CustomEvent('jjp_rate_updated', { detail: { rate: r.bcv, settings: APP.SETTINGS } }));
      }
      if (r.paralelo && APP.SETTINGS) {
        APP.SETTINGS.usdt_rate = String(Math.max(r.paralelo, r.bcv || 0));
      }
    };
    // Throttle: no consultar la API más de una vez por hora por sesión
    const cached = JSON.parse(sessionStorage.getItem('jjp_live_rate') || 'null');
    if (cached && Date.now() - cached.at < 3600 * 1000) {
      applyLive(cached);
      return;
    }
    const rates = await fetchRates();
    if (rates?.bcv) {
      applyLive(rates);
      sessionStorage.setItem('jjp_live_rate', JSON.stringify({ ...rates, at: Date.now() }));
    }
  } catch (e) { /* la tasa guardada sigue siendo el fallback */ }
}

/* ------------------------------------------------------
   Atribución de vendedor por link de referido (?ref=codigo)
   Se guarda 30 días: toda compra en ese lapso se atribuye.
   ------------------------------------------------------ */
const REF_KEY = 'jjp_ref';
const REF_TTL = 30 * 86400e3;   // 30 días

(function captureRef() {
  try {
    const code = new URLSearchParams(location.search).get('ref');
    if (code && /^[a-z0-9_-]{2,30}$/i.test(code)) {
      localStorage.setItem(REF_KEY, JSON.stringify({ code: code.toLowerCase(), at: Date.now() }));
    }
  } catch (e) {}
})();

// Código de referido vigente (o null si no hay / expiró)
function getRefCode() {
  try {
    const r = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (!r || Date.now() - r.at > REF_TTL) return null;
    return r.code;
  } catch (e) { return null; }
}

// Resuelve el seller_id del código vigente (RPC pública, cachea por sesión)
async function resolveRefSeller() {
  const code = getRefCode();
  if (!code) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem('jjp_ref_seller') || 'null');
    if (cached && cached.code === code) return cached.id;
    const { data } = await sb.rpc('jjp_seller_by_ref', { p_code: code });
    if (data) sessionStorage.setItem('jjp_ref_seller', JSON.stringify({ code, id: data }));
    return data || null;
  } catch (e) { return null; }
}

// Normaliza texto para búsquedas sin distinguir acentos/mayúsculas
function normTxt(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Current exchange rate (USD -> Bs) with sane fallback
// Tasa con la que se convierte USD → Bs.
// El vendedor puede fijar la suya (se carga en APP.SELLER_RATE desde sus
// ajustes en vcommon.js); si no, se usa la oficial (BCV) global del negocio.
function getRate() {
  if (APP.SELLER_RATE) return APP.SELLER_RATE;
  return APP.EXCHANGE_RATE || parseFloat(sessionStorage.getItem(APP.RATE_KEY)) || 40;
}

// Convert USD → Bs
function toBs(usd) {
  return (usd * getRate()).toFixed(2);
}

// Format price display
function fmtPrice(usd) {
  return `$${parseFloat(usd).toFixed(2)}`;
}
function fmtBs(usd) {
  return `Bs ${toBs(usd)}`;
}

// Product image: if image_url exists use it; else show emoji on colored bg
function productImgHTML(p, size = 56) {
  if (p.image_url) {
    return `<img src="${p.image_url}" alt="${p.name}" loading="lazy">`;
  }
  const ico = (typeof productIcon === 'function') ? productIcon(p) : (p.emoji || '📦');
  return `<span style="font-size:${size}px">${ico}</span>`;
}

/* ------------------------------------------------------
   Accesibilidad: manejo de foco para diálogos (modal/carrito)
   ------------------------------------------------------ */
const FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Atrapa Tab dentro de `container` y devuelve función para soltar el trap.
// Recuerda quién tenía el foco para restaurarlo al cerrar.
function trapFocus(container) {
  if (!container) return () => {};
  const prevActive = document.activeElement;
  // getClientRects() funciona con contenedores position:fixed (offsetParent daría null)
  const focusables = () => [...container.querySelectorAll(FOCUSABLE_SEL)]
    .filter(el => el.getClientRects().length > 0 || el === document.activeElement);

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);

  // Foco inicial al primer control del diálogo
  setTimeout(() => { focusables()[0]?.focus(); }, 30);

  return () => {
    container.removeEventListener('keydown', onKey);
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  };
}

// URL de OpenStreetMap embebido a partir de lat/lng (marcador centrado)
function osmEmbed(lat, lng, d = 0.004) {
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

// Enlace "abrir en OpenStreetMap" (para el botón Cómo llegar)
function osmLink(lat, lng, z = 16) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${z}/${lat}/${lng}`;
}

// Imagen de producto: URL directa de Supabase Storage.
// El deploy vive en Cloudflare Pages, donde /.netlify/images no existe (daba 404
// y rompía todas las imágenes en producción). Las imágenes ya se comprimen al
// subir, así que la URL original es suficiente. `width` se acepta por
// compatibilidad con los call sites pero no se usa.
function optImg(url, width) {
  if (!url) return url;
  return encodeURI(url);
}

// WhatsApp open
function openWA(msg) {
  window.open(`https://wa.me/${APP.WA_NUM}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Date display helper
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('es-VE', { day:'2-digit', month:'2-digit', year:'numeric' });
}

// Format Bs with thousands separators (es-VE)
function fmtBsNum(bs) {
  return 'Bs ' + Number(bs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escape user/DB text before injecting into innerHTML (prevents XSS / broken markup)
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Obtención del correlativo oficial soberano MixNet (8 dígitos: ej. 00053494 / 00112771)
// MXNUMCOT / MXNUMPED son los dueños sagrados de la correlativa serial. Prohibido inventar números aleatorios.
async function fetchNextDocSerial(type = 'pedido') {
  const isCot = (type === 'cotizacion' || type === 'quote' || type === 'COT');
  const settingKey = isCot ? 'mixnet_next_quote_serial' : 'mixnet_next_order_serial';

  // 1. Si estamos en HTTP local / localhost, probar el puente LAN directo
  if (typeof location !== 'undefined' && (location.protocol === 'http:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const lanHosts = ['http://localhost:8787', 'http://192.168.0.185:8790'];
    for (const host of lanHosts) {
      try {
        const resp = await fetch(`${host}/lan/mixnet/next-serial?type=${isCot ? 'cotizacion' : 'pedido'}`, {
          signal: AbortSignal.timeout(450)
        });
        if (resp.ok) {
          const body = await resp.json();
          if (body?.ok && body.serial && /^\d{8}$/.test(String(body.serial).trim())) {
            return String(body.serial).trim();
          }
        }
      } catch (_) {}
    }
  }

  // 2. Consultar en paralelo el serial sincronizado por MixNet en jjp_settings y el último documento en BD
  let fromSetting = 0;
  let fromTable = 0;
  const table = isCot ? 'jjp_quotes' : 'jjp_orders';
  const field = isCot ? 'quote_number' : 'order_number';

  try {
    const [sRes, tRes] = await Promise.allSettled([
      _pgClient.from('jjp_settings').select('value').eq('key', settingKey).maybeSingle(),
      _pgClient.from(table).select(field).order('created_at', { ascending: false }).limit(25)
    ]);

    if (sRes.status === 'fulfilled' && sRes.value?.data?.value) {
      const sv = parseInt(String(sRes.value.data.value).replace(/\D/g, ''), 10);
      if (!isNaN(sv) && sv > 0) fromSetting = sv;
    }

    if (tRes.status === 'fulfilled' && Array.isArray(tRes.value?.data)) {
      for (const r of tRes.value.data) {
        const val = String(r[field] || '').trim();
        if (/^\d{5,8}$/.test(val)) {
          const tv = parseInt(val, 10) + 1;
          if (!isNaN(tv) && tv > fromTable) fromTable = tv;
        }
      }
    }
  } catch (_) {}

  const best = Math.max(fromSetting, fromTable);
  if (best > 0) {
    const formatted = String(best).padStart(8, '0').slice(-8);
    // Incrementar en jjp_settings de forma asíncrona para evitar colisión en la siguiente emisión
    _sovereignFetch(`${SUPABASE_URL}/rest/v1/jjp_settings?on_conflict=key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: settingKey, value: String(best + 1) })
    }).catch(() => {});
    return formatted;
  }

  console.error(`[MXNUM CRITICAL] No se pudo obtener el correlativo soberano de MixNet para ${type}.`);
  return null;
}

function genOrderNumber() {
  console.warn('genOrderNumber(): funcion obsoleta. Use fetchNextDocSerial()');
  return null;
}

/* ======================================================
   Tasas y lógica de precios
   - BCV: tasa oficial → cara al cliente (Bs = USD × BCV)
   - USDT/Binance: tasa a la que compran los distribuidores → costo real
   La brecha entre ambas se incorpora al precio, invisible al cliente.
   ====================================================== */

// Tasa BCV (la que ve el cliente) — es el exchange_rate
function getBcvRate() { return getRate(); }

// Tasa Binance/USDT (para el costo). Si no está configurada, usa la BCV (brecha 0).
function getUsdtRate() {
  const r = parseFloat(APP.SETTINGS?.usdt_rate);
  return (r && r > 0) ? r : getBcvRate();
}

// % de brecha entre Binance y BCV
function getGapPct() {
  const bcv = getBcvRate(), usdt = getUsdtRate();
  if (!bcv) return 0;
  return (usdt / bcv - 1) * 100;
}

// Tasa euro BCV (Bs por EUR). 0 si no está configurada.
function getEurRate() {
  const r = parseFloat(APP.SETTINGS?.rate_eur);
  return (r && r > 0) ? r : 0;
}

// Conversiones con el euro (vía Bs, todas las tasas son Bs/divisa):
//   USD → EUR: monto × BCV_usd / BCV_eur   (para cotizar en €)
//   EUR → USD: monto × BCV_eur / BCV_usd   (costos de proveedor en €)
function usdToEur(usd) {
  const eur = getEurRate(), bcv = getBcvRate();
  return (eur && bcv) ? Number(usd) * bcv / eur : null;
}
function eurToUsd(eurAmt) {
  const eur = getEurRate(), bcv = getBcvRate();
  return (eur && bcv) ? Number(eurAmt) * eur / bcv : null;
}
// Costo en EUR de proveedor → costo ajustado a "USD-BCV" (pasa por Binance igual
// que los costos en USDT: el € del proveedor se repone comprando divisa real).
function eurCostAdjustedUSD(costEur) {
  const usd = eurToUsd(costEur);
  return usd == null ? null : adjustedCostUSD(usd);
}

// Margen global por defecto (%)
function getDefaultMargin() {
  const m = parseFloat(APP.SETTINGS?.default_margin_pct);
  return isNaN(m) ? 0 : m;
}

// Costo ajustado a "USD-BCV": lo que realmente cuesta en el mundo BCV
function adjustedCostUSD(costUsd) {
  const bcv = getBcvRate();
  return bcv ? (Number(costUsd) * getUsdtRate() / bcv) : Number(costUsd);
}

// Precio de venta sugerido en USD = costo ajustado × (1 + margen)
function suggestedPriceUSD(costUsd, marginPct) {
  const m = (marginPct === '' || marginPct == null || isNaN(parseFloat(marginPct)))
    ? getDefaultMargin() : parseFloat(marginPct);
  const price = adjustedCostUSD(costUsd) * (1 + m / 100);
  return Math.round(price * 100) / 100;
}

// Margen real de un precio dado, sobre el costo ajustado (para diagnóstico)
function realMarginPct(priceUsd, costUsd) {
  const adj = adjustedCostUSD(costUsd);
  if (!adj) return null;
  return ((Number(priceUsd) - adj) / adj) * 100;
}

// Trae las 3 tasas: BCV (oficial, dolarapi), Binance P2P real (CriptoYa)
// y Monitor/paralelo (dolarapi). Devuelve { bcv, binance, monitor, paralelo } o null.
// "paralelo" queda como alias de binance por compatibilidad.
async function fetchRates() {
  const getJson = async (url) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
    finally { clearTimeout(t); }
  };
  try {
    const [dolar, cripto, euros] = await Promise.all([
      getJson('https://ve.dolarapi.com/v1/dolares'),
      getJson('https://criptoya.com/api/USDT/VES/1'),
      getJson('https://ve.dolarapi.com/v1/euros'),
    ]);
    const find = f => Number(dolar?.find?.(d => d.fuente === f)?.promedio) || null;
    const bcv = find('oficial'), monitor = find('paralelo');
    const eur = Number(euros?.find?.(d => d.fuente === 'oficial')?.promedio) || null;
    // Binance P2P: promedio ask/bid; si falla, mediana de otros P2P; si no, monitor.
    const mid = x => (x && x.ask > 0 && x.bid > 0) ? (x.ask + x.bid) / 2
              : (x?.ask > 0 ? x.ask : (x?.bid > 0 ? x.bid : null));
    let binance = mid(cripto?.binancep2p);
    if (!binance && cripto) {
      const o = ['bybitp2p', 'bitgetp2p', 'bingxp2p', 'okexp2p']
        .map(k => mid(cripto[k])).filter(Boolean).sort((a, b) => a - b);
      binance = o.length ? o[Math.floor(o.length / 2)] : null;
    }
    binance = binance || monitor;
    if (!bcv && !binance) return null;
    return { bcv, binance, monitor, eur, paralelo: binance };
  } catch (e) {
    console.warn('fetchRates error:', e);
    return null;
  }
}
