<template>
  <div class="scene-3d">
    <div ref="container" class="scene-canvas"></div>
    <div v-if="loading" class="scene-loading" role="status"><div class="scene-orb"></div><span>正在构建三维地形…</span></div>
    <div v-if="message" class="scene-message" role="status">{{ message }}</div>
    <div class="scene-hint">左键平移 · 右键旋转 · 滚轮缩放</div>
  </div>
</template>
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {transformExtent,toLonLat} from 'ol/proj'
import {unByKey} from 'ol/Observable'
import GeoJSON from 'ol/format/GeoJSON'
import {loadElevation,createLocalTerrain} from '@/utils/local-terrain'
import useMapStore from '@/stores/map'
/* global defineExpose, defineEmits */
const emit=defineEmits(['ready','failed'])
const store=useMapStore(),container=ref(null),loading=ref(true),message=ref('')
let viewer=null,disposed=false,keys=[],syncTimer=null,revision=0,mask=null,initial=null
const resources=new Map()
function alive(){return !disposed && viewer && !viewer.isDestroyed()}
function colour(value,Cesium,fallback){
  if(Array.isArray(value)) return new Cesium.Color(value[0]/255,value[1]/255,value[2]/255,value[3]??1)
  try{return value ? Cesium.Color.fromCssColorString(value) : fallback}catch(error){return fallback}
}
async function syncLayers(){
  if(!alive()) return
  const token=++revision,Cesium=window.Cesium
  resources.forEach(resource=>{if(resource.imagery) viewer.imageryLayers.remove(resource.imagery,true);if(resource.data) viewer.dataSources.remove(resource.data,true)})
  resources.clear()
  if(mask){viewer.scene.primitives.remove(mask);mask=null}
  const layers=store.map.getLayers().getArray().slice().sort((a,b)=>(a.getZIndex()||0)-(b.getZIndex()||0))
  for(const layer of layers){
    if(!layer.getVisible() || layer === store.basinMaskLayer) continue
    const source=layer.getSource?.();if(!source) continue
    try{
      if(source.getParams && source.getUrls){
        const params={...source.getParams()},url=source.getUrls()[0]
        const provider=new Cesium.WebMapServiceImageryProvider({url,layers:params.LAYERS,parameters:{...params,transparent:true,format:'image/png',version:'1.1.1'},tilingScheme:new Cesium.GeographicTilingScheme(),enablePickFeatures:false})
        const imagery=viewer.imageryLayers.addImageryProvider(provider);imagery.alpha=layer.getOpacity();resources.set(layer,{imagery})
      }else if(source.getUrls?.()[0] && /\{[xyz]\}/.test(source.getUrls()[0])){
        const provider=new Cesium.UrlTemplateImageryProvider({url:source.getUrls()[0],maximumLevel:18,credit:layer===store.basicLayer ? 'Esri / ArcGIS' : undefined})
        const imagery=viewer.imageryLayers.addImageryProvider(provider);imagery.alpha=layer.getOpacity();resources.set(layer,{imagery})
      }else if(source.getImageExtent && source.getUrl){
        const rectangle=Cesium.Rectangle.fromDegrees(...transformExtent(source.getImageExtent(),source.getProjection(),'EPSG:4326'))
        const provider=await Cesium.SingleTileImageryProvider.fromUrl(source.getUrl(),{rectangle})
        if(!alive() || token!==revision) return
        const imagery=viewer.imageryLayers.addImageryProvider(provider);imagery.alpha=layer.getOpacity();resources.set(layer,{imagery})
      }else if(source.getFeatures && source.getFeatures().length){
        const features=source.getFeatures(),format=new GeoJSON()
        const data=format.writeFeaturesObject(features,{featureProjection:store.map.getView().getProjection(),dataProjection:'EPSG:4326'})
        const styleOf=feature=>{const fn=layer.getStyleFunction?.();const styles=fn?.(feature,store.map.getView().getResolution());return Array.isArray(styles) ? styles[0] : styles}
        data.features.forEach((feature,index)=>{
          const style=styleOf(features[index]);feature.properties={...feature.properties,__fill:style?.getFill()?.getColor() || null,__stroke:style?.getStroke()?.getColor() || null,__width:style?.getStroke()?.getWidth() || 1}
        })
        const ds=await Cesium.GeoJsonDataSource.load(data,{clampToGround:true,stroke:Cesium.Color.RED,fill:Cesium.Color.TRANSPARENT})
        if(!alive() || token!==revision){ds.destroy?.();return}
        ds.entities.values.forEach(entity=>{
          const fill=entity.properties?.__fill?.getValue(),stroke=entity.properties?.__stroke?.getValue()
          if(entity.polygon){entity.polygon.material=colour(fill,Cesium,Cesium.Color.TRANSPARENT);entity.polygon.outline=false}
          if(entity.polyline){entity.polyline.material=colour(stroke,Cesium,Cesium.Color.RED);entity.polyline.width=entity.properties?.__width?.getValue()||1}
        })
        // Cesium 不支持贴地面的面描边，用贴地线保留原图层的边界。
        data.features.forEach(feature=>{
          const polygons=feature.geometry.type==='Polygon' ? [feature.geometry.coordinates] : feature.geometry.type==='MultiPolygon' ? feature.geometry.coordinates : []
          if(!feature.properties.__stroke) return
          polygons.forEach(polygon=>polygon.forEach(ring=>ds.entities.add({polyline:{positions:Cesium.Cartesian3.fromDegreesArray(ring.flat()),clampToGround:true,width:feature.properties.__width,material:colour(feature.properties.__stroke,Cesium,Cesium.Color.RED)}})))
        })
        viewer.dataSources.add(ds);resources.set(layer,{data:ds})
        if(layer===store.basinBoundaryLayer){
          const holes=[]
          data.features.forEach(feature=>{
            const polygons=feature.geometry.type==='Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
            polygons.forEach(polygon=>holes.push(new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(polygon[0].flat()))))
          })
          if(holes.length){
            mask=viewer.scene.primitives.add(new Cesium.GroundPrimitive({geometryInstances:new Cesium.GeometryInstance({geometry:new Cesium.PolygonGeometry({polygonHierarchy:new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([40,20,120,20,120,65,40,65]),holes),arcType:Cesium.ArcType.RHUMB}),attributes:{color:Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.BLACK.withAlpha(0.55))}}),appearance:new Cesium.PerInstanceColorAppearance({flat:true,translucent:true})}))
          }
        }
      }
    }catch(error){console.warn('三维图层加载失败',error);message.value='部分专题图层暂时不可用，请检查数据服务连接'}
    if(!alive() || token!==revision) return
  }
  viewer.scene.requestRender()
}
function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>{bindLayers();syncLayers()},250)}
let layerKeys=[]
function bindLayers(){
  unByKey(layerKeys);layerKeys=[]
  store.map.getLayers().forEach(layer=>{
    layerKeys.push(layer.on('change:visible',scheduleSync),layer.on('change:source',scheduleSync))
    const source=layer.getSource?.()
    if(source?.on) layerKeys.push(source.on('change',scheduleSync))
  })
}
function target(){
  const C=window.Cesium
  const ray=viewer.camera.getPickRay(new C.Cartesian2(viewer.canvas.clientWidth/2,viewer.canvas.clientHeight/2))
  return viewer.scene.globe.pick(ray,viewer.scene) || C.Cartesian3.fromDegrees(initial.center[0],initial.center[1])
}
function zoom(step){if(alive()){const distance=Math.max(100,viewer.camera.positionCartographic.height*0.35);step>0 ? viewer.camera.zoomIn(distance) : viewer.camera.zoomOut(distance);viewer.scene.requestRender()}}
async function flatten(){
  if(!alive()) return null
  const C=window.Cesium,point=target(),cartographic=C.Cartographic.fromCartesian(point)
  const center=[C.Math.toDegrees(cartographic.longitude),C.Math.toDegrees(cartographic.latitude)]
  const range=C.Cartesian3.distance(viewer.camera.positionWC,point)
  await new Promise(resolve=>viewer.camera.flyToBoundingSphere(new C.BoundingSphere(point,1),{offset:new C.HeadingPitchRange(0,-Math.PI/2,range),duration:1.1,complete:resolve,cancel:resolve}))
  return {center,zoom:Math.max(2,Math.min(19,initial.zoom-Math.log2(range/initial.range)))}
}
defineExpose({zoom,flatten})
onMounted(async()=>{
  try{
    const C=window.Cesium;if(!C) throw new Error('三维引擎未加载，请刷新页面')
    const view=store.map.getView(),center=toLonLat(view.getCenter(),view.getProjection())
    const extent=transformExtent(view.calculateExtent(store.map.getSize()),view.getProjection(),'EPSG:4326')
    const width=(extent[2]-extent[0])*111320*Math.max(0.2,Math.cos(center[1]*Math.PI/180))
    const range=Math.max(800,Math.min(7000000,width/1.1))
    initial={center,zoom:view.getZoom(),range}
    viewer=new C.Viewer(container.value,{baseLayer:false,terrainProvider:new C.EllipsoidTerrainProvider(),animation:false,timeline:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true,maximumRenderTimeChange:Infinity})
    viewer.resolutionScale=Math.min(1,1.5/(window.devicePixelRatio||1))
    viewer.scene.globe.enableLighting=false
    viewer.scene.globe.depthTestAgainstTerrain=true
    viewer.scene.verticalExaggeration=3
    viewer.scene.backgroundColor=C.Color.fromCssColorString('#0a1529')
    viewer.scene.screenSpaceCameraController.minimumZoomDistance=100
    viewer.scene.screenSpaceCameraController.maximumZoomDistance=15000000
    viewer.scene.screenSpaceCameraController.tiltEventTypes=[C.CameraEventType.RIGHT_DRAG,{eventType:C.CameraEventType.LEFT_DRAG,modifier:C.KeyboardEventModifier.CTRL}]
    const point=C.Cartesian3.fromDegrees(...center)
    viewer.camera.lookAt(point,new C.HeadingPitchRange(0,-Math.PI/2,range))
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
    keys.push(store.map.getLayers().on('add',scheduleSync),store.map.getLayers().on('remove',scheduleSync))
    bindLayers();syncLayers()
    try{const raster=await loadElevation();if(!alive()) return;viewer.terrainProvider=createLocalTerrain(C,raster)}catch(error){message.value='高程加载失败，暂时显示三维地球表面'}
    if(!alive()) return
    loading.value=false
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(point,1),{offset:new C.HeadingPitchRange(C.Math.toRadians(-8),C.Math.toRadians(-40),range),duration:2.2,complete:()=>{if(alive()) emit('ready')},cancel:()=>{if(alive()) emit('ready')}})
  }catch(error){message.value=error.message;loading.value=false;emit('failed',error.message)}
})
onBeforeUnmount(()=>{disposed=true;revision++;clearTimeout(syncTimer);unByKey(keys);unByKey(layerKeys);if(viewer && !viewer.isDestroyed()){viewer.camera.cancelFlight();viewer.destroy()}viewer=null})
</script>
<style scoped>
.scene-3d,.scene-canvas{position:absolute;inset:0;background:#0a1529}
.scene-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:15px;background:#0a1529eb;color:#d4e7ff;font-size:13px}
.scene-orb{width:48px;height:48px;border:2px solid #679eff40;border-top-color:#74caff;border-radius:50%;animation:orbit 1.2s linear infinite}
.scene-message{position:absolute;top:16px;left:50%;transform:translateX(-50%);color:#fff;background:#183b65d9;padding:9px 15px;border-radius:8px;font-size:12px;max-width:65%}
.scene-hint{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:20px;background:#102c4380;color:#d2e3f0;font-size:11px;pointer-events:none;white-space:nowrap}
@keyframes orbit{to{transform:rotate(360deg)}}
</style>
