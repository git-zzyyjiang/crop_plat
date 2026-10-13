import proj4 from 'proj4'

export const GRID_CRS = '+proj=aea +lat_1=43 +lat_2=46 +lat_0=44 +lon_0=80 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
export const COUNT_BINS = [500, 1200, 2500, 4000]
export const AREA_BINS = [10, 30, 60, 100]
export const COLORS = ['#e8f4b5', '#b8dd69', '#79c34d', '#e6bd48', '#ec8542']
export const CHANGE_COLORS = ['#2166ac', '#92c5de', '#eeeeee', '#f4a582', '#b2182b']
export const classify = (value, breaks) => breaks.filter(limit => value >= limit).length

export function analyzeServerGrid(features) {
  const grid = features.map(feature => {
    const value = name => Number(feature.get(name))
    const cell = {geometry:feature.getGeometry(),id:value('GRID_ID'),gx:value('GX'),gy:value('GY'),
      count:value('N_PARCEL'),area:value('SUM_HA'),meanArea:value('MEAN_HA'),
      density:value('DEN_KM2'),km2:value('GRID_KM2'),countClass:value('COUNT_CLS'),areaClass:value('AREA_CLS'),
      perimeter:value('PERIM_KM'),shapeSum:value('SHAPE_SUM'),weightedShape:value('WSHAPE_SUM'),
      cx:value('CX_SUM'),cy:value('CY_SUM'),nnSum:value('NN_SUM'),nnCount:value('NN_N')}
    if (!['Polygon','MultiPolygon'].includes(cell.geometry?.getType()) ||
        !Object.values(cell).filter(item=>typeof item === 'number').every(Number.isFinite) ||
        !Number.isInteger(cell.gx) || !Number.isInteger(cell.gy) || cell.km2 !== 100 ||
        cell.count <= 0 || cell.area <= 0 || cell.countClass !== classify(cell.count,COUNT_BINS)+1 ||
        cell.areaClass !== classify(cell.meanArea,AREA_BINS)+1) {
      throw new Error('服务器网格版本或统计字段无效，请检查数据同步')
    }
    return {...cell,key:`${cell.gx},${cell.gy}`}
  })
  if(new Set(grid.map(cell=>cell.key)).size !== grid.length) throw new Error('服务器返回重复网格')
  return {grid}
}

export function summarizeGrid(grid) {
  const sum = key => grid.reduce((total,cell)=>total+cell[key],0)
  const count=sum('count'),totalArea=sum('area'),scope=sum('km2'),nnCount=sum('nnCount')
  const occupied=grid.filter(cell=>cell.count>0),byKey=new Map(occupied.map(cell=>[cell.key,cell]))
  const neighbors=cell=>[[cell.gx-1,cell.gy],[cell.gx+1,cell.gy],[cell.gx,cell.gy-1],[cell.gx,cell.gy+1]].map(([x,y])=>`${x},${y}`)
  const adjacency=occupied.reduce((total,cell)=>total+neighbors(cell).filter(key=>byKey.has(key)).length,0)
  const visited=new Set(),components=[]
  for(const cell of occupied){
    if(visited.has(cell.key)) continue
    const queue=[cell.key],component=[];visited.add(cell.key)
    for(let index=0;index<queue.length;index++){
      const current=byKey.get(queue[index]);component.push(current.key)
      for(const key of neighbors(current)) if(byKey.has(key) && !visited.has(key)){visited.add(key);queue.push(key)}
    }
    components.push(component)
  }
  const connectedKeys=new Set(components.filter(component=>component.length>1).flat())
  const fragmentation=occupied.map(cell=>cell.count/cell.area).sort((a,b)=>a-b)
  const hotspotThreshold=fragmentation.length ? fragmentation[Math.ceil(fragmentation.length*0.8)-1] : null
  const hotspotKeys=new Set(occupied.filter(cell=>fragmentation[0] < fragmentation[fragmentation.length-1] && cell.count/cell.area >= hotspotThreshold).map(cell=>cell.key))
  return {grid,count,totalArea,scope,meanArea:count ? totalArea/count : null,density:scope ? count/scope : null,
    boundaryDensity:scope ? sum('perimeter')/scope : null,meanShape:count ? sum('shapeSum')/count : null,
    weightedShape:totalArea ? sum('weightedShape')/totalArea : null,meanNearest:nnCount ? sum('nnSum')/nnCount : null,
    center:totalArea ? proj4(GRID_CRS,'EPSG:4326',[sum('cx')/totalArea,sum('cy')/totalArea]) : null,
    adjacencyRate:occupied.length ? adjacency/(4*occupied.length)*100 : null,
    connectedKeys,hotspotKeys,hotspotThreshold,components:components.length,occupiedCount:occupied.length}
}

// Annual empty cells are zero-filled on the same three-year union grid, keeping denominators fixed.
export function alignAnnualGrids(annual) {
  const union=new Map()
  for(const result of Object.values(annual)) for(const cell of result.grid) union.set(cell.key,cell)
  return Object.fromEntries(Object.entries(annual).map(([year,result])=>{
    const existing=new Map(result.grid.map(cell=>[cell.key,cell]))
    const grid=[...union.values()].map(template=>existing.get(template.key) || {
      ...template,count:0,area:0,meanArea:null,density:0,countClass:0,areaClass:0,
      perimeter:0,shapeSum:0,weightedShape:0,cx:0,cy:0,nnSum:0,nnCount:0})
    return [year,summarizeGrid(grid)]
  }))
}

export function compareGridYears(before, after) {
  if(!before || !after) return null
  const old=new Map(before.grid.map(cell=>[cell.key,cell]))
  return after.grid.map(cell=>({ ...cell, countDelta:cell.count-(old.get(cell.key)?.count || 0),
    areaDelta:cell.area-(old.get(cell.key)?.area || 0)}))
}

export function changeClass(value, tolerance) {
  if(Math.abs(value)<=tolerance) return 2
  if(value<0) return value < -10*tolerance ? 0 : 1
  return value > 10*tolerance ? 4 : 3
}
