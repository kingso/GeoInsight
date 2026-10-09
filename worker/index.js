// Static files are served from assets first; only unmatched requests reach this Worker.
const NDBC_LATEST_OBS = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';
const GEBCO_API = 'https://api.opentopodata.org/v1/gebco2020';

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

async function handleDepth(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: 'Invalid lat/lng' }, { status: 400 });
  }

  // Rounded to ~100 m (finer than GEBCO's grid) so nearby clicks share the edge cache
  const loc = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const upstream = await fetch(`${GEBCO_API}?locations=${loc}`, {
    cf: { cacheTtl: 86400, cacheEverything: true }
  });
  if (!upstream.ok) {
    return Response.json({ error: `Bathymetry upstream error: ${upstream.status}` }, { status: 502 });
  }

  const data = await upstream.json();
  const elevation = data.results?.[0]?.elevation;
  return Response.json(
    { elevation: Number.isFinite(elevation) ? elevation : null },
    { headers: { 'Cache-Control': 'public, max-age=86400' } }
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/buoys' && request.method === 'GET') {
      return handleBuoys();
    }

    if (url.pathname === '/api/depth' && request.method === 'GET') {
      return handleDepth(url);
    }

    return new Response('Not found', { status: 404 });
  }
};
