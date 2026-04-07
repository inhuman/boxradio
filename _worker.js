/**
 * Cloudflare Pages Worker — boxradio
 *
 * Serves the static player and forwards real-time metadata
 * connections to the nearest available stream node.
 *
 * Env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   STREAM_NODES  comma-separated list of stream node base URLs
 *                 e.g. "http://node1.example.com:9000,http://node2.example.com:9000"
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Real-time now-playing metadata channel
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
      return await fetch(`${node}/ws`, { headers: request.headers });
    } catch {
      // node unreachable, try next
    }
  }

  return new Response('stream unavailable', { status: 503 });
}
