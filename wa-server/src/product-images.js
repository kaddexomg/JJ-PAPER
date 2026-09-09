// ======================================================================
// JJ Paper — Motor de Búsqueda y Optimización de Imágenes Reales de Producto
// - Busca fotografías reales de productos en la web y catálogos comerciales
// - Descarga, valida y almacena imágenes en Proyecto C (Storage)
// - Vincula automáticamente a la base de datos de productos (Proyecto A)
// ======================================================================
import { dbInv, dbCore } from './supabase.js';
import { SUPABASE_URL_INV } from './config.js';
import { log } from './logger.js';

/**
 * Busca imágenes reales de un producto en la web usando DuckDuckGo Image Search
 */
export async function searchProductImagesOnWeb(rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return [];

  // Limpiar el término de búsqueda para máxima efectividad en motores web
  const cleanQ = rawQuery
    .replace(/\b[A-Z0-9_-]{7,}\b/g, '') // Códigos largos de bodega
    .replace(/\b(?:caja|bulto|und|unidad|unidades|resma)\b/gi, '') // Palabras genéricas
    .replace(/\s+/g, ' ')
    .trim();

  const searchTerms = [cleanQ];
  // Si tiene abreviaturas venezolanas como RESALT. o P/PIZARRA, expandirlas
  const expanded = cleanQ
    .replace(/\bresalt\b|\bresalt\./gi, 'resaltador')
    .replace(/\bp\/pizarra\b|\bmarcador\s*p\/pizarra\b/gi, 'marcador pizarra')
    .replace(/\bc\/t\b/gi, 'con tapa')
    .replace(/\bx\s*\d+\b/gi, '')
    .trim();

  if (expanded && expanded !== cleanQ) {
    searchTerms.unshift(expanded);
  }

  let finalResults = [];

  for (const q of searchTerms) {
    try {
      const tokenUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(q + ' papeleria');
      const vqdRes = await fetch(tokenUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      const html = await vqdRes.text();
      const match = html.match(/vqd=['"]?([0-9-]+)['"]?/) || html.match(/vqd=([0-9-]+)/);
      if (!match) continue;
      const vqd = match[1];

      const imgApiUrl = `https://duckduckgo.com/i.js?l=es-es&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,&p=1`;
      const imgRes = await fetch(imgApiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://duckduckgo.com/'
        }
      });
      const data = await imgRes.json();
      const list = data.results || [];

      if (list.length > 0) {
        finalResults = list
          .filter(r => r.image && !r.image.includes('.svg') && !r.image.includes('favicon'))
          .slice(0, 10)
          .map(r => ({
            title: r.title || 'Foto de Producto',
            image: r.image,
            thumbnail: r.thumbnail || r.image,
            width: r.width || 800,
            height: r.height || 800,
            source: r.source || ''
          }));
        break; // Ya encontramos resultados válidos
      }
    } catch (e) {
      log.warn({ err: e.message, query: q }, 'Error buscando fotos de producto en la web');
    }
  }

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
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
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
