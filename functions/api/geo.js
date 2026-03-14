export async function onRequest(context) {
  const country = context.request.cf?.country ?? 'DE';
  return Response.json({ country }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
