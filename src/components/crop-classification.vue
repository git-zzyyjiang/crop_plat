<template>
  <div id="bottom_right">
    <module-tabs v-model="tab" :tabs="tabs"/>

    <!-- 交互识别：地图上先不显示任何作物，框选成功后只显示框内的分类 -->
    <crops-type v-if="tab === 'identify' || tab === 'visual'"/>
    <!-- 交互识别和作物类型可视化都要切年份；种植分析看三年汇总、时间序列看序列，不需要 -->
    <crop-year-timeline v-if="tab === 'identify' || tab === 'visual'"/>
    <crop-analysis-panel v-if="tab === 'identify' || tab === 'visual' || tab === 'analysis'" :tab="panelTab" hide-tabs/>
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

// 二级模块。交互识别与作物类型可视化是两个独立模块：
//   交互识别       —— 地图上不显示作物分类，画框识别后只显示框内
//   作物类型可视化 —— 显示整幅作物分类，没有框选
const tabs = [
  { id: 'identify', label: '交互识别', icon: 'sprout' },
  { id: 'visual', label: '作物类型可视化', icon: 'layers' },
  { id: 'series', label: '作物时间序列', icon: 'chart' },
  { id: 'analysis', label: '种植分析', icon: 'asterisk' }
]
const tab = ref('identify')

// 二级模块 -> 分析面板内部页签
const PANEL_TAB = { visual: 'visual', series: 'series', analysis: 'analysis' }
const panelTab = computed(() => PANEL_TAB[tab.value] || 'visual')

const applyTab = value => {
  // 进「交互识别」就开框选：这时地图上不显示任何作物分类
  if (value === 'identify') {
    store.clearParcelRoi(false)
    store.startParcelRoiDraw()
  } else if (parcelRoiState.value === 'drawing' || parcelRoiState.value === 'applied') {
    // 其它模块一律不带框选
    store.clearParcelRoi()
  }
  // 交互识别 / 作物类型可视化看逐年分类，作物时间序列看轮作类型，种植分析看稳定性
  store.setCropTab(value)
}
watch(tab, applyTab)

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
  // 从别的页面回来时，store 里的页签可能还停在上一状态，这里同步一次（默认进交互识别）
  applyTab(tab.value)
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
