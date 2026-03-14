const KEEP_ALLTIME = 5;           // top 5 survive forever
const WEEK_S = 7 * 24 * 60 * 60;
const DAY_S  = 24 * 60 * 60;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'GET')    return handleGet(url, env);
  if (request.method === 'POST')   return handlePost(request, env);
  if (request.method === 'DELETE') return handleDelete(request, url, env);
  return new Response('Method Not Allowed', { status: 405 });
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
  let body;
  try { body = await request.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const { student_name, game, score } = body;
  if (!student_name || !game || score == null) {
    return new Response('Missing fields', { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB
      .prepare('INSERT INTO scores (student_name, game, score, created_at) VALUES (?, ?, ?, ?)')
      .bind(student_name, game, Number(score), now)
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
