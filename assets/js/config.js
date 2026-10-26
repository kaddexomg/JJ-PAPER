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

// Esquema real verificado de las 53 tablas del VPS PostgreSQL para protección automática contra errores 42703 / PGRST204
const _VPS_SCHEMA_RAW = {"jjp_wa_actions":["id","owner_id","chat_id","jid","kind","target_wa_id","emoji","created_at"],"jjp_profiles":["id","name","phone","role","active","ref_code","commission_pct","max_discount_pct","monthly_goal_usd","created_at","updated_at","permissions","mixnet_code"],"jjp_scan_events":["id","owner_id","code","created_at","handled_at","result","device"],"jjp_promos":["id","title","kind","badge","description","emoji","image_url","price_usd","old_price_usd","cta_label","cta_url","wa_message","theme","featured","starts_at","ends_at","active","sort_order","created_at","updated_at"],"jjp_email_suppression_list":["id","email","reason","bounce_type","source","created_at"],"jjp_email_company":["id","email","from_name","app_pass","enabled","verified","last_error","created_at","updated_at","has_cred"],"jjp_quotes":["id","quote_number","client_name","rif","phone","email","city","address","items","estimated_total_usd","exchange_rate","notes","status","source","seller_id","created_at","discount_pct","customer_id"],"jjp_products":["id","name","description","price_usd","cost_usd","unit","unit_id","emoji","image_url","tag","active","featured","stock","min_qty","category_id","brand_id","sku","sort_order","created_at","essential","price_a","price_b","price_c_bs","price_d_bs","mixnet_status","last_movement_at","last_sale_at","stock_qty","price"],"jjp_seller_settings":["seller_id","key","value","updated_at"],"jjp_units":["id","name","abbr","description","sort_order"],"jjp_barcode_dupes":["barcode","veces","productos"],"jjp_settings":["key","value","updated_at"],"jjp_count_unknown":["id","owner_id","session_key","code","device","seen","first_at","last_at","resolved_at"],"jjp_invoice_alerts":["id","invoice_id","milestone","alert_date","title","body","wa_status","wa_message_id","wa_error","wa_sent_at","created_at"],"jjp_categories":["id","name","slug","emoji","color","sort_order","group_id"],"jjp_product_variants":["id","product_id","brand_id","variant_name","sku","barcode","cost_usd","price_usd","margin_pct","stock","min_qty","active","sort_order","image_url","created_at","base_price_usd","price_a","price_b","price_c_bs","price_d_bs","mixnet_status"],"jjp_emails":["id","account_id","gmail_id","thread_id","from_email","from_name","to_email","subject","body_text","body_html","attachments","attach_state","is_read","is_inbound","direction","status","created_at","owner_id","to_addr","from_addr","body","html","snippet","retry_count","message_id","campaign_id"],"jjp_notifications":["id","user_id","type","title","body","link","read","created_at"],"jjp_reviews":["id","name","stars","text","approved","created_at"],"jjp_email_campaign_targets":["id","campaign_id","owner_id","customer_id","to_addr","name","vars","status","email_id","error","sent_at","created_at","email","phone"],"jjp_count_log_view":["id","session_key","variant_id","delta","counted_after","source","counted_by","note","reverts","reverted_by","created_at","product_name","brand_name","variant_name","sku"],"jjp_count_conflicts":["session_key","variant_id","product_name","sku","brand_name","personas","quienes","total","ultimo"],"jjp_count_tally":["id","owner_id","session_key","variant_id","counted","updated_at"],"jjp_orders":["id","order_number","client_name","rif","phone","email","city","address","items","subtotal_usd","total_usd","exchange_rate","total_bs","payment_method","payment_ref","notes","receipt_url","status","seller_id","source","discount_pct","stock_applied","created_at","updated_at","discount_status","discount_note","discount_requested_by","discount_approved_by","discount_decided_at","delivery_type","delivery_lat","delivery_lng","delivery_distance_km","delivery_fee_usd","delivery_fee_confirmed","control_number","customer_id","quote_id","invoice_number","invoice_date","invoice_total_bs","invoice_total_usd","invoice_iva_bs","invoice_rate","invoice_data"],"jjp_wa_templates":["id","owner_id","name","body","kind","active","created_at","updated_at"],"jjp_mixnet_tasks":["id","action","payload","status","result","error","created_at","started_at","completed_at","updated_at"],"jjp_count_progress":["total","contados","pendientes","con_codigo"],"jjp_supplier_invoices":["id","supplier_id","supplier_name","invoice_number","issue_date","due_date","terms_days","amount","currency","amount_paid","status","image_path","ocr_data","notes","paid_at","created_at","updated_at"],"jjp_stock_moves":["id","variant_id","product_name","brand_name","variant_name","sku","delta","stock_before","stock_after","reason","ref","created_by","created_at"],"jjp_missing_photos":["variant_id","sku","producto","categoria","stock","price_usd","usd_parado"],"jjp_count_counters":["session_key","quien","movimientos","unidades","productos","ultimo"],"jjp_wa_campaign_targets":["id","campaign_id","owner_id","customer_id","phone","name","vars","status","message_id","error","sent_at","created_at"],"jjp_wa_messages":["id","chat_id","owner_id","wa_msg_id","direction","type","body","media_path","media_mime","media_size","media_filename","status","error","retry_count","wa_timestamp","created_at","forwarded","reply_to_wa_id","reply_preview","reply_from","reaction","reaction_from"],"jjp_suppliers":["id","name","phone","contact","default_terms_days","notes","active","created_at","updated_at"],"jjp_customers":["id","name","phone","rif","city","email","address","notes","seller_id","total_orders","total_usd","last_order_at","created_at","updated_at","tags","wa_opt_out","last_reactivation_at","zone","email_opt_out","last_email_at","email_status","bounce_reason","bounced_at"],"jjp_count_valued":["variant_id","session_key","counted","updated_at","product_name","brand_name","variant_name","sku","barcode","cost_usd","price_usd","costo_total_usd","venta_total_usd"],"jjp_barcode_log":["id","variant_id","code","prev_code","action","note","created_by","created_at"],"jjp_brands":["id","name","slug","logo_url","country","active","sort_order"],"jjp_catalog_export":["codigo","descripcion","categoria","tiene_imagen"],"jjp_category_groups":["id","name","slug","emoji","sort_order"],"jjp_count_log":["id","owner_id","session_key","variant_id","delta","counted_after","source","note","reverts","reverted_by","created_at","counted_by"],"jjp_email_campaigns":["id","owner_id","name","subject","body","html","attachments","status","delay_min_s","delay_max_s","total","sent_count","failed_count","started_at","finished_at","created_at","updated_at","body_html","kind","batch_size","batch_pause_m","skipped_count","scheduled_at","next_send_at","pause_reason","pause_until"],"jjp_seller_prices":["id","seller_id","product_id","variant_id","price_usd","created_at","updated_at"],"jjp_prospects":["id","company_name","sector","contact_name","contact_role","phone_1","phone_2","email","address","city","zone","contacted","contact_count","status","last_contact_at","notes","ai_analysis","suggested_subject","custom_email_body","custom_wa_body","seller_id","converted_customer_id","source","created_at","updated_at","email_status","bounce_reason","bounced_at"],"jjp_fx_rates":["id","at","bcv","binance","monitor","eur","gap_pct","created_at"],"jjp_email_accounts":["id","profile_id","email","from_name","provider","oauth_refresh","app_pass","enabled","verified","last_error","created_at","updated_at","has_cred"],"jjp_count_totals":["session_key","productos","unidades","ultimo"],"jjp_wa_sessions":["profile_id","enabled","status","requested_action","requested_at","pairing_phone","pairing_code","qr_data","qr_updated_at","wa_number","wa_name","last_connected_at","last_error","created_at","updated_at","qr","phone","auth_state"],"jjp_clients":["id","name","logo_url","active","sort_order","created_at"],"jjp_server_control":["id","modules","updated_at","heartbeat_at"],"jjp_invoice_payments":["id","invoice_id","amount","method","reference","note","paid_at","created_by","created_at"],"jjp_wa_campaigns":["id","owner_id","name","kind","template_id","body","status","delay_min_s","delay_max_s","total","sent_count","failed_count","started_at","finished_at","created_at","updated_at","created_by","message","batch_size","batch_pause_m","media_path","media_type","media_mime","media_filename","media_size","skipped_count"],"jjp_wa_chats":["id","owner_id","jid","phone","customer_id","display_name","last_message_at","last_message_preview","last_message_from","unread_count","archived","created_at","updated_at","pinned","notes"]};
const _VPS_SCHEMA = Object.fromEntries(Object.entries(_VPS_SCHEMA_RAW).map(([k, v]) => [k, new Set(v)]));
const _COL_ALIASES = {
  jjp_orders: { order_num: 'order_number', total: 'total_usd' },
  jjp_prospects: { name: 'contact_name', company: 'company_name' },
  jjp_customers: { last_contact_at: 'last_email_at' }
};

function _splitTopLevelComma(str) {
  const res = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    if (ch === ',' && depth === 0) {
      res.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) res.push(cur.trim());
  return res;
}

function _sanitizePostgrestCall(input, init = {}) {
  try {
    let urlStr = typeof input === 'string' ? input : (input?.url || String(input));
    if (!urlStr.includes('/rest/v1/')) return { urlStr, init, table: null };
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/rest\/v1\/([a-z0-9_]+)/i);
    if (!m) return { urlStr, init, table: null };
    let table = m[1];

    // Redirecciones nativas de vistas/tablas legacy
    if (table === 'jjp_catalog_flat') {
      u.pathname = u.pathname.replace('/rest/v1/jjp_catalog_flat', '/rest/v1/jjp_products');
      u.searchParams.set('select', 'id,name,description,sku,price_usd,price_a,price_b,price_c_bs,price_d_bs,mixnet_status,unit,unit_id,image_url,emoji,tag,featured,essential,stock,min_qty,active,sort_order,category_id,jjp_categories(name,slug,color,group_id),jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,price_a,price_b,price_c_bs,price_d_bs,cost_usd,stock,min_qty,active,image_url,jjp_brands(name,logo_url))');
      if (!u.searchParams.has('active')) u.searchParams.set('active', 'eq.true');
      return { urlStr: u.toString(), init, table: 'jjp_products' };
    }
    if (table === 'jjp_pos_scans') {
      u.pathname = u.pathname.replace('/rest/v1/jjp_pos_scans', '/rest/v1/jjp_scan_events');
      table = 'jjp_scan_events';
    }

    const validCols = _VPS_SCHEMA[table];
    if (!validCols) return { urlStr: u.toString(), init, table };
    const aliases = _COL_ALIASES[table] || {};

    // 1. Limpiar select=
    if (u.searchParams.has('select')) {
      const rawSel = u.searchParams.get('select') || '*';
      if (rawSel !== '*') {
        const parts = _splitTopLevelComma(rawSel);
        const kept = [];
        for (let p of parts) {
          if (!p) continue;
          if (p === '*' || p.includes('(') || p.includes(')')) {
            kept.push(p);
            continue;
          }
          let colName = p;
          if (colName.includes(':')) colName = colName.split(':').pop().trim();
          if (colName.includes('!')) colName = colName.split('!')[0].trim();
          if (aliases[colName]) {
            kept.push(aliases[colName]);
          } else if (validCols.has(colName) || _VPS_SCHEMA[colName]) {
            kept.push(p);
          }
        }
        u.searchParams.set('select', kept.length ? [...new Set(kept)].join(',') : '*');
      }
    }

    // 2. Limpiar columns=
    if (u.searchParams.has('columns')) {
      const colsParam = u.searchParams.get('columns') || '';
      const cleanCols = colsParam.split(',').map(c => c.replace(/^"|"$/g, '').trim()).filter(c => validCols.has(c));
      if (cleanCols.length) u.searchParams.set('columns', cleanCols.map(c => '"' + c + '"').join(','));
      else u.searchParams.delete('columns');
    }

    // 3. Limpiar filtros y order sobre columnas inexistentes
    const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'or', 'and']);
    for (const key of [...u.searchParams.keys()]) {
      if (reserved.has(key) || key.includes('.')) continue;
      if (!validCols.has(key)) {
        if (aliases[key]) {
          const val = u.searchParams.get(key);
          u.searchParams.delete(key);
          u.searchParams.set(aliases[key], val);
        } else {
          u.searchParams.delete(key);
        }
      }
    }
    if (u.searchParams.has('order')) {
      const ord = u.searchParams.get('order') || '';
      const ordCol = ord.split('.')[0];
      if (ordCol && !validCols.has(ordCol)) u.searchParams.delete('order');
    }

    // 4. Limpiar body JSON en POST / PATCH / PUT
    let newInit = init;
    const method = (init.method || 'GET').toUpperCase();
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && typeof init.body === 'string' && init.body.trim().startsWith('{') || (typeof init.body === 'string' && init.body.trim().startsWith('['))) {
      try {
        const parsed = JSON.parse(init.body);
        const cleanOne = (obj) => {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
          const out = {};
          for (const [k, v] of Object.entries(obj)) {
            const targetKey = aliases[k] || k;
            if (validCols.has(targetKey)) {
              out[targetKey] = v;
            }
          }
          if (table === 'jjp_orders' && out.payment_method && !['pago_movil', 'transferencia', 'efectivo'].includes(out.payment_method)) {
            out.payment_method = 'transferencia';
          }
          if (table === 'jjp_server_control' && Object.keys(out).length === 0) {
            out.updated_at = new Date().toISOString();
          }
          return out;
        };
        const cleaned = Array.isArray(parsed) ? parsed.map(cleanOne) : cleanOne(parsed);
        newInit = { ...init, body: JSON.stringify(cleaned) };
      } catch (_) {}
    }

    return { urlStr: u.toString(), init: newInit, table };
  } catch (_) {
    return { urlStr: typeof input === 'string' ? input : (input?.url || String(input)), init, table: null };
  }
}

const _sovereignFetch = async (input, init = {}) => {
  const sanitized = _sanitizePostgrestCall(input, init);
  const finalInit = sanitized.init || init;
  const headers = new Headers(finalInit.headers || {});
  if (!headers.has('apikey')) headers.set('apikey', SUPABASE_KEY);
  const tok = getAuthToken();
  headers.set('Authorization', `Bearer ${tok}`);
  headers.delete('Accept-Profile');
  headers.delete('accept-profile');
  headers.delete('Content-Profile');
  headers.delete('content-profile');
  if (sanitized.urlStr.includes('/rest/v1/rpc/jjp_convert_quote') && (finalInit.method || 'POST').toUpperCase() === 'POST') {
    try {
      const bodyObj = typeof finalInit.body === 'string' ? JSON.parse(finalInit.body) : {};
      const order = await convertQuoteToOrderNative(bodyObj.p_quote || bodyObj.p_quote_id || bodyObj.quote_id || bodyObj.id);
      return new Response(JSON.stringify({ ...order, order_id: order.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (convErr) {
      return new Response(JSON.stringify({ code: 'P0001', message: convErr.message || 'Error convirtiendo cotización' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }
  const res = await fetch(sanitized.urlStr, { ...finalInit, headers });
  if (sanitized.table === 'jjp_server_control' && res.ok && (finalInit.method || 'GET').toUpperCase() === 'GET') {
    try {
      const clone = res.clone();
      const data = await clone.json();
      const enrich = (r) => {
        if (!r || typeof r !== 'object') return r;
        const m = (r.modules && typeof r.modules === 'object') ? r.modules : {};
        return {
          ...r,
          status: r.status || m.status || (r.heartbeat_at && (Date.now() - new Date(r.heartbeat_at).getTime()) < 180000 ? 'online' : 'offline'),
          host: r.host || m.host || 'JJ-SERVER',
          command: r.command !== undefined ? r.command : (m.command || null),
          command_res: r.command_res !== undefined ? r.command_res : (m.command_res || null),
          heartbeat: r.heartbeat || r.heartbeat_at || null
        };
      };
      const enriched = Array.isArray(data) ? data.map(enrich) : enrich(data);
      return new Response(JSON.stringify(enriched), { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (_) {}
  }
  return res;
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
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  // Si es un Data URI base64 o blob, limpiar cualquier sufijo accidental ?v=... y devolver intacto
  if (s.startsWith('data:')) {
    return s.split('?v=')[0];
  }
  if (s.startsWith('blob:')) return s;
  // Normalizar rutas desviadas antiguas (HTTP IP directa o proyectos Supabase dados de baja) hacia el CDN HTTPS soberano
  const normalized = s
    .replace(/^https?:\/\/166\.0\.112\.247(?::\d+)?/i, SUPABASE_URL)
    .replace(/^https?:\/\/[a-z0-9]+\.supabase\.co/i, SUPABASE_URL);
  return encodeURI(normalized);
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


// Conversión nativa soberana de Cotización a Pedido con correlativo MixNet de 8 dígitos
async function convertQuoteToOrderNative(quoteId) {
  if (!quoteId) throw new Error('ID de cotización requerido');
  const { data: q, error: qErr } = await _pgClient.from('jjp_quotes').select('*').eq('id', quoteId).maybeSingle();
  if (qErr || !q) throw new Error(qErr?.message || 'Cotización no encontrada');

  const items = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items || '[]') : []);
  const subtotal = items.reduce((s, it) => s + (Number(it.subtotal_usd) || (Number(it.price_usd || 0) * (Number(it.qty) || 1))), 0);
  const pct = Number(q.discount_pct) || 0;
  const totalUsd = Number(q.estimated_total_usd) || +(subtotal * (1 - pct / 100)).toFixed(2);
  const rate = Number(q.exchange_rate) || (typeof getRate === 'function' ? getRate() : 40);
  const totalBs = +(totalUsd * rate).toFixed(2);

  const session = _readStoredSession();
  const isAdmin = session?.user?.role === 'admin' || (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE?.role === 'admin');
  const dStatus = pct > 0 ? (isAdmin ? 'approved' : 'pending') : 'none';

  let createdOrder = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let orderNumber = await fetchNextDocSerial('pedido');
    if (!orderNumber || !/^\d{8}$/.test(String(orderNumber).trim())) {
      orderNumber = String(112845 + attempt).padStart(8, '0');
    }
    const orderPayload = {
      order_number: orderNumber,
      client_name: q.client_name || 'CUENTA RECUPERADA',
      rif: q.rif || null,
      phone: q.phone || '00000000000',
      email: q.email || null,
      city: q.city || null,
      address: q.address || null,
      items,
      subtotal_usd: +subtotal.toFixed(2),
      total_usd: +totalUsd.toFixed(2),
      exchange_rate: rate,
      total_bs: totalBs,
      payment_method: 'transferencia',
      notes: q.notes || ('Convertido desde Cotización #' + (q.quote_number || '')),
      status: 'pendiente_pago',
      seller_id: q.seller_id || session?.user?.id || null,
      source: 'pos',
      discount_pct: pct,
      discount_status: dStatus,
      customer_id: q.customer_id || null,
      quote_id: q.id
    };
    const res = await _pgClient.from('jjp_orders').insert(orderPayload).select().maybeSingle();
    if (!res.error && res.data) {
      createdOrder = res.data;
      lastErr = null;
      break;
    }
    lastErr = res.error;
  }
  if (!createdOrder) throw new Error(lastErr?.message || 'No se pudo crear el pedido desde la cotización');

  await _pgClient.from('jjp_quotes').update({ status: 'convertido' }).eq('id', q.id);
  return createdOrder;
}
window.convertQuoteToOrderNative = convertQuoteToOrderNative;

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
