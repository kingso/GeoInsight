/* =========================================================
   GeoInsight — Main App Module
   Map initialization, layer management, interaction handling
   ========================================================= */

import { fetchAllLocationData, fetchEarthquakes, fetchBuoys, getWeatherInfo } from './api.js';
import {
  initTabs, showPanel, hidePanel, updateHeader,
  setLoading, setError,
  renderOverview, renderWeather, renderAirQuality, renderSunChartTab
} from './ui.js';

// ── State ───────────────────────────────────────────────
let map;
let marker;
let currentLat = null;
let currentLng = null;
let earthquakesLoaded = false;
let buoysLoaded = false;

// ── Base Layer Definitions ──────────────────────────────
const BASE_LAYERS = {
  streets: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxzoom: 19
  },
  topo: {
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxzoom: 17
  },
  satellite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    maxzoom: 19
  },
  dark: {
    tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>, &copy; OSM contributors',
    maxzoom: 20
  }
};

// ── Initialize Map ──────────────────────────────────────
function initMap() {
  const defaultBase = BASE_LAYERS.streets;

  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'base-streets':   { type: 'raster', tiles: BASE_LAYERS.streets.tiles,   tileSize: 256, attribution: BASE_LAYERS.streets.attribution,   maxzoom: BASE_LAYERS.streets.maxzoom },
        'base-topo':      { type: 'raster', tiles: BASE_LAYERS.topo.tiles,      tileSize: 256, attribution: BASE_LAYERS.topo.attribution,      maxzoom: BASE_LAYERS.topo.maxzoom },
        'base-satellite': { type: 'raster', tiles: BASE_LAYERS.satellite.tiles, tileSize: 256, attribution: BASE_LAYERS.satellite.attribution, maxzoom: BASE_LAYERS.satellite.maxzoom },
        'base-dark':      { type: 'raster', tiles: BASE_LAYERS.dark.tiles,      tileSize: 256, attribution: BASE_LAYERS.dark.attribution,      maxzoom: BASE_LAYERS.dark.maxzoom },
      },
      layers: [
        { id: 'layer-streets',   type: 'raster', source: 'base-streets',   layout: { visibility: 'visible' } },
        { id: 'layer-topo',      type: 'raster', source: 'base-topo',      layout: { visibility: 'none' } },
        { id: 'layer-satellite', type: 'raster', source: 'base-satellite', layout: { visibility: 'none' } },
        { id: 'layer-dark',      type: 'raster', source: 'base-dark',      layout: { visibility: 'none' } },
      ]
    },
    center: [0, 25],
    zoom: 2,
    maxZoom: 18,
    attributionControl: true
  });

  // Navigation controls
  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), 'bottom-left');

  // Map click handler
  map.on('click', handleMapClick);

  // Coordinate display on mouse move
  map.on('mousemove', (e) => {
    const { lat, lng } = e.lngLat;
    document.getElementById('coords-display').textContent =
      `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
  });

  // Dismiss hint on first click
  map.once('click', () => {
    document.getElementById('click-hint')?.classList.add('hidden');
    setTimeout(() => document.getElementById('click-hint')?.remove(), 600);
  });

  // Load earthquake source when map is ready (but don't show layer yet)
  map.on('load', () => {
    // Prepare earthquake source & layers (hidden by default)
    map.addSource('earthquakes', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'earthquakes-circle',
      type: 'circle',
      source: 'earthquakes',
      layout: { visibility: 'none' },
      paint: {
        // Size = magnitude (exponential scaling)
        'circle-radius': [
          'interpolate', ['exponential', 1.5], ['get', 'mag'],
          2.5, 4,
          4,   8,
          5,   14,
          6,   22,
          7,   32,
          8,   44,
          9,   56
        ],
        // Color = depth: red (shallow) → amber → yellow → green (deep)
        'circle-color': [
          'interpolate', ['linear'], ['get', 'depth_km'],
          0,   '#ef4444',
          20,  '#f97316',
          70,  '#f59e0b',
          150, '#eab308',
          300, '#84cc16',
          500, '#22c55e',
          700, '#059669'
        ],
        'circle-opacity': 0.75,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.6)'
      }
    });

    // Earthquake click popup
    map.on('click', 'earthquakes-circle', (e) => {
      e.originalEvent.stopPropagation();
      const props = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates;
      const time = new Date(props.time);
      const depthMi = props.depth_mi ?? '?';
      const depthKm = props.depth_km ?? '?';
      const magLabel = getMagLabel(props.mag);
      const depthLabel = getDepthLabel(depthMi);

      const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      const row = (icon, label, value) =>
        `<div class="quake-row"><span class="quake-row-label">${icon} ${label}</span><span class="quake-row-value">${value}</span></div>`;

      new maplibregl.Popup({ offset: 14, maxWidth: '400px', className: 'geo-popup' })
        .setLngLat([coords[0], coords[1]])
        .setHTML(`
          <div class="quake-popup">
            <div class="quake-header">
              <div class="quake-mag" style="background:${getDepthColor(depthKm)}">${props.mag}</div>
              <div class="quake-title">
                <h3>${props.place || 'Unknown location'}</h3>
                <span class="quake-time">${dateStr} at ${timeStr}</span>
              </div>
            </div>
            <div class="quake-details">
              ${row('📏', 'Magnitude', `<strong>${props.mag}</strong> <span class="quake-badge ${magLabel.cls}">${magLabel.label}</span>`)}
              ${row('⬇️', 'Depth', `<strong>${depthMi} mi</strong> (${depthKm} km) <span class="quake-badge ${depthLabel.cls}">${depthLabel.label}</span>`)}
              ${row('📍', 'Coordinates', `${coords[1]?.toFixed(3)}°, ${coords[0]?.toFixed(3)}°`)}
              ${props.alert ? (() => { const ai = getAlertInfo(props.alert); return ai ? row('🚨', 'Alert Level', `<span class="quake-badge ${ai.cls}">${ai.label}</span>`) : ''; })() : ''}
              ${props.felt ? row('👥', 'Felt Reports', `<strong>${props.felt}</strong> people`) : ''}
              ${props.cdi ? row('📊', 'Intensity (CDI)', `<strong>${props.cdi}</strong>`) : ''}
              ${props.tsunami ? row('🌊', 'Tsunami', '<strong style="color:#ef4444">Warning issued</strong>') : ''}
            </div>
            <a class="quake-link" href="${props.url}" target="_blank">View on USGS ↗</a>
          </div>
        `)
        .addTo(map);
    });

    // Cursor change on earthquake hover
    map.on('mouseenter', 'earthquakes-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'earthquakes-circle', () => { map.getCanvas().style.cursor = ''; });

    // ── Buoy source & layers (hidden by default) ──────
    map.addSource('buoys', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 40
    });

    // Cluster circles
    map.addLayer({
      id: 'buoys-clusters',
      type: 'circle',
      source: 'buoys',
      filter: ['has', 'point_count'],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#51bbd6', 20,
          '#f1f075', 50,
          '#f28cb1'
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          14, 20, 18, 50, 24
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,0.6)'
      }
    });

    // Cluster count labels
    map.addLayer({
      id: 'buoys-cluster-count',
      type: 'symbol',
      source: 'buoys',
      filter: ['has', 'point_count'],
      layout: {
        visibility: 'none',
        'text-field': '{point_count_abbreviated}',
        'text-font': ['Open Sans Bold'],
        'text-size': 12
      },
      paint: { 'text-color': '#1a1a2e' }
    });

    // Individual buoy markers — colored by water temp
    map.addLayer({
      id: 'buoys-point',
      type: 'circle',
      source: 'buoys',
      filter: ['!', ['has', 'point_count']],
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          2, 3,
          6, 5,
          10, 8
        ],
        'circle-color': [
          'case',
          ['!=', ['get', 'wtmp'], null],
          ['interpolate', ['linear'], ['get', 'wtmp'],
            -2, '#3b82f6',
             5, '#06b6d4',
            15, '#22c55e',
            22, '#f59e0b',
            28, '#ef4444',
            35, '#dc2626'
          ],
          '#94a3b8' // grey if no water temp
        ],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.7)'
      }
    });

    // Buoy click popup
    map.on('click', 'buoys-point', (e) => {
      e.originalEvent.stopPropagation();
      const p = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates;

      const row = (label, val, unit = '') => val != null && val !== 'null'
        ? `<tr><td style="color:#94a3b8;padding:2px 8px 2px 0">${label}</td><td style="font-weight:600">${val}${unit}</td></tr>`
        : '';

      new maplibregl.Popup({ offset: 14, maxWidth: '400px', className: 'geo-popup' })
        .setLngLat(coords)
        .setHTML(`
          <div class="buoy-popup">
            <h3>🚢 Station ${p.stn}</h3>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">${p.time}</div>
            <table style="font-size:13px;border-collapse:collapse;white-space:nowrap">
              ${row('🌊 Wave Height', p.wvht !== 'null' ? p.wvht : null, p.wvhtFt !== 'null' ? ' m (' + p.wvhtFt + ' ft)' : ' m')}
              ${row('🌊 Wave Period', p.dpd !== 'null' ? p.dpd : null, ' s')}
              ${row('🌡️ Water Temp', p.wtmp !== 'null' ? p.wtmp : null, p.wtmpF !== 'null' ? '°C (' + p.wtmpF + '°F)' : '°C')}
              ${row('🌡️ Air Temp', p.atmp !== 'null' ? p.atmp : null, '°C')}
              ${row('💨 Wind', p.wspd !== 'null' ? p.wspd : null, p.wspdKts !== 'null' ? ' m/s (' + p.wspdKts + ' kts)' : ' m/s')}
              ${row('💨 Gust', p.gst !== 'null' ? p.gst : null, ' m/s')}
              ${row('🧭 Wind Dir', p.wdir !== 'null' ? p.wdir : null, '°')}
              ${row('🌡️ Pressure', p.pres !== 'null' ? p.pres : null, ' hPa')}
              ${row('📈 P Tendency', p.ptdy !== 'null' ? p.ptdy : null, ' hPa')}
              ${row('🌊 Tide', p.tide !== 'null' ? p.tide : null, ' ft')}
              ${row('👁️ Visibility', p.vis !== 'null' ? p.vis : null, ' nmi')}
            </table>
            <a href="https://www.ndbc.noaa.gov/station_page.php?station=${p.stn}" 
               target="_blank" style="display:block;margin-top:8px;font-size:12px;color:#3b82f6">
              View full station data →
            </a>
          </div>
        `)
        .addTo(map);
    });

    // Cluster click → zoom in
    map.on('click', 'buoys-clusters', async (e) => {
      e.originalEvent.stopPropagation();
      const features = map.queryRenderedFeatures(e.point, { layers: ['buoys-clusters'] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      const coords = features[0].geometry.coordinates;
      try {
        const zoom = await map.getSource('buoys').getClusterExpansionZoom(clusterId);
        map.easeTo({ center: coords, zoom: zoom + 1 });
      } catch (err) {
        console.error('Cluster zoom error:', err);
      }
    });

    // Cursor changes for buoy layers
    map.on('mouseenter', 'buoys-point', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'buoys-point', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'buoys-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'buoys-clusters', () => { map.getCanvas().style.cursor = ''; });

    // Check URL hash for initial location
    loadFromHash();
  });
}

// ── Handle Map Click ────────────────────────────────────
async function handleMapClick(e) {
  // Skip if click hit an overlay feature (earthquake, buoy, etc.)
  if (e.point) {
    const overlayLayers = ['earthquakes-circle', 'buoys-point', 'buoys-clusters', 'buoys-cluster-count'];
    const activeLayers = overlayLayers.filter(id => { try { return !!map.getLayer(id); } catch { return false; } });
    if (activeLayers.length > 0) {
      const hits = map.queryRenderedFeatures(e.point, { layers: activeLayers });
      if (hits.length > 0) return;
    }
  }

  const { lat, lng } = e.lngLat;
  currentLat = lat;
  currentLng = lng;

  // Update URL hash
  window.location.hash = `${lat.toFixed(5)},${lng.toFixed(5)}`;

  // Place or move marker
  if (marker) {
    marker.setLngLat([lng, lat]);
  } else {
    const el = document.createElement('div');
    el.className = 'location-marker';
    el.innerHTML = '<div class="location-marker-pulse"></div>';
    marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  }

  // Show panel with loading states
  showPanel();
  updateHeader('Loading...', `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`);
  setLoading('tab-overview');
  setLoading('tab-weather');
  setLoading('tab-air');
  setLoading('tab-sun');

  // Fetch all data
  const data = await fetchAllLocationData(lat, lng);
  data.lat = lat;
  data.lng = lng;

  // Update header
  const cc = data.place?.countryCode;
  const flag = cc ? countryFlag(cc) : '';
  const title = data.place?.display || 'Unknown Location';
  const subtitle = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°` +
    (data.elevation != null ? ` · ${Math.round(data.elevation)}m` : '');
  updateHeader(title, subtitle, flag);

  // Render Overview
  if (data.weather || data.elevation || data.place) {
    renderOverview(data);
  } else {
    setError('tab-overview', data.errors.weather || 'Failed to load data');
  }

  // Render Weather
  if (data.weather) {
    renderWeather(data.weather);
  } else {
    setError('tab-weather', data.errors.weather || 'Weather data unavailable');
  }

  // Render Air Quality
  if (data.airQuality) {
    renderAirQuality(data.airQuality);
  } else {
    setError('tab-air', data.errors.airQuality || 'Air quality data unavailable');
  }

  // Render Sun Chart (client-side, no API needed)
  const tz = data.weather?.timezone || null;
  renderSunChartTab(lat, lng, tz);
}

// ── Base Layer Switching ────────────────────────────────
function setupBaseLayerControls() {
  const radios = document.querySelectorAll('#base-layers input[type="radio"]');
  const layerIds = ['layer-streets', 'layer-topo', 'layer-satellite', 'layer-dark'];

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      const selected = `layer-${radio.value}`;
      layerIds.forEach(id => {
        map.setLayoutProperty(id, 'visibility', id === selected ? 'visible' : 'none');
      });
    });
  });
}

// ── Overlay Layer Controls ──────────────────────────────
function setupOverlayControls() {
  // Earthquakes toggle
  const earthquakeToggle = document.getElementById('ol-earthquakes');
  earthquakeToggle?.addEventListener('change', async () => {
    if (earthquakeToggle.checked) {
      if (!earthquakesLoaded) {
        try {
          const data = await fetchEarthquakes();
          map.getSource('earthquakes')?.setData(data);
          earthquakesLoaded = true;
        } catch (err) {
          console.error('Failed to load earthquakes:', err);
          earthquakeToggle.checked = false;
          return;
        }
      }
      map.setLayoutProperty('earthquakes-circle', 'visibility', 'visible');
    } else {
      map.setLayoutProperty('earthquakes-circle', 'visibility', 'none');
    }
  });

  // Buoys toggle
  const buoyToggle = document.getElementById('ol-buoys');
  const buoyLayers = ['buoys-clusters', 'buoys-cluster-count', 'buoys-point'];

  buoyToggle?.addEventListener('change', async () => {
    if (buoyToggle.checked) {
      if (!buoysLoaded) {
        const label = buoyToggle.closest('label');
        const origText = label?.querySelector('.layer-label')?.textContent;
        if (label) label.querySelector('.layer-label').textContent = '🚢 Loading buoys…';
        try {
          const data = await fetchBuoys();
          map.getSource('buoys')?.setData(data);
          buoysLoaded = true;
          console.log(`Loaded ${data.features.length} buoy stations`);
        } catch (err) {
          console.error('Failed to load buoys:', err);
          buoyToggle.checked = false;
          if (label) label.querySelector('.layer-label').textContent = origText;
          return;
        }
        if (label) label.querySelector('.layer-label').textContent = origText;
      }
      buoyLayers.forEach(id => map.setLayoutProperty(id, 'visibility', 'visible'));
    } else {
      buoyLayers.forEach(id => map.setLayoutProperty(id, 'visibility', 'none'));
    }
  });
}

// ── Layer Panel Toggle ──────────────────────────────────
function setupLayerPanel() {
  const toggle = document.getElementById('layer-toggle');
  const content = document.getElementById('layer-content');

  toggle?.addEventListener('click', () => {
    content.classList.toggle('open');
  });

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#layer-panel')) {
      content?.classList.remove('open');
    }
  });
}

// ── Profile Panel Close ─────────────────────────────────
function setupProfilePanel() {
  document.getElementById('profile-close')?.addEventListener('click', hidePanel);

  // Escape key closes panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePanel();
  });
}

// ── Logo / Home Reset ───────────────────────────────────
function setupLogoHome() {
  document.getElementById('logo-home')?.addEventListener('click', (e) => {
    e.preventDefault();

    // Close panel and remove marker
    hidePanel();
    if (marker) {
      marker.remove();
      marker = null;
    }
    currentLat = null;
    currentLng = null;

    // Clear URL hash
    history.replaceState(null, '', window.location.pathname);

    // Reset map view
    map.flyTo({ center: [0, 25], zoom: 2, duration: 1500 });

    // Close any open popups
    const popups = document.querySelectorAll('.maplibregl-popup');
    popups.forEach(p => p.remove());
  });
}

// ── Load Location from URL Hash ─────────────────────────
function loadFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return;

  const match = hash.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      map.flyTo({ center: [lng, lat], zoom: 8, duration: 1500 });
      setTimeout(() => {
        handleMapClick({ lngLat: { lat, lng } });
      }, 1600);
    }
  }
}

// ── Earthquake Helpers ──────────────────────────────────
function getDepthColor(depthKm) {
  if (depthKm <= 20)  return '#ef4444';
  if (depthKm <= 70)  return '#f97316';
  if (depthKm <= 150) return '#f59e0b';
  if (depthKm <= 300) return '#84cc16';
  return '#22c55e';
}

function getMagLabel(mag) {
  if (mag < 4)   return { label: 'Light',    cls: 'badge-light' };
  if (mag < 5)   return { label: 'Moderate', cls: 'badge-moderate' };
  if (mag < 6)   return { label: 'Strong',   cls: 'badge-strong' };
  if (mag < 7)   return { label: 'Major',    cls: 'badge-major' };
  return            { label: 'Great',    cls: 'badge-great' };
}

function getDepthLabel(depthMi) {
  if (depthMi <= 12)  return { label: 'Shallow', cls: 'badge-shallow' };
  if (depthMi <= 43)  return { label: 'Mid',     cls: 'badge-mid' };
  if (depthMi <= 186) return { label: 'Intermediate', cls: 'badge-intermediate' };
  return                { label: 'Deep',    cls: 'badge-deep' };
}

// ── Country flag from 2-letter code ─────────────────────
function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return `<img src="https://flagcdn.com/24x18/${code.toLowerCase()}.png" alt="${code}" class="header-flag" />`;
}

// ── Earthquake Alert Badge ──────────────────────────────
function getAlertInfo(alert) {
  switch (alert) {
    case 'green':  return { label: 'Green',  cls: 'badge-light' };
    case 'yellow': return { label: 'Yellow', cls: 'badge-moderate' };
    case 'orange': return { label: 'Orange', cls: 'badge-strong' };
    case 'red':    return { label: 'Red',    cls: 'badge-major' };
    default:       return null;
  }
}

// ── Initialize ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initTabs();
  setupLayerPanel();
  setupProfilePanel();
  setupLogoHome();

  // These need the map to be loaded first
  map.on('load', () => {
    setupBaseLayerControls();
    setupOverlayControls();
  });
});
