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

const STATE_FIPS = new Set('01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56'.split(' '));

async function handleStateStats(url) {
  const fips = url.searchParams.get('fips');
  if (!STATE_FIPS.has(fips)) return Response.json({ error: 'Invalid state FIPS' }, { status: 400 });
  const upstreamUrl = new URL('https://api.censusreporter.org/1.0/data/show/acs2024_5yr');
  upstreamUrl.search = new URLSearchParams({ table_ids: 'B01003,B19013', geo_ids: `04000US${fips}` });
  try {
    const response = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'GeoInsight/1.0 (https://geo.kings.fyi)' },
      signal: AbortSignal.timeout(15000), cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!response.ok) throw new Error('ACS upstream unavailable');
    const data = await response.json();
    const records = data.data?.[`04000US${fips}`];
    if (data.release?.id !== 'acs2024_5yr' || !records) throw new Error('Invalid ACS data');
    const estimate = value => Number.isFinite(value) && value >= 0 ? value : null;
    return Response.json({
      population: estimate(records.B01003?.estimate?.B01003001),
      populationMoe: estimate(records.B01003?.error?.B01003001),
      medianIncome: estimate(records.B19013?.estimate?.B19013001),
      incomeMoe: estimate(records.B19013?.error?.B19013001),
      period: '2020-2024', dollarYear: '2024'
    }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
  } catch {
    return Response.json({ error: 'State statistics unavailable' }, { status: 502 });
  }
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

    if (url.pathname === '/api/us-state' && request.method === 'GET') {
      return handleStateStats(url);
    }

    return new Response('Not found', { status: 404 });
  }
};
