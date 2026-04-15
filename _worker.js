/**
 * boxradio — internet radio player
 *
 * Delivers the player interface and live now-playing track info
 * from our network of broadcast servers around the world.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket metadata channel
    if (url.pathname === '/ws') {
      return forwardMetadata(request, env);
    }

    // Audio stream delivery — long-lived chunked response
    if (url.pathname.startsWith('/stream/')) {
      return forwardStream(request, env, url.pathname);
    }

    // Player telemetry — short POST from the player client
    if (url.pathname === '/api/buffer' || url.pathname === '/api/telemetry') {
      return forwardBuffer(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// forwardMetadata proxies the WebSocket upgrade to a backend node.
async function forwardMetadata(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const nodes = parseNodes(env);

  for (const node of nodes) {
    try {
      const upstream = new WebSocket(node + '/ws');

      await new Promise((resolve, reject) => {
        upstream.addEventListener('open', resolve);
        upstream.addEventListener('error', reject);
      });

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      upstream.binaryType = 'arraybuffer';
      server.binaryType = 'arraybuffer';

      upstream.addEventListener('message', ({ data }) => {
        try { server.send(data); } catch (_) {}
      });
      server.addEventListener('message', ({ data }) => {
        try { upstream.send(data); } catch (_) {}
      });
      upstream.addEventListener('close', ({ code, reason }) => {
        const c = code === 1005 || code === 1006 ? 1011 : code;
        try { server.close(c, reason || ''); } catch (_) {}
      });
      server.addEventListener('close', ({ code, reason }) => {
        const c = code === 1005 || code === 1006 ? 1011 : code;
        try { upstream.close(c, reason || ''); } catch (_) {}
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

// forwardStream proxies GET /stream/{channel} to a backend node.
// The response is a long-lived chunked stream (audio data).
async function forwardStream(request, env, pathname) {
  const nodes = parseNodes(env);

  for (const node of nodes) {
    try {
      const upstream = await fetch(node + pathname, {
        method: 'GET',
        headers: forwardHeaders(request, ['accept', 'x-session-token', 'cache-control']),
      });

      if (!upstream.ok && upstream.status !== 200) {
        continue;
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
          'X-Accel-Buffering': 'no',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (_) {
      // try next node
    }
  }

  return new Response('stream unavailable', { status: 503 });
}

// forwardBuffer proxies POST /api/buffer (player telemetry) to a backend node.
async function forwardBuffer(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const nodes = parseNodes(env);
  const body = await request.arrayBuffer();

  for (const node of nodes) {
    try {
      const upstream = await fetch(node + '/api/buffer', {
        method: 'POST',
        headers: forwardHeaders(request, ['content-type', 'content-length', 'x-session-token', 'x-seq']),
        body,
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Length': '0',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (_) {
      // try next node
    }
  }

  return new Response('unavailable', { status: 503 });
}

function parseNodes(env) {
  return (env.STREAM_NODES ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function forwardHeaders(request, names) {
  const out = {};
  for (const name of names) {
    const val = request.headers.get(name);
    if (val) out[name] = val;
  }
  return out;
}
