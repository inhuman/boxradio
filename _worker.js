/**
 * boxradio — internet radio player
 *
 * Delivers the player interface and live now-playing track info
 * from our network of broadcast servers around the world.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return forwardMetadata(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function forwardMetadata(request, env) {
  const nodes = (env.STREAM_NODES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const node of nodes) {
    try {
      // Build a clean set of WebSocket upgrade headers for the upstream.
      // Do NOT forward the client's Host header — upstream is a raw IP endpoint.
      const upstreamUrl = new URL(node + '/ws');
      const headers = new Headers({
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': request.headers.get('Sec-WebSocket-Key') ?? '',
        'Sec-WebSocket-Version': request.headers.get('Sec-WebSocket-Version') ?? '13',
        'Host': upstreamUrl.host,
      });

      const resp = await fetch(upstreamUrl.toString(), { headers });
      return resp;
    } catch (_) {
      // try next
    }
  }

  return new Response('stream unavailable', { status: 503 });
}
