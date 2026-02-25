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
│   └── styles.css      # ~950 lines. All styling inc. glassy panels, popups, animations
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
| **Map** | MapLibre GL v4 (CDN: `unpkg.com/maplibre-gl@4`). **IMPORTANT:** v4 uses **promise-based APIs** — e.g. `getClusterExpansionZoom()` returns a Promise, do NOT use callbacks. |
| **Base maps** | Streets (OSM), Topo (OpenTopoMap), Satellite (Esri), Dark (CARTO) — all raster tile sources defined in `app.js` |
| **JS modules** | ES modules via `<script type="module">`. `app.js` is the entry point importing from `api.js`, `ui.js`, `sun-chart.js` |
| **CSS** | Single `styles.css`, CSS custom properties in `:root`, backdrop-filter glass effects |
| **No framework** | Pure vanilla JS, no React/Vue/Svelte/etc. |

---

## 4. External APIs (all free, no keys required)

| API | Endpoint | Used For |
|---|---|---|
| **Open-Meteo Weather** | `api.open-meteo.com/v1/forecast` | Current conditions, 7-day forecast, sunshine_duration, sunrise/sunset |
| **Open-Meteo Air Quality** | `air-quality-api.open-meteo.com/v1/air-quality` | US AQI, EU AQI, PM2.5, PM10, O₃, NO₂, SO₂, CO, dust |
| **Open-Meteo Elevation** | `api.open-meteo.com/v1/elevation` | Terrain elevation for any lat/lng |
| **USGS Earthquakes** | `earthquake.usgs.gov/.../2.5_week.geojson` | M2.5+ earthquakes (7 days). Properties: `mag`, `place`, `time`, `alert`, `felt`, `cdi`, `tsunami`, `url` |
| **NOAA NDBC Buoys** | `ndbc.noaa.gov/data/latest_obs/latest_obs.txt` | Marine buoy observations (via `corsproxy.io` CORS proxy). Fixed-width text parsed into GeoJSON |
| **Nominatim** | `nominatim.openstreetmap.org/reverse` | Reverse geocoding → place name + `country_code` |
| **flagcdn.com** | `flagcdn.com/24x18/{cc}.png` | Country flag images (Windows doesn't support flag emoji via regional indicators) |

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
`sun-chart.js` implements NOAA solar position calculations from scratch (Julian date conversions, declination, hour angle). Renders a full-year sunrise/sunset/day-length chart on a `<canvas>`. Uses deferred rendering — only draws when the Sun Chart tab becomes visible (`_sunChartPending` pattern).

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

---

## 7. UI Structure

### Panels & Controls
- **Logo** (`#logo-home`): Top-left. Click resets map to world view, removes marker, clears hash, closes panel/popups.
- **Layer Panel** (`#layer-panel`): Top-right. Toggle button + dropdown with base map radios + overlay checkboxes. EQ checkbox has adjacent timestamp + refresh button (`#eq-meta`).
- **Profile Panel** (`.profile-panel`): Right side, slides in. 4 tabs: Overview, Weather, Air Quality, Sun Chart. Fixed header with flag + title + coords/elevation.
- **EQ Panel** (`#eq-new-panel`): Bottom-left, glassy, collapsible. Shows recent/new earthquakes with magnitude badges.
- **Coords Display** (`#coords-display`): Bottom-left, shows lat/lng on mouse move.
- **Attribution** (`#data-attribution`): Bottom-right, links to data sources.

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
7155304 Add: EQ auto-refresh, collapsible glassy panel, new EQ alerts with animated border
1124d99 Add: country flags, earthquake alerts/felt reports, sunshine hours, logo home button
4455015 Fix: layer button shift, overlay click prevention, buoy cluster zoom, popup styling
d8b2846 Initial commit: GeoInsight Earth Explorer
```

**Branch:** `master` (single branch)

---

## 10. Known Quirks & Gotchas

1. **MapLibre GL v4 promises** — Never use callback pattern for `getClusterExpansionZoom`, `getClusterChildren`, etc. They return Promises.
2. **Windows flag emoji** — Don't try emoji regional indicators. Always use `flagcdn.com` images.
3. **CORS proxy for NDBC** — Buoy data requires `corsproxy.io` as a proxy. If it goes down, buoys will fail.
4. **Nominatim rate limit** — 1 request/second max. The app uses `User-Agent: GeoInsight-EarthExplorer/1.0`.
5. **No build step** — No bundler, no TypeScript, no package.json. Files served directly.
6. **EQ popup properties** — `felt` ranges from 0 to ~200,000. `alert` is one of: green, yellow, orange, red. `cdi` is Community Decimal Intensity (1-10 scale).

---

## 11. What's Been Discussed But Not Yet Built

See `FEATURE-IDEAS.md` for a full list. Key items from conversation:
- Geocoding search bar
- Day/night terminator line
- Distance/area measurement tool
- ISS tracker
- Tectonic plate boundaries overlay
- Population density heatmaps
