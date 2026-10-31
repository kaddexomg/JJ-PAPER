import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL_COMM, SERVICE_KEY_COMM,
  SUPABASE_URL_CORE, SERVICE_KEY_CORE,
  SUPABASE_URL_INV, SERVICE_KEY_INV
} from './config.js';

// Esquema real verificado de las 54 tablas del VPS PostgreSQL para protección automática contra errores 42703 / PGRST204
const _VPS_SCHEMA_RAW = {"jjp_photo_audit":["id","product_id","variant_id","image_url","verdict","confidence","mismatches","reason","source","reviewed_by","reviewed_at","created_at"],"jjp_wa_actions":["id","owner_id","chat_id","jid","kind","target_wa_id","emoji","created_at"],"jjp_profiles":["id","name","phone","role","active","ref_code","commission_pct","max_discount_pct","monthly_goal_usd","created_at","updated_at","permissions","mixnet_code"],"jjp_scan_events":["id","owner_id","code","created_at","handled_at","result","device"],"jjp_promos":["id","title","kind","badge","description","emoji","image_url","price_usd","old_price_usd","cta_label","cta_url","wa_message","theme","featured","starts_at","ends_at","active","sort_order","created_at","updated_at"],"jjp_email_suppression_list":["id","email","reason","bounce_type","source","created_at"],"jjp_email_company":["id","email","from_name","app_pass","enabled","verified","last_error","created_at","updated_at","has_cred"],"jjp_quotes":["id","quote_number","client_name","rif","phone","email","city","address","items","estimated_total_usd","exchange_rate","notes","status","source","seller_id","created_at","discount_pct","customer_id"],"jjp_products":["id","name","description","price_usd","cost_usd","unit","unit_id","emoji","image_url","tag","active","featured","stock","min_qty","category_id","brand_id","sku","sort_order","created_at","essential","price_a","price_b","price_c_bs","price_d_bs","mixnet_status","last_movement_at","last_sale_at","stock_qty","price"],"jjp_seller_settings":["seller_id","key","value","updated_at"],"jjp_units":["id","name","abbr","description","sort_order"],"jjp_barcode_dupes":["barcode","veces","productos"],"jjp_settings":["key","value","updated_at"],"jjp_count_unknown":["id","owner_id","session_key","code","device","seen","first_at","last_at","resolved_at"],"jjp_invoice_alerts":["id","invoice_id","milestone","alert_date","title","body","wa_status","wa_message_id","wa_error","wa_sent_at","created_at"],"jjp_categories":["id","name","slug","emoji","color","sort_order","group_id"],"jjp_product_variants":["id","product_id","brand_id","variant_name","sku","barcode","cost_usd","price_usd","margin_pct","stock","min_qty","active","sort_order","image_url","created_at","base_price_usd","price_a","price_b","price_c_bs","price_d_bs","mixnet_status"],"jjp_emails":["id","account_id","gmail_id","thread_id","from_email","from_name","to_email","subject","body_text","body_html","attachments","attach_state","is_read","is_inbound","direction","status","created_at","owner_id","to_addr","from_addr","body","html","snippet","retry_count","message_id","campaign_id"],"jjp_notifications":["id","user_id","type","title","body","link","read","created_at"],"jjp_reviews":["id","name","stars","text","approved","created_at"],"jjp_email_campaign_targets":["id","campaign_id","owner_id","customer_id","to_addr","name","vars","status","email_id","error","sent_at","created_at","email","phone"],"jjp_count_log_view":["id","session_key","variant_id","delta","counted_after","source","counted_by","note","reverts","reverted_by","created_at","product_name","brand_name","variant_name","sku"],"jjp_count_conflicts":["session_key","variant_id","product_name","sku","brand_name","personas","quienes","total","ultimo"],"jjp_count_tally":["id","owner_id","session_key","variant_id","counted","updated_at"],"jjp_orders":["id","order_number","client_name","rif","phone","email","city","address","items","subtotal_usd","total_usd","exchange_rate","total_bs","payment_method","payment_ref","notes","receipt_url","status","seller_id","source","discount_pct","stock_applied","created_at","updated_at","discount_status","discount_note","discount_requested_by","discount_approved_by","discount_decided_at","delivery_type","delivery_lat","delivery_lng","delivery_distance_km","delivery_fee_usd","delivery_fee_confirmed","control_number","customer_id","quote_id","invoice_number","invoice_date","invoice_total_bs","invoice_total_usd","invoice_iva_bs","invoice_rate","invoice_data"],"jjp_wa_templates":["id","owner_id","name","body","kind","active","created_at","updated_at"],"jjp_mixnet_tasks":["id","action","payload","status","result","error","created_at","started_at","completed_at","updated_at"],"jjp_count_progress":["total","contados","pendientes","con_codigo"],"jjp_supplier_invoices":["id","supplier_id","supplier_name","invoice_number","issue_date","due_date","terms_days","amount","currency","amount_paid","status","image_path","ocr_data","notes","paid_at","created_at","updated_at"],"jjp_stock_moves":["id","variant_id","product_name","brand_name","variant_name","sku","delta","stock_before","stock_after","reason","ref","created_by","created_at"],"jjp_missing_photos":["variant_id","sku","producto","categoria","stock","price_usd","usd_parado"],"jjp_count_counters":["session_key","quien","movimientos","unidades","productos","ultimo"],"jjp_wa_campaign_targets":["id","campaign_id","owner_id","customer_id","phone","name","vars","status","message_id","error","sent_at","created_at"],"jjp_wa_messages":["id","chat_id","owner_id","wa_msg_id","direction","type","body","media_path","media_mime","media_size","media_filename","status","error","retry_count","wa_timestamp","created_at","forwarded","reply_to_wa_id","reply_preview","reply_from","reaction","reaction_from"],"jjp_suppliers":["id","name","phone","contact","default_terms_days","notes","active","created_at","updated_at"],"jjp_customers":["id","name","phone","rif","city","email","address","notes","seller_id","total_orders","total_usd","last_order_at","created_at","updated_at","tags","wa_opt_out","last_reactivation_at","zone","email_opt_out","last_email_at","email_status","bounce_reason","bounced_at"],"jjp_count_valued":["variant_id","session_key","counted","updated_at","product_name","brand_name","variant_name","sku","barcode","cost_usd","price_usd","costo_total_usd","venta_total_usd"],"jjp_barcode_log":["id","variant_id","code","prev_code","action","note","created_by","created_at"],"jjp_brands":["id","name","slug","logo_url","country","active","sort_order"],"jjp_catalog_export":["codigo","descripcion","categoria","tiene_imagen"],"jjp_category_groups":["id","name","slug","emoji","sort_order"],"jjp_count_log":["id","owner_id","session_key","variant_id","delta","counted_after","source","note","reverts","reverted_by","created_at","counted_by"],"jjp_email_campaigns":["id","owner_id","name","subject","body","html","attachments","status","delay_min_s","delay_max_s","total","sent_count","failed_count","started_at","finished_at","created_at","updated_at","body_html","kind","batch_size","batch_pause_m","skipped_count","scheduled_at","next_send_at","pause_reason","pause_until"],"jjp_seller_prices":["id","seller_id","product_id","variant_id","price_usd","created_at","updated_at"],"jjp_prospects":["id","company_name","sector","contact_name","contact_role","phone_1","phone_2","email","address","city","zone","contacted","contact_count","status","last_contact_at","notes","ai_analysis","suggested_subject","custom_email_body","custom_wa_body","seller_id","converted_customer_id","source","created_at","updated_at","email_status","bounce_reason","bounced_at"],"jjp_fx_rates":["id","at","bcv","binance","monitor","eur","gap_pct","created_at"],"jjp_email_accounts":["id","profile_id","email","from_name","provider","oauth_refresh","app_pass","enabled","verified","last_error","created_at","updated_at","has_cred"],"jjp_count_totals":["session_key","productos","unidades","ultimo"],"jjp_wa_sessions":["profile_id","enabled","status","requested_action","requested_at","pairing_phone","pairing_code","qr_data","qr_updated_at","wa_number","wa_name","last_connected_at","last_error","created_at","updated_at","qr","phone","auth_state"],"jjp_clients":["id","name","logo_url","active","sort_order","created_at"],"jjp_server_control":["id","modules","updated_at","heartbeat_at"],"jjp_invoice_payments":["id","invoice_id","amount","method","reference","note","paid_at","created_by","created_at"],"jjp_wa_campaigns":["id","owner_id","name","kind","template_id","body","status","delay_min_s","delay_max_s","total","sent_count","failed_count","started_at","finished_at","created_at","updated_at","created_by","message","batch_size","batch_pause_m","media_path","media_type","media_mime","media_filename","media_size","skipped_count"],"jjp_wa_chats":["id","owner_id","jid","phone","customer_id","display_name","last_message_at","last_message_preview","last_message_from","unread_count","archived","created_at","updated_at","pinned","notes"]};
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

const _serverFetch = async (input, init = {}) => {
  const sanitized = _sanitizePostgrestCall(input, init);
  const finalInit = sanitized.init || init;
  const headers = new Headers(finalInit.headers || {});
  headers.delete('Accept-Profile');
  headers.delete('accept-profile');
  headers.delete('Content-Profile');
  headers.delete('content-profile');
  return fetch(sanitized.urlStr, { ...finalInit, headers });
};

export const db = createClient(SUPABASE_URL_COMM, SERVICE_KEY_COMM, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: _serverFetch },
  realtime: { params: { eventsPerSecond: 20 } }
});

export const dbCore = createClient(SUPABASE_URL_CORE, SERVICE_KEY_CORE, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: _serverFetch },
  realtime: { params: { eventsPerSecond: 20 } }
});

export const dbInv = createClient(SUPABASE_URL_INV, SERVICE_KEY_INV, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: _serverFetch }
});
