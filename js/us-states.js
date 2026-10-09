const CAPITALS = {
  '01': 'Montgomery', '02': 'Juneau', '04': 'Phoenix', '05': 'Little Rock',
  '06': 'Sacramento', '08': 'Denver', '09': 'Hartford', '10': 'Dover',
  '11': 'Washington, DC', '12': 'Tallahassee', '13': 'Atlanta', '15': 'Honolulu',
  '16': 'Boise', '17': 'Springfield', '18': 'Indianapolis', '19': 'Des Moines',
  '20': 'Topeka', '21': 'Frankfort', '22': 'Baton Rouge', '23': 'Augusta',
  '24': 'Annapolis', '25': 'Boston', '26': 'Lansing', '27': 'Saint Paul',
  '28': 'Jackson', '29': 'Jefferson City', '30': 'Helena', '31': 'Lincoln',
  '32': 'Carson City', '33': 'Concord', '34': 'Trenton', '35': 'Santa Fe',
  '36': 'Albany', '37': 'Raleigh', '38': 'Bismarck', '39': 'Columbus',
  '40': 'Oklahoma City', '41': 'Salem', '42': 'Harrisburg', '44': 'Providence',
  '45': 'Columbia', '46': 'Pierre', '47': 'Nashville', '48': 'Austin',
  '49': 'Salt Lake City', '50': 'Montpelier', '51': 'Richmond',
  '53': 'Olympia', '54': 'Charleston', '55': 'Madison', '56': 'Cheyenne'
};

let boundariesRequest = null;
const statsRequests = new Map();

export async function fetchUSStateStats(fips) {
  if (!Object.hasOwn(CAPITALS, fips)) throw new Error('Invalid state FIPS');
  if (!statsRequests.has(fips)) {
    const request = (async () => {
      const response = await fetch(`/api/us-state?${new URLSearchParams({ fips })}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`State statistics error: ${response.status}`);
      const data = await response.json();
      if (data.period !== '2020-2024') throw new Error('Invalid state statistics');
      return data;
    })().catch(error => { statsRequests.delete(fips); throw error; });
    statsRequests.set(fips, request);
  }
  return statsRequests.get(fips);
}

export async function fetchUSStates() {
  if (!boundariesRequest) {
    boundariesRequest = (async () => {
      const url = new URL('https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2024/State_County/MapServer/8/query');
      url.search = new URLSearchParams({
        where: "STATE < '60'", outFields: 'STATE,NAME,STUSAB,AREALAND,AREAWATER,INTPTLAT,INTPTLON',
        outSR: '4326', f: 'geojson', resultRecordCount: '100', geometryPrecision: '5'
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`State boundaries error: ${response.status}`);
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid state boundaries');
      const features = data.features.filter(feature => Object.hasOwn(CAPITALS, feature.properties.STATE)).map(feature => ({
        type: 'Feature', geometry: feature.geometry,
        properties: {
          fips: feature.properties.STATE, name_en: feature.properties.NAME,
          abbreviation: feature.properties.STUSAB, capital: CAPITALS[feature.properties.STATE],
          land_km2: Number(feature.properties.AREALAND) / 1e6,
          water_km2: Number(feature.properties.AREAWATER) / 1e6,
          label_x: Number(feature.properties.INTPTLON), label_y: Number(feature.properties.INTPTLAT)
        }
      }));
      if (new Set(features.map(feature => feature.properties.fips)).size !== 51) throw new Error('Incomplete state boundaries');
      return {
        boundaries: { type: 'FeatureCollection', features },
        labels: {
          type: 'FeatureCollection', features: features.map(feature => ({
            type: 'Feature', properties: feature.properties,
            geometry: { type: 'Point', coordinates: [feature.properties.label_x, feature.properties.label_y] }
          }))
        }
      };
    })().catch(error => { boundariesRequest = null; throw error; });
  }
  return boundariesRequest;
}