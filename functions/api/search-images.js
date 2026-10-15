// ======================================================================
// JJ Paper — Cloudflare Pages Function: Búsqueda Inteligente de Imágenes
// Endpoint: GET /api/search-images?q=...
// Permite buscar fotos comerciales reales de productos desde la nube
// sin requerir servidor local en la misma red ni generar errores de Mixed Content.
// ======================================================================

const KNOWN_BRANDS = [
  'CHAMEX', 'REPORT', 'HP', 'BOREAL', 'REPROSET', 'LEDESMA', 'CHAMPION',
  'AVILA', 'CARVAJAL', 'HAMMERMILL', 'SHARPIE', 'EXPO', 'SHARK', 'STAR KIT',
  'STUDMARK', 'KORES', 'MAYKA', 'OFFI-ESCOLAR', 'OFIART', 'OFIMAK', 'CRISBY',
  'ESFER', 'MISTER BOBINA', 'MR BOBINA', 'ROLLS', 'ALPHA', 'PRINTA', 'ACCO',
  'MONGOL', 'PAPER MATE', 'PAPERMATE', 'KILOMETRICO', 'INKJOY', 'LUXOR',
  'BULL', 'DURACELL', 'CASIO', 'MARFIL', 'AKTA', 'OSLO', 'CARIBE', 'TUK',
  'POST-IT', '3M', 'PRITT', 'SOLITA', 'FABER-CASTELL', 'FABER CASTELL',
  'FABERCASTELL', 'BIC', 'NORMA', 'SABONIS', 'PILOT', 'PENTEL', 'STAEDTLER',
  'PEGA-LOKA', 'PEGALOKA', 'PELIKAN', 'ARTESCO', 'FILGO', 'ARTEL', 'STABILO',
  'UHU', 'SCOTCH', 'TESA', 'CONTACT', 'BACO', 'JOVI', 'CRAYOLA', 'GIOTTO',
  'MAPED', 'ROTRING', 'LAMY', 'ZEBRA', 'UNI', 'UNI-BALL', 'MITSUBISHI',
  'TOMBOW', 'DELI', 'MAX', 'KANGARO', 'RAPID', 'KW-TRIO', 'EAGLE', 'SAX',
  'MAE', 'MON AMI', 'MONAMI', 'SIPA', 'MEMORIS', 'DOMS', 'STICK'
];

const BRAND_CORRECTIONS = {
  'CHAMEEX': 'CHAMEX',
  'CHAMEXX': 'CHAMEX',
  'PAPERMATE': 'PAPER MATE',
  'FABERCASTELL': 'FABER-CASTELL',
  'PEGALOKA': 'PEGA-LOKA',
  'STAR-KIT': 'STAR KIT',
  'MR. BOBINA': 'MISTER BOBINA',
  'MR BOBINA': 'MISTER BOBINA',
  'MRBOBINA': 'MISTER BOBINA',
  'MISTERBOBINA': 'MISTER BOBINA',
  'OFICMA': 'OFIMAK',
  'OFIMA': 'OFIMAK',
  'OFCIMA': 'OFIMAK',
  'OFCIMAK': 'OFIMAK',
  'UNIBALL': 'UNI-BALL'
};

const BRAND_ALIASES = {
  'MISTER BOBINA': ['MR BOBINA', 'MR. BOBINA', 'MISTER BOBINA', 'MRBOBINA', 'MISTERBOBINA'],
  'MR BOBINA': ['MR BOBINA', 'MR. BOBINA', 'MISTER BOBINA', 'MRBOBINA', 'MISTERBOBINA'],
  'OFIMAK': ['OFIMAK', 'OFICMA', 'OFCIMA', 'OFIMA', 'OFICMAK'],
  'OFICMA': ['OFIMAK', 'OFICMA', 'OFCIMA', 'OFIMA', 'OFICMAK'],
  'OFIMA': ['OFIMAK', 'OFICMA', 'OFCIMA', 'OFIMA', 'OFICMAK'],
  'PAPER MATE': ['PAPER MATE', 'PAPERMATE'],
  'PAPERMATE': ['PAPER MATE', 'PAPERMATE'],
  'FABER-CASTELL': ['FABER-CASTELL', 'FABER CASTELL', 'FABERCASTELL'],
  'FABER CASTELL': ['FABER-CASTELL', 'FABER CASTELL', 'FABERCASTELL'],
  'FABERCASTELL': ['FABER-CASTELL', 'FABER CASTELL', 'FABERCASTELL'],
  'PEGA-LOKA': ['PEGA-LOKA', 'PEGALOKA', 'PEGA LOKA'],
  'PEGALOKA': ['PEGA-LOKA', 'PEGALOKA', 'PEGA LOKA'],
  'STAR KIT': ['STAR KIT', 'STAR-KIT', 'STARKIT'],
  'STAR-KIT': ['STAR KIT', 'STAR-KIT', 'STARKIT'],
  'MONAMI': ['MONAMI', 'MON AMI'],
  'MON AMI': ['MONAMI', 'MON AMI'],
  'UNI-BALL': ['UNI-BALL', 'UNI', 'UNIBALL'],
  'UNI': ['UNI-BALL', 'UNI', 'UNIBALL'],
  'UNIBALL': ['UNI-BALL', 'UNI', 'UNIBALL']
};

function isSameBrand(b1, b2) {
  if (!b1 || !b2) return false;
  const u1 = b1.trim().toUpperCase();
  const u2 = b2.trim().toUpperCase();
  if (u1 === u2) return true;
  const a1 = BRAND_ALIASES[u1];
  if (a1 && a1.includes(u2)) return true;
  const a2 = BRAND_ALIASES[u2];
  if (a2 && a2.includes(u1)) return true;
  return false;
}

const ABBREVIATION_MAP = {
  'P/G': 'PUNTA GRUESA',
  'P/F': 'PUNTA FINA',
  'P/M': 'PUNTA MEDIA',
  'PTA GR': 'PUNTA GRUESA',
  'PTA GRUE': 'PUNTA GRUESA',
  'PTA F': 'PUNTA FINA',
  'PTA M': 'PUNTA MEDIA',
  'PTA.': 'PUNTA',
  'T/C': 'CARTA',
  'T/O': 'OFICIO',
  'T/L': 'LEGAL',
  'E/O': 'EXTRA OFICIO',
  'D/C': 'DOBLE CARTA',
  'C/F': 'CON FUELLE',
  'S/F': 'SIN FUELLE',
  'C/G': 'CON GANCHO',
  'S/G': 'SIN GANCHO',
  'C/T': 'CON TAPA',
  'S/T': 'SIN TAPA',
  'OFIC': 'OFICIO',
  'RESALT.': 'RESALTADOR',
  'RESALT': 'RESALTADOR',
  'P/PIZARRA': 'PARA PIZARRA',
  'P/PIZ': 'PARA PIZARRA',
  'BOLIG.': 'BOLIGRAFO',
  'BOL.': 'BOLIGRAFO',
  'MARC.': 'MARCADOR',
  'SACAP.': 'SACAPUNTAS',
  'PEGA B/': 'PEGA EN BARRA',
  'GOMA B/': 'GOMA EN BARRA',
  'SILIC.': 'SILICON',
  'TIJ.': 'TIJERA',
  'CARP.': 'CARPETA',
  'TALON.': 'TALONARIO',
  'ENCOL.': 'ENCOLADO',
  'GRAP.': 'GRAPADORA',
  'ENGRAP.': 'GRAPADORA',
  'PERF.': 'PERFORADORA',
  'PLAST.': 'PLASTILINA',
  'HJS': 'HOJAS',
  'NEG': 'NEGRO',
  'AZL': 'AZUL',
  'ROJ': 'ROJO',
  'VDE': 'VERDE',
  'AMA': 'AMARILLO',
  'BLC': 'BLANCO',
  'PERM.': 'PERMANENTE',
  'PERM': 'PERMANENTE',
  'BOR.': 'BORRABLE',
  'BOR': 'BORRABLE'
};

const BLOCKED_DOMAINS = [
  'peakpx', 'wallpaper', 'fondoshd', 'wallpaperflare', 'wallpapercave',
  'wallpaperaccess', 'wallpapersafari', 'freepik', 'vector', 'clipart',
  'icon', 'emoji', 'pngwing', 'cleanpng', 'pinterest', 'facebook',
  'instagram', 'twitter', 'tiktok', 'youtube', 'reddit', 'tumblr',
  'wikimedia', 'wikipedia', 'flickr', 'unsplash', 'pexels', 'pixabay',
  'shutterstock', 'istock', 'gettyimages', 'dreamstime', 'alamy',
  '123rf', 'depositphotos', 'lookaside.fbsbx', 'memegenerator',
  'deviantart', 'artstation', 'tenor', 'giphy'
];

const TRUSTED_DOMAINS = [
  'mayka.com.ve', 'abspapel.com.ve', 'megabytepapeleria.com', 'triomcbo.com',
  'papeleriaelcid.com', 'kores.com.ve', 'papeleriacomercial.com', 'papeleriasalazar.com',
  'dofi.com.ve', 'distribuidorajp.com', 'libreriapapeleria.com', 'librerialatino.com',
  'tecnomundo.com.ve', 'laprincipal.cl', 'lasecretaria.cl', 'mercadolibre',
  'amazon', 'sharpie.com', 'faber-castell', 'staedtler', 'pelikan',
  'officedepot', 'officemax', 'staples', 'lumen.com.mx', 'crayola',
  'pilotpen', 'pentel', 'stabilo', 'prittworld', 'bic.com', 'chamex'
];

function cleanProductName(raw) {
  let text = (raw || '').trim();
  for (const [bad, good] of Object.entries(BRAND_CORRECTIONS)) {
    const rx = new RegExp('\\b' + bad + '\\b', 'gi');
    text = text.replace(rx, good);
  }
  text = text.replace(/\b(?=[A-Z0-9_-]*\d)[A-Z0-9_-]{6,}\b/g, ' ');
  text = text.replace(/\b\d{4,}\b/g, ' ');
  text = text.replace(/[_#@$%^&*{}|\\\[\]]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function expandAbbreviations(raw) {
  let text = cleanProductName(raw).toUpperCase();
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    const cleanAbbr = abbr.endsWith('.') ? abbr.slice(0, -1) : abbr;
    const escaped = cleanAbbr.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const rx = new RegExp('\\b' + escaped + '\\.?\\b', 'gi');
    text = text.replace(rx, full);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function detectBrand(text) {
  const upper = text.toUpperCase();
  for (const b of KNOWN_BRANDS) {
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('\\b' + escaped + '\\b', 'i');
    if (rx.test(upper)) return b;
  }
  return null;
}

function buildOptimalQueries(rawName) {
  const expanded = expandAbbreviations(rawName);
  const brand = detectBrand(expanded);
  const queries = [];

  let coreType = '';
  if (/cinta|tirro|teipe|embalaje/i.test(expanded)) {
    coreType = 'cinta adhesiva embalaje transparente';
  } else if (/carpeta.*fuelle|con fuelle/i.test(expanded)) {
    coreType = 'carpeta con fuelle oficio';
  } else if (/carpeta.*fibra|marron|marrón/i.test(expanded)) {
    coreType = 'carpeta de fibra marron oficio';
  } else if (/carpeta/i.test(expanded)) {
    coreType = 'carpeta manila oficio';
  } else if (/block.*giro|talonario|recibo/i.test(expanded)) {
    coreType = 'block talonario giro recibo de dinero papel';
  } else if (/grapadora|engrapadora/i.test(expanded)) {
    coreType = 'grapadora metalica escritorio oficina';
  } else if (/resma|papel\s*bond/i.test(expanded)) {
    coreType = 'resma papel bond carta';
  } else if (/escarcha|purpurina|brillantina/i.test(expanded)) {
    coreType = 'escarcha escolar pote frasco';
  } else if (/resaltador/i.test(expanded)) {
    coreType = 'resaltador fluorescente';
  } else if (/marcador.*pizarra|pizarra/i.test(expanded)) {
    coreType = 'marcador para pizarra acrilica';
  } else if (/marcador.*permanente/i.test(expanded)) {
    coreType = 'marcador permanente punta gruesa';
  } else if (/marcador/i.test(expanded)) {
    coreType = 'marcador escolar estuche';
  } else if (/boligrafo/i.test(expanded)) {
    coreType = 'boligrafo tinta seca caja';
  } else if (/silicon/i.test(expanded)) {
    coreType = 'silicon liquido';
  } else if (/pega\s*en\s*barra|goma\s*en\s*barra/i.test(expanded)) {
    coreType = 'pega en barra';
  } else if (/sobre/i.test(expanded)) {
    coreType = 'sobre manila';
  } else if (/perforadora/i.test(expanded)) {
    coreType = 'perforadora papel';
  } else if (/tijera/i.test(expanded)) {
    coreType = 'tijera oficina';
  }

  const colorMatch = expanded.match(/\b(negro|azul|rojo|verde|amarillo|rosado|naranja|morado|blanco|transparente)\b/i);
  const color = colorMatch ? colorMatch[1].toLowerCase() : '';

  const specMatch = expanded.match(/\b(\d+gr|\d+g|\d+ml|\d+oz|\d+\/\d+|\d+x\d+)\b/i);
  const spec = specMatch ? specMatch[1].toLowerCase() : '';

  if (brand && coreType) {
    queries.push(`${brand} ${coreType} ${spec} ${color}`.replace(/\s+/g, ' ').trim());
    queries.push(`${brand} ${expanded.toLowerCase()}`.replace(/\s+/g, ' ').trim());
    queries.push(`${coreType} ${brand}`.replace(/\s+/g, ' ').trim());
  } else if (brand) {
    queries.push(`${brand} ${expanded.toLowerCase()}`.replace(/\s+/g, ' ').trim());
  } else if (coreType) {
    queries.push(`${coreType} ${spec} ${color} papeleria`.replace(/\s+/g, ' ').trim());
    queries.push(`${expanded.toLowerCase()} papeleria`.replace(/\s+/g, ' ').trim());
  } else {
    queries.push(`${expanded.toLowerCase()} papeleria`.replace(/\s+/g, ' ').trim());
  }

  const stripped = expanded
    .replace(/\b(STD|XUND|UND|CJ|CJA|PQTE|PQT|UNIDAD|CAJA|PAQUETE)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && !queries.includes(stripped.toLowerCase())) {
    queries.push(stripped.toLowerCase());
  }

  return { queries: queries.slice(0, 4), brand, coreType };
}

function scoreResult(result, targetBrand, coreType) {
  let score = 50;
  const url = (result.image || '').toLowerCase();
  const title = (result.title || '').toLowerCase();

  for (const b of BLOCKED_DOMAINS) {
    if (url.includes(b) || title.includes(b)) return -999;
  }

  // Filtrar repuestos mecánicos, válvulas, motores o elementos ajenos a papelería
  const JUNK_TERMS = ['valve', 'bleeder', 'pneumatic', 'screw', 'forklift', 'hydraulic', 'motor', 'sensor', 'pipe', 'carro', 'auto parts', 'tatuaje', 'tattoo'];
  for (const jt of JUNK_TERMS) {
    if (title.includes(jt) || url.includes(jt)) return -999;
  }

  if (coreType && coreType.includes('grapadora')) {
    if (title.includes('caja de grapas') || title.includes('grapas galvanizadas') || title.includes('staples refill') || title.includes('1000 grapas')) {
      return -500;
    }
  }

  if (coreType && coreType.includes('resma')) {
    if (title.includes('shiva') || title.includes('lingam') || title.includes('temple') || title.includes('wallpaper')) {
      return -999;
    }
  }

  if (targetBrand) {
    const brandUpper = targetBrand.toUpperCase();
    const aliases = (BRAND_ALIASES[brandUpper] || [brandUpper]).map(a => a.toLowerCase());
    const hasTargetBrand = aliases.some(a => title.includes(a) || url.includes(a));
    if (hasTargetBrand) {
      score += 80;
    } else {
      score -= 20;
      for (const otherBrand of KNOWN_BRANDS) {
        if (!isSameBrand(otherBrand, targetBrand) && title.includes(otherBrand.toLowerCase())) {
          score -= 100;
          break;
        }
      }
    }
  }

  for (const t of TRUSTED_DOMAINS) {
    if (url.includes(t)) {
      score += 30;
      break;
    }
  }

  if (title.includes('fondo blanco') || url.includes('packshot') || url.includes('catalogo') || url.includes('producto')) {
    score += 15;
  }

  return score;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function searchBing(query) {
  try {
    const url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(query) + '&form=HDRSC3&first=1';
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8' },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const murlRegex = /murl&quot;:&quot;(https?:\/\/[^"]+?)&quot;/g;
    const titleRegex = /class="(?:inflnk|iusc)"[^>]*(?:alt|aria-label)="([^"]+)"/gi;
    let m, tMatch;
    while ((m = murlRegex.exec(html)) !== null && results.length < 10) {
      tMatch = titleRegex.exec(html);
      const imgUrl = decodeURIComponent(m[1].replace(/&amp;/g, '&'));
      results.push({
        image: imgUrl,
        thumbnail: imgUrl,
        title: tMatch ? tMatch[1] : '',
        source: 'bing'
      });
    }
    return results;
  } catch (_) {
    return [];
  }
}

async function searchDuckDuckGo(query) {
  try {
    const tokenUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), 3500);
    const tokenRes = await fetch(tokenUrl, { headers: { 'User-Agent': UA }, signal: c1.signal });
    clearTimeout(t1);
    if (!tokenRes.ok) return [];
    const html = await tokenRes.text();
    const vqdMatch = html.match(/vqd=['"]?([0-9-]+)['"]?/) || html.match(/vqd=([0-9-]+)/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    const imgUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), 4500);
    const imgRes = await fetch(imgUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://duckduckgo.com/' },
      signal: c2.signal
    });
    clearTimeout(t2);
    if (!imgRes.ok) return [];
    const data = await imgRes.json();
    return (data.results || []).map(r => ({
      image: r.image,
      thumbnail: r.thumbnail || r.image,
      title: r.title || '',
      source: 'duckduckgo'
    }));
  } catch (_) {
    return [];
  }
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') || '';

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=3600'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!rawQuery.trim()) {
    return new Response(JSON.stringify({ ok: true, results: [] }), { headers: corsHeaders });
  }

  const { queries, brand, coreType } = buildOptimalQueries(rawQuery);

  const searchPromises = [];
  // Siempre consultar con la query cruda del usuario en ambos motores
  searchPromises.push(searchDuckDuckGo(rawQuery));
  searchPromises.push(searchBing(rawQuery));

  // Consultar también las queries optimizadas
  for (const q of queries) {
    if (q.toLowerCase() !== rawQuery.toLowerCase()) {
      searchPromises.push(searchBing(q));
    }
  }
  if (queries[0] && queries[0].toLowerCase() !== rawQuery.toLowerCase()) {
    searchPromises.push(searchDuckDuckGo(queries[0]));
  }

  const settled = await Promise.allSettled(searchPromises);
  let allResults = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      allResults.push(...s.value);
    }
  }

  const scored = allResults
    .map(r => ({ ...r, score: scoreResult(r, brand, coreType) }))
    .sort((a, b) => b.score - a.score);

  // Filtrado positivo; si no hay fotos con score positivo, relajar filtro para no dejar la vista vacía
  let filtered = scored.filter(r => r.score > 0);
  if (!filtered.length) {
    filtered = scored.filter(r => r.score > -200);
  }

  const seen = new Set();
  const uniqueResults = filtered.filter(r => {
    if (!r.image) return false;
    const key = r.image.split('?')[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const finalResults = uniqueResults.slice(0, 12).map(r => ({
    title: r.title || 'Foto de Producto',
    image: r.image,
    thumbnail: r.thumbnail || r.image,
    width: 800,
    height: 800,
    source: r.source || 'web',
    score: r.score
  }));

  return new Response(JSON.stringify({
    ok: true,
    query: rawQuery,
    brand,
    results: finalResults
  }), { headers: corsHeaders });
}
