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

  // Pool dinámico de API Keys de Google Gemini.
  // Protegido: Las claves se sincronizan dinámicamente desde la base de datos (jjp_settings: 'ai_gemini_keys')
  // y se respaldan en caché local. NUNCA se comitean en texto plano en Git para evitar revocaciones de Google.
  let GEMINI_KEYS = [];

  // En entorno Node (servidor o pruebas), cargar desde process.env o archivo .env si está disponible
  function loadNodeEnvKeys() {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.GEMINI_API_KEYS) {
        try {
          const parsed = JSON.parse(process.env.GEMINI_API_KEYS);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch (_) {}
      }
      try {
        const fs = require('fs');
        const path = require('path');
        const envPaths = [
          path.join(process.cwd(), 'wa-server', '.env'),
          path.join(process.cwd(), '.env'),
          path.join(__dirname || '', '..', '..', 'wa-server', '.env')
        ];
        for (const ep of envPaths) {
          if (fs.existsSync(ep)) {
            const content = fs.readFileSync(ep, 'utf8');
            const match = content.match(/GEMINI_API_KEYS\s*=\s*(\[[\s\S]*?\])/);
            if (match) {
              const parsed = JSON.parse(match[1]);
              if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
          }
        }
      } catch (_) {}
    }
    return [];
  }

  GEMINI_KEYS = loadNodeEnvKeys();

  async function syncKeysFromSettings() {
    try {
      if (typeof window !== 'undefined') {
        const rawSettings = (window.APP && window.APP.SETTINGS && window.APP.SETTINGS.ai_gemini_keys)
          || (() => {
            try {
              const s = JSON.parse(localStorage.getItem('jjp_settings') || sessionStorage.getItem('jjp_settings') || '{}');
              return s.ai_gemini_keys;
            } catch (_) { return null; }
          })();
        if (rawSettings) {
          const parsed = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
          if (Array.isArray(parsed) && parsed.length > 0) {
            GEMINI_KEYS = parsed;
            return GEMINI_KEYS;
          }
        }
        if (window.sb && typeof window.sb.from === 'function') {
          const { data } = await window.sb.from('jjp_settings').select('value').eq('key', 'ai_gemini_keys').maybeSingle();
          if (data && data.value) {
            const parsed = JSON.parse(data.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              GEMINI_KEYS = parsed;
              return GEMINI_KEYS;
            }
          }
        }
      }
    } catch (_) {}
    return GEMINI_KEYS;
  }

  if (typeof window !== 'undefined') {
    setTimeout(() => { syncKeysFromSettings().catch(() => {}); }, 50);
  }

  // Modelos reales de Gemini (2.5 Flash y 2.0 Flash)
  const PRO_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ];

  // Modelos ultrarrápidos para sugerencias en vivo en chat y cotizaciones
  const FAST_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash'
  ];

  let _keyIndex = Math.floor(Math.random() * GEMINI_KEYS.length);
  let _totalCalls = 0;
  let _keyFailures = {};
  let _deadKeys = new Set();
  let _proxyAvailable = true;
  let _variationCounter = Math.floor(Math.random() * 100);

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

    // 5. Intentar auto-reparar JSON truncado por límite de tokens
    const startIdx = cleaned.indexOf('{');
    if (startIdx !== -1) {
      let candidate = cleaned.slice(startIdx);
      let quotes = 0;
      let escaped = false;
      for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] === '"' && !escaped) quotes++;
        escaped = (candidate[i] === '\\' && !escaped);
      }
      if (quotes % 2 !== 0) candidate += '"';
      let openBraces = 0;
      for (let i = 0; i < candidate.length; i++) {
        if (candidate[i] === '{') openBraces++;
        if (candidate[i] === '}') openBraces--;
      }
      while (openBraces > 0) { candidate += '}'; openBraces--; }
      try { return JSON.parse(candidate); } catch (_) {}
    }

    throw new Error('No se pudo extraer JSON de la respuesta de IA');
  }

  /* --------------------------------------------------------------------------
     Llamada Base a la API con enrutamiento inteligente (/api/ai + Vertex + Google AI)
     -------------------------------------------------------------------------- */
  async function callGemini(options, fallbackModel = null) {
    _totalCalls++;

    let prompt = '';
    let systemInstruction = '';
    let temperature = 0.75;
    let maxTokens = 1500;
    let model = null;
    let mode = 'fast';

    if (typeof options === 'string') {
      prompt = options;
      model = fallbackModel;
    } else if (options && typeof options === 'object') {
      prompt = options.prompt || '';
      systemInstruction = options.systemInstruction || '';
      temperature = options.temperature !== undefined ? options.temperature : 0.75;
      maxTokens = options.maxTokens || 1500;
      model = options.model || fallbackModel || null;
      mode = options.mode || 'fast';
    }

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('El prompt enviado a Gemini AI está vacío o no es una cadena válida.');
    }

    const isArchitect = (mode === 'architect' || mode === 'pro');
    const targetModel = (model && !model.includes('3.')) ? model : 'gemini-2.5-flash';

    // 1. Intentar primero mediante el proxy Cloudflare Pages (/api/ai) para evadir bloqueo geográfico IP Venezuela
    if (_proxyAvailable && typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
      try {
        const proxyCtrl = new AbortController();
        const proxyTimer = setTimeout(() => proxyCtrl.abort(), 5000);
        const proxyRes = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            systemInstruction,
            temperature,
            maxTokens,
            model: targetModel
          }),
          signal: proxyCtrl.signal
        });
        clearTimeout(proxyTimer);
        if (proxyRes.ok) {
          const pData = await proxyRes.json();
          if (pData && pData.text) return String(pData.text).trim();
        } else if (proxyRes.status === 404 || proxyRes.status === 405) {
          _proxyAvailable = false; // En servidor local estático sin Cloudflare Function
        }
      } catch (_) {
        // Ignorar y continuar al pool directo
      }
    }

    // 2. Pool directo filtrando llaves marcadas como muertas o bloqueadas por región
    const rawPool = isArchitect ? [...PRO_KEYS, ...GEMINI_KEYS.filter(k => !PRO_KEYS.includes(k))] : GEMINI_KEYS;
    const activePool = rawPool.filter(k => !_deadKeys.has(k));
    if (activePool.length === 0) {
      throw new Error('Servicio directo bloqueado por región o llaves agotadas; activando motor dinámico local.');
    }

    const modelsToTry = [targetModel, 'gemini-2.0-flash'].filter((v, i, a) => a.indexOf(v) === i);
    const timeoutMs = 3800;
    let lastError = null;

    for (let attempt = 0; attempt < Math.min(activePool.length, 3); attempt++) {
      const currentKey = activePool[attempt];
      const isVertexKey = currentKey.startsWith('AQ.');

      for (const m of modelsToTry) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const endpoint = isVertexKey
            ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${currentKey}`
            : `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${currentKey}`;

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
            if (text) return text.trim();
          }

          const status = res.status;
          const errBody = await res.json().catch(() => ({}));
          const errMsg = errBody.error?.message || `HTTP ${status}`;
          const lowErr = errMsg.toLowerCase();

          // Si es bloqueo geográfico ("User location is not supported") o llave inválida (401/403)
          if (status === 401 || status === 403 || lowErr.includes('location is not supported') || lowErr.includes('api_key') || lowErr.includes('key not valid')) {
            _deadKeys.add(currentKey);
            _keyFailures[currentKey] = (_keyFailures[currentKey] || 0) + 1;
            lastError = new Error(`Key/Región restringida (${status}): ${errMsg}`);
            break;
          }

          if (status === 429 || status === 503 || status === 404) {
            lastError = new Error(`Modelo ${m} no disponible (${status}): ${errMsg}`);
            continue;
          }

          lastError = new Error(`Error en API (${status}): ${errMsg}`);
        } catch (netErr) {
          clearTimeout(timeoutId);
          lastError = netErr;
          break;
        }
      }
    }

    throw lastError || new Error('No se pudo comunicar con el servicio de IA.');
  }

  /* --------------------------------------------------------------------------
     Motor Compositor Dinámico Multi-Tono y Multi-Formato (Variación Real por Clic)
     Garantiza que cada clic y cada cambio de tono/gancho/formato genere un
     mensaje completamente distinto en estructura, ángulo, longitud y estilo.
     -------------------------------------------------------------------------- */
  function _detectToneArchetype(toneStr = '', hookStr = '', msgTypeStr = '') {
    const combined = `${toneStr} ${hookStr} ${msgTypeStr}`.toLowerCase();
    if (/urgente|rel[aá]mpago|oportunidad|oferta|liquidaci[oó]n|promo|descuento|escala|volumen/i.test(combined)) {
      return 'oportunidad_mayorista';
    }
    if (/cercano|consultivo|amigable|cordial|asesor|sourcing|procura|b[uú]squeda|seguimiento|recordatorio/i.test(combined)) {
      return 'cercano_consultivo';
    }
    if (/institucional|formal|corporativo|seniat|licitaci[oó]n|ejecutivo|homologaci[oó]n|bcv/i.test(combined)) {
      return 'institucional_formal';
    }
    if (/directo|corto|breve|express|r[aá]pido|flash/i.test(combined)) {
      return 'directo_ejecutivo';
    }
    if (/ahorro|presupuesto|costo|optimizaci[oó]n|rentabilidad/i.test(combined)) {
      return 'optimizacion_costos';
    }
    // Si es 'socio_estrategico' o genérico, rotamos entre los 5 arquetipos en cada clic
    const archetypes = [
      'socio_estrategico',
      'oportunidad_mayorista',
      'cercano_consultivo',
      'institucional_formal',
      'directo_ejecutivo',
      'optimizacion_costos'
    ];
    return archetypes[_variationCounter % archetypes.length];
  }

  function getEffectiveRate() {
    const w = typeof window !== 'undefined' ? window : {};
    let r = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 0);
    if (!r || r < 100) {
      try {
        const cached = (typeof localStorage !== 'undefined') ? (localStorage.getItem('jjp_exchange_rate') || localStorage.getItem('jjp_rate_bcv')) : null;
        if (cached && Number(cached) > 100) r = Number(cached);
      } catch (_) {}
    }
    return (r && r > 100) ? r : 866.56;
  }

  /* --------------------------------------------------------------------------
     Contexto Maestro del Negocio (JJ Paper)
     -------------------------------------------------------------------------- */
  function getBusinessContext() {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = getEffectiveRate();
    const seller = w.CURRENT_PROFILE || w.WA_ME || w.MAIL_ME || {};
    const sellerName = seller.full_name || seller.name || 'Asesor JJ Paper';
    const sellerRef = seller.ref_code || '';

    // Top 20 productos de mayor rotación con precios de referencia (Fase 4.6)
    const top20Products = `
TOP PRODUCTOS DE MAYOR ROTACIÓN Y PRECIOS MAYORISTAS DE REFERENCIA:
1. Resma Papel Carta 75g HP / Report / Chamex (~$5.20-$5.45)
2. Resma Papel Oficio 75g (~$5.80-$6.10)
3. Cuaderno 1 Línea Engrapado 100h Caribe (~$0.85-$0.95)
4. Cuaderno Doble Espiral 1 Línea 100h (~$1.15-$1.30)
5. Bolígrafo Kores K1 / Kilométrico caja x12 (~$3.85-$4.20)
6. Goma en Barra Kores 20g / 40g (~$1.35-$2.95)
7. Marcador Acrílico Recargable / Pizarra (~$1.20-$1.50)
8. Cinta Embalaje Transparente 48mm x 100m (~$1.80-$2.10)
9. Rollos Térmicos para Punto 57mm / 80mm (~$0.65-$0.90)
10. Carpetas Manila Carta / Oficio paquete x100 (~$10.50-$12.00)
11. Lápiz Grafito HB x12 Artesco / Mongol (~$2.50-$3.10)
12. Resaltadores Kores / Pelikan set x4 (~$3.20-$3.80)
13. Tijera Escolar y Oficina 5" / 7" (~$0.95-$1.60)
14. Silicon Líquido 100ml / 250ml (~$1.10-$2.30)
15. Grapas 26/6 caja 5000 (~$1.20-$1.50) y Engrapadoras de oficina
16. Clips Mariposa y Estándar N° 1 (~$0.75-$1.10)
17. Sobres Manila y Blancos Carta/Oficio x50
18. Papel Carbón Kores x100h (~$6.50)
19. Calculadoras de Mesa Casio/Citizen 12 dígitos
20. Archivadores de Palanca Carta y Oficio lomo ancho (~$3.50-$4.20)

MATRIZ DE CROSS-SELL COMERCIAL (Sugerir activamente):
- Si cotiza Resmas de Papel -> Ofrecer Carpetas Manila, Clips y Archivadores de palanca.
- Si cotiza Rollos Térmicos -> Ofrecer Cinta de Embalaje y Marcadores permanentes.
- Si cotiza Cuadernos o Escolares -> Ofrecer Lápices HB, Bolígrafos y Borradores/Sacapuntas.
- Si cotiza Consumibles de Facturación -> Ofrecer Bolígrafos y Almohadillas dactilares.`;

    return `
Eres el Asistente Experto de Comunicación Comercial B2B de "JJ Paper C.A." en Caracas, Venezuela.
- JJ Paper es una distribuidora mayorista y detal de papelería, útiles escolares, consumibles de oficina y papelería corporativa.
- Catálogo principal: Resmas de papel Bond (Carta, Oficio, Extra Oficio de 75g y 80g), cuadernos (engrapados, doble espiral, cosidos), bolígrafos, marcadores, carpetas de fibra, archivadores, consumibles, tóner y embalaje.
- Tasa oficial BCV vigente: 1 USD = ${rate.toFixed(2)} Bs (todas las transacciones, presupuestos y facturas se calculan rigurosamente al cambio oficial del Banco Central de Venezuela).
- Asesor comercial activo: ${sellerName} ${sellerRef ? `(Código: ${sellerRef})` : ''}.
- Medios de pago: Dólares USD en efectivo, Zelle, Banesco Panamá, Bolívares por Pago Móvil y Transferencias bancarias nacionales al cambio BCV.
- Despachos: Entregas directas en Caracas con rutas diarias y envíos asegurados a toda Venezuela por Tealca, MRW y Zoom.
${top20Products}

DIRECTRICES DE TONO Y ESTILO B2B (HUMANO, PROFESIONAL Y RESPETUOSO):
1. NO USES TONO DE ANUNCIO AGRESIVO O BOT: Prohibido sonar a teletienda, usar mayúsculas sostenidas exageradas, promesas vacías o saturación de signos de exclamación o emojis (máximo 1 o 2 emojis elegantes por mensaje).
2. TRATO B2B CONSULTIVO: Habla como un asesor comercial humano que se dirige a gerentes de compras, administradores de oficinas, dueños de colegios o librerías. Sé cordial, empático y profesional ("Estimado/a", "Un gusto saludarle", "Esperamos que todo marche excelente en su empresa").
3. CONCISIÓN Y VALOR REAL: Ve al grano. Destaca disponibilidad de inventario listo, precio mayorista transparente, factura fiscal y rapidez de despacho.
4. LLAMADOS A LA ACCIÓN (CTA) OBLIGATORIOS Y ESTRICTOS:
   - Todo mensaje DEBE cerrar con una pregunta de baja fricción que avance la venta.
   - Ejemplos válidos: "¿Para qué zona de Caracas sería el despacho?", "¿Desea que le reserve las cajas disponibles?", "¿Cuántas unidades o bultos estima para este pedido?", "¿Le armo la cotización formal con factura?".
   - PROHIBIDO terminar con frases muertas pasivas como "Quedo a su disposición", "Estamos para servirle", "Cualquier duda a la orden".
`;
  }

  /* --------------------------------------------------------------------------
     1. WhatsApp: Sugerencias Inteligentes de Respuesta
     -------------------------------------------------------------------------- */
  async function suggestWhatsAppReplies({ chatHistory = [], lastMessage = '', clientName = '', sellerName = '', customerProfile = null }) {
    const sys = getBusinessContext() + `
Tu tarea es sugerir 3 respuestas listas para enviar a este cliente en WhatsApp.
- Analiza la consulta o último mensaje del cliente y el contexto de su perfil comercial si está disponible.
- Respeta la regla de CTA obligatorio al final de cada opción (pregunta de avance comercial).
- Devuelve EXACTAMENTE un objeto JSON válido (sin markdown exterior ni \`\`\`json) con esta estructura:
{
  "opcion_directa": "Respuesta corta, precisa y al punto con CTA (máx 2 líneas)",
  "opcion_cordial": "Respuesta cálida, saludando con su nombre si está disponible y llamada a la acción de baja fricción",
  "opcion_comercial": "Respuesta orientada a la venta/cierre mayorista o cross-sell con pregunta de cantidad/despacho"
}`;

    let profileSnippet = '';
    if (customerProfile) {
      const cli = customerProfile.cliente || customerProfile;
      const recentPeds = Array.isArray(customerProfile.pedidos) ? customerProfile.pedidos.slice(0, 3) : [];
      profileSnippet = `
Perfil CRM del Cliente:
- Razón Social: ${cli.name || clientName || 'N/A'}
- RIF: ${cli.rif || 'N/A'}
- Zona / Ciudad: ${cli.zone || cli.city || 'N/A'}
- Historial reciente: ${recentPeds.length ? recentPeds.map(p => `#${p.order_number} ($${p.total_usd || 0})`).join(', ') : 'Primer contacto / sin compras recientes'}`;
    }

    const prompt = `
Cliente: ${clientName || 'Cliente'}
Vendedor: ${sellerName || 'Asesor de Ventas'}${profileSnippet}
Último mensaje recibido del cliente: "${lastMessage || '(Sin mensaje previo, iniciar conversación)'}"
Historial reciente:
${chatHistory.slice(-5).map(m => `${m.direction === 'out' ? 'Vendedor' : 'Cliente'}: ${m.body || '[adjunto]'}`).join('\n')}

Genera las 3 opciones en formato JSON estricto cumpliendo con las directivas comerciales y CTAs.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.65 });
      return extractJSON(raw);
    } catch (e) {
      // Fallback inteligente
      const nameGreet = clientName ? `Hola ${clientName}, ` : '¡Hola! ';
      return {
        opcion_directa: `${nameGreet}con gusto le confirmamos disponibilidad inmediata. ¿Cuántas unidades necesita cotizar hoy?`,
        opcion_cordial: `${nameGreet}un gusto saludarle desde JJ Paper. Con gusto le verificamos precios al cambio oficial BCV. ¿Para qué zona sería la entrega?`,
        opcion_comercial: `${nameGreet}tenemos excelente precio mayorista en bultos con despacho prioritario. ¿Desea que le prepare la cotización formal?`
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
    _variationCounter++;

    const sys = getBusinessContext() + `
Eres un especialista en optimización de mensajería comercial y protección contra baneos de WhatsApp (Anti-Spam).
Tu objetivo es tomar el texto base que el vendedor desea enviar y generar 3 VARIACIONES COMPLETAMENTE DISTINTAS en redacción, pero que transmitan exactamente la misma oferta o mensaje comercial.
Semilla de variación creativa: #${_variationCounter}.

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

    const prompt = `Texto original a variar (Iteración #${_variationCounter}):\n"${baseText.trim()}"\n\nDevuelve las 3 variaciones en formato JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.85 });
      return extractJSON(raw);
    } catch (e) {
      const clean = baseText.trim();
      const idx = _variationCounter % 3;
      const openingsA = [
        '⚡ *Aviso directo de inventario — JJ Paper:*',
        '🚀 *Actualización rápida de disponibilidad:*',
        '📦 *Stock listo para despacho inmediato en Caracas:*'
      ];
      const openingsB = [
        '¡Hola! Espero que todo marche excelente en su empresa 👋. Queríamos comentarle que:',
        'Un gusto saludarle el día de hoy 🤝. Pensando en la reposición de su oficina, le compartimos:',
        'Buen día, esperamos que estén teniendo una excelente jornada laboral. Le escribimos de JJ Paper:'
      ];
      const openingsC = [
        'Estimado equipo de Compras y Administración,\n\nPor medio de la presente ponemos a su disposición nuestra disponibilidad actualizada:',
        'Cordial saludo de parte de la Dirección Comercial de JJ Paper C.A.\n\nLe informamos nuestras condiciones vigentes de abastecimiento:',
        'Atención Dpto. de Procura:\n\nCompartimos formalmente el estatus de suministro mayorista a Tasa Oficial BCV:'
      ];
      const closingsA = [
        '¿Cuántas unidades le apartamos para despacho hoy?',
        '¿Le preparamos el presupuesto formal de inmediato?',
        'Indíquenos cantidades para bloquear su stock en almacén.'
      ];
      const closingsB = [
        '¿Para qué zona de Caracas le coordinamos la entrega esta semana?',
        'Quedamos muy atentos por si desean que les armemos una cotización a medida.',
        '¿Qué otro artículo de papelería o embalaje necesitan sumar a su pedido?'
      ];
      const closingsC = [
        'Emitimos factura fiscal legal (BCV) con despacho directo a su sede. ¿Procedemos con su orden?',
        '¿Desea que reservemos este lote bajo las condiciones mayoristas actuales?',
        'Aguardamos sus instrucciones para emitir la proforma correspondiente.'
      ];
      return {
        variacion_a: `${openingsA[idx]}\n\n${clean}\n\n👉 ${closingsA[idx]}`,
        variacion_b: `${openingsB[idx]}\n\n${clean}\n\n💬 ${closingsB[idx]}`,
        variacion_c: `${openingsC[idx]}\n\n${clean}\n\n🧾 ${closingsC[idx]}`
      };
    }
  }

  /* --------------------------------------------------------------------------
     3. Correo CRM: Redactor Comercial de Emails
     -------------------------------------------------------------------------- */
  async function draftEmail({ scenario = 'cotizacion', toName = '', toEmail = '', notes = '', originalEmail = '', sellerName = '', tone = '' }) {
    _variationCounter++;
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 40);
    const sName = sellerName || w.CURRENT_PROFILE?.full_name || w.CURRENT_PROFILE?.name || 'Dpto. Comercial JJ Paper';
    const sys = getBusinessContext() + `
Eres el redactor oficial de correspondencia comercial de JJ Paper C.A.
Redactas correos impecables, respetuosos y altamente persuasivos para clientes corporativos, librerías, oficinas y comercios.
Semilla de variación estilística: #${_variationCounter} (usa una estructura, apertura y enfoque fresco en cada generación).

Instrucciones:
- El asunto (subject) debe ser claro, conciso, atractivo y adaptado al escenario (${scenario}).
- El cuerpo (body) debe tener estructura clara: Saludo personalizado, Introducción según escenario, Puntos clave / precios / detalles, Condiciones comerciales (despacho, tasa BCV a ${rate.toFixed(2)} Bs, métodos de pago), y Cierre con firma de ${sName}.
- NO uses código HTML complejo en el body; usa texto formateado con saltos de línea limpios, bullets (•) y viñetas que se lean bien en cualquier cliente de correo.

Devuelve EXACTAMENTE un objeto JSON válido con esta estructura:
{
  "subject": "Asunto profesional del correo",
  "body": "Cuerpo completo del correo listo para enviar"
}`;

    const prompt = `
Tipo de correo / Escenario: ${scenario}
Tono solicitado: ${tone || 'Ejecutivo B2B'} (Variación #${_variationCounter})
Destinatario: ${toName || 'Estimado Cliente'} (${toEmail || 'cliente@empresa.com'})
Instrucciones / Notas adicionales del vendedor: "${notes || 'Sin notas adicionales'}"
${originalEmail ? `Correo al que se responde:\n"${originalEmail}"` : ''}

Genera el asunto y cuerpo en JSON estricto.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.78 });
      return extractJSON(raw);
    } catch (e) {
      const sc = String(scenario || 'cotizacion').toLowerCase();
      const v = _variationCounter % 4;
      const recipient = toName || 'Estimado Cliente';
      const customBlock = notes && notes.trim() ? `\n📌 DETALLE ESPECÍFICO:\n${notes.trim()}\n` : '';

      if (sc.includes('cobranza') || sc.includes('pago') || sc.includes('factura')) {
        const subjects = [
          `Estado de Cuenta y Conciliación Administrativa — JJ Paper C.A.`,
          `Recordatorio Administrativo de Facturación Pendiente — JJ Paper C.A.`,
          `Gestión de Cobranza y Actualización de Saldo (BCV) — JJ Paper C.A.`,
          `Aviso de Vencimiento de Factura Comercial — JJ Paper C.A.`
        ];
        const bodies = [
          `Estimado(a) ${recipient},\n\nReciba un cordial saludo de parte del equipo administrativo y comercial de JJ Paper C.A.\n\nNos comunicamos brevemente con usted para realizar el seguimiento administrativo correspondiente a su estado de cuenta vigente.${customBlock}\nLe recordamos que los pagos en bolívares se procesan a la Tasa Oficial BCV vigente el día de la cancelación (${rate.toFixed(2)} Bs/USD el día de hoy), o bien en divisas vía Zelle / Efectivo.\n\n¿Podría confirmarnos la fecha programada para la liquidación o enviarnos el soporte de pago en caso de haberlo efectuado?\n\nAgradeciendo de antemano su valiosa atención y puntualidad.\n\nAtentamente,\n${sName}\nJJ Paper C.A.`,
          `Apreciado(a) ${recipient},\n\nEsperamos que sus operaciones marchen con total éxito.\n\nA efectos de mantener al día su línea de suministro y despacho prioritario con JJ Paper C.A., le escribimos para verificar el estatus de la facturación pendiente a la fecha.${customBlock}\nPara su comodidad, contamos con cuentas nacionales (Pago Móvil / Transferencia a tasa BCV del día: ${rate.toFixed(2)} Bs/USD) y medios en USD.\n\nQuedamos atentos al comprobante administrativo para actualizar su ficha comercial de inmediato.\n\nCordialmente,\n${sName}\nJJ Paper C.A.`
        ];
        return { subject: subjects[v], body: bodies[v % bodies.length] };
      }

      if (sc.includes('despacho') || sc.includes('envio') || sc.includes('entrega') || sc.includes('pedido')) {
        const subjects = [
          `🚚 Confirmación de Despacho y Logística de Entrega — JJ Paper C.A.`,
          `📦 Estatus de su Pedido en Ruta — JJ Paper C.A.`,
          `Notificación de Salida de Mercancía de Almacén — JJ Paper C.A.`,
          `Coordinación de Entrega de Suministros — JJ Paper C.A.`
        ];
        return {
          subject: subjects[v],
          body: `Estimado(a) ${recipient},\n\nUn gusto saludarle desde el Centro de Distribución de JJ Paper C.A.\n\nLe informamos que su requerimiento ha sido procesado y verificado por nuestro equipo de almacén para su despacho correspondiente.${customBlock}\nDetalles operativos de recepción:\n• Mercancía acompañada de su Factura Fiscal / Nota de Entrega legal.\n• Tasa BCV oficial de referencia: ${rate.toFixed(2)} Bs/USD.\n• Le agradecemos confirmar la persona autorizada en recepción y el horario disponible para recibir a nuestra unidad de transporte.\n\n¿Se encuentra su personal de almacén o recepción disponible el día de hoy para recibir el despacho?\n\nAtentamente,\n${sName}\nLogística y Ventas | JJ Paper C.A.`
        };
      }

      if (sc.includes('seguimiento') || sc.includes('reactivacion') || sc.includes('visita')) {
        const subjects = [
          `🤝 Seguimiento de Abastecimiento y Reposición Operativa — JJ Paper C.A.`,
          `Actualización de Precios Mayoristas e Inventario — JJ Paper C.A.`,
          `Continuidad Operativa y Suministro Directo para ${recipient} — JJ Paper`,
          `¿Cómo se encuentran de inventario de papelería esta semana? — JJ Paper`
        ];
        return {
          subject: subjects[v],
          body: `Hola ${recipient},\n\nEspero que todo marche excelente en su empresa. Le escribe ${sName} de JJ Paper C.A.\n\nEn seguimiento a nuestra conversación previa, quería consultarle brevemente cómo se encuentran de inventario en papelería corporativa, resmas de papel, consumibles de facturación y embalaje para esta quincena.${customBlock}\nEsta semana recibimos reposición directa de importación con precios mayoristas altamente competitivos:\n• Despacho directo y sin costo adicional en Caracas.\n• Facturación fiscal SENIAT a Tasa Oficial BCV (${rate.toFixed(2)} Bs/USD).\n• Servicio de procura: cualquier artículo especial que requieran se lo ubicamos de inmediato.\n\n¿Tienen algún requerimiento abierto esta semana que podamos cotizarles sin compromiso?\n\nUn cordial saludo,\n${sName}\nJJ Paper C.A.`
        };
      }

      // Escenario Cotización / Propuesta Comercial con 4 formatos distintos según clic
      const quoteSubjects = [
        `📋 Cotización Formal y Propuesta Mayorista — JJ Paper C.A.`,
        `💼 Presupuesto Corporativo a Tasa Oficial BCV — JJ Paper C.A.`,
        `⚡ Disponibilidad Inmediata y Condiciones de Suministro para ${recipient} — JJ Paper`,
        `📦 Propuesta de Abastecimiento Directo de Importador — JJ Paper C.A.`
      ];
      const quoteBodies = [
        `Estimado(a) ${recipient},\n\nEs un placer saludarle desde JJ Paper C.A., importadores y distribuidores directos de papelería corporativa, útiles y suministros de oficina en Caracas.\n\nEn atención a su requerimiento, presentamos nuestras condiciones comerciales mayoristas con disponibilidad física inmediata en almacén:${customBlock}\nCONDICIONES COMERCIALES GARANTIZADAS:\n• Precios directos de distribuidor mayorista (sin intermediarios).\n• Facturación fiscal legal (SENIAT) calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs/USD).\n• Despacho directo en Caracas y envíos asegurados a nivel nacional.\n• Garantía de stock inmediato al confirmar su orden de compra.\n\n¿Desea que bloqueemos estas unidades en almacén para programar su despacho de inmediato?\n\nAtentamente,\n${sName}\nDirección Comercial | JJ Paper C.A.`,
        `Hola ${recipient}, un cordial saludo.\n\nLe escribe ${sName} de JJ Paper C.A. Hemos preparado con prioridad la propuesta comercial solicitada para apoyar la operatividad de su empresa con el mayor ahorro por volumen:${customBlock}\n¿POR QUÉ CONSOLIDAR SU COMPRA CON JJ PAPER?\n1. Ahorro Mayorista Real: Escalas preferenciales por caja y bulto cerrado.\n2. Transparencia Cambiaria: Facturación 100% a tasa oficial BCV (${rate.toFixed(2)} Bs/USD).\n3. Respuesta en 24h: Entrega directa en su oficina o almacén en Caracas.\n4. Procura Integral: Si requiere algún insumo adicional fuera de lista, nuestro equipo se lo ubica de inmediato.\n\nQuedo atento a su confirmación. ¿Para qué localidad de Caracas coordinamos la entrega?\n\nCordialmente,\n${sName}\nAsesor Comercial B2B | JJ Paper C.A.`,
        `Atención: ${recipient}\nPresente.-\n\nPor medio de la presente, JJ Paper C.A. (RIF J-295375450) somete a su consideración nuestra oferta formal de suministro de papelería, archivo y consumibles operativos.${customBlock}\nRESUMEN DE TÉRMINOS OPERATIVOS:\n• Validez de la oferta: Garantizada sobre inventario disponible.\n• Base de cálculo en Bolívares: Tasa Oficial del Banco Central de Venezuela (${rate.toFixed(2)} Bs/USD).\n• Modalidades de pago: Transferencia bancaria nacional, Pago Móvil, Zelle o divisas en efectivo.\n• Logística: Transporte propio en el Área Metropolitana de Caracas.\n\nAgradecemos nos indique su conformidad para emitir la factura fiscal correspondiente y asignar ruta de despacho.\n\nSin otro particular al que hacer referencia,\n\n${sName}\nEjecutivo de Cuentas Corporativas | JJ Paper C.A.`,
        `Estimado(a) ${recipient},\n\n¡Excelente día! Le saluda ${sName} desde JJ Paper C.A.\n\nLe comparto nuestra propuesta optimizada con los precios más competitivos de Caracas en papelería y suministros:${customBlock}\n• 🏭 Stock real en bodega listo para salir hoy mismo.\n• 🧾 Factura fiscal a tasa BCV (${rate.toFixed(2)} Bs/USD).\n• 🚚 Delivery corporativo directo a su sede.\n\n¿Confirmamos las cantidades para reservar su pedido antes del cierre de ruta de hoy?\n\nSaludos cordiales,\n${sName}\nJJ Paper C.A.`
      ];
      return {
        subject: quoteSubjects[v],
        body: quoteBodies[v]
      };
    }
  }

  /* --------------------------------------------------------------------------
     3.1. SUITE DE 5 MODOS ESTRATÉGICOS DE VENTAS (JJ PAPER)
     1. oferta_producto: Oferta de Producto Específico
     2. reactivacion: Reactivación de Clientes Inactivos
     3. combo: Combo o Paquete Comercial
     4. presentacion_b2b: Presentación Corporativa B2B por Primera Vez
     5. cotizacion_seguimiento: Respuesta Rápida y Cierre de Cotización
     -------------------------------------------------------------------------- */
  async function draftStrategicSalesMessage({
    mode = 'oferta_producto',
    channel = 'email', // 'email' o 'whatsapp'
    customer = {},     // { name, company, email, phone, tags, notes, historySummary }
    product = {},      // { name, price_usd, price_bs, unit, brand, sku, description }
    combo = {},        // { name, items, price_usd, price_bs, savings_usd }
    quote = {},        // { quote_num, items, total_usd, total_bs, validity_days }
    notes = '',        // Notas libres del vendedor
    sellerName = 'Equipo Comercial JJ Paper',
    sellerPhone = '0412-2830185'
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = (typeof getRate === 'function') ? getRate() : (w.APP?.EXCHANGE_RATE || 866.56);
    
    const clientName = customer.name || customer.company || 'Estimado Cliente';
    const isWa = channel === 'whatsapp';

    let modeInstructions = '';
    if (mode === 'oferta_producto') {
      const prodName = product.name || 'Producto Destacado';
      const pUsd = (product.price_usd || 0).toFixed(2);
      const pBs = (product.price_bs || (product.price_usd || 0) * rate).toFixed(2);
      const unit = product.unit || 'unidad';
      modeInstructions = `MODO: Oferta de Producto Específico.
- Producto: ${prodName} ${product.brand ? `(Marca: ${product.brand})` : ''}
- Presentación / Unidad: ${unit}
- Precio Oficial: $${pUsd} USD (Bs ${pBs} a tasa oficial BCV de ${rate.toFixed(2)} Bs).
- Beneficios a destacar: Disponibilidad inmediata en almacén, calidad garantizada, despacho directo en Caracas o envíos nacionales con factura fiscal SENIAT.
- Objetivo: Presentar el producto de forma contundente y cerrar el pedido o consultar cuántas unidades apartar.`;
    } else if (mode === 'reactivacion') {
      modeInstructions = `MODO: Reactivación de Cliente Inactivo.
- Historial / Notas del Cliente: ${customer.historySummary || customer.notes || 'Cliente recurrente que hace un tiempo no repone inventario con nosotros.'}
- Beneficio de Reactivación: Flete preferencial o bonificado en Caracas a partir de compras mínimas, precios congelados a tasa oficial BCV (${rate.toFixed(2)} Bs).
- Tono: Muy cordial, humano y cercano. Reconocer la relación previa sin reproches ni sonar insistente.
- Objetivo: Consultar cómo están de stock de papelería/suministros esta semana y ofrecer enviar lista de precios o cotización formal.`;
    } else if (mode === 'combo') {
      const comboName = combo.name || 'Combo Especial JJ Paper';
      const comboItems = combo.items || 'Suministros varios de oficina y papelería';
      const comboUsd = (combo.price_usd || 0).toFixed(2);
      const comboBs = (combo.price_bs || (combo.price_usd || 0) * rate).toFixed(2);
      modeInstructions = `MODO: Combo o Paquete Comercial.
- Nombre del Combo: ${comboName}
- Contenido incluido: ${comboItems}
- Precio especial combo: $${comboUsd} USD (Bs ${comboBs} a tasa BCV).
- Ahorro destacado: Ahorro comprobado vs compra individual ${combo.savings_usd ? `(Ahorras aprox $${combo.savings_usd})` : ''}.
- Objetivo: Mostrar el desglose con viñetas limpias, urgencia por cupos/lotes limitados y botón de reserva.`;
    } else if (mode === 'presentacion_b2b') {
      modeInstructions = `MODO: Presentación Corporativa B2B por Primera Vez (Prospección).
- Empresa / Contacto: ${clientName}
- Perfil / Rubro: ${customer.rubro || customer.company || 'Empresa / Institución'}
- Pilares JJ Paper C.A.: Mayoristas directos de papelería, oficina y escolar en Caracas; facturación fiscal SENIAT; despacho directo; tasa oficial BCV sin sobreprecio; crédito corporativo sujeto a evaluación.
- Tono: Corporativo, respetuoso, enfocado en solucionar abastecimiento y optimizar presupuestos.
- Objetivo: Invitar cordialmente a enviarnos una lista de insumos de uso frecuente para emitirles una cotización comparativa sin compromiso.`;
    } else if (mode === 'cotizacion_seguimiento') {
      modeInstructions = `MODO: Respuesta Rápida y Seguimiento a Cotización.
- Datos de Cotización: ${quote.quote_num ? `Cotización N° ${quote.quote_num}` : 'Cotización de materiales'} ${quote.total_usd ? `por un total de $${quote.total_usd.toFixed(2)} USD (Bs ${(quote.total_usd * rate).toFixed(2)})` : ''}.
- Puntos: Confirmar disponibilidad en almacén, validez de precios a tasa oficial BCV (${rate.toFixed(2)} Bs), y tiempos de entrega estimada.
- Objetivo: Acelerar la confirmación de la orden de compra o responder cualquier duda para proceder al despacho.`;
    }

    const sys = getBusinessContext() + `
Eres el Director Comercial Senior de JJ Paper C.A.
Generas correspondencia comercial de altísimo nivel, persuasiva, limpia, orientada al cierre y respetuosa.

CANAL: ${isWa ? 'WhatsApp (mensajes directos, con viñetas, negritas con asteriscos, emojis bien dosificados, máx 120-150 palabras)' : 'Email Corporativo (asunto potente y cuerpo formal con saludo, introducción, desglose, términos y firma)'}.

${modeInstructions}

Notas adicionales del asesor: "${notes || 'Sin notas adicionales'}"
Vendedor responsable: ${sellerName} | Teléfono: ${sellerPhone}

Devuelve EXACTAMENTE un objeto JSON válido:
{
  "subject": "${isWa ? '' : 'Asunto profesional y atractivo para el correo'}",
  "body": "Texto completo del mensaje listo para enviar al cliente",
  "spintax": "Versión alternativa con Spintax {A|B} para envíos masivos anti-bloqueo"
}`;

    const prompt = `Genera la propuesta en formato JSON estricto para ${clientName}.`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.65 });
      const parsed = extractJSON(raw);
      return {
        subject: parsed.subject || (isWa ? '' : `Propuesta Comercial — JJ Paper C.A.`),
        body: parsed.body || '',
        spintax: parsed.spintax || parsed.body || ''
      };
    } catch (e) {
      console.warn('Fallback en draftStrategicSalesMessage:', e.message);
      return {
        subject: isWa ? '' : `Propuesta de Papelería y Suministros — JJ Paper C.A.`,
        body: isWa
          ? `¡Hola, ${clientName}! 👋 Te saluda ${sellerName} de JJ Paper C.A.\n\nQueremos poner a tu disposición nuestra lista mayorista con entrega directa en Caracas y tasa oficial BCV (${rate.toFixed(2)} Bs).\n\n¿Deseas que te compartamos nuestro catálogo o coticemos algún producto en específico?\n\n¡Quedo atento!`
          : `Estimado(a) ${clientName},\n\nEs un placer saludarle de parte de JJ Paper C.A., distribuidores mayoristas de papelería y suministros de oficina en Caracas.\n\nPonenemos a su disposición nuestras mejores condiciones comerciales con facturación SENIAT, tasa oficial BCV (${rate.toFixed(2)} Bs) y despacho directo.\n\nQuedamos a su entera disposición para cotizar los materiales que requiera su empresa.\n\nAtentamente,\n${sellerName}\nJJ Paper C.A. | ${sellerPhone}`,
        spintax: ''
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
    const rate = getEffectiveRate();

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
    _variationCounter++;

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

    const prompt = `Convierte este texto a formato Spintax comercial B2B humano y anti-spam (Semilla #${_variationCounter}):\n\n${baseText.trim()}`;

    try {
      const res = await callGemini({ prompt, systemInstruction: sys, temperature: 0.72 });
      return res.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    } catch (e) {
      let out = baseText.trim();
      out = out
        .replace(/\bdisponibilidad inmediata\b/gi, '{disponibilidad inmediata|inventario listo en almacén|stock físico garantizado}')
        .replace(/\bprecios mayoristas\b/gi, '{precios mayoristas|tarifas directas de distribuidor|condiciones preferenciales por volumen}')
        .replace(/\bcotizaci[oó]n formal\b/gi, '{cotización formal|presupuesto corporativo|proforma detallada}')
        .replace(/\bdespacho inmediato\b/gi, '{despacho inmediato|entrega prioritaria en Caracas|envío directo a su sede}')
        .replace(/\bfacturaci[oó]n fiscal\b/gi, '{facturación fiscal SENIAT|factura legal a tasa BCV|facturación formal}');
      if (!out.includes('{Hola|') && !out.startsWith('{')) {
        out = `{Hola|Buen día|Un cordial saludo|Qué tal} {{nombre}}, {espero que todo marche excelente|un gusto saludarle el día de hoy}.\n\n` + out;
      }
      if (!/\{[^}]*\?[^}]*\}/.test(out)) {
        out += `\n\n{¿Desea que le reservemos inventario hoy?|¿Le preparamos el presupuesto formal sin compromiso?|¿Qué cantidades estima para su próximo pedido?}`;
      }
      return out;
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
     4.1. Taxonomías y Directivas de Negocio (Tonos, Sectores y Ganchos B2B)
     -------------------------------------------------------------------------- */
  const COMMERCIAL_TONE_DIRECTIVES = {
    socio_estrategico: {
      name: '💼 Ejecutivo & Socio Estratégico (Seguridad y Factura BCV)',
      attitude: 'Alianza corporativa a largo plazo, seriedad absoluta, solvencia institucional y confianza.',
      style: 'Formal, respetuoso y ejecutivo. Se enfoca en la continuidad operativa de las sedes del cliente, despacho directo garantizado y facturación legal SENIAT a tasa oficial BCV.',
      opening: '{Hola|Buen día|Un cordial saludo} {{nombre}}, un gusto saludarle.',
      closing: 'Quedamos a su entera disposición para coordinar sus requerimientos operativos o formalizar su cotización formal.'
    },
    oportunidad_mayorista: {
      name: '🔥 Oferta Mayorista & Volumen (Actitud de Cierre y Ahorro)',
      attitude: 'Comercial directa, dinámica, orientada al margen de ganancia, ahorro tangible por bulto/caja y cierre asertivo.',
      style: 'Enérgico y enfocado en la rentabilidad. Destaca el precio de importador directo, el ahorro por escala cerrada y la conveniencia económica frente a compras al detal.',
      opening: '{Hola|Buen día} {{nombre}} 👋, le contactamos con una excelente oportunidad de abastecimiento mayorista.',
      closing: '¿Cuántas cajas o bultos le apartamos para su despacho de esta semana?'
    },
    cercano_consultivo: {
      name: '🤝 Cercano, Asesor y Resolutivo (Atención Directa y Sourcing)',
      attitude: 'Cálida, cordial, de asesor personal accesible que busca resolver cualquier necesidad ("te conseguimos lo que necesites").',
      style: 'Amistoso, atento y servicial. Hace hincapié en que si el cliente busca una marca, gramaje o medida que no esté listada, JJ Paper se lo ubica y cotiza de inmediato.',
      opening: '{Hola|Qué tal} {{nombre}} 👋, ¡un gran gusto saludarte!',
      closing: '¿Qué insumos o papelería estás necesitando en tu sede para apoyarte y pasarte opciones hoy mismo?'
    },
    institucional_formal: {
      name: '🏢 Institucional Formal (Procura y Compras)',
      attitude: 'Protocolar, sobria y orientada a comités de compras, licitaciones, homologación de proveedores y administración.',
      style: 'Estrictamente profesional y sobrio. Pone de relieve la documentación fiscal en regla (RIF J-295375450), cotizaciones formales membretadas y estándares de archivo reglamentario.',
      opening: 'Estimada Gerencia y Dpto. de Compras de {{empresa}}, un cordial saludo.',
      closing: 'Quedamos a la disposición de su departamento de compras para consignar nuestra cotización formal membretada.'
    },
    fidelizado_reactivacion: {
      name: '💎 Cliente VIP / Fidelizado (Trato Preferencial y Confianza)',
      attitude: 'Agradecida, cordial, exclusiva y de reencuentro con un cliente de la casa ("es un placer volver a atenderles").',
      style: 'Afectuoso y distinguido. Trata al cliente como cuenta prioritaria con beneficios exclusivos: reserva de inventario, delivery prioritario bonificado y precios congelados a tasa oficial BCV.',
      opening: '{Hola|Buen día|Un placer saludarle de nuevo} {{nombre}} 👋, es un gusto reencontrarnos.',
      closing: '¿Cómo se encuentran de inventario para esta quincena? Con gusto le coordinamos su entrega con prioridad.'
    }
  };

  const SECTOR_NAMES = {
    colegios: 'Colegios, Universidades y Educación',
    clinicas: 'Clínicas, Hospitales, Salud y Farmacias',
    oficinas: 'Empresas, Oficinas y Corporativo',
    retail: 'Supermercados, Abastos y Retail / Puntos de Venta',
    logistica: 'Industrias, Almacenes y Logística de Distribución',
    papelerias: 'Papelerías y Comercios (Mayorista Reventa)'
  };

  const VALUE_HOOK_DESCS = {
    importador_directo: '🏭 IMPORTADOR DIRECTO EN CARACAS: Enfatiza que somos importadores mayoristas sin intermediarios, con bodega física en Caracas y disponibilidad inmediata.',
    escala_volumen: '📦 ESCALA Y DESCUENTO POR VOLUMEN: Enfatiza el ahorro significativo por bulto/caja cerrada y precio preferencial escalonado para pedidos empresariales.',
    sourcing_especial: '🔍 PROCURA ESPECIAL DE INSUMOS: Deja muy claro que si la empresa requiere alguna medida, gramaje o artículo no listado, nuestro equipo de importación se lo consigue y cotiza directamente.',
    despacho_express: '🚚 DESPACHO EXPRESS 24H Y FACTURA BCV: Enfatiza la entrega rápida y directa en su sede en Caracas y facturación legal en bolívares a tasa oficial BCV.',
    ahorro_mensual: '💰 OPTIMIZACIÓN DE PRESUPUESTO: Enfatiza la asesoría para consolidar compras mensuales de suministros reduciendo costos operativos.'
  };

  /* --------------------------------------------------------------------------
     4.2. Redactor Inteligente de Campañas Comerciales B2B (WhatsApp y Email)
     Cambia genuinamente el tono, el formato visual, la estructura y el ángulo
     comercial en cada clic y según los selectores de tono/gancho.
     -------------------------------------------------------------------------- */
  async function draftCampaignMessage({
    objective = 'promocion',
    product = null,
    products = [],
    discount = '',
    audience = 'todos',
    channel = 'whatsapp',
    customNotes = '',
    customInstructions = '',
    sellerName = '',
    tone = 'Profesional y Persuasivo (Vendedor Consultivo)',
    valueHook = 'importador_directo',
    formatStyle = '',
    historyContext = ''
  }) {
    _variationCounter++;
    const w = typeof window !== 'undefined' ? window : {};
    const rate = getEffectiveRate();

    let prodsList = (Array.isArray(products) && products.length > 0) ? products : (product ? [product] : []);
    if (prodsList.length === 0) {
      try {
        const fetched = await fetchRealPortfolioProducts(4, targetSector, (customInstructions || customNotes || objective || ''));
        if (fetched && fetched.length > 0) {
          prodsList = fetched;
        }
      } catch (_) {}
    }

    const effectiveSector = (targetSector && targetSector !== 'auto' && SECTOR_NAMES[targetSector])
      ? SECTOR_NAMES[targetSector]
      : (targetSector !== 'auto' ? targetSector : 'Empresas y Comercios B2B');

    const effectiveHook = VALUE_HOOK_DESCS[valueHook] || VALUE_HOOK_DESCS.importador_directo;
    const toneConfig = COMMERCIAL_TONE_DIRECTIVES[tone] || COMMERCIAL_TONE_DIRECTIVES.socio_estrategico;

    // Directivas de control del usuario
    let customDirectives = '';
    const userDirectives = (customInstructions || customNotes || '').trim();
    if (userDirectives) {
      customDirectives += `\n⭐ INSTRUCCIONES ESPECÍFICAS Y MANDATORIAS DEL ASESOR (MÁXIMA PRIORIDAD):\n"${userDirectives}"\nDEBES CUMPLIR ESTAS INDICACIONES ESTRICTAMENTE EN EL MENSAJE.\n`;
    }
    if (msgLength === 'short') {
      customDirectives += `\n📏 LONGITUD REQUERIDA: ULTRA-CONCISO (máximo 4 a 6 renglones en WhatsApp, o menos de 75 palabras en Email). Sin introducciones largas, ve directo al grano.\n`;
    } else if (msgLength === 'detailed') {
      customDirectives += `\n📏 LONGITUD REQUERIDA: DETALLADO Y COMPLETO. Desarrolla a fondo beneficios, especificaciones de los insumos y formalidades operativas.\n`;
    } else {
      customDirectives += `\n📏 LONGITUD REQUERIDA: EQUILIBRADO B2B. Estructura comercial estándar, ágil y ejecutiva.\n`;
    }
    if (priceMode === 'no_prices') {
      customDirectives += `\n💰 MANEJO DE PRECIOS: ¡ESTRICTAMENTE PROHIBIDO COLOCAR PRECIOS NUMÉRICOS! Solo menciona la disponibilidad de los artículos y ofrece cotizar a medida según su consumo o volumen.\n`;
    } else if (priceMode === 'bulk_only') {
      customDirectives += `\n💰 MANEJO DE PRECIOS: Enfatiza los precios y descuentos por bulto cerrado o caja master.\n`;
    } else {
      customDirectives += `\n💰 MANEJO DE PRECIOS: Expresa el precio oficial en USD y su equivalente en Bs a Tasa Oficial BCV.\n`;
    }
    if (ctaGoal === 'quote') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Ofrecer consignar una cotización formal membretada de inmediato.\n`;
    } else if (ctaGoal === 'inventory') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Preguntar de forma consultiva por su reposición quincenal de inventario.\n`;
    } else if (ctaGoal === 'catalog') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Invitar a revisar el catálogo digital o la lista PDF oficial.\n`;
    } else if (ctaGoal === 'meeting') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Proponer coordinar una llamada breve o una visita con muestras en su sede corporativa.\n`;
    }

    // Extracción de especificaciones técnicas y comerciales del producto o combo / listado múltiple
    let prodSpecs = '';
    const showPrices = (priceMode !== 'no_prices');
    if (prodsList.length > 0) {
      prodSpecs = `
LISTADO OFICIAL DE PRODUCTOS EN OFERTA / PROMOCIÓN (${prodsList.length} artículos):
` + prodsList.map((p) => {
        const pName = p.name || 'Artículo de Catálogo';
        const pBrand = p.brand || p.brands || (p.brand && typeof p.brand === 'object' ? p.brand.name : '') || '';
        const pUnit = p.unit || 'unidad';
        const pSku = p.sku ? `(Ref: ${p.sku})` : '';
        const priceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const priceBs = priceUsd > 0 ? (priceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        const disc = p.discount_pct ? `[${p.discount_pct}% desc.]` : '';
        const priceTxt = showPrices ? `Precio Oferta: $${priceUsd.toFixed(2)} USD (Bs. ${priceBs}) ${disc}` : `Disponibilidad inmediata para cotización formal`;
        return `• ${pName} ${pBrand ? `· Marca: ${pBrand}` : ''} ${pSku} | Presentación: ${pUnit} | ${priceTxt}`;
      }).join('\n') + '\n';
    }

    const archetype = _detectToneArchetype(tone, valueHook, `${objective} ${formatStyle}`);

    const sys = getBusinessContext() + `
Eres el Especialista y Director Comercial B2B Sénior de JJ Paper C.A., empresa IMPORTADORA Y DISTRIBUIDORA DIRECTA mayorista en Caracas, Venezuela.
Tu objetivo es redactar un mensaje comercial para ${channel === 'email' ? 'Correo Electrónico' : 'WhatsApp'} que obedezca rigurosamente el TONO y FORMATO solicitado:
- Arquetipo de Tono / Formato activo: "${archetype}" (${tone})
- Gancho de Valor Principal: "${valueHook}"
- Iteración creativa #${_variationCounter}: ¡PROHIBIDO repetir plantillas rígidas! Cambia completamente la estructura visual, los encabezados, el saludo y el ritmo respecto a versiones anteriores.

REGLAS SEGÚN EL TONO / FORMATO SELECCIONADO:
- Si es "oportunidad_mayorista": Usa formato de Oportunidad Flash / Lote Mayorista con urgencia elegante, énfasis en ahorro por volumen/bulto cerrado y bloqueo de stock.
- Si es "cercano_consultivo": Usa formato conversacional humano de Asesor Personal (sin títulos de cartel publicitario), enfocándote en resolver requerimientos, procura especial y trato cercano.
- Si es "institucional_formal": Usa formato Corporativo Ejecutivo (Procura / Licitaciones / Administración), sobrio, sin exceso de emojis, resaltando RIF J-295375450, facturación fiscal SENIAT y tasa oficial BCV.
- Si es "directo_ejecutivo": Usa formato Ultra-Conciso al grano (máximo 8-10 líneas), ideal para gerentes ocupados: 1 línea de saludo, viñetas directas y pregunta de cierre.
- Si es "optimizacion_costos": Usa formato Analítico de Ahorro Presupuestario, comparando compra directa de importador vs. intermediarios.
- Si es "socio_estrategico": Usa formato de Alianza de Suministro Continuo B2B con estructura clara, beneficios logísticos y procura integral.

Devuelve EXACTAMENTE un objeto JSON válido (sin markdown exterior):
- Si channel === 'email': { "subject": "Asunto adaptado al tono", "body": "Cuerpo completo" }
- Si channel === 'whatsapp': { "body": "Cuerpo completo adaptado al tono y formato con Spintax {A|B|C}" }
`;

    const prompt = `
Sector Objetivo: ${effectiveSector}
Propuesta de Valor / Gancho Principal: ${effectiveHook}
Tono y Actitud Comercial: ${toneConfig.name} (${toneConfig.style})
Propósito o Requerimiento del Asesor: ${objective}
Contexto Histórico / Relación: ${historyContext || 'Sin contexto especial'}
Personalidad / Tono Requerido: ${tone} (Arquetipo: ${archetype}, Semilla #${_variationCounter})
Gancho de Valor: ${valueHook}
Canal: ${channel}
Segmento de Audiencia: ${audience}
${prodSpecs}
Condición Especial: ${discount || 'Precios directos de distribuidora mayorista'}
Asesor emisor: ${sellerName || 'Equipo Comercial JJ Paper'}
${customDirectives}

Redacta el mensaje comercial obedeciendo estrictamente el tono y formato "${archetype}" en JSON:`;

    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.82 });
      return extractJSON(raw);
    } catch (e) {
      const isEmail = channel === 'email';
      const v = _variationCounter;
      const itemsBullets = prodsList.map((p) => {
        const pName = p.name || 'Artículo';
        const priceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const priceBs = priceUsd > 0 ? (priceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        const unit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
        const discBadge = p.discount_pct ? ` _(-${p.discount_pct}% Off)_` : '';
        if (archetype === 'institucional_formal') {
          return `  - ${pName}${unit}: USD $${priceUsd.toFixed(2)} (Equiv. Bs. ${priceBs} BCV)${discBadge}`;
        }
        if (archetype === 'directo_ejecutivo') {
          return `▪️ *${pName}*${unit} ➔ *$${priceUsd.toFixed(2)}* (Bs. ${priceBs})`;
        }
        return `• *${pName}*${unit}: *$${priceUsd.toFixed(2)} USD* | Bs. ${priceBs}${discBadge}`;
      }).join('\n');

      const fallbackTopic = itemsBullets || `• *${objective || 'Suministro integral de papelería, resmas Bond, archivo y consumibles de oficina'}*`;
      const extraNoteLine = customNotes && customNotes.trim() ? `\n📌 _Nota: ${customNotes.trim()}_\n` : '';
      const discountLine = discount && discount.trim() ? `\n🏷️ *Condición especial:* ${discount.trim()}\n` : '';

      if (isEmail) {
        if (archetype === 'oportunidad_mayorista') {
          return {
            subject: prodsList.length === 1
              ? `⚡ Lote Mayorista Preferencial: ${prodsList[0].name} — JJ Paper C.A.`
              : `🔥 Condiciones Especiales por Volumen (Stock Limitado) — JJ Paper C.A.`,
            body: `{Hola|Buen día} {{nombre}},\n\nLe escribe {{vendedor}} de JJ Paper C.A. Hoy habilitamos en nuestro almacén de Caracas un lote con condiciones preferenciales de importador directo para rotación inmediata:\n\nLOTE EN CONDICIÓN ESPECIAL (TASA BCV ${rate.toFixed(2)} Bs):\n${fallbackTopic}${discountLine}${extraNoteLine}\n¿Por qué aprovechar este lote hoy?\n1. Precio directo de distribuidor mayorista sin intermediarios.\n2. Facturación fiscal SENIAT a tasa oficial BCV.\n3. Bloqueo de stock inmediato y despacho gratis en Caracas.\n\nCatálogo en línea: {{link}}\n\n¿Cuántas cajas o unidades le reservamos antes del cierre de despacho de esta semana?\n\nSaludos cordiales,\n{{vendedor}}\nJJ Paper C.A.`
          };
        }
        if (archetype === 'cercano_consultivo') {
          return {
            subject: `🤝 Apoyo en suministros y procura de oficina para su empresa — JJ Paper`,
            body: `{Hola|Qué tal|Buen día} {{nombre}}, espero que todo marche muy bien en sus operaciones.\n\nLe saluda {{vendedor}} de JJ Paper C.A. Quería ponerme a su disposición esta semana para apoyarles con la reposición de papelería y consumibles de su oficina, destacando estas opciones que tenemos listas para entrega:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\nAdemás, recuerde que contamos con nuestro servicio de Procura Especial: si necesitan cualquier otro artículo, medida o marca que no aparezca aquí, nosotros nos encargamos de ubicarlo y despacharlo directamente en su sede.\n\nPuede revisar nuestro catálogo completo aquí: {{link}}\n\n¿Tienen algún requerimiento pendiente esta semana en el que les pueda ayudar con una cotización rápida?\n\nUn abrazo cordial,\n{{vendedor}}\nAsesor Comercial | JJ Paper C.A.`
          };
        }
        if (archetype === 'institucional_formal') {
          return {
            subject: `Propuesta Formal de Suministro Corporativo (RIF J-295375450) — JJ Paper C.A.`,
            body: `Estimada Gerencia de Compras y Administración ({{nombre}}),\nPresente.-\n\nReciban un cordial saludo institucional en nombre de JJ Paper C.A., empresa importadora y distribuidora mayorista de papelería corporativa, archivo reglamentario e insumos operativos en Caracas.\n\nPor medio de la presente, sometemos a su consideración nuestra disponibilidad actualizada bajo condiciones corporativas:\n\nRELACIÓN DE INSUMOS DISPONIBLES:\n${fallbackTopic}${discountLine}${extraNoteLine}\nGARANTÍAS OPERATIVAS Y FISCALES:\n- Facturación fiscal formal conforme a normativas del SENIAT a Tasa Oficial BCV (${rate.toFixed(2)} Bs/USD).\n- Despacho directo sin recargo en el Área Metropolitana de Caracas.\n- Homologación de proveedores y atención prioritaria a cuentas jurídicas.\n\nCatálogo corporativo digital: {{link}}\n\nQuedamos a su disposición para emitir la cotización proforma bajo los requerimientos de su departamento.\n\nAtentamente,\n{{vendedor}}\n Ejecutivo de Cuentas Corporativas | JJ Paper C.A.`
          };
        }
        if (archetype === 'directo_ejecutivo') {
          return {
            subject: `Resumen Ejecutivo de Precios Mayoristas — JJ Paper C.A.`,
            body: `Buen día {{nombre}},\n\nLe comparto de forma directa la disponibilidad y precios mayoristas vigentes en JJ Paper C.A. (Tasa BCV: ${rate.toFixed(2)} Bs/USD) para despacho inmediato en Caracas:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n• Factura fiscal SENIAT y delivery corporativo incluido.\n• Catálogo completo: {{link}}\n\n¿Le emito la cotización formal por alguno de estos renglones hoy?\n\nAtentamente,\n{{vendedor}} | JJ Paper C.A.`
          };
        }
        // Default / socio_estrategico / optimizacion_costos
        return {
          subject: `💼 Optimización de Costos en Papelería y Suministros — JJ Paper C.A.`,
          body: `{Estimado(a)|Apreciado(a)} {{nombre}},\n\nUn gusto saludarle. Le escribe {{vendedor}} desde JJ Paper C.A., su socio estratégico de abastecimiento directo en Caracas.\n\nPara ayudarles a reducir costos operativos mensuales comprando directamente a nivel de importador (sin revendedores), ponemos a su alcance nuestro inventario actual:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\nVENTAJAS COMPETITIVAS PARA SU EMPRESA:\n• Ahorro real por escala mayorista en cajas y bultos.\n• Facturación transparente 100% a tasa oficial BCV (${rate.toFixed(2)} Bs/USD).\n• Servicio de búsqueda (Sourcing) para cualquier insumo adicional.\n\nCatálogo digital: {{link}}\n\n¿Desea que le preparemos un comparativo o cotización formal para las compras de este mes?\n\nCordialmente,\n{{vendedor}}\nJJ Paper C.A.`
        };
      }

      // ══════ CANAL WHATSAPP: 6 FORMATOS Y TONOS COMPLETAMENTE DISTINTOS ══════
      if (archetype === 'oportunidad_mayorista') {
        const headers = [
          `*🔥 LOTE MAYORISTA CON PRECIO DE IMPORTADOR · JJ PAPER*`,
          `*⚡ OPORTUNIDAD POR VOLUMEN (STOCK EN CARACAS) · JJ PAPER*`,
          `*📦 CONDICIÓN ESPECIAL DE DISTRIBUIDOR DIRECTO · JJ PAPER*`
        ];
        return {
          body: `${headers[v % headers.length]}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Buen día|Qué tal} {{nombre}} 👋, le escribe *{{vendedor}}* de *JJ Paper C.A.*\n\nHoy liberamos en almacén condiciones especiales por volumen con entrega inmediata en Caracas:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n*🚀 VENTAJAS DE ESTE LOTE:*\n• 🏭 *Precio directo de importador* (máximo margen y ahorro por bulto/caja).\n• 🧾 *Factura Fiscal Legal* calculada estrictamente a Tasa BCV (${rate.toFixed(2)} Bs).\n• 🚚 *Despacho exprés gratuito* directo a su local o empresa.\n\n👉 Catálogo en vivo: {{link}}\n\n💬 *¿Cuántas unidades o cajas le apartamos en sistema antes de cerrar la ruta de hoy?*\n\n— *{{vendedor}}* | JJ Paper C.A.`
        };
      }

      if (archetype === 'cercano_consultivo') {
        const intros = [
          `{Hola|Buen día|Qué tal} {{nombre}}, ¿cómo estás? 👋 Te escribe *{{vendedor}}* de *JJ Paper*.`,
          `{Hola|Un gusto saludarte} {{nombre}} 👋, espero que todo vaya excelente en tu semana. Te habla *{{vendedor}}* de *JJ Paper*.`,
          `{Buen día|Hola} {{nombre}} 🤝, paso por aquí brevemente. Te saluda *{{vendedor}}* del equipo de *JJ Paper*.`
        ];
        return {
          body: `${intros[v % intros.length]}\n\nEstaba revisando las opciones de reposición para esta semana y quería pasarte de primera mano estos artículos que nos acaban de entrar a excelente precio:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n💡 *Tip de apoyo:* Recuerda que si estás buscando algún otro artículo, formato o marca que no veas aquí, *me avisas con confianza y te lo ubicamos de inmediato* con nuestra red mayorista.\n\nTodo sale con su factura fiscal a tasa BCV (${rate.toFixed(2)} Bs) y te lo llevamos directo a la puerta de tu oficina en Caracas 🚚.\n\n👉 Mira todo el catálogo aquí: {{link}}\n\n¿Cómo están de stock esta semana? ¿Te armo un presupuesto rápido sin compromiso?`
        };
      }

      if (archetype === 'institucional_formal') {
        return {
          body: `*COMUNICACIÓN COMERCIAL CORPORATIVA · JJ PAPER C.A. (RIF J-295375450)*\n────────────────────────────────────\n{Estimado(a)|Apreciado(a)} {{nombre}}, reciba un cordial saludo institucional.\n\nSe dirige a usted *{{vendedor}}*, Ejecutivo Comercial de *JJ Paper C.A.*, distribuidora mayorista de papelería corporativa, archivo reglamentario y suministros de oficina en Caracas.\n\nSometemos a consideración de su Departamento de Compras nuestra disponibilidad inmediata:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n*RESPALDO INSTITUCIONAL Y TRIBUTARIO:*\n• Facturación fiscal formal conforme a normativas del SENIAT.\n• Cálculo transparente a Tasa Oficial del Banco Central de Venezuela (${rate.toFixed(2)} Bs/USD).\n• Despacho corporativo sin costo en el Área Metropolitana de Caracas.\n• Atención a requerimientos especiales de procura y licitación.\n\n🔗 Catálogo Corporativo: {{link}}\n\n¿Desea que emitamos la cotización formal a nombre de su razón social para evaluación administrativa?\n\nAtentamente,\n*{{vendedor}}* | Dirección Comercial JJ Paper C.A.`
        };
      }

      if (archetype === 'directo_ejecutivo') {
        return {
          body: `{Buen día|Hola} {{nombre}} 👋 · *Resumen Flash JJ Paper C.A.*\n\nLe saluda *{{vendedor}}*. Comparto directo al grano nuestro stock mayorista listo para despacho hoy en Caracas (BCV: ${rate.toFixed(2)} Bs):\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n✅ *Incluye:* Factura fiscal SENIAT + Delivery corporativo gratis en Caracas + Procura de cualquier insumo adicional.\n🔗 *Catálogo:* {{link}}\n\n⚡ *¿Le cotizo formalmente alguno de estos ítems o le reservo unidades para entrega mañana?*`
        };
      }

      if (archetype === 'optimizacion_costos') {
        return {
          body: `*💰 OPTIMIZACIÓN DE PRESUPUESTO EN SUMINISTROS · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Buen día} {{nombre}}, un gusto saludarle. Le escribe *{{vendedor}}* de *JJ Paper C.A.*\n\nSabemos lo importante que es cuidar la estructura de costos operativos cada mes. Como *importadores directos en Caracas*, eliminamos la cadena de intermediarios para ofrecerle ahorro real en:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n*📊 ¿CÓMO OPTIMIZAMOS SU COMPRA?* \n• *Precio Mayorista Real:* Escalas de descuento desde cajas y bultos.\n• *Cero Diferencial Cambiario:* Factura legal a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• *Cero Gasto de Flete:* Transporte propio gratuito en Caracas.\n• *Sourcing Integral:* Consolidamos todos sus insumos en una sola factura.\n\n👉 Catálogo digital: {{link}}\n\n💬 ¿Me permite enviarle una cotización comparativa para su compra de este mes?\n\nCordialmente,\n*{{vendedor}}* | Asesor B2B · JJ Paper C.A.`
        };
      }

      // Arquetipo 'socio_estrategico' con variación rotativa
      return {
        body: `*🏢 ALIANZA DE ABASTECIMIENTO MAYORISTA · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Qué tal|Buen día} {{nombre}}, un cordial saludo 👋\n\nLe escribe *{{vendedor}}* de *JJ Paper C.A.*, su aliado mayorista directo de papelería, consumibles de facturación y embalaje en Caracas.\n\nPara respaldar la continuidad operativa de su empresa esta semana, ponemos a su disposición inventario físico garantizado en:\n\n${fallbackTopic}${discountLine}${extraNoteLine}\n*💎 NUESTRO COMPROMISO COMO SOCIO COMERCIAL:*\n• 🏭 *Importador Directo:* Stock real en almacén sin intermediarios.\n• 🧾 *Facturación SENIAT:* 100% a Tasa Oficial BCV (${rate.toFixed(2)} Bs).\n• 🚚 *Logística Propia:* Entrega puntual en su sede.\n• 🔍 *Procura Especial:* ¿Necesita un formato o marca específica? Se lo ubicamos de inmediato.\n\n👉 Catálogo interactivo: {{link}}\n\n💬 *¿Qué artículos o cantidades desea que le incluya en su cotización de esta semana?*\n\nAtentamente,\n*{{vendedor}}* | Asesor Comercial JJ Paper C.A.`
      };
    }
  }

  /* --------------------------------------------------------------------------
     4.3. Analizador Comercial B2B de Prospectos e Hiper-Personalización (IA)
     Analiza Sector, Empresa, Cargo y Ubicación, deduce necesidades operativas,
     selecciona ángulo del banco dinámico y redacta correo (130-180 palabras)
     y WhatsApp adaptados con Spintax.
     -------------------------------------------------------------------------- */

  let _realPortfolioCache = null;
  let _realPortfolioCacheAt = 0;

  // Trae productos REALES del catálogo con selección dinámica según sector y objetivo
  async function fetchRealPortfolioProducts(maxOverall = 14, targetSector = 'auto', objective = '') {
    const w = typeof window !== 'undefined' ? window : {};
    let list = (Array.isArray(w.allProducts) && w.allProducts.length) ? w.allProducts : null;
    if (!list) {
      try {
        const s = sessionStorage.getItem('jjp_products_cache_v4') || sessionStorage.getItem('jjp_catalog_flat');
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

    const rate = getEffectiveRate();
    const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Agrupaciones temáticas según sector
    const sec = String(targetSector || '').toLowerCase();
    let groups = [];

    if (sec.includes('colegio') || sec.includes('educacion') || sec.includes('escuela')) {
      groups = [
        { kw: ['cuaderno', 'libreta', 'engrapado', 'espiral'] },
        { kw: ['marcador', 'pizarra', 'acrilico', 'recargable'] },
        { kw: ['lapiz', 'borrador', 'sacapuntas', 'creyon', 'color'] },
        { kw: ['resaltador', 'marcador al agua', 'punta fina'] },
        { kw: ['tempera', 'tijera', 'pega', 'silicon'] },
        { kw: ['hoja examen', 'papel bond', 'cartulina', 'resma'] }
      ];
    } else if (sec.includes('clinica') || sec.includes('salud') || sec.includes('hospital')) {
      groups = [
        { kw: ['carpeta', 'fibra', 'manila', 'oficio'] },
        { kw: ['sobre', 'manila', 'blanco', 'media carta', 'oficio'] },
        { kw: ['resma', 'papel bond', 'carta', 'oficio'] },
        { kw: ['boligrafo', 'gel', 'tinta aceite', 'lapicero'] },
        { kw: ['grapadora', 'clip', 'perforadora'] },
        { kw: ['rollo', 'termico', 'ticketera'] }
      ];
    } else if (sec.includes('supermercado') || sec.includes('retail') || sec.includes('comercio')) {
      groups = [
        { kw: ['rollo', 'termico', 'pos', 'caja fiscal', '57mm', '80mm'] },
        { kw: ['cinta', 'embalaje', 'tirro', 'transparente', 'marron'] },
        { kw: ['dispensador', 'porta tirro', 'pistola'] },
        { kw: ['marcador', 'permanente', 'indeleble', 'gruesa'] },
        { kw: ['talonario', 'recibo', 'nota de entrega'] },
        { kw: ['boligrafo', 'lapicero'] }
      ];
    } else if (sec.includes('restaurante') || sec.includes('alimento')) {
      groups = [
        { kw: ['rollo', 'termico', 'comanda', '57mm', '80mm'] },
        { kw: ['boligrafo', 'lapicero', 'negro', 'azul'] },
        { kw: ['cinta', 'embalaje', 'tirro'] },
        { kw: ['talonario', 'comanda', 'recibo'] }
      ];
    } else if (sec.includes('papeleria') || sec.includes('libreria')) {
      groups = [
        { kw: ['resma', 'papel bond', 'carta', 'oficio'] },
        { kw: ['cuaderno', 'libreta', 'espiral'] },
        { kw: ['marcador', 'resaltador', 'sharpie', 'kores'] },
        { kw: ['boligrafo', 'lapiz', 'creyones'] },
        { kw: ['carpeta', 'sobre', 'archivador'] },
        { kw: ['cinta', 'pega', 'silicon', 'tijera'] }
      ];
    } else {
      // General equilibrado
      groups = [
        { kw: ['resma', 'papel bond', 'carta', 'oficio'] },
        { kw: ['cuaderno', 'libreta', 'engrapado', 'espiral'] },
        { kw: ['boligrafo', 'lapiz', 'resaltador', 'marcador'] },
        { kw: ['carpeta', 'archivador', 'sobre'] },
        { kw: ['cinta', 'embalaje', 'tirro', 'pega', 'silicon'] },
        { kw: ['grapadora', 'perforadora', 'tijera', 'clip'] },
        { kw: ['rollo', 'termico', 'pos', 'caja fiscal'] }
      ];
    }

    // Si el asesor especificó un objetivo con palabras clave, anteponer ese grupo prioritario
    const objWords = norm(objective).split(/\s+/).filter(w => w.length >= 4);
    if (objWords.length > 0) {
      groups.unshift({ kw: objWords });
    }

    // Barajar ligeramente grupos para asegurar variedad dinámica
    const shuffledGroups = [...groups].sort(() => 0.5 - Math.random());

    const picked = [];
    const seen = new Set();

    for (const g of shuffledGroups) {
      const scored = (list || []).map(p => {
        const full = norm(`${p.name || ''} ${p.sku || ''} ${p.description || ''}`);
        let s = 0;
        for (const kw of g.kw) if (full.includes(norm(kw))) s++;
        return { p, s };
      }).filter(x => x.s >= 1)
        .sort((a, b) => b.s - a.s);

      // Barajar los mejores candidatos para no elegir siempre el primero
      const topCandidates = scored.slice(0, 4).sort(() => 0.5 - Math.random()).slice(0, 2);

      for (const { p } of topCandidates) {
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
    products = [],
    officialPdfIncluded = true,
    channel = 'both',
    customerFull = null,
    orderHistory = '',
    personality = 'Profesional / Formal',
    messageType = 'Presentación Inicial',
    targetSector = 'auto',
    commercialTone = 'socio_estrategico',
    valueHook = 'importador_directo',
    customInstructions = '',
    msgLength = 'balanced',
    priceMode = 'with_prices',
    ctaGoal = 'quote',
    baseMessageText = '',
    baseSubjectText = ''
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = getEffectiveRate();

    const prodsList = (Array.isArray(products) && products.length > 0)
      ? products
      : (promoProductOrCombo ? (Array.isArray(promoProductOrCombo.products) ? promoProductOrCombo.products : [promoProductOrCombo]) : []);

    const effectiveSector = (targetSector && targetSector !== 'auto' && SECTOR_NAMES[targetSector])
      ? SECTOR_NAMES[targetSector]
      : (sector || 'Sector Comercial B2B');

    const effectiveHook = VALUE_HOOK_DESCS[valueHook] || VALUE_HOOK_DESCS.importador_directo;
    const toneConfig = COMMERCIAL_TONE_DIRECTIVES[commercialTone] || COMMERCIAL_TONE_DIRECTIVES.socio_estrategico;

    let advisorDirective = '';
    if (baseMessageText && baseMessageText.trim().length > 10) {
      advisorDirective = `
================================================================================
🚨 DIRECTIVA MAESTRA Y OBLIGATORIA DEL ASESOR COMERCIAL:
El asesor comercial ha configurado la siguiente PROPUESTA BASE / PLANTILLA para esta campaña:

"""
${baseMessageText.trim()}
"""

INSTRUCCIONES MANDATORIAS DE ADAPTACIÓN:
1. TU MISIÓN ES ADAPTAR Y PERSONALIZAR ESTA PROPUESTA BASE EXACTA PARA ${companyName} (${contactName ? 'Contacto: ' + contactName : ''}).
2. PROHIBICIÓN ESTRICTA: QUEDA TOTALMENTE PROHIBIDO sustituir los productos de esta propuesta por "rollos térmicos", "carpetas de fibra" o "resmas" a menos que la propuesta base del asesor hable de ellos. Si el asesor escribió sobre un producto específico (como cintas, marcadores, bolígrafos, cuadernos o papelería), DEBES MANTENER ESOS PRODUCTOS EXACTOS como eje central.
3. Personaliza el saludo y la conexión con el sector de ${companyName} (${effectiveSector || 'Comercial'}), pero CONSERVA el núcleo de la oferta, los llamados a la acción, los enlaces (como {{link}} o https://jjpaper.pages.dev/catalogo) y datos de contacto.
================================================================================
`;
    }

    // ── Catálogo REAL con precio actualizado ──
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

    let promoInfo = '';
    if (prodsList.length > 0) {
      promoInfo = `
ATENCIÓN CRÍTICA - OFERTA / PRODUCTOS COMERCIALES SELECCIONADOS POR EL ASESOR (${prodsList.length} artículos):
` + prodsList.map((p, idx) => {
        const pName = p.name || 'Artículo de Catálogo';
        const pPriceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const pPriceBs = pPriceUsd > 0 ? (pPriceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        const pUnit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
        return `• *${pName}*${pUnit}: *$${pPriceUsd.toFixed(2)} USD* (Bs. ${pPriceBs})`;
      }).join('\n') + `
DIRECTIVA MANDATORIA DE OFERTA: La propuesta comercial DEBE presentar EXACTAMENTE estos productos con sus precios bajo el tono "${toneConfig.name}". NO sustituyas estos productos por otros artículos ni inventes precios. Personaliza el saludo y conecta con la actividad de ${companyName}, pero mantén esta oferta intacta como el centro de la propuesta.`;
    }

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
    if (prodsList.length > 0) {
      const itemsFormatted = prodsList.map(p => {
        const pName = p.name || 'Artículo';
        const pPriceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const pPriceBs = pPriceUsd > 0 ? (pPriceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        const pUnit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
        return `• *${pName}*${pUnit}: *$${pPriceUsd.toFixed(2)} USD* | Bs. ${pPriceBs}`;
      }).join('\n');

      let toneGreeting = `{Hola|Buen día|Un gusto saludarle} ${contactName || companyName} 👋, un cordial saludo.`;
      let toneOpening = `{Le saluda|Le escribe} *${sellerName}* de *JJ Paper C.A.* Conociendo la continua actividad de ${companyName} en ${city || 'Caracas'}, hoy queríamos presentarle condiciones mayoristas preferenciales y disponibilidad inmediata en nuestro lote seleccionado:`;
      let toneClosing = `{¿Desea que le preparemos una cotización formal para su empresa?|¿Gusta que le reservemos disponibilidad para su despacho de esta semana?|Quedamos a su entera disposición para coordinar su pedido.}`;

      if (commercialTone === 'fidelizado_reactivacion') {
        toneGreeting = `{Hola|Buen día|Un placer saludarle de nuevo} ${contactName || companyName} 👋, ¡un gran gusto saludarles de nuevo!`;
        toneOpening = `{Le escribe|Le contacta} *${sellerName}* de *JJ Paper C.A.* Como cuenta preferencial y de la casa, pasamos por aquí para presentarle en exclusiva este lote de insumos con condiciones preferenciales y flete prioritario:`;
        toneClosing = `{¿Cómo se encuentran de inventario en sus sedes para esta quincena? Con gusto le reservamos disponibilidad inmediata.|¿Gusta que le preparemos su despacho con las condiciones preferenciales de su cuenta?}`;
      } else if (commercialTone === 'oportunidad_mayorista') {
        toneGreeting = `{Hola|Buen día} ${contactName || companyName} 👋, un saludo comercial.`;
        toneOpening = `{Le saluda|Le escribe} *${sellerName}* de *JJ Paper C.A.* Conociendo el volumen y consumo de ${companyName} en ${city || 'Caracas'}, hoy le presentamos una oportunidad mayorista con precios de escala cerrada y entrega inmediata:`;
        toneClosing = `{¿Cuántos bultos o cajas le apartamos para su entrega de esta semana?|¿Desea que le facturemos a tasa oficial BCV (${rate.toFixed(2)} Bs) para despacho mañana?}`;
      } else if (commercialTone === 'cercano_consultivo') {
        toneGreeting = `{Hola|Qué tal} ${contactName || companyName} 👋, ¡un gran saludo!`;
        toneOpening = `Por aquí te escribe *${sellerName}* de *JJ Paper C.A.* Quería saludarte y pasarte de primera mano estas opciones que tenemos listas para despacharte en tu sede:`;
        toneClosing = `{¿Qué insumos estás necesitando reponer en tu sede para apoyarte hoy mismo? Recuerda que si buscas algo que no veas en lista te lo conseguimos de inmediato.|¿Te preparo la cotización formal en bolívares a tasa BCV?}`;
      } else if (commercialTone === 'institucional_formal') {
        toneGreeting = `Estimada Gerencia de Compras y Administración en ${companyName}:`;
        toneOpening = `Le saluda atentamente *${sellerName}* de *JJ Paper C.A.* En atención a las operaciones y suministro de sus sedes en ${city || 'Caracas'}, ponemos a su disposición el siguiente lote mayorista con disponibilidad para entrega inmediata:`;
        toneClosing = `Quedamos a la disposición de su departamento de compras para consignar nuestra cotización formal membretada y atender su orden de compra.`;
      }

      openingStrategy = `
ESTRATEGIA COGNITIVA DE COMUNICACIÓN (${toneConfig.name}):
- Actitud y estilo: ${toneConfig.attitude} — ${toneConfig.style}.
- Objetivo: Presentar la oferta comercial con máxima persuasión y naturalidad humana.
${itemsFormatted}

PAUTAS COGNITIVAS DE REDACCIÓN:
1. Saludo y Apertura: Redacta un saludo y apertura ORIGINALES adaptados al rubro de ${companyName} y al tono "${toneConfig.name}". Prohibido repetir saludos robóticos o estructuras prefabricadas. Conecta con su operación real.
2. Presentación de Oferta: Presenta los productos de la oferta con viñetas claras (•), destacando nombres y precios oficiales en USD y Bs a tasa BCV (${rate.toFixed(2)} Bs).
3. Respaldo JJ Paper: Menciona de forma orgánica y fluida los beneficios clave (importador directo en Caracas, delivery a su sede, facturación fiscal formal).
4. Cláusula de Procura: Indica de manera natural que si buscan alguna medida, gramaje o artículo fuera de lista, el equipo mayorista se lo localiza de inmediato.
5. Cierre Comercial: Formula una pregunta de cierre persuasiva que invite a responder (ej. solicitar cotización formal, apartar disponibilidad o coordinar despacho).`;
    } else if (messageType.includes('Seguimiento') || isAlreadyContacted) {
      openingStrategy = `
ESTRATEGIA COGNITIVA: SEGUIMIENTO COMERCIAL (${toneConfig.name})
¡ATENCIÓN! Esta empresa ya tiene relación previa con JJ Paper. Prohibido presentarse como desconocido.
1. Saludo cordial reconociendo la relación continua con ${contactName || companyName}.
2. Consulta ágil sobre reposición de inventario o seguimiento a propuestas previas.
3. Propuesta de 3 insumos clave para su sector con precio exacto en USD y Bs BCV (${rate.toFixed(2)} Bs).
4. Cierre enfocado en facilitar el pedido de esta semana.`;
    } else if (messageType.includes('Recordatorio')) {
      openingStrategy = `
ESTRATEGIA COGNITIVA: RECORDATORIO DE REPOSICIÓN (${toneConfig.name})
1. Enfoque ágil y proactivo para la reposición quincenal/mensual de ${companyName}.
2. Presentar 3 insumos de alta rotación con precio exacto en USD y Bs BCV (${rate.toFixed(2)} Bs).
3. Cierre directo para apartar stock antes de que agote lote.`;
    } else if (messageType.includes('Oferta')) {
      openingStrategy = `
ESTRATEGIA COGNITIVA: OPORTUNIDAD MAYORISTA (${toneConfig.name})
1. Enfoque de lote especial o escala preferencial para ${companyName}.
2. Presentar los productos con ventajas de volumen y precio oficial.
3. Cierre invitando a confirmar bultos o despacho prioritario.`;
    } else {
      openingStrategy = `
ESTRATEGIA COGNITIVA: PRESENTACIÓN INSTITUCIONAL DIRECTA (${toneConfig.name})
1. Apertura institucional y respetuosa presentando a JJ Paper como importador y distribuidor directo en Caracas.
2. Presentar 3 soluciones operativas esenciales para el rubro de ${companyName} con precios exactos en USD y Bs BCV (${rate.toFixed(2)} Bs).
3. Cierre invitando a recibir catálogo completo o cotización formal membretada.`;
    }

    const sys = getBusinessContext() + `
Eres el Director y Estratega Comercial B2B Sénior de "JJ Paper C.A." en Caracas, Venezuela.
Tu objetivo es analizar minuciosamente el perfil corporativo de un cliente o prospecto B2B y desarrollar una propuesta de abordaje comercial hiper-personalizada, de alta conversión y con variaciones anti-bloqueo.

OBJETIVO CRÍTICO: CADA CLIENTE DEBE RECIBIR UN MENSAJE ÚNICO, HUMANO Y 100% ADAPTADO A SU REALIDAD Y SECTOR OPERATIVO. PROHIBIDO GENERAR MENSAJES GENÉRICOS O USAR LA FRASE "estimado cliente". PROHIBIDO forzar rollos térmicos o carpetas genéricas si la propuesta del asesor o la oferta comercial seleccionada tratan de otros insumos.

${advisorDirective}

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
4. Viñetas de productos:
${prodsList.length > 0 ? `   - DEBES listar CADA UNO de los ${prodsList.length} productos en promoción seleccionados por el asesor en el ESTRICTO ORDEN secuencial en que fueron suministrados. ¡PROHIBIDO recortar u omitir ninguno!
   - Formato por cada viñeta:
     • *Nombre del Producto* (Presentación): *$X.XX USD* | Bs. Y,YY
   - Aclara antes de la lista: "_(Precios unitarios promocionales — no es combo cerrado, puede solicitar los artículos y cantidades que requiera)_"
   - Puedes sugerir brevemente qué otros suministros de alta rotación para su rubro (${effectiveSector}) puede solicitar de nuestro catálogo general.` : `   - MÁXIMO 3 viñetas con formato:
     • *Nombre del Insumo*: Presentación/especificación · *Precio mayorista: $X.XX USD* (Bs. Y a tasa BCV) con beneficio para ${companyName}.
   ${promoProductOrCombo ? '- La PRIMERA viñeta DEBE ser la promoción/producto seleccionado: *' + (promoProductOrCombo.name || 'Promoción') + '* con su precio mayorista y descuento.' : ''}`}
   - ¡PROHIBIDO poner precios en seco o que luzcan elevados sin explicar la presentación por bulto/caja/paquete!
   - PROHIBIDO usar etiquetas técnicas como "Core 1:", "Core 2:" o "Cross-sell:". Redacta con dinamismo comercial.
5. Mención obligatoria de la Lista de Precios Oficial en PDF y Procura Especial:
   ${officialPdfIncluded ? '📄 *Le adjuntamos nuestra Lista de Precios Mayorista completa en PDF* (+900 productos disponibles para entrega inmediata).' : ''}
   • 🔍 *¿Busca algún formato o insumo especial no listado?* Se lo ubicamos y cotizamos directamente con nuestra red de importación.
6. Bloque de beneficios institucionales de JJ Paper:
   *VENTAJAS DE OPERAR CON JJ PAPER:*
   • 🏭 *Importador y Distribuidor Directo en Caracas* — Cero intermediarios, inventario físico para entrega inmediata.
   • 📦 *Condiciones preferenciales por volumen* — Escalas de precios y ahorro significativo frente a compras al detal.
   • 🚚 *Delivery directo y gratuito* a su sede en Caracas / despachos nacionales protegidos.
   • 🧾 *Facturación fiscal legal (RIF J-295375450)* en bolívares calculada a Tasa Oficial BCV (${rate.toFixed(2)} Bs).
   • ⚡ *Cotizaciones formales en segundos* adaptadas a su presupuesto operativo.
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

    let customDirectives = '';
    const userDirectives = (customInstructions || notes || '').trim();
    if (userDirectives) {
      customDirectives += `\n⭐ INSTRUCCIONES ESPECÍFICAS Y MANDATORIAS DEL ASESOR (MÁXIMA PRIORIDAD):\n"${userDirectives}"\nDEBES CUMPLIR ESTAS INDICACIONES ESTRICTAMENTE EN EL MENSAJE.\n`;
    }
    if (msgLength === 'short') {
      customDirectives += `\n📏 LONGITUD REQUERIDA: ULTRA-CONCISO (máximo 4 a 6 renglones en WhatsApp, o menos de 75 palabras en Email). Sin introducciones largas, ve directo al grano.\n`;
    } else if (msgLength === 'detailed') {
      customDirectives += `\n📏 LONGITUD REQUERIDA: DETALLADO Y COMPLETO. Desarrolla a fondo beneficios, especificaciones de los insumos y formalidades operativas.\n`;
    } else {
      customDirectives += `\n📏 LONGITUD REQUERIDA: EQUILIBRADO B2B. Estructura comercial estándar, ágil y ejecutiva.\n`;
    }
    if (priceMode === 'no_prices') {
      customDirectives += `\n💰 MANEJO DE PRECIOS: ¡ESTRICTAMENTE PROHIBIDO COLOCAR PRECIOS NUMÉRICOS! Solo menciona la disponibilidad de los artículos y ofrece cotizar a medida según su consumo o volumen.\n`;
    } else if (priceMode === 'bulk_only') {
      customDirectives += `\n💰 MANEJO DE PRECIOS: Enfatiza los precios y descuentos por bulto cerrado o caja master.\n`;
    }
    if (ctaGoal === 'quote') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Ofrecer consignar una cotización formal membretada de inmediato.\n`;
    } else if (ctaGoal === 'inventory') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Preguntar de forma consultiva por su reposición quincenal de inventario.\n`;
    } else if (ctaGoal === 'catalog') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Invitar a revisar el catálogo digital o la lista PDF oficial.\n`;
    } else if (ctaGoal === 'meeting') {
      customDirectives += `\n🎯 CIERRE / LLAMADO A LA ACCIÓN (CTA): Proponer coordinar una llamada breve o una visita con muestras en su sede corporativa.\n`;
    }

    const prompt = `
DATOS DEL CLIENTE A ANALIZAR:
- Empresa: "${companyName}"
- Sector objetivo / rubro: "${effectiveSector}"
- Contacto: "${contactName || 'No indicado'}"
- Cargo / Departamento: "${contactRole || 'No indicado'}"
- Dirección / Sede: "${address || 'Caracas, Venezuela'}"
- Ciudad: "${city || 'Caracas'}"
- Historial en JJ Paper: ${histTxt}

CONFIGURACIÓN DE REDACCIÓN SELECCIONADA POR EL ASESOR:
- Tono / Actitud Comercial Requerida: "${toneConfig.name}" (${toneConfig.attitude} — ${toneConfig.style})
- Propuesta de Valor / Gancho de Negocio: "${effectiveHook}"
- Sector Objetivo: "${effectiveSector}"
${customDirectives}

${prodsList.length > 0 ? `
========================================================================
¡DIRECTIVA MANDATORIA - CAMPAÑA DE OFERTAS SELECCIONADAS (${prodsList.length} ARTÍCULOS)!
========================================================================
El asesor preparó esta campaña con este listado específico de productos en oferta:
${prodsList.map((p, idx) => {
  const pName = p.name || 'Artículo';
  const pPriceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
  const pPriceBs = pPriceUsd > 0 ? (pPriceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const pUnit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
  return `• *${pName}*${pUnit}: *$${pPriceUsd.toFixed(2)} USD* | Bs. ${pPriceBs}`;
}).join('\n')}

REGLAS DE ORO INMUTABLES:
1. ¡PROHIBIDO REEMPLAZAR O SUSTITUIR ESTOS PRODUCTOS! La lista de ofertas en el cuerpo del mensaje DEBE SER EXACTAMENTE ESTA, con CADA UNO de los ${prodsList.length} artículos en este mismo orden correlativo.
2. Aclara antes del listado: "_(Precios unitarios promocionales — no es combo cerrado, puede solicitar los artículos y cantidades que requiera)_".
3. Adapta el saludo y la apertura a ${companyName} reconociendo su presencia en ${city || 'Caracas'} y su rubro (${effectiveSector}).
4. Incluye la promesa obligatoria de búsqueda: "💡 *¿Busca algún producto o marca que no vea en esta lista?* ¡Pídanoslo con total confianza! Nuestro equipo mayorista se lo ubica, cotiza y despacha de inmediato."
5. Incluye las ventajas de JJ Paper (importador directo, delivery 24h, factura SENIAT con RIF), mención de lista PDF y firma con ${sellerName}.
` : `
CATÁLOGO REAL DISPONIBLE:
${realProdInfo}

FLUJO DE ANÁLISIS DE PROSPECCIÓN (SIN OFERTAS ESPECÍFICAS PREVIAS):
1. LEE al cliente: analiza nombre, sector, notas, ciudad e historial para determinar con precisión a qué se dedica.
2. DEDUCE su giro y su punto de dolor operativo (ej: negocio de caja → rollos térmicos POS y detectores de billetes; clínica → sobres radiografía 14x17 y carpetas de historias médicas; colegio → resmas y marcadores de pizarra; logística → cintas industriales y marcadores indelebles).
3. OFRECE exactamente 3 productos de la CATÁLOGO REAL alineados con ese giro (máximo 1 de apoyo), siempre con su precio exacto en USD y su equivalente en Bs a Tasa Oficial BCV.
`}

Realiza el análisis y redacta el correo formal y el WhatsApp en JSON estricto:`;

    _variationCounter++;
    try {
      const raw = await callGemini({ prompt, systemInstruction: sys, temperature: 0.75, maxTokens: 2000, mode: 'architect' });
      const data = extractJSON(raw);
      return data;
    } catch (e) {
      const heur = generateHeuristicCustomerMessage({
        customer: {
          ...(customerFull || {}),
          company_name: companyName,
          name: companyName,
          contact_name: contactName,
          contact_role: contactRole,
          sector: effectiveSector,
          address,
          notes,
          city
        },
        channel: channel === 'email' ? 'email' : 'whatsapp',
        sName: sellerName,
        sPhone: sellerPhone,
        rate,
        promoProductOrCombo,
        products: prodsList.length > 0 ? prodsList : realProducts.slice(0, 3),
        officialPdfIncluded,
        isAlreadyContacted,
        personality,
        messageType,
        targetSector,
        commercialTone,
        valueHook
      });

      const emailHeur = channel === 'email' ? heur : generateHeuristicCustomerMessage({
        customer: {
          ...(customerFull || {}),
          company_name: companyName,
          name: companyName,
          contact_name: contactName,
          contact_role: contactRole,
          sector: effectiveSector,
          address,
          notes,
          city
        },
        channel: 'email',
        sName: sellerName,
        sPhone: sellerPhone,
        rate,
        promoProductOrCombo,
        products: prodsList.length > 0 ? prodsList : realProducts.slice(0, 3),
        officialPdfIncluded,
        isAlreadyContacted,
        personality,
        messageType,
        targetSector,
        commercialTone,
        valueHook
      });

      const waHeur = channel === 'whatsapp' ? heur : generateHeuristicCustomerMessage({
        customer: {
          ...(customerFull || {}),
          company_name: companyName,
          name: companyName,
          contact_name: contactName,
          contact_role: contactRole,
          sector: effectiveSector,
          address,
          notes,
          city
        },
        channel: 'whatsapp',
        sName: sellerName,
        sPhone: sellerPhone,
        rate,
        promoProductOrCombo,
        products: prodsList.length > 0 ? prodsList : realProducts.slice(0, 3),
        officialPdfIncluded,
        isAlreadyContacted,
        personality,
        messageType,
        targetSector,
        commercialTone,
        valueHook
      });

      const offerList = (heur.suggested_offering || '').split(' · ').filter(Boolean);
      return {
        sector_deducido: heur.sector || effectiveSector || 'Corporativo General',
        dolor_operativo: heur.need || 'Abastecimiento oportuno de suministros para continuidad operativa y control de costos de procura.',
        insumos_core: offerList.slice(0, 2),
        insumo_cross_sell: offerList[2] || 'Cintas de embalaje y consumibles de archivo',
        angulo_seleccionado: commercialTone || 'socio_estrategico',
        subject: emailHeur.subject || heur.subject,
        email_body: emailHeur.body,
        email_word_count: emailHeur.body.trim().split(/\s+/).length,
        wa_body: waHeur.body
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
    products = [],
    officialPdfIncluded = true,
    personality = 'Profesional / Formal',
    messageType = 'Presentación Inicial',
    targetSector = 'auto',
    commercialTone = 'socio_estrategico',
    valueHook = 'importador_directo',
    customInstructions = '',
    msgLength = 'balanced',
    priceMode = 'with_prices',
    ctaGoal = 'quote',
    forceRefresh = false,
    baseMessageText = '',
    baseSubjectText = ''
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

    const hasCustomOffer = Boolean(promoProductOrCombo || (Array.isArray(products) && products.length > 0));

    // Adaptación dinámica de enfoque según el tono seleccionado
    let effectiveMessageType = messageType;
    if (hasCustomOffer) {
      effectiveMessageType = 'Oferta Especial';
    } else if (isAlreadyContacted && (messageType === 'Presentación Inicial' || messageType === 'presentacion')) {
      effectiveMessageType = 'Seguimiento de Contacto Previo';
    }

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
        products,
        officialPdfIncluded,
        channel,
        customerFull: customer,
        orderHistory,
        personality: effectivePersonality,
        messageType: effectiveMessageType,
        targetSector,
        commercialTone,
        valueHook,
        customInstructions,
        msgLength,
        priceMode,
        ctaGoal,
        baseMessageText,
        baseSubjectText
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
      return generateHeuristicCustomerMessage({
        customer,
        channel,
        sName,
        sPhone,
        rate,
        promoProductOrCombo,
        products,
        officialPdfIncluded,
        isAlreadyContacted,
        personality: effectivePersonality,
        messageType: effectiveMessageType,
        targetSector,
        commercialTone,
        valueHook
      });
    }
  }

  function generateHeuristicCustomerMessage({
    customer = {},
    channel = 'whatsapp',
    sName = 'Keyder José Salazar',
    sPhone = '0412-4676073',
    rate = 40,
    promoProductOrCombo = null,
    products = [],
    officialPdfIncluded = true,
    isAlreadyContacted = false,
    personality = '',
    messageType = '',
    targetSector = 'auto',
    commercialTone = 'socio_estrategico',
    valueHook = 'importador_directo'
  }) {
    _variationCounter++;
    const v = _variationCounter;
    const custName = customer.company_name || customer.name || customer.business_name || 'su empresa';
    const contactPerson = customer.contact_name || '';
    const contactRole = customer.contact_role || '';
    const city = customer.city || 'Caracas';
    const low = `${custName} ${customer.sector || ''} ${targetSector || ''} ${customer.notes || ''} ${customer.tags || ''}`.toLowerCase();

    let sector = 'Corporativo y Oficinas';
    let need = 'Abastecimiento continuo de papelería corporativa, archivo y consumibles con costos de distribuidor directo';
    let offering = 'Resmas de papel Bond Carta/Oficio, carpetas de archivo y consumibles de oficina';
    let bulletPoints = '';

    const hasMultiOffer = Array.isArray(products) && products.length > 0;
    const archetype = _detectToneArchetype(`${commercialTone} ${personality}`, valueHook, messageType);

    if (hasMultiOffer) {
      sector = customer.sector || 'Comercial e Insumos Mayoristas';
      need = 'Suministro mayorista directo con precios de importador y entrega inmediata en sede';
      offering = products.slice(0, 3).map(p => p.name).join(' · ');
      bulletPoints = products.map(p => {
        const pName = p.name || 'Artículo';
        const pPriceUsd = Number(p.final_price_usd != null ? p.final_price_usd : (p.price_usd || 0));
        const pPriceBs = pPriceUsd > 0 ? (pPriceUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        const pUnit = p.unit && p.unit !== 'unid' ? ` (${p.unit})` : '';
        if (archetype === 'institucional_formal') {
          return `  - ${pName}${pUnit}: USD $${pPriceUsd.toFixed(2)} (Bs. ${pPriceBs} a tasa BCV)`;
        }
        if (archetype === 'directo_ejecutivo') {
          return `▪️ *${pName}*${pUnit} ➔ *$${pPriceUsd.toFixed(2)}* (Bs. ${pPriceBs})`;
        }
        return `• *${pName}*${pUnit}: *$${pPriceUsd.toFixed(2)} USD* (Bs. ${pPriceBs})`;
      }).join('\n');
      if (products.length > 10) {
        bulletPoints += `\n• _...y ${products.length - 10} artículos adicionales incluidos en este lote._`;
      }
    } else if (/farmacia|droguer[ií]a|farma/i.test(low)) {
      sector = 'Farmacias y Salud Retail';
      need = 'Cero quiebres en rollos térmicos para puntos de venta/impresoras fiscales y embalaje de pedidos';
      offering = 'Rollos térmicos 80x70mm y 57x40mm · Cintas de empaque 48x100m · Sobres manila';
      bulletPoints = `• *Rollos térmicos POS y fiscales* (80x70mm y 57x40mm) de alta nitidez.\n• *Cintas de empaque de alto micraje* (48mm x 100m/200m) para sellado de bultos.\n• *Sobres manila y consumibles administrativos* para control de inventario.`;
    } else if (/supermercado|abasto|comercial|bodeg[oó]n|charcuter[ií]a|panader[ií]a|automercado|minimarket|retail/i.test(low)) {
      sector = 'Supermercados y Retail';
      need = 'Operación ininterrumpida en líneas de cajas registradoras y embalaje de almacén';
      offering = 'Rollos térmicos POS 80x70/57x40 · Detectores de billetes Kores · Cintas industriales';
      bulletPoints = `• *Rollos térmicos para cajas y puntos de venta* (80x70mm, 80x80mm y 57x40mm).\n• *Marcadores detectores de billetes falsos* Kores y almohadillas dactilares.\n• *Cintas de embalaje industrial* transparentes y marrones de extra adherencia.`;
    } else if (/librer[ií]a|papeler[ií]a|bazar|variedades|copias/i.test(low)) {
      sector = 'Librerías y Papelerías (Mayorista Reventa)';
      need = 'Surtido mayorista de alta rotación con margen directo de importador';
      offering = 'Resmas Bond Carta/Oficio por bulto · Cuadernos cosidos/espiral · Útiles y escritura';
      bulletPoints = `• *Resmas de papel Bond Carta y Oficio* (75g y 80g) por bulto a precio de distribuidor.\n• *Cuadernos de alta rotación*: engrapados, cosidos y doble espiral.\n• *Línea escolar y de oficina*: bolígrafos por caja, lápices, fundas protectoras, carpetas y pegamentos.`;
    } else if (/colegio|escuela|instituto|liceo|educaci[oó]n|educativo|universidad|acad[eé]mico/i.test(low)) {
      sector = 'Instituciones Educativas';
      need = 'Dotación institucional de papel para evaluaciones, archivo estudiantil y material docente';
      offering = 'Resmas Bond Carta/Oficio · Marcadores de pizarra acrílica · Carpetas y fundas protectoras';
      bulletPoints = `• *Resmas de papel Bond Carta y Oficio* para exámenes, guías y circulares.\n• *Marcadores de pizarra acrílica recargables* y borradores institucionales.\n• *Carpetas manila, fibra y fundas protectoras* para expedientes estudiantiles.`;
    } else if (/cl[ií]nica|salud|m[eé]dico|dental|laboratorio|hospital|consultorio/i.test(low)) {
      sector = 'Clínicas, Laboratorios y Salud';
      need = 'Resguardo pulcro de historias médicas, sobres para estudios y papelería de admisión';
      offering = 'Sobres radiografía 14x17 · Carpetas de historias médicas de fibra · Resmas Bond';
      bulletPoints = `• *Sobres de gran formato y radiografía* (14x17, Extra Oficio y Carta).\n• *Carpetas de fibra con gancho* para archivo de historias médicas.\n• *Resmas de papel Bond y rollos térmicos* para admisión, caja y laboratorio.`;
    } else if (/transporte|log[ií]stica|env[ií]os|cargo|almac[eé]n|ferreter[ií]a|repuestos/i.test(low)) {
      sector = 'Logística, Almacén e Industria';
      need = 'Embalaje industrial de alta resistencia y rotulación indeleble de mercancía';
      offering = 'Cintas industriales 48x100m/200m · Marcadores indelebles Servicio 80 · Dispensadores';
      bulletPoints = `• *Cintas de embalaje industrial* (48mm x 100m y 200m) de pegado extra fuerte.\n• *Marcadores permanentes industriales* (Servicio 80, Sharpie, Kores).\n• *Exactos de alta resistencia, dispensadores* y resmas para guías de despacho.`;
    } else if (/banco|seguros|consultor|asesor|abogad|corporaci[oó]n|grupo|finanz/i.test(low)) {
      sector = 'Corporativo, Banca y Legal';
      need = 'Archivo auditable a 10 años, cumplimiento documental y suministro corporativo centralizado';
      offering = 'Carpetas de fibra marrón reglamentarias · Archivadores lomo ancho · Resmas Bond 75g/80g';
      bulletPoints = `• *Carpetas de fibra marrón reglamentarias* con gancho y fundas protectoras.\n• *Archivadores de palanca* lomo ancho/fino con cantoneras metálicas.\n• *Resmas de papel Bond Carta y Oficio* de alta blancura para contratos e informes.`;
    } else {
      bulletPoints = `• *Resmas de papel Bond Carta y Oficio* con disponibilidad inmediata por caja o bulto.\n• *Archivo y organización*: carpetas manila, fibra, fundas protectoras y archivadores.\n• *Consumibles operativos*: bolígrafos, grapas, cintas de embalaje y rollos térmicos POS.`;
    }

    if (!hasMultiOffer && promoProductOrCombo) {
      const pUsd = Number(promoProductOrCombo.final_price_usd || promoProductOrCombo.price_usd || 0);
      const pBs = (pUsd * rate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      bulletPoints = `• *🔥 DESTACADO: ${promoProductOrCombo.name}* — *$${pUsd.toFixed(2)} USD* (Bs. ${pBs} BCV)\n` + bulletPoints;
    }

    // Gancho de valor específico seleccionado por el usuario
    const hookHighlightMap = {
      importador_directo: `🏭 *Importador y Distribuidor Directo en Caracas:* Precios de primera mano sin intermediarios y stock físico real.`,
      escala_volumen: `📦 *Escalas de Descuento por Volumen:* Precios mayoristas preferenciales por caja y bulto cerrado.`,
      sourcing_especial: `🔍 *Servicio de Procura Especial (Sourcing):* Cualquier formato, medida o marca que no vea en lista, se lo ubicamos y despachamos.`,
      despacho_express: `🚚 *Despacho Exprés 24h y Factura BCV:* Entrega directa y gratuita en su sede en Caracas con factura fiscal SENIAT (${rate.toFixed(2)} Bs/USD).`,
      ahorro_mensual: `💰 *Optimización de Presupuesto Mensual:* Consolidamos toda su compra de papelería y consumibles reduciendo hasta un 25% sus costos.`
    };
    const activeHookLine = hookHighlightMap[valueHook] || hookHighlightMap.importador_directo;

    const isEmail = channel === 'email';
    const greetTarget = contactPerson ? `${contactPerson} (${custName})` : (contactRole ? `${contactRole} de ${custName}` : `equipo de ${custName}`);

    // Construcción de Asunto y Cuerpo según el Arquetipo de Tono / Formato y Variación #v
    let subject = '';
    let body = '';

    if (isEmail) {
      if (archetype === 'oportunidad_mayorista') {
        const subs = [
          `🔥 Condiciones Mayoristas por Volumen para ${custName} — JJ Paper C.A.`,
          `⚡ Disponibilidad Inmediata y Precios de Importador para ${custName} — JJ Paper`,
          `📦 Lote Preferencial de Suministros (Tasa BCV) para ${custName} — JJ Paper`
        ];
        subject = subs[v % subs.length];
        body = `{Hola|Buen día} ${greetTarget},\n\nLe saluda *${sName}* de *JJ Paper C.A.* Hoy habilitamos en nuestro almacén de Caracas condiciones especiales por volumen pensadas para la rotación operativa de ${custName}:\n\n*📦 LOTE MAYORISTA DISPONIBLE (BCV ${rate.toFixed(2)} Bs/USD):*\n${bulletPoints}\n\n*VENTAJA CLAVE PARA SU COMPRA DE ESTA SEMANA:*\n• ${activeHookLine}\n• 🧾 Facturación fiscal formal SENIAT (RIF J-295375450).\n• 🚚 Transporte propio gratuito en ${city}.\n${officialPdfIncluded ? '• 📄 Adjuntamos nuestra Lista Oficial en PDF con +900 ítems.\n' : ''}\n👉 Catálogo interactivo: {{link}}\n\n¿Cuántas cajas o unidades le bloqueamos en almacén para programar su despacho mañana?\n\nAtentamente,\n*${sName}*\nDirección Comercial | JJ Paper C.A. · ${sPhone}`;
      } else if (archetype === 'cercano_consultivo') {
        const subs = [
          `🤝 Apoyo en abastecimiento y procura de suministros para ${custName}`,
          `Hola ${contactPerson || custName} · Disponibilidad de papelería e insumos esta semana`,
          `Suministro ágil y procura a medida para ${custName} — JJ Paper`
        ];
        subject = subs[v % subs.length];
        body = `{Hola|Qué tal|Buen día} ${greetTarget},\n\nEspero que todo marche excelente en sus operaciones en ${city}. Le escribe *${sName}* de *JJ Paper C.A.*\n\n${isAlreadyContacted ? 'Quería saludarles nuevamente y consultarles cómo están de inventario para esta quincena.' : 'Quería ponerme a su entera disposición como su asesor directo para simplificar las compras de papelería y consumibles de su empresa.'} Actualmente contamos con entrega inmediata en:\n\n${bulletPoints}\n\n${activeHookLine}\n\nAdemás, si necesitan algún artículo específico que no aparezca en el listado, solo indíquenoslo y nuestro equipo se encarga de conseguirlo y cotizarlo de inmediato.\n\n👉 Catálogo digital completo: {{link}}\n\n¿Tienen algún requerimiento pendiente esta semana en el que les pueda apoyar con un presupuesto rápido?\n\nUn cordial saludo,\n*${sName}*\nAsesor Comercial | JJ Paper C.A. · ${sPhone}`;
      } else if (archetype === 'institucional_formal') {
        subject = `Propuesta Institucional de Suministro y Homologación para ${custName} | JJ Paper C.A.`;
        body = `Estimada Gerencia de Compras y Procura en ${custName}:\nPresente.-\n\nEn nombre de *JJ Paper C.A.* (RIF J-295375450), empresa importadora y distribuidora mayorista en Caracas, sometemos a su consideración nuestra propuesta formal de abastecimiento operativo para sus sedes en ${city}:\n\n${bulletPoints}\n\nGARANTÍAS CORPORATIVAS:\n- ${activeHookLine.replace(/\*/g, '')}\n- Facturación fiscal legal conforme a normativas del SENIAT a Tasa Oficial BCV (${rate.toFixed(2)} Bs/USD).\n- Despacho directo sin cargo en el Área Metropolitana de Caracas.\n${officialPdfIncluded ? '- Lista de precios maestra adjunta en formato PDF (+900 renglones).\n' : ''}\nCatálogo digital corporativo: {{link}}\n\nQuedamos a su disposición para emitir la cotización proforma correspondiente a su requerimiento actual.\n\nAtentamente,\n*${sName}*\nEjecutivo de Cuentas Corporativas | JJ Paper C.A.\nTeléfono: ${sPhone} · Caracas, Venezuela`;
      } else if (archetype === 'directo_ejecutivo') {
        subject = `⚡ Resumen Ejecutivo de Precios y Stock para ${custName} — JJ Paper`;
        body = `Buen día ${greetTarget},\n\nLe comparto de forma ejecutiva nuestra disponibilidad inmediata en Caracas (Tasa Oficial BCV: ${rate.toFixed(2)} Bs/USD) adaptada a las operaciones de ${custName}:\n\n${bulletPoints}\n\n✅ ${activeHookLine}\n✅ Incluye Factura Fiscal SENIAT y Delivery Gratis en Caracas.\n🔗 Catálogo completo: {{link}}\n\n¿Le emito cotización formal por alguno de estos renglones el día de hoy?\n\nSaludos cordiales,\n*${sName}* | JJ Paper C.A. (${sPhone})`;
      } else {
        const subs = [
          `📋 Propuesta de Optimización y Abastecimiento para ${custName} — JJ Paper C.A.`,
          `💼 Alianza de Suministro Directo (Tasa BCV) para ${custName} — JJ Paper`
        ];
        subject = subs[v % subs.length];
        body = `{Estimado(a)|Apreciado(a)} ${greetTarget},\n\nReciba un cordial saludo de *${sName}* en *JJ Paper C.A.* Conociendo la dinámica del sector ${sector} en ${city}, hemos estructurado una propuesta de suministro directo orientada a optimizar su presupuesto operativo:\n\n*📦 INSUMOS CLAVE EN DISPONIBILIDAD INMEDIATA:*\n${bulletPoints}\n\n*PILARES DE NUESTRA ALIANZA COMERCIAL:*\n• ${activeHookLine}\n• 🧾 *Facturación Fiscal BCV:* Cero diferencial cambiario (${rate.toFixed(2)} Bs/USD).\n• 🚚 *Logística Propia:* Entrega puntual sin costo en su sede.\n${officialPdfIncluded ? '• 📄 *Catálogo PDF Adjunto:* Más de 900 artículos en stock real.\n' : ''}\n👉 Catálogo en línea: {{link}}\n\n¿Desea que le preparemos una cotización comparativa para su requerimiento de esta semana?\n\nAtentamente,\n*${sName}*\nDirección Comercial | JJ Paper C.A. · ${sPhone}`;
      }
    } else {
      // CANAL WHATSAPP CON 5 FORMATOS VISUALES DISTINTOS SEGÚN EL TONO Y CLIC
      if (archetype === 'oportunidad_mayorista') {
        body = `*🔥 CONDICIÓN MAYORISTA DIRECTA PARA ${custName.toUpperCase()} · JJ PAPER*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Buen día|Qué tal} ${contactPerson || `equipo de *${custName}*`} 👋, le saluda *${sName}* de *JJ Paper C.A.*\n\nHoy activamos condiciones preferenciales por volumen en nuestro almacén de Caracas para insumos de alta rotación en su sector:\n\n${bulletPoints}\n\n*🚀 BENEFICIO CLAVE:*\n• ${activeHookLine}\n• 🧾 Factura fiscal SENIAT a Tasa BCV (${rate.toFixed(2)} Bs).\n• 🚚 Delivery corporativo gratis directo a su sede en ${city}.\n\n👉 Catálogo digital: {{link}}\n\n💬 *¿Cuántas unidades o cajas le reservamos en sistema para despacho prioritario?*`;
      } else if (archetype === 'cercano_consultivo') {
        body = `{Hola|Buen día|Un gusto saludarle} ${contactPerson || `amigos de *${custName}*`} 👋, ¿cómo están?\n\nLe escribe *${sName}* de *JJ Paper C.A.* ${isAlreadyContacted ? 'Paso por aquí brevemente en seguimiento a nuestro contacto previo para saber cómo se encuentran de stock esta semana.' : `Quería ponerme a la orden para apoyar las operaciones de *${custName}* en ${city} con un servicio rápido y de confianza.`}\n\nActualmente tenemos excelente disponibilidad en:\n\n${bulletPoints}\n\n💡 ${activeHookLine}\n\nTodo con su factura legal a tasa BCV (${rate.toFixed(2)} Bs) y entrega sin costo en su puerta 🚚.\n\n👉 Catálogo completo aquí: {{link}}\n\n¿Qué artículos necesitan reponer esta semana para armarles el presupuesto al instante?\n\nUn abrazo cordial,\n*${sName}* | JJ Paper (${sPhone})`;
      } else if (archetype === 'institucional_formal') {
        body = `*PROPUESTA DE SUMINISTRO CORPORATIVO · JJ PAPER C.A. (RIF J-295375450)*\n────────────────────────────────────\nEstimada Gerencia de Compras de *${custName}*${contactPerson ? ` (Atención: ${contactPerson})` : ''}, reciba un cordial saludo.\n\nSe dirige a usted *${sName}*, Ejecutivo Comercial de *JJ Paper C.A.* Ponemos a disposición de sus operaciones en ${city} nuestra línea de abastecimiento mayorista directo:\n\n${bulletPoints}\n\n*GARANTÍAS OPERATIVAS:*\n• ${activeHookLine}\n• Facturación fiscal SENIAT a Tasa Oficial BCV (${rate.toFixed(2)} Bs/USD).\n• Despacho directo sin recargo en el Área Metropolitana de Caracas.\n${officialPdfIncluded ? '• Lista de Precios Oficial adjunta en PDF (+900 artículos).\n' : ''}\n🔗 Catálogo Corporativo: {{link}}\n\n¿Desea que emitamos la cotización formal a nombre de *${custName}* para revisión de su departamento?\n\nAtentamente,\n*${sName}* | Dirección Comercial JJ Paper C.A. · ${sPhone}`;
      } else if (archetype === 'directo_ejecutivo') {
        body = `{Buen día|Hola} ${contactPerson || `equipo de *${custName}*`} 👋 · *Resumen Ejecutivo JJ Paper*\n\nLe escribe *${sName}*. Comparto directo al punto nuestra disponibilidad mayorista en Caracas (BCV: ${rate.toFixed(2)} Bs) para *${custName}*:\n\n${bulletPoints}\n\n✅ ${activeHookLine}\n✅ Factura fiscal SENIAT + Delivery gratis en ${city}.\n🔗 Catálogo: {{link}}\n\n⚡ *¿Le cotizo formalmente alguno de estos ítems hoy?* — *${sName}* (${sPhone})`;
      } else {
        body = `*🏢 ALIANZA DE ABASTECIMIENTO OPERATIVO · JJ PAPER C.A.*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n{Hola|Buen día|Un gusto saludarle} ${contactPerson || `estimados amigos de *${custName}*`} 👋\n\nLe saluda *${sName}* de *JJ Paper C.A.*, distribuidor mayorista directo en Caracas. Pensando en la exigencia diaria de *${custName}* en el sector ${sector}, ponemos a su alcance stock inmediato en:\n\n${bulletPoints}\n\n*💎 POR QUÉ OPERAR CON JJ PAPER:*\n• ${activeHookLine}\n• 🧾 *Facturación Fiscal (J-295375450)* a Tasa BCV (${rate.toFixed(2)} Bs).\n• 🚚 *Delivery directo y gratuito* en ${city}.\n${officialPdfIncluded ? '• 📄 *PDF Oficial Adjunto* con más de 900 artículos.\n' : ''}\n👉 Catálogo interactivo: {{link}}\n\n{¿Desea que le preparemos una cotización formal a medida?|¿Qué insumos requieren reponer esta semana en su empresa?}\n\nAtentamente,\n*${sName}* | JJ Paper C.A. · ${sPhone}`;
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
    products = [],
    officialPdfIncluded = true,
    forceRefresh = true,
    attitude = 'presentacion',
    targetSector = 'auto',
    commercialTone = 'socio_estrategico',
    valueHook = 'importador_directo',
    customInstructions = '',
    msgLength = 'balanced',
    priceMode = 'with_prices',
    ctaGoal = 'quote',
    onProgress = null,
    baseMessageText = '',
    baseSubjectText = ''
  }) {
    const results = [];
    const total = customers.length;
    let completed = 0;

    const hasCustomOffer = Boolean(promoProductOrCombo || (Array.isArray(products) && products.length > 0));

    // Mapeo de la actitud y tono comercial seleccionados
    const toneConfig = COMMERCIAL_TONE_DIRECTIVES[commercialTone] || COMMERCIAL_TONE_DIRECTIVES.socio_estrategico;
    let personality = toneConfig.name;
    let messageType = 'Presentación Inicial';
    if (hasCustomOffer) {
      messageType = 'Oferta Especial';
    } else if (attitude === 'oferta') {
      messageType = 'Oportunidad de Abastecimiento Mayorista';
    } else if (attitude === 'seguimiento') {
      messageType = 'Seguimiento y Procura de Insumos';
    } else if (attitude === 'recordatorio') {
      messageType = 'Recordatorio de Insumos';
    } else if (attitude === 'fidelizado') {
      messageType = 'Reactivación VIP / Fidelizado';
    }

    // Procesar en chunks de 4 en paralelo con pool balanceado de 7 API keys
    const CONCURRENCY = 4;
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
            products,
            officialPdfIncluded,
            personality,
            messageType,
            targetSector,
            commercialTone,
            valueHook,
            customInstructions,
            msgLength,
            priceMode,
            ctaGoal,
            forceRefresh,
            baseMessageText,
            baseSubjectText
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
            products,
            officialPdfIncluded,
            baseMessageText,
            baseSubjectText
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
  async function askCopilot(param, extra = {}) {
    let message = '';
    let chatHistory = [];
    let userRole = 'vendedor';
    let userName = '';

    if (typeof param === 'string') {
      message = param;
      if (extra && typeof extra === 'object') {
        chatHistory = extra.chatHistory || [];
        userRole = extra.userRole || 'vendedor';
        userName = extra.userName || '';
      }
    } else if (param && typeof param === 'object') {
      message = param.message || '';
      chatHistory = param.chatHistory || [];
      userRole = param.userRole || 'vendedor';
      userName = param.userName || '';
    }

    let productContext = '';
    const keywords = (message || '').match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/g) || [];
    const searchTerms = keywords.filter(w => !['hola', 'precio', 'costo', 'tienen', 'cuanto', 'como', 'donde', 'para'].includes(w.toLowerCase()));

    if (searchTerms.length > 0) {
      const found = await searchProductsLive(searchTerms[0], 5);
      if (found.length > 0) {
        productContext = `\n[Productos encontrados en catálogo en vivo de JJ Paper]:\n` +
          found.map(p => `- ${p.name} (${p.sku || 'S/C'}) | Precio: $${p.price_usd.toFixed(2)} USD (Bs ${p.price_bs.toFixed(2)}) x ${p.unit} ${p.brands ? `| Marcas: ${p.brands}` : ''}`).join('\n');
      }
    }

    const w = typeof window !== 'undefined' ? window : {};
    const rate = getEffectiveRate();
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
     6. Generador Visual de Packshot de Estudio Puro (Fondo Limpio Catálogo 800x800)
     -------------------------------------------------------------------------- */
  async function renderProductStudioPackshot({
    product,
    theme = 'white', // 'white' | 'emerald'
    canvas = null
  }) {
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
    let imgToLoad = product?.image_url;
    
    if (!imgToLoad && product?.name) {
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

    if (!imgToLoad && product) {
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
        if (!img && imgToLoad !== product?._studio_photo_url && product) {
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
        console.warn('Fallo cargando imagen en packshot:', err);
      }
    }

    if (!imageRendered && product) {
      renderCommercial3dProduct(ctx, product, stageCenterX, stageCenterY, isWhite);
    }

    return cvs;
  }

  /* --------------------------------------------------------------------------
     6.2. Generador Visual de Flyer Publicitario Comercial (Canvas 800x800)
     Soporta Producto Individual y Combos / Grilla Multi-Producto con Fotos Reales
     -------------------------------------------------------------------------- */
  async function renderMarketingFlyer({
    product = null,
    products = [],
    customPriceUsd = null,
    sellerName = 'Keyder José Salazar',
    sellerPhone = '0412-4676073',
    customNote = '',
    theme = 'white',
    headline = '',
    canvas = null
  }) {
    const w = typeof window !== 'undefined' ? window : {};
    const rate = getEffectiveRate();
    const cvs = canvas || document.createElement('canvas');
    cvs.width = 800;
    cvs.height = 800;
    const ctx = cvs.getContext('2d');

    const prodsList = (Array.isArray(products) && products.length > 0)
      ? products
      : (product?.products ? product.products : (product ? [product] : []));

    const isWhite = (theme === 'white');
    const isMulti = prodsList.length > 1;

    // 1. Fondo Principal
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 800);
    bgGrad.addColorStop(0, '#0F172A');
    bgGrad.addColorStop(0.12, '#16604A');
    bgGrad.addColorStop(0.13, '#F8FAFC');
    bgGrad.addColorStop(1, '#EEF2F6');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 800, 800);

    // 2. Encabezado Institucional JJ Paper (0 - 95px)
    ctx.fillStyle = '#16604A';
    ctx.fillRect(0, 0, 800, 95);

    // Borde inferior dorado en header
    ctx.fillStyle = '#EAB308';
    ctx.fillRect(0, 92, 800, 3);

    // Logo / Nombre JJ Paper
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('JJ PAPER, C.A.', 30, 42);

    ctx.fillStyle = '#A7F3D0';
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('DISTRIBUIDOR MAYORISTA EN CARACAS · RIF J-295375450', 30, 62);

    ctx.fillStyle = '#FDE68A';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('PAPELERÍA · CONSUMIBLES POS · EMBALAJE · SUMINISTROS', 30, 78);

    // Píldora de Tasa Oficial BCV a la derecha
    const bcvBoxW = 210, bcvBoxH = 46, bcvBoxX = 560, bcvBoxY = 24;
    ctx.fillStyle = '#062017';
    roundRect(ctx, bcvBoxX, bcvBoxY, bcvBoxW, bcvBoxH, 10);
    ctx.fill();
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#6EE7B7';
    ctx.font = '700 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏛️ TASA OFICIAL BCV DEL DÍA', bcvBoxX + bcvBoxW / 2, bcvBoxY + 16);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 16px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`1 USD = Bs. ${rate.toFixed(2)}`, bcvBoxX + bcvBoxW / 2, bcvBoxY + 36);
    ctx.textAlign = 'left';

    // 3. Cinta / Ribbon de Campaña (95 - 145px)
    const effectiveHeadline = headline || (isMulti ? '🔥 COMBO / LOTE MAYORISTA DESTACADO' : '🔥 OFERTA ESPECIAL AL MAYOR');
    ctx.fillStyle = '#0F172A';
    roundRect(ctx, 30, 105, 740, 38, 8);
    ctx.fill();

    ctx.fillStyle = '#FBBF24';
    ctx.font = '900 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(effectiveHeadline, 45, 129);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(customNote || 'Disponibilidad inmediata para empresas y colegios', 755, 128);
    ctx.textAlign = 'left';

    // 4. Contenido Central (y: 155 a 685px)
    if (!isMulti) {
      // ══════ MODO MONOPRODUCTO ══════
      const single = prodsList[0] || product || { name: 'Producto Mayorista' };
      const pPriceUsd = Number(customPriceUsd != null ? customPriceUsd : (single.final_price_usd || single.price_usd || 0));
      const pPriceBs = pPriceUsd * rate;

      // Caja Blanca Principal para Escenario de Producto
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, 30, 155, 420, 515, 14);
      ctx.fill();
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Sombra de piso
      ctx.beginPath();
      ctx.ellipse(240, 580, 140, 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fill();

      // Carga y renderizado de foto real del producto
      let imgObj = null;
      const imgUrl = single.image_url || single._studio_photo_url;
      if (imgUrl) {
        try { imgObj = await loadImageSafe(imgUrl); } catch (_) {}
      }

      if (imgObj && imgObj.width > 10 && imgObj.height > 10) {
        const maxW = 380, maxH = 380;
        const scale = Math.min(maxW / imgObj.width, maxH / imgObj.height, 1);
        const dw = imgObj.width * scale;
        const dh = imgObj.height * scale;
        const dx = 240 - dw / 2;
        const dy = 370 - dh / 2;
        ctx.drawImage(imgObj, dx, dy, dw, dh);
      } else {
        renderCommercial3dProduct(ctx, single, 240, 370, true);
      }

      // Badge flotante sobre la foto
      ctx.fillStyle = '#DC2626';
      roundRect(ctx, 45, 170, 140, 26, 6);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⭐ PRECIO MAYORISTA', 115, 187);
      ctx.textAlign = 'left';

      // Panel Lateral Derecho: Datos, Precio Hero y Beneficios (x: 465, y: 155, w: 305)
      // Nombre del producto
      ctx.fillStyle = '#0F172A';
      ctx.font = '900 20px -apple-system, BlinkMacSystemFont, sans-serif';
      const titleLines = wrapText(ctx, single.name || 'Artículo Comercial', 295);
      let curY = 185;
      titleLines.slice(0, 3).forEach(line => {
        ctx.fillText(line, 470, curY);
        curY += 25;
      });

      // Especificaciones
      curY += 5;
      ctx.fillStyle = '#64748B';
      ctx.font = '600 12px -apple-system, sans-serif';
      if (single.brand) {
        ctx.fillText(`🏷️ Marca: ${single.brand}`, 470, curY);
        curY += 18;
      }
      if (single.unit) {
        ctx.fillText(`📦 Presentación: ${single.unit}`, 470, curY);
        curY += 18;
      }
      if (single.sku) {
        ctx.fillText(`🔖 SKU / Código: ${single.sku}`, 470, curY);
        curY += 20;
      }

      // Hero Price Box
      const priceBoxY = Math.max(curY + 5, 290);
      const priceBoxH = 150;
      ctx.fillStyle = '#ECFDF5';
      roundRect(ctx, 465, priceBoxY, 305, priceBoxH, 12);
      ctx.fill();
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#065F46';
      ctx.font = '800 11px -apple-system, sans-serif';
      ctx.fillText('INVERSIÓN MAYORISTA PREFERENCIAL', 485, priceBoxY + 26);

      ctx.fillStyle = '#047857';
      ctx.font = '900 38px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(`$${pPriceUsd.toFixed(2)}`, 485, priceBoxY + 68);

      ctx.font = '700 16px -apple-system, sans-serif';
      ctx.fillText('USD', 485 + ctx.measureText(`$${pPriceUsd.toFixed(2)} `).width, priceBoxY + 66);

      ctx.fillStyle = '#065F46';
      ctx.font = '800 18px -apple-system, sans-serif';
      ctx.fillText(`Bs. ${pPriceBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 485, priceBoxY + 98);

      ctx.fillStyle = '#047857';
      ctx.font = '600 11px -apple-system, sans-serif';
      ctx.fillText('Facturado a Tasa Oficial BCV del día', 485, priceBoxY + 124);

      // Ventajas rápidas debajo del precio
      let perkY = priceBoxY + priceBoxH + 20;
      const perks = [
        '🚚 Despacho gratuito en Caracas',
        '⚡ Entrega rápida garantizada 24h',
        '🧾 Factura fiscal SENIAT legal'
      ];
      ctx.fillStyle = '#334155';
      ctx.font = '700 12px -apple-system, sans-serif';
      perks.forEach(pk => {
        ctx.fillText(pk, 470, perkY);
        perkY += 22;
      });

    } else {
      // ══════ MODO COMBO / GRILLA MULTI-PRODUCTO (2 A 8 ÍTEMS) ══════
      const items = prodsList.slice(0, 6); // Grilla óptima 2x3 o 3x2
      const cols = items.length <= 4 ? 2 : 3;
      const rows = Math.ceil(items.length / cols);
      const cardW = cols === 2 ? 355 : 235;
      const cardH = rows === 2 ? 220 : 155;
      const startX = 30;
      const startY = 155;
      const gapX = cols === 2 ? 30 : 17;
      const gapY = 14;

      // Cargar imágenes de los productos en paralelo
      const loadedImgs = await Promise.all(
        items.map(async (it) => {
          const u = it.image_url || it._studio_photo_url;
          if (!u) return null;
          try { return await loadImageSafe(u); } catch (_) { return null; }
        })
      );

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const img = loadedImgs[idx];
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = startX + c * (cardW + gapX);
        const y = startY + r * (cardH + gapY);

        // Tarjeta blanca para cada producto
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, x, y, cardW, cardH, 10);
        ctx.fill();
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Mini foto / thumbnail a la izquierda
        const thumbBoxW = cols === 2 ? 110 : 80;
        const thumbBoxH = cardH - 20;
        const thumbCenterX = x + 10 + thumbBoxW / 2;
        const thumbCenterY = y + cardH / 2;

        if (img && img.width > 10) {
          const sc = Math.min((thumbBoxW - 10) / img.width, (thumbBoxH - 10) / img.height, 1);
          const dw = img.width * sc;
          const dh = img.height * sc;
          ctx.drawImage(img, thumbCenterX - dw / 2, thumbCenterY - dh / 2, dw, dh);
        } else {
          ctx.font = '36px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(it.emoji || '📦', thumbCenterX, thumbCenterY + 12);
          ctx.textAlign = 'left';
        }

        // Datos del producto a la derecha del thumbnail
        const textX = x + thumbBoxW + 18;
        const maxTextW = cardW - thumbBoxW - 25;
        let tY = y + 26;

        ctx.fillStyle = '#0F172A';
        ctx.font = '800 13px -apple-system, BlinkMacSystemFont, sans-serif';
        const lines = wrapText(ctx, it.name || 'Artículo', maxTextW);
        lines.slice(0, 2).forEach(l => {
          ctx.fillText(l, textX, tY);
          tY += 16;
        });

        // Unidad / Presentación
        if (it.unit && it.unit !== 'unid') {
          ctx.fillStyle = '#64748B';
          ctx.font = '600 10px -apple-system, sans-serif';
          ctx.fillText(`(${it.unit})`, textX, tY);
          tY += 14;
        }

        // Precio individual
        const prUsd = Number(it.final_price_usd != null ? it.final_price_usd : (it.price_usd || 0));
        const prBs = prUsd * rate;

        tY = Math.max(tY + 4, y + cardH - 36);
        ctx.fillStyle = '#059669';
        ctx.font = '900 16px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(`$${prUsd.toFixed(2)} USD`, textX, tY);

        ctx.fillStyle = '#065F46';
        ctx.font = '700 11px -apple-system, sans-serif';
        ctx.fillText(`Bs. ${prBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, textX, tY + 14);
      }

      // Si hay precio total de combo o customPriceUsd
      if (customPriceUsd || product?.final_price_usd) {
        const totalComboUsd = Number(customPriceUsd || product?.final_price_usd || 0);
        if (totalComboUsd > 0) {
          const totalComboBs = totalComboUsd * rate;
          // Píldora de precio total
          const totY = 635;
          ctx.fillStyle = '#16604A';
          roundRect(ctx, 30, totY, 740, 42, 8);
          ctx.fill();

          ctx.fillStyle = '#FDE68A';
          ctx.font = '900 14px -apple-system, sans-serif';
          ctx.fillText('✨ TOTAL DE LA OFERTA / COMBO:', 45, totY + 26);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '900 18px -apple-system, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(`$${totalComboUsd.toFixed(2)} USD (Bs. ${totalComboBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`, 755, totY + 27);
          ctx.textAlign = 'left';
        }
      }
    }

    // 5. Pie de Página Comercial e Institucional (695 - 800px)
    ctx.fillStyle = '#062017';
    ctx.fillRect(0, 695, 800, 105);

    // Barra de Promesa de Sourcing Especial (¡MANDATORIA!)
    ctx.fillStyle = '#0B3327';
    ctx.fillRect(0, 695, 800, 32);
    ctx.fillStyle = '#A3E635';
    ctx.font = '800 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💡 ¿BUSCA ALGÚN PRODUCTO O MARCA QUE NO VEA AQUÍ? ¡PÍDALO! SE LO UBICAMOS Y COTIZAMOS DIRECTAMENTE', 400, 715);
    ctx.textAlign = 'left';

    // Línea divisoria sutil
    ctx.fillStyle = '#16604A';
    ctx.fillRect(30, 728, 740, 1);

    // Datos del Asesor y Condiciones
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '600 11px -apple-system, sans-serif';
    ctx.fillText('🚚 Entrega Inmediata en Caracas · Facturación SENIAT en Bolívares (Tasa BCV)', 30, 755);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 10px -apple-system, sans-serif';
    ctx.fillText('Precios al mayor válidos para empresas, comercios y colegios · RIF J-295375450', 30, 775);

    // Asesor Comercial a la derecha
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FDE68A';
    ctx.font = '800 13px -apple-system, sans-serif';
    ctx.fillText(`👤 Asesor: ${sellerName}`, 770, 755);

    ctx.fillStyle = '#6EE7B7';
    ctx.font = '800 12px -apple-system, sans-serif';
    ctx.fillText(`📞 Pedidos / WhatsApp: ${sellerPhone}`, 770, 775);
    ctx.textAlign = 'left';

    return cvs;
  }

  /* --------------------------------------------------------------------------
     6.3. Enrutador Maestro de Tarjetas y Flyers de Productos
     -------------------------------------------------------------------------- */
  async function renderProductCard({
    product = null,
    products = [],
    customPriceUsd = null,
    sellerName = '',
    sellerPhone = '',
    customNote = '',
    theme = 'white',
    headline = '',
    canvas = null,
    mode = 'flyer'
  }) {
    if (mode === 'photo') {
      return renderProductStudioPackshot({ product, theme, canvas });
    }
    return renderMarketingFlyer({
      product,
      products,
      customPriceUsd,
      sellerName,
      sellerPhone,
      customNote,
      theme,
      headline,
      canvas
    });
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
  /**
   * Extrae la cantidad de unidades que trae un empaque/paquete/caja según el nombre o unidad del catálogo.
   * Ejemplo: "FUNDA PROTECTORA CARTA PAQ X 100" -> 100
   *          "BOLIGRAFO KORES CAJA X 12" -> 12
   *          "CARPETA MANILA CARTA CAJA X 100 UND" -> 100
   */
  function extractPackSize(productName = '', unit = '') {
    const text = `${productName || ''} ${unit || ''}`.toUpperCase();

    // 1. Patrón explícito: PAQ X 100, CAJA X 12, PAQUETE DE 100, CAJA DE 50, BTO X 10, (X100), X 100 UND
    const explicitPackRegex = /(?:PAQ(?:UETE)?|CAJA|CJ|BOLSA|SOBRE|BLISTER|SET|ESTUCHE|DISPLAY|EMPAQUE)\s*(?:DE\s+|X\s*|\(\s*X\s*)?(\d{1,4})\s*(?:UND|UNID|UNIDADES|HOJAS|HJS|PCS|PIEZAS|FUNDAS|CARPETAS|SOBRES)?\b/i;
    const m1 = text.match(explicitPackRegex);
    if (m1) {
      const n = parseInt(m1[1], 10);
      if (n > 1 && n <= 5000) return n;
    }

    // 2. Patrón: X 100 UND / (X 100) / X100U / 100 UNIDADES / 100 UND
    const xUnitsRegex = /(?:\bX\s*(\d{1,4})\s*(?:UND|UNID|UNIDADES|U|PCS|FUNDAS|CARPETAS|HOJAS)\b|\(\s*X?\s*(\d{1,4})\s*(?:UND|UNID|UNIDADES|U)?\s*\)|\b(\d{2,4})\s*(?:UNIDADES|UND|UNID)\b)/i;
    const m2 = text.match(xUnitsRegex);
    if (m2) {
      const n = parseInt(m2[1] || m2[2] || m2[3], 10);
      if (n > 1 && n <= 5000) return n;
    }

    // 3. Patrón final "X 100" o "X 50" o "X 12" que NO sea dimensión (ej. 80x70mm, 48x100m, 14x17)
    const strippedDims = text
      .replace(/\b\d+\s*X\s*\d+\s*(?:MM|CM|M|MTS|MT|PULG|G|GR|ML)\b/gi, '')
      .replace(/\b(?:80\s*X\s*70|80\s*X\s*80|57\s*X\s*40|57\s*X\s*30|14\s*X\s*17|48\s*X\s*100|48\s*X\s*50|48\s*X\s*200)\b/gi, '');
    const m3 = strippedDims.match(/(?:^|\s|\()X\s*(\d{2,4})(?:\b|\))/i);
    if (m3) {
      const n = parseInt(m3[1], 10);
      if (n >= 6 && n <= 1000) return n;
    }

    // 4. Regla específica para Fundas Protectoras cuando el catálogo indica PAQ o CAJA sin número explícito (estándar 100 unds)
    if (/FUNDA\s+PROTECTORA/i.test(text) && /(?:PAQ|CAJA|EMP|100)/i.test(text)) {
      return 100;
    }

    return 1;
  }

  /**
   * Parser determinístico local para solicitudes de cotización en lenguaje natural
   * cuando la API de Gemini no está disponible o hay bloqueo regional.
   */
  function _parseQuoteTextLocally(rawText = '') {
    const cleanText = String(rawText || '').trim();
    const rifMatch = cleanText.match(/\b([JVGEC])\s*[-.]?\s*(\d{7,9})\s*[-.]?\s*(\d)?\b/i);
    const emailMatch = cleanText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = cleanText.match(/(?:\+?58\s*|0)?(?:412|414|424|416|426|212)\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{2}\s*[-.]?\s*\d{2}/);

    // Separar por saltos de línea, punto y coma, viñetas, o conjunciones " y <numero> " / ", <numero> "
    const normalizedLines = cleanText
      .replace(/\r\n/g, '\n')
      .replace(/[•●▪▸►*]/g, '\n')
      .replace(/(?:,\s*|\s+y\s+|\s+e\s+)(?=\d+\s+[a-záéíóúñ])/gi, '\n')
      .split(/\n|;/)
      .map(s => s.trim())
      .filter(s => s.length >= 3);

    const stopIntroRegex = /^(?:hola|buen\s*d[ií]a|buenas\s*(?:tardes|noches)|estimados?|saludos|por\s*favor|necesito|requiero|quisiera|me\s*pueden|favor|cotizar(?:me)?|presupuesto\s*de|precio\s*de|solicito\s*cotizaci[oó]n\s*(?:de|para)?|para\s*cotizar)\b[\s,:.-]*/gi;

    const SYNONYMS = [
      { rx: /\btirro\b/gi, rep: 'cinta masking tape' },
      { rx: /\bceloven\b/gi, rep: 'cinta adhesiva transparente' },
      { rx: /\b(?:tipex|liquid\s*paper)\b/gi, rep: 'corrector' },
      { rx: /\bsilicon\s*l[ií]quido\b/gi, rep: 'pega silicon liquido' },
      { rx: /\bmarcador\s*acr[ií]lico\b/gi, rep: 'marcador pizarra' },
      { rx: /\bhojas?\s*de\s*examen\b/gi, rep: 'papel ministro' }
    ];

    const items = [];
    for (let rawLine of normalizedLines) {
      // Ignorar líneas que son solo datos de contacto o saludos sin producto
      if (/^(?:rif|tel[eé]fono|correo|email|atenci[oó]n|direcci[oó]n|gracias|saludos|atentamente)\b/i.test(rawLine) && !/\d+\s+[a-z]{3,}/i.test(rawLine)) {
        continue;
      }

      // Limpiar frases introductorias ("Hola necesito cotizar 300 fundas protectoras" -> "300 fundas protectoras")
      let clause = rawLine.replace(stopIntroRegex, '').replace(stopIntroRegex, '').trim();
      if (!clause) continue;

      // Buscar patrón "<cantidad> [unidad/empaque] [de] <producto>" o "<producto> x <cantidad>"
      let qty = 1;
      let explicitPackRequest = false;
      let requestedUnitWord = 'unidad';
      let prodQuery = clause;

      // Caso A: Empieza con número o tiene "cotizar <N> <producto>"
      const mStart = clause.match(/^(?:cotizar\s+|necesito\s+|quiero\s+|dame\s+|enviar\s+)?(\d{1,6})\s*(paquetes?|paq|cajas?|cj|bultos?|bto|resmas?|rollos?|docenas?|unidades?|unds?|und)?\s*(?:de\s+)?(.+)$/i);
      // Caso B: "<producto> - <N> unds" o "<producto> (<N>)"
      const mEnd = !mStart ? clause.match(/^(.+?)\s*(?:[-:=]\s*|\(\s*|x\s*)(\d{1,6})\s*(paquetes?|paq|cajas?|cj|bultos?|resmas?|unidades?|unds?|und)?\s*\)?$/i) : null;

      if (mStart) {
        qty = Math.max(1, parseInt(mStart[1], 10));
        if (mStart[2]) {
          requestedUnitWord = mStart[2].toLowerCase();
          if (/^(?:paquete|paq|caja|cj|bulto|bto|resma|docena)/i.test(requestedUnitWord)) {
            explicitPackRequest = true;
          }
        }
        prodQuery = mStart[3].trim();
      } else if (mEnd && !/\b(?:75g|80g|100h|500h|26\/6|80x70|57x40)\b/i.test(mEnd[0])) {
        prodQuery = mEnd[1].trim();
        qty = Math.max(1, parseInt(mEnd[2], 10));
        if (mEnd[3]) {
          requestedUnitWord = mEnd[3].toLowerCase();
          if (/^(?:paquete|paq|caja|cj|bulto|bto|resma|docena)/i.test(requestedUnitWord)) {
            explicitPackRequest = true;
          }
        }
      } else {
        // Si la línea no tiene producto reconocible, saltar
        if (clause.split(/\s+/).length < 2 && !/\b(?:resma|funda|carpeta|boligrafo|marcador|cinta|rollo|cuaderno|lapiz|grapa|sobre|archivo|papel|tijera|pega|goma)\b/i.test(clause)) {
          continue;
        }
      }

      // Aplicar sinónimos venezolanos para mejorar el match
      let normalizedName = prodQuery;
      for (const syn of SYNONYMS) {
        normalizedName = normalizedName.replace(syn.rx, syn.rep);
      }

      const isBulk = /\b(?:bultos?|bto|master)\b/i.test(rawLine);

      items.push({
        raw_query: rawLine,
        product_name: normalizedName,
        qty,
        explicit_pack_request: explicitPackRequest,
        unit: requestedUnitWord,
        unit_type: isBulk ? 'bulk' : 'unit',
        notes: ''
      });
    }

    return {
      customer: {
        client_name: null,
        rif: rifMatch ? `${rifMatch[1].toUpperCase()}-${rifMatch[2]}${rifMatch[3] ? '-' + rifMatch[3] : ''}` : null,
        contact: null,
        phone: phoneMatch ? phoneMatch[0] : null,
        email: emailMatch ? emailMatch[0] : null,
        city: 'Caracas'
      },
      items,
      cross_selling_ideas: [
        'Resmas de Papel Bond Carta 75g',
        'Carpetas Manila / Fibra y Archivadores Lomo Ancho',
        'Bolígrafos por Caja y Grapas 26/6'
      ],
      ack_message: '¡Hola! Recibimos su solicitud en JJ Paper C.A. Ya procesamos las cantidades exactas según la presentación oficial de cada empaque y le compartimos su cotización formal a Tasa BCV.'
    };
  }

  /**
   * --------------------------------------------------------------------------
   * 15. Parser y Pre-armador Inteligente de Cotizaciones con IA
   * Analiza correos o WhatsApps entrantes, extrae cliente e ítems, convierte
   * unidades sueltas a paquetes/cajas del catálogo (ej. 300 fundas -> 3 paq x 100)
   * y genera acuse.
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
   - "raw_query": El texto exacto como lo pidió el cliente (ej: "300 fundas protectoras carta").
   - "product_name": Nombre comercial estándar normalizado sin incluir la cantidad pedida.
     *APLICA ESTOS SINÓNIMOS VENEZOLANOS:*
     "tirro" = Cinta de Enmascarar / Masking Tape.
     "celoven" = Cinta Adhesiva Transparente.
     "tipex" = Corrector Líquido / Cinta Correctora.
     "resmas chamex / hp / report" = Papel Fotocopia Carta / Oficio 75g.
     "silicon liquido" = Pega Líquida de Silicón.
     "marcador acrilico" = Marcador para Pizarra Blanca.
     "hojas de examen" = Papel Ministro.
   - "qty": Cantidad numérica exacta solicitada por el cliente (ej: si dice "300 fundas protectoras", qty es 300). ¡PROHIBIDO inventar números o usar números del nombre del producto!
   - "explicit_pack_request": true SOLO si el cliente pidió explícitamente paquetes o cajas (ej: "3 paquetes de fundas", "5 cajas de bolígrafos"); false si pidió unidades directas (ej: "300 fundas protectoras", "24 bolígrafos").
   - "unit": Unidad mencionada por el cliente (unidad, paquete, caja, resma, rollo, bulto).
   - "unit_type": Si el cliente pide bultos o cajas master pon "bulk"; de lo contrario pon "unit".
   - "notes": Especificación adicional si hay (color, marca, tamaño carta/oficio).

3. "cross_selling_ideas": Array de strings con 2 o 3 productos complementarios.
4. "ack_message": Acuse de recibo breve y profesional.

DEVUELVE ÚNICAMENTE UN JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA:
{
  "customer": {
    "client_name": null,
    "rif": null,
    "contact": null,
    "phone": null,
    "email": null,
    "city": "Caracas"
  },
  "items": [
    {
      "raw_query": "300 fundas protectoras",
      "product_name": "Funda Protectora",
      "qty": 300,
      "explicit_pack_request": false,
      "unit": "unidad",
      "unit_type": "unit",
      "notes": ""
    }
  ],
  "cross_selling_ideas": ["Archivadores Lomo Ancho", "Separadores"],
  "ack_message": "Texto del acuse..."
}

TEXTO CRUDO DE LA SOLICITUD DEL CLIENTE:
"""
${rawText}
"""`;

    let parsed = null;
    try {
      const rawResponse = await callGemini(prompt, 'gemini-2.5-flash');
      parsed = extractJSON(rawResponse);
    } catch (aiErr) {
      console.warn('Usando parser local inteligente de cotizaciones:', aiErr.message);
      parsed = _parseQuoteTextLocally(rawText);
    }

    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      parsed = _parseQuoteTextLocally(rawText);
    }

    if (Array.isArray(catalog) && catalog.length > 0 && Array.isArray(parsed.items)) {
      const STOP_WORDS = new Set(['para', 'con', 'por', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'cotizar', 'necesito', 'quiero', 'unidades', 'unidad', 'paquete', 'paquetes', 'caja', 'cajas']);

      parsed.items = parsed.items.map(it => {
        const rawQ = String(it.raw_query || '').toLowerCase();
        const query = String(it.product_name || it.raw_query || '').toLowerCase();
        const requestedBulk = it.unit_type === 'bulk' || /\b(?:bultos?|bto|master)\b/i.test(rawQ);
        const explicitPack = Boolean(
          it.explicit_pack_request ||
          /\b(\d+)\s*(?:paquetes?|paq|cajas?|cj|bultos?|bto|resmas?|docenas?)\b/i.test(rawQ)
        );

        // Tokenizar palabras significativas con soporte de singularización básica (ej. "fundas protectoras" -> "funda", "protectora")
        const rawWords = query
          .replace(/[^\wáéíóúñü\s]/gi, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

        let matched = null;
        let bestScore = 0;

        for (const prod of catalog) {
          const prodName = String(prod.name || '').toLowerCase();
          const prodUnit = String(prod.unit || '').toLowerCase();
          const isBulkProduct = prodName.includes('bulto') || prodUnit.includes('bulto') || prodName.includes('master');

          if (!requestedBulk && isBulkProduct) continue;
          if (requestedBulk && !isBulkProduct) continue;

          let score = 0;
          for (const w of rawWords) {
            const stem = w.replace(/(?:es|s)$/i, '');
            if (prodName.includes(w)) {
              score += 4;
            } else if (stem.length >= 3 && prodName.includes(stem)) {
              score += 3;
            }
          }

          // Bonus si coincide tamaño carta / oficio mencionado
          if (rawQ.includes('carta') && prodName.includes('carta')) score += 2;
          if (rawQ.includes('oficio') && prodName.includes('oficio')) score += 2;
          // Bonus si tiene stock disponible (desempate, nunca reemplaza cantidad)
          if (score > 0 && Number(prod.stock || 0) > 0) score += 0.5;

          if (score > bestScore) {
            bestScore = score;
            matched = prod;
          }
        }

        if (matched && bestScore >= 2.5) {
          const requestedQty = Math.max(1, Number(it.qty) || 1);
          const packSize = extractPackSize(matched.name, matched.unit);
          let finalQty = requestedQty;
          let conversionNote = null;

          // CONVERSIÓN INTELIGENTE DE UNIDADES A EMPAQUES DEL CATÁLOGO:
          // Ejemplo real: El cliente pide "300 fundas protectoras" (unidades individuales, no dijo "300 paquetes")
          // y el producto en catálogo viene en Paquete x 100 (packSize = 100).
          // Entonces 300 / 100 = 3 paquetes (total 300 fundas), NUNCA 300 paquetes ni 89 (stock).
          if (!explicitPack && packSize > 1 && requestedQty >= packSize) {
            const packsNeeded = Math.ceil(requestedQty / packSize);
            const totalUnits = packsNeeded * packSize;
            finalQty = packsNeeded;
            conversionNote = `${packsNeeded} empaque(s) × ${packSize} unds = ${totalUnits} unds (solicitadas: ${requestedQty})`;
          } else if (!explicitPack && packSize >= 10 && requestedQty > 1 && (requestedQty % packSize === 0)) {
            const packsNeeded = requestedQty / packSize;
            finalQty = packsNeeded;
            conversionNote = `${packsNeeded} empaque(s) × ${packSize} unds = ${requestedQty} unds`;
          }

          return {
            ...it,
            qty: finalQty,
            requested_qty: requestedQty,
            pack_size: packSize,
            conversion_note: conversionNote,
            matched: true,
            product_id: matched.id,
            catalog_name: matched.name,
            price_usd: matched.price_usd || matched.price_a || 0,
            price_a: matched.price_a || matched.price_usd || 0,
            price_b: matched.price_b || matched.price_usd || 0,
            price_c_bs: matched.price_c_bs || 0,
            price_d_bs: matched.price_d_bs || 0,
            unit: matched.unit || it.unit || 'unid',
            brand: matched.brand || (matched.jjp_brands?.name) || null,
            sku: matched.sku,
            variant_id: matched.variant_id || matched.id
          };
        }
        return {
          ...it,
          qty: Math.max(1, Number(it.qty) || 1),
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
    extractPackSize,
    searchProductsLive,
    interpretQueryWithAI,
    detectProductType,
    matchesVariant,
    enrichProductForMarketing,
    generateProductStudioPhoto,
    searchRealProductPhoto,
    askCopilot,
    renderProductCard,
    draftStrategicSalesMessage,
    COMMERCIAL_TONE_DIRECTIVES,
    SECTOR_NAMES,
    VALUE_HOOK_DESCS,
    syncKeysFromSettings,
    setKeys: (newKeys) => { if (Array.isArray(newKeys) && newKeys.length > 0) GEMINI_KEYS = newKeys; },
    getKeys: () => [...GEMINI_KEYS],
    getCurrentKeyIndex: () => _keyIndex,
    getTotalKeys: () => GEMINI_KEYS.length
  };
});


