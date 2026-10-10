import { fromArrayBuffer } from 'geotiff'
let rasterPromise
export async function loadElevation() {
  if(!rasterPromise) rasterPromise = fetch('/data/temporal/03_terrain/elevation_m.tif').then(response=>{
    if(!response.ok) throw new Error('高程数据加载失败')
    return response.arrayBuffer()
  }).then(async buffer=>{
    const tiff=await fromArrayBuffer(buffer), image=await tiff.getImage()
    return {values:await image.readRasters({samples:[0],interleave:true}),width:image.getWidth(),height:image.getHeight(),extent:image.getBoundingBox(),noData:image.getGDALNoData()}
  }).catch(error=>{rasterPromise=null;throw error})
  return rasterPromise
}
export function sampleElevation(raster,longitude,latitude) {
  const [west,south,east,north]=raster.extent
  if(longitude<west || longitude>east || latitude<south || latitude>north) return 0
  const x=Math.max(0,Math.min(raster.width-1,(longitude-west)/(east-west)*raster.width-0.5))
  const y=Math.max(0,Math.min(raster.height-1,(north-latitude)/(north-south)*raster.height-0.5))
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,raster.width-1),y1=Math.min(y0+1,raster.height-1)
  const value=(column,row)=>{
    const height=Number(raster.values[row*raster.width+column])
    return Number.isFinite(height) && height!==Number(raster.noData) && Math.abs(height)<10000 ? height : 0
  }
  const top=value(x0,y0)*(1-(x-x0))+value(x1,y0)*(x-x0)
  const bottom=value(x0,y1)*(1-(x-x0))+value(x1,y1)*(x-x0)
  return top*(1-(y-y0))+bottom*(y-y0)
}
export function createLocalTerrain(Cesium,raster) {
  const scheme=new Cesium.GeographicTilingScheme(),size=65
  const error=Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(scheme.ellipsoid,size,scheme.getNumberOfXTilesAtLevel(0))
  return {
    tilingScheme:scheme,errorEvent:new Cesium.Event(),credit:new Cesium.Credit('Mapzen Terrain / SRTM'),hasWaterMask:false,hasVertexNormals:false,availability:undefined,
    getLevelMaximumGeometricError:level=>error/Math.pow(2,level),getTileDataAvailable:(x,y,level)=>level<=12,loadTileDataAvailability:()=>undefined,
    requestTileGeometry:(x,y,level)=>{
      const rectangle=scheme.tileXYToRectangle(x,y,level),buffer=new Float32Array(size*size)
      for(let row=0;row<size;row++) for(let column=0;column<size;column++){
        const longitude=Cesium.Math.toDegrees(rectangle.west+(rectangle.east-rectangle.west)*column/(size-1))
        const latitude=Cesium.Math.toDegrees(rectangle.north-(rectangle.north-rectangle.south)*row/(size-1))
        buffer[row*size+column]=sampleElevation(raster,longitude,latitude)
      }
      return Promise.resolve(new Cesium.HeightmapTerrainData({buffer,width:size,height:size,childTileMask:level<12 ? 15 : 0}))
    }
  }
}
