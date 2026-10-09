// Cloudflare Pages Function: same-origin proxy for NDBC (which sends no CORS headers)
const NDBC_LATEST_OBS = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';

export async function onRequestGet() {
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
