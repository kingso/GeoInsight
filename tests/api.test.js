import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getWeatherInfo,
  windDirection,
  getAqiInfo,
  fetchEarthquakes,
  fetchAllLocationData,
} from '../js/api.js';

// ── getWeatherInfo ──────────────────────────────────────

describe('getWeatherInfo', () => {
  it('returns clear sky info for code 0', () => {
    const [icon, desc] = getWeatherInfo(0);
    expect(icon).toBe('☀️');
    expect(desc).toBe('Clear sky');
  });

  it('returns thunderstorm info for code 95', () => {
    const [icon, desc] = getWeatherInfo(95);
    expect(icon).toBe('⛈️');
    expect(desc).toBe('Thunderstorm');
  });

  it('returns heavy snow for code 75', () => {
    const [icon, desc] = getWeatherInfo(75);
    expect(icon).toBe('🌨️');
    expect(desc).toBe('Heavy snow');
  });

  it('returns unknown fallback for an unrecognised code', () => {
    const [icon, desc] = getWeatherInfo(999);
    expect(icon).toBe('❓');
    expect(desc).toBe('Unknown');
  });

  it('returns moderate rain for code 63', () => {
    const [icon, desc] = getWeatherInfo(63);
    expect(desc).toBe('Moderate rain');
  });
});

// ── windDirection ───────────────────────────────────────

describe('windDirection', () => {
  it('returns N for 0 degrees', () => {
    expect(windDirection(0)).toBe('N');
  });

  it('returns N for 360 degrees', () => {
    expect(windDirection(360)).toBe('N');
  });

  it('returns E for 90 degrees', () => {
    expect(windDirection(90)).toBe('E');
  });

  it('returns S for 180 degrees', () => {
    expect(windDirection(180)).toBe('S');
  });

  it('returns W for 270 degrees', () => {
    expect(windDirection(270)).toBe('W');
  });

  it('returns NE for 45 degrees', () => {
    expect(windDirection(45)).toBe('NE');
  });

  it('returns SW for 225 degrees', () => {
    expect(windDirection(225)).toBe('SW');
  });

  it('returns NNE for 22.5 degrees', () => {
    expect(windDirection(22.5)).toBe('NNE');
  });
});

// ── getAqiInfo ──────────────────────────────────────────

describe('getAqiInfo', () => {
  it('returns Good for AQI 0', () => {
    const info = getAqiInfo(0);
    expect(info.level).toBe('Good');
    expect(info.cls).toBe('aqi-good');
  });

  it('returns Good for AQI 50', () => {
    const info = getAqiInfo(50);
    expect(info.level).toBe('Good');
  });

  it('returns Moderate for AQI 51', () => {
    const info = getAqiInfo(51);
    expect(info.level).toBe('Moderate');
    expect(info.cls).toBe('aqi-moderate');
  });

  it('returns Moderate for AQI 100', () => {
    const info = getAqiInfo(100);
    expect(info.level).toBe('Moderate');
  });

  it('returns Unhealthy for Sensitive Groups for AQI 101', () => {
    const info = getAqiInfo(101);
    expect(info.level).toBe('Unhealthy for Sensitive Groups');
    expect(info.cls).toBe('aqi-sensitive');
  });

  it('returns Unhealthy for AQI 151', () => {
    const info = getAqiInfo(151);
    expect(info.level).toBe('Unhealthy');
    expect(info.cls).toBe('aqi-unhealthy');
  });

  it('returns Very Unhealthy for AQI 201', () => {
    const info = getAqiInfo(201);
    expect(info.level).toBe('Very Unhealthy');
    expect(info.cls).toBe('aqi-very-unhealthy');
  });

  it('returns Hazardous for AQI 301', () => {
    const info = getAqiInfo(301);
    expect(info.level).toBe('Hazardous');
    expect(info.cls).toBe('aqi-hazardous');
  });

  it('includes advice text for every level', () => {
    [0, 51, 101, 151, 201, 301].forEach(aqi => {
      const info = getAqiInfo(aqi);
      expect(typeof info.advice).toBe('string');
      expect(info.advice.length).toBeGreaterThan(0);
    });
  });
});

// ── fetchEarthquakes (caching) ──────────────────────────

describe('fetchEarthquakes', () => {
  const mockFeature = (mag, depth) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.5, 37.5, depth] },
    properties: { mag, place: 'Test location', time: Date.now() }
  });

  const makeResponse = (features = [mockFeature(3.5, 10)]) => ({
    type: 'FeatureCollection',
    features
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns earthquake GeoJSON with enriched depth fields', async () => {
    const rawData = makeResponse([mockFeature(3.5, 12.3)]);
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => rawData
    });

    const result = await fetchEarthquakes(true);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    const f = result.features[0];
    expect(f.properties.depth_km).toBe(12.3);
    expect(typeof f.properties.depth_mi).toBe('number');
    expect(f.properties.depth_mi).toBeGreaterThan(0);
  });

  it('returns cached data on subsequent calls within TTL', async () => {
    const rawData = makeResponse();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => rawData
    });

    // First call fills the cache
    await fetchEarthquakes(true);
    // Second call should use cache (fetch NOT called again)
    await fetchEarthquakes(false);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when forceRefresh is true', async () => {
    const rawData = makeResponse();
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => rawData })
      .mockResolvedValueOnce({ ok: true, json: async () => rawData });

    await fetchEarthquakes(true);
    await fetchEarthquakes(true);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-OK response', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(fetchEarthquakes(true)).rejects.toThrow('USGS API error: 503');
  });

  it('correctly converts depth to miles', async () => {
    const rawData = makeResponse([mockFeature(4.0, 100)]);
    fetch.mockResolvedValueOnce({ ok: true, json: async () => rawData });

    const result = await fetchEarthquakes(true);
    const depthMi = result.features[0].properties.depth_mi;
    // 100 km * 0.621371 ≈ 62.1 miles
    expect(depthMi).toBeCloseTo(62.1, 0);
  });
});

// ── fetchAllLocationData ────────────────────────────────

describe('fetchAllLocationData', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all data when all promises resolve', async () => {
    const weatherData = { current: { temperature_2m: 20 } };
    const airData = { current: { us_aqi: 42 } };
    const elevData = { elevation: [150] };
    const placeData = { address: { city: 'London', country: 'UK', country_code: 'gb' }, display_name: 'London, UK' };

    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => weatherData })
      .mockResolvedValueOnce({ ok: true, json: async () => airData })
      .mockResolvedValueOnce({ ok: true, json: async () => elevData })
      .mockResolvedValueOnce({ ok: true, json: async () => placeData });

    const result = await fetchAllLocationData(51.5, -0.12);

    expect(result.weather).toEqual(weatherData);
    expect(result.airQuality).toEqual(airData);
    expect(result.elevation).toBe(150);
    expect(result.place.display).toBe('London, UK');
    expect(result.place.countryCode).toBe('GB');
    expect(result.errors.weather).toBeNull();
  });

  it('gracefully handles individual fetch failures', async () => {
    fetch
      .mockRejectedValueOnce(new Error('Weather API error: 500'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ current: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elevation: [0] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ address: {}, display_name: 'Unknown' }) });

    const result = await fetchAllLocationData(0, 0);

    expect(result.weather).toBeNull();
    expect(result.errors.weather).toBe('Weather API error: 500');
    expect(result.airQuality).not.toBeNull();
  });
});
