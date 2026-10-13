<template>
  <div id="mapView" @wheel="handleScroll" ref="mapDom" class="map-container" :class="{ 'roi-panning': roiActive && parcelRoiMode === 'pan' }">


    <!-- 3D 地球视图 -->
    <div 
      v-if="!is2D"
      class="cesium-overlay"
    >
      <map-scene-3d ref="scene3d" @ready="switching = false" @failed="handle3DFailure"/>
    </div>
    <div v-if="sceneError" class="scene-error" role="status">{{ sceneError }}</div>


    <!-- 指北针 -->
    <svg v-if="showCompass" class="map-compass" viewBox="0 0 48 60" aria-hidden="true">
      <path d="M24 6 31 40 24 34 17 40Z" fill="#fff" stroke="rgba(10,40,90,.55)" stroke-width="1"/>
      <text x="24" y="56" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">N</text>
    </svg>

    <div v-if="showMapTools && (is2D || store.parcelIdentifyEnabled) && roiActive" class="roi-mode-switch" @pointerdown.stop @click.stop @dblclick.stop>
      <div class="roi-mode-buttons" role="group" aria-label="框选操作模式">
        <button type="button" :aria-pressed="parcelRoiMode === 'draw'" @click="store.setParcelRoiMode('draw')">画框</button>
        <button type="button" :aria-pressed="parcelRoiMode === 'pan'" @click="store.setParcelRoiMode('pan')">拖动地图</button>
        <button
          v-if="parcelRoiState === 'applied'"
          type="button"
          class="roi-cancel"
          @click="cancelParcelRoi"
        >取消框选</button>
      </div>
      <p aria-live="polite">{{ roiHint }}</p>
    </div>

    <!-- 右侧工具条：2D/3D、缩放、全屏、框选 -->
    <div class="map-tools">
      <button
        class="map-tool primary"
        type="button"
        :title="is2D ? '切换到3D视图' : '切换到2D视图'"
        @click="toggle2D3D"
        :disabled="switching"
        :aria-busy="switching"
      >{{ is2D ? '2D' : '3D' }}</button>
      <button class="map-tool" type="button" title="放大" @click="zoomBy(1)">+</button>
      <button class="map-tool" type="button" title="缩小" @click="zoomBy(-1)">−</button>
      <button class="map-tool" type="button" title="全屏显示" @click="toggleFullscreen">
        <pi-icon name="expand"/>
      </button>
    </div>

    <!-- 比例尺 -->
    <div class="map-scalebar">
      <span>0</span>
      <span class="map-scalebar-bar"></span>
      <span>100 km</span>
    </div>

    <!-- 地区选择 -->
    <region-select v-show="showMapTools && is2D" />


  </div>
</template>
<script setup>
import {storeToRefs} from "pinia";
import {getCurrentInstance, onBeforeUnmount, onMounted, ref, computed, watch} from "vue";
import {Control} from "ol/control";
import {useRoute} from "vue-router";
import useMapStore from "@/stores/map";
import MapScene3d from "@/components/map-scene-3d.vue";
import {fromLonLat} from "ol/proj";
import RegionSelect from "@/components/part/region-select.vue";
import PiIcon from "@/components/part/pi-icon.vue";
import 'animate.css';

const store = useMapStore()
const route = useRoute()
let {map,yearPlayer,monthPlayer,isMonthPlaying,isYearPlaying,is3D,parcelRoiState,parcelRoiMode} = storeToRefs(store)

// 2D/3D 切换状态，使用 store 中的 is3D 以保持开关状态在组件重建时不丢失
const is2D = computed(() => !is3D.value)

const scene3d = ref(null)
const switching = ref(false)
const sceneError = ref('')
let switchRevision = 0
watch(is3D, () => store.syncRiverAnimationWith3D())
const resetScene = () => { switchRevision++; is3D.value = false; switching.value = false }
watch(() => route.name, () => { resetScene(); sceneError.value = '' })
// 农业地块支持在三维地形上框选，其他专题仍使用二维框选。
watch(parcelRoiState, state => { if (state === 'drawing' && is3D.value && !store.parcelIdentifyEnabled) resetScene() })
const handle3DFailure = message => {
  is3D.value = false
  switching.value = false
  sceneError.value = `三维视图打开失败：${message}`
}

// 指北针只在首页和时空数据页显示（与原型一致）
const showCompass = computed(() => ['home', 'timeSeriesData'].includes(route.name))

const mapDom = ref(null)

const zoomBy = step => {
  if (!is2D.value) { scene3d.value?.zoom(step); return }
  const view = map.value && map.value.getView && map.value.getView()
  if (!view) return
  view.animate({zoom: (view.getZoom() || 0) + step, duration: 200})
}

const toggleFullscreen = () => {
  const el = mapDom.value || (map.value && map.value.getTargetElement && map.value.getTargetElement())
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen && document.exitFullscreen()
  } else if (el.requestFullscreen) {
    el.requestFullscreen()
  }
}

// 框选截取和地区选择目前支持这几个页面
const MAP_TOOL_ROUTES = ['agriParcel', 'cropClassification']
const showMapTools = computed(() => MAP_TOOL_ROUTES.includes(route.name))
const roiActive = computed(() => parcelRoiState.value !== 'idle')
const roiHint = computed(() => {
  if (parcelRoiMode.value === 'pan') {
    return parcelRoiState.value === 'applied' ? '拖动地图查看其他位置，已有选框保留' : '拖动地图查看区域，需要识别时点击“画框”'
  }
  return '拖动画框，按住选框边缘可移动选区'
})

const cancelParcelRoi = () => {
  store.clearParcelRoi()
  store.startParcelRoiDraw()
  store.setParcelRoiMode('pan')
}

// 处理滚轮事件，停止播放动画
const handleScroll = function (){
    if (Object.getOwnPropertyNames(yearPlayer.value).length !== 1) {
      clearInterval(yearPlayer.value)
      isYearPlaying.value = false
    }
    if (Object.getOwnPropertyNames(monthPlayer.value).length !== 1) {
      clearInterval(monthPlayer.value)
      isMonthPlaying.value = false
    }
  }

// 2D/3D 切换函数
const toggle2D3D = async () => {
  if (switching.value) return
  sceneError.value = ''
  const revision = ++switchRevision
  switching.value = true
  if (is2D.value) {
    if (!store.parcelIdentifyEnabled) store.clearParcelRoi(false)
    store.stopParcelTimelinePlay()
    is3D.value = true
  } else {
    try {
      const snapshot = await scene3d.value?.flatten()
      if (revision !== switchRevision) return
      if (snapshot && map.value?.getView) {
        map.value.getView().setCenter(fromLonLat(snapshot.center,map.value.getView().getProjection()))
        map.value.getView().setZoom(snapshot.zoom)
      }
    } finally {
      if (revision === switchRevision) {
        is3D.value = false
        switching.value = false
        map.value?.updateSize()
      }
    }
  }
}

let pageInstance = getCurrentInstance()
  onMounted(()=>{
    let timer = {}
    store.initMap()
    store.addBasicLayer()
    

    
    let tip = document.createElement('div')
    tip.id='tip'
    tip.style='height:25px;width:60px;left:50px;top:25px;position:absolute;display:none;background-color:white;border:1px solid black;line-height:25px;text-align:center'
    tip.innerHTML='hello'
    let fullMap = document.createElement('div')
    fullMap.style='height:20px;width:20px;background-color: #F0F0F0;position:absolute;left:50px;top:0;'
    let pic1 = document.createElement('img')
    pic1.src='/img/earth.png'
    pic1.style='height:100%;width:100%';
    fullMap.appendChild(pic1)
    fullMap.onclick=()=>{
      map.value.getView().setZoom(12.7)
    }
    fullMap.onmouseover=()=>{
      timer = setTimeout(()=>{
        document.getElementById('tip').style.display='block'
        document.getElementById('tip').innerHTML='地图'
        document.getElementById('tip').style.left='50px'
      },1500)
    }
    fullMap.onmouseleave=()=>{
      clearTimeout(timer)
      document.getElementById('tip').style.display='none'
    }

    let rasterMap=document.createElement('div')
    rasterMap.id='1'
    rasterMap.style='height:20px;width:20px;background-color: #F0F0F0;position:absolute;left:75px;top:0;'
    let pic2 = document.createElement('img')
    pic2.src='/img/grid.png'
    pic2.style='height:100%;width:100%';
    rasterMap.appendChild(pic2)
    rasterMap.onclick=()=>{
      map.value.getView().setZoom(14.1)
    }
    rasterMap.onmouseover=()=>{
      timer = setTimeout(()=>{
        document.getElementById('tip').style.display='block'
        document.getElementById('tip').innerHTML='栅格'
        document.getElementById('tip').style.left='75px'
      },1500)

    }
    rasterMap.onmouseleave=()=>{
      clearTimeout(timer)
      document.getElementById('tip').style.display='none'
    }
    let hand = document.createElement('div')
    hand.style='height:20px;width:20px;background-color: #F0F0F0;position:absolute;left:100px;top:0;';
    let pic3 = document.createElement('img')
    pic3.src='/img/hand.png'
    pic3.style='height:100%;width:100%';
    hand.appendChild(pic3)
    hand.onclick=()=>{
      pageInstance.refs.mapDom.style.cursor='pointer'
    }
    hand.onmouseover=()=>{
      timer = setTimeout(()=>{
        document.getElementById('tip').style.display='block'
        document.getElementById('tip').innerHTML='手势'
        document.getElementById('tip').style.left='100px'
      },1500)
    }
    hand.onmouseleave=()=>{
      clearTimeout(timer)
      document.getElementById('tip').style.display='none'
    }
    let control1 = new Control({element:fullMap})
    let control2 = new Control({element:rasterMap})
    let control3  = new Control({element:hand})
    let control4  = new Control({element:tip})
    // map.value.addControl(control1)
    // map.value.addControl(control2)
    // map.value.addControl(control3)
    // map.value.addControl(control4)
    // new Graticule({
    //       map: map.value,
    //       strokeStyle: new Stroke({color: 'rgba(12, 12, 12, 0.8)',width: 0.6}),
    //       targetSize: 100}
    // )

    
  }
  )

onBeforeUnmount(() => {
  switchRevision++
  store.clearTemporalLayers()
  store.stopParcelTimelinePlay()
  store.clearParcelRoi(false)
  store.removeClick()
  clearInterval(yearPlayer.value)
  clearInterval(monthPlayer.value)
  isYearPlaying.value = false
  isMonthPlaying.value = false
  is3D.value = false
  const previousMap = map.value
  previousMap?.setTarget(null)
  previousMap?.dispose()
  map.value = null
})
</script>

<style scoped>
/* 地图容器基础样式 */
.map-container {
  width: 100%;
  height: 100%;
  position: relative;
}

/* 3D 地球覆盖层 */
.cesium-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
}
.map-container.roi-panning:active { cursor: grabbing !important; }
.roi-mode-switch {
  position: absolute;
  top: 16px;
  right: 78px;
  z-index: 1210;
  padding: 6px 8px 8px;
  width: 330px;
  box-sizing: border-box;
  border: 1px solid rgba(218, 238, 255, .28);
  border-radius: 12px;
  background: rgba(17, 39, 57, .78);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 18px rgba(0, 16, 29, .2);
  color: #d5e8f6;
}
.roi-mode-buttons { display: flex; gap: 5px; }
.roi-mode-buttons button { flex: 1; border: 0; border-radius: 7px; padding: 8px 12px; background: transparent; color: #d5e8f6; font-size: 13px; cursor: pointer; }
.roi-mode-buttons button:hover { background: rgba(180, 223, 255, .12); }
.roi-mode-buttons button[aria-pressed="true"] { background: #258df0; color: #fff; box-shadow: 0 2px 8px rgba(10, 105, 200, .24); }
.roi-mode-buttons .roi-cancel { color: #ffd8d8; }
.roi-mode-buttons .roi-cancel:hover { background: rgba(222, 72, 72, .24); color: #fff; }
.roi-mode-buttons button:focus-visible { outline: 2px solid #91d9ff; outline-offset: 2px; }
.roi-mode-switch p { margin: 7px 0 0; text-align: center; font-size: 11px; line-height: 1.5; }
@media (max-width: 640px) { .roi-mode-switch { width: min(330px, calc(100vw - 100px)); } }
.scene-error {
  position: absolute;
  z-index: 1001;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 15px;
  border-radius: 8px;
  color: white;
  background: #183b65e6;
  font-size: 13px;
}

/* 2D/3D 切换按钮容器 */
.dimension-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 1000;
}

/* 框选截取按钮 */
.roi-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 1000;
}

.roi-btn {
  padding: 6px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.2;
  white-space: nowrap;
  color: rgb(191, 238, 255);
  background-color: rgba(0, 35, 47, 0.85);
  border: 1px solid rgb(191, 238, 255);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.roi-btn:hover {
  background-color: rgba(6, 52, 66, 0.9);
}

.roi-btn.drawing {
  color: #ffd479;
  border-color: #ffd479;
}

.roi-btn.active {
  background-color: rgb(191, 238, 255);
  color: rgb(0, 35, 47);
  border-color: rgb(191, 238, 255);
}

/* 2D/3D 切换按钮样式 */
.toggle-btn {
  width: 50px;
  height: 50px;
  border-radius: 4px;
  background-color: #f0f0f0;
  border: 2px solid #d0d0d0;
  font-size: 16px;
  font-weight: bold;
  color: #333;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 按钮悬停效果 */
.toggle-btn:hover {
  background-color: #e8e8e8;
  border-color: #b0b0b0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 按钮激活状态 */
.toggle-btn.active {
  background-color: #4a90e2;
  color: white;
  border-color: #3a7bc8;
}

/* 激活状态下的悬停效果 */
.toggle-btn.active:hover {
  background-color: #3a7bc8;
  box-shadow: 0 2px 8px rgba(58, 123, 200, 0.3);
}

/* 按钮点击效果 */
.toggle-btn:active {
  transform: scale(0.95);
}

.body {
  background-color: rgb(12, 44, 54);
  color: #c9d1d9;
  font-family: Arial, sans-serif;
  position: absolute;
  right:30px;
  top:30px;
  width: 300px;
  z-index: 999;
  background-image: linear-gradient(135deg, transparent 25%, rgba(255, 255, 255, 0.05) 25%, rgba(255, 255, 255, 0.05) 50%, transparent 50%, transparent 75%, rgba(255, 255, 255, 0.05) 75%, rgba(255, 255, 255, 0.05));
  background-size: 5px 5px;
  font-size: 20px;
  border-radius: 20px;
}
table {
  width: 80%;
  margin: 50px auto;
  border-collapse: collapse;
}
th, td {
  padding: 15px;
  text-align: center;
  border-bottom: 1px solid #30363d;
}
th {
  background-color: #0d1117;
  color: #58a6ff;
  font-weight: bold;
}
tr:nth-child(even) {
  background-color: rgb(12, 44, 54);
}
tr:hover {
  background-color: rgb(6, 52, 66);
}
</style>
