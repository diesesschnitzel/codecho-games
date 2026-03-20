const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://codecho.de',
  'https://games.codecho.de',
];

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');

  const corsHeaders = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return new Response('Service unavailable', { status: 503, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400, headers: corsHeaders });
  }

  const { missedProblems, lang = 'de' } = body;

  if (!Array.isArray(missedProblems) || missedProblems.length === 0) {
    return Response.json({ explanation: null }, { headers: corsHeaders });
  }

  const problems = missedProblems.slice(0, 5);
  for (const p of problems) {
    if (typeof p.a !== 'number' || typeof p.b !== 'number' ||
        p.a < 1 || p.a > 20 || p.b < 1 || p.b > 20) {
      return new Response('Invalid problem', { status: 400, headers: corsHeaders });
    }
  }

  const problemList = problems.map(p => `${p.a} × ${p.b} = ${p.a * p.b}`).join(', ');
  const isGerman = lang.startsWith('de');

  const prompt = isGerman
    ? `Du hilfst einem Schüler beim Einmaleins. Er hat verpasst: ${problemList}. Schreib genau einen kurzen Merksatz auf Deutsch. Kein Markdown, keine Sternchen, keine Aufzählung.`
    : `Help a student remember: ${problemList}. Write exactly one short tip. No markdown, no asterisks, no lists.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic error: ${res.status}`);

    const data = await res.json();
    const explanation = data.content?.[0]?.text ?? null;

    return Response.json({ explanation }, { headers: corsHeaders });
  } catch (err) {
    console.error('Anthropic API error:', err);
    return Response.json({ explanation: null }, { headers: corsHeaders });
  }
}
