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
    'gemini-2.5-pro',
    'gemini-pro-latest',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ];

  // Modelos ultrarrápidos para sugerencias en vivo en chat
  const FAST_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-3.5-flash'
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

          // Si es límite de cuota (429) o clave no autorizada (403), rotar de inmediato a la siguiente llave
          if (status === 429 || status === 403) {
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key límite excedido (${status}): ${errMsg}`);
            break; // Cambiar de llave
          }

          // Si el modelo específico está sobrecargado (503) o no encontrado (404), probar siguiente modelo
          if (status === 503 || status === 404) {
            lastError = new Error(`Modelo ${m} no disponible (${status}): ${errMsg}`);
            continue;
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
Eres el Copiloto Experto de Inteligencia Artificial y Estratega Comercial de "JJ Paper C.A." en Caracas, Venezuela.
- JJ Paper es una distribuidora líder mayorista y detal de papelería, útiles escolares, consumibles de oficina, computación y papelería corporativa.
- Catálogo principal: Resmas de papel Bond (Carta, Oficio, Extra Oficio de 75g y 80g), cuadernos (engrapados, doble espiral, cosidos), bolígrafos, marcadores, carpetas de fibra, archivadores, consumibles, tóner y embalaje.
- Tasa oficial BCV vigente: 1 USD = ${rate.toFixed(2)} Bs (todas las transacciones, presupuestos y facturas se calculan rigurosamente al cambio oficial del Banco Central de Venezuela).
- Asesor comercial activo: ${sellerName} ${sellerRef ? `(Código: ${sellerRef})` : ''}.
- Medios de pago: Dólares USD en efectivo, Zelle, Banesco Panamá, Bolívares por Pago Móvil y Transferencias bancarias nacionales al cambio BCV.
- Despachos: Entregas directas en Caracas con rutas diarias y envíos asegurados a toda Venezuela por Tealca, MRW y Zoom.
- Tono comercial: Altamente profesional, empático, ágil, consultivo, con impecable cordialidad comercial venezolana.
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
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
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
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
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
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      return {
        subject: `Cotización de Productos — JJ Paper C.A.`,
        body: `Estimado(a) ${toName || 'Cliente'},\n\nEs un placer saludarle desde JJ Paper C.A.\n\nEn atención a su solicitud, ponemos a su disposición nuestra cotización con los mejores precios del mercado y disponibilidad inmediata.\n\n${notes ? notes + '\n\n' : ''}Nuestras operaciones se calculan a tasa oficial BCV (${rate.toFixed(2)} Bs/USD). Contamos con despacho directo en Caracas y envíos nacionales.\n\nQuedamos a su entera disposición para procesar su pedido.\n\nAtentamente,\n${sellerName || 'Dpto. de Ventas'}\nJJ Paper C.A.`
      };
    }
  }

  /* --------------------------------------------------------------------------
     4. Búsqueda Rápida de Productos y Precios en Base de Datos (Tokenizada)
     -------------------------------------------------------------------------- */
  async function searchProductsLive(query, limit = 6) {
    const w = typeof window !== 'undefined' ? window : {};
    if (!query || query.trim().length < 2) return [];

    const q = query.trim().toLowerCase();
    const rawTokens = q.split(/\s+/).filter(t => t.length >= 2);
    const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'con', 'sin', 'por', 'marca', 'tipo', 'color', 'caja', 'paquete', 'pack', 'combo', 'und', 'unidad']);
    const tokens = rawTokens.filter(t => !STOPWORDS.has(t));
    const searchTokens = tokens.length > 0 ? tokens : rawTokens;
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

    // 1. Intentar primero desde la caché en memoria o sessionStorage del catálogo (0ms de latencia)
    let cachedList = null;
    if (Array.isArray(w.allProducts) && w.allProducts.length > 0) {
      cachedList = w.allProducts;
    } else {
      try {
        const stored = sessionStorage.getItem('jjp_products_cache_v4');
        if (stored) cachedList = JSON.parse(stored);
      } catch (_) {}
    }

    if (Array.isArray(cachedList) && cachedList.length > 0) {
      const scored = cachedList.map(p => {
        const variants = (p.jjp_product_variants || []).filter(v => v.active !== false);
        const brandNames = variants.map(v => v.jjp_brands?.name).filter(Boolean);
        const variantNames = variants.map(v => v.variant_name).filter(Boolean);
        const fullSearchText = `${p.name || ''} ${p.sku || ''} ${p.description || ''} ${brandNames.join(' ')} ${variantNames.join(' ')}`.toLowerCase();

        let matchCount = 0;
        searchTokens.forEach(t => {
          const stem = t.replace(/(?:es|s)$/i, '');
          if (fullSearchText.includes(t) || (stem.length >= 3 && fullSearchText.includes(stem))) {
            matchCount++;
          }
        });

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
          score: matchCount
        };
      });

      const filtered = scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      if (filtered.length > 0) return filtered;
    }

    // 2. Si no está en caché o no hubo resultados, consultar directamente a Supabase Core
    const client = (typeof sb !== 'undefined' ? sb : (w.sb || w.sbCore || w._rawSbCore));
    if (!client) return [];

    try {
      // Elegir el término más representativo y aplicar stem para no fallar por plurales
      const primary = searchTokens[0] || q;
      const stem = primary.replace(/(?:es|s)$/i, '');
      const searchPattern = stem.length >= 3 ? stem : primary;

      let req = client.from('jjp_products')
        .select(`
          id, name, sku, price_usd, unit, emoji, image_url, description, active,
          jjp_product_variants(id, variant_name, sku, price_usd, active, jjp_brands(name))
        `)
        .neq('active', false);

      req = req.or(`name.ilike.%${searchPattern}%,sku.ilike.%${searchPattern}%,description.ilike.%${searchPattern}%`);

      const { data, error } = await req.limit(Math.max(limit * 4, 25));
      if (error || !data) return [];

      const scored = data.map(p => {
        const variants = (p.jjp_product_variants || []).filter(v => v.active !== false);
        const brandNames = variants.map(v => v.jjp_brands?.name).filter(Boolean);
        const variantNames = variants.map(v => v.variant_name).filter(Boolean);
        const fullSearchText = `${p.name || ''} ${p.sku || ''} ${p.description || ''} ${brandNames.join(' ')} ${variantNames.join(' ')}`.toLowerCase();

        let matchCount = 0;
        searchTokens.forEach(t => {
          const s = t.replace(/(?:es|s)$/i, '');
          if (fullSearchText.includes(t) || (s.length >= 3 && fullSearchText.includes(s))) {
            matchCount++;
          }
        });

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
          score: matchCount
        };
      });

      return scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (e) {
      console.warn('Error buscando productos:', e);
      return [];
    }
  }

  /* --------------------------------------------------------------------------
     4.1. Generador de Plantillas Spintax Anti-Baneo para Campañas
     -------------------------------------------------------------------------- */
  async function generateCampaignSpintax(baseText, channel = 'whatsapp') {
    if (!baseText || !baseText.trim()) {
      throw new Error('Debes proporcionar un texto para convertir a Spintax.');
    }

    const sys = getBusinessContext() + `
Eres un especialista en copywriting comercial y prevención de bloqueos/anti-spam para envíos masivos por ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'}.
Tu misión es transformar el texto que el usuario te entrega en una plantilla de alto dinamismo utilizando Spintax sintáctico con la sintaxis {opción 1|opción 2|opción 3}.

REGLAS CRÍTICAS DE CONSTRUCCIÓN:
1. Aplica Spintax en saludos: {¡Hola!|Buen día|Estimado(a) cliente|Un cordial saludo}.
2. Aplica Spintax en llamadas a la acción y enganches comerciales: {tenemos para ti|te traemos|aprovecha nuestra oferta en|te presentamos}.
3. Aplica Spintax en el cierre: {¿Deseas que te reservemos?|¿Cuántas unidades necesitas cotizar?|Contáctanos para apartar tu pedido|Quedamos a tu orden}.
4. PRESERVA INTACTAS al 100% todas las variables encerradas en dobles llaves, exactamente como vengan (por ejemplo: {{nombre}}, {{empresa}}, {{vendedor}}, {{producto}}, {{precio}}, {{descuento}}, {{link}}). NO las traduzcas, NO las cambies, NO quites las dobles llaves.
5. Mantén enlaces, precios y datos numéricos intactos.
6. Devuelve ÚNICAMENTE el texto final resultante con Spintax y variables, sin explicaciones ni envoltorios markdown.`;

    const prompt = `Convierte este texto a formato Spintax anti-baneo:\n\n${baseText.trim()}`;

    try {
      const res = await callGemini({ prompt, systemInstruction: sys, temperature: 0.8 });
      return res.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    } catch (e) {
      console.warn('Fallback spintax:', e);
      if (!baseText.startsWith('{')) {
        return `{¡Hola!|Buen día|Saludos cordiales} ` + baseText;
      }
      return baseText;
    }
  }

  /* --------------------------------------------------------------------------
     4.2. Redactor Inteligente de Campañas Comerciales (WhatsApp y Email)
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

    const sys = getBusinessContext() + `
Eres el Director Creativo de Marketing y Copywriting Comercial de JJ Paper C.A.
Tu objetivo es redactar un mensaje publicitario o plantilla de altísima conversión para ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'}.

CRITERIOS COMERCIALES DE ALTA CONVERSIÓN:
1. Aplica principios de persuasión B2B (Gancho, Valor/Ahorro, Urgencia de stock, Facilidad de compra y Llamado a la acción claro).
2. Para WhatsApp: utiliza Spintax sintáctico {opción 1|opción 2|opción 3} en saludos, conectores y despedidas para evitar bloqueos por spam.
3. Para Email: genera un asunto ("subject") con gancho de apertura y un cuerpo ("body") estructurado con párrafos legibles, bullets (-) y firma institucional.
4. Conserva estrictamente variables dinámicas: {{nombre}}, {{empresa}}, {{vendedor}}, {{link}}, y si aplica: {{producto}}, {{precio}}, {{descuento}}, {{descripcion}}.
5. Resalta que las operaciones son al cambio oficial BCV (${rate.toFixed(2)} Bs/USD) con entregas rápidas en Caracas y envíos nacionales.

Devuelve EXACTAMENTE un objeto JSON válido (sin markdown exterior ni \`\`\`json):
- Si channel === 'email': { "subject": "...", "body": "..." }
- Si channel === 'whatsapp': { "body": "..." }
`;

    const prompt = `
Objetivo de campaña: ${objective}
Canal de difusión: ${channel}
Segmento de audiencia: ${audience}
Producto o Promoción: ${product ? `${product.name} (Precio: $${product.price_usd || product.final_price_usd || ''})` : 'Catálogo general mayorista de papelería'}
Descuento o Beneficio: ${discount || 'Precios directos de distribuidora'}
Notas / Instrucciones adicionales: ${customNotes || 'Enfocado en reposición de mercancía, despacho inmediato y ahorro'}
Asesor emisor: ${sellerName || 'Equipo de Ventas JJ Paper'}

Genera el mensaje en formato JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.72 });
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      if (channel === 'email') {
        return {
          subject: product ? `📦 Oportunidad Mayorista: ${product.name} — JJ Paper` : '📦 Lista de Precios y Ofertas Especiales — JJ Paper',
          body: `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nEsperamos que en {{empresa}} se encuentren muy bien. Le saluda atentamente {{vendedor}} de JJ Paper C.A.\n\nLe contactamos para presentarle nuestras mejores condiciones de despacho en ${product ? `*{{producto}}* con un precio exclusivo de *{{precio}}*` : 'papelería corporativa, útiles escolares y suministros de oficina al mayor'}.\n\n🔹 Precios directos al mayor en divisas o Bolívares a tasa oficial BCV (${rate.toFixed(2)} Bs).\n🔹 Despacho rápido en Caracas y envíos asegurados a nivel nacional.\n🔹 Emisión inmediata de notas de entrega y facturas fiscales.\n\n👉 Puede revisar catálogo y procesar su orden en línea:\n{{link}}\n\n{¿Desea que le apartemos mercancía o requiere una cotización formal?|Quedamos a su completa disposición para atender su requerimiento hoy mismo.}\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`
        };
      } else {
        return {
          body: `{¡Hola!|Buen día|Un cordial saludo} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\n{Tenemos excelentes ofertas hoy en|Aproveche disponibilidad inmediata en|Le presentamos nuestro precio mayorista en} ${product ? `*{{producto}}* por tan solo *{{precio}}*` : 'útiles escolares, resmas de papel y artículos de oficina'}.\n\n📦 Stock listo para entrega inmediata en Caracas y envíos a toda Venezuela.\n💲 Tasa oficial BCV: ${rate.toFixed(2)} Bs.\n\n👉 Revise el catálogo y ordene directamente aquí:\n{{link}}\n\n{¿Cuántas unidades o bultos desea cotizar?|¿Le reservamos su pedido para el despacho de hoy?}`
        };
      }
    }
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
    if (/resaltad|resalt\b|resalt\./i.test(rawName)) {
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
      productTypeEn = 'ballpoint pens in retail stationery packaging';
    } else if (/tirro|cinta.*embalaje/i.test(rawName)) {
      productTypeEn = 'roll of heavy duty packaging tape';
    } else if (/almohadilla.*dactilar|almohadilla/i.test(rawName)) {
      productTypeEn = 'stationery fingerprint stamp ink pad with protective case';
    } else if (/borrador.*pizarra/i.test(rawName)) {
      productTypeEn = 'ergonomic whiteboard magnetic eraser';
    }

    // Heurística de tipo de categoría interna
    let catType = 'general';
    if (/tirro|cinta|embalaje|adhesiv|teipe|mascarar/i.test(rawName)) catType = 'tape';
    else if (/resma|papel|bond|cuaderno|block|hojas|fotocopia/i.test(rawName)) catType = 'paper';
    else if (/grap|perforad|dispens|clip|tijera/i.test(rawName)) catType = 'stapler';
    else if (/boligrafo|marcador|lapiz|pluma|resaltador/i.test(rawName)) catType = 'writing';
    else if (/carpeta|sobre|archiv|funda/i.test(rawName)) catType = 'folder';

    const cleanTitle = rawName
      .replace(/\b[A-Z0-9_-]{7,}\b/g, '')
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
    if (brand) specDescriptors.push(`authentic brand ${brand} branded retail packaging`);
    if (color) specDescriptors.push(`${color} color theme`);
    if (measures) specDescriptors.push(`${measures} format`);
    if (presentation && presentation !== 'Unidad / Empaque Comercial') specDescriptors.push(presentation);

    const specsStr = specDescriptors.length > 0 ? `, ${specDescriptors.join(', ')}` : '';

    // Consultar a Gemini para obtener una descripción comercial en inglés ultra-precisa del empaque/producto
    let englishSubject = '';
    try {
      if (typeof callGemini === 'function') {
        const sys = 'You are an expert commercial product photographer cataloging stationery, school and office supplies.';
        const q = `Translate this Venezuelan stationery product title into a clear, professional 1-sentence English commercial retail packshot description: "${name}".
Brand: ${brand || 'standard'}
Color: ${color || 'standard'}
Format/Specs: ${measures || 'standard'}
Packaging/Presentation: ${presentation || 'standard'}
CRITICAL: Only describe the physical merchandise and its authentic commercial packaging (e.g. "box of 12 fluorescent neon pink chisel-tip highlighter markers, Shark brand packaging"). Do NOT describe any background, scenery, room, wall or table. Respond with ONLY the 1 English sentence.`;
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
      ? 'isolated object on pure solid white background #FFFFFF, crisp packshot product photography, studio lighting'
      : 'isolated object on solid luxury dark emerald green #0B3327 background, soft center spotlight, commercial product packshot';

    const photoPrompt = `Authentic commercial packshot product photography of ${englishSubject}. Centered hero merchandise, ${bgPrompt}, 8k resolution, razor-sharp focus, commercial advertising catalog photography, hyperrealistic. STRICT NEGATIVE PROMPT: no room, no floor, no walls, no cyclorama, no table, no furniture, no background scenery, no interior, no people, no hands, no text overlay, no watermark, no sku numbers, no mockups, no shadows on walls`;

    // 3. Generar la imagen fotorrealista en alta resolución (1024x1024)
    const seed = forceNew ? (Math.floor(Math.random() * 900000) + 100000) : (42000 + Math.abs(hashCode(name + theme)));
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(photoPrompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;

    const result = {
      imageUrl,
      prompt: photoPrompt,
      specs: enriched
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
    let imgToLoad = product._studio_photo_url || product.image_url;
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
    const displayTitle = rawName.replace(/\b[A-Z0-9_-]{7,}\b/g, '').replace(/\s+/g, ' ').trim();
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
    searchProductsLive,
    enrichProductForMarketing,
    generateProductStudioPhoto,
    askCopilot,
    renderProductCard,
    getCurrentKeyIndex: () => _keyIndex,
    getTotalKeys: () => GEMINI_KEYS.length
  };
});
