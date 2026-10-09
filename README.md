# 🌍 GeoInsight — Earth Explorer

An interactive world map with layered data overlays and rich location profiles. Built with vanilla HTML/CSS/JS — no frameworks, no build step.

![MapLibre](https://img.shields.io/badge/MapLibre_GL-v5-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![No Build](https://img.shields.io/badge/build-none_needed-brightgreen)

## Features

### 🗺️ Base Maps
Switch between four base map styles from the bar at the bottom of the screen:
- **Satellite** (Esri) — default
- **Streets** (OpenStreetMap)
- **Topographic** (OpenTopoMap)
- **Ocean** (GEBCO/NCEI bathymetry)

### 📊 Data Overlays
- **🌐 Countries** — English country names and outlined borders from Natural Earth v5.1.2 (1:50m), available over any base map in 2D or globe mode. The public-domain dataset includes countries and territories; boundaries are generalized, may be disputed, and are not a statement of sovereignty. Labels use dedicated placement points and collision handling. Data loads on first use and is cached for the session.
- **🔴 Earthquakes** — M2.5+ earthquakes from the past 7 days (USGS). Auto-refreshes every 5 minutes with desktop notifications for new quakes. Color-coded by depth, sized by magnitude. Hover for a quick magnitude/depth tag.
  - **🔮 3D depth view** — switches to satellite + globe and shows each quake as a sphere floating above the surface: height = depth (relative to the deepest quake shown), size = magnitude.
- **🚢 NOAA Buoys** — Real-time marine buoy observations with wave height, water temp, wind, and pressure. Clustered at low zoom levels.
- **🌗 Day/Night Terminator** — Real-time sunlight boundary, updated every 60 seconds.
- **🌋 Tectonic Plates** — Major plate boundaries (Peter Bird PB2002 dataset).
- **🌊 Bathymetry** — Ocean depth overlay (GEBCO).
- **📡 Rain Radar** — Real-time precipitation radar (RainViewer).

### Country Selection
With Countries enabled, clicking land selects a country instead of placing a location pin or opening the location profile. All parts of its Natural Earth geometry are highlighted, including offshore regions. The popup's **Include associated territories** checkbox adds lighter fills and dashed outlines for other features in the same Natural Earth sovereignty group, with their names listed separately. These associations are dataset classifications, not legal determinations.

The popup loads capital, languages, and currency from the open [mledoze/countries dataset](https://github.com/mledoze/countries), plus population, surface area, population density (per land area), and GDP per capita in current USD from the [World Bank](https://data.worldbank.org/). Each indicator links to its source and observation year; metadata is explicitly undated. Values may have different years and geographic coverage across sources. Associated-territory highlighting does not aggregate statistics. Successful requests are cached for the page session; missing records are marked unavailable and failed requests can be retried.

Ocean clicks, Escape, or closing the popup clear selection. Disabling Countries restores location pins. Measure Distance takes priority over country selection. Country stats open in a floating panel on the opposite side of the map from the click. Drag the header with a mouse or touch, or focus it and use the arrow keys (Shift for larger steps), to reposition the panel. It stays in place while the map moves and is kept inside the map bounds. Statistics scroll independently so the header and close button remain accessible on smaller screens.

### US States
Enable **US States** beneath Countries, or use **Show states** in the United States panel. Both controls share one setting. The overlay covers the 50 states plus Washington, DC with English labels and Census 2024 generalized 1:5m boundaries; territories remain separate country/territory selections. Clicking a state highlights it and opens the same draggable panel. Clicks outside the US still select countries, disabling States restores US country selection, and disabling Countries also turns States off. Measure Distance retains priority.

State panels include capital (or DC's federal seat), abbreviation, land and total area, population, calculated population density, and median household income. Population and income use Census ACS **2020-2024 five-year estimates**, served by [Census Reporter](https://censusreporter.org/), with reported 90% margins of error; income is in inflation-adjusted 2024 USD. Area comes from the 2024 Census boundaries and capitals are reference metadata. These are dated estimates, not live counts.

State statistics require the existing Cloudflare Worker: `GET /api/us-state?fips=06` validates the FIPS code, queries a fixed Census Reporter endpoint with a project-specific User-Agent, and caches successful responses for a day. No Census API key is required. Missing estimates are marked unavailable; failed requests offer retry. Boundaries load on first use and are cached for the page session.

### Tools
**Measure Distance**, below Weather in the layer menu, measures a multi-point path in kilometres and miles. Enable it and click successive points on the map. Undo removes the last point; Clear starts a new measurement; Close, Escape, or disabling the tool exits measurement mode. It works in 2D and globe mode using Turf geodesic distances and great-circle lines, including dateline crossings. Distances approximate the Earth's surface, not road routes or terrain elevation. The tool loads pinned Turf modules from esm.sh; the rest of the map remains available if that dependency fails.

### 📍 Location Profiles
With Countries and Measure Distance off, click anywhere on the map to open a detailed profile panel with four tabs:

| Tab | Content |
|-----|---------|
| **Overview** | Current conditions, location details, elevation/depth, today's daylight with sunrise/sunset compass bearings |
| **Weather** | Current conditions detail + 7-day forecast with sunshine hours |
| **Air Quality** | US & EU AQI, pollutant breakdown with visual bars (PM2.5, PM10, O₃, NO₂, SO₂, CO, dust) |
| **Sun Chart** | Full-year sunrise/sunset/day-length chart with solstice/equinox markers and hover details |

### 🌐 Globe Mode
Toggle between 2D Mercator and 3D globe projection (MapLibre GL v5).

### 🧭 Sun Direction Lines
Visualize sunrise/sunset compass bearings as directional lines on the map from any selected location.

---

## Quick Start

No build step required — just serve the files:

```bash
npx serve -l 8080
```

Then open [http://localhost:8080](http://localhost:8080).

---

## Tech Stack

| | |
|---|---|
| **Map Engine** | [MapLibre GL JS v5](https://maplibre.org/) |
| **Languages** | Vanilla HTML, CSS, JavaScript (ES modules) |
| **APIs** | Open-Meteo, USGS, NOAA NDBC, Nominatim, RainViewer, flagcdn |
| **Build** | None — served directly from source |

---

## APIs Used

All APIs are **free and require no API keys**.

| API | Purpose |
|-----|---------|
| [Open-Meteo](https://open-meteo.com/) | Weather forecasts, air quality, elevation |
| [USGS Earthquakes](https://earthquake.usgs.gov/) | Real-time earthquake feed |
| [NOAA NDBC](https://www.ndbc.noaa.gov/) | Marine buoy observations |
| [OpenTopoData](https://www.opentopodata.org/) | Ocean depth (GEBCO 2020) for water clicks |
| [Nominatim](https://nominatim.openstreetmap.org/) | Reverse geocoding |
| [RainViewer](https://www.rainviewer.com/) | Rain radar tiles |
| [flagcdn.com](https://flagcdn.com/) | Country flag images |

---

## Project Structure

```
geo-overlay/
├── index.html          # Single-page app
├── css/
│   └── styles.css      # All styling (glassy panels, popups, animations)
├── js/
│   ├── app.js          # Map init, layer management, interaction handling
│   ├── api.js          # All external API calls + helpers
│   ├── ui.js           # Panel/tab management, data rendering
│   └── sun-chart.js    # NOAA solar calculations + canvas chart
├── FEATURE-IDEAS.md    # Future feature brainstorms
└── PROJECT-CONTEXT.md  # Full project context for AI session continuity
```

---

## URL Hash Navigation

The app supports deep linking via URL hash:

```
http://localhost:8080/#51.50735,-0.12776   → Flies to London
```

---

## License

MIT
