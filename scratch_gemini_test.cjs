const GEMINI_KEYS = [
  'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw',
  'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E',
  'AQ.Ab8RN6IsSWjE9mHK9IRjNyauqgMLHLWLCJnwiEHU7Uo6sC0cNA'
];
const key = GEMINI_KEYS[0];

const items = [
  'GRAPADORA STD 24/6 26/6 METALICA C/G',
  'ESCARCHA 50GR SURTIDA COLORES METALICOS',
  'TALONARIO RECIBO DE CAJA 1/4 CARTA',
  'MARCADOR P/PIZARRA KORES AZUL C/T',
  'BOLIGRAFO KORES K1 CAJA X 50'
];

(async () => {
  const prompt = `Analiza estos 5 productos de papelería venezolana. Para cada uno, genera:
1) Tipo canónico exacto del producto físico en español comercial limpio.
2) La MEJOR query de búsqueda para Google/DuckDuckGo imágenes que encuentre la foto comercial real del producto en fondo blanco (sin palabras basura, sin códigos internos, sin abreviaturas raras).
3) El prompt fotográfico exacto en inglés para generar un packshot de catálogo de producto hiperrealista aislado en fondo blanco puro #FFFFFF con sombra suave.

Productos:
${JSON.stringify(items, null, 2)}

Devuelve SOLO un JSON array de objetos con esta estructura:
[
  {
    "raw": "...",
    "clean_name": "...",
    "search_query": "...",
    "packshot_prompt": "..."
  }
]`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    })
  });
  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log(rawText);
})().catch(console.error);
