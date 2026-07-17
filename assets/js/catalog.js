/* ======================================================
   JJ Paper — Catalog (Supabase + filter/sort/paginate)
   ====================================================== */

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
  const { data } = await sb.from('jjp_category_groups')
    .select('id,name,slug,emoji')
    .order('sort_order');
  if (data) catGroups = data;
}

async function loadCategories() {
  const { data } = await sb.from('jjp_categories')
    .select('id,name,slug,emoji,color,group_id')
    .order('sort_order');
  if (data) categories = data;
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
const VARIANTS_SELECT = 'jjp_product_variants(id,brand_id,variant_name,sku,price_usd,stock,min_qty,image_url,active,sort_order,jjp_brands(name,logo_url))';

// Etiqueta de una variante: "Marca · Presentación" (lo que exista)
function variantLabel(v) {
  return [v?.jjp_brands?.name, v?.variant_name].filter(Boolean).join(' · ') || null;
}

// Un producto puede venir en varias MARCAS (variantes), cada una con su
// precio y stock. Esto agrega los datos que las cards/modal necesitan:
//   variants   → variantes activas ordenadas
//   _minPrice/_maxPrice → rango de precios ("desde $X")
//   _stock     → -1 si alguna variante es sin-control; si no, suma
//   _brands    → marcas únicas disponibles
function normalizeProduct(p) {
  const vs = (p.jjp_product_variants || [])
    .filter(v => v.active !== false)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)
      || String(a.jjp_brands?.name || '').localeCompare(String(b.jjp_brands?.name || '')));
  p.variants = vs;
  if (vs.length) {
    const prices = vs.map(v => +v.price_usd);
    p._minPrice = Math.min(...prices);
    p._maxPrice = Math.max(...prices);
    p._stock    = vs.some(v => v.stock == null || v.stock < 0)
      ? -1 : vs.reduce((s, v) => s + v.stock, 0);
  } else {
    p._minPrice = p._maxPrice = +p.price_usd;
    p._stock    = (p.stock == null) ? -1 : p.stock;
  }
  p._brands = [...new Map(
    vs.filter(v => v.jjp_brands?.name).map(v => [v.jjp_brands.name, v.jjp_brands])
  ).values()];
  p._brandNames = p._brands.map(b => b.name).join(' ');
  p._skus = vs.map(v => v.sku).filter(Boolean).join(' ');
  p._varNames = vs.map(v => v.variant_name).filter(Boolean).join(' ');

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
  const { data, error } = await sb.from('jjp_products')
    .select(`id,name,description,price_usd,unit,image_url,emoji,tag,featured,essential,stock,min_qty,category_id,jjp_categories(name,slug,color,group_id),${VARIANTS_SELECT}`)
    .eq('active', true)
    .order('sort_order');
  if (error) { console.error(error); return; }
  allProducts = (data || []).map(normalizeProduct);
  // Populate lookup map for safe cart/modal calls from any page
  allProducts.forEach(p => { productMap[p.id] = p; });
}

// ---- Filter + Sort ----
// Un producto pertenece a la familia de su categoría. El id del grupo viene
// embebido en jjp_categories(group_id); lo resolvemos contra catGroups.
function groupSlugOfProduct(p) {
  const gid = p.jjp_categories?.group_id;
  return gid ? (catGroups.find(g => g.id === gid)?.slug || null) : null;
}

function getFiltered() {
  const q = normTxt(currentSearch);
  let list = allProducts.filter(p => {
    const grpOk  = currentGroup === 'todos' || groupSlugOfProduct(p) === currentGroup;
    const catOk  = currentCat   === 'todos' || p.jjp_categories?.slug === currentCat;
    const qOk    = !q || normTxt(p.name).includes(q) || normTxt(p.description).includes(q)
                      || normTxt(p._brandNames).includes(q) || normTxt(p._skus).includes(q)
                      || normTxt(p._varNames).includes(q);
    return grpOk && catOk && qOk;
  });

  if      (currentSort === 'az')    list.sort((a,b) => a.name.localeCompare(b.name));
  else if (currentSort === 'za')    list.sort((a,b) => b.name.localeCompare(a.name));
  else if (currentSort === 'pasc')  list.sort((a,b) => a._minPrice - b._minPrice);
  else if (currentSort === 'pdesc') list.sort((a,b) => b._minPrice - a._minPrice);
  // Orden por defecto: los esenciales copan la página 1. El sort es estable,
  // así que dentro de cada bloque se respeta el sort_order de la consulta.
  else list.sort((a,b) => (b.essential ? 1 : 0) - (a.essential ? 1 : 0));
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
    grid.innerHTML = `<div class="no-res rv vi">
      <div class="no-res-ico">🔍</div>
      <p>No se encontraron productos${currentSearch ? ` para "<b>${escapeHTML(currentSearch)}</b>"` : ''}</p>
      <button class="btn-p sm" style="margin-top:14px" onclick="resetFilters()">Limpiar filtros</button>
    </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  grid.innerHTML = page.map(p => productCardHTML(p)).join('');
  renderPag(pages);
  observeReveal(grid);
}

function productCardHTML(p) {
  if (p._minPrice === undefined) normalizeProduct(p);
  const cat     = p.jjp_categories || {};
  const bg      = cat.color || '#f2f2f2';
  const name    = escapeHTML(p.name);
  const soldOut = p._stock === 0;
  const multi   = (p.variants?.length || 0) > 1;
  const inCart  = (typeof cartQtyForProduct === 'function') ? cartQtyForProduct(p.id) : 0;
  // Con 1 variante el stepper opera directo; con varias, se elige marca en el modal.
  // Si hay un item viejo en el carrito (clave = producto), usar esa clave.
  const cartKey = (typeof cart !== 'undefined' &&
    Object.keys(cart).find(k => (cart[k].product_id || cart[k].id) === p.id))
    || p.variants?.[0]?.id || p.id;

  const tagHTML = p.tag
    ? `<span class="pc-tag">${escapeHTML(p.tag)}</span>` : '';

  const imgHTML = p.image_url
    ? `<img src="${optImg(p.image_url, 400)}" alt="${name}" loading="lazy" decoding="async">`
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
    ? `<span class="pc-out" style="position:static">Agotado</span>`
    : multi
    ? `<button class="add-btn" title="Elegir marca" aria-label="Elegir marca de ${name}" onclick="openProductModal('${p.id}')">${inCart > 0 ? `<span class="add-btn-badge">${inCart}</span>` : ''}+</button>`
    : inCart > 0
    ? `<div class="pc-ctrl">
         <button class="qb" onclick="updateCartQty('${cartKey}',-1)" aria-label="Quitar una unidad de ${name}">−</button>
         <span class="qn" aria-label="Cantidad en carrito">${inCart}</span>
         <button class="qb" onclick="updateCartQty('${cartKey}',1)" aria-label="Agregar una unidad de ${name}">+</button>
       </div>`
    : `<button class="add-btn" title="Agregar al carrito" aria-label="Agregar ${name} al carrito" onclick="addCartById('${p.id}')">+</button>`;

  return `<div class="pc rv${soldOut ? ' is-out' : ''}">
    <div class="pc-img${p.image_url ? ' has-img' : ''}" style="background:${bg}" onclick="openProductModal('${p.id}')"
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
  const on = s => currentGroup === s;
  const todos = `<button class="cf${on('todos') ? ' on' : ''}" data-group="todos" aria-pressed="${on('todos')}" onclick="setGroup('todos')">🏷️ Todos</button>`;
  const btns  = catGroups.map(g =>
    `<button class="cf${on(g.slug) ? ' on' : ''}" data-group="${g.slug}" aria-pressed="${on(g.slug)}" onclick="setGroup('${g.slug}')">${g.emoji} ${g.name}</button>`
  ).join('');
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
  const btns  = subs.map(c =>
    `<button class="cf sub${on(c.slug) ? ' on' : ''}" data-cat="${c.slug}" aria-pressed="${on(c.slug)}" onclick="setCat('${c.slug}')">${c.emoji} ${c.name}</button>`
  ).join('');
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

  grid.innerHTML = skeletonGridHTML(APP.PER_PAGE);

  await loadSettings();
  await Promise.all([loadCatGroups(), loadCategories(), loadProducts()]);

  // Params de entrada: ?grupo= (familia) y ?cat= (categoría fina).
  // ?cat= abre además su familia — lo resuelve setCat().
  const qs       = new URLSearchParams(location.search);
  const urlGroup = qs.get('grupo');
  const urlCat   = qs.get('cat');
  if (urlGroup && catGroups.some(g => g.slug === urlGroup)) currentGroup = urlGroup;

  renderCatFilters();
  renderSubFilters();

  if (urlCat) setCat(urlCat);
  else renderProds();
}
