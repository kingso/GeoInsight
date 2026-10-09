// Static files are served from assets first; only unmatched requests reach this Worker.
const NDBC_LATEST_OBS = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';

async function handleBuoys() {
  // NDBC sends no CORS headers, so the browser can't fetch it directly
  const upstream = await fetch(NDBC_LATEST_OBS, {
    cf: { cacheTtl: 600, cacheEverything: true }
  });

  if (!upstream.ok) {
    return new Response(`NDBC upstream error: ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/buoys' && request.method === 'GET') {
      return handleBuoys();
    }

    return new Response('Not found', { status: 404 });
  }
};
