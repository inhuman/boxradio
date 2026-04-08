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
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const nodes = (env.STREAM_NODES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const node of nodes) {
    try {
      const upstream = new WebSocket(node + '/ws');

      // Wait for upstream to connect before wiring the pair.
      await new Promise((resolve, reject) => {
        upstream.addEventListener('open', resolve);
        upstream.addEventListener('error', reject);
      });

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();

      upstream.addEventListener('message', ({ data }) => {
        try { server.send(data); } catch (_) {}
      });
      server.addEventListener('message', ({ data }) => {
        try { upstream.send(data); } catch (_) {}
      });
      upstream.addEventListener('close', ({ code, reason }) => {
        try { server.close(code, reason); } catch (_) {}
      });
      server.addEventListener('close', ({ code, reason }) => {
        try { upstream.close(code, reason); } catch (_) {}
      });
      upstream.addEventListener('error', () => {
        try { server.close(1011, 'upstream error'); } catch (_) {}
      });

      return new Response(null, { status: 101, webSocket: client });
    } catch (_) {
      // try next node
    }
  }

  return new Response('stream unavailable', { status: 503 });
}
