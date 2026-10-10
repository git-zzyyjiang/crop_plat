const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const backup = path.resolve(root, '../balkhash-integration-backup-20261009');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const storeObject = source => parser.parse(source, { sourceType: 'module' }).program.body.find(node => node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === 'useMapStore')).declarations[0].init.arguments[1];
const actions = object => object.properties.find(node => node.key.name === 'actions').value.properties;
const current = read(path.join(root, 'src/stores/map.js'));
const original = read(path.join(backup, 'src/stores/map.js'));
const currentActions = actions(storeObject(current));
const allowed = new Set(['setTemporalPeriod', 'setTemporalLayer', 'loadTemporalLayer', 'clearTemporalLayers', 'initMap']);
for (const action of actions(storeObject(original))) {
  if (allowed.has(action.key.name)) continue;
  const next = currentActions.find(item => item.key.name === action.key.name);
  assert.equal(current.slice(next.start, next.end), original.slice(action.start, action.end), 'Existing action changed: ' + action.key.name);
}
for (const file of ['src/components/land-mass.vue', 'src/components/crop-classification.vue', 'src/components/part/parcel-analysis-panel.vue', 'src/components/part/crop-analysis-panel.vue', 'src/components/part/date-timeline.vue', 'src/utils/parcel-analysis.js', 'src/utils/parcel-animation.js', 'src/utils/recognition-data.js', 'src/utils/local-terrain.js', 'src/components/map-scene-3d.vue', 'public/css/index.css', 'src/router/index.js']) {
  assert.ok(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(backup, file))), 'Protected file changed: ' + file);
}
console.log('PASS: existing agriculture, crop structure, terrain, styling and routes preserved.');
class Layer {
  constructor(options = {}) { this.options = options; this.source = options.source; this.visible = true; }
  getSource() { return this.source; }
  setVisible(value) { this.visible = value; }
}
class Source { constructor(options) { this.options = options; } on() {} }
let requests = [];
const context = vm.createContext({ Tile: Layer, XYZ: Source, axios: { get: () => new Promise(resolve => requests.push(resolve)) }, markRaw: value => value, unByKey() {}, console, clearInterval, clearTimeout, setInterval, setTimeout });
const actionFunction = name => {
  const node = currentActions.find(item => item.key.name === name).value;
  return vm.runInContext('(' + current.slice(node.start, node.end) + ')', context);
};
function makeStore() {
  const layers = [];
  return { map: { addLayer: layer => layers.push(layer), removeLayer: layer => { const index = layers.indexOf(layer); if(index >= 0) layers.splice(index, 1); } }, layers,
    temporalYear: 2024, temporalRequestRevision: 0, temporalLayerRequests: {}, temporalLayerEnabled: {}, temporalLayerInstances: {}, temporalLayerStatus: {}, temporalAnnotationLayers: {}, temporalAnimationTimers: {}, temporalClipKeys: {}, temporalLayerColorVisibility: {}, temporalHoverInfo: null,
    clipTemporalLayerToBasin() {}, loadTemporalLayer: actionFunction('loadTemporalLayer'), setTemporalLayer: actionFunction('setTemporalLayer'), clearTemporalLayers: actionFunction('clearTemporalLayers') };
}
const services = { data: { layers: [2024, 2025, 2026].map(year => ({ id: 'S1_' + year, xyz_url: 'https://example.test/' + year + '/{z}/{x}/{y}' })) } };
(async () => {
  let store = makeStore();
  const pending = store.loadTemporalLayer('sentinel1', false);
  store.setTemporalLayer('sentinel1', false);
  requests.shift()(services); await pending;
  assert.equal(store.layers.length, 0); assert.equal(store.temporalLayerEnabled.sentinel1, false);
  assert.equal(store.temporalLayerStatus.sentinel1, undefined);
  console.log('PASS: deselecting an imagery layer cancels a pending load.');
  store = makeStore();
  const old = store.loadTemporalLayer('sentinel1', true);
  store.temporalYear = 2026;
  const latest = store.loadTemporalLayer('sentinel1', true);
  const oldResponse = requests.shift(), latestResponse = requests.shift();
  latestResponse(services); await latest; oldResponse(services); await old;
  assert.equal(store.layers.length, 1);
  assert.match(store.temporalLayerInstances.sentinel1.source.options.url, /2026/);
  console.log('PASS: out-of-order imagery responses retain only the selected year.');
  store = makeStore();
  const exitPending = store.loadTemporalLayer('sentinel1', true);
  store.clearTemporalLayers(); requests.shift()(services); await exitPending;
  assert.equal(store.layers.length, 0);
  assert.equal(Object.keys(store.temporalLayerEnabled).length, 0);
  console.log('PASS: leaving the temporal module prevents stale layers returning.');
  const source = read(path.join(root, 'src/utils/water-statistics.js'));
  const { normalizeAnnualData, normalizeChangeData } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const annual = normalizeAnnualData({ data: { daily_blue_water_m3: 0, daily_green_water_m3: 15000, daily_water_demand_m3: 15000, cumulative_green_water_m3: 200000, cumulative_water_demand_m3: 300000 } });
  assert.equal(annual.blue, 0); assert.equal(annual.green, 1.5); assert.equal(annual.totalGreen, 20); assert.equal(annual.total, 30); assert.equal(annual.soil, null);
  assert.equal(normalizeChangeData({ available: false, available_years: [2026] }), null);
  const change = normalizeChangeData({ data: { rising_count: 25, falling_count: 50, stable_count: 25, history: [{ year: 2024, value: 123 }] } });
  assert.equal(change.risingRate, 25); assert.equal(change.fallingRate, 50); assert.deepEqual(change.history, [{ year: 2024, value: 123 }]);
  console.log('PASS: water unit conversion, zero values, missing measurements and change history.');
})().catch(error => { console.error(error); process.exitCode = 1; });
