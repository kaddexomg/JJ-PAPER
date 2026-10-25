// Cloudflare Pages Function: POST /api/ai -> proxy a Gemini (evita bloqueo geográfico en Venezuela)
export async function onRequestPost({ request, env }) {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const { prompt, systemInstruction, temperature = 0.75, maxTokens = 1500, model = 'gemini-3.5-flash-lite', key: clientKey } = await request.json();
    if (!prompt) return new Response(JSON.stringify({ error: 'prompt vacío' }), { status: 400, headers: cors });
    const key = env.GEMINI_API_KEY || clientKey;
    if (!key) return new Response(JSON.stringify({ error: 'GEMINI_API_KEY no configurada' }), { status: 500, headers: cors });

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };

    const models = [model, 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-lite-latest'].filter((v, i, a) => v && !v.includes('2.') && a.indexOf(v) === i);
    for (const m of models) {
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
