<template>
  <div id="bottom_right">
    <module-tabs :model-value="tab" :tabs="tabs" @update:model-value="selectModule"/>

    <date-timeline year-only/>
    <scan-progress v-if="tab === 'identify'" mode="parcel"/>

    <parcel-analysis-panel v-if="['stats','pattern','change'].includes(tab)" :key="tab" :mode="tab"/>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { View } from 'ol'
import useMapStore from '@/stores/map'
import ModuleTabs from '@/components/part/module-tabs.vue'
import DateTimeline from '@/components/part/date-timeline.vue'
import ParcelAnalysisPanel from '@/components/part/parcel-analysis-panel.vue'
import ScanProgress from '@/components/part/scan-progress.vue'

const store = useMapStore()
const { map } = storeToRefs(store)

// 二级模块，名称与 figma 原型一致
const tabs = [
  { id: 'identify', label: '交互识别', icon: 'sprout' },
  { id: 'visual', label: '农业地块可视化', icon: 'layers' },
  { id: 'change', label: '耕地变化检测', icon: 'chart' },
  { id: 'stats', label: '耕地统计特征', icon: 'asterisk' },
  { id: 'pattern', label: '空间格局变化', icon: 'hexagon' }
]
const tab = ref('identify')

const selectModule = value => {
  if (value === tab.value) return
  store.stopParcelTimelinePlay()
  store.clearParcelRoi()
  store.removeParcelTimelineLayer()
  tab.value = value
  store.parcelPageMode = value
  if (value === 'identify') {
    store.startParcelRoiDraw()
    store.setParcelRoiMode('pan')
  }
  store.applyParcelTimelineDate()
}

onBeforeUnmount(() => {
  store.clearParcelRoi(false)
  store.parcelIdentifyEnabled = false
  store.parcelPageMode = null
})

const setMapView = () => {
  if (!map.value || !map.value.setView) {
    setTimeout(setMapView, 50)
    return
  }

  map.value.setView(new View({
    center: [78.25, 45.72],
    zoom: 7.15,
    projection: 'EPSG:4326'
  }))

  store.clearMap(0)
  // 时空数据页勾选的图层不要跟着过来
  store.clearTemporalLayers()
  store.addBasicLayer('World_Imagery') // 底图改为卫星图
  store.addBasinBoundaryLayer()
  store.parcelIdentifyEnabled = true
  store.parcelPageMode = tab.value
  store.addAgriParcelLayer() // 农田地块
  store.startParcelRoiDraw()
  store.setParcelRoiMode('pan')
  store.applyParcelTimelineDate()
}

onMounted(setMapView)
</script>

