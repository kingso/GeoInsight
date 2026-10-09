import distance from 'https://esm.sh/@turf/distance@7.2.0';
import greatCircle from 'https://esm.sh/@turf/great-circle@7.2.0';

export function setupDistanceTool(map, onStart) {
  const toggle = document.getElementById('tool-measure-distance');
  const toolbar = document.getElementById('measure-toolbar');
  const total = document.getElementById('measure-total');
  const undo = document.getElementById('measure-undo');
  const clear = document.getElementById('measure-clear');
  let active = false;
  let points = [];
  let restoreDoubleClickZoom = false;

  map.addSource('measure-distance', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'measure-distance-line',
    type: 'line',
    source: 'measure-distance',
    filter: ['==', '$type', 'LineString'],
    paint: { 'line-color': '#facc15', 'line-width': 3 },
    layout: { 'line-cap': 'round', 'line-join': 'round' }
  });
  map.addLayer({
    id: 'measure-distance-points',
    type: 'circle',
    source: 'measure-distance',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#facc15',
      'circle-stroke-color': '#111827',
      'circle-stroke-width': 2
    }
  });

  function render() {
    const features = points.map(coordinates => ({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates }
    }));
    let kilometers = 0;
    for (let index = 1; index < points.length; index++) {
      kilometers += distance(points[index - 1], points[index]);
      features.push(greatCircle(points[index - 1], points[index], { npoints: 128 }));
    }
    map.getSource('measure-distance').setData({ type: 'FeatureCollection', features });
    const format = value => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    total.textContent = `${format(kilometers)} km / ${format(kilometers / 1.609344)} mi`;
    undo.disabled = clear.disabled = points.length === 0;
  }

  function stop() {
    if (!active) return;
    active = false;
    points = [];
    toggle.checked = false;
    toolbar.hidden = true;
    map.getContainer().classList.remove('is-measuring');
    if (restoreDoubleClickZoom) map.doubleClickZoom.enable();
    render();
  }

  toggle.disabled = false;
  toggle.addEventListener('change', () => {
    if (!toggle.checked) return stop();
    onStart();
    map.getContainer().querySelectorAll('.maplibregl-popup-close-button').forEach(button => button.click());
    active = true;
    toolbar.hidden = false;
    map.getContainer().classList.add('is-measuring');
    restoreDoubleClickZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    render();
  });
  undo.addEventListener('click', () => { points.pop(); render(); });
  clear.addEventListener('click', () => { points = []; render(); });
  document.getElementById('measure-stop').addEventListener('click', stop);

  return {
    get active() { return active; },
    addPoint({ lng, lat }) {
      if (!active || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const point = [((lng + 180) % 360 + 360) % 360 - 180, lat];
      const previous = points[points.length - 1];
      if (previous && distance(previous, point) < 0.000001) return;
      if (previous && Math.abs(distance(previous, point) - Math.PI * 6371.0088) < 0.001) return;
      points.push(point);
      render();
    },
    stop
  };
}