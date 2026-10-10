<template>
  <div id="bottom_right">
    <!-- 框选开启时把「停止框选」也点亮成蓝底 -->
    <module-tabs v-model="tab" :tabs="tabs" :active-id="roiActive ? 'identify' : ''"/>

    <crops-type v-if="tab === 'visual'"/>
    <!-- 年份时间轴只属于「作物类型可视化」；种植分析看的是三年汇总，不需要切年份 -->
    <crop-year-timeline v-if="tab === 'visual'"/>
    <crop-analysis-panel v-if="tab === 'visual' || tab === 'analysis'" :tab="panelTab" hide-tabs/>
    <rotation-type v-if="tab === 'series'"/>
    <!-- 种植分析的稳定性图例，照原型放在右下 -->
    <legend-card
      v-if="tab === 'analysis'"
      title="种植稳定性"
      :items="stabilityLegend"
      :active-value="stabilitySelected"
      note="按地块统计 2024—2026 相对基准年 2024 发生改变的年数。点击某一级可只看该类分布。"
      @select="item => store.toggleStabilityClass(item.value)"
    />
    <!-- 框选后的识别进度条，刚好在统计完成时走满 -->
    <scan-progress/>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { View } from 'ol'
import useMapStore from '@/stores/map'
import ModuleTabs from '@/components/part/module-tabs.vue'
import CropsType from '@/components/part/crops-type.vue'
import CropYearTimeline from '@/components/part/crop-year-timeline.vue'
import CropAnalysisPanel from '@/components/part/crop-analysis-panel.vue'
import RotationType from '@/components/part/rotation-type.vue'
import LegendCard from '@/components/part/legend-card.vue'
import ScanProgress from '@/components/part/scan-progress.vue'
import PiIcon from '@/components/part/pi-icon.vue'

const store = useMapStore()
const { map, parcelRoiState, stabilitySelected } = storeToRefs(store)

// 二级模块，名称与 figma 原型一致。
// 「交互识别」本身就是框选开关，框选开着的时候按钮文案变成「停止框选」
const tabs = computed(() => [
  { id: 'identify', label: roiActive.value ? '停止框选' : '交互识别', icon: 'sprout' },
  { id: 'visual', label: '作物类型可视化', icon: 'layers' },
  { id: 'series', label: '作物时间序列', icon: 'chart' },
  { id: 'analysis', label: '种植分析', icon: 'asterisk' }
])
const tab = ref('visual')

// 二级模块 -> 分析面板内部页签
const PANEL_TAB = { visual: 'visual', series: 'series', analysis: 'analysis' }
const panelTab = computed(() => PANEL_TAB[tab.value] || 'visual')

const roiActive = computed(() => parcelRoiState.value === 'drawing' || parcelRoiState.value === 'applied')
const toggleRoi = () => store.toggleParcelRoi()

// 「交互识别」页签本身就是框选开关：点一下开始/结束框选，
// 视图落到「作物类型可视化」（这两个模块是一体的）
watch(tab, value => {
  if (value === 'identify') {
    store.toggleParcelRoi()
    tab.value = 'visual'
    return
  }
  // 离开「交互识别/作物类型可视化」就不再识别框选：整个撤掉，回到默认视图
  if (value !== 'visual' && (parcelRoiState.value === 'drawing' || parcelRoiState.value === 'applied')) {
    store.clearParcelRoi()
  }
  // 作物类型可视化看逐年分类，作物时间序列看轮作类型，种植分析两层都不挂
  store.setCropTab(value)
})

// 原型里的稳定性分级图例
const stabilityLegend = [
  { value: 0, label: '0 次（三年不变）', color: '#58c98a' },
  { value: 1, label: '1 次', color: '#f2c14e' },
  { value: 2, label: '2 次（每年都变）', color: '#e2574c' }
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
  store.addBasicLayer('World_Imagery') // 卫星底图
  store.addBasinBoundaryLayer()
  // clearMap 会把子组件（crops-type）刚挂上的作物图层一起清掉，
  // 所以视图初始化完再补一次加载；addCropLayer 内部会先移除旧层，不会重复。
  store.reloadCropLayer()
  // 从别的页面回来时，store 里的页签可能还停在上一状态，这里同步一次
  store.setCropTab(tab.value)
}

onMounted(setMapView)
onBeforeUnmount(() => {
  store.cancelCropAnalysisRequest()
  store.clearCropAnalysisBlink()
  store.removeRotationLayer()
})
</script>

<style scoped>
.ident-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.ident-inline .ident-btn {
  padding: 6px 14px;
  font-size: 12px;
}

.ident-inline-hint {
  color: var(--ink-300);
  font-size: 11px;
  line-height: 1.4;
}
</style>
