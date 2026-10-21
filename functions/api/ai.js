// Cloudflare Pages Function: POST /api/ai  -> proxy a Gemini (evita bloqueo geográfico en Venezuela)
// Configurar variable de entorno GEMINI_API_KEY en Cloudflare Pages.
export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const { prompt, systemInstruction, temperature = 0.75, maxTokens = 1500, model = 'gemini-2.5-flash' } = await request.json();
    if (!prompt) return new Response(JSON.stringify({ error: 'prompt vacío' }), { status: 400, headers: cors });
    const key = env.GEMINI_API_KEY;
    if (!key) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY no configurada' }), { status: 500, headers: cors });

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

    for (const m of [model, 'gemini-2.0-flash']) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (r.ok) {
        const d = await r.json();
        const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (text) return new Response(JSON.stringify({ text, model: m }), { headers: cors });
      }
    }
    return new Response(JSON.stringify({ error: 'Gemini no respondió' }), { status: 502, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
