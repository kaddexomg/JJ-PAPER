// ======================================================================
// JJ Paper — Motor Ontológico de Productos e Imágenes (AI Engine)
// Analiza productos en 5 dimensiones (Tipo, Marca, Color/Variante, Empaque, Cantidad)
// para decidir si debe buscar/generar caja, blíster, resma o pieza suelta.
// ======================================================================

export const KNOWN_PACKAGING_PATTERNS = [
  { regex: /\b(X\s*12|DOCENA|DOC|C\/12|CAJA\s*X\s*12|12\s*PZA|12\s*UND)\b/i, type: 'caja_x12', qty: 12, label: 'Caja x 12 unidades' },
  { regex: /\b(X\s*24|C\/24|CAJA\s*X\s*24|24\s*PZA|24\s*UND)\b/i, type: 'caja_x24', qty: 24, label: 'Caja x 24 unidades' },
  { regex: /\b(X\s*6|PACK\s*X\s*6|BLISTER\s*X\s*6|6\s*COL|SURT\s*X\s*6)\b/i, type: 'blister_x6', qty: 6, label: 'Blíster / Paquete x 6' },
  { regex: /\b(X\s*4|BLISTER\s*X\s*4|4\s*COL|SURT\s*X\s*4)\b/i, type: 'blister_x4', qty: 4, label: 'Blíster / Paquete x 4' },
  { regex: /\b(X\s*2|BLISTER\s*X\s*2|DUO\s*PACK|2\s*PZA)\b/i, type: 'blister_x2', qty: 2, label: 'Blíster x 2 unidades' },
  { regex: /\b(RESMA|500\s*HJS|500\s*HOJAS)\b/i, type: 'resma', qty: 500, label: 'Resma empaque original' },
  { regex: /\b(BULTO|C\/5\s*RESMAS|C\/10\s*RESMAS)\b/i, type: 'bulto', qty: 1, label: 'Bulto de fábrica' },
  { regex: /\b(ROLLO|BOBINA)\b/i, type: 'rollo', qty: 1, label: 'Rollo o Bobina individual' },
  { regex: /\b(BLISTER|BLIST)\b/i, type: 'blister', qty: 1, label: 'Blíster exhibidor' },
  { regex: /\b(CAJA|CJ)\b/i, type: 'caja', qty: 1, label: 'Caja de empaque' },
  { regex: /\b(UND|UNID|PIEZA|PZA|1\s*UND)\b/i, type: 'unidad_suelta', qty: 1, label: 'Unidad individual suelta' }
];

export const KNOWN_BRANDS_MAP = [
  'EXPO', 'KORES', 'SHARPIE', 'PAPER MATE', 'BIC', 'FABER-CASTELL', 'CHAMEX', 'REPORT',
  'HP', 'BOREAL', 'LEDESMA', 'STUDMARK', 'SOLITA', 'OFIMAK', 'OFIART', 'MAYKA',
  'MISTER BOBINA', 'CRISBY', 'ALPHA', 'PRINTA', 'ACCO', 'MONGOL', 'KILOMETRICO',
  'INKJOY', 'LUXOR', 'DURACELL', 'CASIO', 'POST-IT', '3M', 'PRITT', 'PILOT',
  'PENTEL', 'STAEDTLER', 'PEGA-LOKA', 'PELIKAN', 'ARTESCO', 'FILGO', 'STABILO',
  'UHU', 'SCOTCH', 'CRAYOLA', 'MAPED', 'ROTRING', 'DELI', 'MAX', 'KANGARO', 'RAPID'
];

export const KNOWN_COLORS_MAP = [
  { match: /\b(ROJO|ROJ|RED)\b/i, es: 'Rojo', en: 'red' },
  { match: /\b(AZUL|AZL|BLUE)\b/i, es: 'Azul', en: 'blue' },
  { match: /\b(NEGRO|NEG|BLACK)\b/i, es: 'Negro', en: 'black' },
  { match: /\b(VERDE|VERD|VDE|GREEN)\b/i, es: 'Verde', en: 'green' },
  { match: /\b(AMARILLO|AMA|YELLOW)\b/i, es: 'Amarillo', en: 'yellow' },
  { match: /\b(SURTIDO|SURT|VARIOS|COL)\b/i, es: 'Surtido multicolor', en: 'assorted colors' },
  { match: /\b(BLANCO|BLC|WHITE)\b/i, es: 'Blanco', en: 'white' }
];

/**
 * Descompone analíticamente el nombre del producto en su ontología.
 */
export function analyzeProductOntology(productName = '', unit = '') {
  const cleanName = productName.toUpperCase().trim();

  // 1. Detectar empaque y presentación
  let packaging = { type: 'unidad_suelta', qty: 1, label: 'Unidad individual' };
  for (const p of KNOWN_PACKAGING_PATTERNS) {
    if (p.regex.test(cleanName)) {
      packaging = { type: p.type, qty: p.qty, label: p.label };
      break;
    }
  }

  // Corroborar con la columna unit de la BD (si dice doc o caja y no se detectó en nombre)
  if (packaging.type === 'unidad_suelta') {
    const cleanUnit = (unit || '').toLowerCase();
    if (cleanUnit.includes('doc') || cleanUnit.includes('12')) {
      packaging = { type: 'caja_x12', qty: 12, label: 'Caja x 12 (Docena)' };
    } else if (cleanUnit.includes('caja') || cleanUnit.includes('box')) {
      packaging = { type: 'caja', qty: 1, label: 'Caja del producto' };
    } else if (cleanUnit.includes('paq') || cleanUnit.includes('resma')) {
      packaging = { type: 'resma', qty: 500, label: 'Resma / Paquete' };
    }
  }

  // 2. Detectar marca
  let brand = '';
  for (const b of KNOWN_BRANDS_MAP) {
    const rx = new RegExp(`\\b${b.replace('-', '[- ]')}\\b`, 'i');
    if (rx.test(cleanName)) {
      brand = b;
      break;
    }
  }

  // 3. Detectar color
  let color = null;
  for (const c of KNOWN_COLORS_MAP) {
    if (c.match.test(cleanName)) {
      color = c;
      break;
    }
  }

  // 4. Tipo de producto
  let productType = 'artículo de oficina y papelería';
  if (/MARCADOR.*PIZARRA/i.test(cleanName) || /P\/PIZARRA/i.test(cleanName)) {
    productType = 'marcador para pizarra acrílica';
  } else if (/MARCADOR.*PERMANENTE/i.test(cleanName) || /PERM/i.test(cleanName)) {
    productType = 'marcador permanente';
  } else if (/BOLIGRAFO|BOLIG|KILOMETRICO/i.test(cleanName)) {
    productType = 'bolígrafo';
  } else if (/RESMA|FOTOCOPIA|PAPEL BOND/i.test(cleanName)) {
    productType = 'resma de papel';
  } else if (/TIJERA/i.test(cleanName)) {
    productType = 'tijera';
  } else if (/GRAPADORA|ENGRAP/i.test(cleanName)) {
    productType = 'grapadora';
  } else if (/BANDEJA/i.test(cleanName)) {
    productType = 'bandeja para documentos';
  }

  // 5. Construcción de directiva visual e intención
  let visualIntent = '';
  let aiPrompt = '';

  if (packaging.type === 'caja_x12' || packaging.type === 'caja_x24') {
    visualIntent = `Caja oficial de ${packaging.qty} unidades de ${brand || ''} ${productType} ${color?.es ? 'color ' + color.es : ''}`;
    aiPrompt = `Commercial product photography of an authentic retail box of ${packaging.qty} ${brand || ''} ${productType} ${color?.en || ''}, showing crisp branding on the box packaging, one marker cleanly placed next to the box, pure solid white background #FFFFFF, studio light, 8k, sharp focus`;
  } else if (packaging.type.startsWith('blister')) {
    visualIntent = `Blíster o paquete de ${packaging.qty} unidades de ${brand || ''} ${productType} ${color?.es ? 'color ' + color.es : ''}`;
    aiPrompt = `Commercial product photography of an unopened retail blister pack containing ${packaging.qty} ${brand || ''} ${productType} ${color?.en || ''}, authentic retail packaging, pure solid white background #FFFFFF, studio light, 8k`;
  } else if (packaging.type === 'resma') {
    visualIntent = `Resma completa de 500 hojas con envoltorio oficial de marca ${brand || ''}`;
    aiPrompt = `Commercial product photography of a full factory sealed ream of 500 sheets paper of brand ${brand || ''}, authentic printed wrapper packaging, pure solid white background #FFFFFF, studio light, 8k`;
  } else {
    visualIntent = `Unidad individual de ${brand || ''} ${productType} ${color?.es ? 'color ' + color.es : ''} sin caja`;
    aiPrompt = `Commercial product photography of a single standalone ${brand || ''} ${productType} ${color?.en || ''}, isolated on pure solid white background #FFFFFF, sharp focus on branding, natural drop shadow, studio light, 8k, NO BOX`;
  }

  return {
    rawName: productName,
    brand,
    color,
    productType,
    packaging,
    visualIntent,
    aiPrompt
  };
}
