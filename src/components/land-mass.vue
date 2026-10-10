<template>
  <div id="bottom_right">
    <module-tabs v-model="tab" :tabs="tabs" :active-id="roiActive ? 'identify' : ''"/>

    <section v-if="tab === 'visual' && roiActive" class="ident-panel float-panel">
      <header class="panel-heading"><pi-icon name="target"/><span>地块动态识别</span></header>
      <div class="ident-body">
        <p class="ident-hint">拖出矩形查看地块从点、边界线到面的形成过程。右上侧可切换「画框」或「拖动地图」，画框模式下拖动选框边缘可移动选区；点击「停止框选」恢复完整视图。</p>
        <p role="status" aria-live="polite">{{ parcelIdentifyNotice }}</p>
        <p v-if="parcelIdentifyCount">{{ parcelIdentifyOverview ? '动画演示' : '已加载' }} {{ parcelIdentifyCount }} 个{{ parcelIdentifyOverview ? '代表地块' : '地块' }}</p>
      </div>
    </section>

    <date-timeline v-if="tab === 'visual'"/>
    <scan-progress v-if="tab === 'visual'" mode="parcel"/>

    <placeholder-panel
      v-if="tab === 'change'"
      icon="chart"
      title="耕地变化监测"
      subtitle="分析时段 2024 — 2026"
      :metrics="changeMetrics"
      :legend="changeLegend"
    />

    <parcel-analysis-panel v-if="tab === 'stats' || tab === 'pattern'" :mode="tab"/>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { View } from 'ol'
import useMapStore from '@/stores/map'
import ModuleTabs from '@/components/part/module-tabs.vue'
import DateTimeline from '@/components/part/date-timeline.vue'
import PlaceholderPanel from '@/components/part/placeholder-panel.vue'
import ParcelAnalysisPanel from '@/components/part/parcel-analysis-panel.vue'
import ScanProgress from '@/components/part/scan-progress.vue'
import PiIcon from '@/components/part/pi-icon.vue'

const store = useMapStore()
const { map, parcelRoiState, parcelIdentifyNotice, parcelIdentifyCount, parcelIdentifyOverview } = storeToRefs(store)

// 二级模块，名称与 figma 原型一致
const tabs = computed(() => [
  { id: 'identify', label: roiActive.value ? '停止框选' : '交互识别', icon: 'sprout' },
  { id: 'visual', label: '农业地块可视化', icon: 'layers' },
  { id: 'change', label: '耕地变化监测', icon: 'chart' },
  { id: 'stats', label: '耕地统计特征', icon: 'asterisk' },
  { id: 'pattern', label: '空间格局变化', icon: 'hexagon' }
])
const tab = ref('visual')

const roiActive = computed(() => parcelRoiState.value === 'drawing' || parcelRoiState.value === 'applied')


watch(tab, value => {
  if (value === 'identify') {
    store.toggleParcelRoi()
    tab.value = 'visual'
    return
  }
  if (value !== 'visual' && roiActive.value) store.clearParcelRoi()
})

onBeforeUnmount(() => {
  store.clearParcelRoi(false)
  store.parcelIdentifyEnabled = false
})

const changeMetrics = [
  { label: '持续耕地', value: '426,813 ha', delta: '66.5%' },
  { label: '新增耕地', value: '48,205 ha', delta: '+7.5%' },
  { label: '弃耕地', value: '31,642 ha', delta: '-4.9%' },
  { label: '净增耕地', value: '16,563 ha', delta: '+2.6%' }
]
const changeLegend = [
  { label: '持续耕地', color: '#e8c33f' },
  { label: '新增耕地', color: '#5cc46a' },
  { label: '弃耕地', color: '#d9534f' },
  { label: '复耕地', color: '#7fb3e8' }
]

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
  store.addAgriParcelLayer() // 农田地块
}

onMounted(setMapView)
</script>
