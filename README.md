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
- **🔴 Earthquakes** — M2.5+ earthquakes from the past 7 days (USGS). Auto-refreshes every 5 minutes with desktop notifications for new quakes. Color-coded by depth, sized by magnitude.
- **🚢 NOAA Buoys** — Real-time marine buoy observations with wave height, water temp, wind, and pressure. Clustered at low zoom levels.
- **🌗 Day/Night Terminator** — Real-time sunlight boundary, updated every 60 seconds.
- **🌋 Tectonic Plates** — Major plate boundaries (Peter Bird PB2002 dataset).
- **🌊 Bathymetry** — Ocean depth overlay (GEBCO).
- **📡 Rain Radar** — Real-time precipitation radar (RainViewer).

### 📍 Location Profiles
Click anywhere on the map to open a detailed profile panel with four tabs:

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
