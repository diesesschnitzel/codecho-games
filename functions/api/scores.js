const KEEP_ALLTIME = 50;          // Keep top 50 strictly surviving cleanup
const WEEK_S = 7 * 24 * 60 * 60;
const DAY_S  = 24 * 60 * 60;

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://codecho.de',
  'https://games.codecho.de',
  'https://neonmath.tomflohrmd.workers.dev'
];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  // Dynamically set CORS headers if the origin is trusted
  const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
  };

  if (ALLOWED_ORIGINS.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  }

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let response;
  if (request.method === 'GET')         response = await handleGet(url, env);
  else if (request.method === 'POST')   response = await handlePost(request, env);
  else if (request.method === 'DELETE') response = await handleDelete(request, url, env);
  else                                  response = new Response('Method Not Allowed', { status: 405 });

  // Attach CORS headers to response
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// GET /api/scores?game=neon-einmaleins&period=daily|weekly|alltime
async function handleGet(url, env) {
  const game   = url.searchParams.get('game')   || 'neon-einmaleins';
  const period = url.searchParams.get('period') || 'weekly';

  const now   = Math.floor(Date.now() / 1000);
  const since = period === 'daily'  ? now - DAY_S
              : period === 'weekly' ? now - WEEK_S
              : 0;

  const sql = since > 0
    ? 'SELECT id, student_name, score, created_at FROM scores WHERE game = ? AND created_at >= ? ORDER BY score DESC LIMIT 10'
    : 'SELECT id, student_name, score, created_at FROM scores WHERE game = ? ORDER BY score DESC LIMIT 10';

  try {
    const { results } = await env.DB
      .prepare(sql)
      .bind(...(since > 0 ? [game, since] : [game]))
      .all();
    return Response.json({ ok: true, period, entries: results ?? [] });
  } catch (err) {
    console.error('D1 GET error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// POST /api/scores  { student_name, game, score }
async function handlePost(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
     return new Response('Forbidden Origin', { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const { student_name, game, score } = body;
  
  // Security Validation: Field existence
  if (!student_name || !game || score == null) {
    return new Response('Missing fields', { status: 400 });
  }

  // Security Validation: Data integrity & Type checking
  if (typeof student_name !== 'string' || student_name.trim().length === 0 || student_name.trim().length > 20) {
    return new Response('Invalid student name: Must be 1-20 characters', { status: 400 });
  }
  
  const parsedScore = Number(score);
  if (!Number.isInteger(parsedScore) || parsedScore <= 0 || parsedScore > 99999) {
    return new Response('Invalid score: Must be a positive integer below 1M', { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB
      .prepare('INSERT INTO scores (student_name, game, score, created_at) VALUES (?, ?, ?, ?)')
      .bind(student_name.trim(), game, parsedScore, now)
      .run();

    // Cleanup: remove entries older than 7 days, but always keep the top KEEP_ALLTIME
    await env.DB.prepare(`
      DELETE FROM scores
      WHERE game = ?
        AND created_at < ?
        AND id NOT IN (
          SELECT id FROM scores WHERE game = ? ORDER BY score DESC LIMIT ?
        )
    `).bind(game, now - WEEK_S, game, KEEP_ALLTIME).run();

    return Response.json({ ok: true });
  } catch (err) {
    console.error('D1 POST error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// DELETE /api/scores?id=123   requires header X-Admin-Key
async function handleDelete(request, url, env) {
  const provided = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || provided !== env.ADMIN_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const id = url.searchParams.get('id');
  if (!id || isNaN(Number(id))) return new Response('Missing or invalid id', { status: 400 });

  try {
    await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(Number(id)).run();
    return Response.json({ ok: true, deleted: Number(id) });
  } catch (err) {
    console.error('D1 DELETE error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}
