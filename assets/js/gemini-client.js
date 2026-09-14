/* ==========================================================================
   JJ Paper — Gemini AI Client & Suite Inteligente
   - Pool balanceado de 7 API Keys con rotación automática y reintentos por cuota
   - Sugerencias inteligentes de respuestas en tiempo real para WhatsApp
   - Generador Anti-Spam / Anti-Baneo con 3 variaciones naturales para difusiones
   - Redactor comercial de correos para cotizaciones, despachos y cobranzas
   - Copiloto comercial con búsqueda de productos y precios oficiales en USD y Bs
   - Generador visual de tarjetas de producto (Canvas Flyer 800x800)
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GeminiClient = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {

  // Pool oficial de 7 API Keys proporcionadas por el usuario
  // Pool oficial de 7 API Keys proporcionadas por el usuario
  // Con prioridad a las llaves Pro identificadas para tareas arquitectónicas
  const PRO_KEYS = [
    'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
    'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E'
  ];

  const GEMINI_KEYS = [
    'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
    'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E',
    'AQ.Ab8RN6IsSWjE9mHK9IRjNyauqgMLHLWLCJnwiEHU7Uo6sC0cNA',
    'AQ.Ab8RN6LOFt4ga-GPIkdVcDya_L2DSSrfqWTyPK3QSzM1e5pVfQ',
    'AQ.Ab8RN6I3nhWx1f54n5rcLa1nJv238N-IqJoIRWljUjZmg3nl-Q',
    'AQ.Ab8RN6K7DB2-YqkZma3jsV8EfCqHel0UnR07oY-r8qquxgKTsA',
    'AQ.Ab8RN6L0PS4XofEO8X9lbsE8P1sYD6jqItzCRvb0QbX1KvdEOw'
  ];

  // Modelos Pro para Arquitectura Creativa, Copywriting y Razonamiento Complejo
  const PRO_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ];

  // Modelos ultrarrápidos para sugerencias en vivo en chat
  const FAST_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ];

  let _keyIndex = Math.floor(Math.random() * GEMINI_KEYS.length);
  let _totalCalls = 0;
  let _keyFailures = {};

  function getNextKey() {
    _keyIndex = (_keyIndex + 1) % GEMINI_KEYS.length;
    return GEMINI_KEYS[_keyIndex];
  }

  function getCurrentKey() {
    return GEMINI_KEYS[_keyIndex];
  }

  function extractJSON(raw) {
    if (!raw || typeof raw !== 'string') throw new Error('Respuesta de IA vacía o inválida');

    // 1. Intentar parseo directo
    try { return JSON.parse(raw.trim()); } catch (_) {}

    // 2. Eliminar bloques markdown
    let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); } catch (_) {}

    // 3. Extraer primer objeto JSON {...}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) {}

      // 4. Sanitizar saltos de línea literales y caracteres de control dentro de strings
      const jsonStr = match[0];
      let inString = false;
      let escaped = false;
      let out = '';
      for (let i = 0; i < jsonStr.length; i++) {
        const c = jsonStr[i];
        if (c === '"' && !escaped) {
          inString = !inString;
          out += c;
        } else if (inString && (c === '\n' || c === '\r')) {
          out += (c === '\n' ? '\\n' : '');
        } else if (inString && c === '\t') {
          out += '\\t';
        } else {
          out += c;
        }
        escaped = (c === '\\' && !escaped);
      }
      try { return JSON.parse(out); } catch (_) {}
    }

    throw new Error('No se pudo extraer JSON de la respuesta de IA');
  }

  /* --------------------------------------------------------------------------
     Llamada Base a la API con enrutamiento inteligente (Pro para Arquitectura, Fast para chat)
     -------------------------------------------------------------------------- */
  async function callGemini({
    prompt,
    systemInstruction = '',
    temperature = 0.7,
    maxTokens = 1500,
    model = null,
    mode = 'fast' // 'architect' | 'pro' | 'fast'
  }) {
    _totalCalls++;
    const isArchitect = (mode === 'architect' || mode === 'pro');
    const keyPool = isArchitect ? [...PRO_KEYS, ...GEMINI_KEYS.filter(k => !PRO_KEYS.includes(k))] : GEMINI_KEYS;
    const modelsToTry = model
      ? [model, ...(isArchitect ? PRO_MODELS : FAST_MODELS).filter(m => m !== model)]
      : (isArchitect ? PRO_MODELS : FAST_MODELS);
    
    const timeoutMs = isArchitect ? 15000 : 10000;
    let lastError = null;

    for (let attempt = 0; attempt < keyPool.length; attempt++) {
      const currentKey = keyPool[attempt % keyPool.length];
      
      for (const m of modelsToTry) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${currentKey}`;
          
          const bodyPayload = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: Math.max(0.1, Math.min(1.0, temperature)),
              maxOutputTokens: maxTokens
            }
          };

          if (systemInstruction) {
            bodyPayload.systemInstruction = {
              parts: [{ text: systemInstruction }]
            };
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return text.trim();
          }

          const status = res.status;
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody.error?.message || `HTTP ${status}`;

          // Si es límite de cuota (429) o sobrecargado (503), probar siguiente modelo
          if (status === 429 || status === 503 || status === 404) {
            lastError = new Error(`Modelo no disponible o rate limit (${status}): ${errMsg}`);
            continue; // probar siguiente modelo
          }

          // Si clave no autorizada (403) o error de solicitud (400)
          if (status === 403 || status === 400) {
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key rechazada o inválida (${status}): ${errMsg}`);
            break; // Cambiar de llave
          }

          lastError = new Error(`Error en API (${status}): ${errMsg}`);
        } catch (netErr) {
          clearTimeout(timeoutId);
          lastError = netErr;
          break; // Timeout o fallo de red, probar siguiente llave
        }
      }
    }

    throw lastError || new Error('No se pudo comunicar con el servicio de IA tras rotar las 7 claves.');
  }

  /* --------------------------------------------------------------------------
     Contexto Maestro del Negocio (JJ Paper)
     -------------------------------------------------------------------------- */
  function getBusinessContext() {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const seller = w.CURRENT_PROFILE || w.WA_ME || w.MAIL_ME || {};
    const sellerName = seller.full_name || seller.name || 'Asesor JJ Paper';
    const sellerRef = seller.ref_code || '';

    return `
Eres el Asistente Experto de Comunicación Comercial B2B de "JJ Paper C.A." en Caracas, Venezuela.
- JJ Paper es una distribuidora mayorista y detal de papelería, útiles escolares, consumibles de oficina y papelería corporativa.
- Catálogo principal: Resmas de papel Bond (Carta, Oficio, Extra Oficio de 75g y 80g), cuadernos (engrapados, doble espiral, cosidos), bolígrafos, marcadores, carpetas de fibra, archivadores, consumibles, tóner y embalaje.
- Tasa oficial BCV vigente: 1 USD = ${rate.toFixed(2)} Bs (todas las transacciones, presupuestos y facturas se calculan rigurosamente al cambio oficial del Banco Central de Venezuela).
- Asesor comercial activo: ${sellerName} ${sellerRef ? `(Código: ${sellerRef})` : ''}.
- Medios de pago: Dólares USD en efectivo, Zelle, Banesco Panamá, Bolívares por Pago Móvil y Transferencias bancarias nacionales al cambio BCV.
- Despachos: Entregas directas en Caracas con rutas diarias y envíos asegurados a toda Venezuela por Tealca, MRW y Zoom.

DIRECTRICES DE TONO Y ESTILO B2B (HUMANO, PROFESIONAL Y RESPETUOSO):
1. NO USES TONO DE ANUNCIO AGRESIVO O BOT: Prohibido sonar a teletienda, usar mayúsculas sostenidas exageradas, promesas vacías o saturación de signos de exclamación o emojis (máximo 1 o 2 emojis elegantes por mensaje).
2. TRATO B2B CONSULTIVO: Habla como un asesor comercial humano que se dirige a gerentes de compras, administradores de oficinas, dueños de colegios o librerías. Sé cordial, empático y profesional ("Estimado/a", "Un gusto saludarle", "Esperamos que todo marche excelente en su empresa").
3. CONCISIÓN Y VALOR REAL: Ve al grano. Destaca disponibilidad de inventario listo, precio mayorista transparente, factura fiscal y rapidez de despacho.
4. LLAMADOS A LA ACCIÓN NATURALES: En lugar de "¡COMPRA YA!", usa cierres amables y abiertos ("¿Desea que le verifiquemos disponibilidad?", "¿Requiere una cotización formal para su empresa?", "¿Cuántas unidades o bultos estima para este pedido?").
`;
  }

  /* --------------------------------------------------------------------------
     1. WhatsApp: Sugerencias Inteligentes de Respuesta
     -------------------------------------------------------------------------- */
  async function suggestWhatsAppReplies({ chatHistory = [], lastMessage = '', clientName = '', sellerName = '' }) {
    const sys = getBusinessContext() + `
Tu tarea es sugerir 3 respuestas listas para enviar a este cliente en WhatsApp.
- Analiza la consulta o último mensaje del cliente.
- Devuelve EXACTAMENTE un objeto JSON válido (sin markdown exterior ni \`\`\`json) con esta estructura:
{
  "opcion_directa": "Respuesta corta, precisa y al punto (máx 2 líneas)",
  "opcion_cordial": "Respuesta cálida, saludando con su nombre si está disponible y llamada a la acción",
  "opcion_comercial": "Respuesta orientada a la venta, cierre o consulta de cantidades/despacho"
}`;

    const prompt = `
Cliente: ${clientName || 'Cliente'}
Vendedor: ${sellerName || 'Asesor de Ventas'}
Último mensaje recibido del cliente: "${lastMessage || '(Sin mensaje previo, iniciar conversación)'}"
Historial reciente:
${chatHistory.slice(-5).map(m => `${m.direction === 'out' ? 'Vendedor' : 'Cliente'}: ${m.body || '[adjunto]'}`).join('\n')}

Genera las 3 opciones en formato JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.65 });
      return extractJSON(raw);
    } catch (e) {
      // Fallback inteligente
      const nameGreet = clientName ? `Hola ${clientName}, ` : '¡Hola! ';
      return {
        opcion_directa: `${nameGreet}con gusto le atendemos. ¿Qué cantidad necesita para cotizarle?`,
        opcion_cordial: `${nameGreet}un gusto saludarle desde JJ Paper. Con gusto le ayudamos con su requerimiento. ¿Desea que le verifiquemos disponibilidad y precios?`,
        opcion_comercial: `${nameGreet}tenemos disponibilidad inmediata al mejor precio mayorista. ¿Para cuántas unidades o bultos desea el presupuesto?`
      };
    }
  }

  /* --------------------------------------------------------------------------
     2. WhatsApp: Generador Anti-Spam / Anti-Baneo (Variaciones Humanas)
     -------------------------------------------------------------------------- */
  async function generateAntiSpamVariations(baseText) {
    if (!baseText || !baseText.trim()) {
      throw new Error('Debes escribir un texto base para generar variaciones.');
    }

    const sys = getBusinessContext() + `
Eres un especialista en optimización de mensajería comercial y protección contra baneos de WhatsApp (Anti-Spam).
Tu objetivo es tomar el texto base que el vendedor desea enviar y generar 3 VARIACIONES COMPLETAMENTE DISTINTAS en redacción, pero que transmitan exactamente la misma oferta o mensaje comercial.

REGLAS ESTRICTAS PARA PREVENIR EL BANEO POR PATRÓN REPETITIVO:
1. Cambiar los saludos de entrada (ej: "¡Hola!", "Buen día estimado", "Buenas tardes, un cordial saludo", "¿Cómo está?").
2. Modificar el orden y la estructura sintáctica de las oraciones.
3. Usar sinónimos venezolanos naturales (ej: presupuesto / cotización, productos / mercancía, envío / despacho, disponible / contamos con stock).
4. Variar la ubicación de los emojis (sin saturar).
5. Mantener inalterados los números de teléfono, precios, enlaces y datos clave.

Devuelve EXACTAMENTE un objeto JSON válido con esta estructura:
{
  "variacion_a": "Texto de la primera variación (tono directo y dinámico)",
  "variacion_b": "Texto de la segunda variación (tono cálido, cordial y detallado)",
  "variacion_c": "Texto de la tercera variación (tono formal y comercial)"
}`;

    const prompt = `Texto original a variar:\n"${baseText.trim()}"\n\nDevuelve las 3 variaciones en formato JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.8 });
      return extractJSON(raw);
    } catch (e) {
      return {
        variacion_a: baseText,
        variacion_b: `¡Hola! Un gusto saludarte. ${baseText}`,
        variacion_c: `Buen día estimado cliente. Le compartimos la siguiente información: ${baseText}`
      };
    }
  }

  /* --------------------------------------------------------------------------
     3. Correo CRM: Redactor Comercial de Emails
     -------------------------------------------------------------------------- */
  async function draftEmail({ scenario = 'cotizacion', toName = '', toEmail = '', notes = '', originalEmail = '', sellerName = '' }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const sys = getBusinessContext() + `
Eres el redactor oficial de correspondencia comercial de JJ Paper C.A.
Redactas correos impecables, respetuosos y altamente persuasivos para clientes corporativos, librerías, oficinas y comercios.

Instrucciones:
- El asunto (subject) debe ser claro, conciso y profesional.
- El cuerpo (body) debe tener estructura clara: Saludo, Introducción, Puntos clave / precios / detalles, Condiciones comerciales (despacho, tasa BCV a ${rate.toFixed(2)} Bs, métodos de pago), y Cierre con firma de ${sellerName || 'Equipo Comercial JJ Paper'}.
- NO uses código HTML complejo en el body; usa texto formateado con saltos de línea limpios, bullets (-) y viñetas que se lean bien en cualquier cliente de correo.

Devuelve EXACTAMENTE un objeto JSON válido con esta estructura:
{
  "subject": "Asunto profesional del correo",
  "body": "Cuerpo completo del correo listo para enviar"
}`;

    const prompt = `
Tipo de correo: ${scenario}
Destinatario: ${toName || 'Estimado Cliente'} (${toEmail || 'cliente@empresa.com'})
Instrucciones / Notas adicionales del vendedor: "${notes || 'Sin notas adicionales'}"
${originalEmail ? `Correo al que se responde:\n"${originalEmail}"` : ''}

Genera el asunto y cuerpo en JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.6 });
      return extractJSON(raw);
    } catch (e) {
      return {
        subject: `Cotización de Productos — JJ Paper C.A.`,
        body: `Estimado(a) ${toName || 'Cliente'},\n\nEs un placer saludarle desde JJ Paper C.A.\n\nEn atención a su solicitud, ponemos a su disposición nuestra cotización con los mejores precios del mercado y disponibilidad inmediata.\n\n${notes ? notes + '\n\n' : ''}Nuestras operaciones se calculan a tasa oficial BCV (${rate.toFixed(2)} Bs/USD). Contamos con despacho directo en Caracas y envíos nacionales.\n\nQuedamos a su entera disposición para procesar su pedido.\n\nAtentamente,\n${sellerName || 'Dpto. de Ventas'}\nJJ Paper C.A.`
      };
    }
  }

  /* --------------------------------------------------------------------------
     4. Motor Inteligente de Búsqueda de Productos (IA + Scoring Estructural)
     Utiliza Gemini para interpretar la consulta y extraer atributos,
     luego aplica scoring ponderado con descarte obligatorio por tipo base.
     -------------------------------------------------------------------------- */

  // ══════ Taxonomía de Tipos Base para Descarte Obligatorio ══════
  const PRODUCT_TYPE_MAP = {
    'marcador':       ['marcador', 'marcadores', 'marker'],
    'resaltador':     ['resaltador', 'resaltadores', 'highlighter', 'fluorescente'],
    'boligrafo':      ['boligrafo', 'boligrafos', 'bolígrafo', 'bolígrafos', 'lapicero', 'pen'],
    'lapiz':          ['lapiz', 'lápiz', 'lapices', 'lápices', 'mongol'],
    'resma':          ['resma', 'resmas', 'papel bond', 'papel fotocopia', 'ream'],
    'cuaderno':       ['cuaderno', 'cuadernos', 'libreta', 'block', 'notebook'],
    'carpeta':        ['carpeta', 'carpetas', 'folder', 'manila'],
    'archivador':     ['archivador', 'archivadores', 'binder'],
    'sobre':          ['sobre', 'sobres', 'envelope'],
    'cinta':          ['cinta', 'cintas', 'tirro', 'teipe', 'tape', 'masking'],
    'tijera':         ['tijera', 'tijeras', 'scissors'],
    'grapadora':      ['grapadora', 'grapadoras', 'engrapadora', 'cosedora', 'stapler'],
    'perforadora':    ['perforadora', 'perforadoras', 'perforador', 'punch'],
    'pegamento':      ['pegamento', 'pega', 'cola', 'silicon', 'silicón', 'silicona', 'glue', 'adhesivo'],
    'clip':           ['clip', 'clips', 'gancho', 'sujetapapeles', 'binder clip'],
    'sacapuntas':     ['sacapuntas', 'sacapunta', 'afilador', 'tajador', 'sharpener'],
    'borrador':       ['borrador', 'borradores', 'goma', 'eraser'],
    'plastilina':     ['plastilina', 'masa', 'clay', 'modelar'],
    'tempera':        ['tempera', 'temperas', 'témpera', 'pintura'],
    'toner':          ['toner', 'tóner', 'cartucho', 'tinta', 'ink'],
    'rollo_termico':  ['rollo térmico', 'rollo termico', 'rollos térmicos', 'rollos termicos', 'thermal roll'],
    'nota_adhesiva':  ['nota adhesiva', 'notas adhesivas', 'post-it', 'postit', 'sticky', 'banderita', 'señalizador'],
    'bandeja':        ['bandeja', 'bandejas', 'organizador', 'portapapeles', 'tray'],
    'regla':          ['regla', 'reglas', 'ruler', 'escuadra'],
    'calculadora':    ['calculadora', 'calculadoras', 'casio', 'calculator'],
    'escarcha':       ['escarcha', 'escarchas', 'brillantina', 'purpurina', 'glitter'],
    'corrector':      ['corrector', 'correctores', 'liquid paper', 'correction'],
    'porta_taco':     ['porta taco', 'portataco'],
    'dispensador':    ['dispensador', 'dispensadores'],
    'recibo':         ['recibo', 'talonario', 'factura', 'invoice'],
    'pincel':         ['pincel', 'pinceles', 'brush'],
    'color':          ['color', 'colores', 'creyón', 'creyones', 'crayon', 'colored pencil']
  };

  // ══════ Sinónimos de Variantes ══════
  const VARIANT_SYNONYMS = {
    'punta gruesa':   ['punta gruesa', 'chisel', 'biselada', 'broad', 'grueso', 'ancha'],
    'punta fina':     ['punta fina', 'fine', 'micro', '0.5mm', '0.5 mm', 'fina', 'fino'],
    'punta media':    ['punta media', 'medium', '0.7mm', '0.7 mm', '1.0mm', 'media', 'medio'],
    'pizarra':        ['pizarra', 'dry erase', 'whiteboard', 'borrable', 'pizarron', 'pizarrón'],
    'permanente':     ['permanente', 'permanent', 'indeleble'],
    'carta':          ['carta', 'letter', '8.5x11', '21.5x28'],
    'oficio':         ['oficio', 'legal', '8.5x14', '21.5x35.5'],
    'extra oficio':   ['extra oficio', 'extraoficio'],
    'engrapado':      ['engrapado', 'grapado', 'stapled'],
    'espiral':        ['espiral', 'doble espiral', 'spiral', 'wire-o'],
    'cosido':         ['cosido', 'sewn', 'stitched'],
    'gel':            ['gel', 'tinta gel'],
    'aceite':         ['aceite', 'oil', 'tinta aceite'],
    'retractil':      ['retráctil', 'retractil', 'click', 'retractable'],
    'transparente':   ['transparente', 'cristal', 'clear'],
    'kraft':          ['kraft', 'marrón', 'marron', 'manila', 'brown']
  };

  // ══════ Caché de interpretación IA para no repetir llamadas idénticas ══════
  const _queryInterpretCache = new Map();

  /**
   * Fase 1: Interpreta la consulta con Gemini para extraer atributos estructurados
   */
  async function interpretQueryWithAI(query) {
    const cacheKey = query.trim().toLowerCase();
    if (_queryInterpretCache.has(cacheKey)) {
      const cached = _queryInterpretCache.get(cacheKey);
      if (Date.now() - cached.ts < 300000) return cached.result;
    }

    try {
      const sys = `Eres un clasificador de productos de papelería y útiles de oficina para la empresa JJ Paper C.A. (Venezuela).
Tu ÚNICA tarea es interpretar la consulta del usuario y extraer los atributos estructurados del producto que busca.

TIPOS BASE VÁLIDOS (usa EXACTAMENTE uno de estos):
marcador, resaltador, boligrafo, lapiz, resma, cuaderno, carpeta, archivador, sobre, cinta, tijera, grapadora, perforadora, pegamento, clip, sacapuntas, borrador, plastilina, tempera, toner, rollo_termico, nota_adhesiva, bandeja, regla, calculadora, escarcha, corrector, porta_taco, dispensador, recibo, pincel, color

REGLAS ESTRICTAS:
- "marcador" y "resaltador" son DISTINTOS. Un resaltador/highlighter NO es un marcador.
- "punta gruesa" = biselada = chisel tip. "punta fina" = fine tip.
- Si el usuario menciona una marca, extráela exactamente como la dice.
- Si menciona un número (ej: "80"), determina qué significa según contexto: ¿gramaje? ¿hojas? ¿SKU? ¿código? ¿cantidad de piezas?
- "Servicio", "Expo", "Kores", "Studmark", "Sharpie", etc. son MARCAS.

Devuelve SOLO JSON válido (sin markdown):
{
  "tipo_base": "marcador",
  "marca": "Servicio",
  "especificacion": "80",
  "variante": "punta gruesa",
  "color": null,
  "presentacion": null,
  "tokens_criticos": ["marcador", "servicio", "80", "punta gruesa"]
}`;

      const prompt = `Consulta del usuario: "${query}"

Extrae los atributos del producto. JSON estricto:`;

      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.05, maxTokens: 400 });
      const result = extractJSON(raw);
      _queryInterpretCache.set(cacheKey, { result, ts: Date.now() });
      return result;
    } catch (e) {
      console.warn('interpretQueryWithAI fallback:', e.message);
      return null;
    }
  }

  /**
   * Fase 2: Detecta el tipo base de un producto a partir de su nombre
   */
  function detectProductType(productName) {
    const lower = (' ' + (productName || '').toLowerCase() + ' ');
    const entries = Object.entries(PRODUCT_TYPE_MAP)
      .sort((a, b) => {
        const maxA = Math.max(...a[1].map(k => k.length));
        const maxB = Math.max(...b[1].map(k => k.length));
        return maxB - maxA;
      });
    for (const [type, keywords] of entries) {
      for (const kw of keywords) {
        if (lower.includes(' ' + kw + ' ') || lower.includes(' ' + kw + ',') ||
            lower.includes('/' + kw + ' ') || lower.includes(' ' + kw + '/') ||
            lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw)) return type;
      }
    }
    return null;
  }

  /**
   * Fase 3: Verifica si un texto contiene algún sinónimo de una variante
   */
  function matchesVariant(text, variantQuery) {
    if (!variantQuery || !text) return false;
    const lower = text.toLowerCase();
    const vqLower = variantQuery.toLowerCase();
    if (lower.includes(vqLower)) return true;
    for (const [, synonyms] of Object.entries(VARIANT_SYNONYMS)) {
      const queryMatches = synonyms.some(s => vqLower.includes(s));
      if (queryMatches) {
        return synonyms.some(s => lower.includes(s));
      }
    }
    return false;
  }

  /**
   * Motor Principal de Búsqueda Inteligente de Productos
   * Combina interpretación IA + scoring estructural ponderado
   */
  async function searchProductsLive(query, limit = 6) {
    const w = typeof window !== 'undefined' ? window : {};
    if (!query || query.trim().length < 2) return [];

    const q = query.trim().toLowerCase();
    const rawTokens = q.split(/\s+/).filter(t => t.length >= 2);
    const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'con', 'sin', 'por', 'dame', 'busca', 'quiero', 'necesito', 'muestra', 'imagen', 'flyer', 'foto']);
    const tokens = rawTokens.filter(t => !STOPWORDS.has(t));
    const searchTokens = tokens.length > 0 ? tokens : rawTokens;
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

    // ══════ PASO 1: Interpretar la consulta con IA (lanzar en paralelo) ══════
    let aiInterpretation = null;
    const aiPromise = interpretQueryWithAI(query).catch(() => null);

    // ══════ PASO 2: Obtener lista de productos (caché o Supabase) ══════
    let productList = null;
    if (Array.isArray(w.allProducts) && w.allProducts.length > 0) {
      productList = w.allProducts;
    } else {
      try {
        const stored = sessionStorage.getItem('jjp_products_cache_v4');
        if (stored) productList = JSON.parse(stored);
      } catch (_) {}
    }

    // Si no hay caché, consultar Supabase directamente
    if (!Array.isArray(productList) || productList.length === 0) {
      const client = (typeof sb !== 'undefined' ? sb : (w.sb || w.sbCore || w._rawSbCore));
      if (!client) return [];
      try {
        const primary = searchTokens[0] || q;
        const stem = primary.replace(/(?:es|s)$/i, '');
        const searchPattern = stem.length >= 3 ? stem : primary;
        const { data, error } = await client.from('jjp_products')
          .select(`
            id, name, sku, price_usd, unit, emoji, image_url, description, active,
            jjp_product_variants(id, variant_name, sku, price_usd, active, jjp_brands(name))
          `)
          .neq('active', false)
          .or(`name.ilike.%${searchPattern}%,sku.ilike.%${searchPattern}%,description.ilike.%${searchPattern}%`)
          .limit(80);
        if (error || !data) return [];
        productList = data;
      } catch (e) {
        console.warn('Error cargando productos para búsqueda:', e);
        return [];
      }
    }

    // ══════ PASO 3: Esperar interpretación IA ══════
    aiInterpretation = await aiPromise;

    // ══════ PASO 4: Scoring Estructural Inteligente ══════
    const scored = productList.map(p => {
      const variants = (p.jjp_product_variants || []).filter(v => v.active !== false);
      const brandNames = variants.map(v => v.jjp_brands?.name).filter(Boolean);
      const variantNames = variants.map(v => v.variant_name).filter(Boolean);
      const fullName = (p.name || '').toLowerCase();
      const fullSearchText = `${p.name || ''} ${p.sku || ''} ${p.description || ''} ${brandNames.join(' ')} ${variantNames.join(' ')}`.toLowerCase();

      let score = 0;
      let disqualified = false;

      if (aiInterpretation && aiInterpretation.tipo_base) {
        // ────── MODO IA: Scoring por atributos ponderados ──────
        const ai = aiInterpretation;
        const productType = detectProductType(p.name);

        // PESO 50: ¿El tipo base coincide?
        if (ai.tipo_base) {
          if (productType === ai.tipo_base) {
            score += 50;
          } else if (productType !== null) {
            // Tipo base detectado pero NO coincide → DESCARTAR
            disqualified = true;
          } else {
            // Tipo base no detectado → verificar que al menos contenga la palabra
            const typeKeywords = PRODUCT_TYPE_MAP[ai.tipo_base] || [ai.tipo_base];
            const hasTypeWord = typeKeywords.some(kw => fullName.includes(kw.toLowerCase()));
            if (hasTypeWord) {
              score += 40;
            } else {
              disqualified = true;
            }
          }
        }

        // PESO 30: ¿Coincide la marca?
        if (ai.marca && !disqualified) {
          const marcaLower = ai.marca.toLowerCase();
          const brandMatch = brandNames.some(b => b.toLowerCase().includes(marcaLower)) ||
                             fullName.includes(marcaLower);
          if (brandMatch) score += 30;
        }

        // PESO 20: ¿Coincide la variante (punta, tamaño, formato)?
        if (ai.variante && !disqualified) {
          const variantMatch = matchesVariant(fullSearchText, ai.variante) ||
                               variantNames.some(v => matchesVariant(v, ai.variante));
          if (variantMatch) score += 20;
        }

        // PESO 10: ¿Coincide la especificación numérica (gramaje, hojas, código)?
        if (ai.especificacion && !disqualified) {
          const specStr = String(ai.especificacion).toLowerCase();
          if (fullSearchText.includes(specStr)) score += 10;
        }

        // PESO 5: ¿Coincide la presentación?
        if (ai.presentacion && !disqualified) {
          const presLower = ai.presentacion.toLowerCase();
          if (fullSearchText.includes(presLower)) score += 5;
        }

        // PESO 3: ¿Coincide el color?
        if (ai.color && !disqualified) {
          const colorLower = ai.color.toLowerCase();
          if (fullSearchText.includes(colorLower)) score += 3;
        }

        // Bonus: tokens críticos adicionales que coincidan
        if (ai.tokens_criticos && Array.isArray(ai.tokens_criticos) && !disqualified) {
          ai.tokens_criticos.forEach(tc => {
            const tcLower = tc.toLowerCase();
            if (tcLower.length >= 3 && fullSearchText.includes(tcLower)) {
              score += 2;
            }
          });
        }

      } else {
        // ────── MODO FALLBACK: Búsqueda mejorada por tokens con tipo base ──────
        const queryType = detectProductType(q);
        const productType = detectProductType(p.name);

        if (queryType && productType && queryType !== productType) {
          disqualified = true;
        }

        if (!disqualified) {
          // Tipo base coincide → bonus grande
          if (queryType && productType === queryType) score += 50;

          // Token matching mejorado
          searchTokens.forEach(t => {
            const stem = t.replace(/(?:es|s)$/i, '');
            if (fullSearchText.includes(t)) {
              score += 8;
            } else if (stem.length >= 3 && fullSearchText.includes(stem)) {
              score += 5;
            }
          });

          // Bonus por match en variantes
          searchTokens.forEach(t => {
            if (variantNames.some(v => v.toLowerCase().includes(t))) {
              score += 4;
            }
          });

          // Bonus por match de marca
          searchTokens.forEach(t => {
            if (brandNames.some(b => b.toLowerCase().includes(t))) {
              score += 6;
            }
          });
        }
      }

      // Calcular precio
      let minPrice = parseFloat(p.price_usd || 0);
      if (variants.length > 0) {
        const varPrices = variants.map(v => parseFloat(v.price_usd)).filter(n => n > 0);
        if (varPrices.length > 0) minPrice = Math.min(...varPrices);
      }

      return {
        id: p.id,
        name: p.name,
        sku: p.sku || '',
        price_usd: minPrice,
        price_bs: (minPrice * rate),
        unit: p.unit || 'unidad',
        image_url: p.image_url || '',
        emoji: p.emoji || '📦',
        brands: [...new Set(brandNames)].join(', '),
        variants: variantNames,
        score: disqualified ? -1 : score
      };
    });

    const filtered = scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Si IA no encontró nada, intentar sin descarte por tipo (fallback amplio)
    if (filtered.length === 0) {
      const fallback = scored.map(item => {
        if (item.score >= 0) return item;
        // Recalcular sin descarte
        const fullText = `${item.name} ${item.sku} ${item.brands}`.toLowerCase();
        let fscore = 0;
        searchTokens.forEach(t => {
          const stem = t.replace(/(?:es|s)$/i, '');
          if (fullText.includes(t)) fscore += 5;
          else if (stem.length >= 3 && fullText.includes(stem)) fscore += 3;
        });
        return { ...item, score: fscore };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

      return fallback;
    }

    return filtered;
  }

  /* --------------------------------------------------------------------------
     4.1. Generador de Plantillas Spintax Anti-Baneo para Campañas
     -------------------------------------------------------------------------- */
  async function generateCampaignSpintax(baseText, channel = 'whatsapp') {
    if (!baseText || !baseText.trim()) {
      throw new Error('Debes proporcionar un texto para convertir a Spintax.');
    }

    const sys = getBusinessContext() + `
Eres un especialista sénior en Copywriting Comercial B2B y prevención algorítmica de bloqueos (Anti-Spam) para envíos por ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'}.
Tu objetivo es transformar el mensaje en una plantilla viva, humana, sumamente cordial y variada utilizando Spintax {opción 1|opción 2|opción 3}.

ESTÁNDARES DE COPYWRITING B2B HUMANO:
- Evita sonar como un bot automatizado o anuncio de telemarketing barato.
- El mensaje debe leerse como escrito individualmente por un asesor comercial atento a su cliente.
- Usa lenguaje venezolano formal y cálido ("Estimado(a)", "Un gusto saludarle", "Es un placer ponernos en contacto").
- Nunca uses signos de exclamación excesivos (¡¡¡ !!!) ni más de 1 o 2 emojis sobrios.

REGLAS ESTRICTAS DE CONSTRUCCIÓN SPINTAX:
1. Variaciones en Saludos: {Estimado(a) {{nombre}}, un gusto saludarle|Hola {{nombre}}, un cordial saludo|Apreciado(a) {{nombre}}, esperamos se encuentre muy bien}.
2. Variaciones en la Presentación del Asesor: {le contacta {{vendedor}} de JJ Paper|le escribe {{vendedor}} del departamento comercial de JJ Paper|se comunica atentamente {{vendedor}} de JJ Paper}.
3. Variaciones en la Propuesta de Valor: {queremos poner a su disposición excelentes opciones en|le informamos disponibilidad inmediata y precios especiales en|le compartimos nuestras mejores condiciones comerciales en|tenemos disponible para despacho inmediato}.
4. Variaciones en Cierre y Llamado a la Acción (B2B sin presión): {¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal?|¿Cuántas unidades o bultos estima para esta semana?|Quedamos a su disposición para coordinar su despacho}.
5. PRESERVACIÓN ABSOLUTA DE VARIABLES: Conserva exactamente {{nombre}}, {{empresa}}, {{vendedor}}, {{producto}}, {{precio}}, {{descuento}}, {{link}}, etc. NO las alteres, no les quites las llaves dobles ni las traduzcas.
6. Mantén enlaces, montos numéricos y condiciones operativas intactos.
7. Devuelve ÚNICAMENTE el texto resultante en Spintax, sin explicaciones ni bloques de código.`;

    const prompt = `Convierte este texto a formato Spintax comercial B2B humano y anti-spam:\n\n${baseText.trim()}`;

    try {
      const res = await callGemini({ prompt, systemInstruction: sys, temperature: 0.55 });
      return res.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    } catch (e) {
      console.warn('Fallback spintax:', e);
      if (!baseText.startsWith('{')) {
        return `{Estimado(a) {{nombre}}, un cordial saludo|Hola {{nombre}}, un gusto saludarle|Buen día {{nombre}}} ` + baseText;
      }
      return baseText;
    }
  }

  /* --------------------------------------------------------------------------
     4.2. Redactor Inteligente de Campañas Comerciales B2B (WhatsApp y Email)
     -------------------------------------------------------------------------- */
  async function draftCampaignMessage({
    objective = 'promocion',
    product = null,
    discount = '',
    audience = 'todos',
    channel = 'whatsapp',
    customNotes = '',
    sellerName = ''
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

    // Extracción de especificaciones técnicas y comerciales del producto o combo
    let prodSpecs = '';
    if (product) {
      const pName = product.name || 'Artículo de Catálogo';
      const pBrand = product.brands || (product.brand ? product.brand.name : '') || '';
      const pUnit = product.unit || 'unidad';
      const pSku = product.sku ? `SKU/Código: ${product.sku}` : '';
      const pPriceUsd = Number(product.final_price_usd || product.price_usd || 0);
      const pPriceBs = pPriceUsd > 0 ? (pPriceUsd * rate).toFixed(2) : '';
      const pDesc = product.description ? `Detalles: ${product.description}` : '';
      
      prodSpecs = `
PRODUCTO O SERVICIO SELECCIONADO:
- Nombre: ${pName}
${pBrand ? `- Marca oficial: ${pBrand}` : ''}
${pUnit ? `- Unidad de presentación / Empaque: ${pUnit}` : ''}
${pSku ? `- Referencia: ${pSku}` : ''}
${pPriceUsd > 0 ? `- Precio mayorista oficial: $${pPriceUsd.toFixed(2)} USD (equivalente a Bs. ${pPriceBs} a tasa BCV)` : ''}
${pDesc ? `- Descripción técnica: ${pDesc}` : ''}
`;
    }

    const sys = getBusinessContext() + `
Eres el Especialista y Redactor Comercial B2B Sénior de JJ Paper C.A., empresa distribuidora mayorista y corporativa de papelería, útiles y suministros en Caracas, Venezuela.
Tu objetivo es redactar un mensaje comercial de alto impacto para ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'} que proyecte seriedad, confianza, calidez y actitud de socio estratégico de compras corporativas.

ESTÁNDARES DE COPYWRITING B2B CON ACTITUD Y ESTRUCTURA:
1. ACTITUD DE SOCIO MAYORISTA (NO SPAMMER, NO TELETIENDA):
   - Prohibido terminantemente sonar como un anuncio publicitario masivo, bot barato o vendedor invasivo.
   - El mensaje debe sentirse como si el asesor comercial de JJ Paper estuviera escribiendo personalmente al encargado de compras, administración, librería o institución educativa.
   - Tono formal, educado, sumamente profesional pero cercano y cordial (venezolano corporativo respetuoso).

2. PARÁMETROS DE CONTENIDO Y ESPECIFICACIONES CONCRETAS:
   - No hagas mensajes vacíos ni telegramas de 3 líneas que carecen de especificaciones.
   - Destaca siempre características concretas: marcas reconocidas (Kores, Printon, Mr. Bobina, etc.), formato/presentación (cajas x 12, resmas de 500 hojas, bultos, blister, Carta u Oficio).
   - Comunica claramente las condiciones operativas y ventajas institucionales de comprar con JJ Paper:
     • Despacho ágil y puntual directo a la sede del cliente en Caracas.
     • Envíos protegidos y asegurados a nivel nacional (Tealca, MRW, Zoom).
     • Facturación 100% legal con Factura Fiscal a Tasa Oficial BCV (${rate.toFixed(2)} Bs).
     • Cotizaciones formales en PDF de entrega inmediata.
     • Posibilidad de crédito corporativo para clientes frecuentes.

3. ESTRUCTURA VISUAL IMPECABLE (10 a 16 líneas bien aireadas):
   - Separa SIEMPRE cada bloque temático con DOBLE salto de línea (\\n\\n) para que el mensaje respire y sea muy cómodo de leer en teléfonos móviles.
   - Usa negritas con asteriscos (*Texto Destacado*) para el título del producto o beneficio clave, y viñetas (• o 🔹) para desglosar especificaciones y condiciones.
   - Emojis sobrios y estratégicos (máximo 3 o 4 en todo el texto: 👋, 📦, 💲, 👉).

4. MECÁNICA ANTI-BANEO CON SPINTAX NATURAL:
   - Para WhatsApp: DEBES incluir Spintax {opción 1|opción 2|opción 3} en el saludo inicial y en la pregunta de cierre consultiva.
   - Enlace al catálogo digital: Incluye siempre {{link}} como canal de consulta rápida.

5. PRESERVACIÓN ESTRICTA DE VARIABLES:
   - Conserva exactamente {{nombre}}, {{empresa}}, {{vendedor}}, {{link}}, y si aplica: {{producto}}, {{precio}}. NO quites las llaves dobles ni inventes variables nuevas.

Devuelve EXACTAMENTE un objeto JSON válido (sin etiquetas markdown exteriores ni \`\`\`json):
- Si channel === 'email': { "subject": "Asunto profesional de alto impacto", "body": "Cuerpo completo con variables y formato" }
- Si channel === 'whatsapp': { "body": "Cuerpo del mensaje estructurado en WhatsApp" }
`;

    const prompt = `
Propósito o Requerimiento del Asesor: ${objective}
Canal: ${channel}
Segmento de Audiencia: ${audience}
${prodSpecs}
Descuento / Condición Especial: ${discount || 'Precios directos de distribuidora mayorista'}
Notas adicionales: ${customNotes || 'Atención personalizada, despacho inmediato, inventario disponible'}
Asesor emisor: ${sellerName || 'Equipo Comercial JJ Paper'}

Genera el mensaje comercial con especificaciones reales, actitud B2B y formato JSON estricto:`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.45 });
      return extractJSON(raw);
    } catch (e) {
      console.warn('Fallback draftCampaignMessage:', e);
      if (channel === 'email') {
        return {
          subject: product ? `📦 Suministro Mayorista: ${product.name} — JJ Paper C.A.` : '📋 Catálogo y Lista de Precios Mayorista — JJ Paper C.A.',
          body: `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEsperamos que todo marche excelente en su empresa. Le saluda atentamente {{vendedor}} del departamento comercial de JJ Paper C.A.\n\nNos comunicamos para poner a su disposición excelentes condiciones comerciales y disponibilidad inmediata en:\n\n*📦 ${product ? product.name : 'Papelería Corporativa y Suministros de Oficina al Mayor'}*\n${product ? `💲 Precio especial mayorista: *{{precio}}*\n` : ''}• Facturación fiscal legal calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• Despacho directo y puntual a su sede en Caracas.\n• Envíos asegurados a todo el territorio nacional.\n• Emisión de cotizaciones formales inmediatas y planes de crédito para clientes recurrentes.\n\n👉 Puede revisar nuestro catálogo digital completo y realizar requerimientos aquí:\n{{link}}\n\n{¿Desea que le preparemos una cotización formal para su empresa?|¿Gusta que le apartemos disponibilidad para el despacho de esta semana?|Quedamos a su entera disposición para coordinar su pedido.}\n\nAtentamente,\n\n{{vendedor}}\nJJ Paper C.A. | Caracas, Venezuela`
        };
      } else {
        return {
          body: `{Hola|Buen día|Estimado(a)} {{nombre}} 👋, un cordial saludo.\n\n{Le escribe|Le saluda|Se comunica} {{vendedor}} de JJ Paper C.A. Somos distribuidores mayoristas de papelería corporativa, consumibles y útiles escolares en Caracas.\n\nPonemos a su disposición disponibilidad inmediata y precios especiales en:\n\n*📦 ${product ? product.name : 'Suministros de Papelería al Mayor'}*\n${product ? `💲 Precio especial: *{{precio}}*\n` : ''}• Despacho directo a su sede en Caracas y envíos nacionales.\n• Facturación 100% a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• Emisión de cotización formal y opciones de crédito corporativo.\n\n👉 Puede consultar nuestro catálogo digital aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal?|Quedo atento a su respuesta para apoyarle en lo que necesite.}\n\nAtentamente,\n\n{{vendedor}}\nJJ Paper C.A. | Caracas, Venezuela`
        };
      }
    }
  }

  /* --------------------------------------------------------------------------
     4.3. Analizador Comercial B2B de Prospectos e Hiper-Personalización (IA)
     Analiza Sector, Empresa, Cargo y Ubicación, deduce necesidades operativas,
     selecciona ángulo del banco dinámico y redacta correo (130-180 palabras)
     y WhatsApp adaptados con Spintax.
     -------------------------------------------------------------------------- */
  async function analyzeAndDraftProspectB2B({
    companyName = '',
    sector = '',
    contactName = '',
    contactRole = '',
    address = '',
    notes = '',
    city = 'Caracas',
    sellerName = 'Keyder José Salazar',
    sellerPhone = '0412-4676073',
    promoProductOrCombo = null,
    officialPdfIncluded = true,
    channel = 'both'
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

    const promoInfo = promoProductOrCombo ? `
ATENCIÓN - PRODUCTO / OFERTA COMERCIAL SELECCIONADA POR EL ASESOR:
- Nombre: "${promoProductOrCombo.name || promoProductOrCombo.title || 'Insumo destacado'}"
- Precio especial: $${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0).toFixed(2)} USD (equivalente a ${(Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0) * rate).toFixed(2)} Bs a Tasa Oficial BCV)
- Descripción: "${promoProductOrCombo.description || 'Disponibilidad inmediata al mayor'}"
DIRECTIVA DE OFERTA: Este producto/combo DEBE ser el PRIMER ítem destacado en la propuesta operativa, combinado armónicamente con 2 insumos complementarios según el sector de la empresa.` : '';

    const sys = getBusinessContext() + `
Eres el Director y Estratega Comercial B2B Sénior de "JJ Paper C.A." en Caracas, Venezuela.
Tu objetivo es analizar minuciosamente el perfil corporativo de un cliente o prospecto B2B y desarrollar una propuesta de abordaje comercial hiper-personalizada, de alta conversión y con variaciones anti-bloqueo.

OBJETIVO CRÍTICO: CADA CLIENTE DEBE RECIBIR UN MENSAJE ÚNICO, HUMANO Y 100% ADAPTADO A SU REALIDAD Y SECTOR OPERATIVO. PROHIBIDO GENERAR MENSAJES GENÉRICOS O USAR LA FRASE "estimado cliente".

PORTAFOLIO INTEGRAL Y CAPACIDADES DE JJ PAPER:
1. Consumibles POS y Cajas: Rollos térmicos para puntos de venta y cajas fiscales (80x70mm, 80x80mm, 57x40mm, 57x30mm), marcadores detectores de billetes falsos Kores, almohadillas dactilares.
2. Papelería y Archivo Reglamentario: Resmas de papel Bond (Carta, Oficio, Extra Oficio 75g y 80g HP/Report/Chamex), carpetas de fibra marrón con gancho, carpetas manila, archivadores de palanca (lomo ancho y fino con cantoneras metálicas para resguardo a 10 años), sobres manila (14x17 radiografía, extra oficio, carta), separadores y cajas de archivo.
3. Embalaje, Almacén y Logística: Cintas de embalaje transparente y marrón de alto micraje (48mm x 50m / 100m / 200m extra adherencia), tirro carrocero, dispensadores tipo pistola, exactos/cutters de alta resistencia, marcadores industriales indelebles (Sharpie, Expo, Kores, Servicio 80), sobres packing list.
4. Oficina, Administración y RRHH: Bolígrafos por caja (Bic, Solita, Sabonis, Kores), resaltadores, grapadoras metálicas, grapas 26/6, perforadoras 2 y 3 huecos, binder clips, tijeras de acero, notas adhesivas Post-it.

MATRIZ COMPLETA DE NECESIDADES OPERATIVAS POR 20+ SECTORES:
1. Supermercados, Abastos Masivos y Retail:
   - Dolor: Cero quiebres en líneas de cajas de alto tráfico y embalaje seguro de despacho.
   - Mix: Rollos térmicos 80x70mm / 80x80mm + Cintas de embalaje industrial 48x100m + Marcadores detectores de billetes falsos Kores.
2. Farmacias y Cadenas de Salud Retail:
   - Dolor: Rollos térmicos para impresoras fiscales y puntos de venta, resguardo de récipes y sellado de bultos de medicinas.
   - Mix: Rollos térmicos 80x70mm y 57x40mm + Sobres manila + Cintas de empaque de alto micraje.
3. Banca Universal, Seguros y Entidades Financieras:
   - Dolor: Cumplimiento SUDEBAN/SENIAT, auditorías y archivo reglamentario a 10 años sin deterioro.
   - Mix: Carpetas de fibra marrón reglamentarias con gancho + Archivadores de palanca lomo ancho + Resmas Bond Carta/Oficio 75g/80g HP/Report. Facturación formal legal en Bs a tasa BCV.
4. Salud Privada, Clínicas y Hospitales:
   - Dolor: Confidencialidad y pulcritud de historias médicas, admisiones y entrega de placas/estudios.
   - Mix: Sobres de radiografía 14x17 gran formato + Carpetas de historias médicas de fibra con divisiones + Resmas Bond para informes médicos.
5. Laboratorios Farmacéuticos e Industriales:
   - Dolor: Identificación indeleble de lotes, embalaje de bultos y resguardo de protocolos de calidad.
   - Mix: Marcadores industriales indelebles Servicio 80 / Sharpie + Cintas de empaque de alto micraje + Carpetas de archivo.
6. Logística, Transporte, Carga y Encomiendas:
   - Dolor: Sellado resistente de encomiendas para traslados y rotulación de bultos sin despegue.
   - Mix: Cintas de embalaje industrial 48mm x 100m/200m pegado extrafuerte + Marcadores indelebles punta gruesa Servicio 80 + Dispensadores tipo pistola y sobres packing list.
7. Concesionarios Automotrices y Talleres:
   - Dolor: Control de órdenes de servicio en taller, terminales inalámbricos de cobro y expedientes de vehículos.
   - Mix: Rollos térmicos para POS inalámbricos + Carpetas de vehículos con gancho + Resmas Bond para contratos y facturación fiscal.
8. Tecnología POS y Terminales de Pago:
   - Dolor: Suministro directo de rollos térmicos certificados sin polvo para terminales inteligentes.
   - Mix: Rollos térmicos 57x40mm y 57x30mm para POS inalámbricos + Rollos 80x70mm para cajas + Cintas de embalaje.
9. Call Centers y Centros de Operaciones BPO:
   - Dolor: Consumibles para estaciones de teleoperadores, RRHH y control biométrico.
   - Mix: Resmas Bond para contratos y reportes + Bolígrafos por caja + Rollos térmicos para reloj biométrico y marcadores fluorescentes.
10. Hoteles (5 Estrellas, Boutique, Corporativos):
    - Dolor: Pulcritud en recepción, folios de huéspedes, facturación en restaurante y eventos.
    - Mix: Resmas Bond de alta blancura + Rollos térmicos para puntos de cobro + Carpetas corporativas y bolígrafos institucionales.
11. Restaurantes Masivos, Franquicias y Alimentos:
    - Dolor: Comandas en cocina bajo calor/grasa, rapidez de cobro en caja y sellado de pedidos para llevar (delivery).
    - Mix: Rollos térmicos para comanderas y cajas 80x70/80x80 + Cintas para sellar empaques para llevar + Marcadores de precios.
12. Tiendas por Departamento y Retail Textil (Traki, etc.):
    - Dolor: Alto flujo en cajas de cobro, rotulación de mercancía y embalaje en almacén central.
    - Mix: Rollos térmicos 80x70mm + Cintas de empaque industrial + Tijeras de acero y marcadores de precios.
13. Centros Comerciales y Condominios:
    - Dolor: Tickets de cobro de estacionamiento, avisos de cobro y archivo administrativo.
    - Mix: Rollos térmicos para taquillas de estacionamiento + Carpetas de archivo + Resmas Bond para recibos de condominio.
14. Colegios, Universidades e Institutos Educativos:
    - Dolor: Material para evaluaciones continuas, guías pedagógicas y dotación docente.
    - Mix: Resmas Bond Carta y Oficio para exámenes + Marcadores de pizarra acrílica recargables + Carpetas de alumnos y bolígrafos.
15. Librerías, Papelerías y Bazares (Mayorista Reventa):
    - Dolor: Margen de rentabilidad comercial y disponibilidad inmediata de marcas líderes.
    - Mix: Surtido mayorista con precios de distribuidor: resmas por bulto, cuadernos engrapados y espiral, bolígrafos, lápices, colores.
16. Droguerías Mayoristas y Distribución:
    - Dolor: Rotulación de paletas, sellado de bultos y facturación masiva.
    - Mix: Cintas de embalaje de alto micraje + Marcadores industriales + Sobres y resmas para facturación mayorista.
17. Organismos Públicos e Instituciones del Estado:
    - Dolor: Homologación reglamentaria, solvencia tributaria, carpetas oficiales de expediente y facturación fiscal formal con RIF.
    - Mix: Carpetas de fibra marrón reglamentarias con gancho + Archivadores de palanca + Resmas Bond Carta y Oficio.
18. Comercio General, Empresas y Corporativo:
    - Dolor: Abastecimiento integral centralizado, delivery gratuito en Caracas y crédito/condiciones corporativas.
    - Mix: Resmas Bond + Consumibles de oficina + Cintas de empaque.
${promoInfo}

DIRECTRICES CRÍTICAS PARA WHATSAPP (ESTRUCTURA DE ALTA CONVERSIÓN):
1. Saludo inicial personalizado:
   - Si hay persona de contacto: usa "{Hola|Buen día|Un gusto saludarle} ${contactName} 👋,".
   - Si solo hay cargo: usa "{Hola|Buen día} ${contactRole} de ${companyName} 👋,".
   - Si no hay persona: usa "{Hola|Buen día|Un gusto saludarle} estimados amigos de ${companyName} 👋," (o "{Hola|Buen día} equipo de ${companyName} 👋,").
   - ¡PROHIBIDO ESCRIBIR "estimado cliente"! Dirígete siempre a la empresa o a la persona.
   - REGLA OBLIGATORIA: DEBES MANTENER la sintaxis Spintax {A|B|C} tal cual, con llaves literales, para que cada envío sea diferente y evite bloqueos de WhatsApp.
2. Contexto de apertura (1-2 oraciones breves):
   Menciona que le saluda *${sellerName}* de *JJ Paper C.A.* y reconoce de forma natural su actividad en ${city || 'Caracas'}.
3. Título de sección en negrita destacada:
   *📦 PROPUESTA DE ABASTECIMIENTO OPERATIVO:*
4. Viñetas de productos con nombre en negrita (*...*):
   - MÁXIMO 3 viñetas con formato: • *Nombre del Producto o Insumo*: especificación técnica y beneficio operativo directo para ${companyName}.
   ${promoProductOrCombo ? '- La PRIMERA viñeta DEBE ser la promoción/producto seleccionado: *' + (promoProductOrCombo.name || 'Promoción') + '*.' : ''}
   - PROHIBIDO usar etiquetas técnicas como "Core 1:", "Core 2:" o "Cross-sell:". Redacta con tono fluido y comercial.
5. Mención obligatoria de la Lista de Precios Oficial en PDF:
   ${officialPdfIncluded ? '📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* (+700 productos disponibles para entrega inmediata).' : ''}
6. Bloque de beneficios institucionales de JJ Paper:
   *VENTAJAS DE OPERAR CON JJ PAPER:*
   • 🚚 *Delivery directo y gratuito* a su sede en Caracas / despachos nacionales protegidos.
   • 🧾 *Facturación fiscal legal (RIF J-295375450)* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).
   • ⚡ *Cotizaciones formales en segundos* adaptadas a su requerimiento.
7. Enlace interactivo al catálogo digital:
   👉 Puede revisar nuestro catálogo digital completo aquí:
   {{link}}
8. Cierre de baja fricción con Spintax:
   {¿Desea que le preparemos una cotización formal para su empresa?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|¿En qué requerimientos o reposición de papelería podemos apoyarle hoy?}
9. Firma formal corporativa:
   Atentamente,

   *${sellerName}*
   Dirección Comercial | JJ Paper C.A.
   Teléfono / WhatsApp: ${sellerPhone}
   Caracas, Venezuela
10. Doble salto de línea (\\n\\n) entre cada bloque para que el mensaje respire con elegancia visual en móviles.

DIRECTRICES ESTRICTAS PARA EL CUERPO DEL CORREO (LONGITUD: 130 A 180 PALABRAS):
1. Asunto de alto impacto adaptado a ${companyName}:
   Ejemplos según sector:
   - "Propuesta de abastecimiento operativo y homologación para ${companyName} | JJ Paper"
   - "Suministro directo y disponibilidad de consumibles para ${companyName}"
   ${promoProductOrCombo ? '- "📦 Oferta Especial en ' + (promoProductOrCombo.name || 'Papelería') + ' para ' + companyName + ' | JJ Paper"' : ''}
2. Saludo formal:
   - Con contacto: "Estimado(a) ${contactName}${contactRole ? `, ${contactRole}` : ''} en ${companyName}:"
   - Sin contacto: "Estimada Gerencia de Compras y Procura en ${companyName}:"
3. Reconocimiento operativo (1-2 oraciones demostrando entender la exigencia diaria de sus sedes en ${city || 'Caracas'}).
4. Viñetas de 3 insumos seleccionados (especificación + beneficio).
5. 4 Pilares de JJ Paper:
   - "Le adjuntamos a este correo nuestra lista de precios oficial con más de 700 artículos disponibles para entrega inmediata."
   - "Cotizaciones inmediatas en segundos adaptadas a su presupuesto."
   - "Servicio de Delivery gratuito en Caracas directamente en su sede o centro de distribución."
   - "Facturación fiscal formal con RIF (J-295375450) en bolívares a tasa oficial BCV del día."
6. Llamado a la acción (CTA) de baja fricción.
7. Firma corporativa obligatoria (${sellerName}).

FORMATO DE RESPUESTA REQUERIDO (DEVUELVE ÚNICAMENTE UN OBJETO JSON VÁLIDO SIN MARKDOWN EXTERIOR):
{
  "sector_deducido": "Nombre del sector clasificado (ej: Supermercados, Banca Universal, Clínicas, etc.)",
  "dolor_operativo": "Resumen conciso (1-2 frases) del punto de dolor operativo identificado en la cuenta",
  "insumos_core": ["Insumo 1 con especificación y marca", "Insumo 2 con especificación y marca"],
  "insumo_cross_sell": "Insumo 3 de apoyo",
  "angulo_seleccionado": "operativo_stock | optimizacion_costos | alianza_procura | linea_cajas",
  "subject": "Asunto personalizado y profesional",
  "email_body": "Cuerpo completo del correo formal (130-180 palabras con saludo, viñetas, 4 pilares y firma)",
  "email_word_count": 155,
  "wa_body": "Mensaje adaptado a WhatsApp con negritas (*...*), viñetas (•), dobles saltos, PDF adjunto y Spintax {A|B|C}"
}`;

    const prompt = `
DATOS DEL PROSPECTO A ANALIZAR:
- Empresa: "${companyName}"
- Sector reportado: "${sector || 'No especificado'}"
- Contacto: "${contactName || 'No indicado'}"
- Cargo / Departamento: "${contactRole || 'No indicado'}"
- Dirección / Sede: "${address || 'Caracas, Venezuela'}"
- Notas previas / Intereses: "${notes || 'Ninguna nota previa'}"

Realiza el análisis de necesidades operativas de esta empresa y redacta el correo formal (130-180 palabras exactas) y el WhatsApp en JSON estricto:`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.45, maxTokens: 2000, mode: 'architect' });
      const data = extractJSON(raw);
      return data;
    } catch (e) {
      console.warn('Fallback analyzeAndDraftProspectB2B:', e);
      // Fallback robusto con los datos directos
      const salutation = contactName 
        ? `Estimado(a) ${contactName}${contactRole ? `, ${contactRole}` : ''} en ${companyName}:`
        : `Estimada Gerencia de Compras y Procura en ${companyName}:`;

      const defSubject = promoProductOrCombo
        ? `📦 Oferta Especial en ${promoProductOrCombo.name || 'Papelería'} para ${companyName} | JJ Paper`
        : `Propuesta de abastecimiento operativo y homologación para ${companyName}`;

      let bullet1 = '• *Rollos térmicos y consumibles para puntos de venta y facturación* (cero quiebres de stock).';
      let bullet2 = '• *Carpetas de archivo reglamentarias, archivadores y resmas de papel Bond* para resguardo documental.';
      let bullet3 = '• *Cintas de embalaje industrial de alto micraje* para almacén y despacho.';

      if (promoProductOrCombo) {
        bullet1 = `• *${promoProductOrCombo.name || 'Oferta Especial'}*: $${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0).toFixed(2)} USD (disponibilidad inmediata).`;
      }

      const defBody = `${salutation}\n\nEs un placer saludarle desde JJ Paper C.A. Entendemos la alta exigencia diaria que demanda la operación y logística de sus sedes en ${city || 'Caracas'}, donde la disponibilidad oportuna de suministros resulta indispensable.\n\nCon el propósito de garantizar la continuidad de sus operaciones y optimizar sus costos de procura, ponemos a su disposición nuestro suministro directo en insumos de alta rotación:\n${bullet1}\n${bullet2}\n${bullet3}\n\nBeneficios de operar con JJ Paper:\n- Le adjuntamos a este correo nuestra lista de precios oficial con más de 700 artículos disponibles para entrega inmediata.\n- Cotizaciones inmediatas en segundos adaptadas a su presupuesto.\n- Servicio de Delivery gratuito en Caracas directamente en su sede o centro de distribución.\n- Facturación fiscal formal con RIF (J-295375450) en bolívares a tasa oficial BCV del día.\n\nLe invitamos a revisar la lista adjunta. Si nos indica qué requerimiento tienen abierto esta semana, con gusto le enviaremos la cotización formal en minutos.\n\nAtentamente,\n\n${sellerName}\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sellerPhone}\nCaracas, Venezuela`;

      const words = defBody.trim().split(/\s+/).length;

      const waGreeting = contactName
        ? `{Hola|Buen día|Un gusto saludarle} ${contactName} 👋, un cordial saludo.`
        : (contactRole
            ? `{Hola|Buen día} ${contactRole} de ${companyName} 👋, un cordial saludo.`
            : `{Hola|Buen día|Un gusto saludarle} estimados amigos de ${companyName} 👋, un cordial saludo.`);

      const fallbackWa = `${waGreeting}\n\n{Le escribe|Le saluda} *${sellerName}* de *JJ Paper C.A.* Somos distribuidores mayoristas de papelería corporativa, consumibles de caja y embalaje en Caracas.\n\nPensando en la continuidad de sus operaciones, ponemos a su disposición disponibilidad inmediata en:\n\n*📦 PROPUESTA DE ABASTECIMIENTO OPERATIVO:*\n${bullet1}\n${bullet2}\n${bullet3}\n\n${officialPdfIncluded ? '📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 700 artículos disponibles para despacho inmediato.\n\n' : ''}*VENTAJAS DE OPERAR CON JJ PAPER:*\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal con RIF (J-295375450)* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones formales en segundos* adaptadas a su requerimiento.\n\n👉 Puede revisar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le preparemos una cotización formal para su empresa?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sellerName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sellerPhone}\nCaracas, Venezuela`;

      return {
        sector_deducido: sector || 'Corporativo General',
        dolor_operativo: 'Abastecimiento oportuno de suministros para continuidad operativa y control de costos de procura.',
        insumos_core: [bullet1.replace(/^•\s*\*/, '').replace(/\*.*$/, ''), bullet2.replace(/^•\s*\*/, '').replace(/\*.*$/, '')],
        insumo_cross_sell: bullet3.replace(/^•\s*\*/, '').replace(/\*.*$/, ''),
        angulo_seleccionado: 'alianza_procura',
        subject: defSubject,
        email_body: defBody,
        email_word_count: words,
        wa_body: fallbackWa
      };
    }
  }

  /* --------------------------------------------------------------------------
     4.4. Analizador de Clientes y Prospectos para Campañas Hiper-Personalizadas
     Conecta directamente con el motor especializado analyzeAndDraftProspectB2B
     garantizando razonamiento sectorial, 2 Core + 1 Cross-sell y formato visual.
     -------------------------------------------------------------------------- */
  async function analyzeCustomerAndDraftMessage({
    customer = {},
    channel = 'whatsapp',
    sellerName = '',
    sellerPhone = '',
    promoProductOrCombo = null,
    officialPdfIncluded = true,
    forceRefresh = false
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const sName = sellerName || w.CURRENT_PROFILE?.full_name || w.CURRENT_PROFILE?.name || 'Keyder José Salazar';
    const sPhone = sellerPhone || w.CURRENT_PROFILE?.phone || '0412-4676073';

    // Si no se fuerza refresco y no hay promoción específica seleccionada, reutilizar si ya tiene copy guardado
    if (!forceRefresh && !promoProductOrCombo) {
      if (channel === 'whatsapp' && customer.custom_wa_body && customer.custom_wa_body.length > 50) {
        return {
          sector: customer.ai_analysis?.sector_deducido || customer.sector || 'Comercial',
          need: customer.ai_analysis?.dolor_operativo || 'Abastecimiento de papelería y consumibles operativos',
          suggested_offering: (customer.ai_analysis?.insumos_core || []).join(' · '),
          subject: customer.suggested_subject || 'Propuesta Comercial — JJ Paper',
          body: customer.custom_wa_body,
          raw_analysis: customer.ai_analysis || {}
        };
      }
      if (channel === 'email' && customer.custom_email_body && customer.custom_email_body.length > 50) {
        return {
          sector: customer.ai_analysis?.sector_deducido || customer.sector || 'Comercial',
          need: customer.ai_analysis?.dolor_operativo || 'Abastecimiento de papelería y consumibles operativos',
          suggested_offering: (customer.ai_analysis?.insumos_core || []).join(' · '),
          subject: customer.suggested_subject || 'Propuesta Comercial y Lista de Precios — JJ Paper',
          body: customer.custom_email_body,
          raw_analysis: customer.ai_analysis || {}
        };
      }
    }

    // Extraer datos del cliente o prospecto B2B
    const compName = customer.company_name || customer.name || customer.business_name || 'Empresa';
    const sec = customer.sector || (customer.ai_analysis && customer.ai_analysis.sector_deducido) || '';
    const contName = customer.contact_name || '';
    const contRole = customer.contact_role || '';
    const addr = customer.address || customer.city || 'Caracas, Venezuela';
    const nts = customer.notes || (Array.isArray(customer.tags) ? customer.tags.join(', ') : (customer.tags || ''));
    const cty = customer.city || 'Caracas';

    try {
      const b2b = await analyzeAndDraftProspectB2B({
        companyName: compName,
        sector: sec,
        contactName: contName,
        contactRole: contRole,
        address: addr,
        notes: nts,
        city: cty,
        sellerName: sName,
        sellerPhone: sPhone,
        promoProductOrCombo,
        officialPdfIncluded,
        channel
      });

      const isEmail = (channel === 'email');
      const body = isEmail ? b2b.email_body : b2b.wa_body;

      return {
        sector: b2b.sector_deducido || sec || 'Comercial',
        need: b2b.dolor_operativo || 'Abastecimiento de papelería mayorista y consumibles para continuidad operativa',
        suggested_offering: (b2b.insumos_core || []).join(' · '),
        subject: b2b.subject || (promoProductOrCombo ? `📦 Oferta Especial en ${promoProductOrCombo.name || 'Papelería'} — JJ Paper` : `📋 Propuesta de Suministro Operativo para ${compName} — JJ Paper`),
        body: body,
        html: isEmail ? body.replace(/\n/g, '<br>') : '',
        raw_analysis: b2b
      };
    } catch (err) {
      console.warn('Fallback en analyzeCustomerAndDraftMessage:', err);
      const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
      return generateHeuristicCustomerMessage({ customer, channel, sName, sPhone, rate, promoProductOrCombo, officialPdfIncluded });
    }
  }



  function generateHeuristicCustomerMessage({
    customer = {},
    channel = 'whatsapp',
    sName = 'Keyder José Salazar',
    sPhone = '0412-4676073',
    rate = 40,
    promoProductOrCombo = null,
    officialPdfIncluded = true
  }) {
    const custName = customer.name || customer.business_name || 'Estimado Cliente';
    const low = (custName + ' ' + (customer.notes || '') + ' ' + (customer.tags || '')).toLowerCase();
    const ordersCount = Number(customer.total_orders || 0);

    let sector = 'Comercial General';
    let need = 'Abastecimiento de papelería mayorista y consumibles para continuidad operativa';
    let offering = 'Resmas de papel Bond, consumibles de oficina y embalaje';
    let bulletPoints = '';

    if (/farmacia|droguer[ií]a|farma/i.test(low)) {
      sector = 'Farmacias y Salud';
      need = 'Rollos térmicos para cajas POS y cintas de embalar para bultos';
      offering = 'Rollos térmicos 80x70mm y 57x40mm + Cintas de empaque 48x100m';
      bulletPoints = `• *Rollos térmicos para cajas POS* (80x70mm y 57x40mm) de alto rendimiento.\n• *Cintas de empaque resistentes* (48mm x 100m/200m) para embalaje de medicamentos y pedidos.\n• *Consumibles de oficina y marcadores* para control de stock.`;
    } else if (/supermercado|abasto|comercial|bodeg[oó]n|charcuter[ií]a|panader[ií]a|inversiones|automercado|minimarket|tienda/i.test(low)) {
      sector = 'Supermercados y Retail';
      need = 'Cero quiebres de stock en cajas registradoras y embalaje para mercancía';
      offering = 'Rollos térmicos de puntos de venta + Marcadores detectores de billetes';
      bulletPoints = `• *Rollos térmicos POS* (80x70mm, 80x80mm y 57x40mm) garantizados.\n• *Marcadores detectores de billetes falsos* Kores y almohadillas dactilares.\n• *Cintas de embalaje industrial* transparentes y marrones de alto micraje.`;
    } else if (/librer[ií]a|papeler[ií]a|bazar|variedades|copias/i.test(low)) {
      sector = 'Librerías y Papelerías';
      need = 'Surtido mayorista de alta rotación con margen de reventa';
      offering = 'Cuadernos engrapados y espiral, resmas Bond y útiles escolares';
      bulletPoints = `• *Cuadernos de alta demanda*: engrapados, cosidos y doble espiral.\n• *Resmas de papel Bond Carta y Oficio* (75g y 80g) de máxima blancura.\n• *Artículos escolares y de oficina*: bolígrafos, lápices, colores, tijeras y pegamento.`;
    } else if (/colegio|escuela|instituto|liceo|educaci[oó]n|educativo|universidad|acad[eé]mico/i.test(low)) {
      sector = 'Instituciones Educativas';
      need = 'Resmas para evaluaciones pedagógicas y dotación institucional';
      offering = 'Resmas de papel Bond, marcadores de pizarra y material pedagógico';
      bulletPoints = `• *Resmas de papel Bond Carta y Oficio* de alta rotación para exámenes y guías.\n• *Marcadores de pizarra recargables* y borradores magnéticos.\n• *Carpetas de fibra y manila* para expedientes estudiantiles y archivo escolar.`;
    } else if (/cl[ií]nica|salud|m[eé]dico|dental|laboratorio|hospital|consultorio/i.test(low)) {
      sector = 'Clínicas y Salud';
      need = 'Historias médicas, sobres radiografía y archivo confidencial';
      offering = 'Sobres radiografía 14x17, carpetas de historias médicas y resmas';
      bulletPoints = `• *Sobres de gran formato y radiografía* (14x17, Extra Oficio y Carta).\n• *Carpetas de historias médicas de fibra* con gancho y divisiones.\n• *Resmas de papel Bond y consumibles* para áreas administrativas y de admisión.`;
    } else if (/transporte|log[ií]stica|env[ií]os|cargo|almac[eé]n|ferreter[ií]a|repuestos/i.test(low)) {
      sector = 'Logística, Ferretería y Almacén';
      need = 'Embalaje industrial de alta resistencia e identificación de bultos';
      offering = 'Cintas de alto micraje 48x100m/200m y marcadores industriales';
      bulletPoints = `• *Cintas de embalaje industrial* (48mm x 100m y 200m) de pegado extra fuerte.\n• *Marcadores industriales indelebles* (Servicio 80, Sharpie, Expo).\n• *Dispensadores tipo pistola, exactos* y sobres packing list para guías.`;
    } else if (/banco|seguros|consultor|asesor|abogad|corporaci[oó]n|grupo/i.test(low)) {
      sector = 'Corporativo, Finanzas y Legal';
      need = 'Resguardo documental formal y archivo reglamentario a 10 años';
      offering = 'Carpetas de fibra marrón, archivadores de palanca y resmas Bond';
      bulletPoints = `• *Carpetas de fibra marrón reglamentarias* con gancho para expedientes auditables.\n• *Archivadores de palanca* de lomo ancho y fino con cantoneras metálicas.\n• *Resmas de papel Bond* (Carta y Oficio 75g y 80g HP/Report/Chamex).`;
    } else {
      bulletPoints = `• *Resmas de papel Bond Carta y Oficio* con despacho inmediato.\n• *Artículos de papelería corporativa y archivo* con precios mayoristas.\n• *Rollos térmicos de cajas y consumibles* para soporte operativo.`;
    }

    if (promoProductOrCombo) {
      bulletPoints = `• *📦 PROMOCIÓN ACTIVA: ${promoProductOrCombo.name}*\n  ${promoProductOrCombo.description ? `_${promoProductOrCombo.description}_\n  ` : ''}💲 *Precio mayorista: $${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd).toFixed(2)} USD*\n` + bulletPoints;
    }

    const isEmail = channel === 'email';
    const pdfMention = officialPdfIncluded
      ? `📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 700 artículos disponibles para despacho inmediato.\n\n`
      : '';

    const subject = promoProductOrCombo
      ? `📦 Oferta Especial en ${promoProductOrCombo.name} — JJ Paper C.A.`
      : `📋 Abastecimiento Operativo y Lista de Precios Oficial para ${custName} — JJ Paper C.A.`;

    let body = '';
    if (isEmail) {
      body = `{Estimado(a)|Apreciado(a)|Hola} ${custName},\n\nEsperamos que todo marche excelente en sus operaciones. Le saluda atentamente *${sName}*, asesor comercial de *JJ Paper C.A.* en Caracas.\n\nEn atención a los requerimientos y demanda diaria del sector *${sector}*, ponemos a su entera disposición condiciones preferenciales de suministro directo:\n\n*📦 PROPUESTA DE ABASTECIMIENTO:* \n${bulletPoints}\n\n${pdfMention}*VENTAJAS INSTITUCIONALES DE JJ PAPER:*\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones formales inmediatas* en segundos adaptadas a su presupuesto.\n\n👉 Puede explorar también nuestro catálogo digital en línea aquí:\n{{link}}\n\n{¿Desea que le elaboremos una cotización formal para su empresa?|¿Gusta que le reservemos inventario para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sPhone}\nCaracas, Venezuela`;
    } else {
      body = `{Hola|Buen día|Un gusto saludarle} ${custName} 👋, un cordial saludo.\n\n{Le escribe|Le saluda} *${sName}* de *JJ Paper C.A.* Somos distribuidores mayoristas de papelería, insumos de caja y consumibles en Caracas.\n\nPensando en el abastecimiento continuo de su negocio en el sector *${sector}*, ponemos a su disposición disponibilidad inmediata en:\n\n*📦 INSUMOS DE ALTA ROTACIÓN:*\n${bulletPoints}\n\n${pdfMention}*NUESTRO SERVICIO INCLUYE:*\n• 🚚 *Despacho gratuito* en Caracas directo a su sede.\n• 🧾 *Facturación fiscal formal* calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones al instante* y atención personalizada.\n\n👉 Puede chequear nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal para su empresa?|Quedo a su disposición para apoyarle en lo que necesite.}\n\nAtentamente,\n*${sName}* | Teléfono/WhatsApp: ${sPhone}\nJJ Paper C.A.`;
    }

    const htmlBody = body.replace(/\n/g, '<br>');
    const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.6;max-width:620px;margin:0 auto;padding:20px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
      <div style="background:#16604A;color:#ffffff;padding:14px 18px;border-radius:8px;font-size:16px;font-weight:700;margin-bottom:18px">
        JJ Paper C.A. — Distribución Mayorista
      </div>
      <div>${htmlBody}</div>
    </div>`;

    return {
      sector,
      need,
      suggested_offering: offering,
      subject,
      body,
      html
    };
  }

  /* --------------------------------------------------------------------------
     4.5. Procesador en Lote de Clientes con Concurrencia Equilibrada y Failover
     -------------------------------------------------------------------------- */
  async function analyzeCustomersBatch({
    customers = [],
    channel = 'whatsapp',
    sellerName = '',
    sellerPhone = '',
    promoProductOrCombo = null,
    officialPdfIncluded = true,
    forceRefresh = true,
    onProgress = null
  }) {
    const results = [];
    const total = customers.length;
    let completed = 0;

    // Procesar en chunks de 2 en paralelo para óptima velocidad sin exceder rate limits
    const CONCURRENCY = 2;
    for (let i = 0; i < customers.length; i += CONCURRENCY) {
      const chunk = customers.slice(i, i + CONCURRENCY);
      const chunkPromises = chunk.map(async (cust) => {
        try {
          const analysis = await analyzeCustomerAndDraftMessage({
            customer: cust,
            channel,
            sellerName,
            sellerPhone,
            promoProductOrCombo,
            officialPdfIncluded,
            forceRefresh
          });
          completed++;
          if (typeof onProgress === 'function') {
            onProgress({ current: completed, total, customer: cust, result: analysis });
          }
          return { customer: cust, analysis };
        } catch (err) {
          completed++;
          const fallbackAnalysis = generateHeuristicCustomerMessage({
            customer: cust,
            channel,
            sName: sellerName,
            sPhone: sellerPhone,
            rate: 40,
            promoProductOrCombo,
            officialPdfIncluded
          });
          if (typeof onProgress === 'function') {
            onProgress({ current: completed, total, customer: cust, result: fallbackAnalysis });
          }
          return { customer: cust, analysis: fallbackAnalysis };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /* --------------------------------------------------------------------------
     5. Copiloto JJ Paper (Chat Inteligente)
     -------------------------------------------------------------------------- */
  async function askCopilot({ message, chatHistory = [], userRole = 'vendedor', userName = '' }) {
    let productContext = '';
    const keywords = message.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/g) || [];
    const searchTerms = keywords.filter(w => !['hola', 'precio', 'costo', 'tienen', 'cuanto', 'como', 'donde', 'para'].includes(w.toLowerCase()));

    if (searchTerms.length > 0) {
      const found = await searchProductsLive(searchTerms[0], 5);
      if (found.length > 0) {
        productContext = `\n[Productos encontrados en catálogo en vivo de JJ Paper]:\n` +
          found.map(p => `- ${p.name} (${p.sku || 'S/C'}) | Precio: $${p.price_usd.toFixed(2)} USD (Bs ${p.price_bs.toFixed(2)}) x ${p.unit} ${p.brands ? `| Marcas: ${p.brands}` : ''}`).join('\n');
      }
    }

    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const sys = getBusinessContext() + `
Eres el Asistente Oficial y Copiloto Comercial de JJ Paper para el personal (${userRole}).
- Responde de forma concisa, útil, respetuosa y comercial.
- Precios oficiales calculados con la tasa BCV del día (${rate.toFixed(2)} Bs).
- Orienta sobre cotizaciones, pedidos POS, clientes en CRM, difusiones y generación de flyers de productos.
${productContext}
`;

    const prompt = `
Historial de conversación reciente:
${chatHistory.slice(-4).map(m => `${m.sender}: ${m.text}`).join('\n')}

Usuario (${userName || 'Colaborador'}): "${message}"
Respuesta del Copiloto JJ:`;

    return await callGemini({ prompt, systemInstruction: sys, temperature: 0.7 });
  }

  /* --------------------------------------------------------------------------
     5.1. Analizador Inteligente de Producto para Marketing
     Investiga y extrae especificaciones comerciales auténticas:
     Marca, Medidas/Formato, Color, Presentación/Empaque y Tipo de Producto
     -------------------------------------------------------------------------- */
  const KNOWN_STATIONERY_BRANDS = [
    'MISTER BOBINA', 'MR. BOBINA', 'MR BOBINA', 'BOBINA',
    'EXPO', 'STAR KIT', 'STUDMARK', 'KORES', 'MAYKA', 'OFIART', 'OFIMAK',
    'CRISBY', 'ESFER', 'ROLLS', 'ROLLOS', 'SHARK', 'ALPHA', 'PRINTA',
    'ACCO', 'MONGOL', 'PAPER MATE', 'INKJOY', 'LUXOR', 'BULL', 'DURACELL',
    'CASIO', 'CASSIO', 'MARFIL', 'AKTA', 'OSLO', 'CARIBE', 'TUK',
    'POST-IT', '3M', 'PRITT', 'SOLITA', 'FABER-CASTELL', 'BIC', 'NORMA',
    'SABONIS', 'PILOT', 'SHARPIE', 'PENTEL', 'STAEDTLER', 'PEGA-LOKA'
  ];

  async function enrichProductForMarketing(product) {
    if (!product) return null;
    const rawName = product.name || 'Producto JJ Paper';
    const upperName = rawName.toUpperCase();

    // 1. Detección Inteligente de Marca
    let brand = product.brands || product.brand_name || '';
    if (!brand || brand === 'JJ Paper Oficial') {
      for (const b of KNOWN_STATIONERY_BRANDS) {
        // Buscar coincidencia de palabra completa
        const rx = new RegExp('\\b' + b.replace('.', '\\.') + '\\b', 'i');
        if (rx.test(upperName)) {
          // Capitalizar bonito
          brand = b.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          break;
        }
      }
    }
    if (!brand) brand = 'JJ Paper Oficial';

    // 2. Extracción Inteligente de Medidas y Formato
    let measures = '';
    const measureMatch = rawName.match(/(\d+\s*x\s*\d+\s*(?:mm|cm|m|mts|pulg)?|\d+\s*(?:mm|cm|m|gr|g|kg|micras|ml|litros|hojas|piezas|und|unidades)\b|carta|oficio|extra\s*oficio|tabloide|a4|a3|1\/2\s*pliego|pliego|\b[123]""\b|\b[123]\s*pulg\b)/i);
    if (measureMatch) {
      measures = measureMatch[0].toUpperCase();
    } else if (/punta\s*gruesa|chisel|biselada/i.test(rawName)) {
      measures = 'Punta Biselada / Chisel Tip';
    } else if (/punta\s*fina|0\.5\s*mm/i.test(rawName)) {
      measures = 'Punta Fina 0.5mm';
    } else if (/punta\s*media|0\.7\s*mm|1\.?0?\s*mm/i.test(rawName)) {
      measures = 'Punta Media';
    } else {
      measures = product.unit || 'Medida estándar';
    }

    // 3. Extracción de Color Comercial
    let color = null;
    const colorMatch = rawName.match(/\b(transparente|marron|kraft|blanco|azul|negro|rojo|verde|amarillo|dorado|plateado|surtido|multicolor|plata|rosado|rosa|fucsia|morado|violeta|naranja|pink|cyan|turquesa|celeste|lila|salmon)\b/i);
    if (colorMatch) {
      const c = colorMatch[0].toLowerCase();
      if (c === 'marron' || c === 'kraft') color = 'Marrón Manila Kraft';
      else if (c === 'surtido' || c === 'multicolor') color = 'Colores Surtidos';
      else if (c === 'rosado' || c === 'rosa' || c === 'pink') color = 'Rosado Neón / Pink';
      else if (c === 'fucsia') color = 'Fucsia Neón';
      else if (c === 'morado' || c === 'violeta') color = 'Morado / Violeta';
      else if (c === 'naranja') color = 'Naranja Neón';
      else if (c === 'turquesa' || c === 'cyan') color = 'Turquesa / Cyan';
      else color = c.charAt(0).toUpperCase() + c.slice(1);
    } else if (/fibra/i.test(rawName)) {
      color = 'Marrón Manila Fibra';
    }

    // 4. Extracción de Presentación / Empaque Físico
    let presentation = '';
    const presMatch = rawName.match(/\b(caja\s*\d*\s*und?|bulto\s*\d*\s*und?|resma\s*(?:500)?\s*h?|pack\s*\d*\s*und?|paquete\s*\d*\s*und?|display|blister|tubo|rollo|x\s*\d+\s*und?|x\s*\d+)\b/i);
    if (presMatch) {
      presentation = presMatch[0].toUpperCase().replace(/\s+/g, ' ');
    } else if (product.unit) {
      presentation = `Por ${product.unit}`;
    } else {
      presentation = 'Unidad / Empaque Comercial';
    }

    // 5. Deducción del Tipo de Producto Específico para el Prompt Fotográfico
    let productTypeEn = 'stationery office supply merchandise';
    if (/grapadora|engrapadora/i.test(rawName)) {
      productTypeEn = 'desktop metal office stapler with polished steel finish and rubber base';
    } else if (/escarcha|purpurina|brillantina/i.test(rawName)) {
      productTypeEn = 'clear transparent shaker jar container of vibrant sparkling craft glitter powder';
    } else if (/recibo|talonario|factura/i.test(rawName)) {
      productTypeEn = 'printed paper cash receipt order book booklet with perforated pages';
    } else if (/perforadora/i.test(rawName)) {
      productTypeEn = 'two-hole metal desktop office paper punch tool';
    } else if (/resaltad|resalt\b|resalt\./i.test(rawName)) {
      if (/x\s*12|caja/i.test(rawName)) {
        productTypeEn = 'box of 12 fluorescent neon chisel tip highlighter markers in authentic retail packaging box';
      } else {
        productTypeEn = 'fluorescent neon chisel tip highlighter marker office pen';
      }
    } else if (/marcador.*pizarra|pizarra.*marcador/i.test(rawName)) {
      productTypeEn = 'dry erase whiteboard markers with chisel tip';
    } else if (/marcador.*permanente|permanente.*marcador/i.test(rawName)) {
      productTypeEn = 'heavy duty permanent markers';
    } else if (/marcador/i.test(rawName)) {
      productTypeEn = 'stationery felt tip markers in retail packaging';
    } else if (/carpeta.*(?:fibra|manila)|(?:fibra|manila).*carpeta/i.test(rawName)) {
      productTypeEn = 'heavy duty kraft manila fiber office file folders';
    } else if (/sobre/i.test(rawName)) {
      productTypeEn = 'authentic brown kraft manila mailing envelope';
    } else if (/sacapunta/i.test(rawName)) {
      if (/shark|tiburon/i.test(rawName)) {
        productTypeEn = 'novelty shark shaped school pencil sharpener with shavings canister';
      } else {
        productTypeEn = 'compact school pencil sharpener with shavings container';
      }
    } else if (/resma|papel\s*bond/i.test(rawName)) {
      productTypeEn = 'wrapped ream of premium white bond copy paper';
    } else if (/archivador/i.test(rawName)) {
      productTypeEn = 'heavy duty lever arch file binder folder with metal edges';
    } else if (/bandeja.*malla/i.test(rawName)) {
      productTypeEn = 'tier mesh metal desktop document organizer tray';
    } else if (/boligrafo.*gel/i.test(rawName)) {
      productTypeEn = 'smooth gel pens in retail blister pack';
    } else if (/boligrafo/i.test(rawName)) {
      productTypeEn = 'box of ballpoint pens in retail stationery packaging';
    } else if (/silicon|silicona/i.test(rawName)) {
      productTypeEn = 'clear liquid craft silicone glue squeeze bottle';
    } else if (/pistola.*silicon/i.test(rawName)) {
      productTypeEn = 'electric hot melt glue gun craft tool';
    } else if (/regla/i.test(rawName)) {
      productTypeEn = 'clear transparent 30cm plastic metric school ruler';
    } else if (/plastilina/i.test(rawName)) {
      productTypeEn = 'cardboard box of school modeling clay bars in vibrant colors, kids art supplies in retail package';
    } else if (/tijera.*oficina|tijera.*inoxidable|tijera/i.test(rawName)) {
      productTypeEn = 'stainless steel office scissors with ergonomic colored handle in hanging blister retail packaging';
    } else if (/nota.*adhesiv|bander.*adhesiv|señalizador/i.test(rawName)) {
      productTypeEn = 'hanging blister retail package of colorful neon adhesive index flags sticky note page markers';
    } else if (/almohadilla.*dactilar|almohadilla|huellero/i.test(rawName)) {
      productTypeEn = 'stationery fingerprint stamp ink pad with protective case';
    } else if (/borrador.*pizarra/i.test(rawName)) {
      productTypeEn = 'ergonomic whiteboard magnetic eraser';
    } else if (/cinta|tirro|teipe/i.test(rawName)) {
      productTypeEn = 'roll of wide heavy duty adhesive packaging tape';
    }

    // Heurística de tipo de categoría interna
    let catType = 'general';
    if (/tirro|cinta|embalaje|adhesiv|teipe|mascarar/i.test(rawName)) catType = 'tape';
    else if (/resma|papel|bond|cuaderno|block|hojas|fotocopia/i.test(rawName)) catType = 'paper';
    else if (/grap|perforad|dispens|clip|tijera/i.test(rawName)) catType = 'stapler';
    else if (/boligrafo|marcador|lapiz|pluma|resaltador/i.test(rawName)) catType = 'writing';
    else if (/carpeta|sobre|archiv|funda/i.test(rawName)) catType = 'folder';
    else if (/plastilina|tijera|tempera|pincel|escolar|arte/i.test(rawName)) catType = 'school';

    const cleanTitle = rawName
      .replace(/\b(?=[A-Z0-9_-]*\d)[A-Z0-9_-]{6,}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      cleanTitle,
      brand,
      measures,
      color,
      presentation,
      productTypeEn,
      categoryType: catType,
      headlines: [
        '🔥 OFERTA AL MAYOR',
        '⭐ PRODUCTO DESTACADO',
        '📦 LLEGANDO DE FÁBRICA',
        '⚡ DISPONIBILIDAD INMEDIATA',
        '🛡️ CALIDAD GARANTIZADA'
      ]
    };
  }

  /* --------------------------------------------------------------------------
     5.2. Cargador Seguro de Imágenes (CORS / Blob Resiliente para Canvas)
     -------------------------------------------------------------------------- */
  async function loadImageSafe(url) {
    if (!url) return null;
    try {
      // 1. Intentar descargar como blob vía fetch en modo CORS (misma procedencia segura)
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, { mode: 'cors', signal: controller.signal });
      clearTimeout(timer);

      if (resp.ok) {
        const blob = await resp.blob();
        return new Promise((resolve) => {
          const img = new Image();
          const objUrl = URL.createObjectURL(blob);
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = objUrl;
        });
      }
    } catch (e) {
      // Fallback a Image con CORS
    }

    // 2. Fallback: Carga directa mediante Image con crossOrigin anónimo
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 15000);

      img.onload = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(img);
        }
      };

      img.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      };

      img.src = url;
    });
  }

  /* --------------------------------------------------------------------------
     5.3. Generador de Fotografía de Producto de Estudio con IA (Flux / SDXL)
     Investiga las especificaciones reales (marca, medidas, color, empaque)
     y produce una fotografía fotorrealista de catálogo en alta resolución.
     -------------------------------------------------------------------------- */
  const _realPhotoCache = new Map();
  async function searchRealProductPhoto(productName) {
    if (!productName) return null;
    
    const cacheKey = productName.toLowerCase().trim();
    if (_realPhotoCache.has(cacheKey)) {
      const cached = _realPhotoCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 3600000) {
        return cached.url;
      }
    }
    
    try {
      const loc = typeof window !== 'undefined' ? window.location : { hostname: 'localhost', protocol: 'http:' };
      const urlsToTry = [
        `/api/search-images?q=${encodeURIComponent(productName)}`,
        `/lan/products/search-images?q=${encodeURIComponent(productName)}`
      ];
      if (loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1' && /^(192\.168\.|10\.|172\.)/.test(loc.hostname)) {
        urlsToTry.push(`${loc.protocol}//${loc.hostname}:8787/lan/products/search-images?q=${encodeURIComponent(productName)}`);
      }
      if (loc.protocol === 'http:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
        urlsToTry.push(`http://localhost:8787/lan/products/search-images?q=${encodeURIComponent(productName)}`);
        urlsToTry.push(`http://127.0.0.1:8787/lan/products/search-images?q=${encodeURIComponent(productName)}`);
      }

      for (const endpoint of urlsToTry) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(endpoint, {
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          
          if (res.ok) {
            const data = await res.json();
            const results = data.results || (Array.isArray(data) ? data : []);
            if (results && results.length > 0 && results[0].image) {
              const url = results[0].image;
              _realPhotoCache.set(cacheKey, { url, timestamp: Date.now() });
              return url;
            }
          }
        } catch (_) {}
      }
    } catch (e) {
      // Servidor local o endpoint en la nube no respondieron
    }
    return null;
  }

  const _studioPhotoCache = new Map();

  async function generateProductStudioPhoto({ product, theme = 'white', forceNew = false }) {
    if (!product) throw new Error('Producto no especificado');
    const name = product.name || 'Producto de Papelería';
    const cacheKey = `${product.id || name}_${theme}`;

    if (!forceNew && _studioPhotoCache.has(cacheKey)) {
      return _studioPhotoCache.get(cacheKey);
    }

    // 1. Extraer y enriquecer especificaciones comerciales
    const enriched = await enrichProductForMarketing(product);
    const brand = enriched?.brand && enriched.brand !== 'JJ Paper Oficial' ? enriched.brand : '';
    const measures = (enriched?.measures && enriched.measures !== 'Medida estándar') ? enriched.measures : '';
    const color = enriched?.color || '';
    const presentation = enriched?.presentation || '';
    const prodTypeEn = enriched?.productTypeEn || 'stationery office supply merchandise';

    // 2. Construir especificaciones fotográficas descriptivas en inglés para Flux
    let specDescriptors = [];
    if (brand) specDescriptors.push(`authentic brand ${brand} retail packaging`);
    if (color) specDescriptors.push(`${color} color`);
    if (measures) specDescriptors.push(`${measures} format`);
    if (presentation && presentation !== 'Unidad / Empaque Comercial') specDescriptors.push(presentation);

    const specsStr = specDescriptors.length > 0 ? `, ${specDescriptors.join(', ')}` : '';

    // Consultar a Gemini para obtener una descripción comercial en inglés ultra-precisa del empaque/producto
    let englishSubject = '';
    try {
      if (typeof callGemini === 'function') {
        const sys = 'You are an expert commercial advertising packshot photographer specializing in stationery, office supplies and retail packaging catalogs.';
        const q = `Translate this Venezuelan stationery product title into a clear, professional 1-sentence English retail packshot description: "${name}".
Brand: ${brand || 'standard'}
Color: ${color || 'standard'}
Format/Specs: ${measures || 'standard'}
Packaging/Presentation: ${presentation || 'standard'}
CRITICAL PHOTO GUIDELINES:
- Describe the physical merchandise in its authentic retail packaging (e.g. "retail hanging blister card with euro-slot of stainless steel office scissors, blue rubber grip", "colorful printed paper wrap of 500-sheet copy paper ream", "vibrant illustrated retail folding carton box of 6 modeling clay bars").
- Only describe the product object itself and its packaging. Do NOT describe rooms, furniture, desks or people.
Respond with ONLY the 1 English sentence.`;
        const translated = await callGemini({ prompt: q, systemInstruction: sys, temperature: 0.2 });
        if (translated && translated.length > 5 && !translated.includes('Error')) {
          englishSubject = translated.replace(/^["'`]|["'`]$/g, '').trim();
        }
      }
    } catch (_) {}

    if (!englishSubject) {
      englishSubject = `${prodTypeEn} (${enriched?.cleanTitle || name}${specsStr})`;
    }

    const bgPrompt = (theme === 'white')
      ? 'isolated product packshot on seamless pure solid white background #FFFFFF, commercial studio softbox lighting, soft natural contact shadow at base'
      : 'isolated product packshot on luxury deep emerald green #0B3327 background, subtle center backlight halo, soft natural contact shadow at base';

    const photoPrompt = `Commercial retail packshot of ${englishSubject}, isolated centered front hero angle, ${bgPrompt}, crisp pristine packaging condition, razor-sharp focus on branding typography, professional commercial advertising photography, 8k uhd`;

    // Generar imagen con Pollinations Flux (motor de IA publicitaria)
    const cleanPrompt = photoPrompt.slice(0, 450);
    const seed = Math.abs(hashCode(name + (forceNew ? Date.now() : '')));
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=800&height=800&model=flux&nologo=true&seed=${seed}`;

    const result = {
      imageUrl,
      prompt: photoPrompt,
      specs: enriched,
      isAiGenerated: true
    };

    _studioPhotoCache.set(cacheKey, result);
    return result;
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  /* --------------------------------------------------------------------------
     6. Generador Visual de Flyer Publicitario de Estudio (Canvas Ultra-HD 1200x1200)
     Soporta Fondo Blanco Estudio y Fondo Verde Esmeralda JJ Paper
     -------------------------------------------------------------------------- */
  async function renderProductCard({
    product,
    customPriceUsd = null,
    sellerName = '',
    sellerPhone = '',
    customNote = '',
    theme = 'emerald', // 'emerald' | 'white'
    headline = '',
    canvas = null
  }) {
    const cvs = canvas || document.createElement('canvas');
    cvs.width = 1200;
    cvs.height = 1200;
    const ctx = cvs.getContext('2d');

    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const priceUsd = customPriceUsd !== null ? parseFloat(customPriceUsd) : parseFloat(product.price_usd || 0);
    const priceBs = (priceUsd * rate).toFixed(2);
    const isWhite = (theme === 'white');

    // 1. Fondo Estudio Fotográfico
    if (isWhite) {
      // Fondo Blanco Puro de Estudio Comercial con Suave Degradado Ciclomara
      const whiteGrad = ctx.createLinearGradient(0, 0, 0, 1200);
      whiteGrad.addColorStop(0, '#FFFFFF');
      whiteGrad.addColorStop(0.65, '#FFFFFF');
      whiteGrad.addColorStop(1, '#F1F5F9');
      ctx.fillStyle = whiteGrad;
      ctx.fillRect(0, 0, 1200, 1200);

      // Suave halo de luz de estudio central
      const softGlow = ctx.createRadialGradient(600, 480, 50, 600, 480, 480);
      softGlow.addColorStop(0, 'rgba(241, 245, 249, 0.9)');
      softGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = softGlow;
      ctx.fillRect(0, 0, 1200, 1200);

      // Línea de horizonte de piso de estudio
      ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.fillRect(60, 718, 1080, 1.5);
    } else {
      // Fondo Verde Esmeralda Corporativo JJ Paper con Iluminación de Estudio Spotlight
      const bgGrad = ctx.createLinearGradient(0, 0, 0, 1200);
      bgGrad.addColorStop(0, '#062017');
      bgGrad.addColorStop(0.5, '#0B3327');
      bgGrad.addColorStop(1, '#020F0A');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 1200, 1200);

      const radialGlow = ctx.createRadialGradient(600, 460, 40, 600, 460, 500);
      radialGlow.addColorStop(0, 'rgba(22, 96, 74, 0.6)');
      radialGlow.addColorStop(0.65, 'rgba(16, 185, 129, 0.15)');
      radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, 1200, 1200);
    }

    // 2. Cabecera Institucional JJ Paper con Logotipo Oficial
    ctx.fillStyle = isWhite ? '#16604A' : '#EAB308';
    ctx.fillRect(60, 46, 1080, 3.5);

    // Isotipo Vectorial JJ Paper (Hojas de papel estilizadas en verde lima)
    ctx.save();
    ctx.translate(62, 70);
    ctx.fillStyle = '#99CC33';
    ctx.beginPath();
    ctx.moveTo(0, 36);
    ctx.bezierCurveTo(0, 12, 14, 0, 36, 0);
    ctx.bezierCurveTo(36, 24, 22, 36, 0, 36);
    ctx.fill();

    ctx.fillStyle = '#16604A';
    ctx.beginPath();
    ctx.moveTo(14, 38);
    ctx.bezierCurveTo(24, 18, 38, 10, 50, 10);
    ctx.bezierCurveTo(50, 28, 38, 38, 14, 38);
    ctx.fill();
    ctx.restore();

    // Logotipo Tipográfico
    ctx.fillStyle = isWhite ? '#0B3327' : '#FFFFFF';
    ctx.font = '900 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('JJ PAPER', 125, 96);

    ctx.fillStyle = isWhite ? '#16604A' : '#A3E635';
    ctx.font = '800 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('DISTRIBUIDORA & PAPELERÍA MAYORISTA · CARACAS', 125, 118);

    // Badge Superior Derecho (Titular Publicitario)
    const topBadgeText = headline || '🔥 OFERTA AL MAYOR';
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const topBadgeW = Math.max(220, ctx.measureText(topBadgeText).width + 36);
    const topBadgeX = 1140 - topBadgeW;

    ctx.fillStyle = isWhite ? '#0B3327' : '#DC2626';
    roundRect(ctx, topBadgeX, 64, topBadgeW, 46, 23);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(topBadgeText, topBadgeX + topBadgeW / 2, 93);
    ctx.textAlign = 'left';

    // 3. EL ESCENARIO CENTRAL DEL PRODUCTO
    const stageCenterX = 600;
    const stageCenterY = 430;
    const maxImgW = 760;
    const maxImgH = 460;

    let imageRendered = false;
    let imgToLoad = product.image_url;
    
    if (!imgToLoad) {
      try {
        const realPhoto = await searchRealProductPhoto(product.name);
        if (realPhoto) {
          imgToLoad = realPhoto;
          product.image_url = realPhoto;
        }
      } catch (e) {
        console.warn('Fallo búsqueda de foto real para flyer:', e);
      }
    }

    if (!imgToLoad) {
      imgToLoad = product._studio_photo_url;
      if (!imgToLoad) {
        try {
          const studioRes = await generateProductStudioPhoto({ product, theme });
          if (studioRes?.imageUrl) {
            imgToLoad = studioRes.imageUrl;
            product._studio_photo_url = imgToLoad;
          }
        } catch (e) {
          console.warn('No se pudo pregenerar foto de estudio para flyer:', e);
        }
      }
    }

    if (imgToLoad) {
      try {
        let img = await loadImageSafe(imgToLoad);
        // Si la foto del catálogo falló, intentar de inmediato generar la foto de estudio fotográfica
        if (!img && imgToLoad !== product._studio_photo_url) {
          try {
            const studioRes = await generateProductStudioPhoto({ product, theme });
            if (studioRes?.imageUrl) {
              product._studio_photo_url = studioRes.imageUrl;
              img = await loadImageSafe(studioRes.imageUrl);
            }
          } catch (_) {}
        }

        if (img && img.width > 10 && img.height > 10) {
          const scale = Math.min(maxImgW / img.width, maxImgH / img.height, 1.15);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const dx = stageCenterX - dw / 2;
          const dy = stageCenterY - dh / 2 + 10;

          // Sombra de contacto realista en el suelo
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(stageCenterX, dy + dh - 4, dw * 0.32, 10, 0, 0, Math.PI * 2);
          ctx.fillStyle = isWhite ? 'rgba(0, 0, 0, 0.28)' : 'rgba(0, 0, 0, 0.45)';
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(stageCenterX, dy + dh + 4, dw * 0.48, 22, 0, 0, Math.PI * 2);
          ctx.fillStyle = isWhite ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.25)';
          ctx.fill();
          ctx.restore();

          // Fotografía comercial del producto en el centro
          ctx.drawImage(img, dx, dy, dw, dh);
          imageRendered = true;
        }
      } catch (err) {
        console.warn('Fallo cargando imagen en renderProductCard:', err);
      }
    }

    // Fallback de seguridad si no hay conexión o falló la imagen
    if (!imageRendered) {
      renderCommercial3dProduct(ctx, product, stageCenterX, stageCenterY, isWhite);
    }

    // 4. Bloque de Datos Comerciales del Producto (Y: 730 a 830)
    const titleY = 745;
    ctx.fillStyle = isWhite ? '#0B3327' : '#FFFFFF';
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    // Limpiar nombre de códigos numéricos de bodega
    const rawName = product.name || 'Producto Oficial JJ Paper';
    const displayTitle = rawName.replace(/\b(?=[A-Z0-9_-]*\d)[A-Z0-9_-]{6,}\b/g, '').replace(/\s+/g, ' ').trim();
    const titleLines = wrapText(ctx, displayTitle, 1080);
    ctx.fillText(titleLines[0], 60, titleY);
    if (titleLines.length > 1) {
      ctx.fillText(titleLines[1], 60, titleY + 42);
    }

    // Pastilla de Atributos de Valor (Marca, Medida, Color, Presentación)
    const metaY = titleLines.length > 1 ? titleY + 84 : titleY + 46;
    let metaItems = [];
    const brand = product.brand || product.brands || product.brand_name;
    if (brand) metaItems.push(`🏷️ Marca: ${brand}`);

    const mMatch = product.measures || rawName.match(/(\d+\s*x\s*\d+\s*(?:mm|cm|m|mts|pulg)?|\d+\s*(?:mm|cm|m|gr|g|kg|micras|ml|litros|hojas|piezas|und|unidades)\b|carta|oficio|extra\s*oficio|tabloide|a4|a3|1\/2\s*pliego|pliego)/i)?.[0];
    if (mMatch && mMatch.toUpperCase() !== 'MEDIDA ESTÁNDAR') metaItems.push(`📏 Medida: ${mMatch.toUpperCase()}`);

    const cMatch = product.color || rawName.match(/\b(transparente|marron|blanco|azul|negro|rojo|verde|amarillo|dorado|plateado|surtido|multicolor|kraft)\b/i)?.[0];
    if (cMatch) metaItems.push(`🎨 Color: ${cMatch.charAt(0).toUpperCase() + cMatch.slice(1).toLowerCase()}`);

    if (product.presentation || product.unit) metaItems.push(`📦 ${product.presentation || product.unit}`);
    const metaStr = metaItems.length > 0 ? metaItems.join('   ·   ') : '✓ Garantía Oficial de Fábrica';

    ctx.fillStyle = isWhite ? '#475569' : '#94A3B8';
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(metaStr, 60, metaY);

    // 5. Bloque Hero de Precios (Doble Moneda USD / Bs Oficial BCV)
    const priceBoxY = metaY + 24;
    const priceBoxH = 160;

    const pBoxGrad = ctx.createLinearGradient(60, priceBoxY, 1140, priceBoxY + priceBoxH);
    if (isWhite) {
      pBoxGrad.addColorStop(0, '#0B3327');
      pBoxGrad.addColorStop(1, '#051C14');
    } else {
      pBoxGrad.addColorStop(0, '#16604A');
      pBoxGrad.addColorStop(1, '#0B3327');
    }
    ctx.fillStyle = pBoxGrad;
    roundRect(ctx, 60, priceBoxY, 1080, priceBoxH, 22);
    ctx.fill();

    ctx.strokeStyle = '#99CC33';
    ctx.lineWidth = 2.5;
    roundRect(ctx, 60, priceBoxY, 1080, priceBoxH, 22);
    ctx.stroke();

    // Columna Izquierda: Precio USD
    ctx.fillStyle = '#99CC33';
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PRECIO OFICIAL DE DISTRIBUIDORA', 95, priceBoxY + 46);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const formattedUsd = `$${priceUsd.toFixed(2)}`;
    ctx.fillText(formattedUsd, 95, priceBoxY + 116);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('USD', 95 + ctx.measureText(formattedUsd).width + 12, priceBoxY + 112);

    // Columna Derecha: Tarjeta al cambio oficial en Bolívares
    const bsBoxW = 440, bsBoxH = 114;
    const bsBoxX = 1140 - bsBoxW - 25;
    const bsBoxY = priceBoxY + 23;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    roundRect(ctx, bsBoxX, bsBoxY, bsBoxW, bsBoxH, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bsBoxX, bsBoxY, bsBoxW, bsBoxH, 16);
    ctx.stroke();

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`CAMBIO OFICIAL BCV (Bs. ${rate.toFixed(2)})`, bsBoxX + bsBoxW / 2, bsBoxY + 36);

    ctx.fillStyle = '#FDE047';
    ctx.font = '900 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Bs ${Number(priceBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, bsBoxX + bsBoxW / 2, bsBoxY + 84);
    ctx.textAlign = 'left';

    // 6. Tres Pilares de Confianza
    const pillarY = priceBoxY + priceBoxH + 28;
    const pillars = [
      '⚡ Despacho Rápido Caracas',
      '🛡️ Factura Fiscal & Garantía',
      '🚚 Envíos a Toda Venezuela'
    ];
    ctx.font = '600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const pillW = 340, pillH = 38;
    pillars.forEach((p, idx) => {
      const px = 60 + idx * (pillW + 30);
      ctx.fillStyle = isWhite ? '#E2E8F0' : 'rgba(255, 255, 255, 0.08)';
      roundRect(ctx, px, pillarY, pillW, pillH, 19);
      ctx.fill();
      ctx.fillStyle = isWhite ? '#0F172A' : '#E2E8F0';
      ctx.textAlign = 'center';
      ctx.fillText(p, px + pillW / 2, pillarY + 25);
      ctx.textAlign = 'left';
    });

    // 7. Pie de Página Comercial y Contacto
    const footerY = 1145;
    ctx.fillStyle = isWhite ? '#CBD5E1' : 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(60, footerY - 22, 1080, 1.5);

    const advisorStr = sellerName ? `Atendido por: ${sellerName}` : 'Dpto. de Ventas y Distribución';
    const phoneStr = sellerPhone ? `📱 WhatsApp: ${sellerPhone}` : '📱 Pedidos directos en tienda y almacén';

    ctx.fillStyle = isWhite ? '#0B3327' : '#FFFFFF';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`${advisorStr}   ·   ${phoneStr}`, 60, footerY + 14);

    ctx.fillStyle = isWhite ? '#16604A' : '#A3E635';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('JJ PAPER C.A.', 1140, footerY + 14);
    ctx.textAlign = 'left';

    return cvs;
  }

  /**
   * Renderizado Comercial 3D Fotorrealista para productos sin foto
   */
  function renderCommercial3dProduct(ctx, product, cx, cy, isWhite) {
    const name = (product.name || '').toLowerCase();

    ctx.save();

    // Sombra de contacto en suelo de estudio
    ctx.beginPath();
    ctx.ellipse(cx, cy + 180, 260, 28, 0, 0, Math.PI * 2);
    ctx.fillStyle = isWhite ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.5)';
    ctx.fill();

    if (/tirro|cinta|embalaje|adhesiv/i.test(name)) {
      // 3D Cinta de Embalaje Comercial
      const rollR = 150;
      const rollH = 85;

      // Cara inferior del cilindro
      ctx.fillStyle = isWhite ? '#D97706' : '#B45309';
      ctx.beginPath();
      ctx.ellipse(cx, cy + rollH / 2, rollR, rollR * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pared lateral del cilindro (cuerpo del rollo)
      const rollGrad = ctx.createLinearGradient(cx - rollR, 0, cx + rollR, 0);
      rollGrad.addColorStop(0, '#B45309');
      rollGrad.addColorStop(0.3, '#F59E0B');
      rollGrad.addColorStop(0.5, '#FDE68A');
      rollGrad.addColorStop(0.7, '#D97706');
      rollGrad.addColorStop(1, '#92400E');
      ctx.fillStyle = rollGrad;
      ctx.fillRect(cx - rollR, cy - rollH / 2, rollR * 2, rollH);

      // Cara superior del cilindro
      const topGrad = ctx.createRadialGradient(cx - 30, cy - rollH / 2 - 20, 10, cx, cy - rollH / 2, rollR);
      topGrad.addColorStop(0, '#FEF3C7');
      topGrad.addColorStop(0.7, '#F59E0B');
      topGrad.addColorStop(1, '#B45309');
      ctx.fillStyle = topGrad;
      ctx.beginPath();
      ctx.ellipse(cx, cy - rollH / 2, rollR, rollR * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Núcleo de cartón central (agujero con profundidad)
      const coreR = 68;
      ctx.fillStyle = '#78350F';
      ctx.beginPath();
      ctx.ellipse(cx, cy - rollH / 2, coreR, coreR * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // Texto de marca en el interior del núcleo
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('JJ PAPER PREMIUM', cx, cy - rollH / 2 + 5);
      ctx.textAlign = 'left';

    } else if (/resma|papel|bond|cuaderno|block/i.test(name)) {
      // 3D Resma de Papel Bond Empacada
      const rw = 280, rh = 180, depth = 70;

      // Cara frontal
      const frontGrad = ctx.createLinearGradient(cx - rw / 2, 0, cx + rw / 2, 0);
      frontGrad.addColorStop(0, '#0F766E');
      frontGrad.addColorStop(0.5, '#14B8A6');
      frontGrad.addColorStop(1, '#0D9488');
      ctx.fillStyle = frontGrad;
      ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);

      // Cara superior (perspectiva)
      ctx.fillStyle = '#2DD4BF';
      ctx.beginPath();
      ctx.moveTo(cx - rw / 2, cy - rh / 2);
      ctx.lineTo(cx - rw / 2 + 40, cy - rh / 2 - depth);
      ctx.lineTo(cx + rw / 2 + 40, cy - rh / 2 - depth);
      ctx.lineTo(cx + rw / 2, cy - rh / 2);
      ctx.closePath();
      ctx.fill();

      // Cara lateral derecha
      ctx.fillStyle = '#0F766E';
      ctx.beginPath();
      ctx.moveTo(cx + rw / 2, cy - rh / 2);
      ctx.lineTo(cx + rw / 2 + 40, cy - rh / 2 - depth);
      ctx.lineTo(cx + rw / 2 + 40, cy + rh / 2 - depth);
      ctx.lineTo(cx + rw / 2, cy + rh / 2);
      ctx.closePath();
      ctx.fill();

      // Sello institucional en empaque
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, cx - 100, cy - 40, 200, 80, 10);
      ctx.fill();
      ctx.fillStyle = '#0F766E';
      ctx.font = '900 24px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('JJ PAPER', cx, cy - 8);
      ctx.font = '700 13px -apple-system, sans-serif';
      ctx.fillText('PAPEL BOND 75g · 500 HJS', cx, cy + 18);
      ctx.textAlign = 'left';

    } else {
      // Tarjeta Comercial de Presentación de Estudio (Fondo Blanco o Esmeralda)
      const pw = 420, ph = 240;
      ctx.fillStyle = isWhite ? '#FFFFFF' : 'rgba(255, 255, 255, 0.08)';
      ctx.strokeStyle = isWhite ? '#E2E8F0' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2.5;
      roundRect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 18);
      ctx.fill();
      ctx.stroke();

      // Icono representativo
      const emoji = product.emoji || '📦';
      ctx.font = '68px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(emoji, cx, cy - 25);

      // Etiqueta destacada
      ctx.fillStyle = isWhite ? '#16604A' : '#A3E635';
      ctx.font = '800 16px -apple-system, sans-serif';
      ctx.fillText('PRODUCTO OFICIAL JJ PAPER', cx, cy + 45);

      ctx.fillStyle = isWhite ? '#64748B' : 'rgba(255, 255, 255, 0.75)';
      ctx.font = '600 13px -apple-system, sans-serif';
      ctx.fillText('DISPONIBILIDAD INMEDIATA · CALIDAD GARANTIZADA', cx, cy + 70);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(' ');
    const lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + ' ' + word).width;
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  }
  return {
    callGemini,
    suggestWhatsAppReplies,
    generateAntiSpamVariations,
    generateCampaignSpintax,
    draftCampaignMessage,
    draftEmail,
    analyzeAndDraftProspectB2B,
    analyzeCustomerAndDraftMessage,
    analyzeCustomersBatch,
    searchProductsLive,
    interpretQueryWithAI,
    detectProductType,
    matchesVariant,
    enrichProductForMarketing,
    generateProductStudioPhoto,
    searchRealProductPhoto,
    askCopilot,
    renderProductCard,
    getCurrentKeyIndex: () => _keyIndex,
    getTotalKeys: () => GEMINI_KEYS.length
  };
});
