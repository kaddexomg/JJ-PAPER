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

  // Modelos ultrarrápidos con latencia mínima comprobada
  const GEMINI_MODELS = [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
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

          // Si es límite de cuota (429) o clave no autorizada (403), rotar de inmediato a la siguiente llave
          if (status === 429 || status === 403) {
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key límite excedido (${status}): ${errMsg}`);
            break; // Cambiar de llave
          }

          // Si el modelo específico está sobrecargado (503) o no encontrado (404), continuar con el siguiente modelo de esta llave
          if (status === 503 || status === 404) {
            lastError = new Error(`Modelo ${m} no disponible (${status}): ${errMsg}`);
            continue;
          }

          lastError = new Error(`Error en API (${status}): ${errMsg}`);
        } catch (netErr) {
          clearTimeout(timeoutId);
          lastError = netErr;
          break; // Error de red o timeout (>3.5s), probar siguiente llave
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
     6. Generador Visual de Flyer Publicitario (Canvas Ultra-HD 1200x1200)
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
    cvs.width = 1200;
    cvs.height = 1200;
    const ctx = cvs.getContext('2d');

    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const priceUsd = customPriceUsd !== null ? parseFloat(customPriceUsd) : parseFloat(product.price_usd || 0);
    const priceBs = (priceUsd * rate).toFixed(2);

    // 1. Fondo Studio Premium con Degradado Profundo
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 1200);
    bgGrad.addColorStop(0, '#0a231b');
    bgGrad.addColorStop(0.5, '#103d30');
    bgGrad.addColorStop(1, '#061711');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 1200);

    // 2. Halo de iluminación radial en el centro para dar profundidad de estudio
    const radialGlow = ctx.createRadialGradient(600, 480, 50, 600, 480, 500);
    radialGlow.addColorStop(0, 'rgba(22, 96, 74, 0.45)');
    radialGlow.addColorStop(0.6, 'rgba(16, 185, 129, 0.12)');
    radialGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radialGlow;
    ctx.fillRect(0, 0, 1200, 1200);

    // 3. Cabecera Institucional JJ Paper
    // Franja dorada superior
    ctx.fillStyle = '#EAB308';
    ctx.fillRect(60, 50, 1080, 4);

    // Logotipo / Marca
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 46px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('JJ PAPER', 60, 105);

    ctx.fillStyle = '#A3E635';
    ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('DISTRIBUIDORA MAYORISTA & PAPELERÍA · CARACAS', 60, 134);

    // Badge Tasa Oficial BCV en cabecera
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, 840, 70, 300, 56, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#FDE047';
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TASA BCV OFICIAL', 990, 94);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Bs ${rate.toFixed(2)}`, 990, 117);
    ctx.textAlign = 'left';

    // 4. Tarjeta Central del Producto (Escaparate Studio)
    const cardX = 60, cardY = 160, cardW = 1080, cardH = 550;

    // Sombra suave multicapa
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 35;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, cardX, cardY, cardW, cardH, 26);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Borde interno sutil
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    roundRect(ctx, cardX, cardY, cardW, cardH, 26);
    ctx.stroke();

    // Cinta / Ribbon Promocional en la esquina superior derecha del escaparate
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, cardX + cardW - 240, cardY + 20, 220, 44, 22);
    ctx.fillStyle = '#DC2626';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔥 OFERTA ESPECIAL', cardX + cardW - 130, cardY + 48);
    ctx.restore();

    // Sello de Garantía izquierda
    ctx.fillStyle = '#0F172A';
    roundRect(ctx, cardX + 24, cardY + 20, 230, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#34D399';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('✓ 100% ORIGINAL JJ PAPER', cardX + 42, cardY + 43);

    // Carga o renderizado de imagen de producto
    let imageLoaded = false;
    if (product.image_url) {
      try {
        const img = await loadImageSafe(product.image_url);
        if (img) {
          const maxW = cardW - 120;
          const maxH = cardH - 120;
          const scale = Math.min(maxW / img.width, maxH / img.height, 1);
          const dw = img.width * scale;
          const dh = img.height * scale;
          const dx = cardX + (cardW - dw) / 2;
          const dy = cardY + 70 + (cardH - 90 - dh) / 2;
          
          // Sombra de contacto bajo el producto
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cardX + cardW / 2, dy + dh + 10, dw * 0.4, 16, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.fill();
          ctx.restore();

          ctx.drawImage(img, dx, dy, dw, dh);
          imageLoaded = true;
        }
      } catch (e) {
        console.warn('Error cargando imagen:', e);
      }
    }

    if (!imageLoaded) {
      // Mockup vectorial publicitario elegante si no hay foto
      ctx.fillStyle = '#F8FAFC';
      roundRect(ctx, cardX + 40, cardY + 75, cardW - 80, cardH - 105, 20);
      ctx.fill();

      // Halo circular detrás del emoji
      const iconGlow = ctx.createRadialGradient(cardX + cardW / 2, cardY + cardH / 2 + 10, 10, cardX + cardW / 2, cardY + cardH / 2 + 10, 140);
      iconGlow.addColorStop(0, '#E0F2FE');
      iconGlow.addColorStop(1, '#F8FAFC');
      ctx.fillStyle = iconGlow;
      ctx.beginPath();
      ctx.arc(cardX + cardW / 2, cardY + cardH / 2 + 10, 130, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '140px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(product.emoji || '📦', cardX + cardW / 2, cardY + cardH / 2 + 60);

      ctx.fillStyle = '#475569';
      ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('PRODUCTO GARANTIZADO · CALIDAD DE FÁBRICA', cardX + cardW / 2, cardY + cardH - 45);
      ctx.textAlign = 'left';
    }

    // 5. Datos del Producto (Título y Especificaciones)
    const titleY = 750;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const nameLines = wrapText(ctx, product.name || 'Producto JJ Paper', 1080);
    ctx.fillText(nameLines[0], 60, titleY);
    if (nameLines.length > 1) {
      ctx.fillText(nameLines[1], 60, titleY + 44);
    }

    // Pastilla de características
    const specY = nameLines.length > 1 ? titleY + 84 : titleY + 46;
    let specText = `Presentación: ${product.unit || 'unidad'}`;
    if (product.brands) specText += `  |  Marca: ${product.brands}`;
    if (product.sku) specText += `  |  Código: ${product.sku}`;

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(specText, 60, specY);

    // 6. Bloque Hero de Precios (Doble Moneda USD / Bs Oficial)
    const priceBoxY = specY + 25;
    const priceBoxH = 160;

    const priceGrad = ctx.createLinearGradient(60, priceBoxY, 1140, priceBoxY + priceBoxH);
    priceGrad.addColorStop(0, '#16604A');
    priceGrad.addColorStop(1, '#0B3327');
    ctx.fillStyle = priceGrad;
    roundRect(ctx, 60, priceBoxY, 1080, priceBoxH, 22);
    ctx.fill();

    ctx.strokeStyle = '#22C55E';
    ctx.lineWidth = 2;
    roundRect(ctx, 60, priceBoxY, 1080, priceBoxH, 22);
    ctx.stroke();

    // Columna Izquierda: Precio USD
    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PRECIO MAYORISTA ESPECIAL', 95, priceBoxY + 48);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const formattedUsd = `$${priceUsd.toFixed(2)}`;
    ctx.fillText(formattedUsd, 95, priceBoxY + 118);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('USD', 95 + ctx.measureText(formattedUsd).width + 12, priceBoxY + 114);

    // Columna Derecha: Tarjeta Equivalente en Bolívares
    const bsBoxW = 420, bsBoxH = 114;
    const bsBoxX = 1140 - bsBoxW - 30;
    const bsBoxY = priceBoxY + 23;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(ctx, bsBoxX, bsBoxY, bsBoxW, bsBoxH, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.4)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, bsBoxX, bsBoxY, bsBoxW, bsBoxH, 16);
    ctx.stroke();

    ctx.fillStyle = '#CBD5E1';
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TOTAL AL CAMBIO BCV DEL DÍA', bsBoxX + bsBoxW / 2, bsBoxY + 38);

    ctx.fillStyle = '#FDE047';
    ctx.font = '900 38px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`Bs ${Number(priceBs).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, bsBoxX + bsBoxW / 2, bsBoxY + 84);
    ctx.textAlign = 'left';

    // 7. Tres Pilares de Confianza
    const pillarY = priceBoxY + priceBoxH + 34;
    const pillars = [
      '⚡ Despacho en 24h Caracas',
      '🛡️ Factura y Garantía',
      '💳 Zelle / Pago Móvil / Divisas'
    ];
    ctx.font = '600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const pillW = 340, pillH = 40;
    pillars.forEach((p, idx) => {
      const px = 60 + idx * (pillW + 30);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      roundRect(ctx, px, pillarY, pillW, pillH, 20);
      ctx.fill();
      ctx.fillStyle = '#E2E8F0';
      ctx.textAlign = 'center';
      ctx.fillText(p, px + pillW / 2, pillarY + 26);
      ctx.textAlign = 'left';
    });

    // 8. Pie de Página Comercial y Contacto
    const footerY = 1145;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(60, footerY - 25, 1080, 1.5);

    const advisorStr = sellerName ? `Atendido por: ${sellerName}` : 'Equipo Comercial JJ Paper';
    const phoneStr = sellerPhone ? `📱 WhatsApp: ${sellerPhone}` : '📱 Pedidos directos';
    const noteStr = customNote || 'Envíos a toda Venezuela vía Tealca, MRW y Zoom';

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(`${advisorStr}  ·  ${phoneStr}`, 60, footerY + 12);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(noteStr, 60, footerY + 36);

    ctx.fillStyle = '#A3E635';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('🌐 jjpaper.com', 1140, footerY + 22);
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
