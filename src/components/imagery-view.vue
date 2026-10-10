<template>
  <div id="bottom_right">
    <layer-tree ref="treeRef"/>
    <time-slider/>

    <!-- 鼠标悬停在已加载图层上时的取值提示 -->
    <div v-if="temporalHoverInfo" class="ts-map-tooltip float-panel" :style="hoverTooltipStyle">
      <small>{{ temporalHoverInfo.coordinateLabel }}</small>
      <span v-for="item in temporalHoverInfo.items" :key="item.id">
        <b>{{ item.label }}</b>{{ item.value }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { View } from 'ol'
import useMapStore from '@/stores/map'
import LayerTree from '@/components/part/layer-tree.vue'
import TimeSlider from '@/components/part/time-slider.vue'

const store = useMapStore()
const { map, temporalHoverInfo } = storeToRefs(store)
const treeRef = ref(null)
let setupTimer = null
let disposed = false

const hoverTooltipStyle = computed(() => {
  const info = temporalHoverInfo.value
  if (!info) return {}
  return {
    left: `${Math.min(info.left + 14, window.innerWidth - 240)}px`,
    top: `${Math.min(info.top + 14, window.innerHeight - (50 + info.items.length * 24))}px`
  }
})

const setupPage = () => {
  if(disposed) return
  if (!map.value || !map.value.setView) {
    setupTimer = setTimeout(setupPage, 50)
    return
  }

  // 时空数据页用的是干净的卫星底图，先把别的模块的图层和框选撤掉
  store.clearParcelRoi()
  store.removeCropLayerLine()
  store.removeAdministrativeLayer()
  store.removeCropImageryLayers()
  store.removeClick()
  store.isShowFeautureInfo = false

  map.value.setView(new View({
    center: [78.25, 45.72],
    zoom: 7.15,
    projection: 'EPSG:4326'
  }))

  store.clearMap(0)
  store.addBasicLayer('World_Imagery')
  store.addBasinBoundaryLayer()
  if (store.basinBoundaryLayer && store.basinBoundaryLayer.setZIndex) store.basinBoundaryLayer.setZIndex(60)

  // 底图就绪后再打开默认图层，避免被 clearMap 清掉
  treeRef.value && treeRef.value.applyDefaults()
}

onMounted(setupPage)
onBeforeUnmount(() => { disposed = true; clearTimeout(setupTimer); store.clearTemporalLayers() })
</script>

<style scoped>
.ts-map-tooltip {
  position: fixed;
  z-index: 1300;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 230px;
  padding: 8px 11px;
  font-size: 12px;
  pointer-events: none;
}

.ts-map-tooltip strong {
  color: var(--ink-700);
  font-size: 12px;
}

.ts-map-tooltip small {
  color: var(--ink-300);
  font-size: 10px;
}

.ts-map-tooltip span {
  display: flex;
  gap: 6px;
  color: var(--ink-900);
}

.ts-map-tooltip b {
  color: var(--ink-300);
  font-weight: 400;
}
</style>
