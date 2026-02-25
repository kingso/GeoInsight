/* =========================================================
   GeoInsight — UI Module
   Panel management, tab switching, data rendering
   ========================================================= */

import { getWeatherInfo, windDirection, getAqiInfo } from './api.js';
import { renderSunChart } from './sun-chart.js';

// ── Deferred Sun Chart state ────────────────────────────
let _sunChartPending = null; // { lat, lng, timezone }

// ── Tab Switching ───────────────────────────────────────
export function initTabs() {
  const tabs = document.querySelectorAll('#profile-tabs .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');

      // Render deferred sun chart when tab becomes visible
      if (tab.dataset.tab === 'sun' && _sunChartPending) {
        requestAnimationFrame(() => _renderSunCanvas());
      }
    });
  });
}

// ── Panel Show / Hide ───────────────────────────────────
export function showPanel() {
  document.getElementById('profile-panel').classList.add('open');
}

export function hidePanel() {
  document.getElementById('profile-panel').classList.remove('open');
}

// ── Set Loading State ───────────────────────────────────
export function setLoading(tabId) {
  const el = document.getElementById(tabId);
  if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

export function setError(tabId, message) {
  const el = document.getElementById(tabId);
  if (el) el.innerHTML = `<div class="error-msg">⚠️ ${message}</div>`;
}

// ── Update Header ───────────────────────────────────────
export function updateHeader(title, subtitle) {
  document.getElementById('profile-title').textContent = title;
  document.getElementById('profile-subtitle').textContent = subtitle;
}

// ── Render Overview Tab ─────────────────────────────────
export function renderOverview(data) {
  const el = document.getElementById('tab-overview');
  if (!el) return;

  const { weather, elevation, place } = data;
  const w = weather?.current;
  const units = weather?.current_units;
  const daily = weather?.daily;

  let html = '';

  // Hero: current conditions
  if (w) {
    const [icon, desc] = getWeatherInfo(w.weather_code);
    html += `
      <div class="overview-hero">
        <div class="weather-icon">${icon}</div>
        <div>
          <div class="temp">${Math.round(w.temperature_2m)}°${units?.temperature_2m?.replace('°', '') || 'C'}</div>
          <div class="desc">${desc}</div>
        </div>
      </div>`;
  }

  // Location details
  html += '<div class="info-card"><h4>Location</h4>';
  html += detailRow('📍 Place', place?.display || '—');
  html += detailRow('🌐 Coordinates', `${data.lat.toFixed(4)}°, ${data.lng.toFixed(4)}°`);
  if (elevation != null) {
    html += detailRow('🏔️ Elevation', `${Math.round(elevation)} m (${Math.round(elevation * 3.281)} ft)`);
  }
  if (weather?.timezone) {
    html += detailRow('🕐 Timezone', weather.timezone.replace(/_/g, ' '));
  }
  html += '</div>';

  // Today's sun
  if (daily?.sunrise?.[0] && daily?.sunset?.[0]) {
    const rise = new Date(daily.sunrise[0]);
    const set = new Date(daily.sunset[0]);
    const dtf = weather?.timezone
      ? new Intl.DateTimeFormat('en-GB', { timeZone: weather.timezone, hour: '2-digit', minute: '2-digit', hour12: false })
      : null;
    const fmtT = dt => dtf ? dtf.format(dt) : dt.toTimeString().slice(0, 5);
    const dayLen = (set - rise) / 3600000;

    html += '<div class="info-card"><h4>Today\'s Daylight</h4>';
    html += `<div class="stats-grid">
      <div class="stat-item"><span class="stat-label">☀️ Sunrise</span><span class="stat-value">${fmtT(rise)}</span></div>
      <div class="stat-item"><span class="stat-label">🌅 Sunset</span><span class="stat-value">${fmtT(set)}</span></div>
      <div class="stat-item"><span class="stat-label">⏱️ Daylight</span><span class="stat-value">${Math.floor(dayLen)}h ${Math.round((dayLen % 1) * 60)}m</span></div>
      ${w ? `<div class="stat-item"><span class="stat-label">☁️ Cloud Cover</span><span class="stat-value">${w.cloud_cover}%</span></div>` : ''}
    </div>`;
    html += '</div>';
  }

  // Quick weather stats
  if (w) {
    html += '<div class="info-card"><h4>Current Conditions</h4>';
    html += detailRow('🌡️ Feels Like', `${Math.round(w.apparent_temperature)}°${units?.temperature_2m?.replace('°', '') || 'C'}`);
    html += detailRow('💧 Humidity', `${w.relative_humidity_2m}%`);
    html += detailRow('💨 Wind', `${w.wind_speed_10m} ${units?.wind_speed_10m || 'km/h'} ${windDirection(w.wind_direction_10m)}`);
    html += detailRow('🌡️ Pressure', `${Math.round(w.surface_pressure)} ${units?.surface_pressure || 'hPa'}`);
    html += detailRow('☀️ UV Index', formatUV(w.uv_index));
    html += '</div>';
  }

  el.innerHTML = html;
}

// ── Render Weather Tab ──────────────────────────────────
export function renderWeather(weather) {
  const el = document.getElementById('tab-weather');
  if (!el) return;

  const w = weather.current;
  const units = weather.current_units;
  const daily = weather.daily;
  const tz = weather.timezone;
  const [icon, desc] = getWeatherInfo(w.weather_code);

  let html = '';

  // Current weather hero
  html += `
    <div class="current-weather">
      <div class="icon">${icon}</div>
      <div>
        <div class="temp-main">${Math.round(w.temperature_2m)}°</div>
        <div class="feels-like">Feels like ${Math.round(w.apparent_temperature)}° · ${desc}</div>
      </div>
    </div>`;

  // Current details grid
  html += '<div class="info-card"><h4>Current Details</h4><div class="stats-grid">';
  html += statItem('💧 Humidity', `${w.relative_humidity_2m}%`);
  html += statItem('💨 Wind', `${w.wind_speed_10m} ${units?.wind_speed_10m || 'km/h'} ${windDirection(w.wind_direction_10m)}`);
  html += statItem('🌡️ Pressure', `${Math.round(w.surface_pressure)} hPa`);
  html += statItem('☁️ Clouds', `${w.cloud_cover}%`);
  html += statItem('☀️ UV Index', formatUV(w.uv_index));
  html += statItem('🌧️ Precip', `${w.precipitation} ${units?.precipitation || 'mm'}`);
  html += '</div></div>';

  // 7-day forecast
  if (daily) {
    html += '<div class="info-card"><h4>7-Day Forecast</h4><div class="forecast-scroll">';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < daily.time.length; i++) {
      const d = new Date(daily.time[i] + 'T12:00');
      const dayName = i === 0 ? 'Today' : dayNames[d.getDay()];
      const [dIcon] = getWeatherInfo(daily.weather_code[i]);
      const hi = Math.round(daily.temperature_2m_max[i]);
      const lo = Math.round(daily.temperature_2m_min[i]);
      const precip = daily.precipitation_probability_max?.[i];

      html += `
        <div class="forecast-day ${i === 0 ? 'today' : ''}">
          <div class="day-name">${dayName}</div>
          <div class="day-icon">${dIcon}</div>
          <div class="day-temps">${hi}° <span class="low">${lo}°</span></div>
          ${precip != null ? `<div class="day-precip">💧 ${precip}%</div>` : ''}
        </div>`;
    }
    html += '</div></div>';
  }

  el.innerHTML = html;
}

// ── Render Air Quality Tab ──────────────────────────────
export function renderAirQuality(aqData) {
  const el = document.getElementById('tab-air');
  if (!el) return;

  const c = aqData.current;
  const usAqi = c.us_aqi;
  const info = getAqiInfo(usAqi);

  let html = '';

  // AQI badge
  html += `
    <div class="aqi-badge ${info.cls}">
      <span>${usAqi}</span>
      <span class="aqi-label">${info.level}</span>
    </div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">${info.advice}</p>`;

  // Pollutant bars
  html += '<div class="info-card"><h4>Pollutants</h4>';
  html += pollutantBar('PM2.5', c.pm2_5, 'µg/m³', 75, getPollutantColor(c.pm2_5, [12, 35, 55, 150]));
  html += pollutantBar('PM10', c.pm10, 'µg/m³', 200, getPollutantColor(c.pm10, [50, 100, 150, 250]));
  html += pollutantBar('Ozone (O₃)', c.ozone, 'µg/m³', 240, getPollutantColor(c.ozone, [60, 120, 180, 240]));
  html += pollutantBar('NO₂', c.nitrogen_dioxide, 'µg/m³', 200, getPollutantColor(c.nitrogen_dioxide, [40, 100, 150, 200]));
  html += pollutantBar('SO₂', c.sulphur_dioxide, 'µg/m³', 500, getPollutantColor(c.sulphur_dioxide, [40, 100, 200, 500]));
  html += pollutantBar('CO', c.carbon_monoxide, 'µg/m³', 15000, getPollutantColor(c.carbon_monoxide, [4000, 8000, 12000, 15000]));

  if (c.dust != null) {
    html += pollutantBar('Dust', c.dust, 'µg/m³', 100, getPollutantColor(c.dust, [20, 40, 60, 100]));
  }
  html += '</div>';

  // EU AQI
  if (c.european_aqi != null) {
    html += `<div class="info-card"><h4>European AQI</h4>
      <div class="stat-item"><span class="stat-value">${c.european_aqi}</span></div>
    </div>`;
  }

  el.innerHTML = html;
}

// ── Render Sun Chart Tab ────────────────────────────────
export function renderSunChartTab(lat, lng, timezone) {
  const el = document.getElementById('tab-sun');
  if (!el) return;

  el.innerHTML = `
    <div class="sun-today" id="sun-today-stats"></div>
    <canvas id="sun-chart-canvas"></canvas>
    <div id="sun-chart-info">Hover over the chart for daily details</div>
    <div class="info-card" style="margin-top:12px">
      <h4>Legend</h4>
      <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;">
        <span>🟡 <span style="color:#ffd700">Sunrise</span></span>
        <span>🟠 <span style="color:#ff6b35">Sunset</span></span>
        <span>🟢 <span style="color:#4ecdc4">Day Length</span></span>
        <span>⬜ Today</span>
        <span>🔴 <span style="color:#e91e63">Solstice/Equinox</span></span>
      </div>
    </div>`;

  // Store data for deferred rendering
  _sunChartPending = { lat, lng, timezone };

  // If the Sun Chart tab is already visible, render immediately
  if (el.classList.contains('active')) {
    requestAnimationFrame(() => _renderSunCanvas());
  }
}

// ── Internal: render the sun canvas + populate stats ────
function _renderSunCanvas() {
  if (!_sunChartPending) return;
  const { lat, lng, timezone } = _sunChartPending;
  const canvas = document.getElementById('sun-chart-canvas');
  if (!canvas) return;

  const result = renderSunChart(canvas, lat, lng, timezone);

  // Populate today stats
  const statsEl = document.getElementById('sun-today-stats');
  if (statsEl && result) {
    const hrs = Math.floor(result.dayLength);
    const mins = Math.round((result.dayLength % 1) * 60);
    statsEl.innerHTML = `
      <div class="sun-stat">
        <div class="icon">☀️</div>
        <div class="time" style="color:#ffd700">${result.sunrise}</div>
        <div class="label">Sunrise</div>
      </div>
      <div class="sun-stat">
        <div class="icon">🌅</div>
        <div class="time" style="color:#ff6b35">${result.sunset}</div>
        <div class="label">Sunset</div>
      </div>
      <div class="sun-stat">
        <div class="icon">⏱️</div>
        <div class="time" style="color:#4ecdc4">${hrs}h ${mins}m</div>
        <div class="label">Daylight</div>
      </div>`;
  }

  _sunChartPending = null; // Clear after successful render
}

// ── Helpers ─────────────────────────────────────────────
function detailRow(label, value) {
  return `<div class="detail-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

function statItem(label, value) {
  return `<div class="stat-item"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

function formatUV(uv) {
  if (uv == null) return '—';
  const v = Math.round(uv * 10) / 10;
  if (v <= 2)  return `${v} (Low)`;
  if (v <= 5)  return `${v} (Moderate)`;
  if (v <= 7)  return `${v} (High)`;
  if (v <= 10) return `${v} (Very High)`;
  return `${v} (Extreme)`;
}

function pollutantBar(name, value, unit, max, color) {
  const pct = Math.min((value / max) * 100, 100);
  const displayVal = value != null ? (value < 10 ? value.toFixed(1) : Math.round(value)) : '—';
  return `
    <div class="pollutant-bar">
      <div class="bar-header">
        <span class="name">${name}</span>
        <span class="val">${displayVal} ${unit}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

function getPollutantColor(value, thresholds) {
  if (value <= thresholds[0]) return '#22c55e';
  if (value <= thresholds[1]) return '#f59e0b';
  if (value <= thresholds[2]) return '#f97316';
  if (value <= thresholds[3]) return '#ef4444';
  return '#a855f7';
}
