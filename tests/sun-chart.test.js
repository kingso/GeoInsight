import { describe, it, expect } from 'vitest';
import { getSunTimes, getSunAzimuth, toDays, sunCoords, RAD } from '../js/sun-chart.js';

// ── toDays ──────────────────────────────────────────────

describe('toDays', () => {
  it('returns 0 for J2000 epoch (2000-01-01 12:00 UTC)', () => {
    // J2000 = January 1.5, 2000 = 2000-01-01T12:00:00Z
    const j2000 = new Date('2000-01-01T12:00:00Z');
    expect(toDays(j2000)).toBeCloseTo(0, 4);
  });

  it('returns a negative value for dates before J2000', () => {
    const date = new Date('1990-01-01T00:00:00Z');
    expect(toDays(date)).toBeLessThan(0);
  });

  it('returns a positive value for dates after J2000', () => {
    const date = new Date('2025-01-01T00:00:00Z');
    expect(toDays(date)).toBeGreaterThan(0);
  });

  it('increments by approximately 1 per day', () => {
    const day1 = new Date('2024-06-01T00:00:00Z');
    const day2 = new Date('2024-06-02T00:00:00Z');
    const diff = toDays(day2) - toDays(day1);
    expect(diff).toBeCloseTo(1, 5);
  });
});

// ── sunCoords ───────────────────────────────────────────

describe('sunCoords', () => {
  it('returns an object with dec and ra properties', () => {
    const d = toDays(new Date('2024-06-21T12:00:00Z'));
    const coords = sunCoords(d);
    expect(coords).toHaveProperty('dec');
    expect(coords).toHaveProperty('ra');
  });

  it('declination is near maximum (~+23.4°) at June solstice', () => {
    // June solstice ~ June 21
    const d = toDays(new Date('2024-06-21T12:00:00Z'));
    const { dec } = sunCoords(d);
    const decDeg = dec / RAD;
    expect(decDeg).toBeGreaterThan(22);
    expect(decDeg).toBeLessThan(24);
  });

  it('declination is near minimum (~-23.4°) at December solstice', () => {
    const d = toDays(new Date('2024-12-21T12:00:00Z'));
    const { dec } = sunCoords(d);
    const decDeg = dec / RAD;
    expect(decDeg).toBeLessThan(-22);
    expect(decDeg).toBeGreaterThan(-24);
  });

  it('declination is near 0° at the March equinox', () => {
    const d = toDays(new Date('2024-03-20T12:00:00Z'));
    const { dec } = sunCoords(d);
    const decDeg = dec / RAD;
    expect(Math.abs(decDeg)).toBeLessThan(1.5);
  });
});

// ── getSunTimes ─────────────────────────────────────────

describe('getSunTimes', () => {
  // London, UK — well-known latitude/longitude for sun-rise/set checks
  const LAT = 51.5;
  const LNG = -0.12;

  it('returns sunrise, sunset, and noon as Date objects', () => {
    const date = new Date('2024-06-21');
    const times = getSunTimes(date, LAT, LNG);
    expect(times.sunrise).toBeInstanceOf(Date);
    expect(times.sunset).toBeInstanceOf(Date);
    expect(times.noon).toBeInstanceOf(Date);
  });

  it('sunrise is before noon, noon is before sunset', () => {
    const date = new Date('2024-06-21');
    const { sunrise, sunset, noon } = getSunTimes(date, LAT, LNG);
    expect(sunrise.getTime()).toBeLessThan(noon.getTime());
    expect(noon.getTime()).toBeLessThan(sunset.getTime());
  });

  it('day length is longer in summer than winter at mid-latitudes', () => {
    const summer = new Date('2024-06-21');
    const winter = new Date('2024-12-21');
    const { sunrise: sr1, sunset: ss1 } = getSunTimes(summer, LAT, LNG);
    const { sunrise: sr2, sunset: ss2 } = getSunTimes(winter, LAT, LNG);

    const summerLen = ss1.getTime() - sr1.getTime();
    const winterLen = ss2.getTime() - sr2.getTime();
    expect(summerLen).toBeGreaterThan(winterLen);
  });

  it('at the equator the day length is close to 12 hours', () => {
    const equinox = new Date('2024-03-20');
    const { sunrise, sunset } = getSunTimes(equinox, 0, 0);
    const dayLengthHours = (sunset.getTime() - sunrise.getTime()) / 3600000;
    // Should be within 30 minutes of 12 h on the equinox at the equator
    expect(dayLengthHours).toBeGreaterThan(11.5);
    expect(dayLengthHours).toBeLessThan(12.5);
  });

  it('at a polar latitude in summer there is no real night (day ≥ 20 h)', () => {
    // North Pole area: lat 70°N at summer solstice
    const summerSolstice = new Date('2024-06-21');
    const { sunrise, sunset } = getSunTimes(summerSolstice, 70, 0);
    const dayLengthHours = (sunset.getTime() - sunrise.getTime()) / 3600000;
    expect(dayLengthHours).toBeGreaterThan(20);
  });

  it('produces consistent results for the same inputs', () => {
    const date = new Date('2024-09-15');
    const t1 = getSunTimes(date, 40.7, -74.0);
    const t2 = getSunTimes(date, 40.7, -74.0);
    expect(t1.sunrise.getTime()).toBe(t2.sunrise.getTime());
    expect(t1.sunset.getTime()).toBe(t2.sunset.getTime());
  });
});

// ── getSunAzimuth ───────────────────────────────────────

describe('getSunAzimuth', () => {
  it('returns sunriseAz and sunsetAz as integers', () => {
    const date = new Date('2024-06-21');
    const az = getSunAzimuth(date, 51.5, -0.12);
    expect(Number.isInteger(az.sunriseAz)).toBe(true);
    expect(Number.isInteger(az.sunsetAz)).toBe(true);
  });

  it('azimuths are in the range [0, 360]', () => {
    const date = new Date('2024-06-21');
    const az = getSunAzimuth(date, 51.5, -0.12);
    expect(az.sunriseAz).toBeGreaterThanOrEqual(0);
    expect(az.sunriseAz).toBeLessThanOrEqual(360);
    expect(az.sunsetAz).toBeGreaterThanOrEqual(0);
    expect(az.sunsetAz).toBeLessThanOrEqual(360);
  });

  it('sunset azimuth is the mirror of sunrise azimuth (360 − sunriseAz)', () => {
    // The implementation defines azSet = 360 - azRise for all inputs;
    // verify this contract holds regardless of date or location.
    const cases = [
      { date: new Date('2024-06-21'), lat: 51.5, lng: -0.12 },
      { date: new Date('2024-12-21'), lat: -33.9, lng: 151.2 },
      { date: new Date('2024-03-20'), lat: 0, lng: 0 },
    ];
    for (const { date, lat, lng } of cases) {
      const az = getSunAzimuth(date, lat, lng);
      expect(az.sunsetAz).toBe(360 - az.sunriseAz);
    }
  });

  it('at the equinox at the equator sunrise is due East (~90°)', () => {
    const equinox = new Date('2024-03-20');
    const az = getSunAzimuth(equinox, 0, 0);
    // At the equinox the sun rises very close to due East (90°)
    expect(az.sunriseAz).toBeGreaterThanOrEqual(85);
    expect(az.sunriseAz).toBeLessThanOrEqual(95);
  });

  it('in summer sunrise azimuth is north of East (< 90°) in the Northern Hemisphere', () => {
    const summer = new Date('2024-06-21');
    const az = getSunAzimuth(summer, 51.5, -0.12);
    // Summer sunrise is in the NE quadrant
    expect(az.sunriseAz).toBeLessThan(90);
  });
});
