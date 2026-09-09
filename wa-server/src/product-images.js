// ======================================================================
// JJ Paper — Motor Inteligente de Búsqueda de Imágenes Reales de Producto
//
// ARQUITECTURA DE 3 CAPAS:
// 1. GEMINI PRE-PROCESAMIENTO: Analiza el nombre del producto con IA y
//    genera queries de búsqueda óptimas en español e inglés con marca,
//    tipo, color, medidas, empaque exacto.
// 2. BÚSQUEDA MULTI-FUENTE: Google Images (scraping), DuckDuckGo Images,
//    y sitios especializados de papelería. Ejecuta múltiples queries
//    en paralelo para máxima cobertura.
// 3. VALIDACIÓN Y RANKING: Filtra imágenes irrelevantes por tamaño,
//    dominio de origen, y palabras clave en título/fuente.
//
// Acceso directo a las 7 API Keys de Gemini (mismo pool que el frontend)
// para procesamiento de queries inteligentes sin dependencia del navegador.
// ======================================================================
import { dbInv, dbCore } from './supabase.js';
import { SUPABASE_URL_INV } from './config.js';
import { log } from './logger.js';

// ---- Pool de API Keys Gemini (mismo que assets/js/gemini-client.js) ----
const GEMINI_KEYS = [
  'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
  'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E',
  'AQ.Ab8RN6IsSWjE9mHK9IRjNyauqgMLHLWLCJnwiEHU7Uo6sC0cNA',
  'AQ.Ab8RN6LOFt4ga-GPIkdVcDya_L2DSSrfqWTyPK3QSzM1e5pVfQ',
  'AQ.Ab8RN6I3nhWx1f54n5rcLa1nJv238N-IqJoIRWljUjZmg3nl-Q',
  'AQ.Ab8RN6K7DB2-YqkZma3jsV8EfCqHel0UnR07oY-r8qquxgKTsA',
  'AQ.Ab8RN6L0PS4XofEO8X9lbsE8P1sYD6jqItzCRvb0QbX1KvdEOw'
];

const GEMINI_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

let _geminiKeyIdx = 0;

// ---- Marcas conocidas del inventario JJ Paper ----
const KNOWN_BRANDS = [
  'SHARPIE', 'EXPO', 'SHARK', 'STAR KIT', 'STUDMARK', 'KORES', 'MAYKA',
  'OFIART', 'OFIMAK', 'CRISBY', 'ESFER', 'MISTER BOBINA', 'MR BOBINA',
  'ROLLS', 'ALPHA', 'PRINTA', 'ACCO', 'MONGOL', 'PAPER MATE', 'INKJOY',
  'LUXOR', 'BULL', 'DURACELL', 'CASIO', 'MARFIL', 'AKTA', 'OSLO',
  'CARIBE', 'TUK', 'POST-IT', '3M', 'PRITT', 'SOLITA', 'FABER-CASTELL',
  'FABER CASTELL', 'BIC', 'NORMA', 'SABONIS', 'PILOT', 'PENTEL',
  'STAEDTLER', 'PEGA-LOKA', 'PELIKAN', 'ARTESCO', 'FILGO', 'ARTEL',
  'STABILO', 'UHU', 'SCOTCH', 'TESA', 'CONTACT', 'BACO', 'JOVI',
  'CRAYOLA', 'GIOTTO', 'MAPED', 'ROTRING', 'LAMY', 'ZEBRA', 'UNI',
  'MITSUBISHI', 'TOMBOW'
];

// ---- Abreviaturas venezolanas de papelería ----
const ABBREVIATION_MAP = {
  'RESALT.': 'RESALTADOR',
  'RESALT': 'RESALTADOR',
  'P/PIZARRA': 'PARA PIZARRA',
  'P/PIZ': 'PARA PIZARRA',
  'C/T': 'CON TAPA',
  'S/T': 'SIN TAPA',
  'P/G': 'PUNTA GRUESA',
  'P/F': 'PUNTA FINA',
  'P/M': 'PUNTA MEDIA',
  'PTA GR': 'PUNTA GRUESA',
  'PTA GRUE': 'PUNTA GRUESA',
  'PTA F': 'PUNTA FINA',
  'PTA M': 'PUNTA MEDIA',
  'NEG': 'NEGRO',
  'AZL': 'AZUL',
  'ROJ': 'ROJO',
  'VDE': 'VERDE',
  'AMA': 'AMARILLO',
  'PERM': 'PERMANENTE',
  'PERM.': 'PERMANENTE',
  'BOR': 'BORRABLE',
  'BOR.': 'BORRABLE',
  'T/C': 'TAMAÑO CARTA',
  'T/O': 'TAMAÑO OFICIO',
  'T/L': 'TAMAÑO LEGAL',
  'E/O': 'EXTRA OFICIO',
  'GR.': 'GRUESO',
  'GR': 'GRUESO',
  'FN': 'FINO',
  'MED': 'MEDIO'
};

// ---- Dominios confiables para fotos de productos reales ----
const TRUSTED_DOMAINS = [
  'mercadolibre', 'amazon', 'sharpie.com', 'faber-castell',
  'staedtler', 'pelikan', 'officedepot', 'officemax',
  'lumen.com.mx', 'dideco', 'papeleriamoderna', 'crayola',
  'expo-markers', 'pilotpen', 'pentel', 'stabilo',
  'shopify', 'walmartimages', 'target.com', 'staples',
  'ebayimg', 'alicdn', 'cdnimg', 'media.officedepot'
];

// Dominios basura que nunca tienen fotos de productos reales
const BLOCKED_DOMAINS = [
  'pinterest', 'facebook', 'instagram', 'twitter',
  'tiktok', 'youtube', 'reddit', 'tumblr',
  'wikimedia', 'wikipedia', 'flickr', 'unsplash',
  'pexels', 'pixabay', 'shutterstock', 'istock',
  'gettyimages', 'dreamstime', 'alamy', '123rf',
  'clipart', 'vector', 'icon', 'emoji'
];


// ======================================================================
// CAPA 1: Pre-procesamiento inteligente con Gemini AI
// ======================================================================

/**
 * Llama a Gemini AI en el servidor para generar queries de búsqueda óptimas.
 * Rota por las 7 keys y múltiples modelos para máxima disponibilidad.
 */
async function callGeminiServer(prompt, systemInstruction = '', temperature = 0.2) {
  const maxAttempts = GEMINI_KEYS.length * 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = GEMINI_KEYS[_geminiKeyIdx % GEMINI_KEYS.length];
    _geminiKeyIdx++;

    for (const model of GEMINI_MODELS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 800 }
        };
        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text.trim()) return text.trim();
        }

        const status = res.status;
        if (status === 429 || status === 403 || status === 400) break; // rotate key
        if (status === 503 || status === 404) continue; // try next model
      } catch (e) {
        if (e.name === 'AbortError') break; // timeout, try next key
        break;
      }
    }
  }
  return null;
}

/**
 * Expande abreviaturas venezolanas de papelería en un nombre de producto.
 */
function expandAbbreviations(rawName) {
  let name = rawName.toUpperCase();
  for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
    // Reemplazar abreviatura como palabra completa
    const cleanAbbr = abbr.endsWith('.') ? abbr.slice(0, -1) : abbr;
    const escaped = cleanAbbr.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const rx = new RegExp('\\b' + escaped + '\\.?\\b', 'gi');
    name = name.replace(rx, full);
  }
  return name;
}

/**
 * Detecta la marca conocida en el nombre del producto.
 */
function detectBrand(name) {
  const upper = name.toUpperCase();
  for (const b of KNOWN_BRANDS) {
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('\\b' + escaped + '\\b', 'i');
    if (rx.test(upper)) return b;
  }
  return null;
}

/**
 * Limpia códigos de bodega, caracteres especiales y normaliza el nombre.
 */
function cleanProductName(rawName) {
  return rawName
    .replace(/\b(?=[A-Z0-9_-]*\d)[A-Z0-9_-]{6,}\b/g, '')        // Códigos de bodega (SKU largos)
    .replace(/\b\d{4,}\b/g, '')                  // Números de 4+ dígitos solos
    .replace(/[_#@$%^&*{}|\\]/g, ' ')            // Símbolos basura
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CAPA 1 PRINCIPAL: Usa Gemini para generar queries de búsqueda inteligentes
 * a partir del nombre del producto.
 *
 * Retorna un objeto con múltiples queries optimizadas para búsqueda de imágenes.
 */
async function generateSmartSearchQueries(rawProductName) {
  // 1. Limpieza básica + expansión de abreviaturas
  const cleaned = cleanProductName(rawProductName);
  const expanded = expandAbbreviations(cleaned);
  const brand = detectBrand(expanded);

  // 2. Construir queries manuales canónicas
  const manualQueries = buildManualQueries(expanded, brand);

  // 3. Usar Gemini para deliberación profunda (rotando pool de 7 llaves)
  try {
    const sysPrompt = `Eres un experto de élite en artículos de papelería, útiles escolares, oficina e imprenta comercial en Venezuela y Latinoamérica (marcas: Sharpie, Expo, Shark, Star Kit, Studmark, Kores, Faber-Castell, Stabilo, BIC, Pilot, Pentel, Paper Mate, Staedtler, Pelikan, Mongol, Artesco, Mayka, Ofiart, etc.).

Tu tarea es analizar el nombre de inventario de un producto (con códigos, abreviaturas y medidas de bodega) y extraer la información CANÓNICA para encontrar fotos comerciales REALES en la web.

REGLAS CRÍTICAS DE DIFERENCIACIÓN:
- Distingue máquina/herramienta de consumible: "GRAPADORA 24/6" es una GRAPADORA DE ESCRITORIO, NO una caja de grapas ni alfileres.
- "ESCARCHA 50GR" es escarcha/brillantina/purpurina/glitter escolar en frasco plástico, NO pólvora, balas ni talco.
- "BLOCK DE RECIBO" es un talonario de recibos de papel impreso (1/4 carta), NO una plantilla de Excel ni software.
- "TALONARIO FACTURA" es un block de facturas impreso en papel bond/químico.
- Genera queries canónicas limpias que encuentren fotos auténticas de fabricantes o papelerías.
- Indica palabras negativas estrictas que arruinarían la búsqueda.`;

    const userPrompt = `Producto de inventario: "${rawProductName}"
Nombre expandido: "${expanded}"
${brand ? `Marca detectada: ${brand}` : 'Detecta la marca si existe'}

Responde con JSON puro (sin markdown, sin backticks):
{
  "product_type": "tipo exacto de producto en español",
  "brand": "marca o null",
  "canonical_title": "título comercial limpio en español",
  "packshot_en": "1 concise sentence in English describing the physical retail product for studio photography on pure white background",
  "queries": [
    "query precisa con marca y producto",
    "query con producto y fondo blanco",
    "query en inglés para catálogo internacional"
  ],
  "negative_keywords": ["palabras a excluir"]
}`;

    const aiResult = await callGeminiServer(userPrompt, sysPrompt);

    if (aiResult) {
      try {
        const jsonStr = aiResult.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        const aiQueries = Array.isArray(parsed.queries) ? parsed.queries.filter(Boolean) : [];
        if (parsed.brand && !brand) {
          aiQueries.unshift(`${parsed.brand} ${parsed.product_type || ''}`.trim());
        }

        log.info({
          raw: rawProductName,
          aiQueries,
          brand: parsed.brand,
          canonicalTitle: parsed.canonical_title,
          productType: parsed.product_type
        }, '🧠 Gemini deliberó y generó queries canónicas para búsqueda de imagen');

        const uniqueQueries = [...new Set([...aiQueries, ...manualQueries])].filter(Boolean);
        return {
          queries: uniqueQueries.slice(0, 6),
          metadata: parsed,
          negative_keywords: Array.isArray(parsed.negative_keywords) ? parsed.negative_keywords : []
        };
      } catch (parseErr) {
        log.warn({ err: parseErr.message, raw: aiResult }, 'No se pudo parsear JSON de Gemini, usando queries manuales');
      }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Error en Gemini query generation, usando fallback manual');
  }

  return { queries: manualQueries, metadata: null, negative_keywords: [] };
}

/**
 * Genera queries de búsqueda manuales robustas con taxonomía exhaustiva de papelería.
 */
function buildManualQueries(expandedName, brand) {
  const queries = [];
  const clean = expandedName.replace(/\s+/g, ' ').trim();

  let productType = '';
  let enProductType = '';

  if (/grapadora|engrapadora/i.test(clean)) {
    productType = 'grapadora metalica escritorio oficina fondo blanco';
    enProductType = 'metal desktop office stapler white background';
  } else if (/escarcha|purpurina|brillantina/i.test(clean)) {
    productType = 'escarcha decorativa frasco 50g papeleria';
    enProductType = 'craft glitter shaker jar bottle';
  } else if (/recibo|talonario|factura/i.test(clean)) {
    productType = 'talonario block recibo de dinero papel 1/4 carta';
    enProductType = 'money receipt pad stationery paper book';
  } else if (/perforadora/i.test(clean)) {
    productType = 'perforadora de papel 2 huecos oficina';
    enProductType = '2 hole paper punch metal office';
  } else if (/resaltador|highlighter/i.test(clean)) {
    productType = 'resaltador fluorescente punta biselada';
    enProductType = 'highlighter marker chisel tip';
  } else if (/marcador.*pizarra|pizarra/i.test(clean)) {
    productType = 'marcador para pizarra acrilica recargable';
    enProductType = 'dry erase whiteboard marker';
  } else if (/marcador.*permanente|permanente/i.test(clean)) {
    productType = 'marcador permanente punta gruesa';
    enProductType = 'permanent marker';
  } else if (/marcador/i.test(clean)) {
    productType = 'marcador escolar estuche papeleria';
    enProductType = 'felt tip marker stationery set';
  } else if (/boligrafo.*gel/i.test(clean)) {
    productType = 'boligrafo de gel tinta suave';
    enProductType = 'gel ink pen';
  } else if (/boligrafo|lapicero|pluma/i.test(clean)) {
    productType = 'boligrafo tinta seca caja';
    enProductType = 'ballpoint pen box';
  } else if (/lapiz|lapices/i.test(clean)) {
    productType = 'lapiz de grafito escolar';
    enProductType = 'graphite pencil box';
  } else if (/carpeta/i.test(clean)) {
    productType = 'carpeta manila fibra oficina';
    enProductType = 'manila office file folder';
  } else if (/sobre/i.test(clean)) {
    productType = 'sobre manila correspondencia papeleria';
    enProductType = 'manila envelope stationery';
  } else if (/sacapunta/i.test(clean)) {
    productType = 'sacapuntas con deposito escolar';
    enProductType = 'pencil sharpener canister';
  } else if (/resma|papel\s*bond/i.test(clean)) {
    productType = 'resma de papel bond blanco';
    enProductType = 'copy paper ream 500 sheets';
  } else if (/cinta|tirro|teipe/i.test(clean)) {
    productType = 'cinta adhesiva embalaje transparente';
    enProductType = 'packing adhesive tape roll';
  } else if (/silicon|silicona/i.test(clean)) {
    productType = 'silicon liquido escolar papeleria';
    enProductType = 'liquid craft silicone glue bottle';
  } else if (/tijera/i.test(clean)) {
    productType = 'tijera de oficina escolar acero inoxidable';
    enProductType = 'stationery scissors stainless steel';
  } else if (/regla/i.test(clean)) {
    productType = 'regla metrica escolar 30cm';
    enProductType = 'ruler 30cm stationery';
  } else if (/almohadilla|huellero/i.test(clean)) {
    productType = 'almohadilla dactilar tinta para sellos';
    enProductType = 'stamp ink pad fingerprint';
  }

  // Extraer color si existe
  const colorMatch = clean.match(/\b(negro|azul|rojo|verde|amarillo|rosado|rosa|naranja|morado|fucsia|blanco|dorado|plata|plateado|transparente)\b/i);
  const color = colorMatch ? colorMatch[1].toLowerCase() : '';

  if (brand && productType) {
    queries.push(`${brand} ${productType} ${color}`.trim());
    if (enProductType) queries.push(`${brand} ${enProductType} ${color}`.trim());
  } else if (brand) {
    queries.push(`${brand} ${clean}`.trim());
  } else if (productType) {
    queries.push(`${productType} ${color}`.trim());
    if (enProductType) queries.push(`${enProductType} ${color}`.trim());
  }

  // Query limpia de respaldo
  const strippedClean = clean
    .replace(/\b(STD|C\/G|C\/T|S\/T|P\/G|P\/F|P\/M|24\/6|26\/6|50GR|100GR|X\s*\d+)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (strippedClean && strippedClean.length > 4 && !queries.includes(strippedClean)) {
    queries.push(`${strippedClean} fondo blanco`);
  }

  return queries.filter(Boolean);
}


// ======================================================================
// CAPA 2: Búsqueda Multi-Fuente de Imágenes
// ======================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';



/**
 * Busca imágenes en DuckDuckGo Image Search (API JSON).
 */
async function searchDuckDuckGoImages(query, limit = 8) {
  try {
    const tokenUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
    const controller1 = new AbortController();
    const t1 = setTimeout(() => controller1.abort(), 4000);

    const vqdRes = await fetch(tokenUrl, {
      headers: { 'User-Agent': UA },
      signal: controller1.signal
    });
    clearTimeout(t1);

    if (!vqdRes.ok) return [];
    const html = await vqdRes.text();
    const vqdMatch = html.match(/vqd=['"]?([0-9-]+)['"]?/) || html.match(/vqd=([0-9-]+)/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    const imgApiUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
    const controller2 = new AbortController();
    const t2 = setTimeout(() => controller2.abort(), 5000);

    const imgRes = await fetch(imgApiUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://duckduckgo.com/'
      },
      signal: controller2.signal
    });
    clearTimeout(t2);

    if (!imgRes.ok) return [];
    const rawText = await imgRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      return [];
    }

    const list = data.results || [];
    return list
      .filter(r => r.image &&
        !r.image.includes('.svg') &&
        !r.image.includes('favicon') &&
        !isBlockedDomain(r.image))
      .slice(0, limit)
      .map(r => ({
        title: r.title || '',
        image: r.image,
        thumbnail: r.thumbnail || r.image,
        width: r.width || 800,
        height: r.height || 800,
        source: 'duckduckgo'
      }));
  } catch (e) {
    log.debug({ err: e.message, query }, 'DuckDuckGo image search omitido');
    return [];
  }
}

/**
 * Busca en Bing Images (scraping HTML directo, ultra confiable sin rate-limits agresivos).
 */
async function searchBingImages(query, limit = 8) {
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC3&first=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-VE,es;q=0.9,en;q=0.8'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const murlRegex = /murl&quot;:&quot;(https?:\/\/[^"]+?)&quot;/g;
    const titleRegex = /class="(?:inflnk|iusc)"[^>]*(?:alt|aria-label)="([^"]+)"/gi;
    let m, tMatch;
    while ((m = murlRegex.exec(html)) !== null && results.length < limit) {
      tMatch = titleRegex.exec(html);
      const titleStr = tMatch ? tMatch[1] : '';
      const imgUrl = decodeURIComponent(m[1].replace(/&amp;/g, '&'));
      if (!isBlockedDomain(imgUrl) && imgUrl.length > 20 && imgUrl.length < 600) {
        results.push({
          image: imgUrl,
          thumbnail: imgUrl,
          width: 800,
          height: 800,
          title: titleStr,
          source: 'bing'
        });
      }
    }

    return results;
  } catch (e) {
    log.debug({ err: e.message, query }, 'Bing image search omitido');
    return [];
  }
}


// ======================================================================
// CAPA 3: Validación, Ranking y Deduplicación
// ======================================================================

/**
 * Verifica si un dominio está en la lista de bloqueados.
 */
function isBlockedDomain(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return BLOCKED_DOMAINS.some(d => lower.includes(d));
}

/**
 * Verifica si un dominio está en la lista de confianza.
 */
function isTrustedDomain(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return TRUSTED_DOMAINS.some(d => lower.includes(d));
}

/**
 * Filtra imágenes que coincidan con palabras clave negativas (para evitar grapas en vez de grapadoras, etc.).
 */
function filterNegativeKeywords(results, negativeTerms) {
  if (!negativeTerms || !negativeTerms.length) return results;
  const lowerTerms = negativeTerms.map(t => t.toLowerCase().trim()).filter(Boolean);
  return results.filter(r => {
    const textToCheck = ((r.title || '') + ' ' + (r.image || '')).toLowerCase();
    for (const term of lowerTerms) {
      if (textToCheck.includes(term)) return false;
    }
    return true;
  });
}

function getCategoryNegativeTerms(text, productType) {
  const combined = ((text || '') + ' ' + (productType || '')).toLowerCase();
  const negatives = [];
  if (/grapad|stapler/i.test(combined)) {
    negatives.push('caja de grapas', 'staples only', 'staple refill', 'wire pins', 'clavos', 'alfileres', 'caja grapas');
  }
  if (/escarcha|glitter|purpurina/i.test(combined)) {
    negatives.push('bullet', 'ammunition', 'powder horn', 'baby powder', 'talco', 'suplemento', 'protein');
  }
  if (/recibo|factura|talonario|forma continua/i.test(combined)) {
    negatives.push('excel', 'spreadsheet', 'software', 'download', 'app store', 'plantilla digital');
  }
  return negatives;
}

/**
 * Calcula un score de relevancia para cada resultado de imagen.
 */
function scoreResult(result, brand, metadata) {
  let score = 50;
  const imgUrl = result.image.toLowerCase();
  const title = (result.title || '').toLowerCase();

  if (isTrustedDomain(result.image)) score += 30;

  if (brand) {
    const brandLower = brand.toLowerCase();
    if (imgUrl.includes(brandLower) || title.includes(brandLower)) score += 25;
  }

  if (metadata?.product_type) {
    const typeWords = metadata.product_type.toLowerCase().split(' ').filter(w => w.length > 3);
    for (const w of typeWords) {
      if (title.includes(w) || imgUrl.includes(w)) score += 10;
    }
  }

  if (imgUrl.includes('packshot') || imgUrl.includes('product') || imgUrl.includes('catalogo') || imgUrl.includes('articulo')) {
    score += 15;
  }

  if (result.width >= 500 && result.height >= 500) score += 10;
  return score;
}

function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(r => {
    if (!r.image) return false;
    const cleanUrl = r.image.split('?')[0].toLowerCase();
    if (seen.has(cleanUrl)) return false;
    seen.add(cleanUrl);
    return true;
  });
}


// ======================================================================
// API PÚBLICA
// ======================================================================

/**
 * FUNCIÓN PRINCIPAL: Busca fotografías reales de un producto en la web.
 * Pipeline de 3 capas:
 * 1. Deliberación inteligente con Gemini (IA) para obtener queries canónicas y descartes
 * 2. Búsqueda paralela en Bing y DuckDuckGo con las queries canónicas
 * 3. Filtrado negativo, rankeo comercial y deduplicación
 */
export async function searchProductImagesOnWeb(rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return [];

  const startTime = Date.now();
  log.info({ rawQuery }, '🔍 Iniciando búsqueda inteligente de imágenes de producto');

  // CAPA 1: Extracción rápida y deliberación con Gemini
  const cleaned = cleanProductName(rawQuery);
  const expanded = expandAbbreviations(cleaned);
  const brand = detectBrand(expanded);

  let smart = null;
  try {
    smart = await generateSmartSearchQueries(rawQuery);
  } catch (e) {
    log.warn({ err: e.message }, 'Gemini deliberation falló, usando fallback heurístico');
  }

  const queries = (smart?.queries && smart.queries.length > 0)
    ? smart.queries
    : buildManualQueries(expanded, brand);

  const metadata = smart?.metadata || null;
  const negativeTerms = [
    ...(smart?.negative_keywords || []),
    ...getCategoryNegativeTerms(expanded, metadata?.product_type)
  ];

  log.info({ rawQuery, queries, brand, productType: metadata?.product_type }, 'Ejecutando búsqueda multi-fuente con queries canónicas');

  // CAPA 2: Búsqueda paralela en Bing y DuckDuckGo usando queries canónicas
  const searchPromises = [];
  // Bing es extremadamente fiable con queries canónicas
  for (const q of queries.slice(0, 4)) {
    searchPromises.push(searchBingImages(q, 6));
  }
  // DuckDuckGo en paralelo
  if (queries[0]) {
    searchPromises.push(searchDuckDuckGoImages(queries[0], 6));
  }

  const settled = await Promise.allSettled(searchPromises);
  let allResults = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      allResults.push(...s.value);
    }
  }

  // Si tenemos pocos resultados (<3), probar con la 3ra query en Bing
  if (allResults.length < 3 && queries[2]) {
    try {
      const extraBing = await searchBingImages(queries[2], 6);
      if (extraBing.length) allResults.push(...extraBing);
    } catch (_) {}
  }

  // CAPA 3: Filtrado negativo, deduplicación y ranking
  allResults = filterNegativeKeywords(allResults, negativeTerms);
  allResults = deduplicateResults(allResults);

  allResults = allResults.map(r => ({
    ...r,
    _score: scoreResult(r, brand, metadata)
  }));

  allResults.sort((a, b) => b._score - a._score);

  const finalResults = allResults.slice(0, 12).map(r => ({
    title: r.title || metadata?.canonical_title || metadata?.product_type || 'Foto de Producto',
    image: r.image,
    thumbnail: r.thumbnail || r.image,
    width: r.width || 800,
    height: r.height || 800,
    source: r.source || '',
    score: r._score
  }));

  log.info({
    query: rawQuery,
    brand,
    totalFound: finalResults.length,
    elapsedMs: Date.now() - startTime
  }, '✅ Búsqueda inteligente completada con éxito');

  return finalResults;
}

/**
 * Descarga una fotografía real desde la web, la sube al bucket de Supabase Storage
 * y actualiza la URL del producto en jjp_products
 */
export async function saveProductImageToStorage(productId, imageUrl) {
  if (!productId || !imageUrl) {
    throw new Error('productId e imageUrl requeridos');
  }

  log.info({ productId, imageUrl: imageUrl.slice(0, 100) }, 'Descargando y guardando foto de producto');

  let buffer;
  let contentType = 'image/jpeg';

  // 1. Obtener los bytes de la imagen (vía data: URI o fetch HTTP)
  if (imageUrl.startsWith('data:')) {
    const matches = imageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      contentType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      const commaIdx = imageUrl.indexOf(',');
      buffer = Buffer.from(imageUrl.slice(commaIdx + 1), 'base64');
    }
  } else {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(imageUrl, {
      headers: { 'User-Agent': UA },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`Error descargando imagen de la web (HTTP ${resp.status})`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    contentType = resp.headers.get('content-type') || 'image/jpeg';
  }

  if (!buffer || buffer.length === 0) {
    throw new Error('El archivo de imagen está vacío o corrupto');
  }

  const ext = contentType.includes('webp') ? 'webp' : (contentType.includes('png') ? 'png' : 'jpg');
  const filePath = `${productId}.${ext}`;

  // 2. Subir al bucket jjp-products en Proyecto C (Inventario & Storage)
  const { error: uploadErr } = await dbInv.storage
    .from('jjp-products')
    .upload(filePath, buffer, {
      contentType,
      upsert: true
    });

  if (uploadErr) {
    throw new Error(`Error subiendo imagen a Storage: ${uploadErr.message}`);
  }

  const publicUrl = `${SUPABASE_URL_INV}/storage/v1/object/public/jjp-products/${filePath}?v=${Date.now()}`;

  // 3. Actualizar jjp_products en Proyecto A (Core)
  const { error: dbErr } = await dbCore
    .from('jjp_products')
    .update({ image_url: publicUrl })
    .eq('id', productId);

  if (dbErr) {
    log.warn({ err: dbErr.message }, 'No se pudo actualizar image_url en jjp_products, pero el archivo se subió a Storage');
  }

  log.info({ productId, publicUrl, sizeBytes: buffer.length }, 'Foto de producto vinculada exitosamente');

  return {
    success: true,
    publicUrl,
    sizeBytes: buffer.length,
    format: ext
  };
}
