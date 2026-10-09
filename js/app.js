/* =========================================================
   GeoInsight — Main App Module
   Map initialization, layer management, interaction handling
   ========================================================= */

import { fetchAllLocationData, fetchEarthquakes, fetchBuoys, fetchTectonicPlates, getWeatherInfo } from './api.js';
import { sunCoords, toDays, RAD } from './sun-chart.js';
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
let eqRefreshInterval = null;
let eqPreviousIds = new Set(); // track known earthquake IDs for "new" detection
let platesLoaded = false;
let terminatorInterval = null;
let sunLinesVisible = false;
let isGlobe = false;
let eqData = null;          // latest USGS FeatureCollection
let eq3dActive = false;
let eq3dPrevView = null;    // { globe, pitch } to restore when leaving 3D view
let refreshQuakeHover = () => {};  // set once the map has loaded

// ── Weather / Radar State ───────────────────────────────
let rainviewerTimestamp = null;
let rainviewerInterval = null;

// ── Earthquake Size Scale ───────────────────────────────
// Magnitude → on-screen radius (px), shared by 2D circles and 3D spheres
const EQ_RADIUS_STOPS = [[2.5, 4], [4, 8], [5, 14], [6, 22], [7, 32], [8, 44], [9, 56]];

// Same curve as MapLibre's ['interpolate', ['exponential', 1.5], ...] over EQ_RADIUS_STOPS
function eqRadiusPx(mag) {
  const stops = EQ_RADIUS_STOPS;
  if (!(mag > stops[0][0])) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (mag <= x1) {
      const [x0, y0] = stops[i - 1];
      const t = (Math.pow(1.5, mag - x0) - 1) / (Math.pow(1.5, x1 - x0) - 1);
      return y0 + (y1 - y0) * t;
    }
  }
  return stops[stops.length - 1][1];
}

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
  ocean: {
    tiles: ['https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_basemap_NCEI/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.gebco.net/">GEBCO</a>, NOAA NCEI',
    maxzoom: 10
  }
};

// ── Initialize Map ──────────────────────────────────────
function initMap() {
  const defaultBase = BASE_LAYERS.satellite;

  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'base-streets':   { type: 'raster', tiles: BASE_LAYERS.streets.tiles,   tileSize: 256, attribution: BASE_LAYERS.streets.attribution,   maxzoom: BASE_LAYERS.streets.maxzoom },
        'base-topo':      { type: 'raster', tiles: BASE_LAYERS.topo.tiles,      tileSize: 256, attribution: BASE_LAYERS.topo.attribution,      maxzoom: BASE_LAYERS.topo.maxzoom },
        'base-satellite': { type: 'raster', tiles: BASE_LAYERS.satellite.tiles, tileSize: 256, attribution: BASE_LAYERS.satellite.attribution, maxzoom: BASE_LAYERS.satellite.maxzoom },
        'base-ocean':     { type: 'raster', tiles: BASE_LAYERS.ocean.tiles,     tileSize: 256, attribution: BASE_LAYERS.ocean.attribution,     maxzoom: BASE_LAYERS.ocean.maxzoom },
      },
      layers: [
        { id: 'layer-streets',   type: 'raster', source: 'base-streets',   layout: { visibility: 'none' } },
        { id: 'layer-topo',      type: 'raster', source: 'base-topo',      layout: { visibility: 'none' } },
        { id: 'layer-satellite', type: 'raster', source: 'base-satellite', layout: { visibility: 'visible' } },
        { id: 'layer-ocean',     type: 'raster', source: 'base-ocean',     layout: { visibility: 'none' } },
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

  // Globe / 2D toggle
  setupGlobeToggle();

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
          ...EQ_RADIUS_STOPS.flat()
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
      const coords = e.features[0].geometry.coordinates;
      showQuakePopup(e.features[0].properties, coords[0], coords[1]);
    });

    // 3D earthquake spheres are drawn on a canvas over the map (see drawQuakeSpheres)
    eq3dCanvas = document.createElement('canvas');
    eq3dCanvas.className = 'eq3d-canvas';
    map.getCanvasContainer().appendChild(eq3dCanvas);
    map.on('render', () => { if (eq3dActive) drawQuakeSpheres(); });

    // Hover tag: magnitude + depth, in the same depth colour as the circle/sphere
    const quakeTag = document.createElement('div');
    quakeTag.className = 'quake-tag quake-tooltip';
    map.getContainer().appendChild(quakeTag);
    const showQuakeTag = (p, point) => {
      const mag = Number(p.mag);
      const depth = p.depth_km != null ? `${Math.round(p.depth_km)} km deep` : 'depth unknown';
      quakeTag.innerHTML = `<span class="quake-tag-mag">M${mag.toFixed(1)}</span><span class="quake-tag-depth">${depth}</span>`;
      quakeTag.style.setProperty('--tag-bg', getDepthColor(p.depth_km ?? 0));
      quakeTag.style.left = `${point.x}px`;
      quakeTag.style.top = `${point.y}px`;
      quakeTag.classList.add('visible');
    };
    const hideQuakeTag = () => quakeTag.classList.remove('visible');
    let quakeHovered = false;
    let hoverPoint = null; // last cursor position over the map canvas

    // One hover path for 2D circles and 3D spheres (spheres float above their footprint)
    const updateQuakeHover = () => {
      let props = null;
      if (hoverPoint) {
        if (eq3dActive) {
          props = pickQuakeSphere(hoverPoint)?.props ?? null;
        } else if (map.getLayoutProperty('earthquakes-circle', 'visibility') === 'visible') {
          props = map.queryRenderedFeatures(hoverPoint, { layers: ['earthquakes-circle'] })[0]?.properties ?? null;
        }
      }
      if (props) {
        showQuakeTag(props, hoverPoint);
        map.getCanvas().style.cursor = 'pointer';
      } else {
        hideQuakeTag();
        if (quakeHovered) map.getCanvas().style.cursor = '';
      }
      quakeHovered = !!props;
    };
    refreshQuakeHover = updateQuakeHover;
    const clearQuakeHover = () => { hoverPoint = null; updateQuakeHover(); };

    map.on('mousemove', (e) => { hoverPoint = e.point; updateQuakeHover(); });
    // The map can move under a still cursor (inertia, fly-to, tilt animation), so re-check
    map.on('move', updateQuakeHover);
    map.on('click', hideQuakeTag);

    // Clear whenever the pointer is over anything other than the map canvas, or leaves the window
    document.addEventListener('pointermove', (e) => {
      if (e.target !== map.getCanvas() && hoverPoint) clearQuakeHover();
    });
    document.documentElement.addEventListener('pointerleave', clearQuakeHover);
    window.addEventListener('blur', clearQuakeHover);

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

    // ── Day/Night Terminator source & layers (hidden) ──
    map.addSource('terminator', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'terminator-fill',
      type: 'fill',
      source: 'terminator',
      filter: ['==', ['get', 'type'], 'night'],
      layout: { visibility: 'none' },
      paint: {
        'fill-color': '#000014',
        'fill-opacity': 0.35
      }
    });

    map.addLayer({
      id: 'terminator-line',
      type: 'line',
      source: 'terminator',
      filter: ['==', ['get', 'type'], 'terminator-edge'],
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#f59e0b',
        'line-width': 1.5,
        'line-opacity': 0.6
      }
    });

    // ── Tectonic plates source & layers (hidden) ────────
    map.addSource('plates', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'plates-boundaries',
      type: 'line',
      source: 'plates',
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#f97316',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          1, 0.8,
          4, 1.5,
          8, 2.5
        ],
        'line-opacity': 0.75
      }
    });

    // ── Sun direction lines source & layers (hidden) ────
    map.addSource('sun-directions', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'sun-dir-line-rise',
      type: 'line',
      source: 'sun-directions',
      filter: ['==', ['get', 'type'], 'sunrise'],
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#ffd700',
        'line-width': 2.5,
        'line-opacity': 0.85,
        'line-dasharray': [4, 3]
      }
    });

    map.addLayer({
      id: 'sun-dir-line-set',
      type: 'line',
      source: 'sun-directions',
      filter: ['==', ['get', 'type'], 'sunset'],
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#ff6b35',
        'line-width': 2.5,
        'line-opacity': 0.85,
        'line-dasharray': [4, 3]
      }
    });

    map.addLayer({
      id: 'sun-dir-label',
      type: 'symbol',
      source: 'sun-directions',
      layout: {
        visibility: 'none',
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Bold'],
        'text-size': 11,
        'text-anchor': 'center',
        'text-offset': [0, 0],
        'symbol-placement': 'line-center'
      },
      paint: {
        'text-color': ['case',
          ['==', ['get', 'type'], 'sunrise'], '#ffd700',
          '#ff6b35'
        ],
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': 1.5
      }
    });

    // ── Bathymetry overlay (GEBCO semi-transparent) ────
    map.addSource('bathymetry', {
      type: 'raster',
      tiles: ['https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_basemap_NCEI/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 10
    });
    map.addLayer({
      id: 'bathymetry-layer',
      type: 'raster',
      source: 'bathymetry',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.55 }
    });

    // ── RainViewer radar source & layer (hidden) ──────
    map.addSource('rainviewer', {
      type: 'raster',
      tiles: ['https://tilecache.rainviewer.com/v2/radar/nowcast/256/{z}/{x}/{y}/2/1_1.png'],
      tileSize: 256,
      maxzoom: 12
    });
    map.addLayer({
      id: 'rainviewer-layer',
      type: 'raster',
      source: 'rainviewer',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.7 }
    });

    // Check URL hash for initial location
    loadFromHash();
  });
}

// ── Handle Map Click ────────────────────────────────────
async function handleMapClick(e) {
  // Skip if click hit an overlay feature (earthquake, buoy, etc.)
  if (e.point && eq3dActive) {
    const hit = pickQuakeSphere(e.point);
    if (hit) {
      showQuakeSpherePopup(hit);
      return;
    }
  }
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
  const elevText = data.elevation == null ? ''
    : data.elevation < 0 ? ` · ${Math.abs(Math.round(data.elevation))}m deep`
    : ` · ${Math.round(data.elevation)}m`;
  const subtitle = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°` + elevText;
  updateHeader(title, subtitle, flag);

  // Render Overview
  if (data.weather || data.elevation || data.place) {
    renderOverview(data);
    // Wire sun direction lines toggle
    setupSunDirToggle(lat, lng);
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
function setBaseLayer(name) {
  ['layer-satellite', 'layer-streets', 'layer-topo', 'layer-ocean'].forEach(id => {
    map.setLayoutProperty(id, 'visibility', id === `layer-${name}` ? 'visible' : 'none');
  });
  document.querySelectorAll('#basemap-switcher .basemap-option').forEach(b => {
    const isActive = b.dataset.base === name;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-checked', String(isActive));
  });
}

function setupBaseLayerControls() {
  document.querySelectorAll('#basemap-switcher .basemap-option').forEach(btn => {
    btn.addEventListener('click', () => setBaseLayer(btn.dataset.base));
  });
}

// ── Overlay Layer Controls ──────────────────────────────
const EQ_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function setupOverlayControls() {
  // Earthquakes toggle
  const earthquakeToggle = document.getElementById('ol-earthquakes');
  const eqMeta = document.getElementById('eq-meta');
  const eqTimestamp = document.getElementById('eq-timestamp');
  const eqRefreshBtn = document.getElementById('eq-refresh');
  const eq3dOption = document.getElementById('eq-3d-option');
  const eq3dToggle = document.getElementById('ol-earthquakes-3d');

  eq3dToggle?.addEventListener('change', () => setEarthquakes3D(eq3dToggle.checked));

  // Refresh button click
  eqRefreshBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await refreshEarthquakes(true);
  });

  // Collapse/expand EQ panel
  document.getElementById('eq-new-collapse')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEqPanelCollapse();
  });
  document.getElementById('eq-new-header-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('eq-new-panel');
    if (panel?.classList.contains('collapsed')) toggleEqPanelCollapse();
  });

  earthquakeToggle?.addEventListener('change', async () => {
    if (earthquakeToggle.checked) {
      // Request notification permission when EQ mode is activated
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      if (!earthquakesLoaded) {
        try {
          const data = await fetchEarthquakes();
          setEarthquakeData(data);
          earthquakesLoaded = true;
          // Store all current IDs so first refresh can detect new ones
          eqPreviousIds = new Set(data.features.map(f => f.id ?? f.properties.code));
          updateEqTimestamp();
          eqMeta?.classList.remove('hidden');
          // Show the 5 most recent earthquakes on first load
          showRecentEarthquakes(data.features);
        } catch (err) {
          console.error('Failed to load earthquakes:', err);
          earthquakeToggle.checked = false;
          return;
        }
      }
      map.setLayoutProperty('earthquakes-circle', 'visibility', 'visible');
      eq3dOption?.classList.remove('hidden');
      // Start auto-refresh
      startEqAutoRefresh();
    } else {
      if (eq3dActive) {
        eq3dToggle.checked = false;
        setEarthquakes3D(false);
      }
      eq3dOption?.classList.add('hidden');
      map.setLayoutProperty('earthquakes-circle', 'visibility', 'none');
      stopEqAutoRefresh();
      eqMeta?.classList.add('hidden');
      document.getElementById('eq-new-panel')?.classList.add('hidden');
      document.getElementById('eq-new-panel')?.classList.remove('collapsed', 'has-new');
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

  // Day/Night Terminator toggle
  const terminatorToggle = document.getElementById('ol-terminator');
  const terminatorLayers = ['terminator-fill', 'terminator-line'];

  terminatorToggle?.addEventListener('change', () => {
    if (terminatorToggle.checked) {
      updateTerminator();
      terminatorLayers.forEach(id => map.setLayoutProperty(id, 'visibility', 'visible'));
      terminatorInterval = setInterval(updateTerminator, 60_000);
    } else {
      terminatorLayers.forEach(id => map.setLayoutProperty(id, 'visibility', 'none'));
      if (terminatorInterval) { clearInterval(terminatorInterval); terminatorInterval = null; }
    }
  });

  // Tectonic Plates toggle
  const platesToggle = document.getElementById('ol-plates');

  platesToggle?.addEventListener('change', async () => {
    if (platesToggle.checked) {
      if (!platesLoaded) {
        const label = platesToggle.closest('label');
        const origText = label?.querySelector('.layer-label')?.textContent;
        if (label) label.querySelector('.layer-label').textContent = '🌋 Loading plates…';
        try {
          const data = await fetchTectonicPlates();
          map.getSource('plates')?.setData(data);
          platesLoaded = true;
          console.log(`Loaded ${data.features.length} plate boundaries`);
        } catch (err) {
          console.error('Failed to load tectonic plates:', err);
          platesToggle.checked = false;
          if (label) label.querySelector('.layer-label').textContent = origText;
          return;
        }
        if (label) label.querySelector('.layer-label').textContent = origText;
      }
      map.setLayoutProperty('plates-boundaries', 'visibility', 'visible');
    } else {
      map.setLayoutProperty('plates-boundaries', 'visibility', 'none');
    }
  });

  // Bathymetry overlay toggle
  const bathyToggle = document.getElementById('ol-bathymetry');
  bathyToggle?.addEventListener('change', () => {
    map.setLayoutProperty('bathymetry-layer', 'visibility', bathyToggle.checked ? 'visible' : 'none');
  });

  // RainViewer radar toggle
  const radarToggle = document.getElementById('ol-radar');
  radarToggle?.addEventListener('change', () => {
    if (radarToggle.checked) {
      updateRainViewer();
      map.setLayoutProperty('rainviewer-layer', 'visibility', 'visible');
      rainviewerInterval = setInterval(updateRainViewer, 5 * 60 * 1000);
    } else {
      map.setLayoutProperty('rainviewer-layer', 'visibility', 'none');
      if (rainviewerInterval) { clearInterval(rainviewerInterval); rainviewerInterval = null; }
    }
  });
}

// ── Day/Night Terminator Computation ────────────────────
function computeTerminatorGeoJSON() {
  const now = new Date();
  const d = toDays(now);
  const sc = sunCoords(d);

  // GMST in degrees (already includes fractional day because d is fractional)
  const gmstDeg = (280.46061837 + 360.98564736629 * d) % 360;

  // Subsolar longitude = RA(sun) − GMST, wrapped to [−180, 180]
  const subsolarLng = (((sc.ra / RAD) - gmstDeg + 540) % 360) - 180;

  const step = 1; // degree resolution
  const tanDec = Math.tan(sc.dec);
  const terminatorLine = [];

  // For each longitude, compute the terminator latitude where sun altitude = 0:
  //   tan(lat) = −cos(HA) / tan(dec)
  // where HA = (GMST + lng − RA) in radians = (lng − subsolarLng) in degrees
  for (let i = 0; i <= 360; i += step) {
    const lng = -180 + i;
    const ha = (lng - subsolarLng) * RAD;
    let lat;
    if (Math.abs(tanDec) < 1e-10) {
      // Near equinox — terminator is a pole-to-pole line
      lat = (Math.cos(ha) > 0) ? -90 : 90;
    } else {
      lat = Math.atan(-Math.cos(ha) / tanDec) / RAD;
    }
    terminatorLine.push([lng, lat]);
  }

  // Night polygon: terminator curve → close along the dark pole
  // dec > 0 (northern summer) → south pole is dark
  // dec < 0 (northern winter) → north pole is dark
  const darkPoleLat = sc.dec > 0 ? -90 : 90;
  const nightCoords = [...terminatorLine, [180, darkPoleLat], [-180, darkPoleLat], terminatorLine[0]];

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [nightCoords] },
        properties: { type: 'night' }
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: terminatorLine },
        properties: { type: 'terminator-edge' }
      }
    ]
  };
}

function updateTerminator() {
  const data = computeTerminatorGeoJSON();
  map.getSource('terminator')?.setData(data);
}

// ── Globe / 2D Toggle ───────────────────────────────────
function setGlobe(on) {
  isGlobe = on;
  map.setProjection(on ? { type: 'globe' } : { type: 'mercator' });
  map.getContainer().classList.toggle('is-globe', on);
  const btn = document.getElementById('globe-toggle');
  if (!btn) return;
  btn.classList.toggle('active', on);
  btn.querySelector('.globe-toggle-label').textContent = on ? '2D' : '3D';
  btn.title = on ? 'Switch to 2D flat map' : 'Switch to 3D Globe';
}

function setupGlobeToggle() {
  document.getElementById('globe-toggle')?.addEventListener('click', () => setGlobe(!isGlobe));
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
function clearSelectedLocation() {
  hidePanel();
  clearSunDirectionLines();
  if (marker) {
    marker.remove();
    marker = null;
  }
  currentLat = null;
  currentLng = null;
  history.replaceState(null, '', window.location.pathname);
}

function setupProfilePanel() {
  document.getElementById('profile-close')?.addEventListener('click', clearSelectedLocation);

  // Escape key closes panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSelectedLocation();
  });
}

// ── Logo / Home Reset ───────────────────────────────────
function setupLogoHome() {
  document.getElementById('logo-home')?.addEventListener('click', (e) => {
    e.preventDefault();

    clearSelectedLocation();

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

// ── Earthquake Popup ────────────────────────────────────
function showQuakePopup(props, lng, lat, popupOptions = {}) {
  const time = new Date(props.time);
  const depthMi = props.depth_mi ?? '?';
  const depthKm = props.depth_km ?? '?';
  const magLabel = getMagLabel(props.mag);
  const depthLabel = getDepthLabel(depthMi);

  const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const row = (icon, label, value) =>
    `<div class="quake-row"><span class="quake-row-label">${icon} ${label}</span><span class="quake-row-value">${value}</span></div>`;

  return new maplibregl.Popup({ offset: 14, maxWidth: '400px', className: 'geo-popup', ...popupOptions })
    .setLngLat([lng, lat])
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
          ${row('📍', 'Coordinates', `${Number(lat).toFixed(3)}°, ${Number(lng).toFixed(3)}°`)}
          ${props.alert ? (() => { const ai = getAlertInfo(props.alert); return ai ? row('🚨', 'Alert Level', `<span class="quake-badge ${ai.cls}">${ai.label}</span>`) : ''; })() : ''}
          ${props.felt ? row('👥', 'Felt Reports', `<strong>${props.felt}</strong> people`) : ''}
          ${props.cdi ? row('📊', 'Intensity (CDI)', `<strong>${props.cdi}</strong>`) : ''}
          ${props.tsunami ? row('🌊', 'Tsunami', '<strong style="color:#ef4444">Warning issued</strong>') : ''}
        </div>
        <a class="quake-link" href="${props.url}" target="_blank">View on USGS ↗</a>
      </div>
    `)
    .addTo(map);
}

// ── 3D Earthquake View ──────────────────────────────────
const EQ3D_MAX_HEIGHT_M = 1_000_000; // deepest quake in the feed floats this high
const EQ3D_OPACITY = 0.55;
let eqSpheres = [];  // { props, lng, lat, centre, r, color }
let eq3dCanvas = null;

function setEarthquakeData(data) {
  eqData = data;
  map.getSource('earthquakes')?.setData(data);
  if (eq3dActive) {
    buildEarthquakeSpheres(data);
    map.triggerRepaint();
  }
  map.once('render', () => refreshQuakeHover());
}

function eqRadiusMeters(mag) {
  return 12000 * Math.pow(1.55, Math.max(mag ?? 2.5, 2.5) - 2.5);
}

function buildEarthquakeSpheres(data) {
  const maxDepth = Math.max(1, ...data.features.map(f => f.properties.depth_km ?? 0));
  eqSpheres = data.features.map(f => {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    const r = eqRadiusMeters(p.mag);
    return {
      lng, lat, r,
      centre: r + ((p.depth_km ?? 0) / maxDepth) * EQ3D_MAX_HEIGHT_M,
      color: getDepthColor(p.depth_km ?? 0),
      props: {
        mag: p.mag, depth_km: p.depth_km, depth_mi: p.depth_mi, place: p.place, time: p.time,
        url: p.url, alert: p.alert, felt: p.felt, cdi: p.cdi, tsunami: p.tsunami
      }
    };
  });
}

// Uses MapLibre's internal transform; the fake terrain supplies each sphere's altitude
function projectAtAltitude(lng, lat, altitudeM) {
  const fakeTerrain = {
    getElevationForLngLatZoom: () => altitudeM,
    getElevationForLngLat: () => altitudeM
  };
  return map.transform.locationToScreenPoint(new maplibregl.LngLat(lng, lat), fakeTerrain);
}

function canProject3D() {
  return typeof map.transform?.locationToScreenPoint === 'function';
}

const EARTH_RADIUS_M = 6371008.8;

// Same convention as MapLibre's globe: unit sphere, scaled by (1 + altitude / R)
function globeVector(lng, lat, altitudeM) {
  const lo = lng * Math.PI / 180, la = lat * Math.PI / 180, k = 1 + altitudeM / EARTH_RADIUS_M;
  return [Math.sin(lo) * Math.cos(la) * k, Math.sin(la) * k, Math.cos(lo) * Math.cos(la) * k];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Camera position/direction in globe units, or null when not in globe mode
function globeCamera() {
  const cam = map.transform.cameraPosition;
  if (!isGlobe || !cam || cam.length !== 3) return null;
  const c = map.getCenter();
  const f = sub(globeVector(c.lng, c.lat, 0), cam);
  const len = Math.hypot(...f);
  return { pos: [cam[0], cam[1], cam[2]], forward: [f[0] / len, f[1] / len, f[2] / len] };
}

// Distance in front of the camera, or null if behind it or hidden by the globe
function globeVisibleDepth(camera, p) {
  const d = sub(p, camera.pos);
  const depth = dot(d, camera.forward);
  if (depth <= 1e-4) return null;
  const a = dot(d, d), b = 2 * dot(camera.pos, d), c = dot(camera.pos, camera.pos) - 1;
  const disc = b * b - 4 * a * c;
  if (disc > 0) {
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t > 0 && t < 0.999) return null;
  }
  return depth;
}

// Screen-space centre, pixel radius and ground point of every visible sphere, far to near
function projectQuakeSpheres() {
  const out = [];
  const camera = globeCamera();
  const zoomScale = Math.max(1, Math.min(3, 2 ** ((map.getZoom() - 2) / 3)));
  for (const s of eqSpheres) {
    let depth = 0;
    let groundVisible = true;
    if (camera) {
      depth = globeVisibleDepth(camera, globeVector(s.lng, s.lat, s.centre));
      if (depth == null) continue;
      groundVisible = globeVisibleDepth(camera, globeVector(s.lng, s.lat, 0)) != null;
    } else if (s.centre >= (map.transform.getCameraAltitude?.() ?? Infinity)) {
      continue;
    }
    const c = projectAtAltitude(s.lng, s.lat, s.centre);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const radius = eqRadiusPx(s.props.mag) * zoomScale;
    const ground = projectAtAltitude(s.lng, s.lat, 0);
    out.push({ s, c, radius, ground: groundVisible ? ground : null, depth, sortY: ground.y });
  }
  return camera ? out.sort((a, b) => b.depth - a.depth) : out.sort((a, b) => a.sortY - b.sortY);
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function drawQuakeSpheres() {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = map.getCanvas();
  if (eq3dCanvas.width !== Math.round(w * dpr) || eq3dCanvas.height !== Math.round(h * dpr)) {
    eq3dCanvas.width = Math.round(w * dpr);
    eq3dCanvas.height = Math.round(h * dpr);
  }
  const ctx = eq3dCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const items = projectQuakeSpheres();

  for (const { s, c, radius, ground } of items) {
    if (ground) {
      ctx.strokeStyle = hexToRgba(s.color, 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ground.x, ground.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }

    const grad = ctx.createRadialGradient(
      c.x - radius * 0.35, c.y - radius * 0.35, radius * 0.1,
      c.x, c.y, radius
    );
    grad.addColorStop(0, `rgba(255, 255, 255, ${EQ3D_OPACITY})`);
    grad.addColorStop(0.35, hexToRgba(s.color, EQ3D_OPACITY));
    grad.addColorStop(1, hexToRgba(s.color, EQ3D_OPACITY * 0.6));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(s.color, 0.85);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Nearest sphere under the point (list is far-to-near, so search from the end)
function pickQuakeSphere(point) {
  const items = projectQuakeSpheres();
  for (let i = items.length - 1; i >= 0; i--) {
    const { s, c, radius } = items[i];
    if (c.dist(point) <= Math.max(radius, 4)) return s;
  }
  return null;
}

// Popups can only be pinned to the surface, so pin at the epicentre and offset up to the sphere each frame
function showQuakeSpherePopup(sphere) {
  const popup = showQuakePopup(sphere.props, sphere.lng, sphere.lat, { anchor: 'bottom' });
  const follow = () => {
    if (!eq3dActive) {
      popup.setOffset(14);
      map.off('render', follow);
      return;
    }
    // Match by position/time: the sphere list is rebuilt on each data refresh
    const item = projectQuakeSpheres().find(i =>
      i.s.lng === sphere.lng && i.s.lat === sphere.lat && i.s.props.time === sphere.props.time);
    if (!item) return;
    const ground = projectAtAltitude(sphere.lng, sphere.lat, 0);
    popup.setOffset([item.c.x - ground.x, item.c.y - ground.y - item.radius - 4]);
  };
  follow();
  map.on('render', follow);
  popup.on('close', () => map.off('render', follow));
}

function setEarthquakes3D(on) {
  if (on && !canProject3D()) {
    console.warn('3D earthquake view unavailable: MapLibre transform API not found');
    document.getElementById('ol-earthquakes-3d').checked = false;
    return;
  }
  eq3dActive = on;
  map.setLayoutProperty('earthquakes-circle', 'visibility', on ? 'none' : 'visible');
  eq3dCanvas.style.display = on ? 'block' : 'none';
  map.once('render', () => refreshQuakeHover());

  if (on) {
    if (eqData) buildEarthquakeSpheres(eqData);
    eq3dPrevView = { globe: isGlobe, pitch: map.getPitch() };
    setBaseLayer('satellite');
    setGlobe(true);
    map.easeTo({ pitch: 55, duration: 1200 });
  } else if (eq3dPrevView) {
    setGlobe(eq3dPrevView.globe);
    map.easeTo({ pitch: eq3dPrevView.pitch, duration: 800 });
    eq3dPrevView = null;
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

// ── Sun Direction Lines on Map ───────────────────────
const SUN_LINE_LAYERS = ['sun-dir-line-rise', 'sun-dir-line-set', 'sun-dir-label'];

function setupSunDirToggle(lat, lng) {
  const btn = document.getElementById('sun-dir-toggle');
  if (!btn) return;

  // If lines were visible for previous location, update them for new location
  if (sunLinesVisible) {
    drawSunDirectionLines(lat, lng);
  }

  btn.onclick = () => {
    sunLinesVisible = !sunLinesVisible;
    btn.classList.toggle('active', sunLinesVisible);
    if (sunLinesVisible) {
      drawSunDirectionLines(lat, lng);
      SUN_LINE_LAYERS.forEach(id => map.setLayoutProperty(id, 'visibility', 'visible'));
    } else {
      SUN_LINE_LAYERS.forEach(id => map.setLayoutProperty(id, 'visibility', 'none'));
    }
  };
}

function drawSunDirectionLines(lat, lng) {
  const az = getSunAzimuthFromChart(lat, lng);
  const dist = 80; // km
  const riseEnd = destinationPoint(lat, lng, az.sunriseAz, dist);
  const setEnd = destinationPoint(lat, lng, az.sunsetAz, dist);

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[lng, lat], riseEnd] },
        properties: { type: 'sunrise', label: `☀️ Sunrise ${az.sunriseAz}°` }
      },
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[lng, lat], setEnd] },
        properties: { type: 'sunset', label: `🌅 Sunset ${az.sunsetAz}°` }
      }
    ]
  };

  map.getSource('sun-directions')?.setData(geojson);
  SUN_LINE_LAYERS.forEach(id => map.setLayoutProperty(id, 'visibility', 'visible'));
}

function clearSunDirectionLines() {
  sunLinesVisible = false;
  map.getSource('sun-directions')?.setData({ type: 'FeatureCollection', features: [] });
  SUN_LINE_LAYERS.forEach(id => {
    try { map.setLayoutProperty(id, 'visibility', 'none'); } catch {}
  });
}

function getSunAzimuthFromChart(lat, lng) {
  const { sunCoords: sc, toDays: td, RAD: R } = { sunCoords, toDays, RAD };
  const d = td(new Date());
  const coords = sc(d);
  const phi = lat * R;
  const cosAz = Math.sin(coords.dec) / Math.cos(phi);
  const clamped = Math.max(-1, Math.min(1, cosAz));
  const azRise = Math.round(Math.acos(clamped) / R);
  return { sunriseAz: azRise, sunsetAz: 360 - azRise };
}

// Destination point given start, bearing (degrees), distance (km)
function destinationPoint(lat, lng, bearing, distKm) {
  const R = 6371; // Earth radius km
  const d = distKm / R;
  const brng = bearing * RAD;
  const lat1 = lat * RAD;
  const lng1 = lng * RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lng2 / RAD, lat2 / RAD];
}

// ── Earthquake Auto-Refresh ─────────────────────────────
function startEqAutoRefresh() {
  stopEqAutoRefresh();
  eqRefreshInterval = setInterval(() => refreshEarthquakes(true), EQ_REFRESH_MS);
}

function stopEqAutoRefresh() {
  if (eqRefreshInterval) {
    clearInterval(eqRefreshInterval);
    eqRefreshInterval = null;
  }
}

async function refreshEarthquakes(force = false) {
  const btn = document.getElementById('eq-refresh');
  if (btn) btn.classList.add('spinning');

  try {
    const data = await fetchEarthquakes(force);
    setEarthquakeData(data);

    // Detect new earthquakes
    const currentIds = new Set(data.features.map(f => f.id ?? f.properties.code));
    const newQuakes = data.features.filter(f => {
      const id = f.id ?? f.properties.code;
      return !eqPreviousIds.has(id);
    });

    if (newQuakes.length > 0 && eqPreviousIds.size > 0) {
      showNewEarthquakes(newQuakes);
      notifyNewEarthquakes(newQuakes);
    }

    eqPreviousIds = currentIds;
    updateEqTimestamp();
    console.log(`EQ refresh: ${data.features.length} total, ${newQuakes.length} new`);
  } catch (err) {
    console.error('EQ refresh failed:', err);
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function updateEqTimestamp() {
  const el = document.getElementById('eq-timestamp');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  el.title = `Last updated: ${now.toLocaleString()}`;
}

function showRecentEarthquakes(features) {
  // Sort by time descending (most recent first) and take top 5
  const recent = [...features]
    .sort((a, b) => (b.properties.time ?? 0) - (a.properties.time ?? 0))
    .slice(0, 5);

  const panel = document.getElementById('eq-new-panel');
  const title = panel?.querySelector('.eq-new-title');
  if (title) title.textContent = 'Recent Earthquakes';
  showNewEarthquakes(recent, false, 'time');
}

function showNewEarthquakes(quakes, isNew = true, sortBy = 'mag') {
  const panel = document.getElementById('eq-new-panel');
  const list = document.getElementById('eq-new-list');
  const countEl = document.getElementById('eq-new-count');
  if (!panel || !list) return;

  // Set title
  const titleEl = panel.querySelector('.eq-new-title');
  if (titleEl && isNew) {
    titleEl.textContent = 'New Earthquakes';
  }

  // Sort: by time (newest first) for recent, by magnitude for new alerts
  if (sortBy === 'time') {
    quakes.sort((a, b) => (b.properties.time ?? 0) - (a.properties.time ?? 0));
  } else {
    quakes.sort((a, b) => (b.properties.mag ?? 0) - (a.properties.mag ?? 0));
  }

  // Limit to 10
  const items = quakes.slice(0, 10);

  // Update count badge
  if (countEl) {
    countEl.textContent = items.length;
    countEl.classList.toggle('hidden', items.length === 0);
  }

  list.innerHTML = items.map((f, i) => {
    const p = f.properties;
    const mag = p.mag ?? '?';
    const coords = f.geometry.coordinates;
    const time = new Date(p.time);
    const ago = timeAgo(time);
    const depthKm = f.properties.depth_km ?? Math.round((f.geometry.coordinates[2] ?? 0) * 10) / 10;
    const color = getDepthColor(depthKm);
    const newClass = isNew ? ' eq-item-new' : '';
    const delay = isNew ? ` style="animation-delay:${i * 0.1}s"` : '';

    return `
      <div class="eq-new-item${newClass}" data-lng="${coords[0]}" data-lat="${coords[1]}"${delay}>
        <div class="eq-new-mag" style="background:${color}">${mag}</div>
        <div class="eq-new-info">
          <div class="eq-new-place">${p.place || 'Unknown'}</div>
          <div class="eq-new-detail">${ago} · ${depthKm} km deep</div>
        </div>
      </div>`;
  }).join('');

  // Click to fly to earthquake
  list.querySelectorAll('.eq-new-item').forEach(item => {
    item.addEventListener('click', () => {
      const lng = parseFloat(item.dataset.lng);
      const lat = parseFloat(item.dataset.lat);
      map.flyTo({ center: [lng, lat], zoom: 6, duration: 1500 });
    });
  });

  // If collapsed and new quakes arrived, expand and show glow
  if (isNew && panel.classList.contains('collapsed')) {
    panel.classList.add('has-new');
    toggleEqPanelCollapse(); // expand
  }

  // Show panel and add glow for new items
  panel.classList.remove('hidden');
  if (isNew) {
    panel.classList.add('has-new');
    // Remove glow after animation completes
    setTimeout(() => panel.classList.remove('has-new'), 4000);
  }
}

function toggleEqPanelCollapse() {
  const panel = document.getElementById('eq-new-panel');
  if (!panel) return;
  panel.classList.toggle('collapsed');
}

// ── Desktop Notifications for New Earthquakes ──────────
function notifyNewEarthquakes(quakes) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Sort by magnitude descending
  const sorted = [...quakes].sort((a, b) => (b.properties.mag ?? 0) - (a.properties.mag ?? 0));
  const top = sorted[0].properties;
  const count = quakes.length;

  const title = count === 1
    ? `🔴 M${top.mag} Earthquake`
    : `🔴 ${count} New Earthquakes`;

  const body = count === 1
    ? `${top.place || 'Unknown location'}\n${timeAgo(new Date(top.time))} · ${top.depth_km ?? '?'} km deep`
    : `Strongest: M${top.mag} — ${top.place || 'Unknown'}\n+${count - 1} more`;

  const notification = new Notification(title, {
    body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🌍</text></svg>',
    tag: 'geoinsight-eq',  // replaces previous EQ notification
    silent: false
  });

  // Click notification → focus window and fly to strongest quake
  notification.onclick = () => {
    window.focus();
    const coords = sorted[0].geometry.coordinates;
    map.flyTo({ center: [coords[0], coords[1]], zoom: 6, duration: 1500 });
    notification.close();
  };
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── RainViewer Radar Update ─────────────────────────────
async function updateRainViewer() {
  try {
    const resp = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await resp.json();
    const latest = data.radar?.past?.slice(-1)[0];
    if (!latest) return;

    const ts = latest.path; // e.g. "/v2/radar/1234567890"
    if (ts === rainviewerTimestamp) return; // no change
    rainviewerTimestamp = ts;

    const tileUrl = `https://tilecache.rainviewer.com${ts}/256/{z}/{x}/{y}/2/1_1.png`;
    const src = map.getSource('rainviewer');
    if (src) {
      // Update tiles by replacing the source
      map.removeLayer('rainviewer-layer');
      map.removeSource('rainviewer');
      map.addSource('rainviewer', {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 12
      });
      map.addLayer({
        id: 'rainviewer-layer',
        type: 'raster',
        source: 'rainviewer',
        layout: { visibility: 'visible' },
        paint: { 'raster-opacity': 0.7 }
      });
    }
    console.log('RainViewer updated:', ts);
  } catch (err) {
    console.error('RainViewer update failed:', err);
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
