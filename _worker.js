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
      const resp = await fetch(node + '/ws', {
        headers: request.headers,
      });
      return resp;
    } catch (_) {
      // try next
    }
  }

  return new Response('stream unavailable', { status: 503 });
}
