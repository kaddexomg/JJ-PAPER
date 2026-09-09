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
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest'
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
        if (status === 429 || status === 403) break; // rotate key
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
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    const rx = new RegExp('\\b' + escaped + '\\b', 'gi');
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
    .replace(/\b[A-Z0-9_-]{7,}\b/g, '')        // Códigos de bodega (SKU largos)
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

  // 2. Construir queries manuales (fallback sin IA)
  const manualQueries = buildManualQueries(expanded, brand);

  // 3. Usar Gemini para generar queries superiores
  try {
    const sysPrompt = `Eres un experto en productos de papelería, útiles escolares y artículos de oficina de Venezuela y Latinoamérica. Conoces todas las marcas: Sharpie, Expo, Shark, Star Kit, Studmark, Kores, Faber-Castell, Stabilo, BIC, Pilot, Pentel, Paper Mate, Staedtler, Pelikan, Mongol, Artesco, etc.

Tu tarea es analizar el nombre de un producto de papelería (que puede tener abreviaturas venezolanas) y generar las MEJORES queries para buscar la FOTO REAL EXACTA de ese producto en Google Imágenes.

REGLAS ESTRICTAS:
- Incluye SIEMPRE la marca exacta si la detectas
- Incluye el tipo exacto de producto (marcador permanente, resaltador, bolígrafo, etc.)
- Incluye el color si se menciona
- Incluye la presentación/empaque (caja de 12, blister, etc.)
- Incluye características (punta gruesa, punta fina, etc.)
- NO incluyas palabras genéricas como "papelería", "artículo", "producto"
- Genera queries que encontrarían la FOTO COMERCIAL del fabricante

ABREVIATURAS VENEZOLANAS COMUNES:
- RESALT. = Resaltador (highlighter)
- P/PIZARRA = Para pizarra (whiteboard marker)
- C/T = Con tapa
- X 12 = Caja de 12 unidades
- PTA GR, P/G = Punta gruesa
- PERM = Permanente`;

    const userPrompt = `Producto: "${rawProductName}"
Nombre expandido: "${expanded}"
${brand ? `Marca detectada: ${brand}` : 'Marca: no detectada, intenta identificarla'}

Responde SOLO con un JSON (sin markdown, sin backticks) con este formato exacto:
{
  "product_type": "tipo de producto en español",
  "brand": "marca",
  "color": "color o null",
  "specs": "especificaciones (punta, tamaño, etc.) o null",
  "packaging": "presentación (caja 12, blister, unidad) o null",
  "query_es": "query óptima en español para Google Imágenes",
  "query_en": "query óptima en inglés para Google Images",
  "query_brand": "query con marca + producto + empaque"
}`;

    const aiResult = await callGeminiServer(userPrompt, sysPrompt);

    if (aiResult) {
      try {
        // Limpiar posibles backticks o markdown
        const jsonStr = aiResult.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        const aiQueries = [];
        // Prioridad: query con marca siempre primero
        if (parsed.query_brand) aiQueries.push(parsed.query_brand);
        if (parsed.query_es) aiQueries.push(parsed.query_es);
        if (parsed.query_en) aiQueries.push(parsed.query_en);

        // Si Gemini detectó marca que nosotros no, agregarla
        if (parsed.brand && !brand) {
          const brandQuery = `${parsed.brand} ${parsed.product_type || ''} ${parsed.color || ''} ${parsed.packaging || ''}`.trim();
          aiQueries.push(brandQuery);
        }

        log.info({
          raw: rawProductName,
          aiQueries,
          brand: parsed.brand,
          productType: parsed.product_type
        }, 'Gemini generó queries inteligentes para búsqueda de imagen');

        // Combinar: AI queries primero, luego manuales como fallback
        const uniqueQueries = [...new Set([...aiQueries, ...manualQueries])];
        return {
          queries: uniqueQueries.slice(0, 6), // Máximo 6 queries
          metadata: parsed
        };
      } catch (parseErr) {
        log.warn({ err: parseErr.message, raw: aiResult }, 'No se pudo parsear JSON de Gemini, usando queries manuales');
      }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Error en Gemini query generation, usando fallback manual');
  }

  // Fallback: queries manuales sin IA
  return { queries: manualQueries, metadata: null };
}

/**
 * Genera queries de búsqueda manuales (sin IA) como fallback.
 */
function buildManualQueries(expandedName, brand) {
  const queries = [];
  const clean = expandedName.replace(/\s+/g, ' ').trim();

  // Query 1: Nombre expandido completo
  if (brand) {
    queries.push(`${brand} ${clean.replace(new RegExp('\\b' + brand + '\\b', 'gi'), '').trim()}`);
  } else {
    queries.push(clean);
  }

  // Query 2: Solo marca + tipo de producto
  if (brand) {
    // Extraer tipo de producto
    let productType = '';
    if (/resaltador|highlighter/i.test(clean)) productType = 'resaltador';
    else if (/marcador.*pizarra|pizarra/i.test(clean)) productType = 'marcador para pizarra';
    else if (/marcador.*permanente|permanente/i.test(clean)) productType = 'marcador permanente';
    else if (/marcador/i.test(clean)) productType = 'marcador';
    else if (/bolígrafo|boligrafo|lapicero/i.test(clean)) productType = 'bolígrafo';
    else if (/lápiz|lapiz|lapices/i.test(clean)) productType = 'lápiz';
    else if (/carpeta/i.test(clean)) productType = 'carpeta';
    else if (/sacapunta/i.test(clean)) productType = 'sacapuntas';
    else if (/resma|papel/i.test(clean)) productType = 'resma de papel';
    else if (/cinta|tirro|teipe/i.test(clean)) productType = 'cinta adhesiva';

    if (productType) {
      // Extraer color
      const colorMatch = clean.match(/\b(negro|azul|rojo|verde|amarillo|rosado|rosa|naranja|morado|fucsia|blanco|transparente|surtido|multicolor)\b/i);
      const color = colorMatch ? colorMatch[1] : '';
      queries.push(`${brand} ${productType} ${color}`.trim());
    }
  }

  // Query 3: En inglés básico (para cobertura de Amazon/eBay)
  const enMap = {
    'resaltador': 'highlighter marker',
    'marcador permanente': 'permanent marker',
    'marcador para pizarra': 'dry erase whiteboard marker',
    'marcador': 'marker',
    'bolígrafo': 'ballpoint pen',
    'lápiz': 'pencil',
    'carpeta': 'file folder',
    'sacapuntas': 'pencil sharpener',
    'resma de papel': 'ream copy paper',
    'cinta adhesiva': 'tape'
  };
  if (brand) {
    for (const [es, en] of Object.entries(enMap)) {
      if (new RegExp(es, 'i').test(clean)) {
        queries.push(`${brand} ${en}`);
        break;
      }
    }
  }

  return queries.filter(q => q && q.length > 3);
}


// ======================================================================
// CAPA 2: Búsqueda Multi-Fuente de Imágenes
// ======================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Busca imágenes en Google Images mediante scraping del HTML.
 * Extrae URLs de imágenes directamente del HTML de resultados.
 */
async function searchGoogleImages(query, limit = 8) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&hl=es&num=${limit + 5}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-VE,es;q=0.9,en;q=0.7'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();

    // Extraer URLs de imágenes del HTML de Google
    const results = [];

    // Método 1: Extraer de data-src o src en img tags
    const imgRegex = /\["(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)",\s*(\d+),\s*(\d+)\]/gi;
    let m;
    while ((m = imgRegex.exec(html)) !== null && results.length < limit) {
      const imgUrl = m[1];
      const w = parseInt(m[3]) || 0;
      const h = parseInt(m[2]) || 0;
      if (w >= 100 && h >= 100 && !isBlockedDomain(imgUrl) && !imgUrl.includes('gstatic.com/images')) {
        results.push({
          image: imgUrl.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'),
          thumbnail: imgUrl,
          width: w,
          height: h,
          title: '',
          source: 'google'
        });
      }
    }

    // Método 2: Extraer de JSON embebido en el HTML (data layers)
    if (results.length < 3) {
      const jsonRegex = /"ou":"(https?:\/\/[^"]+)","ow":(\d+),"oh":(\d+)/g;
      while ((m = jsonRegex.exec(html)) !== null && results.length < limit) {
        const imgUrl = m[1];
        const w = parseInt(m[2]) || 0;
        const h = parseInt(m[3]) || 0;
        if (w >= 100 && h >= 100 && !isBlockedDomain(imgUrl)) {
          results.push({
            image: imgUrl,
            thumbnail: imgUrl,
            width: w,
            height: h,
            title: '',
            source: 'google'
          });
        }
      }
    }

    // Método 3: Extraer todas las URLs de imagen que parezcan fotos de producto
    if (results.length < 3) {
      const allImgRegex = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi;
      while ((m = allImgRegex.exec(html)) !== null && results.length < limit) {
        const imgUrl = m[0];
        if (!isBlockedDomain(imgUrl) &&
            !imgUrl.includes('gstatic') &&
            !imgUrl.includes('google.com/images') &&
            !imgUrl.includes('googleusercontent') &&
            imgUrl.length > 30 &&
            imgUrl.length < 500) {
          if (!results.find(r => r.image === imgUrl)) {
            results.push({
              image: imgUrl,
              thumbnail: imgUrl,
              width: 800,
              height: 800,
              title: '',
              source: 'google'
            });
          }
        }
      }
    }

    return results;
  } catch (e) {
    log.debug({ err: e.message, query }, 'Google Images scraping falló');
    return [];
  }
}

/**
 * Busca imágenes en DuckDuckGo Image Search (API JSON).
 */
async function searchDuckDuckGoImages(query, limit = 8) {
  try {
    // 1. Obtener token vqd
    const tokenUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
    const controller1 = new AbortController();
    const t1 = setTimeout(() => controller1.abort(), 6000);

    const vqdRes = await fetch(tokenUrl, {
      headers: { 'User-Agent': UA },
      signal: controller1.signal
    });
    clearTimeout(t1);

    const html = await vqdRes.text();
    const vqdMatch = html.match(/vqd=['"]?([0-9-]+)['"]?/) || html.match(/vqd=([0-9-]+)/);
    if (!vqdMatch) return [];
    const vqd = vqdMatch[1];

    // 2. Buscar imágenes
    const imgApiUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
    const controller2 = new AbortController();
    const t2 = setTimeout(() => controller2.abort(), 6000);

    const imgRes = await fetch(imgApiUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://duckduckgo.com/'
      },
      signal: controller2.signal
    });
    clearTimeout(t2);

    const data = await imgRes.json();
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
        source: r.source || 'duckduckgo'
      }));
  } catch (e) {
    log.debug({ err: e.message, query }, 'DuckDuckGo image search falló');
    return [];
  }
}

/**
 * Busca en Bing Images (scraping HTML).
 */
async function searchBingImages(query, limit = 6) {
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC3&first=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html',
        'Accept-Language': 'es-VE,es;q=0.9'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    // Bing embeds image data in murl attribute (media URL)
    const murlRegex = /murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g;
    let m;
    while ((m = murlRegex.exec(html)) !== null && results.length < limit) {
      const imgUrl = m[1].replace(/&amp;/g, '&');
      if (!isBlockedDomain(imgUrl) && imgUrl.length > 20 && imgUrl.length < 500) {
        results.push({
          image: imgUrl,
          thumbnail: imgUrl,
          width: 800,
          height: 800,
          title: '',
          source: 'bing'
        });
      }
    }

    return results;
  } catch (e) {
    log.debug({ err: e.message, query }, 'Bing image search falló');
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
 * Calcula un score de relevancia para cada resultado de imagen.
 * Factores: tamaño de imagen, dominio de origen, presencia de marca en URL/título.
 */
function scoreResult(result, brand, metadata) {
  let score = 0;

  // Bonus por dominio confiable (e-commerce, fabricante)
  if (isTrustedDomain(result.image)) score += 30;
  if (isTrustedDomain(result.source)) score += 20;

  // Bonus por tamaño de imagen (preferir imágenes grandes = alta resolución)
  const w = result.width || 0;
  const h = result.height || 0;
  if (w >= 500 && h >= 500) score += 20;
  else if (w >= 300 && h >= 300) score += 10;
  else if (w < 100 || h < 100) score -= 30; // Penalizar icons/thumbs diminutos

  // Bonus si la marca aparece en título o URL
  if (brand) {
    const brandLower = brand.toLowerCase();
    if ((result.title || '').toLowerCase().includes(brandLower)) score += 25;
    if ((result.image || '').toLowerCase().includes(brandLower)) score += 15;
    if ((result.source || '').toLowerCase().includes(brandLower)) score += 10;
  }

  // Bonus por tipo de producto en título
  if (metadata?.product_type) {
    const typeLower = metadata.product_type.toLowerCase();
    if ((result.title || '').toLowerCase().includes(typeLower)) score += 15;
  }

  // Penalizar URLs muy cortas (probablemente placeholders)
  if (result.image && result.image.length < 40) score -= 10;

  // Bonus por formato de imagen de alta calidad
  if (/\.(png|webp)/i.test(result.image || '')) score += 5;

  return score;
}

/**
 * Elimina imágenes duplicadas basándose en la URL normalizada.
 */
function deduplicateResults(results) {
  const seen = new Set();
  return results.filter(r => {
    // Normalizar URL para detección de duplicados
    const key = (r.image || '')
      .replace(/\?.*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


// ======================================================================
// API PÚBLICA
// ======================================================================

/**
 * FUNCIÓN PRINCIPAL: Busca fotografías reales de un producto en la web.
 *
 * Pipeline completo:
 * 1. Gemini analiza el nombre y genera queries inteligentes
 * 2. Busca en paralelo en Google, DuckDuckGo y Bing
 * 3. Valida, rankea y deduplica resultados
 * 4. Retorna las mejores N imágenes ordenadas por relevancia
 */
export async function searchProductImagesOnWeb(rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return [];

  log.info({ rawQuery }, '🔍 Iniciando búsqueda inteligente de imágenes de producto');

  // CAPA 1: Generar queries inteligentes con Gemini
  const { queries, metadata } = await generateSmartSearchQueries(rawQuery);
  const brand = metadata?.brand || detectBrand(expandAbbreviations(rawQuery));

  log.info({ queries, brand, metadata: metadata?.product_type }, 'Queries generadas para búsqueda');

  // CAPA 2: Buscar en paralelo en múltiples fuentes
  // Tomamos las 3 mejores queries y buscamos en los 3 motores
  const searchPromises = [];
  const topQueries = queries.slice(0, 3);

  for (const q of topQueries) {
    searchPromises.push(
      searchGoogleImages(q, 6).catch(() => []),
      searchDuckDuckGoImages(q, 6).catch(() => []),
      searchBingImages(q, 4).catch(() => [])
    );
  }

  const searchResults = await Promise.all(searchPromises);
  let allResults = searchResults.flat();

  log.info({ totalRaw: allResults.length, sources: topQueries.length * 3 }, 'Resultados brutos recopilados');

  // CAPA 3: Deduplicar, rankear y retornar
  allResults = deduplicateResults(allResults);

  // Asignar scores
  allResults = allResults.map(r => ({
    ...r,
    _score: scoreResult(r, brand, metadata)
  }));

  // Ordenar por score descendente
  allResults.sort((a, b) => b._score - a._score);

  // Retornar las mejores 12
  const finalResults = allResults.slice(0, 12).map(r => ({
    title: r.title || metadata?.product_type || 'Foto de Producto',
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
    topScore: finalResults[0]?._score || 0,
    queriesUsed: topQueries
  }, '✅ Búsqueda inteligente de imágenes completada');

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

  log.info({ productId, imageUrl }, 'Descargando y guardando foto real de producto');

  // 1. Descargar los bytes de la imagen
  const resp = await fetch(imageUrl, {
    headers: { 'User-Agent': UA }
  });

  if (!resp.ok) {
    throw new Error(`Error descargando imagen de la web (HTTP ${resp.status})`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('webp') ? 'webp' : (contentType.includes('png') ? 'png' : 'jpg');
  const filePath = `${productId}.${ext}`;

  // 2. Subir al bucket jjp-products en Proyecto C
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

  log.info({ productId, publicUrl, sizeBytes: buffer.length }, 'Foto real de producto vinculada exitosamente');

  return {
    success: true,
    publicUrl,
    sizeBytes: buffer.length,
    format: ext
  };
}
