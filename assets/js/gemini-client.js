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
  // Pool oficial de 7 API Keys ordenadas por velocidad y latencia comprobada
  const GEMINI_KEYS = [
    'AQ.Ab8RN6IsSWjE9mHK9IRjNyauqgMLHLWLCJnwiEHU7Uo6sC0cNA',
    'AQ.Ab8RN6LOFt4ga-GPIkdVcDya_L2DSSrfqWTyPK3QSzM1e5pVfQ',
    'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
    'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E',
    'AQ.Ab8RN6I3nhWx1f54n5rcLa1nJv238N-IqJoIRWljUjZmg3nl-Q',
    'AQ.Ab8RN6K7DB2-YqkZma3jsV8EfCqHel0UnR07oY-r8qquxgKTsA',
    'AQ.Ab8RN6L0PS4XofEO8X9lbsE8P1sYD6jqItzCRvb0QbX1KvdEOw'
  ];

  // Modelos ultrarrápidos con latencia < 800ms
  const GEMINI_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
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

  /* --------------------------------------------------------------------------
     Llamada Base a la API con reintento automático ultrarrápido (timeout 3.5s)
     -------------------------------------------------------------------------- */
  async function callGemini({ prompt, systemInstruction = '', temperature = 0.7, maxTokens = 1500, model = null }) {
    _totalCalls++;
    const modelsToTry = model ? [model, ...GEMINI_MODELS.filter(m => m !== model)] : GEMINI_MODELS;
    let lastError = null;

    // Intentar a través de las 7 llaves si una falla por cuota o demora más de 3.5s
    for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
      const currentKey = GEMINI_KEYS[(_keyIndex + attempt) % GEMINI_KEYS.length];
      
      for (const m of modelsToTry) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

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
            _keyIndex = (_keyIndex + attempt) % GEMINI_KEYS.length; // Fijar en la llave exitosa
            return text.trim();
          }

          const status = res.status;
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody.error?.message || `HTTP ${status}`;

          // Si es límite de cuota (429) o servicio ocupado (503), rotar llave de inmediato
          if (status === 429 || status === 503 || status === 403) {
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key límite excedido (${status}): ${errMsg}`);
            break; // Salir de modelos para esta llave e ir a la siguiente llave del pool
          }

          // Si el modelo específico no está disponible, probar el siguiente modelo
          if (status === 404) {
            continue;
          }

          lastError = new Error(`Error en API (${status}): ${errMsg}`);
        } catch (netErr) {
          clearTimeout(timeoutId);
          lastError = netErr;
          break; // Error de red, aborto por timeout (>3.5s), probar siguiente llave
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
Eres el Copiloto de Inteligencia Artificial de "JJ Paper C.A." en Caracas, Venezuela.
- JJ Paper es una distribuidora mayorista y detal de papelería, útiles de oficina, escolares, computación y consumibles.
- Tasa oficial BCV vigente en el sistema: 1 USD = ${rate.toFixed(2)} Bs.
- Vendedor / Usuario activo: ${sellerName} ${sellerRef ? `(Código: ${sellerRef})` : ''}.
- Monedas aceptadas: Dólares USD en efectivo, Zelle, Transferencias Banesco Panamá, Bolívares por Pago Móvil y Transferencias al cambio BCV.
- Despachos: Entregas directas en Caracas y envíos a nivel nacional por Tealca, MRW y Zoom.
- Tono: Profesional, cordial, empático, comercial venezolano, respetuoso y muy ágil.
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
    if (!w.sb || !query || query.trim().length < 2) return [];
    try {
      const q = query.trim();
      const tokens = q.split(/\s+/).filter(t => t.length >= 2);
      const primary = tokens[0] || q;

      let req = w.sb.from('jjp_products')
        .select(`
          id, name, sku, price_usd, unit, emoji, image_url, description, active,
          jjp_product_variants(id, variant_name, sku, price_usd, active, jjp_brands(name))
        `)
        .neq('active', false);

      // Si hay una palabra clave principal, buscar por nombre, sku o descripcion
      req = req.or(`name.ilike.%${primary}%,sku.ilike.%${primary}%,description.ilike.%${primary}%`);

      const { data, error } = await req.limit(Math.max(limit * 4, 20));
      if (error || !data) return [];

      const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);

      // Si el usuario ingresó varios términos (ej. "cuaderno caribe" o "boligrafo negro"),
      // filtrar y puntuar por coincidencia de tokens en producto y variantes
      const scored = data.map(p => {
        const variants = (p.jjp_product_variants || []).filter(v => v.active !== false);
        const brandNames = variants.map(v => v.jjp_brands?.name).filter(Boolean);
        const variantNames = variants.map(v => v.variant_name).filter(Boolean);
        const fullSearchText = `${p.name} ${p.sku || ''} ${p.description || ''} ${brandNames.join(' ')} ${variantNames.join(' ')}`.toLowerCase();

        let matchCount = 0;
        tokens.forEach(t => {
          if (fullSearchText.includes(t.toLowerCase())) matchCount++;
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

      // Ordenar por puntuación de coincidencia y limitar
      return scored
        .filter(item => tokens.length <= 1 || item.score >= Math.min(tokens.length, 2))
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
     4.2. Redactor Inteligente de Campañas Comerciales
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
Eres el Director de Marketing y Copywriter de JJ Paper.
Redactas campañas de alto impacto y conversión para ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'}.

REGLAS DE FORMATO:
- Debes incluir variables dinámicas: {{nombre}}, {{vendedor}}, {{link}} y si hay producto: {{producto}}, {{precio}}.
- Utiliza Spintax {opción 1|opción 2|opción 3} en saludos y despedidas para evitar bloqueos por spam.
- Tasa oficial BCV vigente: ${rate.toFixed(2)} Bs.
- Si es para Email, devuelve un JSON con "subject" y "body".
- Si es para WhatsApp, devuelve un JSON con "body".

Ejemplo de respuesta WhatsApp:
{
  "body": "{¡Hola!|Buen día|Saludos cordiales} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper...\\n\\n📦 *{{producto}}*\\n💲 Precio mayorista: *{{precio}}*...\\n\\n👉 Pedidos en línea: {{link}}\\n{¿Le reservamos mercancía?|¿Desea cotizar otras cantidades?}"
}
`;

    const prompt = `
Objetivo de campaña: ${objective}
Canal: ${channel}
Destinatarios: ${audience}
Producto o Promoción: ${product ? `${product.name} (Precio: $${product.price_usd || product.final_price_usd || ''})` : 'Catálogo general de papelería'}
Descuento extra: ${discount || 'Precio regular mayorista'}
Notas adicionales del vendedor: ${customNotes || 'Enfocado en despacho rápido y disponibilidad'}
Vendedor emisor: ${sellerName || 'Asesor JJ Paper'}

Genera el mensaje comercial en formato JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.75 });
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      if (channel === 'email') {
        return {
          subject: product ? `📦 Promoción Especial: ${product.name} — JJ Paper` : 'Novedades y Ofertas Especiales — JJ Paper',
          body: `{Estimado(a)|Apreciado(a)|Hola} {{nombre}},\n\nLe saludamos cordialmente de JJ Paper C.A. Esperamos que su negocio se encuentre excelente.\n\nQueremos presentarle nuestra disponibilidad inmediata en ${product ? `*${product.name}* a un precio especial de *${product.price_usd ? '$' + Number(product.price_usd).toFixed(2) + ' USD' : '{{precio}}'}*` : 'artículos escolares, de oficina y papelería al mayor'}.\n\n👉 Puede revisar nuestro catálogo completo y gestionar su pedido aquí:\n{{link}}\n\nNuestras facturas y despachos se calculan a tasa oficial BCV (${rate.toFixed(2)} Bs).\n\n{Quedamos a su completa disposición.|Esperamos su pronta respuesta para asegurar su pedido.}\n\nAtentamente,\n{{vendedor}}\nJJ Paper C.A.`
        };
      } else {
        return {
          body: `{¡Hola!|Buen día|Saludos cordiales} {{nombre}} 👋, le saluda {{vendedor}} de JJ Paper.\n\nTenemos excelentes promociones activas hoy ${product ? `en *${product.name}* a tan solo *${product.price_usd ? '$' + Number(product.price_usd).toFixed(2) + ' USD' : '{{precio}}'}*` : 'en todo nuestro catálogo de papelería y oficina'}.\n\n👉 Puede ver detalles y pedir en línea aquí: {{link}}\n\n{¿Le apartamos mercancía para su despacho de hoy?|¿Desea que le verifiquemos disponibilidad de algún otro artículo?}`
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
Eres el Asistente Oficial y Copiloto de JJ Paper para el personal interno (${userRole}).
- Responde de forma concisa, útil y clara.
- Usa los datos de precios en USD y en Bs calculados con la tasa BCV del día (${rate.toFixed(2)} Bs).
- Puedes explicar cómo emitir pedidos, cotizaciones, consultar clientes en el CRM, usar WhatsApp y generar fichas gráficas de productos.
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
     6. Generador Visual de Tarjeta de Producto (HTML5 Canvas Flyer 800x800)
     -------------------------------------------------------------------------- */
  async function renderProductCard({
    product,
    customPriceUsd = null,
    sellerName = '',
    sellerPhone = '',
    customNote = '',
    canvas = null
  }) {
    const cvs = canvas || document.createElement('canvas');
    cvs.width = 800;
    cvs.height = 800;
    const ctx = cvs.getContext('2d');

    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const priceUsd = customPriceUsd !== null ? parseFloat(customPriceUsd) : parseFloat(product.price_usd || 0);
    const priceBs = (priceUsd * rate).toFixed(2);

    // 1. Fondo blanco/hueso
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 800, 800);

    // 2. Cabecera con degradado verde institucional JJ Paper
    const gradHeader = ctx.createLinearGradient(0, 0, 800, 140);
    gradHeader.addColorStop(0, '#16604A');
    gradHeader.addColorStop(1, '#0C382B');
    ctx.fillStyle = gradHeader;
    ctx.fillRect(0, 0, 800, 130);

    // Acento dorado en el borde de la cabecera
    ctx.fillStyle = '#EAB308';
    ctx.fillRect(0, 126, 800, 4);

    // Texto de la cabecera
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('JJ PAPER', 40, 58);

    ctx.fillStyle = '#99CC33';
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('DISTRIBUIDORA MAYORISTA & PAPELERÍA', 40, 84);

    ctx.fillStyle = '#D1D5DB';
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Tasa Oficial BCV: Bs ${rate.toFixed(2)}`, 40, 106);

    // Badge "DISPONIBLE" en la esquina superior derecha
    ctx.fillStyle = '#10B981';
    roundRect(ctx, 620, 36, 140, 38, 19);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✓ EN STOCK', 690, 60);
    ctx.textAlign = 'left';

    // 3. Tarjeta central de la imagen del producto
    const boxX = 40, boxY = 150, boxW = 720, boxH = 340;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, boxX, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    let imageLoaded = false;
    if (product.image_url) {
      try {
        const img = await loadImageSafe(product.image_url);
        if (img) {
          const maxImgW = boxW - 60;
          const maxImgH = boxH - 40;
          const scale = Math.min(maxImgW / img.width, maxImgH / img.height, 1);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const dx = boxX + (boxW - dw) / 2;
          const dy = boxY + (boxH - dh) / 2;
          ctx.drawImage(img, dx, dy, dw, dh);
          imageLoaded = true;
        }
      } catch (e) {
        console.warn('No se pudo cargar la imagen del producto:', e);
      }
    }

    if (!imageLoaded) {
      ctx.fillStyle = '#F1F5F9';
      roundRect(ctx, boxX + 20, boxY + 20, boxW - 40, boxH - 40, 14);
      ctx.fill();

      ctx.font = '90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(product.emoji || '📦', boxX + boxW / 2, boxY + boxH / 2 + 30);
      ctx.textAlign = 'left';

      ctx.fillStyle = '#64748B';
      ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('JJ PAPER · PRODUCTO ORIGINAL GARANTIZADO', boxX + boxW / 2, boxY + boxH - 35);
      ctx.textAlign = 'left';
    }

    // 4. Nombre y detalles del producto
    const infoY = 515;
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    const nameLines = wrapText(ctx, product.name || 'Producto JJ Paper', 720);
    ctx.fillText(nameLines[0], 40, infoY);
    if (nameLines.length > 1) {
      ctx.fillText(nameLines[1], 40, infoY + 34);
    }

    const pillY = nameLines.length > 1 ? infoY + 50 : infoY + 20;
    let pillText = `Presentación: por ${product.unit || 'unidad'}`;
    if (product.brands) pillText += ` · Marca: ${product.brands}`;
    if (product.sku) pillText += ` · Cód: ${product.sku}`;

    ctx.fillStyle = '#475569';
    ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(pillText, 40, pillY + 18);

    // 5. Destacado de Precio (Caja Hero)
    const priceBoxY = pillY + 35;
    const gradPrice = ctx.createLinearGradient(40, priceBoxY, 760, priceBoxY + 95);
    gradPrice.addColorStop(0, '#16604A');
    gradPrice.addColorStop(1, '#0C382B');
    ctx.fillStyle = gradPrice;
    roundRect(ctx, 40, priceBoxY, 720, 95, 16);
    ctx.fill();

    ctx.fillStyle = '#99CC33';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PRECIO MAYORISTA ESPECIAL', 65, priceBoxY + 32);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`$${priceUsd.toFixed(2)}`, 65, priceBoxY + 76);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '500 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('USD', 65 + ctx.measureText(`$${priceUsd.toFixed(2)}`).width + 8, priceBoxY + 74);

    // Caja derecha equivalente en Bs
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    roundRect(ctx, 470, priceBoxY + 14, 270, 67, 12);
    ctx.fill();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AL CAMBIO OFICIAL BCV', 605, priceBoxY + 36);

    ctx.fillStyle = '#FDE047';
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Bs ${Number(priceBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 605, priceBoxY + 65);
    ctx.textAlign = 'left';

    // 6. Pie de Página Comercial
    const footY = 745;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(40, footY - 15, 720, 1);

    const contactStr = sellerName ? `Atendido por: ${sellerName}` : 'JJ Paper Distribuidora';
    const subStr = customNote || (sellerPhone ? `📱 WhatsApp: ${sellerPhone} · Envíos a toda Venezuela` : '📱 Solicita tu cotización formal y pedidos inmediatos');

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(contactStr, 40, footY + 8);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(subStr, 40, footY + 28);

    ctx.fillStyle = '#16604A';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('🌐 jjpaper.com', 760, footY + 18);
    ctx.textAlign = 'left';

    return cvs;
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

  async function loadImageSafe(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        return new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => res(null);
          img.src = URL.createObjectURL(blob);
        });
      }
    } catch (e) {
      // Fallback a Image con CORS
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        const fallback = new Image();
        fallback.onload = () => resolve(fallback);
        fallback.onerror = () => resolve(null);
        fallback.src = url;
      };
      img.src = url;
    });
  }

  return {
    callGemini,
    suggestWhatsAppReplies,
    generateAntiSpamVariations,
    generateCampaignSpintax,
    draftCampaignMessage,
    draftEmail,
    searchProductsLive,
    askCopilot,
    renderProductCard,
    getCurrentKeyIndex: () => _keyIndex,
    getTotalKeys: () => GEMINI_KEYS.length
  };
});
