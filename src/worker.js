// Nicotine Taper: Worker entry. /api/* is handled here; everything else is static (public/).
import { buildPlan, DEFAULTS, InputError } from '../public/taper.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, init) => Response.json(data, init);

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true });
  }
  // Same calculation the page runs in the browser, for scripts and other clients.
  if (url.pathname === '/api/plan' && request.method === 'GET') {
    const input = {};
    for (const k of Object.keys(DEFAULTS)) if (url.searchParams.has(k)) input[k] = url.searchParams.get(k);
    try {
      return json(buildPlan(input));
    } catch (e) {
      if (e instanceof InputError) throw new HttpError(400, e.message);
      throw e;
    }
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Send *.workers.dev visitors to the custom domain so shared links and saved plans live on one host.
    if (env.CANONICAL_HOST && url.hostname.endsWith('.workers.dev')) {
      url.hostname = env.CANONICAL_HOST;
      return Response.redirect(url.toString(), ['GET', 'HEAD'].includes(request.method) ? 301 : 308);
    }
    try {
      // Reject cross-site state-changing requests.
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request rejected.');
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      console.error(e);
      return json({ error: 'Internal error.' }, { status: 500 });
    }
  },
};
