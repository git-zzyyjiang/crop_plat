<template>
  <div class="scene-3d">
    <div ref="container" class="scene-canvas"></div>
    <div v-if="loading" class="scene-loading" role="status"><div class="scene-orb"></div><span>正在构建三维地形…</span></div>
    <div v-if="message" class="scene-message" role="status">{{ message }}</div>
    <div v-if="sketch" class="scene-sketch" :style="sketch"></div>
    <div class="scene-hint">{{ drawing ? '左键画框 · 按住选框边缘移动 · 滚轮缩放' : roiActive ? '按住边框移动选区 · 其他位置平移地图 · 滚轮缩放' : '左键平移 · 右键旋转 · 滚轮缩放' }}</div>
  </div>
</template>
<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount} from 'vue'
import {transformExtent,toLonLat} from 'ol/proj'
import {unByKey} from 'ol/Observable'
import GeoJSON from 'ol/format/GeoJSON'
import {loadElevation,createLocalTerrain} from '@/utils/local-terrain'
import useMapStore from '@/stores/map'
import {renderParcelFrame,screenBoxExtent,nearTerrainRoiEdge} from '@/utils/parcel-scene'
import {createParcelTerrainMaterial,materialBounds} from '@/utils/parcel-terrain-material'
/* global defineExpose, defineEmits */
const emit=defineEmits(['ready','failed'])
const store=useMapStore(),container=ref(null),loading=ref(true),message=ref('')
let viewer=null,disposed=false,failed=false,removeRenderError=null,keys=[],syncTimer=null,revision=0,mask=null,initial=null
const resources=new Map()
const sketch=ref(null)
const drawing=computed(()=>store.parcelIdentifyEnabled && store.parcelRoiState!=='idle' && store.parcelRoiMode==='draw')
const roiActive=computed(()=>store.parcelIdentifyEnabled && store.parcelRoiState!=='idle')
let gesture=null,parcelMaterial=null,parcelKey=null,parcelLayer=null,frameTimer=null
let parcelVectorFallback=false,parcelDataSource=null,roiEntity=null,parcelFrameRevision=0
function managedParcelLayer(layer){return store.parcelIdentifyEnabled && [store.parcelIdentifyLayer,store.parcelIdentifySeedLayer,store.parcelRoiMaskLayer,store.parcelRoiOutlineLayer,store.parcelRoiSketchLayer].includes(layer)}
function syncParcelMaterial(){
  if(!alive()) return
  const needsMaterial=store.parcelIdentifyEnabled && store.parcelPageMode==='identify'
  if(needsMaterial && !parcelMaterial && !parcelVectorFallback){
    const gl=viewer.scene.context?._gl
    const textureUnits=gl?.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 16
    // Cesium 的地球着色器会占用绝大多数纹理单元。低规格显卡再叠加
    // Canvas 材质会链接失败，因此改用贴地矢量展示识别帧。
    if(textureUnits <= 16){
      parcelVectorFallback=true
    }else{
      const emptyImage=document.createElement('canvas');emptyImage.width=1;emptyImage.height=1
      parcelMaterial=createParcelTerrainMaterial(window.Cesium,emptyImage)
      viewer.scene.globe.material=parcelMaterial
    }
    syncRoi();bindParcelLayer()
  }else if(!needsMaterial && (parcelMaterial || parcelVectorFallback)){
    cancelAnimationFrame(frameTimer);frameTimer=null
    unByKey(parcelKey);parcelKey=null;parcelLayer=null
    viewer.scene.globe.material=undefined
    parcelMaterial?.destroy();parcelMaterial=null
    parcelVectorFallback=false;parcelFrameRevision++
    if(parcelDataSource){viewer.dataSources.remove(parcelDataSource,true);parcelDataSource=null}
    if(roiEntity){viewer.entities.remove(roiEntity);roiEntity=null}
  }
  viewer.scene.requestRender()
}
function pickGround(pixel){
  if(!alive()) return null
  const C=window.Cesium,ray=viewer.camera.getPickRay(new C.Cartesian2(...pixel))
  const point=ray && viewer.scene.globe.pick(ray,viewer.scene)
  if(!point) return null
  const cartographic=C.Cartographic.fromCartesian(point)
  return [C.Math.toDegrees(cartographic.longitude),C.Math.toDegrees(cartographic.latitude)]
}
function geographicRoi(){return store.parcelRoiExtent && transformExtent(store.parcelRoiExtent,store.map.getView().getProjection(),'EPSG:4326')}
function setVectorRoi(extent){
  if(!alive() || !parcelVectorFallback) return
  const C=window.Cesium
  if(roiEntity){viewer.entities.remove(roiEntity);roiEntity=null}
  if(extent){
    const ring=[extent[0],extent[1],extent[2],extent[1],extent[2],extent[3],extent[0],extent[3],extent[0],extent[1]]
    roiEntity=viewer.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArray(ring),clampToGround:true,width:2,material:C.Color.RED}})
  }
  viewer.scene.requestRender()
}
function syncRoi(){
  if(!alive()) return
  const extent=geographicRoi()
  if(parcelVectorFallback){setVectorRoi(extent && store.parcelIdentifyEnabled ? extent : null);return}
  if(!parcelMaterial) return
  parcelMaterial.uniforms.roiEnabled=extent && store.parcelIdentifyEnabled ? 1 : 0
  if(extent) parcelMaterial.uniforms.roiBounds=materialBounds(window.Cesium,extent)
  viewer.scene.requestRender()
}
function cancelGesture(){
  gesture=null;sketch.value=null
  if(alive() && viewer.scene.screenSpaceCameraController) viewer.scene.screenSpaceCameraController.enableInputs=true
  if(alive() && parcelMaterial){parcelMaterial.uniforms.previewEnabled=0;viewer.scene.requestRender()}
  if(alive() && parcelVectorFallback) syncRoi()
}
function cameraMode(){
  if(!alive()) return
  cancelGesture()
  const controller=viewer.scene.screenSpaceCameraController
  controller.enableTranslate=!drawing.value;controller.enableRotate=!drawing.value;controller.enableTilt=!drawing.value;controller.enableLook=!drawing.value
  viewer.canvas.style.cursor=drawing.value ? 'crosshair' : 'grab'
}
function pixelOf(event){const rect=viewer.canvas.getBoundingClientRect();return [event.clientX-rect.left,event.clientY-rect.top]}
function projectGround(coordinate){
  const C=window.Cesium
  // getHeight 已返回渲染表面（包含高程夸张）的高度，不能再乘三倍。
  const height=viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(...coordinate))
  if(height===undefined) return null
  const point=C.Cartesian3.fromDegrees(...coordinate,height)
  const projected=C.SceneTransforms.worldToWindowCoordinates(viewer.scene,point)
  return projected && [projected.x,projected.y]
}
function pointerDown(event){
  if(!roiActive.value || loading.value || event.button!==0) return
  const pixel=pixelOf(event),ground=pickGround(pixel)
  if(!ground){if(drawing.value) message.value='请在可见地形上画框';return}
  const extent=geographicRoi()
  const onEdge=extent && nearTerrainRoiEdge(pixel,ground,extent,projectGround)
  if(!drawing.value && !onEdge) return
  viewer.camera.cancelFlight();message.value=''
  gesture={id:event.pointerId,start:pixel,ground,extent:onEdge ? extent : null,next:null}
  if(viewer.scene?.screenSpaceCameraController) viewer.scene.screenSpaceCameraController.enableInputs=false
  viewer.canvas.setPointerCapture(event.pointerId)
  event.preventDefault();event.stopPropagation()
}
function pointerMove(event){
  const pixel=pixelOf(event)
  if(!gesture){
    if(roiActive.value){
      const extent=geographicRoi(),ground=pickGround(pixel)
      viewer.canvas.style.cursor=extent && ground && nearTerrainRoiEdge(pixel,ground,extent,projectGround) ? 'move' : drawing.value ? 'crosshair' : 'grab'
    }
    return
  }
  if(gesture.id!==event.pointerId) return
  if(gesture.extent){
    const ground=pickGround(pixel)
    gesture.next=ground && gesture.extent.map((value,index)=>value+ground[index%2]-gesture.ground[index%2])
    if(parcelMaterial){
      parcelMaterial.uniforms.previewEnabled=gesture.next ? 1 : 0
      if(gesture.next) parcelMaterial.uniforms.previewBounds=materialBounds(window.Cesium,gesture.next)
      viewer.scene.requestRender()
    }else if(parcelVectorFallback && gesture.next) setVectorRoi(gesture.next)
  }else{
    sketch.value={left:Math.min(pixel[0],gesture.start[0])+'px',top:Math.min(pixel[1],gesture.start[1])+'px',width:Math.abs(pixel[0]-gesture.start[0])+'px',height:Math.abs(pixel[1]-gesture.start[1])+'px'}
  }
  event.preventDefault();event.stopPropagation()
}
function pointerUp(event){
  if(!gesture || gesture.id!==event.pointerId) return
  const pixel=pixelOf(event)
  const moved=Math.hypot(pixel[0]-gesture.start[0],pixel[1]-gesture.start[1])>=8
  const extent=gesture.extent ? (moved ? gesture.next : null) : screenBoxExtent(gesture.start,pixel,pickGround)
  cancelGesture()
  if(viewer.canvas.hasPointerCapture(event.pointerId)) viewer.canvas.releasePointerCapture(event.pointerId)
  if(extent){store.applyParcelRoi(transformExtent(extent,'EPSG:4326',store.map.getView().getProjection()));syncRoi()}
  else if(moved) message.value='选框需全部位于可见地形上，请缩小范围后重试'
  event.preventDefault();event.stopPropagation()
}
// 保持同一地形材质，直接更新 Canvas 纹理；不删除影像，不触发地形瓦片重建。
async function updateParcelVectorFrame(layer){
  const token=++parcelFrameRevision,C=window.Cesium
  try{
    const styleFunction=layer.getStyleFunction(),resolution=store.map.getView().getResolution()
    const features=layer.getSource().getFeatures().map(feature=>{
      const result=styleFunction?.(feature,resolution),styles=Array.isArray(result) ? result : [result]
      const style=styles.find(Boolean),geometry=style?.getGeometryFunction?.()(feature)
      if(!geometry) return null
      const clone=feature.clone();clone.setGeometry(geometry.clone());return clone
    }).filter(Boolean)
    const data=new GeoJSON().writeFeaturesObject(features,{featureProjection:store.map.getView().getProjection(),dataProjection:'EPSG:4326'})
    const ds=await C.GeoJsonDataSource.load(data,{clampToGround:true,stroke:C.Color.RED,fill:C.Color.RED.withAlpha(.28),markerColor:C.Color.RED,markerSize:5})
    if(!alive() || token!==parcelFrameRevision){ds.destroy?.();return}
    if(parcelDataSource) viewer.dataSources.remove(parcelDataSource,true)
    viewer.dataSources.add(ds);parcelDataSource=ds;viewer.scene.requestRender()
  }catch(error){console.warn('三维矢量识别帧更新失败',error);message.value='三维识别结果暂时无法显示，请切换二维查看'}
}
function updateParcelFrame(){
  if(!alive()) return
  const layer=store.parcelIdentifyLayer || store.parcelIdentifySeedLayer
  if(!layer) return
  if(parcelVectorFallback){updateParcelVectorFrame(layer);return}
  if(!parcelMaterial) return
  try{
    const {canvas,extent}=renderParcelFrame(layer,store.map.getView().getProjection(),store.map.getView().getResolution())
    parcelMaterial.uniforms.parcelBounds=materialBounds(window.Cesium,extent)
    parcelMaterial.uniforms.parcelImage=canvas
    parcelMaterial.uniforms.parcelEnabled=1
    viewer.scene.requestRender()
  }catch(error){console.warn('三维识别动画更新失败',error);message.value='三维识别结果暂时无法显示，请切换二维查看'}
}
function scheduleParcelFrame(){if(!frameTimer) frameTimer=requestAnimationFrame(()=>{frameTimer=null;updateParcelFrame()})}
function bindParcelLayer(){
  const layer=store.parcelIdentifyLayer || store.parcelIdentifySeedLayer
  if(!alive() || parcelLayer===layer) return
  unByKey(parcelKey);parcelKey=null;parcelLayer=layer
  if(parcelMaterial){parcelMaterial.uniforms.parcelEnabled=0;viewer.scene.requestRender()}
  if(parcelLayer){parcelKey=parcelLayer.on('change',scheduleParcelFrame);scheduleParcelFrame()}
}
watch(()=>[store.parcelRoiState,store.parcelRoiMode,store.parcelIdentifyEnabled],()=>{cameraMode();syncRoi()})
watch(()=>store.parcelRoiExtent,()=>{cancelGesture();syncRoi()})
watch(()=>[store.parcelIdentifyLayer,store.parcelIdentifySeedLayer],bindParcelLayer)
watch(()=>[store.parcelPageMode,store.parcelIdentifyEnabled],()=>{
  try{syncParcelMaterial()}catch(error){handleSceneFailure(error)}
})
function alive(){return !disposed && viewer && !viewer.isDestroyed()}
function handleSceneFailure(error){
  if(disposed || failed) return
  failed=true
  const detail=error?.message || String(error || '未知渲染错误')
  console.error('农业地块三维场景失败',error)
  message.value=detail;loading.value=false
  emit('failed',detail)
}
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
    if(!layer.getVisible() || layer === store.basinMaskLayer || managedParcelLayer(layer)) continue
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
function scheduleSync(event){
  if(event?.element && managedParcelLayer(event.element)) return
  clearTimeout(syncTimer);syncTimer=setTimeout(()=>{bindLayers();syncLayers()},250)
}
let layerKeys=[]
function bindLayers(){
  unByKey(layerKeys);layerKeys=[]
  store.map.getLayers().forEach(layer=>{
    if(managedParcelLayer(layer)) return
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
    // 渲染循环的异常发生在异步帧中，初始化的 try/catch 捕获不到。
    removeRenderError=viewer.scene.renderError.addEventListener((scene,error)=>handleSceneFailure(error))
    viewer.resolutionScale=Math.min(1,1.5/(window.devicePixelRatio||1))
    viewer.scene.globe.enableLighting=false
    viewer.scene.globe.depthTestAgainstTerrain=true
    viewer.scene.verticalExaggeration=3
    syncParcelMaterial()
    viewer.scene.backgroundColor=C.Color.fromCssColorString('#0a1529')
    viewer.scene.screenSpaceCameraController.minimumZoomDistance=100
    viewer.scene.screenSpaceCameraController.maximumZoomDistance=15000000
    viewer.scene.screenSpaceCameraController.tiltEventTypes=[C.CameraEventType.RIGHT_DRAG,{eventType:C.CameraEventType.LEFT_DRAG,modifier:C.KeyboardEventModifier.CTRL}]
    viewer.canvas.addEventListener('pointerdown',pointerDown,true)
    viewer.canvas.addEventListener('pointermove',pointerMove,true)
    viewer.canvas.addEventListener('pointerup',pointerUp,true)
    viewer.canvas.addEventListener('pointercancel',cancelGesture,true)
    cameraMode();syncRoi();bindParcelLayer()
    const point=C.Cartesian3.fromDegrees(...center)
    viewer.camera.lookAt(point,new C.HeadingPitchRange(0,-Math.PI/2,range))
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
    keys.push(store.map.getLayers().on('add',scheduleSync),store.map.getLayers().on('remove',scheduleSync))
    bindLayers();syncLayers()
    try{const raster=await loadElevation();if(!alive()) return;viewer.terrainProvider=createLocalTerrain(C,raster)}catch(error){message.value='高程加载失败，暂时显示三维地球表面'}
    if(!alive()) return
    loading.value=false
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(point,1),{offset:new C.HeadingPitchRange(C.Math.toRadians(-8),C.Math.toRadians(-40),range),duration:2.2,complete:()=>{if(alive()) emit('ready')},cancel:()=>{if(alive()) emit('ready')}})
  }catch(error){handleSceneFailure(error)}
})
onBeforeUnmount(()=>{
  disposed=true;revision++;clearTimeout(syncTimer);cancelAnimationFrame(frameTimer)
  removeRenderError?.();removeRenderError=null
  unByKey(parcelKey);unByKey(keys);unByKey(layerKeys)
  if(viewer && !viewer.isDestroyed()){
    viewer.canvas.removeEventListener('pointerdown',pointerDown,true)
    viewer.canvas.removeEventListener('pointermove',pointerMove,true)
    viewer.canvas.removeEventListener('pointerup',pointerUp,true)
    viewer.canvas.removeEventListener('pointercancel',cancelGesture,true)
    viewer.scene.globe.material=undefined
    parcelMaterial?.destroy()
    if(parcelDataSource) viewer.dataSources.remove(parcelDataSource,true)
    if(roiEntity) viewer.entities.remove(roiEntity)
    viewer.camera.cancelFlight();viewer.destroy()
  }
  viewer=null;parcelMaterial=null;parcelDataSource=null;roiEntity=null
})
</script>
<style scoped>
.scene-3d,.scene-canvas{position:absolute;inset:0;background:#0a1529}
.scene-sketch{position:absolute;pointer-events:none;border:2px solid red;background:#ff000018;box-sizing:border-box}
.scene-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:15px;background:#0a1529eb;color:#d4e7ff;font-size:13px}
.scene-orb{width:48px;height:48px;border:2px solid #679eff40;border-top-color:#74caff;border-radius:50%;animation:orbit 1.2s linear infinite}
.scene-message{position:absolute;top:16px;left:50%;transform:translateX(-50%);color:#fff;background:#183b65d9;padding:9px 15px;border-radius:8px;font-size:12px;max-width:65%}
.scene-hint{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:20px;background:#102c4380;color:#d2e3f0;font-size:11px;pointer-events:none;white-space:nowrap}
@keyframes orbit{to{transform:rotate(360deg)}}
</style>
