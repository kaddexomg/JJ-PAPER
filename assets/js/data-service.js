/* ==============================================================================
   JJ Paper — Data Service Layer Unificado
   Fuente única de verdad y caché compartido para:
   - Catálogo público (catalog.js)
   - Buscador de productos / POS / Cotizador (product-finder.js, vquotes.js)
   - Selector de campañas y ofertas (product-picker.js, campaign-editor.js)
   - CRM y Autocompletado de Clientes (vcustomers.js, cust-autocomplete.js)
   ============================================================================== */

const DataService = (() => {
  // Caché en memoria
  let _products = null;
  let _productsAt = 0;
  let _customers = null;
  let _customersAt = 0;
  let _categories = null;
  let _categoriesAt = 0;

  const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Carga la lista completa de productos unificada desde jjp_catalog_flat (o fallback)
   * @param {Object} opts { force: boolean, ttl: number }
   * @returns {Promise<Array>} Lista de productos normalizados
   */
  async function getProducts(opts = {}) {
    const force = opts.force || false;
    const ttl = opts.ttl || DEFAULT_TTL;
    const now = Date.now();

    if (!force && _products && (now - _productsAt < ttl)) {
      return _products;
    }

    // Intentar leer de sessionStorage si no hay en memoria
    if (!force) {
      try {
        const cached = sessionStorage.getItem('jjp_ds_products_v1');
        const cachedAt = sessionStorage.getItem('jjp_ds_products_v1_time');
        if (cached && cachedAt && (now - parseInt(cachedAt, 10) < ttl)) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            _products = parsed;
            _productsAt = parseInt(cachedAt, 10);
            return _products;
          }
        }
      } catch (_) {}
    }

    let allData = [];
    let from = 0;
    const step = 999;

    while (true) {
      // 1. Prioridad: Vista materializada aplanada ultra-rápida
      const { data, error } = await sb
        .from('jjp_catalog_flat')
        .select('*')
        .range(from, from + step)
        .order('sort_order');

      if (error) {
        console.warn('[DataService] Vista plana no disponible, usando fallback jjp_products:', error);
        // Fallback resiliente
        const { data: fbData, error: fbErr } = await sb
          .from('jjp_products')
          .select('id,name,description,price_usd,price_a,price_b,price_c_bs,price_d_bs,unit,image_url,emoji,tag,featured,essential,stock,min_qty,category_id,jjp_categories(name,slug,color,group_id),jjp_product_variants(id,brand_id,variant_name,sku,barcode,price_usd,price_a,price_b,price_c_bs,price_d_bs,stock,min_qty,active,jjp_brands(name,logo_url))')
          .eq('active', true)
          .range(from, from + step)
          .order('sort_order');

        if (fbErr) {
          console.error('[DataService] Error cargando productos en fallback:', fbErr);
          break;
        }
        if (!fbData || fbData.length === 0) break;
        allData.push(...fbData);
        if (fbData.length <= step) break;
        from += step + 1;
        continue;
      }

      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length <= step) break;
      from += step + 1;
    }

    // Normalizar productos de forma consistente para toda la aplicación
    const normalized = allData.map(p => {
      const vs = (p.jjp_product_variants || p.variants || [])
        .filter(v => v.active !== false);

      const prices = vs.map(v => Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : (v.price_a != null ? v.price_a : 0)))).filter(x => x > 0);
      const minPrice = prices.length ? Math.min(...prices) : Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : (p.price_a != null ? p.price_a : 0)));
      const maxPrice = prices.length ? Math.max(...prices) : minPrice;
      const totalStock = vs.length ? (vs.some(v => v.stock == null || v.stock < 0) ? -1 : vs.reduce((s, v) => s + (Number(v.stock) || 0), 0)) : (p.stock == null ? -1 : (Number(p.stock) || 0));

      return {
        ...p,
        variants: vs,
        _minPrice: minPrice,
        _maxPrice: maxPrice,
        _stock: totalStock,
        price_b: p.price_b != null ? p.price_b : p.price_usd
      };
    });

    _products = normalized;
    _productsAt = now;

    try {
      sessionStorage.setItem('jjp_ds_products_v1', JSON.stringify(normalized));
      sessionStorage.setItem('jjp_ds_products_v1_time', String(now));
    } catch (_) {}

    return _products;
  }

  /**
   * Carga clientes con filtros opcionales de vendedor y zona
   * @param {Object} opts { sellerId: string, isAdmin: boolean, force: boolean }
   * @returns {Promise<Array>}
   */
  async function getCustomers(opts = {}) {
    const force = opts.force || false;
    const now = Date.now();

    if (!force && _customers && (now - _customersAt < DEFAULT_TTL)) {
      return filterCustomersList(_customers, opts);
    }

    let query = sb.from('jjp_customers')
      .select('id,name,phone,rif,email,city,address,total_orders,total_usd,seller_id,zone,active')
      .eq('active', true)
      .order('name');

    const { data, error } = await query;
    if (error) {
      console.error('[DataService] Error cargando clientes:', error);
      return [];
    }

    _customers = data || [];
    _customersAt = now;

    return filterCustomersList(_customers, opts);
  }

  function filterCustomersList(list, opts) {
    let result = list;
    if (opts.sellerId && opts.sellerOnly !== false && !opts.isAdmin) {
      result = result.filter(c => c.seller_id === opts.sellerId);
    }
    if (!opts.isAdmin) {
      result = result.filter(c => c.zone !== '020');
    }
    return result;
  }

  /**
   * Refresca la vista materializada jjp_catalog_flat en Supabase
   */
  async function refreshCatalogView() {
    try {
      const { error } = await sb.rpc('jjp_refresh_catalog_flat');
      if (error) console.warn('[DataService] No se pudo refrescar jjp_catalog_flat vía RPC:', error);
      // Invalidar caché local
      _products = null;
      _productsAt = 0;
      sessionStorage.removeItem('jjp_ds_products_v1');
    } catch (e) {
      console.warn('[DataService] RPC refresh error:', e);
    }
  }

  return {
    getProducts,
    getCustomers,
    refreshCatalogView
  };
})();

if (typeof window !== 'undefined') {
  window.DataService = DataService;
}
