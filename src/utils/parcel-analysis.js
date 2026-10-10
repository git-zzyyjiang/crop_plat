import { getArea, getLength } from 'ol/sphere'
import Polygon from 'ol/geom/Polygon'
import MultiLineString from 'ol/geom/MultiLineString'

export const DENSITY_BINS = [5, 12, 25, 40]
export const AREA_BINS = [1, 5, 10, 25]
export const COLORS = ['#e8f4b5', '#b8dd69', '#79c34d', '#e6bd48', '#ec8542']
export const CHANGE_COLORS = { stable:'#dfe8f2', expanded:'#5cc46a', shrunk:'#e8a33f', added:'#4a90e2', removed:'#d9534f' }
export const classify = (value, breaks) => breaks.findIndex(limit => value < limit) < 0 ? breaks.length : breaks.findIndex(limit => value < limit)
export function analyzeParcels(features, extent, idField) {
  const cells = new Map(), records = []
  let area = 0, perimeter = 0, weightedX = 0, weightedY = 0
  for (const feature of features) {
    const geometry = feature.getGeometry()
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.getType())) continue
    const polygons = geometry.getType() === 'Polygon' ? [geometry.getCoordinates()] : geometry.getCoordinates()
    const hectares = Math.abs(getArea(geometry, {projection:'EPSG:4326'})) / 10000
    if (!Number.isFinite(hectares) || hectares <= 0) continue
    // 网格归属采用面积最大的组成面的内部点，避免多部件地块重复计数。
    const largest = polygons.reduce((best, ring) => {
      const polygon = new Polygon(ring)
      return !best || getArea(polygon,{projection:'EPSG:4326'}) > getArea(best,{projection:'EPSG:4326'}) ? polygon : best
    }, null)
    const point = largest.getInteriorPoint().getCoordinates().slice(0,2)
    if (point[0] < extent[0] || point[0] >= extent[2] || point[1] < extent[1] || point[1] >= extent[3]) continue
    const key = `${Math.floor(point[0]/0.05)},${Math.floor(point[1]/0.05)}`
    if (!cells.has(key)) cells.set(key,{x:Math.floor(point[0]/0.05)*0.05,y:Math.floor(point[1]/0.05)*0.05,count:0,area:0})
    const cell = cells.get(key); cell.count++; cell.area += hectares
    const boundary = getLength(new MultiLineString(polygons.flat()),{projection:'EPSG:4326'}) / 1000
    area += hectares; perimeter += boundary
    weightedX += point[0]*hectares; weightedY += point[1]*hectares
    records.push({feature, hectares, id:idField ? feature.get(idField) : null})
  }
  const grid = [...cells.values()].map(cell => {
    const ring = [[cell.x,cell.y],[cell.x+0.05,cell.y],[cell.x+0.05,cell.y+0.05],[cell.x,cell.y+0.05],[cell.x,cell.y]]
    const geometry = new Polygon([ring])
    const km2 = getArea(geometry,{projection:'EPSG:4326'}) / 1e6
    return {...cell,geometry,density:cell.count/km2,meanArea:cell.area/cell.count}
  })
  const scope = getArea(new Polygon([[[extent[0],extent[1]],[extent[2],extent[1]],[extent[2],extent[3]],[extent[0],extent[3]],[extent[0],extent[1]]]]),{projection:'EPSG:4326'}) / 1e6
  return {records,grid,count:records.length,totalArea:area,meanArea:records.length ? area/records.length : null,
    density:scope ? records.length/scope : null,boundaryDensity:scope ? perimeter/scope : null,
    center:area ? [weightedX/area,weightedY/area] : null,scope}
}
export function compareParcels(before, after) {
  const valid = records => records.every(r => r.id !== null && r.id !== undefined) && new Set(records.map(r=>String(r.id))).size === records.length
  if (!valid(before.records) || !valid(after.records)) return null
  const old = new Map(before.records.map(r=>[String(r.id),r]))
  const changes = after.records.map(record => {
    const previous = old.get(String(record.id)); old.delete(String(record.id))
    const ratio = previous ? (record.hectares-previous.hectares)/previous.hectares : null
    return {...record,kind:!previous ? 'added' : ratio >= 0.05 ? 'expanded' : ratio <= -0.05 ? 'shrunk' : 'stable'}
  })
  return [...changes,...[...old.values()].map(record=>({...record,kind:'removed'}))]
}
