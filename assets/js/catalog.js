/* ======================================================
   JJ Paper — Catalog (Supabase + filter/sort/paginate)
   ====================================================== */

// Fallback / safe reveal observer for cards (.rv)
function observeReveal(root = document) {
  try {
    const elements = root.querySelectorAll ? root.querySelectorAll('.rv, .rv-up, .rv-left, .rv-right, .rv-zoom') : [];
    if (!elements || !elements.length) return;
    elements.forEach(el => el.classList.add('vi'));
  } catch (err) {
    console.warn('observeReveal fallback error:', err);
  }
}

let allProducts  = [];
let categories   = [];
let catGroups    = [];
let currentGroup = 'todos';
let currentCat   = 'todos';
let currentPage  = 1;
let currentSearch= '';
let currentSort  = '';


// ---- Load data ----
// El catálogo tiene 2 niveles: 8 familias (jjp_category_groups) que agrupan
// las ~39 categorías finas. El chip de familia filtra; las subcategorías
// aparecen sólo al entrar en una familia.
async function loadCatGroups() {
  const cacheKey = 'jjp_cat_groups_cache_v1';
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) { catGroups = parsed; return; }
    } catch (_) {}
  }
  const { data } = await sb.from('jjp_category_groups')
    .select('id,name,slug,emoji')
    .order('sort_order');
  if (data) {
    catGroups = data;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) {}
  }
}

async function loadCategories() {
  const cacheKey = 'jjp_categories_cache_v1';
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) { categories = parsed; return; }
    } catch (_) {}
  }
  const { data } = await sb.from('jjp_categories')
    .select('id,name,slug,emoji,color,group_id')
    .order('sort_order');
  if (data) {
    categories = data;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) {}
  }
}

// slug de la familia a la que pertenece una categoría (por id)
function groupSlugOfCat(catId) {
  const c = categories.find(x => x.id === catId);
  if (!c) return null;
  return catGroups.find(g => g.id === c.group_id)?.slug || null;
}

// Categorías de una familia que tienen al menos un producto visible
function catsOfGroup(groupSlug) {
  const g = catGroups.find(x => x.slug === groupSlug);
  if (!g) return [];
  const used = new Set(allProducts.map(p => p.category_id));
  return categories.filter(c => c.group_id === g.id && used.has(c.id));
}

// Select de variantes reutilizado por catálogo, modal y producto.html
const VARIANTS_SELECT = 'jjp_product_variants(id,brand_id,variant_name,sku,price_usd,price_a,price_b,price_c_bs,price_d_bs,stock,min_qty,image_url,active,sort_order,jjp_brands(name,logo_url))';

// Etiqueta de una variante: "Marca · Presentación" (lo que exista)
function variantLabel(v) {
  return [v?.jjp_brands?.name, v?.variant_name].filter(Boolean).join(' · ') || null;
}

// Un producto puede venir en varias MARCAS (variantes), cada una con su
// precio y stock. Esto agrega los datos que las cards/modal necesitan:
//   variants   → variantes activas ordenadas
//   _minPrice/_maxPrice → rango de precios ("desde $X") [Prioridad oficial: Precio B]
//   _stock     → -1 si alguna variante es sin-control; si no, suma
//   _brands    → marcas únicas disponibles
function normalizeProduct(p) {
  const vs = (p.jjp_product_variants || [])
    .filter(v => v.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
      || String(a.jjp_brands?.name || '').localeCompare(String(b.jjp_brands?.name || '')));
  p.variants = vs;
  if (vs.length) {
    const prices = vs.map(v => Number(v.price_b != null ? v.price_b : (v.price_usd != null ? v.price_usd : (v.price_a != null ? v.price_a : 0)))).filter(x => x > 0);
    p._minPrice = prices.length ? Math.min(...prices) : 0;
    p._maxPrice = prices.length ? Math.max(...prices) : 0;
    p._stock    = -1; // Catálogo mayorista: todos los productos están cotizables y disponibles
  } else {
    const baseP = Number(p.price_b != null ? p.price_b : (p.price_usd != null ? p.price_usd : (p.price_a != null ? p.price_a : 0)));
    p._minPrice = p._maxPrice = baseP;
    p._stock    = -1; // Catálogo mayorista: todos los productos están cotizables y disponibles
  }
  p._brands = [...new Map(
    vs.filter(v => v.jjp_brands?.name).map(v => [v.jjp_brands.name, v.jjp_brands])
  ).values()];
  p._brandNames = p._brands.map(b => b.name).join(' ');
  p._skus = vs.map(v => v.sku).filter(Boolean).join(' ');
  p._varNames = vs.map(v => v.variant_name).filter(Boolean).join(' ');
  p._hasPhoto = Boolean((p.image_url && p.image_url.trim()) || vs.some(v => v.image_url && v.image_url.trim()));

  // Auto-generate a short emoji description if missing
  if (!p.description || p.description.trim() === '') {
    const n = (p.name || '').toUpperCase();
    if (n.includes("ALFILER")) p.description = "📌 Ideal para mapas y corchos, gran calidad.";
    else if (n.includes("ALMOHADILLA")) p.description = "🧽 Almohadilla duradera para sellos y tinta nítida.";
    else if (n.includes("ARCHIVADOR") || n.includes("CARPETA") || n.includes("ARCHICOMODO")) p.description = "📁 Mantén tus documentos organizados y seguros.";
    else if (n.includes("BANDA")) p.description = "🖇️ Bandas de goma elásticas, súper resistentes.";
    else if (n.includes("BOLIGRAFO") || n.includes("ESFERO")) p.description = "🖊️ Escritura suave y fluida para el día a día.";
    else if (n.includes("BORRADOR")) p.description = "🧼 Borra sin dejar manchas ni dañar el papel.";
    else if (n.includes("CINTA")) p.description = "🩹 Cinta adhesiva de alta fijación.";
    else if (n.includes("CUADERNO") || n.includes("LIBRETA") || n.includes("BLOCK")) p.description = "📓 Excelente para tus apuntes y notas importantes.";
    else if (n.includes("LAPIZ") || n.includes("LÁPIZ") || n.includes("PORTAMINA")) p.description = "✏️ Trazos precisos para dibujo y escritura.";
    else if (n.includes("MARCADOR") || n.includes("RESALTADOR") || n.includes("PLUMON")) p.description = "🖍️ Colores vivos y duraderos para tus proyectos.";
    else if (n.includes("PAPEL") || n.includes("RESMA")) p.description = "📄 Hojas de calidad premium para impresión y escritura.";
    else if (n.includes("REGLA") || n.includes("ESCUADRA") || n.includes("COMPAS")) p.description = "📏 Precisión exacta para tus medidas y trazos.";
    else if (n.includes("TIJERA") || n.includes("CUTTER") || n.includes("BISTURI") || n.includes("GUILLOTINA")) p.description = "✂️ Cortes limpios, precisos y seguros.";
    else if (n.includes("GRAPADORA") || n.includes("GRAPA") || n.includes("PERFORADORA") || n.includes("SACAGRAPAS")) p.description = "🖇️ Fija y organiza tus documentos sin esfuerzo.";
    else if (n.includes("PEGAMENTO") || n.includes("PEGA") || n.includes("SILICON") || n.includes("COLA")) p.description = "🧴 Adhesivo de secado rápido y máxima adherencia.";
    else if (n.includes("CALCULADORA")) p.description = "🧮 Cálculos rápidos y exactos para tu negocio o estudio.";
    else if (n.includes("CLIPS") || n.includes("CHINCHE") || n.includes("GANCHO")) p.description = "📎 Sujeta tus hojas con firmeza y orden.";
    else if (n.includes("CARTULINA") || n.includes("FOAMI") || n.includes("CREPE")) p.description = "🎨 Material perfecto para manualidades y proyectos creativos.";
    else if (n.includes("DICCIONARIO")) p.description = "📖 Tu mejor aliado para el aprendizaje y consulta rápida.";
    else if (n.includes("SOBRE")) p.description = "✉️ Envíos y entregas seguras y profesionales.";
    else if (n.includes("SACAPUNTA")) p.description = "✏️ Mantén tus lápices siempre afilados y listos.";
    else if (n.includes("PINTURA") || n.includes("TEMPERA") || n.includes("ACUARELA") || n.includes("PINCEL")) p.description = "🎨 Colores vibrantes para dar vida a tus ideas.";
    else if (n.includes("PIZARRA") || n.includes("BORRADOR PIZARRA")) p.description = "📋 Ideal para presentaciones, clases y organización.";
    else if (n.includes("ETIQUETA")) p.description = "🏷️ Etiqueta y clasifica tus artículos fácilmente.";
    else if (n.includes("TINTA")) p.description = "🖋️ Tinta de alta pigmentación y secado rápido.";
    else if (n.includes("CD") || n.includes("DVD") || n.includes("PENDRIVE")) p.description = "💾 Almacena y transporta tu información segura.";
    else if (n.includes("EXHIBIDOR") || n.includes("ORGANIZADOR") || n.includes("BANDEJA")) p.description = "🗃️ Optimiza tu espacio de trabajo con estilo.";
    else if (n.includes("PAPELERA")) p.description = "🗑️ Mantén tu área de trabajo siempre limpia.";
    else p.description = "✨ Excelente artículo de papelería, calidad garantizada.";
  }

  return p;
}

async function loadProducts() {
  const cacheKey = 'jjp_products_cache_v8';
  const cacheTimeKey = 'jjp_products_cache_v7_time';
  const now = Date.now();

  // 1. Revisar caché persistente (localStorage primero para carga instantánea 0ms)
  let cached = null;
  let cachedTime = null;
  try {
    cached = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
    cachedTime = localStorage.getItem(cacheTimeKey) || sessionStorage.getItem(cacheTimeKey);
  } catch (_) {}

  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        allProducts = parsed.map(normalizeProduct);
        allProducts.forEach(p => { productMap[p.id] = p; });
        // Si el caché tiene menos de 2 horas, usar directamente
        if (cachedTime && (now - parseInt(cachedTime, 10) < 7200000)) {
          return;
        }
      }
    } catch (_) {}
  }

  // 2. Consulta a Supabase
  let allData = [];
  let from = 0;
  const step = 999;
  while (true) {
    const { data, error } = await sb.from('jjp_catalog_flat')
      .select('*')
      .range(from, from + step)
      .order('sort_order');

    if (error) {
      console.warn('Fallback a jjp_products con JOINs:', error);
      const { data: fbData, error: fbErr } = await sb.from('jjp_products')
        .select(`id,name,description,price_usd,price_a,price_b,price_c_bs,price_d_bs,unit,image_url,emoji,tag,featured,essential,stock,min_qty,category_id,jjp_categories(name,slug,color,group_id),${VARIANTS_SELECT}`)
        .eq('active', true)
        .range(from, from + step)
        .order('sort_order');
      if (fbErr) {
        console.error(fbErr);
        if (allProducts.length > 0) return;
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

    // Renderizado progresivo inmediato: tan pronto llega el primer bloque, pintar productos
    if (allProducts.length === 0 && allData.length > 0) {
      allProducts = allData.map(normalizeProduct);
      allProducts.forEach(p => { productMap[p.id] = p; });
      try {
        if (typeof renderProds === 'function' && document.getElementById('prodGrid')) {
          renderProds();
        }
      } catch (_) {}
    }

    if (data.length <= step) break;
    from += step + 1;
  }
  
  if (allData.length > 0) {
    allProducts = allData.map(normalizeProduct);
    allProducts.forEach(p => { productMap[p.id] = p; });
    try {
      localStorage.setItem(cacheKey, JSON.stringify(allData));
      localStorage.setItem(cacheTimeKey, String(now));
      sessionStorage.setItem(cacheKey, JSON.stringify(allData));
      sessionStorage.setItem(cacheTimeKey, String(now));
    } catch (_) {}
    try {
      if (typeof renderProds === 'function' && document.getElementById('prodGrid')) {
        renderProds();
      }
    } catch (_) {}
  }
}

// ---- Filter + Sort ----
// Un producto pertenece a la familia de su categoría. El id del grupo viene
// embebido en jjp_categories(group_id); lo resolvemos contra catGroups.

// ========================================================
// Normalización, Lematización y Sinónimos en Español
// ========================================================
function stemSpanish(word) {
  let w = (typeof normTxt === 'function' ? normTxt(word) : String(word || '').toLowerCase().trim());
  if (w.length <= 3) return w;
  if (w === 'lapices') return 'lapiz';
  if (w === 'resmas') return 'resma';
  if (w === 'cintas') return 'cinta';
  if (w === 'rollos') return 'rollo';
  if (w === 'termicos' || w === 'termicas') return 'termic';
  if (w === 'termico' || w === 'termica') return 'termic';

  if (w.endsWith('ces')) return w.slice(0, -3) + 'z';
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('is') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);
  return w;
}

const CATALOG_SYNONYMS = {
  resma: ['resma', 'r.fotocopia', 'rfotocopia', 'fotocopia', 'bond', 'papel'],
  resmas: ['resma', 'r.fotocopia', 'rfotocopia', 'fotocopia', 'bond', 'papel'],
  papel: ['papel', 'bond', 'fotocopia', 'resma'],
  embalaje: ['embalaje', 'empaque', 'cinta', 'cintas', 'morropac', 'celoven'],
  empaque: ['empaque', 'embalaje', 'cinta', 'cintas'],
  pos: ['pos', 'pto de venta', 'termico', 'registradora', 'sumadora'],
  boligrafo: ['boligrafo', 'boligrafos', 'lapicero', 'pluma', 'pen'],
  marcador: ['marcador', 'marcadores', 'resaltador', 'plumon', 'rotulador', 'sharpie'],
  tijera: ['tijera', 'tijeras', 'cortador', 'cutter', 'exacto'],
  carpeta: ['carpeta', 'carpetas', 'archivador', 'archivadores', 'legajador', 'sobre'],
  cinta: ['cinta', 'cintas', 'embalaje', 'morropac', 'celoven', 'teip', 'tape']
};

const SPANISH_STOP_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'en', 'para', 'con', 'y', 'o', 'un', 'una', 'unos', 'unas']);

function formatCatTitle(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function groupSlugOfProduct(p) {
  const gid = p.jjp_categories?.group_id;
  return gid ? (catGroups.find(g => g.id === gid)?.slug || null) : null;
}

function getFiltered() {
  const q = normTxt(currentSearch);
  const rawTokens = q ? q.split(/[\s,()\*\/+\-]+/).filter(t => t.length > 0) : [];

  let list = allProducts.filter(p => {
    const grpOk = currentGroup === 'todos' || groupSlugOfProduct(p) === currentGroup;
    const catOk = currentCat === 'todos' || p.jjp_categories?.slug === currentCat;
    if (!grpOk || !catOk) return false;
    if (!rawTokens.length) return true;

    const pText = normTxt([
      p.name,
      p.description,
      p._brandNames,
      p._skus,
      p._varNames
    ].join(' '));

    // Tokens coincidentes en el producto
    const matchingTokens = rawTokens.filter(tok => {
      if (tok.length <= 2) {
        const re = new RegExp('(^|[^a-z0-9])' + tok + '([^a-z0-9]|$)', 'i');
        return re.test(pText);
      }
      return pText.includes(tok);
    });

    // 1. Todos los tokens coinciden
    if (matchingTokens.length === rawTokens.length) return true;

    // 2. Coincidencia parcial para 3+ palabras si coinciden al menos 2 significativas
    if (rawTokens.length >= 3 && matchingTokens.length >= 2) {
      const significant = matchingTokens.filter(t => t.length >= 3).length;
      if (significant >= 2) return true;
    }

    return false;
  });

  if      (currentSort === 'con_foto') list = list.filter(p => p._hasPhoto);
  else if (currentSort === 'az')    list.sort((a,b) => a.name.localeCompare(b.name));
  else if (currentSort === 'za')    list.sort((a,b) => b.name.localeCompare(a.name));
  else if (currentSort === 'pasc')  list.sort((a,b) => a._minPrice - b._minPrice);
  else if (currentSort === 'pdesc') list.sort((a,b) => b._minPrice - a._minPrice);
  // Orden por defecto: los productos con foto oficial copan la página 1 primero, luego esenciales
  else list.sort((a,b) => {
    const photoDiff = (b._hasPhoto ? 1 : 0) - (a._hasPhoto ? 1 : 0);
    if (photoDiff !== 0) return photoDiff;
    return (b.essential ? 1 : 0) - (a.essential ? 1 : 0);
  });
  return list;
}

// ---- Set filter ----
// Familia: resetea la subcategoría y redibuja los subchips.
function setGroup(slug) {
  currentGroup = slug;
  currentCat   = 'todos';
  currentPage  = 1;
  document.querySelectorAll('#catFilters .cf').forEach(b => {
    const on = b.dataset.group === slug;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderSubFilters();
  renderProds();
}

function setCat(cat) {
  currentCat  = cat;
  currentPage = 1;
  // Entrar a una categoría desde fuera (?cat=, chatbot, promos) debe abrir
  // también su familia para que los subchips tengan sentido.
  if (cat !== 'todos') {
    const c = categories.find(x => x.slug === cat);
    const g = c && catGroups.find(x => x.id === c.group_id);
    if (g && currentGroup !== g.slug) {
      currentGroup = g.slug;
      renderCatFilters();
      renderSubFilters();
    }
  }
  document.querySelectorAll('#subFilters .cf').forEach(b => {
    const on = b.dataset.cat === cat;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  renderProds();
}

function filterProds() {
  currentSearch = document.getElementById('srch')?.value || '';
  currentSort   = document.getElementById('sortSel')?.value || '';
  currentPage   = 1;
  renderProds();
}

function goPage(p) {
  currentPage = p;
  renderProds();
  document.getElementById('catalogo')?.scrollIntoView({ behavior:'smooth' });
  document.getElementById('cat-top')?.scrollIntoView({ behavior:'smooth' });
}

// Product lookup map (id → object) — avoids inline JSON in HTML attributes
const productMap = {};

/* ------------------------------------------------------
   Icono inteligente por tipo de producto.
   Prioridad: emoji propio del producto → inferido del nombre
   → emoji de la categoría → 📦 genérico.
   normTxt() ya quita acentos, así que las claves van sin acento.
   ------------------------------------------------------ */
const ICON_MAP = [
  [/cuaderno|libreta|block|bloc|agenda/,      '📓'],
  [/lapiz|grafito|mina|portamina/,            '✏️'],
  [/boligrafo|lapicero|pluma|\bpen\b/,        '🖊️'],
  [/resaltador|marcador|plumon|rotulador/,    '🖍️'],
  [/color|creyon|crayon|krayon/,              '🖍️'],
  [/borrador/,                                '🩹'],
  [/sacapunta|tajador|afilador/,              '🔺'],
  [/tijera|cuter|cutter|exacto/,              '✂️'],
  [/pega|pegamento|silicona|adhesiv|glue|barra/, '🧴'],
  [/regla/,                                   '📏'],
  [/compas|circulo/,                          '📐'],
  [/carpeta|folder|archivador|sobre|cartapacio/, '📁'],
  [/papel|resma|hoja|bond|carton|foami/,      '📄'],
  [/corrector/,                               '⚪'],
  [/tinta|almohadilla|sello/,                 '🖋️'],
  [/nota|post|memo|flecha/,                   '🗒️'],
  [/pincel/,                                  '🖌️'],
  [/plastilina|masa|clay|arcilla/,            '🧱'],
  [/tempera|pintura|acuarela|dedikolor|dedi/, '🎨'],
  [/mochila|bolso|cartuchera|estuche/,        '🎒'],
  [/calculadora/,                             '🧮'],
  [/grapa|clip|gancho|chinche/,               '📎'],
  [/limpiador|limpieza|jabon|antibacterial/,  '🧼'],
  [/estambre|hilo|lana|yarn/,                 '🧶'],
  [/cinta|teip|tape|masking/,                 '🎗️'],
  [/pizarra|tablero/,                         '🧑‍🏫'],
];

function inferIcon(name) {
  const n = normTxt(name);
  for (const [re, emo] of ICON_MAP) if (re.test(n)) return emo;
  return null;
}

// Icono a mostrar cuando el producto no tiene image_url.
function productIcon(p) {
  return p.emoji || inferIcon(p.name) || p.jjp_categories?.emoji || '📦';
}

// ---- Render ----
function renderProds() {
  const grid  = document.getElementById('prodGrid');
  const count = document.getElementById('catCount');
  if (!grid) return;

  const list   = getFiltered();
  const total  = list.length;
  const pages  = Math.ceil(total / APP.PER_PAGE);
  const start  = (currentPage - 1) * APP.PER_PAGE;
  const page   = list.slice(start, start + APP.PER_PAGE);

  if (count) count.textContent = `${total} producto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`;

    if (!page.length) {
    const waNum = (typeof APP !== 'undefined' && APP.WA_NUM && APP.WA_NUM !== '584121234567') ? APP.WA_NUM : '584124676073';
    const term = (currentSearch || '').trim();
    const waText = term
      ? `Hola JJ Paper, estuve buscando "${term}" en su catálogo web y me gustaría cotizarlo directamente con ustedes en la cantidad que requiero.`
      : `Hola JJ Paper, me gustaría solicitar una cotización especial para varios insumos al mayor.`;
    const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(waText)}`;

    grid.innerHTML = `
      <div class="cat-procure-card rv vi">
        <div class="cat-procure-badge">🏢 Procura Especial JJ Paper</div>
        <h3 class="cat-procure-title">
          ${term ? `¿No encuentras <em>"${escapeHTML(term)}"</em> en este momento?` : `No encontramos productos con estos filtros`}
        </h3>
        <p class="cat-procure-desc">
          <strong>¡Tranquilo! En JJ Paper te lo conseguimos directamente.</strong><br>
          Somos importadores y distribuidores directos en Caracas. Si requieres algún insumo, marca específica, medida o maquinaria que no visualices publicada, <strong>nuestro equipo de Procura Especial te lo ubica en tiempo récord y en la cantidad que necesites</strong>.
        </p>
        <div class="cat-procure-pricing-notice">
          💡 <strong>Mejor oferta comercial garantizada:</strong> Todos nuestros precios mayoristas pueden ser mejorados para presentarte la mejor oferta comercial según el volumen de tu pedido. Facturación legal SENIAT liquidada a Tasa Oficial BCV.
        </div>
        <div class="cat-procure-actions">
          <a href="${waUrl}" target="_blank" class="btn-wa-procure">
            💬 ${term ? `Cotizar "${escapeHTML(term)}" por WhatsApp` : `Cotizar requerimiento por WhatsApp`} ↗
          </a>
          <button type="button" class="btn-reset-filters" onclick="resetFilters()">
            🔄 Ver catálogo completo (+2.400 artículos)
          </button>
        </div>
      </div>
    `;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  // Vista Híbrida: si no hay orden forzado ni búsqueda específica y estamos en modo cuadrícula
  // separamos visualmente los productos con foto (Galería Destacada) y los productos en lista/catálogo
  const isHybrid = !currentSort && !currentSearch && catCurrentView === 'grid';
  if (isHybrid) {
    const withPhoto = page.filter(p => p._hasPhoto);
    const withoutPhoto = page.filter(p => !p._hasPhoto);

    let html = '';
    if (withPhoto.length > 0) {
      html += `<div class="cat-section-header" style="grid-column:1/-1;margin:10px 0 14px;padding:8px 14px;background:#eef6f1;border-left:4px solid var(--gd,#16604A);border-radius:6px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:14px;font-weight:800;color:var(--gd,#16604A)">📸 Galería Oficial con Fotografía (${withPhoto.length})</span>
        <span style="font-size:11px;color:#558b74;font-weight:600">Fotos verificadas de almacén</span>
      </div>`;
      html += withPhoto.map(p => productCardHTML(p, false)).join('');
    }

    if (withoutPhoto.length > 0) {
      html += `<div class="cat-section-header" style="grid-column:1/-1;margin:28px 0 14px;padding:8px 14px;background:#f8fafc;border-left:4px solid #64748b;border-radius:6px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:14px;font-weight:800;color:#334155">📋 Lista Mayorista Completa (${withoutPhoto.length})</span>
        <span style="font-size:11px;color:#64748b;font-weight:600">Precios actualizados oficiales</span>
      </div>`;
      html += withoutPhoto.map(p => productCardHTML(p, true)).join('');
    }

    grid.innerHTML = html;

  } else {
    grid.innerHTML = page.map(p => productCardHTML(p, catCurrentView === 'list')).join('');
  }

  renderPag(pages);
  observeReveal(grid);
}

// ---- WhatsApp Direct Share Bridge ----
function shareProductToWA(productId, e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }
  const p = (typeof productMap !== 'undefined' && productMap[productId]) ||
            allProducts.find(x => x.id === productId);
  if (!p) return;

  const rawImg = p.image_url || (p.variants && p.variants.find(v => v.image_url)?.image_url) || null;
  const brand = p._brands?.length ? p._brands.map(b => b.name).join(', ') : '';
  const priceUsd = fmtPrice(p._minPrice);
  const priceBs  = fmtBs(p._minPrice);
  const prodUrl = `${location.origin}/producto.html?id=${encodeURIComponent(p.id)}`;

  let msg = `👋 *Hola JJ Paper, me interesa este producto del catálogo:*\n\n` +
            `📦 *${p.name}*${brand ? `\n🏷️ Marca: ${brand}` : ''}\n` +
            `💰 *Precio:* ${priceUsd} (${priceBs})\n` +
            `🔗 *Ficha Oficial:* ${prodUrl}\n`;

  if (rawImg && rawImg.trim()) {
    msg += `🖼️ *Foto oficial:* ${rawImg}\n`;
  }
  msg += `\n¿Tienen disponibilidad para despacho?`;

  if (typeof openWA === 'function') {
    openWA(msg);
  } else {
    window.open(`https://wa.me/${APP.WA_NUM || '584121234567'}?text=${encodeURIComponent(msg)}`, '_blank');
  }
}

function productCardHTML(p, asList = false) {
  if (p._minPrice === undefined) normalizeProduct(p);
  const cat     = p.jjp_categories || {};
  const bg      = cat.color || '#f2f2f2';
  const name    = escapeHTML(p.name);
  const soldOut = p._stock === 0;
  const multi   = (p.variants?.length || 0) > 1;
  const tagHTML = p.tag
    ? `<span class="pc-tag">${escapeHTML(p.tag)}</span>` : '';

  const rawImg = p.image_url || (p.variants && p.variants.find(v => v.image_url)?.image_url) || null;
  const hasImg = Boolean(rawImg && rawImg.trim());

  const imgHTML = hasImg
    ? `<img src="${optImg(rawImg, 400)}" alt="${name}" loading="lazy" decoding="async" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'pc-img-emoji\\'>${productIcon(p)}</span>'">`
    : `<span class="pc-img-emoji">${productIcon(p)}</span>`;

  // Marcas disponibles: 1 → nombre+logo; varias → chip "N marcas"
  let brandHTML = '';
  if (p._brands?.length === 1) {
    const b = p._brands[0];
    brandHTML = `<div class="pc-brand">${b.logo_url ? `<img class="pc-brand-logo" src="${escapeHTML(b.logo_url)}" alt="${escapeHTML(b.name)}" loading="lazy">` : ''}${escapeHTML(b.name)}</div>`;
  } else if (p._brands?.length > 1) {
    const logos = p._brands.slice(0, 3).map(b => b.logo_url
      ? `<img class="pc-brand-logo" src="${escapeHTML(b.logo_url)}" alt="${escapeHTML(b.name)}" title="${escapeHTML(b.name)}" loading="lazy">` : '').join('');
    brandHTML = `<div class="pc-brand pc-brand-multi" onclick="openProductModal('${p.id}')" title="${escapeHTML(p._brandNames)}">${logos}<span class="pc-brand-count">${p._brands.length} marcas</span></div>`;
  }

  const priceFrom = multi && p._maxPrice > p._minPrice
    ? `<span class="price-from">desde</span> ` : '';

  const ctrlHTML = soldOut
    ? `<div class="pc-actions-row"><span class="pc-out" style="position:static">Agotado</span></div>`
    : `<div class="pc-actions-row">
         <button type="button" class="btn-add-to-quote" onclick="addToClientQuote(productMap['${p.id}'], null, 1); event.stopPropagation();" title="Agregar a mi lista de cotización mayorista">
           ➕ Cotizar
         </button>
         <button class="pc-wa-quick" title="Consultar por WhatsApp con foto y enlace" aria-label="Consultar por WhatsApp" onclick="shareProductToWA('${p.id}', event)">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.351.226-.652.075s-1.272-.469-2.423-1.496c-.896-.799-1.501-1.786-1.677-2.087-.176-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.151-.176.201-.301.301-.502.1-.2.05-.376-.025-.526-.075-.15-.678-1.635-.929-2.241-.244-.59-.492-.51-.678-.52-.176-.008-.376-.01-.577-.01-.2 0-.527.075-.803.376s-1.054 1.029-1.054 2.509c0 1.48 1.079 2.909 1.229 3.11.15.2 2.122 3.24 5.141 4.544.718.31 1.279.495 1.716.634.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.43.251-.703.251-1.305.176-1.43-.075-.125-.276-.201-.577-.351zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2z"/></svg>
         </button>
         <button class="add-btn" title="Ver detalle rápido" aria-label="Ver detalle de ${name}" onclick="openProductModal('${p.id}')">👁</button>
         <a href="producto.html?id=${p.id}" class="add-btn" title="Ver ficha oficial completa" aria-label="Ficha de ${name}" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;background:#f0f7f3;color:#16604A;border:1px solid #cce3d6">🔗</a>
       </div>`;

  return `<div class="pc rv vi${soldOut ? ' is-out' : ''}${asList ? ' as-list-row' : ''}">

    <div class="pc-img${hasImg ? ' has-img' : ''}" style="background:${bg}" onclick="openProductModal('${p.id}')"
         role="button" tabindex="0" aria-label="Ver detalle de ${name}"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openProductModal('${p.id}')}">
      ${imgHTML}
      <span class="pc-cat">${escapeHTML(cat.name || '')}</span>
      ${tagHTML}
      ${soldOut ? `<span class="pc-out">Agotado</span>` : ''}
      <span class="pc-eye" aria-hidden="true">👁 Ver detalle</span>
    </div>
    <div class="pc-info">
      <h4 class="pc-name" onclick="openProductModal('${p.id}')">${name}</h4>
      ${brandHTML}
      <p class="pc-desc">${escapeHTML(p.description || '')}</p>
      <div class="pc-ft">
        <div>
          <div class="price-usd">${priceFrom}${fmtPrice(p._minPrice)}</div>
          <div class="price-bs">${fmtBs(p._minPrice)}</div>
          <div class="price-unit">/${escapeHTML(p.unit || 'unid')}</div>
        </div>
        ${ctrlHTML}
      </div>
    </div>
  </div>`;
}

function renderPag(pages) {
  const el = document.getElementById('pagination');
  if (!el || pages <= 1) { if(el) el.innerHTML = ''; return; }
  let html = '';
  if (currentPage > 1)
    html += `<button class="pg arrow" aria-label="Página anterior" onclick="goPage(${currentPage-1})">‹</button>`;
  for (let i = 1; i <= pages; i++)
    html += `<button class="pg${i===currentPage?' on':''}" aria-label="Página ${i}"${i===currentPage?' aria-current="page"':''} onclick="goPage(${i})">${i}</button>`;
  if (currentPage < pages)
    html += `<button class="pg arrow" aria-label="Página siguiente" onclick="goPage(${currentPage+1})">›</button>`;
  el.innerHTML = html;
}

// ---- Build filter buttons (nivel 1: familias) ----
function renderCatFilters() {
  const wrap = document.getElementById('catFilters');
  if (!wrap) return;

  // Filtrar solo grupos que tengan al menos 1 producto en catálogo
  const usedCatIds = new Set(allProducts.map(p => p.category_id));
  const usedGroupIds = new Set(categories.filter(c => usedCatIds.has(c.id)).map(c => c.group_id));
  const activeGroups = catGroups.filter(g => usedGroupIds.has(g.id));

  const on = s => currentGroup === s;
  const todos = `<button class="cf${on('todos') ? ' on' : ''}" data-group="todos" aria-pressed="${on('todos')}" onclick="setGroup('todos')">🏷️ Todos</button>`;
  const btns  = activeGroups.map(g => {
    const emo = (g.emoji && g.emoji !== 'null') ? g.emoji : '📁';
    return `<button class="cf${on(g.slug) ? ' on' : ''}" data-group="${escapeHTML(g.slug)}" aria-pressed="${on(g.slug)}" onclick="setGroup('${escapeHTML(g.slug)}')">${emo} ${escapeHTML(g.name)}</button>`;
  }).join('');
  wrap.innerHTML = todos + btns;
}

// ---- Build filter buttons (nivel 2: categorías de la familia abierta) ----
function renderSubFilters() {
  const wrap = document.getElementById('subFilters');
  if (!wrap) return;

  if (currentGroup === 'todos') { wrap.innerHTML = ''; wrap.hidden = true; return; }

  const subs = catsOfGroup(currentGroup);
  // Con una sola subcategoría el subfiltro no aporta nada.
  if (subs.length < 2) { wrap.innerHTML = ''; wrap.hidden = true; return; }

  const on = s => currentCat === s;
  const todas = `<button class="cf sub${on('todos') ? ' on' : ''}" data-cat="todos" aria-pressed="${on('todos')}" onclick="setCat('todos')">Todas</button>`;
  const btns  = subs.map(c => {
    const emo = (c.emoji && c.emoji !== 'null') ? c.emoji : (inferIcon(c.name) || '📁');
    const title = formatCatTitle(c.name);
    return `<button class="cf sub${on(c.slug) ? ' on' : ''}" data-cat="${escapeHTML(c.slug)}" aria-pressed="${on(c.slug)}" onclick="setCat('${escapeHTML(c.slug)}')">${emo} ${escapeHTML(title)}</button>`;
  }).join('');
  wrap.innerHTML = todas + btns;
  wrap.hidden = false;
}

// ---- Skeleton loader (shows card placeholders while data loads) ----
function skeletonGridHTML(n = 8) {
  const card = `<div class="sk-card">
    <div class="sk-img"></div>
    <div class="sk-body">
      <div class="sk-line w80"></div>
      <div class="sk-line w60"></div>
      <div class="sk-line w40"></div>
    </div>
  </div>`;
  return card.repeat(n);
}

function resetFilters() {
  currentSearch = '';
  currentSort   = '';
  const s = document.getElementById('srch');     if (s) s.value = '';
  const o = document.getElementById('sortSel');  if (o) o.value = '';
  setGroup('todos');
}

// ---- Featured products (used on index.html) ----
async function renderFeatured(containerId, limit = 4) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="prod-grid">${skeletonGridHTML(limit)}</div>`;

  if (!allProducts.length) await loadProducts();

  // Vista previa del inicio: solo productos CON foto. Destacados primero, luego el resto con imagen.
  const withImg = allProducts.filter(p => p.image_url);
  const featured = [
    ...withImg.filter(p => p.featured),
    ...withImg.filter(p => !p.featured),
  ].slice(0, limit);
  if (!featured.length) { container.innerHTML = ''; return; }

  container.innerHTML = `<div class="prod-grid">${featured.map(p => productCardHTML(p)).join('')}</div>`;
  observeReveal(container);
}

// ---- Más vendidos (RPC jjp_best_sellers, ventas confirmadas 30 días) ----
async function renderBestSellers(sectionId, containerId, limit = 8) {
  const section   = document.getElementById(sectionId);
  const container = document.getElementById(containerId);
  if (!section || !container) return;
  try {
    const { data } = await sb.rpc('jjp_best_sellers', { p_days: 30, p_limit: limit });
    if (!data?.length) return;   // sin ventas aún → la sección queda oculta
    if (!allProducts.length) await loadProducts();
    const cards = data.map(r => productMap[r.id]).filter(Boolean);
    if (!cards.length) return;
    container.innerHTML = `<div class="prod-grid">${cards.map(p => productCardHTML(p)).join('')}</div>`;
    section.style.display = '';
    observeReveal(container);
  } catch (e) { /* silencioso: la sección simplemente no se muestra */ }
}

// ---- Brands strip (marquee on index.html, data from jjp_brands) ----
async function renderBrandsStrip() {
  const strip = document.getElementById('brandsStrip');
  const track = document.getElementById('brandsTrack');
  if (!strip || !track) return;

  const { data } = await sb.from('jjp_brands')
    .select('name,logo_url')
    .order('name');
  const brands = (data || []).filter(b => b.name);
  if (brands.length < 3) return;

  const itemHTML = b => b.logo_url
    ? `<div class="brand-logo-i"><img src="${escapeHTML(b.logo_url)}" alt="${escapeHTML(b.name)}" loading="lazy" title="${escapeHTML(b.name)}"></div>`
    : `<div class="brand-logo-i"><span>${escapeHTML(b.name)}</span></div>`;

  // Duplicate the list so the -50% scroll loops seamlessly
  const items = brands.map(itemHTML).join('');
  track.innerHTML = items + items;
  strip.style.display = 'block';
}

// ---- Clients strip (marquee "Clientes que confían en nosotros", jjp_clients) ----
async function renderClientsStrip() {
  const strip = document.getElementById('clientsStrip');
  const track = document.getElementById('clientsTrack');
  if (!strip || !track) return;

  const { data } = await sb.from('jjp_clients')
    .select('name,logo_url')
    .eq('active', true)
    .order('sort_order');
  const clients = (data || []).filter(c => c.name);
  if (!clients.length) return;

  const itemHTML = c => c.logo_url
    ? `<div class="brand-logo-i client-logo-i"><img src="${escapeHTML(c.logo_url)}" alt="${escapeHTML(c.name)}" loading="lazy" title="${escapeHTML(c.name)}"><span>${escapeHTML(c.name)}</span></div>`
    : `<div class="brand-logo-i client-logo-i"><span>${escapeHTML(c.name)}</span></div>`;

  // Con pocos clientes repetimos la lista hasta llenar el ancho,
  // y luego se duplica completa para que el loop del -50% sea continuo
  let base = clients.map(itemHTML).join('');
  for (let n = clients.length; n < 6; n += clients.length) base += clients.map(itemHTML).join('');
  track.innerHTML = base + base;
  strip.style.display = 'block';
}

// ---- Init for catalog.html ----
async function initCatalog() {
  const grid = document.getElementById('prodGrid');
  if (!grid) return;

  // 1. Carga instantánea de 0ms si hay caché en localStorage
  const cacheKey = 'jjp_products_cache_v8';
  try {
    const cached = localStorage.getItem(cacheKey) || sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        allProducts = parsed.map(normalizeProduct);
        allProducts.forEach(p => { productMap[p.id] = p; });
        renderProds();
      }
    }
  } catch (_) {}

  // Si no había datos previos en caché, mostrar skeleton elegante
  if (!allProducts.length) {
    grid.innerHTML = skeletonGridHTML(APP.PER_PAGE);
  }

  try {
    await loadSettings();
    await Promise.all([loadCatGroups(), loadCategories(), loadProducts()]);
  } catch (err) {
    console.error('Error cargando catálogo:', err);
    if (!allProducts || !allProducts.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:50px 20px;background:#fff;border-radius:12px;border:1px solid #e0e0e0;margin:20px 0;">
          <div style="font-size:42px;margin-bottom:12px;">📡</div>
          <h3 style="color:#2d3748;margin-bottom:8px;">No se pudo conectar al catálogo</h3>
          <p style="color:#718096;font-size:14px;max-width:420px;margin:0 auto 18px;">Hubo un problema de conexión al cargar los productos. Por favor recarga la página o verifica tu conexión.</p>
          <button class="btn-p" style="padding:10px 24px;font-weight:700;cursor:pointer;" onclick="location.reload()">🔄 Recargar catálogo</button>
        </div>`;
      return;
    }
  }

  // Params de entrada: ?grupo=, ?cat=, ?q=, ?buscar= (QR impreso), ?producto=, ?sku=, ?p=, ?id=
  const qs       = new URLSearchParams(location.search);
  const urlGroup = qs.get('grupo');
  const urlCat   = qs.get('cat');
  const urlBuscar = (qs.get('buscar') || '').trim();
  const urlQ     = (qs.get('q') || urlBuscar).trim();
  const isFromPhysicalQr = Boolean(urlBuscar || qs.get('qr') === '1' || qs.get('from_qr') === '1');

  if (urlGroup && catGroups.some(g => g.slug === urlGroup)) currentGroup = urlGroup;
  if (urlQ) {
    currentSearch = urlQ;
    const s = document.getElementById('srch');
    if (s) s.value = urlQ;
  }

  renderCatFilters();
  renderSubFilters();

  if (urlCat) setCat(urlCat);
  else renderProds();

  // Interceptor del Catálogo Físico Impreso (QR) y Enlace Directo a Ficha Técnica
  const targetQuery = urlBuscar || qs.get('producto') || qs.get('sku') || qs.get('p') || qs.get('id') || '';
  if (targetQuery) {
    const rawTarget = targetQuery.trim();
    const found = (typeof window.findProductByQuery === 'function')
      ? window.findProductByQuery(rawTarget, allProducts)
      : null;

    if (found && typeof openProductModal === 'function') {
      setTimeout(() => {
        openProductModal(found.id, {
          fromQr: isFromPhysicalQr,
          searchQuery: rawTarget
        });
        if (typeof showToast === 'function' && isFromPhysicalQr) {
          showToast('📱 Escaneado desde el Catálogo Físico: ' + found.name, 4000);
        }
      }, 200);
    } else {
      currentSearch = rawTarget;
      const s = document.getElementById('srch');
      if (s) s.value = rawTarget;
      renderProds();
    }
  }}

/* ======================================================
   Catálogo: Toggle Grid/Lista & Envío Rápido a Clientes
   ====================================================== */

let catCurrentView = 'grid';

window.setCatView = function(view) {
  catCurrentView = view;
  const grid = document.getElementById('prodGrid') || document.getElementById('grid');
  if (grid) {
    grid.classList.toggle('list-view', view === 'list');
  }
  document.querySelectorAll('.cvt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  renderProds();
};

window.sendProductToClient = async function(prodId, channel = 'whatsapp') {
  const p = productMap[prodId] || allProducts.find(x => x.id === prodId);
  if (!p) return;

  if (window.CampaignEditor) {
    window.CampaignEditor.open({
      channel,
      defaultName: `Envío Ficha: ${p.name}`,
      products: allProducts,
      onLaunch: async (config) => {
        alert(`Ficha de ${p.name} enviada exitosamente por ${channel.toUpperCase()}`);
      }
    });
  } else {
    alert(`Preparando envío de ficha para: ${p.name}`);
  }
};

/* ======================================================
   Helper Universal de Búsqueda de Productos por Texto/QR
   ====================================================== */
window.findProductByQuery = function(rawTarget, products) {
  const list = products || (typeof allProducts !== 'undefined' ? allProducts : []);
  if (!rawTarget || !Array.isArray(list) || !list.length) return null;

  const cleanNorm = (str) => String(str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const targetNorm = cleanNorm(rawTarget);
  const targetWords = targetNorm.split(' ').filter(w => w.length >= 2);

  // 1. ID exacto
  let found = list.find(p => p.id === rawTarget);
  if (found) return found;

  // 2. SKU exacto
  found = list.find(p => p.sku && p.sku.toLowerCase().trim() === rawTarget.toLowerCase().trim());
  if (found) return found;

  // 3. Variante SKU
  found = list.find(p => p.variants && p.variants.some(v => v.sku && v.sku.toLowerCase().trim() === rawTarget.toLowerCase().trim()));
  if (found) return found;

  // 4. Nombre exacto normalizado
  found = list.find(p => cleanNorm(p.name) === targetNorm);
  if (found) return found;

  // 5. Inclusión directa
  found = list.find(p => {
    const pNorm = cleanNorm(p.name);
    return pNorm.includes(targetNorm) || targetNorm.includes(pNorm);
  });
  if (found) return found;

  // 6. Fuzzy score por palabras
  if (targetWords.length > 0) {
    let bestScore = 0;
    let bestProd = null;
    for (const p of list) {
      const pNorm = cleanNorm(p.name);
      const pSku  = cleanNorm(p.sku || '');
      let score = 0;
      for (const w of targetWords) {
        if (pNorm.includes(w)) score += 2;
        else if (pSku.includes(w)) score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        bestProd = p;
      }
    }
    if (bestScore >= 2) {
      return bestProd;
    }
  }
  return null;
};


/* ======================================================
   Lector de Códigos QR con Macro Zoom & Búsqueda por Voz
   Diseñado para Venta de Calles y lectura ágil sobre papel
   ====================================================== */

let _qrScannerStream = null;
let _qrScannerInterval = null;
let _qrScannerTrack = null;
let _currentZoomLevel = 2.0;
let _torchActive = false;
let _voiceRecognitionInstance = null;

// ==========================================
// 1. DICTADO POR VOZ (SPEECH RECOGNITION)
// ==========================================
window.startVoiceSearch = function() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showFallbackVoiceModal();
    return;
  }

  if (_voiceRecognitionInstance) {
    try { _voiceRecognitionInstance.abort(); } catch (_) {}
    _voiceRecognitionInstance = null;
  }

  const recog = new SpeechRecognition();
  _voiceRecognitionInstance = recog;

  recog.lang = 'es-419';
  recog.continuous = false;
  recog.interimResults = true;
  recog.maxAlternatives = 3;

  const btn = document.getElementById('btnVoiceSearch');
  if (btn) btn.classList.add('recording');

  showVoiceListeningModal();

  let finalTranscript = '';

  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }

    const currentText = (finalTranscript || interim || '').trim();
    const previewEl = document.getElementById('voiceTranscriptPreview');
    if (previewEl && currentText) {
      previewEl.textContent = '"' + currentText + '"';
    }

    if (finalTranscript) {
      const recognized = finalTranscript.trim();
      executeVoiceSearchQuery(recognized);
    }
  };

  recog.onerror = (e) => {
    console.warn('SpeechRecognition error:', e.error);
    if (btn) btn.classList.remove('recording');
    const previewEl = document.getElementById('voiceTranscriptPreview');

    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      if (previewEl) {
        previewEl.innerHTML = '<span style="color:#f87171;">⚠️ Permiso de micrófono bloqueado.<br><small style="color:#cbd5e1;">Toca el candado en la barra del navegador y permite el Micrófono.</small></span>';
      }
      if (typeof showToast === 'function') {
        showToast('⚠️ Permite el acceso al micrófono en el candado de la barra del navegador.', 'error', 4000);
      }
    } else if (e.error === 'no-speech') {
      if (previewEl) {
        previewEl.innerHTML = '<span style="color:#fbbf24;">No se escuchó nada. Habla más cerca del teléfono e intenta de nuevo.</span>';
      }
    } else if (e.error === 'language-not-supported') {
      try {
        recog.lang = 'es-ES';
        recog.start();
        return;
      } catch (_) {}
    } else {
      if (previewEl) {
        previewEl.innerHTML = '<span style="color:#f87171;">Error de micrófono (' + (e.error || '') + '). Puedes escribir con el teclado.</span>';
      }
    }
  };

  recog.onend = () => {
    if (btn) btn.classList.remove('recording');
    _voiceRecognitionInstance = null;
    if (!finalTranscript) {
      setTimeout(() => {
        closeVoiceListeningModal();
      }, 2000);
    }
  };

  try {
    recog.start();
  } catch (err) {
    console.error('Error starting recognition:', err);
    if (btn) btn.classList.remove('recording');
    showFallbackVoiceModal();
  }
};

function showVoiceListeningModal() {
  closeVoiceListeningModal();
  const modal = document.createElement('div');
  modal.id = 'voiceSearchModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);z-index:99999999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;padding:24px;text-align:center;touch-action:none;';
  modal.innerHTML = `
    <div style="width:84px;height:84px;border-radius:50%;background:#ef4444;display:flex;align-items:center;justify-content:center;font-size:38px;box-shadow:0 0 35px rgba(239,68,68,0.7);animation:voicePulseAnim 1.2s infinite alternate;">
      🎙️
    </div>
    <style>
      @keyframes voicePulseAnim {
        from { transform: scale(0.95); box-shadow: 0 0 15px rgba(239,68,68,0.5); }
        to { transform: scale(1.08); box-shadow: 0 0 40px rgba(239,68,68,0.85); }
      }
    </style>
    <h3 style="margin:20px 0 6px;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Te escucho...</h3>
    <p style="font-size:14px;color:#cbd5e1;max-width:320px;margin:0 0 18px;line-height:1.4;">
      Di el nombre del producto que ves en el catálogo impreso.<br>
      <span style="font-size:12px;color:#94a3b8;">Ej: <i>"Bolígrafo kilométrico"</i>, <i>"Carpeta fibra"</i>, <i>"Cinta 18"</i></span>
    </p>
    <div id="voiceTranscriptPreview" style="font-size:17px;color:#34d399;font-weight:800;min-height:36px;margin-bottom:24px;padding:8px 16px;background:rgba(255,255,255,0.08);border-radius:12px;width:100%;max-width:320px;">
      Habla ahora...
    </div>
    <div style="display:flex;gap:12px;">
      <button type="button" onclick="closeVoiceListeningModal()" style="background:#334155;color:#fff;border:none;border-radius:24px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;">
        ✕ Cancelar
      </button>
      <button type="button" onclick="closeVoiceListeningModal();showFallbackVoiceModal();" style="background:#16604A;color:#fff;border:none;border-radius:24px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer;">
        ⌨️ Escribir
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

window.closeVoiceListeningModal = function() {
  const modal = document.getElementById('voiceSearchModal');
  if (modal) modal.remove();
  if (_voiceRecognitionInstance) {
    try { _voiceRecognitionInstance.abort(); } catch (_) {}
    _voiceRecognitionInstance = null;
  }
  const btn = document.getElementById('btnVoiceSearch');
  if (btn) btn.classList.remove('recording');
};

function executeVoiceSearchQuery(query) {
  closeVoiceListeningModal();
  if (!query) return;

  const s = document.getElementById('srch');
  if (s) s.value = query;

  if (typeof showToast === 'function') {
    showToast('🔍 Buscando: "' + query + '"', 2500);
  }

  const found = (typeof window.findProductByQuery === 'function')
    ? window.findProductByQuery(query, allProducts)
    : null;

  if (found && typeof openProductModal === 'function') {
    openProductModal(found.id, { fromQr: true, searchQuery: query });
  } else {
    currentSearch = query;
    if (typeof renderProds === 'function') renderProds();
  }
}

function showFallbackVoiceModal() {
  closeVoiceListeningModal();
  const modal = document.createElement('div');
  modal.id = 'voiceFallbackModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);z-index:99999999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;padding:20px;text-align:center;';
  modal.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:18px;padding:24px;max-width:380px;width:100%;box-shadow:0 15px 35px rgba(0,0,0,0.5);">
      <div style="font-size:32px;margin-bottom:8px;">🔍</div>
      <h3 style="margin:0 0 6px;font-size:18px;font-weight:800;color:#f8fafc;">Búsqueda Rápida de Producto</h3>
      <p style="font-size:13px;color:#94a3b8;margin:0 0 16px;">Escribe el nombre o código del producto del catálogo:</p>
      
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <input type="text" id="fallbackVoiceInput" placeholder="Ej: Carpeta fibra, Cinta 18, Bolígrafo..." style="flex:1;padding:12px;border-radius:10px;border:1.5px solid #475569;background:#0f172a;color:#fff;font-size:14px;outline:none;" onkeydown="if(event.key==='Enter')window.submitFallbackSearch()">
        <button type="button" onclick="window.submitFallbackSearch()" style="background:#16604A;color:#fff;border:none;border-radius:10px;padding:0 18px;font-weight:800;font-size:14px;cursor:pointer;">Buscar</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:16px;">
        <button type="button" onclick="window.quickSearchTag('Carpetas')" style="background:#334155;color:#e2e8f0;border:none;border-radius:14px;padding:4px 10px;font-size:11px;cursor:pointer;">📁 Carpetas</button>
        <button type="button" onclick="window.quickSearchTag('Cintas')" style="background:#334155;color:#e2e8f0;border:none;border-radius:14px;padding:4px 10px;font-size:11px;cursor:pointer;">📦 Cintas</button>
        <button type="button" onclick="window.quickSearchTag('Boligrafos')" style="background:#334155;color:#e2e8f0;border:none;border-radius:14px;padding:4px 10px;font-size:11px;cursor:pointer;">🖊️ Bolígrafos</button>
        <button type="button" onclick="window.quickSearchTag('Sobres')" style="background:#334155;color:#e2e8f0;border:none;border-radius:14px;padding:4px 10px;font-size:11px;cursor:pointer;">✉️ Sobres</button>
        <button type="button" onclick="window.quickSearchTag('Resmas')" style="background:#334155;color:#e2e8f0;border:none;border-radius:14px;padding:4px 10px;font-size:11px;cursor:pointer;">📄 Resmas</button>
      </div>

      <button type="button" onclick="document.getElementById('voiceFallbackModal').remove()" style="width:100%;padding:10px;border-radius:10px;background:#475569;color:#fff;border:none;font-size:13px;font-weight:700;cursor:pointer;">
        Cerrar
      </button>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => {
    const inp = document.getElementById('fallbackVoiceInput');
    if (inp) inp.focus();
  }, 100);
}

window.submitFallbackSearch = function() {
  const inp = document.getElementById('fallbackVoiceInput');
  const q = inp ? inp.value.trim() : '';
  const m = document.getElementById('voiceFallbackModal');
  if (m) m.remove();
  if (q) executeVoiceSearchQuery(q);
};

window.quickSearchTag = function(tag) {
  const m = document.getElementById('voiceFallbackModal');
  if (m) m.remove();
  executeVoiceSearchQuery(tag);
};


// ==========================================
// 2. LECTOR MACRO QR DE ALTA DEFINICIÓN
// ==========================================
window.openInAppQrScanner = async function() {
  window.closeInAppQrScanner();

  const modal = document.createElement('div');
  modal.id = 'inAppQrModal';
  modal.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999999;display:flex;flex-direction:column;justify-content:space-between;color:#fff;overflow:hidden;touch-action:none;';
  modal.innerHTML = `
    <!-- Top Bar -->
    <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.85);z-index:10;">
      <button type="button" onclick="closeInAppQrScanner()" style="display:inline-flex;align-items:center;gap:6px;background:#ef4444;color:#fff;border:none;border-radius:24px;padding:8px 16px;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 2px 8px rgba(239,68,68,0.4);">
        ✕ Salir
      </button>
      
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" id="btnRefocus" onclick="triggerQrScannerRefocus()" style="background:#334155;color:#38bdf8;border:1px solid #0284c7;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
          🎯 Enfocar
        </button>
        <button type="button" id="btnToggleTorch" onclick="toggleQrScannerTorch()" style="background:#334155;color:#fbbf24;border:1px solid #d97706;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
          💡 Flash
        </button>
      </div>
    </div>

    <!-- Viewfinder Area con Tap-to-Focus -->
    <div id="qrScanViewport" onclick="handleQrScanTap(event)" style="position:relative;flex:1;width:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;cursor:crosshair;">
      <video id="qrScanVideo" playsinline autoplay muted style="width:100%;height:100%;object-fit:cover;transition:transform 0.15s ease-out;"></video>
      <canvas id="qrScanCanvas" style="display:none;"></canvas>

      <!-- Retícula animada de encuadre óptico -->
      <div id="qrScanReticle" style="position:absolute;width:240px;height:240px;box-shadow:0 0 0 4000px rgba(0,0,0,0.6);border-radius:18px;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:12px;transition:border-color 0.2s;">
        <div style="position:absolute;inset:0;border:3px solid transparent;border-radius:18px;background:linear-gradient(to right, #10b981 32px, transparent 32px) top left, linear-gradient(to bottom, #10b981 32px, transparent 32px) top left, linear-gradient(to left, #10b981 32px, transparent 32px) top right, linear-gradient(to bottom, #10b981 32px, transparent 32px) top right, linear-gradient(to right, #10b981 32px, transparent 32px) bottom left, linear-gradient(to top, #10b981 32px, transparent 32px) bottom left, linear-gradient(to left, #10b981 32px, transparent 32px) bottom right, linear-gradient(to top, #10b981 32px, transparent 32px) bottom right;background-repeat:no-repeat;background-size:32px 32px;"></div>
        
        <span id="qrZoomBadge" style="font-size:11px;font-weight:800;color:#10b981;background:rgba(0,0,0,0.85);padding:4px 10px;border-radius:12px;letter-spacing:0.5px;border:1px solid rgba(16,185,129,0.3);">
          MACRO ZOOM 2X ACTIVO
        </span>

        <span style="font-size:11px;color:#f8fafc;background:rgba(0,0,0,0.85);padding:4px 10px;border-radius:12px;text-align:center;border:1px solid rgba(255,255,255,0.15);">
          Mantén a 15-20 cm · Toca pantalla para enfocar
        </span>
      </div>

      <!-- Indicador animado de Tap-to-Focus -->
      <div id="qrFocusRing" style="position:absolute;width:60px;height:60px;border:2px solid #38bdf8;border-radius:8px;pointer-events:none;opacity:0;transform:translate(-50%, -50%) scale(1.4);transition:opacity 0.2s, transform 0.2s;"></div>
    </div>

    <!-- Bottom Controls Bar -->
    <div style="padding:14px 16px 20px;background:rgba(15,23,42,0.95);backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:10px;z-index:10;border-top:1px solid #334155;">
      
      <!-- Selector de Zoom Macro Dinámico -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:12px;color:#94a3b8;font-weight:700;">Macro Zoom:</span>
        <div style="display:flex;gap:6px;">
          <button type="button" class="btn-qr-zoom" id="btnZoom1" onclick="setQrScannerZoom(1.0)" style="padding:6px 14px;border-radius:16px;background:#334155;color:#fff;border:none;font-size:12px;font-weight:800;cursor:pointer;">1x Normal</button>
          <button type="button" class="btn-qr-zoom" id="btnZoom2" onclick="setQrScannerZoom(2.0)" style="padding:6px 14px;border-radius:16px;background:#10b981;color:#fff;border:none;font-size:12px;font-weight:800;cursor:pointer;">2x Macro</button>
          <button type="button" class="btn-qr-zoom" id="btnZoom3" onclick="setQrScannerZoom(3.0)" style="padding:6px 14px;border-radius:16px;background:#334155;color:#fff;border:none;font-size:12px;font-weight:800;cursor:pointer;">3x Ultra</button>
        </div>
      </div>

      <!-- Barra de Emergencia: Dictado o Teclado directo si el papel está arrugado -->
      <div style="display:flex;gap:6px;">
        <input type="text" id="inScannerSearchInput" placeholder="¿No lee? Escribe código o nombre..." style="flex:1;background:#0f172a;border:1px solid #475569;border-radius:10px;padding:8px 12px;color:#fff;font-size:13px;outline:none;" onkeydown="if(event.key==='Enter')window.submitInScannerSearch()">
        <button type="button" onclick="window.submitInScannerSearch()" style="background:#16604A;color:#fff;border:none;border-radius:10px;padding:0 14px;font-size:12px;font-weight:800;cursor:pointer;">OK</button>
        <button type="button" onclick="closeInAppQrScanner();startVoiceSearch();" style="background:#ef4444;color:#fff;border:none;border-radius:10px;padding:0 12px;font-size:14px;cursor:pointer;" title="Dictar por voz">🎙️</button>
      </div>

      <!-- Botón Gigante de Salir con el Pulgar -->
      <button type="button" onclick="closeInAppQrScanner()" style="width:100%;padding:12px;border-radius:10px;background:#334155;color:#fff;border:1px solid #475569;font-size:13px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
        ✕ Cerrar Cámara y Volver al Catálogo
      </button>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        focusMode: { ideal: 'continuous' }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    _qrScannerStream = stream;
    _qrScannerTrack = stream.getVideoTracks()[0];

    const video = document.getElementById('qrScanVideo');
    if (video) {
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
    }

    if (_qrScannerTrack && typeof _qrScannerTrack.getCapabilities === 'function') {
      const caps = _qrScannerTrack.getCapabilities();
      const adv = {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        adv.focusMode = 'continuous';
      }
      if (caps.zoom) {
        adv.zoom = Math.min(2.0, caps.zoom.max || 1);
      }
      if (Object.keys(adv).length > 0) {
        _qrScannerTrack.applyConstraints({ advanced: [adv] }).catch(() => {});
      }
    }

    setQrScannerZoom(2.0);
    startHighResQrDetectionLoop();
  } catch (err) {
    console.error('Camera access error:', err);
    closeInAppQrScanner();
    showFallbackVoiceModal();
  }
};

window.closeInAppQrScanner = function() {
  try {
    if (_qrScannerInterval) {
      clearInterval(_qrScannerInterval);
      _qrScannerInterval = null;
    }
    if (_qrScannerStream) {
      _qrScannerStream.getTracks().forEach(t => {
        try { t.stop(); } catch (_) {}
      });
      _qrScannerStream = null;
      _qrScannerTrack = null;
    }
    const video = document.getElementById('qrScanVideo');
    if (video) video.srcObject = null;
    const modal = document.getElementById('inAppQrModal');
    if (modal) modal.remove();
  } catch (e) {
    console.warn('Error closing scanner:', e);
  } finally {
    document.body.style.overflow = '';
  }
};

window.setQrScannerZoom = function(level) {
  _currentZoomLevel = level;
  ['btnZoom1', 'btnZoom2', 'btnZoom3'].forEach((id, idx) => {
    const b = document.getElementById(id);
    if (b) {
      const match = (idx + 1) === level;
      b.style.background = match ? '#10b981' : '#334155';
    }
  });

  const badge = document.getElementById('qrZoomBadge');
  if (badge) {
    badge.textContent = level === 3 ? 'ULTRA-MACRO 3X (QR PEQUEÑO)' : (level === 2 ? 'MACRO ZOOM 2X ACTIVO' : 'ZOOM 1X NORMAL');
  }

  if (_qrScannerTrack && typeof _qrScannerTrack.getCapabilities === 'function') {
    const caps = _qrScannerTrack.getCapabilities();
    if (caps.zoom) {
      const targetZoom = Math.min(Math.max(level, caps.zoom.min || 1), caps.zoom.max || 3);
      _qrScannerTrack.applyConstraints({ advanced: [{ zoom: targetZoom }] }).catch(() => {});
    }
  }

  const video = document.getElementById('qrScanVideo');
  if (video) {
    video.style.transform = level > 1 ? 'scale(' + level + ')' : 'none';
  }
};

window.triggerQrScannerRefocus = function() {
  if (!_qrScannerTrack) return;
  try {
    _qrScannerTrack.applyConstraints({
      advanced: [{ focusMode: 'continuous' }]
    }).catch(() => {});
  } catch (_) {}

  const ring = document.getElementById('qrFocusRing');
  if (ring) {
    ring.style.left = '50%';
    ring.style.top = '50%';
    ring.style.opacity = '1';
    ring.style.transform = 'translate(-50%, -50%) scale(1)';
    setTimeout(() => {
      ring.style.opacity = '0';
      ring.style.transform = 'translate(-50%, -50%) scale(1.4)';
    }, 400);
  }

  if (typeof showToast === 'function') {
    showToast('🎯 Lente re-enfocado. Mantén a 15-20 cm.', 1500);
  }
};

window.handleQrScanTap = function(e) {
  const vp = document.getElementById('qrScanViewport');
  const ring = document.getElementById('qrFocusRing');
  if (vp && ring) {
    const rect = vp.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.style.opacity = '1';
    ring.style.transform = 'translate(-50%, -50%) scale(1)';
    setTimeout(() => {
      ring.style.opacity = '0';
      ring.style.transform = 'translate(-50%, -50%) scale(1.4)';
    }, 450);
  }
  window.triggerQrScannerRefocus();
};

window.toggleQrScannerTorch = function() {
  if (!_qrScannerTrack) return;
  _torchActive = !_torchActive;
  _qrScannerTrack.applyConstraints({
    advanced: [{ torch: _torchActive }]
  }).catch(() => {});
  const btn = document.getElementById('btnToggleTorch');
  if (btn) {
    btn.style.background = _torchActive ? '#f59e0b' : '#334155';
    btn.style.color = _torchActive ? '#000' : '#fbbf24';
  }
};

window.submitInScannerSearch = function() {
  const inp = document.getElementById('inScannerSearchInput');
  const q = inp ? inp.value.trim() : '';
  if (q) {
    handleScannedQrResult(q);
  }
};

// ==========================================
// 3. MOTOR DE DETECCIÓN MACRO Y MULTI-PASO
// ==========================================
function startHighResQrDetectionLoop() {
  const video = document.getElementById('qrScanVideo');
  const canvas = document.getElementById('qrScanCanvas');
  if (!video || !canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const barcodeDetector = ('BarcodeDetector' in window)
    ? new window.BarcodeDetector({ formats: ['qr_code'] })
    : null;

  let tickCounter = 0;

  _qrScannerInterval = setInterval(async () => {
    if (!video || video.readyState < 2) return;
    tickCounter++;

    try {
      const vW = video.videoWidth || 1280;
      const vH = video.videoHeight || 720;
      const minDim = Math.min(vW, vH);

      let cropFactor = 0.35;
      if (_currentZoomLevel === 1) cropFactor = 0.60;
      if (_currentZoomLevel === 3) cropFactor = 0.22;

      if (tickCounter % 5 === 0 && _currentZoomLevel < 3) {
        cropFactor = 0.70;
      }

      const cropSize = Math.floor(minDim * cropFactor);
      const cropX = Math.floor((vW - cropSize) / 2);
      const cropY = Math.floor((vH - cropSize) / 2);

      const targetDim = 600;
      canvas.width = targetDim;
      canvas.height = targetDim;

      ctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, targetDim, targetDim);

      // PASO 1: BarcodeDetector nativo
      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(canvas);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            handleScannedQrResult(barcodes[0].rawValue);
            return;
          }
        } catch (_) {}
      }

      // PASO 2: jsQR con lectura directa
      if (typeof jsQR === 'function') {
        const imgData = ctx.getImageData(0, 0, targetDim, targetDim);
        let code = jsQR(imgData.data, targetDim, targetDim, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          handleScannedQrResult(code.data);
          return;
        }

        // PASO 3: Filtro Adaptativo Binarizado (Alto Contraste)
        const d = imgData.data;
        let minL = 255, maxL = 0;
        for (let i = 0; i < d.length; i += 16) {
          const lum = (d[i] * 38 + d[i+1] * 75 + d[i+2] * 15) >> 7;
          if (lum < minL) minL = lum;
          if (lum > maxL) maxL = lum;
        }

        if (maxL - minL > 35) {
          const threshold = (minL + maxL) >> 1;
          for (let i = 0; i < d.length; i += 4) {
            const lum = (d[i] * 38 + d[i+1] * 75 + d[i+2] * 15) >> 7;
            const v = lum > threshold ? 255 : 0;
            d[i] = v; d[i+1] = v; d[i+2] = v;
          }
          code = jsQR(d, targetDim, targetDim, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            handleScannedQrResult(code.data);
            return;
          }
        }
      }
    } catch (loopErr) {
      console.warn('QR scan frame error:', loopErr);
    }
  }, 130);
}

function handleScannedQrResult(rawText) {
  if (!rawText) return;
  closeInAppQrScanner();

  if (navigator.vibrate) navigator.vibrate([80, 50, 80]);

  let query = rawText;
  try {
    if (rawText.startsWith('http')) {
      const u = new URL(rawText);
      query = u.searchParams.get('buscar') || u.searchParams.get('q') || u.searchParams.get('producto') || u.searchParams.get('p') || u.searchParams.get('id') || '';
    }
  } catch (_) {}

  query = (query || rawText).trim();

  setTimeout(() => {
    let found = (typeof window.findProductByQuery === 'function')
      ? window.findProductByQuery(query, allProducts)
      : null;

    if (found && typeof openProductModal === 'function') {
      openProductModal(found.id, { fromQr: true, searchQuery: query });
    } else {
      const s = document.getElementById('srch');
      if (s) {
        s.value = query;
        currentSearch = query;
        if (typeof renderProds === 'function') renderProds();
      }
      if (typeof showToast === 'function') {
        showToast('🔍 Mostrando resultados para: ' + query, 3000);
      }
    }
  }, 120);
}


/* ---- Funciones Rápidas de Navegación & Procura ---- */
function quickSearch(term) {
  currentGroup = 'todos';
  currentCat   = 'todos';
  const s = document.getElementById('srch');
  if (s) s.value = term;
  currentSearch = term;
  currentPage = 1;
  renderCatFilters();
  renderSubFilters();
  renderProds();
  document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth' });
}

function shareCatalogToWhatsApp() {
  const text = 'Hola, te comparto el Catálogo Mayorista oficial de JJ Paper C.A. (+2.400 artículos de papelería, suministros y embalaje a Tasa Oficial BCV): https://jjpaper.pages.dev/catalogo';
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
}
