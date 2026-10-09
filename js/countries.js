import { fetchCountryStats } from './api.js';
import { fetchUSStates, fetchUSStateStats } from './us-states.js';

const METRICS = [
  ['SP.POP.TOTL', 'Population', 0, ''],
  ['AG.SRF.TOTL.K2', 'Surface area', 0, ' km²'],
  ['EN.POP.DNST', 'Density (land area)', 1, ' / km²'],
  ['NY.GDP.PCAP.CD', 'GDP per capita', 0, ' USD']
];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function sourceLink(text, url) {
  const link = element('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function setupCountrySelection(map) {
  let features = [];
  let popup = null;
  let cleanupPopup = () => {};
  let countriesEnabled = false;
  let statesLoaded = false;
  let statesVisible = false;
  const statesToggle = document.getElementById('ol-us-states');
  const statesOption = document.getElementById('us-states-option');
  const emptyStateFilter = ['==', ['get', 'fips'], ''];
  const emptyFilter = ['==', ['get', 'admin_a3'], ''];
  const layers = ['country-hit', 'country-associated-fill', 'country-selected-fill', 'country-associated-line', 'country-selected-line'];
  const definitions = [
    { id: layers[0], type: 'fill', paint: { 'fill-opacity': 0 } },
    { id: layers[1], type: 'fill', filter: emptyFilter, paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.2 } },
    { id: layers[2], type: 'fill', filter: emptyFilter, paint: { 'fill-color': '#34d399', 'fill-opacity': 0.4 } },
    { id: layers[3], type: 'line', filter: emptyFilter, paint: { 'line-color': '#7dd3fc', 'line-width': 2, 'line-dasharray': [2, 2] } },
    { id: layers[4], type: 'line', filter: emptyFilter, paint: { 'line-color': '#6ee7b7', 'line-width': 3 } }
  ];
  definitions.forEach(layer => map.addLayer({ ...layer, source: 'countries', layout: { visibility: 'none' } }, layer.type === 'line' ? 'country-names' : 'country-borders-halo'));

  map.addSource('us-states', {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    attribution: '<a href="https://www.census.gov/">US Census Bureau</a> (2024)'
  });
  map.addSource('us-state-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const stateDefinitions = [
    { id: 'us-state-hit', type: 'fill', paint: { 'fill-opacity': 0 } },
    { id: 'us-state-selected-fill', type: 'fill', filter: emptyStateFilter, paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.3 } },
    { id: 'us-state-borders-halo', type: 'line', paint: { 'line-color': '#111827', 'line-width': 3, 'line-opacity': 0.7 } },
    { id: 'us-state-borders', type: 'line', paint: { 'line-color': '#f8fafc', 'line-width': 1.2 } },
    { id: 'us-state-selected-line', type: 'line', filter: emptyStateFilter, paint: { 'line-color': '#fcd34d', 'line-width': 3 } }
  ];
  stateDefinitions.forEach(layer => map.addLayer({ ...layer, source: 'us-states', layout: { visibility: 'none' } }, 'country-names'));
  map.addLayer({
    id: 'us-state-names', type: 'symbol', source: 'us-state-labels',
    layout: {
      visibility: 'none', 'text-field': ['get', 'name_en'], 'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 13, 8, 16],
      'text-max-width': 8, 'text-padding': 5, 'text-allow-overlap': false
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1.5 }
  });
  const stateLayers = [...stateDefinitions.map(layer => layer.id), 'us-state-names'];

  function showStates(visible) {
    statesVisible = visible;
    stateLayers.forEach(id => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'));
    map.setFilter('country-names', visible ? ['!=', ['get', 'admin_a3'], 'USA'] : null);
  }

  statesToggle.addEventListener('change', async () => {
    clear();
    const text = statesOption.querySelector('.layer-label');
    if (!countriesEnabled || !statesToggle.checked) { showStates(false); return; }
    if (!statesLoaded) {
      text.textContent = 'Loading US states...';
      statesOption.setAttribute('aria-busy', 'true');
      try {
        const { boundaries, labels } = await fetchUSStates();
        if (!statesLoaded) {
          map.getSource('us-states').setData(boundaries);
          map.getSource('us-state-labels').setData(labels);
          statesLoaded = true;
        }
      } catch {
        statesToggle.checked = false;
        text.textContent = 'US States unavailable - retry';
        showStates(false);
        return;
      } finally {
        statesOption.removeAttribute('aria-busy');
      }
    }
    text.textContent = 'US States';
    showStates(countriesEnabled && statesToggle.checked);
  });

  function clear() {
    cleanupPopup();
    cleanupPopup = () => {};
    const previous = popup;
    popup = null;
    previous?.remove();
    layers.slice(1).forEach(id => map.setFilter(id, emptyFilter));
    ['us-state-selected-fill', 'us-state-selected-line'].forEach(id => map.setFilter(id, emptyStateFilter));
  }

  function select(properties, coordinates) {
    clear();
    const isState = !!properties.fips;
    const kind = isState ? 'state' : 'country';
    const selectedFilter = ['==', ['get', isState ? 'fips' : 'admin_a3'], isState ? properties.fips : properties.admin_a3];
    const selectedLayers = isState ? ['us-state-selected-fill', 'us-state-selected-line'] : ['country-selected-fill', 'country-selected-line'];
    selectedLayers.forEach(id => map.setFilter(id, selectedFilter));
    const associated = properties.sovereign_a3 && properties.sovereign_a3 !== '-99'
      ? features.filter(feature => feature.properties.sovereign_a3 === properties.sovereign_a3 && feature.properties.admin_a3 !== properties.admin_a3)
      : [];
    const content = element('section', null, 'country-profile');
    const header = element('header', null, 'country-drag-handle');
    header.tabIndex = 0;
    header.title = `Drag to move ${kind} statistics; arrow keys also move the panel`;
    header.setAttribute('aria-label', `Move ${kind} statistics`);
    header.append(element('h3', properties.name_en));
    const body = element('div', null, 'country-popup-body');
    content.append(header, body);
    const stats = element('div', null, 'country-stats');
    stats.setAttribute('aria-live', 'polite');
    body.append(stats);

    if (properties.admin_a3 === 'USA') {
      const label = element('label', null, 'country-associated-toggle');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = statesToggle.checked;
      checkbox.addEventListener('change', () => {
        statesToggle.checked = checkbox.checked;
        statesToggle.dispatchEvent(new Event('change'));
      });
      label.append(checkbox, element('span', 'Show states'));
      body.prepend(label);
    }

    if (associated.length) {
      const label = element('label', null, 'country-associated-toggle');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      label.append(checkbox, element('span', 'Include associated territories'));
      const related = element('p', null, 'country-related');
      related.hidden = true;
      related.textContent = `${properties.sovereign_name} group: ${associated.map(feature => feature.properties.name_en).sort().join(', ')}`;
      checkbox.addEventListener('change', () => {
        const filter = checkbox.checked
          ? ['all', ['==', ['get', 'sovereign_a3'], properties.sovereign_a3], ['!=', ['get', 'admin_a3'], properties.admin_a3]]
          : emptyFilter;
        ['country-associated-fill', 'country-associated-line'].forEach(id => map.setFilter(id, filter));
        related.hidden = !checkbox.checked;
        fitPopup();
      });
      body.append(label, related);
    }
    const caveat = element('p', null, 'country-source');
    if (isState) {
      caveat.append(sourceLink('US Census boundaries · 2024', 'https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html'), document.createTextNode('. Generalized 1:5m boundaries. ACS estimates cover 2020-2024; income is in 2024 inflation-adjusted USD. Margins of error use 90% confidence. Density is calculated from population and land area.'));
    } else {
      caveat.append(sourceLink('Natural Earth boundaries', 'https://www.naturalearthdata.com/'), document.createTextNode('. Generalized; disputed areas and associations follow this dataset. Statistics cover the selected country or territory only.'));
    }
    body.append(caveat);
    const currentPopup = element('div', null, 'maplibregl-popup country-popup');
    currentPopup.setAttribute('role', 'dialog');
    currentPopup.setAttribute('aria-label', `${properties.name_en} statistics`);
    const frame = element('div', null, 'maplibregl-popup-content');
    const close = element('button', '×', 'maplibregl-popup-close-button');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${kind} statistics`);
    close.addEventListener('click', clear);
    header.append(close);
    frame.append(content);
    currentPopup.append(frame);
    map.getContainer().append(currentPopup);
    popup = currentPopup;
    let position = null;
    let drag = null;
    function fitPopup() {
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;
      content.style.maxHeight = `${Math.max(80, Math.min(580, height - 150))}px`;
      const panelWidth = currentPopup.offsetWidth;
      const panelHeight = currentPopup.offsetHeight;
      const maxLeft = Math.max(12, width - panelWidth - 12);
      const maxTop = Math.max(64, height - panelHeight - 80);
      if (!position) {
        const point = map.project(coordinates);
        position = { left: point.x <= width / 2 ? maxLeft : 12, top: 64 };
      }
      position.left = Math.max(12, Math.min(maxLeft, position.left));
      position.top = Math.max(64, Math.min(maxTop, position.top));
      currentPopup.style.left = `${position.left}px`;
      currentPopup.style.top = `${position.top}px`;
    }
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      header.focus({ preventScroll: true });
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...position };
      header.setPointerCapture(event.pointerId);
      header.classList.add('is-dragging');
    });
    header.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      position = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y };
      fitPopup();
    });
    const endDrag = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      header.classList.remove('is-dragging');
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('lostpointercapture', endDrag);
    header.addEventListener('keydown', event => {
      if (event.target !== header) return;
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 50 : 20;
      position.left += direction[0] * step;
      position.top += direction[1] * step;
      fitPopup();
    });
    const observer = new ResizeObserver(fitPopup);
    observer.observe(content);
    map.on('resize', fitPopup);
    fitPopup();
    cleanupPopup = () => {
      observer.disconnect();
      map.off('resize', fitPopup);
    };

    async function loadStats() {
      stats.replaceChildren(element('p', 'Loading statistics...'));
      stats.setAttribute('aria-busy', 'true');
      const data = isState
        ? await fetchUSStateStats(properties.fips).then(result => ({ ...result, errors: [] })).catch(() => ({ errors: ['ACS statistics'] }))
        : await fetchCountryStats(properties.iso_a3).catch(() => ({ metadata: null, indicators: [], errors: ['Statistics'] }));
      if (popup !== currentPopup) return;
      const list = element('dl');
      const addRow = (title, value) => {
        list.append(element('dt', title));
        const detail = element('dd');
        if (typeof value === 'string') detail.textContent = value;
        else detail.append(value);
        list.append(detail);
      };
      if (isState) {
        const format = (value, digits = 0) => new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(value);
        const acsRow = (title, estimate, margin, unit = '') => {
          if (!Number.isFinite(estimate)) { addRow(title, 'Not available'); return; }
          const value = element('span', `${format(estimate)}${unit}`);
          if (Number.isFinite(margin)) value.append(element('small', `±${format(margin)} (90% MOE)`));
          addRow(title, value);
        };
        addRow(properties.fips === '11' ? 'Federal seat' : 'Capital', properties.capital);
        addRow('Abbreviation', properties.abbreviation);
        acsRow('Population', data.population, data.populationMoe);
        addRow('Land area', `${format(properties.land_km2)} km²`);
        addRow('Total area', `${format(properties.land_km2 + properties.water_km2)} km²`);
        addRow('Density (land)', Number.isFinite(data.population) && properties.land_km2 > 0 ? `${format(data.population / properties.land_km2, 1)} / km²` : 'Not available');
        acsRow('Median household income', data.medianIncome, data.incomeMoe, ' USD');
      } else {
        addRow('Capital', data.metadata?.capital?.join(', ') || 'Not available');
        addRow('Languages', Object.values(data.metadata?.languages || {}).join(', ') || 'Not available');
        addRow('Currency', Object.entries(data.metadata?.currencies || {}).map(([code, currency]) => `${currency.name} (${code})`).join(', ') || 'Not available');
        for (const [code, title, digits, unit] of METRICS) {
          const record = data.indicators.filter(item => item.indicator?.id === code).sort((first, second) => Number(second.date) - Number(first.date))[0];
          if (!record) { addRow(title, 'Not available'); continue; }
          const value = element('span', `${new Intl.NumberFormat('en', { maximumFractionDigits: digits }).format(record.value)}${unit}`);
          const provenance = element('small');
          provenance.append(sourceLink(`World Bank · ${record.date}`, `https://data.worldbank.org/indicator/${code}?locations=${encodeURIComponent(record.country.id)}`));
          value.append(provenance);
          addRow(title, value);
        }
      }
      stats.replaceChildren(list);
      const metadataSource = element('p', null, 'country-source');
      if (isState) {
        metadataSource.append(sourceLink('Census ACS · 2020-2024 via Census Reporter', `https://censusreporter.org/profiles/04000US${properties.fips}/`), document.createElement('br'), sourceLink('Capital reference', 'https://en.wikipedia.org/wiki/List_of_capitals_in_the_United_States'));
      } else {
        metadataSource.append(sourceLink('Country metadata', 'https://github.com/mledoze/countries'), document.createTextNode(' · undated'));
      }
      stats.append(metadataSource);
      if (data.errors.length) {
        stats.append(element('p', `${data.errors.join(' and ')} unavailable.`, 'country-source'));
        const retry = element('button', 'Retry statistics', 'country-retry');
        retry.type = 'button';
        retry.addEventListener('click', loadStats);
        stats.append(retry);
      }
      stats.removeAttribute('aria-busy');
      fitPopup();
    }
    loadStats();
  }

  return {
    clear,
    setData(data) { features = data.features; },
    setEnabled(enabled) {
      clear();
      countriesEnabled = enabled;
      statesOption.classList.toggle('hidden', !enabled);
      if (!enabled) {
        statesToggle.checked = false;
        showStates(false);
      }
      layers.forEach(id => map.setLayoutProperty(id, 'visibility', enabled ? 'visible' : 'none'));
    },
    handleClick(event) {
      if (!event.point || map.project(event.lngLat).dist(event.point) >= 1) { clear(); return; }
      if (statesVisible) {
        const state = map.queryRenderedFeatures(event.point, { layers: ['us-state-names', 'us-state-hit'] })[0];
        if (state) { select(state.properties, event.lngLat); return; }
      }
      const feature = map.queryRenderedFeatures(event.point, { layers: ['country-names', 'country-hit'] })[0];
      if (feature) select(feature.properties, event.lngLat);
      else clear();
    }
  };
}