// baseUrl points to the root of this data directory on your web server.
export async function addSentinelLeaflet(map, L, baseUrl, sensor, year) {
  const services = await fetch(`${baseUrl}/04_imagery/services.json`).then(r => r.json());
  const layer = services.layers.find(x => x.sensor === sensor && x.year === year);
  if (!layer) throw new Error(`No imagery layer for ${sensor} ${year}`);
  return L.tileLayer(layer.xyz_url, {
    minZoom: sensor === 'S2' ? 9 : 6,
    maxZoom: 14,
    attribution: 'Copernicus Sentinel / Microsoft Planetary Computer'
  }).addTo(map);
}

export async function addSentinelMapLibre(map, baseUrl, sensor, year) {
  const services = await fetch(`${baseUrl}/04_imagery/services.json`).then(r => r.json());
  const layer = services.layers.find(x => x.sensor === sensor && x.year === year);
  if (!layer) throw new Error(`No imagery layer for ${sensor} ${year}`);
  const id = layer.id;
  map.addSource(id, { type: 'raster', url: layer.tilejson_url, tileSize: 256 });
  map.addLayer({ id, type: 'raster', source: id });
  return id;
}

// Ready-to-display Web Mercator image; use actual image bounds in its JSON.
export async function addAnnualWeatherLeaflet(map, L, baseUrl, variable, year) {
  if (!['temperature', 'precipitation'].includes(variable)) throw new Error('Unknown variable');
  const relative = `05_weather/${year}/${variable}_${year}`;
  const meta = await fetch(`${baseUrl}/${relative}.json`).then(r => r.json());
  const [west, south, east, north] = meta.web_preview_bounds_wgs84;
  const label = meta.temporal_complete ? `${year}` : `${year}（截至${meta.period_end}）`;
  const image = L.imageOverlay(`${baseUrl}/${meta.web_preview}`, [[south, west], [north, east]],
    { opacity: 0.7, attribution: 'Copernicus ERA5 / Open-Meteo' }).addTo(map);
  return { image, label, metadata: meta };
}

// Numerical grid for clicks or filling cells; the edges retain whole cells.
export async function loadAnnualWeatherGrid(baseUrl, variable, year) {
  if (!['temperature', 'precipitation'].includes(variable)) throw new Error('Unknown variable');
  return fetch(`${baseUrl}/05_weather/${year}/${variable}_${year}.geojson`).then(r => r.json());
}
