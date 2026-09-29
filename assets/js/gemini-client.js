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
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite'
  ];

  // Modelos ultrarrápidos para sugerencias en vivo en chat y cotizaciones
  const FAST_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite'
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
     Llamada Base a la API con enrutamiento inteligente (Soporta objeto {prompt,...} o (prompt, model))
     -------------------------------------------------------------------------- */
  async function callGemini(options, fallbackModel = null) {
    _totalCalls++;

    let prompt = '';
    let systemInstruction = '';
    let temperature = 0.7;
    let maxTokens = 1500;
    let model = null;
    let mode = 'fast';

    if (typeof options === 'string') {
      prompt = options;
      model = fallbackModel;
    } else if (options && typeof options === 'object') {
      prompt = options.prompt || '';
      systemInstruction = options.systemInstruction || '';
      temperature = options.temperature !== undefined ? options.temperature : 0.7;
      maxTokens = options.maxTokens || 1500;
      model = options.model || fallbackModel || null;
      mode = options.mode || 'fast';
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('El prompt enviado a Gemini AI está vacío o no es una cadena válida.');
    }

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

          // Si es límite de cuota (429) o sobrecargado (503) o 404
          if (status === 429 || status === 503 || status === 404) {
            lastError = new Error(`Modelo ${m} no disponible (${status}): ${errMsg}`);
            continue; // probar siguiente modelo
          }

          // Si clave no autorizada (403) o error explícito de API key
          if (status === 403 || (status === 400 && (errMsg.toLowerCase().includes('api_key') || errMsg.toLowerCase().includes('key not valid')))) {
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key rechazada o inválida (${status}): ${errMsg}`);
            break; // Cambiar de llave
          }

          if (status === 400) {
            lastError = new Error(`Error en solicitud a IA (400): ${errMsg}`);
            continue;
          }

          lastError = new Error(`Error en API (${status}): ${errMsg}`);
        } catch (netErr) {
          clearTimeout(timeoutId);
          lastError = netErr;
          continue; // Si un modelo da timeout, probar siguiente modelo
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

CRÍTICO PARA EVITAR RESTRICCIONES DE WHATSAPP:
No solo cambies una o dos palabras. Debes generar una **variación estructural profunda**.
El algoritmo de WhatsApp detecta patrones de similitud. Si todos los mensajes tienen la misma longitud y estructura, bloquearán la cuenta.

ESTÁNDARES DE CONSTRUCCIÓN SPINTAX PROFUNDO:
1. Variación Estructural del Inicio: {¡Hola! Espero que estés excelente. Te habla {{vendedor}}...|Buen día {{nombre}}, un gusto saludarle de parte de {{vendedor}}...|Saludos cordiales {{nombre}}, le escribe {{vendedor}}...}
2. Variación de Párrafos: Intercala párrafos enteros, usa { | | } para incluir o no incluir ciertas frases accesorias que rompan el tamaño en bytes del mensaje.
3. Variación de Llamados a la Acción: {¿Gusta que le envíe el catálogo completo?|Quedo atento por si necesita una cotización formal.|Me avisa cualquier duda y le cotizo sin compromiso.|¿Le aparto algún producto en inventario?}
4. Emoticones aleatorios: Haz que los emojis aparezcan solo a veces. Ejemplo: {📦 |📦 |}{Tenemos stock|Inventario disponible|Listos para despachar}.
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

  async function parseProspectsText(rawText) {
    if (!rawText || !rawText.trim()) return [];
    const prompt = `Eres un extractor experto de bases de datos B2B para JJ Paper C.A. en Caracas, Venezuela.
Analiza el siguiente texto crudo (que puede ser un archivo TXT, un volcado de CRM, una lista desordenada sin columnas claras, o texto pegado) y extrae sistemáticamente todas las empresas y cuentas comerciales.

Para CADA cuenta identificada, extrae o deduce con precisión:
- "company_name": Razón social o nombre comercial limpio de la empresa (OBLIGATORIO, ej: "Locatel Venezuela", "Banesco Seguros", "Farmatodo").
- "sector": Rubro o industria estimada (ej: "Farmacias y Retail", "Salud Privada y Clínicas", "Aseguradoras", "Supermercados", "Educación", "Logística y Transporte", etc.).
- "contact_name": Nombre de la persona o interlocutor clave (si aparece, o null).
- "contact_role": Cargo o departamento (ej: "Gerente de Compras", "Procura", "Administración", si aparece, o null).
- "phone_1": Teléfono fijo, máster o principal (ej: "(0212) 955.80.00", o null).
- "phone_2": Celular o WhatsApp corporativo (ej: "+58 414-226.37.26", o null).
- "email": Correo electrónico corporativo o de compras (ej: "compras@empresa.com", o null).
- "address": Dirección física, torre, urbanización o punto de referencia (ej: "Torre Banesco II, El Rosal, Caracas", o null).
- "city": Ciudad (por defecto "Caracas", o la que indique el texto).
- "notes": Criterio de compras, insumos requeridos o notas operativas (si aparece, o null).

Devuelve ÚNICAMENTE un JSON válido que sea un arreglo de objetos [...] sin explicaciones ni markdown exterior.

Texto a analizar:
${rawText.slice(0, 50000)}
    `;

    try {
      const resp = await callGemini({ prompt, temperature: 0.1, maxTokens: 4000, mode: 'architect' });
      let t = resp.replace(/```json/gi, '').replace(/```/g, '').trim();
      const firstBrace = t.indexOf('[');
      const lastBrace = t.lastIndexOf(']');
      if (firstBrace !== -1 && lastBrace !== -1) {
        t = t.substring(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(t);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Error parseando prospectos con IA', e);
      return [];
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
    sellerName = '',
    tone = 'Profesional y Persuasivo (Vendedor Consultivo)',
    historyContext = ''
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
Tu objetivo es redactar un mensaje comercial de alto impacto para ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'} que proyecte seriedad, confianza, calidez y actitud de socio estratégico.

ESTÁNDARES DE COPYWRITING B2B CON ACTITUD Y ESTRUCTURA:
1. TONO Y PERSONALIDAD:
   - Aplica estrictamente este tono: "${tone}".
   - Si el contexto indica reactivación o seguimiento ("enviamos lista la semana pasada"), asume una actitud de servicio y disposición a ayudar ("¿pudieron revisar la lista?", "estamos a la orden para surtirlos", etc.).

2. ESTRUCTURA VISUAL OBLIGATORIA DEL MENSAJE (¡MUY IMPORTANTE!):
   - **SALUDO DINÁMICO (SPINTAX)**: Usa {Hola|Qué tal|Buen día|Saludos} {{nombre}}.
   - **TÍTULO PRINCIPAL**: Un título atractivo en negritas (Ej: *🔥 Gran Oferta en Papelería*).
   - **CUERPO DEL MENSAJE**: Párrafos cortos. Usa subtítulos en negrita si es necesario.
   - **VIÑETAS**: Si describes productos/servicios, usa emojis de check (✔️) o viñetas (🔹).
   - **LLAMADO A LA ACCIÓN (CTA)**: Pregunta de cierre (Ej: "¿Te apartamos mercancía?").
   - **DESPEDIDA Y FIRMA**: DEBES incluir una firma profesional al final usando la variable {{vendedor}} (Ej: "Atentamente, {{vendedor}} | Asesor JJ Paper | {{link}}").

3. PARÁMETROS DE CONTENIDO:
   - Destaca características concretas: marcas, formatos (resmas, bultos, cajas).
   - Recuerda nuestras ventajas: Despacho a sede (Caracas), envíos nacionales seguros, Factura Fiscal a Tasa BCV Oficial, Cotizaciones inmediatas.
   - NO suenes como un robot publicitario ni exageres. Sé un asesor venezolano corporativo.

4. PRESERVACIÓN ESTRICTA DE VARIABLES:
   - Conserva exactamente {{nombre}}, {{empresa}}, {{vendedor}}, {{link}}. NO inventes variables nuevas. Si aplicas producto/precio en plantilla, usa {{producto}} y {{precio}}.

Devuelve EXACTAMENTE un objeto JSON válido (sin etiquetas markdown exteriores ni \`\`\`json):
- Si channel === 'email': { "subject": "Asunto profesional de alto impacto", "body": "Cuerpo completo con formato HTML o texto con saltos de línea y firma" }
- Si channel === 'whatsapp': { "body": "Cuerpo del mensaje estructurado en WhatsApp (*negritas*, _cursivas_, viñetas, firma al final)" }
`;

    const prompt = `
Propósito o Requerimiento del Asesor: ${objective}
Contexto Histórico / Relación: ${historyContext || 'Sin contexto especial'}
Personalidad / Tono Requerido: ${tone}
Canal: ${channel}
Segmento de Audiencia: ${audience}
${prodSpecs}
Condición Especial: ${discount || 'Precios directos de distribuidora mayorista'}
Notas adicionales: ${customNotes || 'Atención personalizada, despacho inmediato'}
Asesor emisor: ${sellerName || 'Equipo Comercial JJ Paper'}

Redacta el mensaje comercial siguiendo estrictamente la estructura (Título, viñetas, firma al final) y el formato JSON solicitado:`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.55 });
      return extractJSON(raw);
    } catch (e) {
      console.warn('Fallback draftCampaignMessage:', e);
      if (channel === 'email') {
        return {
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

  // Trae productos REALES del catálogo (con precio B real o price_usd) para que la
  // IA escriba con datos verdaderos en vez de inventar productos y montos.
  async function fetchRealPortfolioProducts(maxOverall = 14) {
    const w = typeof window !== 'undefined' ? window : {};
    let list = (Array.isArray(w.allProducts) && w.allProducts.length) ? w.allProducts : null;
    if (!list) {
      try {
        const s = sessionStorage.getItem('jjp_products_cache_v4');
        if (s) list = JSON.parse(s);
      } catch (_) {}
    }
    if (!Array.isArray(list) || !list.length) {
      const client = (typeof sb !== 'undefined' ? sb : (w.sb || w.sbCore));
      if (!client) return [];
      try {
        const { data, error } = await client.from('jjp_products')
          .select('id,name,sku,price_usd,price_a,price_b,unit,description,active')
          .neq('active', false)
          .range(0, 1999);
        if (error || !data) return [];
        list = data;
      } catch (e) {
        return [];
      }
    }

    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Familias de alta rotación que cubren el portafolio real de JJ Paper
    const groups = [
      { kw: ['rollo', 'termico', 'pos', 'caja fiscal'] },
      { kw: ['resma', 'papel bond', 'bond 75', 'bond 80', 'carta', 'oficio'] },
      { kw: ['carpeta', 'fibra', 'manila', 'archivador', 'palanca'] },
      { kw: ['sobre', 'radiografia', 'sobre manila'] },
      { kw: ['cuaderno', 'marcador pizarra', 'boligrafo', 'resaltador', 'lapiz'] },
      { kw: ['cinta', 'embalaje', 'empaque', 'pistola'] },
      { kw: ['marcador', 'permanente', 'detector', 'indeleble'] }
    ];

    const picked = [];
    const seen = new Set();

    for (const g of groups) {
      const scored = (list || []).map(p => {
        const full = norm(`${p.name || ''} ${p.sku || ''} ${p.description || ''}`);
        let s = 0;
        for (const kw of g.kw) if (full.includes(norm(kw))) s++;
        return { p, s };
      }).filter(x => x.s >= 1)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);

      for (const { p } of scored) {
        if (seen.has(p.id || p.name)) continue;
        seen.add(p.id || p.name);
        const pB = Number(p.price_b || 0);
        const pU = Number(p.price_usd || 0);
        const priceUsd = pB > 0 ? pB : pU;
        if (priceUsd <= 0) continue;
        picked.push({
          id: p.id, name: p.name, sku: p.sku || '',
          unit: p.unit || 'unidad',
          price_usd: priceUsd,
          price_bs: priceUsd > 0 ? priceUsd * rate : 0
        });
        if (picked.length >= maxOverall) return picked;
      }
    }
    return picked;
  }

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
    channel = 'both',
    customerFull = null,
    orderHistory = '',
    personality = 'Profesional / Formal',
    messageType = 'Presentación Inicial'
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

    // ── Catálogo REAL con precio actualizado (la IA escribe con datos reales, no inventados) ──
    let realProducts = [];
    try { realProducts = await fetchRealPortfolioProducts(); } catch (e) { console.warn('Catálogo real no disponible:', e); }

    const realProdInfo = realProducts.length
      ? realProducts.map(p =>
        `- ${p.name}${p.sku ? ` · SKU: ${p.sku}` : ''} · Presentación: ${p.unit || 'unidad'} · *Precio: $${p.price_usd.toFixed(2)} USD* (Bs ${p.price_bs.toFixed(2)})`
      ).join('\n')
      : '- (Catálogo temporalmente no disponible: NO inventes precios; describe los beneficios del portafolio sin montos.)';

    const histTxt = orderHistory
      ? orderHistory
      : (customerFull && Number(customerFull.total_orders) > 0
          ? `${customerFull.total_orders} pedido(s) por $${Number(customerFull.total_usd || 0).toFixed(2)} USD${customerFull.last_order_at ? ` (último: ${customerFull.last_order_at})` : ''}`
          : 'Sin compras registradas (cliente nuevo o prospecto)');

    const promoInfo = promoProductOrCombo ? `
ATENCIÓN - PRODUCTO / OFERTA COMERCIAL SELECCIONADA POR EL ASESOR:
- Nombre: "${promoProductOrCombo.name || promoProductOrCombo.title || 'Insumo destacado'}"
- Precio especial: $${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0).toFixed(2)} USD (equivalente a ${(Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0) * rate).toFixed(2)} Bs a Tasa Oficial BCV)
- Descripción: "${promoProductOrCombo.description || 'Disponibilidad inmediata al mayor'}"
DIRECTIVA DE OFERTA: Este producto/combo DEBE ser el PRIMER ítem destacado en la propuesta operativa, combinado armónicamente con 2 insumos complementarios según el sector de la empresa.` : '';

    const isAlreadyContacted = Boolean(
      customerFull?.contacted ||
      customerFull?.last_contact_at ||
      (customerFull?.status && String(customerFull.status).startsWith('contactado')) ||
      Number(customerFull?.total_orders) > 0 ||
      messageType.includes('Seguimiento') ||
      messageType.includes('Recordatorio') ||
      messageType.includes('Oferta')
    );

    let openingStrategy = '';
    if (promoProductOrCombo) {
      openingStrategy = `
ESTRUCTURA DE APERTURA: OFERTA DIRECTA DE PRODUCTO / DISPONIBILIDAD INMEDIATA
El mensaje gira 100% en torno a la cotización y despacho del producto/combo seleccionado: "${promoProductOrCombo.name || promoProductOrCombo.title}".
1. Saludo: "{Hola|Buen día|Un gusto saludarle} {contacto o empresa} 👋, un cordial saludo."
2. Apertura directa: "{Le saluda|Le escribe} *${sellerName}* de *JJ Paper C.A.* Conociendo la alta demanda de insumos en sus operaciones de ${city || 'Caracas'}, hoy queríamos compartirle disponibilidad inmediata y precio preferencial en: *${promoProductOrCombo.name || promoProductOrCombo.title}*."
3. Presentar este producto como primer ítem destacado con su precio exacto ($${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0).toFixed(2)} USD / Bs a tasa BCV ${rate.toFixed(2)} Bs) y sumar 2 insumos complementarios de su rubro.
4. ¡PROHIBIDO decir "vinimos a presentarnos" o redactar una carta introductoria general!`;
    } else if (messageType.includes('Seguimiento') || isAlreadyContacted) {
      openingStrategy = `
ESTRUCTURA DE APERTURA: SEGUIMIENTO COMERCIAL (ESTA CUENTA YA FUE CONTACTADA ANTERIORMENTE)
¡ATENCIÓN CRÍTICA! Esta empresa YA RECIBIÓ una presentación previa de JJ Paper. ¡ESTRICTAMENTE PROHIBIDO VOLVER A PRESENTARSE DESDE CERO! Prohibido decir "vinimos a presentarnos", "le escribimos para darnos a conocer", etc.
1. Saludo: "{Hola|Buen día|Un gusto saludarle de nuevo} {contacto o empresa} 👋. Esperamos que todo marche excelente en sus operaciones."
2. Reconocimiento de seguimiento: "{Le saluda atentamente|Le escribe nuevamente} *${sellerName}* de *JJ Paper C.A.* En seguimiento a nuestra propuesta anterior / Quería consultarles brevemente cómo se encuentran de stock e insumos para sus sedes esta semana."
3. Propuesta de abastecimiento: "{Pensando en sus requerimientos de reposición continua|Para apoyar la logística de ${companyName}}, tenemos despacho garantizado en 24h en:" presentar 3 insumos de alta rotación para su sector con precio exacto en USD y Bs a tasa BCV ${rate.toFixed(2)} Bs.
4. Cierre: "{¿Tienen algún requerimiento o cotización abierta esta semana en la que podamos apoyarles?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su entrega.}"`;
    } else if (messageType.includes('Recordatorio')) {
      openingStrategy = `
ESTRUCTURA DE APERTURA: RECORDATORIO DE REPOSICIÓN OPERATIVA
1. Saludo: "{Hola|Buen día} {contacto o empresa} 👋, un cordial saludo."
2. Recordatorio directo: "{Le saluda|Le escribe} *${sellerName}* de *JJ Paper C.A.* Pasamos por aquí brevemente para coordinar la reposición de papelería, consumibles de caja y embalaje para ${companyName} de esta quincena."
3. 3 insumos clave para reposición con precio BCV ${rate.toFixed(2)} Bs.
4. Cierre: "{¿Nos indica qué insumos requieren reponer esta semana para procesar su cotización formal?|¿Desea que le confirmemos despacho para mañana?}"`;
    } else if (messageType.includes('Oferta')) {
      openingStrategy = `
ESTRUCTURA DE APERTURA: OFERTA RELÁMPAGO / CONDICIONES PREFERENCIALES
1. Saludo: "{Hola|Buen día|Un gusto saludarle} {contacto o empresa} 👋."
2. Oportunidad: "{Le escribe|Le saluda} *${sellerName}* de *JJ Paper C.A.* Queríamos compartirle una oportunidad de abastecimiento mayorista con entrega prioritaria para ${companyName}:"
3. 3 productos destacados con precio especial en USD y Bs a tasa BCV ${rate.toFixed(2)} Bs.`;
    } else {
      openingStrategy = `
ESTRUCTURA DE APERTURA: PRESENTACIÓN COMERCIAL INSTITUCIONAL (PRIMER CONTACTO - CUENTA NUEVA)
1. Saludo: "{Hola|Buen día|Un gusto saludarle} {contacto o empresa} 👋, un cordial saludo."
2. Presentación institucional: "{Le escribe|Le saluda} *${sellerName}* de *JJ Paper C.A.*, su distribuidor mayorista de papelería corporativa, consumibles de caja y embalaje en Caracas. {Le contactamos|Nos acercamos} con el propósito de abastecer cada necesidad operativa de ${companyName} con entrega en 24h, precios de distribuidor y facturación formal legal."
3. 3 productos acordes a su giro de negocio con precio exacto en USD y Bs a tasa BCV ${rate.toFixed(2)} Bs.`;
    }

    const sys = getBusinessContext() + `
Eres el Director y Estratega Comercial B2B Sénior de "JJ Paper C.A." en Caracas, Venezuela.
Tu objetivo es analizar minuciosamente el perfil corporativo de un cliente o prospecto B2B y desarrollar una propuesta de abordaje comercial hiper-personalizada, de alta conversión y con variaciones anti-bloqueo.

OBJETIVO CRÍTICO: CADA CLIENTE DEBE RECIBIR UN MENSAJE ÚNICO, HUMANO Y 100% ADAPTADO A SU REALIDAD Y SECTOR OPERATIVO. PROHIBIDO GENERAR MENSAJES GENÉRICOS O USAR LA FRASE "estimado cliente".

${openingStrategy}
REGLAS DE REDACCIÓN OBLIGATORIAS:
- Negritas *...* SOLO para títulos de sección, nombres de productos y precios. Nunca en oraciones completas.
- Ortografía impecable: comas, puntos, tildes y redacción fluida y natural.
- Separaciones con doble salto de línea (\\n\\n) entre cada bloque para que el mensaje respire.
- Emojis dosificados (máximo 1 por bloque) para separar ideas: 👋, 📦, 📄, 💲, 🚚, 👉, ✨.
- Párrafos cortos (máximo 2 líneas por párrafo). Prohibido bloques de texto gigantes.
- PROHIBIDO citar etiquetas técnicas ("Core 1", "Core 2", "Cross-sell") o inventar productos/precios: usa únicamente la CATÁLOGO REAL.

PORTAFOLIO INTEGRAL Y CAPACIDADES DE JJ PAPER:
1. Consumibles POS y Cajas: Rollos térmicos para puntos de venta y cajas fiscales (80x70mm, 80x80mm, 57x40mm, 57x30mm), marcadores detectores de billetes falsos Kores, almohadillas dactilares.
2. Papelería y Archivo Reglamentario: Resmas de papel Bond (Carta, Oficio, Extra Oficio 75g y 80g HP/Report/Chamex), carpetas de fibra marrón con gancho, carpetas manila, archivadores de palanca (lomo ancho y fino con cantoneras metálicas para resguardo a 10 años), sobres manila (14x17 radiografía, extra oficio, carta), separadores y cajas de archivo.
3. Embalaje, Almacén y Logística: Cintas de embalaje transparente y marrón de alto micraje (48mm x 50m / 100m / 200m extra adherencia), tirro carrocero, dispensadores tipo pistola, exactos/cutters de alta resistencia, marcadores industriales indelebles (Sharpie, Expo, Kores, Servicio 80), sobres packing list.
4. Oficina, Administración y RRHH: Bolígrafos por caja (Bic, Solita, Sabonis, Kores), resaltadores, grapadoras metálicas, grapas 26/6, perforadoras 2 y 3 huecos, binder clips, tijeras de acero, notas adhesivas Post-it.
5. Productos de Limpieza y Mantenimiento Institucional: Desinfectantes, cloro, detergentes, papel higiénico institucional, toallas intercaladas y dispensadores.
6. Servicio Especial de Búsqueda y Adquisición: Si la empresa requiere cualquier producto, insumo o papelería especial que no esté actualmente en la lista de precios, JJ Paper se lo consigue y gestiona directamente para su total comodidad.

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
   ${officialPdfIncluded ? '📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* (+900 productos disponibles para entrega inmediata).' : ''}
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
   - "Le adjuntamos a este correo nuestra lista de precios oficial con más de 900 artículos disponibles para entrega inmediata."
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
DATOS DEL CLIENTE A ANALIZAR:
- Empresa: "${companyName}"
- Sector reportado: "${sector || 'No especificado'}"
- Contacto: "${contactName || 'No indicado'}"
- Cargo / Departamento: "${contactRole || 'No indicado'}"
- Dirección / Sede: "${address || 'Caracas, Venezuela'}"
- Ciudad: "${city || 'Caracas'}"
- Notas previas / Intereses: "${notes || 'Ninguna nota previa'}"

CONFIGURACIÓN DE REDACCIÓN SELECCIONADA POR EL ASESOR:
- Tono / Personalidad del Prospecto: "${personality}" (Adapta tu nivel de confianza, formalidad y psicología de ventas a este perfil).
- Tipo de Mensaje: "${messageType}" (Si es Seguimiento/Recordatorio, ajusta la apertura asumiendo que ya se le contactó antes. Si es Presentación/Bienvenida, preséntate como el primer contacto).

HISTORIAL DE COMPRAS EN JJ PAPER:
${histTxt}

CATÁLOGO REAL DISPONIBLE (USA EXCLUSIVAMENTE ESTOS PRODUCTOS CON SUS PRECIOS EXACTOS; PROHIBIDO INVENTAR PRODUCTOS O MONTOS QUE NO APAREZCAN AQUÍ):
${realProdInfo}

FLUJO DE ANÁLISIS OBLIGATORIO:
1. LEE al cliente: analiza nombre, sector, notas, ciudad e historial para determinar con precisión a qué se dedica.
2. DEDUCE su giro y su punto de dolor operativo (ej: negocio de caja → rollos térmicos POS y detectores de billetes; clínica → sobres radiografía 14x17 y carpetas de historias médicas; colegio → resmas y marcadores de pizarra; logística → cintas industriales y marcadores indelebles).
3. OFRECE exactamente 3 productos de la CATÁLOGO REAL alineados con ese giro (máximo 1 de apoyo), siempre con su precio exacto en USD y su equivalente en Bs a Tasa Oficial BCV.
4. REDACTA el mensaje final respetando estrictamente el FORMATO DE PRESENTACIÓN OBLIGATORIO del system prompt.

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

      const defBody = `${salutation}\n\nEs un placer saludarle desde JJ Paper C.A. Entendemos la alta exigencia diaria que demanda la operación y logística de sus sedes en ${city || 'Caracas'}, donde la disponibilidad oportuna de suministros resulta indispensable.\n\nCon el propósito de garantizar la continuidad de sus operaciones y optimizar sus costos de procura, ponemos a su disposición nuestro suministro directo en insumos de alta rotación:\n${bullet1}\n${bullet2}\n${bullet3}\n\nBeneficios de operar con JJ Paper:\n- Le adjuntamos a este correo nuestra lista de precios oficial con más de 900 artículos disponibles para entrega inmediata.\n- Cotizaciones inmediatas en segundos adaptadas a su presupuesto.\n- Servicio de Delivery gratuito en Caracas directamente en su sede o centro de distribución.\n- Facturación fiscal formal con RIF (J-295375450) en bolívares a tasa oficial BCV del día.\n\nLe invitamos a revisar la lista adjunta. Si nos indica qué requerimiento tienen abierto esta semana, con gusto le enviaremos la cotización formal en minutos.\n\nAtentamente,\n\n${sellerName}\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sellerPhone}\nCaracas, Venezuela`;

      const words = defBody.trim().split(/\s+/).length;

      const waGreeting = contactName
        ? `{Hola|Buen día|Un gusto saludarle} ${contactName} 👋, un cordial saludo.`
        : (contactRole
            ? `{Hola|Buen día} ${contactRole} de ${companyName} 👋, un cordial saludo.`
            : `{Hola|Buen día|Un gusto saludarle} estimados amigos de ${companyName} 👋, un cordial saludo.`);

      const fallbackWa = `${waGreeting}\n\n{Le escribe|Le saluda} *${sellerName}* de *JJ Paper C.A.* Somos distribuidores mayoristas de papelería corporativa, consumibles de caja y embalaje en Caracas.\n\nPensando en la continuidad de sus operaciones, ponemos a su disposición disponibilidad inmediata en:\n\n*📦 PROPUESTA DE ABASTECIMIENTO OPERATIVO:*\n${bullet1}\n${bullet2}\n${bullet3}\n\n${officialPdfIncluded ? '📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.\n\n' : ''}*VENTAJAS DE OPERAR CON JJ PAPER:*\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal con RIF (J-295375450)* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones formales en segundos* adaptadas a su requerimiento.\n\n👉 Puede revisar nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le preparemos una cotización formal para su empresa?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sellerName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sellerPhone}\nCaracas, Venezuela`;

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
    sellerName = 'Tu Asesor',
    sellerPhone = '',
    promoProductOrCombo = null,
    officialPdfIncluded = true,
    personality = 'Profesional / Formal',
    messageType = 'Presentación Inicial',
    forceRefresh = false
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const sName = sellerName || w.CURRENT_PROFILE?.full_name || w.CURRENT_PROFILE?.name || 'Keyder José Salazar';
    const sPhone = sellerPhone || w.CURRENT_PROFILE?.phone || '0412-4676073';

    const isAlreadyContacted = Boolean(
      customer.contacted ||
      customer.last_contact_at ||
      (customer.status && String(customer.status).startsWith('contactado')) ||
      Number(customer.total_orders) > 0 ||
      messageType.includes('Seguimiento') ||
      messageType.includes('Recordatorio') ||
      messageType.includes('Oferta')
    );

    // Si no se fuerza refresco y no hay promoción específica seleccionada, reutilizar si ya tiene copy guardado
    // EXCEPCIÓN VITAL: Si el contacto ya fue contactado, NO reutilizar un copy de presentación guardado previamente
    if (!forceRefresh && !promoProductOrCombo && !isAlreadyContacted) {
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

    // Adaptación dinámica de enfoque si la cuenta ya fue alcanzada o hay producto activo
    let effectiveMessageType = messageType;
    let effectivePersonality = personality;
    if (promoProductOrCombo) {
      effectiveMessageType = 'Oferta Especial';
      effectivePersonality = 'Persuasivo / Comercial';
    } else if (isAlreadyContacted && (messageType === 'Presentación Inicial' || messageType === 'presentacion')) {
      effectiveMessageType = 'Seguimiento de Contacto Previo';
      effectivePersonality = 'Cercano / Cordial';
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
      const histParts = [];
      if (Number(customer.total_orders) > 0) {
        histParts.push(`${customer.total_orders} pedido(s) registrados por $${Number(customer.total_usd || 0).toFixed(2)} USD de compra acumulada`);
        if (customer.last_order_at) histParts.push(`último pedido: ${customer.last_order_at}`);
      } else {
        histParts.push('Sin compras registradas (cliente nuevo o prospecto sin historial)');
      }
      const orderHistory = histParts.join(' · ');

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
        channel,
        customerFull: customer,
        orderHistory,
        personality: effectivePersonality,
        messageType: effectiveMessageType
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
      return generateHeuristicCustomerMessage({ customer, channel, sName, sPhone, rate, promoProductOrCombo, officialPdfIncluded, isAlreadyContacted });
    }
  }



  function generateHeuristicCustomerMessage({
    customer = {},
    channel = 'whatsapp',
    sName = 'Keyder José Salazar',
    sPhone = '0412-4676073',
    rate = 40,
    promoProductOrCombo = null,
    officialPdfIncluded = true,
    isAlreadyContacted = false
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
      ? `📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* con más de 900 artículos disponibles para despacho inmediato.\n\n`
      : '';

    const subject = promoProductOrCombo
      ? `📦 Oferta Especial en ${promoProductOrCombo.name} — JJ Paper C.A.`
      : (isAlreadyContacted ? `🤝 Seguimiento Operativo y Reposición para ${custName} — JJ Paper C.A.` : `📋 Abastecimiento Operativo y Lista de Precios Oficial para ${custName} — JJ Paper C.A.`);

    let body = '';
    if (isEmail) {
      if (promoProductOrCombo) {
        body = `{Estimado(a)|Apreciado(a)|Hola} ${custName},\n\nEsperamos que todo marche excelente en sus operaciones. Le saluda cordialmente *${sName}* de *JJ Paper C.A.* Conociendo la continua actividad de sus sedes en ${customer.city || 'Caracas'}, hoy queríamos compartirle disponibilidad inmediata y condiciones comerciales preferenciales en:\n\n*📦 OFERTA DE PRODUCTO DESTACADO:*\n${bulletPoints}\n\n${pdfMention}*VENTAJAS INSTITUCIONALES DE JJ PAPER:*\n• 🏢 *Distribución integral*: Papelería corporativa, consumibles de oficina, insumos de caja/facturación y artículos de limpieza.\n• 🔍 *Servicio de abastecimiento especial*: Si requiere cualquier producto que no esté en nuestra lista de precios, nosotros se lo conseguimos y gestionamos directamente.\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n\n👉 Puede explorar también nuestro catálogo digital en línea aquí:\n{{link}}\n\n{¿Desea que le confirmemos disponibilidad para su despacho de esta semana?|¿Gusta que le reservemos inventario de este producto para su empresa?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sPhone}\nCaracas, Venezuela`;
      } else if (isAlreadyContacted) {
        body = `{Estimado(a)|Apreciado(a)|Hola} ${custName},\n\nEsperamos que todo marche excelente en sus operaciones. Le saluda nuevamente *${sName}* de *JJ Paper C.A.* En seguimiento a nuestra comunicación previa, queríamos consultarles brevemente cómo se encuentran de stock e insumos para sus sedes esta semana.\n\nSomos distribuidores mayoristas de papelería corporativa, consumibles de oficina, insumos de caja y productos de limpieza. Además, *si requiere algún insumo especial que no visualice en nuestra lista de precios, nosotros se lo conseguimos y gestionamos directamente* para su total comodidad.\n\n*📦 PROPUESTA DE REPOSICIÓN OPERATIVA:*\n${bulletPoints}\n\n${pdfMention}*VENTAJAS INSTITUCIONALES DE JJ PAPER:*\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones formales inmediatas* en segundos adaptadas a su presupuesto.\n\n👉 Puede explorar también nuestro catálogo digital en línea aquí:\n{{link}}\n\n{¿Tienen algún requerimiento o cotización abierta esta semana en la que podamos apoyarles?|¿Gusta que le reservemos inventario para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sPhone}\nCaracas, Venezuela`;
      } else {
        body = `{Estimado(a)|Apreciado(a)|Hola} ${custName},\n\nEsperamos que todo marche excelente en sus operaciones. Le escribe atentamente *${sName}*, asesor comercial de *JJ Paper C.A.* en Caracas, su distribuidor mayorista de papelería corporativa, consumibles de oficina, insumos de caja/facturación y productos de limpieza institucional. Además, *si requiere cualquier otro producto que no esté en la lista de precios, nosotros se lo conseguimos directamente* para apoyar la continuidad operativa de *${custName}*.\n\nEn atención a ese compromiso, ponemos a su entera disposición condiciones preferenciales de suministro directo:\n\n*📦 PROPUESTA DE ABASTECIMIENTO:* \n${bulletPoints}\n\n${pdfMention}*VENTAJAS INSTITUCIONALES DE JJ PAPER:*\n• 🚚 *Delivery directo y gratuito* a su sede en Caracas / envíos protegidos a nivel nacional.\n• 🧾 *Facturación fiscal legal* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones formales inmediatas* en segundos adaptadas a su presupuesto.\n\n👉 Puede explorar también nuestro catálogo digital en línea aquí:\n{{link}}\n\n{¿Desea que le elaboremos una cotización formal para su empresa?|¿Gusta que le reservemos inventario para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su requerimiento.}\n\nAtentamente,\n\n*${sName}*\nDirección Comercial | JJ Paper C.A.\nTeléfono / WhatsApp: ${sPhone}\nCaracas, Venezuela`;
      }
    } else {
      if (promoProductOrCombo) {
        body = `{Hola|Buen día|Un gusto saludarle} ${custName} 👋, un cordial saludo.\n\n{Le saluda|Le escribe} *${sName}* de *JJ Paper C.A.* Conociendo la rotación de insumos en su empresa, hoy le contactamos para compartirle disponibilidad inmediata y precio preferencial en: *${promoProductOrCombo.name}* ($${Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0).toFixed(2)} USD / Tasa BCV ${rate.toFixed(2)} Bs).\n\nPensando en su abastecimiento continuo, contamos con despacho prioritario en:\n\n*📦 PRODUCTOS Y COMPLEMENTOS:*\n${bulletPoints}\n\n${pdfMention}*NUESTRO SERVICIO INCLUYE:*\n• 🏢 *Portafolio integral*: Papelería, consumibles de oficina, insumos de caja y limpieza.\n• 🔍 *Búsqueda a medida*: Si necesita un producto que no esté en la lista, se lo conseguimos.\n• 🚚 *Despacho gratuito* en Caracas directo a su sede.\n• 🧾 *Facturación fiscal formal* calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n\n👉 Puede chequear nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le reservemos disponibilidad para despacho mañana?|¿Requiere que le preparemos la cotización formal de este producto?|Quedo a su disposición para coordinar su pedido.}\n\nAtentamente,\n*${sName}* | Teléfono/WhatsApp: ${sPhone}\nJJ Paper C.A.`;
      } else if (isAlreadyContacted) {
        body = `{Hola|Buen día|Un gusto saludarle de nuevo} ${custName} 👋, un cordial saludo.\n\n{Le saluda atentamente|Le escribe nuevamente} *${sName}* de *JJ Paper C.A.* En seguimiento a nuestra comunicación previa, queríamos consultarles cómo están de inventario e insumos para sus sedes esta semana.\n\nSomos distribuidores mayoristas de papelería, consumibles de oficina, insumos de caja y limpieza. Si requiere cualquier producto especial que no esté en nuestra lista de precios, nosotros se lo conseguimos y gestionamos directamente.\n\n*📦 INSUMOS DE ALTA ROTACIÓN:*\n${bulletPoints}\n\n${pdfMention}*NUESTRO SERVICIO INCLUYE:*\n• 🚚 *Despacho gratuito* en Caracas directo a su sede.\n• 🧾 *Facturación fiscal formal* calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones al instante* y atención personalizada.\n\n👉 Puede chequear nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Tienen algún requerimiento que deseen cotizar esta semana?|¿Desea que le confirmemos despacho para mañana?|Quedo a su entera orden para apoyarles.}\n\nAtentamente,\n*${sName}* | Teléfono/WhatsApp: ${sPhone}\nJJ Paper C.A.`;
      } else {
        body = `{Hola|Buen día|Un gusto saludarle} ${custName} 👋, un cordial saludo.\n\n{Le escribe|Le saluda} *${sName}* de *JJ Paper C.A.*, su distribuidor mayorista de papelería corporativa, consumibles de oficina, insumos de caja/facturación y productos de limpieza en Caracas. Además, *si requiere cualquier otro producto que no esté en la lista de precios, nosotros se lo conseguimos directamente* para asegurar el abastecimiento de su empresa.\n\nPensando en esa demanda diaria, ponemos a su disposición disponibilidad inmediata en:\n\n*📦 INSUMOS DE ALTA ROTACIÓN:*\n${bulletPoints}\n\n${pdfMention}*NUESTRO SERVICIO INCLUYE:*\n• 🚚 *Despacho gratuito* en Caracas directo a su sede.\n• 🧾 *Facturación fiscal formal* calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• ⚡ *Cotizaciones al instante* y atención personalizada.\n\n👉 Puede chequear nuestro catálogo digital completo aquí:\n{{link}}\n\n{¿Desea que le verifiquemos disponibilidad para su pedido?|¿Requiere que le preparemos una cotización formal para su empresa?|Quedo a su disposición para apoyarle en lo que necesite.}\n\nAtentamente,\n*${sName}* | Teléfono/WhatsApp: ${sPhone}\nJJ Paper C.A.`;
      }
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
    attitude = 'presentacion',
    onProgress = null
  }) {
    const results = [];
    const total = customers.length;
    let completed = 0;

    // Mapeo de la actitud seleccionada a perfil psicológico y apertura
    let personality = 'Profesional / Formal';
    let messageType = 'Presentación Inicial';
    if (promoProductOrCombo) {
      personality = 'Persuasivo / Comercial';
      messageType = 'Reactivación / Oferta Especial';
    } else if (attitude === 'seguimiento') {
      personality = 'Cercano / Cordial';
      messageType = 'Seguimiento de Contacto Previo';
    } else if (attitude === 'recordatorio') {
      personality = 'Directo / Ejecutivo';
      messageType = 'Recordatorio de Insumos';
    } else if (attitude === 'oferta') {
      personality = 'Persuasivo / Comercial';
      messageType = 'Reactivación / Oferta Especial';
    }

    // Procesar en chunks de 3 en paralelo con pool balanceado de 7 API keys
    const CONCURRENCY = 3;
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
            personality,
            messageType,
            forceRefresh
          });
          completed++;
          if (typeof onProgress === 'function') {
            await onProgress({ current: completed, total, customer: cust, result: analysis });
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
            await onProgress({ current: completed, total, customer: cust, result: fallbackAnalysis });
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

    // AI Wholesale-to-Retail Interpretation
    let optimizedSearchQuery = productName;
    try {
      if (typeof callGemini === 'function') {
        const sys = `Eres un experto analista de catálogo de JJ Paper. TRADUCE nombres de inventario mayorista a términos de búsqueda limpios para buscar imágenes en Google.
REGLAS ESTRICTAS:
- Limita tu universo a: Papelería, Artículos de Oficina, Limpieza, Escolares.
- Elimina cantidades (ej. "3 por 12", "Caja 12", "Docena", "PQTE", "CJA").
- TRADUCE TÉRMINOS MAYORISTAS:
  * "Goma en barra" -> Pega en barra
  * "Goma de borrar" -> Borrador Nata
  * "Papel R Bont" -> Resma de Papel Bond
  * "Papel R fotocopia" -> Resma de papel
  * "Marcador resalta" -> Marcador resaltador
- Devuelve SOLO el nombre limpio comercial, la marca y el color (si lo tiene). Ejemplo: "Marcador resaltador amarillo Expo". NADA MÁS.`;
        const translated = await callGemini({ prompt: `Traduce a término de búsqueda comercial exacto: "${productName}"`, systemInstruction: sys, temperature: 0.1 });
        if (translated && !translated.includes('Error') && translated.length < 50) {
           optimizedSearchQuery = translated.replace(/^["'`]|["'`]$/g, '').trim();
        }
      }
    } catch (_) {}
    
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
        `/api/search-images?q=${encodeURIComponent(optimizedSearchQuery)}`,
        `/lan/products/search-images?q=${encodeURIComponent(optimizedSearchQuery)}`
      ];
      if (loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1' && /^(192\.168\.|10\.|172\.)/.test(loc.hostname)) {
        urlsToTry.push(`${loc.protocol}//${loc.hostname}:8787/lan/products/search-images?q=${encodeURIComponent(optimizedSearchQuery)}`);
      }
      if (loc.protocol === 'http:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
        urlsToTry.push(`http://localhost:8787/lan/products/search-images?q=${encodeURIComponent(optimizedSearchQuery)}`);
        urlsToTry.push(`http://127.0.0.1:8787/lan/products/search-images?q=${encodeURIComponent(optimizedSearchQuery)}`);
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
        const sys = 'You are an expert commercial advertising packshot photographer specializing ONLY in physical office supplies, stationery, and retail packaging.';
        const q = `Translate this Venezuelan stationery product title into a clear, professional 1-sentence English retail packshot description: "${name}".
Brand: ${brand || 'standard'}
Color: ${color || 'standard'}
Format/Specs: ${measures || 'standard'}
Packaging/Presentation: ${presentation || 'standard'}

CRITICAL PHOTO GUIDELINES (STRICT NEGATIVE PROMPT):
- BE LITERAL. If the product is a "Carpeta Manila", it means "Manila folder (stationery file folder)". If it says "oficio" it means "legal size paper format". 
- DO NOT under any circumstance mention or describe video games (like Assassin's Creed), fictional characters, weapons, clothing, rooms, or people.
- ONLY describe the physical office supply object itself and its packaging (e.g. "retail hanging blister card with euro-slot of stainless steel office scissors, blue rubber grip").
- If the item is ambiguous, default to basic office stationery.
Respond with ONLY the 1 English sentence describing the object.`;
        const translated = await callGemini({ prompt: q, systemInstruction: sys, temperature: 0.1 });
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

    const photoPrompt = `Commercial retail packshot of ${englishSubject}, office supplies and stationery product, NO PEOPLE, NO CHARACTERS, isolated centered front hero angle, ${bgPrompt}, crisp pristine packaging condition, razor-sharp focus on branding typography, professional commercial advertising photography, 8k uhd`;

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
    theme = 'white', // 'emerald' | 'white'
    headline = '',
    canvas = null
  }) {
    // Rediseñado para generar SOLO LA FOTOGRAFÍA ESTUDIO del producto, 800x800px.
    // Sin textos publicitarios ni precios ("flyer"), por solicitud del usuario, para uso directo en catálogo.
    const cvs = canvas || document.createElement('canvas');
    cvs.width = 800;
    cvs.height = 800;
    const ctx = cvs.getContext('2d');

    const isWhite = (theme === 'white');

    // 1. Fondo Estudio Fotográfico 800x800
    if (isWhite) {
      const whiteGrad = ctx.createLinearGradient(0, 0, 0, 800);
      whiteGrad.addColorStop(0, '#FFFFFF');
      whiteGrad.addColorStop(0.65, '#FFFFFF');
      whiteGrad.addColorStop(1, '#F1F5F9');
      ctx.fillStyle = whiteGrad;
      ctx.fillRect(0, 0, 800, 800);

      const softGlow = ctx.createRadialGradient(400, 400, 50, 400, 400, 380);
      softGlow.addColorStop(0, 'rgba(241, 245, 249, 0.9)');
      softGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = softGlow;
      ctx.fillRect(0, 0, 800, 800);
    } else {
      const bgGrad = ctx.createLinearGradient(0, 0, 0, 800);
      bgGrad.addColorStop(0, '#062017');
      bgGrad.addColorStop(0.5, '#0B3327');
      bgGrad.addColorStop(1, '#020F0A');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 800, 800);

      const radialGlow = ctx.createRadialGradient(400, 400, 40, 400, 400, 350);
      radialGlow.addColorStop(0, 'rgba(22, 96, 74, 0.6)');
      radialGlow.addColorStop(0.65, 'rgba(16, 185, 129, 0.15)');
      radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, 800, 800);
    }

    // 2. EL ESCENARIO CENTRAL DEL PRODUCTO
    const stageCenterX = 400;
    const stageCenterY = 400;
    const maxImgW = 660;
    const maxImgH = 660;

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
        console.warn('Fallo búsqueda de foto real para fotografía comercial:', e);
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
          console.warn('No se pudo pregenerar foto de estudio:', e);
        }
      }
    }

    if (imgToLoad) {
      try {
        let img = await loadImageSafe(imgToLoad);
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
          const scale = Math.min(maxImgW / img.width, maxImgH / img.height, 1);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const dx = stageCenterX - dw / 2;
          const dy = stageCenterY - dh / 2;

          // Sombra de contacto
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

          ctx.drawImage(img, dx, dy, dw, dh);
          imageRendered = true;
        }
      } catch (err) {
        console.warn('Fallo cargando imagen en renderProductCard:', err);
      }
    }

    if (!imageRendered) {
      // Si todo falla, dibujar un cuadro genérico 3D de producto
      renderCommercial3dProduct(ctx, product, stageCenterX, stageCenterY, isWhite);
    }

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

  /**
   * --------------------------------------------------------------------------
   * 15. Parser y Pre-armador Inteligente de Cotizaciones con IA
   * Analiza correos o WhatsApps entrantes, extrae cliente e ítems y genera acuse
   * --------------------------------------------------------------------------
   */
  async function parseQuoteRequest(rawText, catalog = []) {
    if (!rawText || !rawText.trim()) throw new Error('El texto de la solicitud está vacío.');

    const prompt = `Actúa como el cotizador inteligente y analista comercial senior de JJ Paper C.A. (distribuidora mayorista de papelería, consumibles de oficina y embalaje en Caracas, Venezuela).

El usuario te entrega el TEXTO CRUDO de una solicitud de cotización recibida de un cliente por Correo Electrónico o WhatsApp.

TU MISIÓN:
1. Extraer los datos del cliente si existen en el texto:
   - "client_name": Nombre de la empresa o cliente (o null si no se menciona).
   - "rif": RIF venezolano (J-, V-, G-, E-) si aparece (o null).
   - "contact": Persona de contacto / solicitante (o null).
   - "phone": Teléfono (o null).
   - "email": Correo (o null).
   - "city": Ciudad o sede (por defecto "Caracas" si no se indica).

2. Extraer la lista de productos solicitados ("items"):
   - "raw_query": El texto exacto como lo pidió el cliente (ej: "20 resmas de papel carta Report").
   - "product_name": Nombre comercial estándar normalizado (ej: "Papel Fotocopia Carta 75g Report Resma").
     *APLICA ESTOS SINÓNIMOS VENEZOLANOS:*
     "tirro" = Cinta de Enmascarar / Masking Tape.
     "celoven" = Cinta Adhesiva Transparente.
     "tipex" = Corrector Líquido / Cinta Correctora.
     "resmas chamex / hp / report" = Papel Fotocopia Carta / Oficio 75g.
     "silicon liquido" = Pega Líquida de Silicón.
     "marcador acrilico" = Marcador para Pizarra Blanca.
     "hojas de examen" = Papel Ministro.
   - "qty": Cantidad numérica solicitada (ej: 20). Si no indica, asume 1.
   - "unit": Unidad deducida (resma, caja, unidad, rollo, paquete, docena, etc.).
   - "unit_type": ESTRUCTURA VITAL PARA EL PRECIO. Si el cliente pide bultos, embalajes mayores o cajas master, pon "bulk". Si pide empaques de consumo (resmas, paquetes, docenas, unidades, cajas pequeñas), pon "unit".
   - "notes": Especificación adicional si hay (color, marca, gramaje).

3. "cross_selling_ideas": Array de strings con 2 o 3 productos complementarios generales que deberíamos ofrecerle para aumentar la venta (ej: si pide papel, ofrecer grapas y carpetas; si pide cajas, ofrecer cinta de embalaje).

4. Generar un "ack_message" (Acuse de Recibo Inmediato y Profesional).

DEVUELVE ÚNICAMENTE UN JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA (SIN TEXTO ANTES NI DESPUÉS):
{
  "customer": {
    "client_name": "Nombre o null",
    "rif": "RIF o null",
    "contact": "Contacto o null",
    "phone": "Teléfono o null",
    "email": "Email o null",
    "city": "Caracas"
  },
  "items": [
    {
      "raw_query": "texto del cliente",
      "product_name": "nombre normalizado",
      "qty": 10,
      "unit": "unidad",
      "unit_type": "unit",
      "notes": ""
    }
  ],
  "cross_selling_ideas": ["Grapas 26/6", "Bolígrafos Azules"],
  "ack_message": "Texto del acuse de recibo..."
}

TEXTO CRUDO DE LA SOLICITUD DEL CLIENTE:
"""
${rawText}
"""`;

    const rawResponse = await callGemini(prompt, 'gemini-3.6-flash');
    let parsed;
    try {
      const cleaned = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const m = rawResponse.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('No se pudo estructurar la respuesta de la IA.');
    }

    if (Array.isArray(catalog) && catalog.length > 0 && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.map(it => {
        const query = (it.product_name || it.raw_query || '').toLowerCase();
        const requestedBulk = it.unit_type === 'bulk';
        let matched = null;
        let bestScore = 0;
        const words = query.split(/\s+/).filter(w => w.length > 2);

        for (const prod of catalog) {
          const prodName = (prod.name || '').toLowerCase();
          const prodUnit = (prod.unit || '').toLowerCase();
          const isBulkProduct = prodName.includes('bulto') || prodUnit.includes('bulto') || prodName.includes('master');
          
          // Fuerte penalización si la unidad no coincide con lo que pide
          if (!requestedBulk && isBulkProduct) continue; // Si no pide bulto, y es bulto, lo ignoramos de entrada
          if (requestedBulk && !isBulkProduct) continue; // Si pide bulto, y no es bulto, lo ignoramos

          let score = 0;
          for (const w of words) {
            if (prodName.includes(w)) score++;
          }
          
          if (score > bestScore) {
            bestScore = score;
            matched = prod;
          }
        }

        if (matched && bestScore >= 1) {
          return {
            ...it,
            matched: true,
            product_id: matched.id,
            catalog_name: matched.name,
            price_usd: matched.price_usd || matched.price_a || 0,
            price_a: matched.price_a || matched.price_usd || 0,
            price_b: matched.price_b || matched.price_usd || 0,
            unit: matched.unit || it.unit || 'unid',
            brand: matched.brand || (matched.jjp_brands?.name) || null
          };
        }
        return {
          ...it,
          matched: false,
          price_usd: 0
        };
      });
    }

    return parsed;
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
    parseProspectsText,
    parseQuoteRequest,
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
