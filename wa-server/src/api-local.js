import { dbCore } from './supabase.js';
import { log } from './logger.js';

// Estado en memoria
const cache = {
  customers: [],
  products: [],
  settings: {},
  lastRefresh: {
    customers: null,
    products: null,
    settings: null
  }
};

// Intervalos
const REFRESH_CUSTOMERS_MS = 10 * 60 * 1000; // 10 min
const REFRESH_PRODUCTS_MS = 30 * 60 * 1000;  // 30 min
const REFRESH_SETTINGS_MS = 60 * 60 * 1000;  // 60 min

// Helpers de Paginación
async function fetchAll(table, select, orderBy) {
  let allData = [];
  let from = 0;
  const step = 999;
  
  while (true) {
    let query = dbCore.from(table).select(select);
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending || true });
    }
    const { data, error } = await query.range(from, from + step);
    
    if (error) {
      throw error;
    }
    
    if (data && data.length > 0) {
      allData = allData.concat(data);
    }
    
    if (!data || data.length <= step) {
      break;
    }
    from += step + 1;
  }
  
  return allData;
}

// Tareas de Refresco
async function refreshCustomers() {
  try {
    const data = await fetchAll(
      'jjp_customers', 
      'id, name, phone, rif, zone, city, total_orders, total_usd, last_order_at, seller_id, email, address, notes, tags',
      { column: 'name' }
    );
    cache.customers = data;
    cache.lastRefresh.customers = new Date().toISOString();
    log.info(`[api-local] Clientes cacheados: ${data.length}`);
  } catch (error) {
    log.error({ err: error.message }, '[api-local] Error al refrescar clientes');
  }
}

async function refreshProducts() {
  try {
    // Productos padres
    const prods = await fetchAll('jjp_products', 'id, name, sku, barcode, price_usd, price_a, price_b, price_c_bs, price_d_bs, stock, active');
    // Variantes
    const vars = await fetchAll('jjp_product_variants', 'id, product_id, variant_name, sku, barcode, price_usd, price_a, price_b, price_c_bs, price_d_bs, stock, active');

    // Combinar (esto depende de cómo espera la API que sean entregados, si aplanados o con anidación. Aplanaremos como getMixnetProductos o enviaremos todo).
    // Para simplificar, enviaremos los productos con sus variantes adjuntas.
    const varMap = new Map();
    for (const v of vars) {
      if (!varMap.has(v.product_id)) varMap.set(v.product_id, []);
      varMap.get(v.product_id).push(v);
    }

    const combined = prods.map(p => ({
      ...p,
      variants: varMap.get(p.id) || []
    }));

    cache.products = combined;
    cache.lastRefresh.products = new Date().toISOString();
    log.info(`[api-local] Productos cacheados: ${combined.length} (con variantes)`);
  } catch (error) {
    log.error({ err: error.message }, '[api-local] Error al refrescar productos');
  }
}

async function refreshSettings() {
  try {
    const { data, error } = await dbCore.from('jjp_settings').select('key,value');
    if (error) throw error;
    const map = {};
    (data || []).forEach(r => { map[r.key] = r.value; });
    cache.settings = map;
    cache.lastRefresh.settings = new Date().toISOString();
    log.info(`[api-local] Settings cacheadas: ${Object.keys(map).length} claves`);
  } catch (error) {
    log.error({ err: error.message }, '[api-local] Error al refrescar settings');
  }
}

let timersStarted = false;

function startTimers() {
  if (timersStarted) return;
  timersStarted = true;

  // Primer run inmediato asíncrono
  refreshCustomers();
  refreshProducts();
  refreshSettings();

  // Background refreshes
  setInterval(refreshCustomers, REFRESH_CUSTOMERS_MS);
  setInterval(refreshProducts, REFRESH_PRODUCTS_MS);
  setInterval(refreshSettings, REFRESH_SETTINGS_MS);
}

// Helpers HTTP
function sendJSON(res, code, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

// Manejador de requests
async function handleLocalApi(req, res) {
  const url = req.url.split('?')[0];
  
  if (req.method === 'OPTIONS' && url.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== 'GET') return false;

  if (url === '/api/customers') {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const zone = parsedUrl.searchParams.get('zone');
    const sellerId = parsedUrl.searchParams.get('seller_id');
    
    let result = cache.customers;
    if (zone) {
      result = result.filter(c => c.zone === zone);
    }
    if (sellerId) {
      result = result.filter(c => c.seller_id === sellerId);
    }
    
    sendJSON(res, 200, { ok: true, count: result.length, data: result });
    return true;
  }

  if (url === '/api/products') {
    sendJSON(res, 200, { ok: true, count: cache.products.length, data: cache.products });
    return true;
  }

  if (url === '/api/settings') {
    sendJSON(res, 200, { ok: true, data: cache.settings });
    return true;
  }

  if (url === '/api/health') {
    sendJSON(res, 200, {
      ok: true,
      cached_customers: cache.customers.length,
      cached_products: cache.products.length,
      last_refresh: cache.lastRefresh.customers || new Date().toISOString()
    });
    return true;
  }

  return false;
}

export function startLocalApi(httpServer) {
  log.info('[api-local] Inicializando API local (LAN Cache)...');
  startTimers();

  // Interceptar requests al servidor HTTP/HTTPS existente
  if (httpServer) {
    const originalListeners = httpServer.listeners('request');
    httpServer.removeAllListeners('request');

    httpServer.on('request', async (req, res) => {
      try {
        if (req.url && req.url.startsWith('/api/')) {
          const handled = await handleLocalApi(req, res);
          if (handled) return;
        }
      } catch (err) {
        log.error({ err: err.message }, '[api-local] Error manejando request');
      }

      // Si no fue manejado por api-local o hubo un fallo, pasamos al handler original (count-lan)
      for (const listener of originalListeners) {
        listener(req, res);
      }
    });
  }
}
