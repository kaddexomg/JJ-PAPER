import { log } from './logger.js';
import { db, dbCore } from './supabase.js';

let GEMINI_KEYS = [];
try {
  if (process.env.GEMINI_API_KEYS) {
    const parsed = JSON.parse(process.env.GEMINI_API_KEYS);
    if (Array.isArray(parsed) && parsed.length > 0) GEMINI_KEYS = parsed;
  }
} catch (_) {}

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash'
];

let _keyIndex = Math.floor(Math.random() * (GEMINI_KEYS.length || 1));

function getNextKey() {
  if (!GEMINI_KEYS.length) return null;
  _keyIndex = (_keyIndex + 1) % GEMINI_KEYS.length;
  return GEMINI_KEYS[_keyIndex];
}

export async function callGemini(prompt, systemInstruction = '', temperature = 0.2) {
  if (!GEMINI_KEYS.length) {
    // Intentar cargar de jjp_settings si está disponible
    try {
      const { data } = await db.from('jjp_settings').select('value').eq('key', 'ai_gemini_keys').maybeSingle();
      if (data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) GEMINI_KEYS = parsed;
      }
    } catch (_) {}
  }

  if (!GEMINI_KEYS.length) {
    throw new Error('No hay Gemini API keys configuradas en el servidor.');
  }

  const maxAttempts = GEMINI_KEYS.length * 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = getNextKey();
    for (const model of GEMINI_MODELS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 9000);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 1200 }
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

        if (res.status === 429) break; // cuota agotada en esta key -> rotar key
        if (res.status === 503) continue; // modelo saturado -> intentar siguiente modelo

        if (res.ok) {
          const json = await res.json();
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text.trim();
        }
      } catch (_) {}
    }
  }
  throw new Error('Todos los modelos y keys de Gemini fallaron en el servidor.');
}

function extractJson(str) {
  try { return JSON.parse(str); } catch (_) {}
  const match = str.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

/**
 * Analiza un correo entrante para detectar:
 * 1. Cambio de correo del cliente (e.g. "favor escribir a nuevo@...")
 * 2. Solicitud de cotización o pedido (e.g. "necesito cotización de 5 resmas y 10 rollos")
 * 3. Consulta general o intención de compra
 * 4. Petición de desuscripción (opt-out)
 */
export async function analyzeInboundEmail({ fromEmail, fromName, subject, bodyText, customerId = null }) {
  if (!bodyText || bodyText.length < 5) return null;

  const sys = `Eres el Agente Cognitivo de Entrada de JJ Paper C.A. (distribuidor mayorista de papelería en Caracas).
Tu labor es clasificar rigurosamente los correos entrantes de clientes y prospectos.

Debes responder ÚNICAMENTE con un JSON válido con la siguiente estructura:
{
  "is_email_change": boolean,
  "new_email": string | null (el nuevo correo electrónico detectado si el cliente indica que cambió de correo o da una nueva dirección),
  "is_quote_request": boolean (si solicita precios, catálogo o cotización de productos),
  "requested_items": [
    { "item": string, "quantity": number | null, "unit": string | null }
  ],
  "is_opt_out": boolean (si pide no ser contactado más o desuscribirse),
  "sentiment": "interesado" | "consulta" | "queja" | "neutro",
  "suggested_action": string,
  "draft_reply": string (borrador comercial respetuoso, breve y profesional firmado por JJ Paper C.A.)
}`;

  const userPrompt = `Analiza este correo recibido:
Remitente: "${fromName}" <${fromEmail}>
Asunto: "${subject}"
Cuerpo:
"""
${bodyText.slice(0, 4000)}
"""`;

  try {
    const raw = await callGemini(userPrompt, sys, 0.1);
    const parsed = extractJson(raw);
    return parsed;
  } catch (err) {
    log.warn({ err: err.message }, 'Fallo análisis de correo entrante con Gemini');
    return null;
  }
}

/**
 * Pre-arma una cotización estructurada a partir del texto de una solicitud
 */
export async function matchQuoteItemsFromText(itemsRequested = []) {
  if (!itemsRequested || !itemsRequested.length) return [];

  // Obtener catálogo plano de Proyecto A
  let catalog = [];
  try {
    const { data } = await dbCore.from('jjp_catalog_flat').select('id, name, price_usd, price_b, unit, brand').limit(1500);
    catalog = data || [];
  } catch (_) {}

  if (!catalog.length) return [];

  const matched = [];
  for (const req of itemsRequested) {
    const term = String(req.item || '').toLowerCase().trim();
    if (!term || term.length < 3) continue;

    // Búsqueda simple de coincidencias
    const found = catalog.find(p => {
      const pName = (p.name || '').toLowerCase();
      return pName.includes(term) || term.split(' ').every(w => w.length > 2 && pName.includes(w));
    });

    if (found) {
      matched.push({
        product_id: found.id,
        name: found.name,
        price_usd: Number(found.price_b || found.price_usd || 0),
        quantity: req.quantity || 1,
        unit: found.unit || req.unit || 'unid'
      });
    }
  }
  return matched;
}
