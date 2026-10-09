# GeoInsight — Earth Explorer · Project Context

> **Purpose:** Hand this file to a new AI chat session so it can understand the project fully and continue work without re-discovery.

---

## 1. What Is This?

A **vanilla HTML/CSS/JS** web app (ES modules, no build step) that renders an interactive world map with layered data overlays and a location profile panel. The app is called **GeoInsight — Earth Explorer**.

**Live server:** `npx serve -l 8080` (Python is **not** available on this machine).

---

## 2. File Structure

```
geo-overlay/
├── index.html          # Single-page app: map, panels, controls, attribution
├── css/
│   └── styles.css      # ~1040 lines. All styling inc. glassy panels, popups, animations
├── js/
│   ├── app.js          # Map init, layer management, EQ auto-refresh, click handling
│   ├── api.js          # All external API calls + WMO codes, AQI helpers
│   ├── ui.js           # Panel/tab management, data rendering (overview, weather, air)
│   └── sun-chart.js    # Full-year sunrise/sunset chart (NOAA solar calc, canvas)
├── FEATURE-IDEAS.md    # Brainstormed future features
├── PROJECT-CONTEXT.md  # ← This file
└── .gitignore          # node_modules, dist, .env, *.log
```

---

## 3. Tech Stack & Libraries

| What | Details |
|---|---|
| **Map** | MapLibre GL v5 (CDN: `unpkg.com/maplibre-gl@5`). **IMPORTANT:** v5 uses **promise-based APIs** — e.g. `getClusterExpansionZoom()` returns a Promise, do NOT use callbacks. v5 also supports globe projection (`map.setProjection({ type: 'globe' })`). |
| **Base maps** | Satellite (Esri, default), Streets (OSM), Topo (OpenTopoMap), Ocean (GEBCO/NCEI) — all raster tile sources defined in `app.js` |
| **JS modules** | ES modules via `<script type="module">`. `app.js` is the entry point importing from `api.js`, `ui.js`, `sun-chart.js` |
| **CSS** | Single `styles.css`, CSS custom properties in `:root`, backdrop-filter glass effects |
| **No framework** | Pure vanilla JS, no React/Vue/Svelte/etc. |

---

## 4. External APIs (all free, no keys required)

| API | Endpoint | Used For |
|---|---|---|
| **Open-Meteo Weather** | `api.open-meteo.com/v1/forecast` | Current conditions, 7-day forecast, sunshine_duration, sunrise/sunset |
| **Open-Meteo Air Quality** | `air-quality-api.open-meteo.com/v1/air-quality` | US AQI, EU AQI, PM2.5, PM10, O₃, NO₂, SO₂, CO, dust |
| **Open-Meteo Elevation** | `api.open-meteo.com/v1/elevation` | Terrain elevation for any lat/lng. Returns 0 over water, so `fetchElevation()` then falls back to `/api/depth` (Worker → OpenTopoData GEBCO 2020, public limit ~1000 req/day) |
| **USGS Earthquakes** | `earthquake.usgs.gov/.../2.5_week.geojson` | M2.5+ earthquakes (7 days). Properties: `mag`, `place`, `time`, `alert`, `felt`, `cdi`, `tsunami`, `url` |
| **NOAA NDBC Buoys** | `ndbc.noaa.gov/data/latest_obs/latest_obs.txt` | Marine buoy observations (via same-origin Cloudflare Worker `worker/index.js` → `/api/buoys`). Fixed-width text parsed into GeoJSON |
| **Nominatim** | `nominatim.openstreetmap.org/reverse` | Reverse geocoding → place name + `country_code` |
| **flagcdn.com** | `flagcdn.com/24x18/{cc}.png` | Country flag images (Windows doesn't support flag emoji via regional indicators) |
| **RainViewer** | `api.rainviewer.com/public/weather-maps.json` | Real-time rain/weather radar tile timestamps. Tiles served from `tilecache.rainviewer.com` |
| **Tectonic Plates** | `raw.githubusercontent.com/.../PB2002_boundaries.json` | Peter Bird PB2002 plate boundary GeoJSON (cached after first fetch) |

---

## 5. Key Architecture Decisions

### Flags
Windows can't render flag emoji (regional indicator sequences). We use `<img>` tags from `flagcdn.com` instead. The `countryFlag(code)` function in `app.js` returns an `<img>` HTML string. `updateHeader()` in `ui.js` uses `innerHTML` (not `textContent`) when a flag is provided.

### Earthquake Auto-Refresh
- **Interval:** Every 5 minutes (`EQ_REFRESH_MS = 5 * 60 * 1000`)
- **Cache:** `earthquakeCache` in `api.js` with 5-min TTL. `fetchEarthquakes(forceRefresh)` accepts a boolean to bypass cache.
- **New detection:** `eqPreviousIds` (Set) in `app.js` tracks known earthquake IDs. On refresh, new IDs trigger the "New Earthquakes" panel.
- **First load:** Shows the 5 most recent earthquakes (sorted by time desc).
- **Panel:** Collapsible, glassy, bottom-left. Animated red border pulse (`eqBorderPulse` keyframes) when new quakes arrive. Items have slide-in animation. Clicking an item flies to its location.

### Map Click Handling
`handleMapClick()` checks `queryRenderedFeatures()` against overlay layers first. If the click hit an overlay feature (earthquake circle, buoy point/cluster), it returns early and does NOT open the location profile.

### Layer Panel Shift
When the profile panel opens (right side), the layer controls (top-right) shift left by `var(--panel-width)` using a `.shifted` CSS class toggled via JS in `showPanel()`/`hidePanel()`.

### Buoy Clustering
Buoys use MapLibre's built-in GeoJSON clustering (`cluster: true`). Cluster click uses `async/await` (not callbacks) for `getClusterExpansionZoom()`.

### Sun Chart
`sun-chart.js` implements NOAA solar position calculations from scratch (Julian date conversions, declination, hour angle). Renders a full-year sunrise/sunset/day-length chart on a `<canvas>`. Uses deferred rendering — only draws when the Sun Chart tab becomes visible (`_sunChartPending` pattern). Includes hover interactivity for daily details, solstice/equinox markers, and a today indicator line.

### Day/Night Terminator
Computed in `app.js` via `computeTerminatorGeoJSON()` using the same NOAA solar math (`sunCoords`, `toDays`, `RAD` imported from `sun-chart.js`). The night polygon + terminator edge line are drawn as GeoJSON fill + line layers. Auto-updates every 60 seconds via `terminatorInterval`. The night zone uses `fill-opacity: 0.35` so map clicks pass through it.

### Globe / 2D Toggle
A button (`#globe-toggle`) beside the logo switches between Mercator (2D) and globe (3D) projection using MapLibre v5's `map.setProjection({ type: 'globe' })`. State tracked by `isGlobe` boolean.

### Sun Direction Lines
When a location is selected, the Overview tab shows a compass button (`#sun-dir-toggle`). Clicking it draws dashed sunrise/sunset azimuth lines on the map (gold for sunrise, orange for sunset) extending ~80 km from the marker. Uses `getSunAzimuthFromChart()` + `destinationPoint()` (Haversine).

### Tectonic Plates
Loaded on-demand from GitHub (Peter Bird PB2002). Rendered as orange line layer with zoom-dependent width. Cached in `tectonicPlatesCache` in `api.js`.

### Bathymetry Overlay
GEBCO/NCEI raster tiles at 55% opacity, toggled via `#ol-bathymetry`.

### RainViewer Radar
Fetches latest radar timestamp from `api.rainviewer.com`, then loads tiles from `tilecache.rainviewer.com`. Auto-refreshes every 5 minutes via `rainviewerInterval`. On update, the source/layer is removed and re-added with the new tile URL.

### Desktop Notifications
When the earthquake overlay is enabled, the app requests `Notification` permission. New earthquakes detected during auto-refresh trigger a desktop notification showing the strongest quake. Clicking the notification flies to that quake's location.

### Negative Elevation
When elevation is negative (ocean/sea locations), the Overview tab shows "Depth" with a positive value instead of "Elevation" with a negative value.

---

## 6. App State (in `app.js`)

| Variable | Type | Purpose |
|---|---|---|
| `map` | MapLibre Map | The map instance |
| `marker` | MapLibre Marker | Current location marker (null if none) |
| `currentLat/Lng` | number | Last clicked location |
| `earthquakesLoaded` | boolean | Whether EQ data has been fetched at least once |
| `buoysLoaded` | boolean | Whether buoy data has been fetched at least once |
| `eqRefreshInterval` | interval ID | Auto-refresh timer (cleared when EQ layer toggled off) |
| `eqPreviousIds` | Set | Known earthquake IDs for new-detection |
| `platesLoaded` | boolean | Whether tectonic plate data has been fetched |
| `terminatorInterval` | interval ID | 60-second timer for day/night terminator updates |
| `sunLinesVisible` | boolean | Whether sun direction lines are shown on map |
| `isGlobe` | boolean | Whether map is in 3D globe projection mode |
| `rainviewerTimestamp` | string\|null | Last RainViewer radar tile path (for change detection) |
| `rainviewerInterval` | interval ID | 5-minute timer for radar tile updates |

---

## 7. UI Structure

### Panels & Controls
- **Logo** (`#logo-home`): Top-left. Click resets map to world view, removes marker, clears hash, closes panel/popups.
- **Globe Toggle** (`#globe-toggle`): Top-left beside logo. Switches between 2D Mercator and 3D globe projection.
- **Layer Panel** (`#layer-panel`): Top-right. Toggle button + dropdown with two sections: **Overlays** (5 checkboxes: Earthquakes, NOAA Buoys, Day/Night, Tectonic Plates, Bathymetry) and **Weather** (1 checkbox: Rain Radar). EQ checkbox has adjacent timestamp + refresh button (`#eq-meta`) and a "3D depth view" sub-option (`#ol-earthquakes-3d`, shown only while earthquakes are on).
- **Earthquake 3D view**: `setEarthquakes3D()` switches to satellite + globe + pitch 55 and swaps the circle layer for `earthquakes-3d` / `earthquakes-3d-stalk` (fill-extrusion). Each sphere is a stack of extruded discs built in `buildEarthquakeSpheres()`; height = depth relative to the deepest quake (max 1000 km), radius = magnitude. Hover/click on spheres uses `pickQuakeSphere()`, which projects each sphere at its altitude via MapLibre's internal `map.transform.locationToScreenPoint(lngLat, fakeTerrain)` because fill-extrusion hit-testing on the globe only matches the ground footprint.
- **Earthquake hover tag** (`.quake-tooltip`): magnitude + depth, background coloured by magnitude severity (`getMagLabel().color`).
- **Base Map Switcher** (`#basemap-switcher`): Bottom-centre pill of buttons (Satellite, Streets, Topo, Ocean). Re-centres in the visible map area when the profile panel is open (`.shifted`).
- **Profile Panel** (`.profile-panel`): Right side, slides in. 4 tabs: Overview, Weather, Air Quality, Sun Chart. Fixed header with flag + title + coords/elevation. Overview tab includes compass button for sun direction lines. Closing it (× or Esc) also removes the location marker and clears the URL hash (`clearSelectedLocation()`).
- **EQ Panel** (`#eq-new-panel`): Bottom-left, glassy, collapsible. Shows recent/new earthquakes with magnitude badges. Animated red border pulse when new quakes arrive. Desktop notifications for new earthquakes.
- **Coords Display** (`#coords-display`): Bottom-left, shows lat/lng on mouse move.
- **Attribution** (`#data-attribution`): Bottom-right, links to data sources (including RainViewer and GEBCO).

### URL Hash
Format: `#lat,lng` (e.g. `#51.50735,-0.12776`). On load, if hash exists, map flies there and triggers `handleMapClick`.

---

## 8. CSS Conventions

- Custom properties in `:root` for colors, spacing, transitions
- Glass effect: `background: rgba(15, 23, 42, 0.55)` + `backdrop-filter: blur(20px)`
- Animations: `fadeSlideDown`, `fadeSlideUp`, `fadeIn`, `spin`, `pulse`, `eqBorderPulse`, `eqItemSlideIn`
- All popup styling overrides MapLibre defaults via `.maplibregl-popup-content`, `.maplibregl-popup-close-button`, etc.
- Responsive breakpoints: 768px (panel goes to bottom 70vh), 480px (simplify grids)

---

## 9. Git History

```
6c8295d Fix: setProjection takes object { type: 'globe' } in MapLibre v5
135329b Fix: upgrade MapLibre v4→v5 for globe support, add glyphs URL for text labels
cb6f73e Add 2D/3D globe projection toggle (MapLibre v4 globe support)
408c997 Show 'Depth' (positive value) instead of 'Elevation' for negative elevation (ocean/sea) in Overview card
802137f Remove OWM tile layers (401 - requires paid subscription); keep RainViewer radar
81c98f6 Add bathymetry (GEBCO), weather tiles (OWM), and rain radar (RainViewer) overlays
bfc7536 Fix: day/night terminator accuracy + allow clicks through night zone
01cd561 Add: sunrise/sunset compass bearings + directional lines on map
4e0e7d8 Add: Day/Night terminator overlay and Tectonic Plates overlay
4192394 Add: project context document for session continuity
7155304 Add: EQ auto-refresh, collapsible glassy panel, new EQ alerts with animated border
1124d99 Add: country flags, earthquake alerts/felt reports, sunshine hours, logo home button
4455015 Fix: layer button shift, overlay click prevention, buoy cluster zoom, popup styling
d8b2846 Initial commit: GeoInsight Earth Explorer
```

**Branch:** `master` (single branch)

---

## 10. Known Quirks & Gotchas

1. **MapLibre GL v5 promises** — Never use callback pattern for `getClusterExpansionZoom`, `getClusterChildren`, etc. They return Promises.
2. **Windows flag emoji** — Don't try emoji regional indicators. Always use `flagcdn.com` images.
3. **NDBC proxy** — NDBC sends no CORS headers, so buoy data goes through `/api/buoys` (Cloudflare Worker, configured in `wrangler.jsonc`; static files served as Worker assets, exclusions in `.assetsignore`). Plain static servers won't serve it locally; use `npx wrangler dev`. (`corsproxy.io` was dropped after it began requiring an API key → 403.)
4. **Nominatim rate limit** — 1 request/second max. The app uses `User-Agent: GeoInsight-EarthExplorer/1.0`.
5. **No build step** — No bundler, no TypeScript, no package.json. Files served directly.
6. **EQ popup properties** — `felt` ranges from 0 to ~200,000. `alert` is one of: green, yellow, orange, red. `cdi` is Community Decimal Intensity (1-10 scale).

---

## 11. What's Been Discussed But Not Yet Built

See `FEATURE-IDEAS.md` for a full list. Key remaining items:
- Geocoding search bar
- Distance/area measurement tool
- ISS tracker
- Population density heatmaps
- Time zones overlay
- User-placed markers/annotations
