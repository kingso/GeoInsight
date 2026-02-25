/* =========================================================
   GeoInsight — API Module
   All external data fetching (Open-Meteo, USGS, Nominatim)
   ========================================================= */

// ── Weather (Open-Meteo) ────────────────────────────────
export async function fetchWeather(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m',
      'surface_pressure', 'cloud_cover', 'uv_index', 'is_day'
    ].join(','),
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'sunrise', 'sunset', 'precipitation_sum',
      'precipitation_probability_max', 'wind_speed_10m_max'
    ].join(','),
    timezone: 'auto',
    forecast_days: '7'
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  return res.json();
}

// ── Air Quality (Open-Meteo) ────────────────────────────
export async function fetchAirQuality(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    current: [
      'european_aqi', 'us_aqi', 'pm10', 'pm2_5',
      'carbon_monoxide', 'nitrogen_dioxide',
      'sulphur_dioxide', 'ozone', 'dust', 'uv_index'
    ].join(','),
    timezone: 'auto'
  });

  const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  if (!res.ok) throw new Error(`Air Quality API error: ${res.status}`);
  return res.json();
}

// ── Elevation (Open-Meteo) ──────────────────────────────
export async function fetchElevation(lat, lng) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`
  );
  if (!res.ok) throw new Error(`Elevation API error: ${res.status}`);
  const data = await res.json();
  return data.elevation?.[0] ?? null;
}

// ── Reverse Geocoding (Nominatim / OpenStreetMap) ───────
export async function fetchPlaceName(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=en`,
    { headers: { 'User-Agent': 'GeoInsight-EarthExplorer/1.0' } }
  );
  if (!res.ok) throw new Error(`Geocoding error: ${res.status}`);
  const data = await res.json();

  const addr = data.address || {};
  const parts = [];
  if (addr.city || addr.town || addr.village || addr.hamlet) {
    parts.push(addr.city || addr.town || addr.village || addr.hamlet);
  }
  if (addr.state || addr.region) {
    parts.push(addr.state || addr.region);
  }
  if (addr.country) {
    parts.push(addr.country);
  }

  return {
    display: parts.length ? parts.join(', ') : (data.display_name || 'Unknown location'),
    raw: data
  };
}

// ── Earthquakes (USGS GeoJSON Feed) ────────────────────
let earthquakeCache = { data: null, timestamp: 0 };
const QUAKE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchEarthquakes() {
  const now = Date.now();
  if (earthquakeCache.data && (now - earthquakeCache.timestamp) < QUAKE_CACHE_TTL) {
    return earthquakeCache.data;
  }

  const res = await fetch(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
  );
  if (!res.ok) throw new Error(`USGS API error: ${res.status}`);
  const data = await res.json();

  // Enrich features: extract depth from geometry[2] into properties
  // (MapLibre expressions can't access the Z coordinate directly)
  for (const f of data.features) {
    const depthKm = f.geometry.coordinates[2] ?? 0;
    f.properties.depth_km = Math.round(depthKm * 10) / 10;
    f.properties.depth_mi = Math.round(depthKm * 0.621371 * 10) / 10;
  }

  earthquakeCache = { data, timestamp: now };
  return data;
}

// ── Buoys (NOAA NDBC) ──────────────────────────────────
let buoyCache = { data: null, timestamp: 0 };
const BUOY_CACHE_TTL = 30 * 60 * 1000; // 30 min (data is hourly)

const CORS_PROXY = 'https://corsproxy.io/?';
const NDBC_LATEST_OBS = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';

export async function fetchBuoys() {
  const now = Date.now();
  if (buoyCache.data && (now - buoyCache.timestamp) < BUOY_CACHE_TTL) {
    return buoyCache.data;
  }

  const res = await fetch(CORS_PROXY + encodeURIComponent(NDBC_LATEST_OBS));
  if (!res.ok) throw new Error(`NDBC API error: ${res.status}`);
  const text = await res.text();

  const geojson = parseNdbcLatestObs(text);
  buoyCache = { data: geojson, timestamp: now };
  return geojson;
}

function parseNdbcLatestObs(text) {
  const lines = text.split('\n').filter(l => l.trim());
  // First two lines are headers (#STN ... and #yr ...)
  const features = [];

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].trim().split(/\s+/);
    if (cols.length < 22) continue;

    const stn  = cols[0];
    const lat  = parseFloat(cols[1]);
    const lon  = parseFloat(cols[2]);
    if (isNaN(lat) || isNaN(lon)) continue;

    // Parse observation fields ("MM" = missing)
    const p = v => (v === 'MM' || v === 'MM\r') ? null : parseFloat(v);

    const year = cols[3], month = cols[4], day = cols[5], hour = cols[6], min = cols[7];
    const wdir = p(cols[8]);   // Wind direction (degT)
    const wspd = p(cols[9]);   // Wind speed (m/s)
    const gst  = p(cols[10]);  // Gust (m/s)
    const wvht = p(cols[11]);  // Wave height (m)
    const dpd  = p(cols[12]);  // Dominant wave period (s)
    const apd  = p(cols[13]);  // Average wave period (s)
    const mwd  = p(cols[14]);  // Mean wave direction (degT)
    const pres = p(cols[15]);  // Pressure (hPa)
    const ptdy = p(cols[16]);  // Pressure tendency (hPa)
    const atmp = p(cols[17]);  // Air temp (°C)
    const wtmp = p(cols[18]);  // Water temp (°C)
    const dewp = p(cols[19]);  // Dew point (°C)
    const vis  = p(cols[20]);  // Visibility (nmi)
    const tide = p(cols[21]);  // Tide (ft)

    // Skip stations with no useful data at all
    if (wspd === null && wvht === null && atmp === null && wtmp === null && pres === null) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        stn, wdir, wspd, gst, wvht, dpd, apd, mwd, pres, ptdy,
        atmp, wtmp, dewp, vis, tide,
        time: `${year}-${month}-${day} ${hour}:${min} UTC`,
        // Computed convenience fields
        wspdKts: wspd != null ? Math.round(wspd * 1.944) : null,
        gstKts:  gst  != null ? Math.round(gst * 1.944) : null,
        wvhtFt:  wvht != null ? Math.round(wvht * 3.281 * 10) / 10 : null,
        wtmpF:   wtmp != null ? Math.round(wtmp * 9 / 5 + 32) : null,
        atmpF:   atmp != null ? Math.round(atmp * 9 / 5 + 32) : null,
      }
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Fetch all location data in parallel ─────────────────
export async function fetchAllLocationData(lat, lng) {
  const [weather, airQuality, elevation, place] = await Promise.allSettled([
    fetchWeather(lat, lng),
    fetchAirQuality(lat, lng),
    fetchElevation(lat, lng),
    fetchPlaceName(lat, lng)
  ]);

  return {
    weather:    weather.status    === 'fulfilled' ? weather.value    : null,
    airQuality: airQuality.status === 'fulfilled' ? airQuality.value : null,
    elevation:  elevation.status  === 'fulfilled' ? elevation.value  : null,
    place:      place.status      === 'fulfilled' ? place.value      : null,
    errors: {
      weather:    weather.status    === 'rejected' ? weather.reason?.message    : null,
      airQuality: airQuality.status === 'rejected' ? airQuality.reason?.message : null,
      elevation:  elevation.status  === 'rejected' ? elevation.reason?.message  : null,
      place:      place.status      === 'rejected' ? place.reason?.message      : null,
    }
  };
}

// ── WMO Weather Code → Emoji + Description ──────────────
const WMO_CODES = {
  0:  ['☀️', 'Clear sky'],
  1:  ['🌤️', 'Mainly clear'],
  2:  ['⛅', 'Partly cloudy'],
  3:  ['☁️', 'Overcast'],
  45: ['🌫️', 'Foggy'],
  48: ['🌫️', 'Depositing rime fog'],
  51: ['🌦️', 'Light drizzle'],
  53: ['🌦️', 'Moderate drizzle'],
  55: ['🌧️', 'Dense drizzle'],
  56: ['🌧️', 'Light freezing drizzle'],
  57: ['🌧️', 'Dense freezing drizzle'],
  61: ['🌧️', 'Slight rain'],
  63: ['🌧️', 'Moderate rain'],
  65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Light freezing rain'],
  67: ['🌧️', 'Heavy freezing rain'],
  71: ['🌨️', 'Slight snow'],
  73: ['🌨️', 'Moderate snow'],
  75: ['🌨️', 'Heavy snow'],
  77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Slight rain showers'],
  81: ['🌦️', 'Moderate rain showers'],
  82: ['🌧️', 'Violent rain showers'],
  85: ['🌨️', 'Slight snow showers'],
  86: ['🌨️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorm'],
  96: ['⛈️', 'Thunderstorm with slight hail'],
  99: ['⛈️', 'Thunderstorm with heavy hail'],
};

export function getWeatherInfo(code) {
  return WMO_CODES[code] || ['❓', 'Unknown'];
}

// ── Wind Direction → Cardinal ───────────────────────────
export function windDirection(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── AQI Level Info ──────────────────────────────────────
export function getAqiInfo(usAqi) {
  if (usAqi <= 50)  return { level: 'Good', cls: 'aqi-good', advice: 'Air quality is satisfactory. No health risk.' };
  if (usAqi <= 100) return { level: 'Moderate', cls: 'aqi-moderate', advice: 'Acceptable. Some pollutants may be a concern for sensitive individuals.' };
  if (usAqi <= 150) return { level: 'Unhealthy for Sensitive Groups', cls: 'aqi-sensitive', advice: 'Sensitive groups may experience health effects. General public less likely affected.' };
  if (usAqi <= 200) return { level: 'Unhealthy', cls: 'aqi-unhealthy', advice: 'Everyone may begin to experience health effects.' };
  if (usAqi <= 300) return { level: 'Very Unhealthy', cls: 'aqi-very-unhealthy', advice: 'Health warnings of emergency conditions. Everyone more likely to be affected.' };
  return { level: 'Hazardous', cls: 'aqi-hazardous', advice: 'Health alert: everyone may experience serious health effects.' };
}
