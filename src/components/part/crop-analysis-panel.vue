<template>
  <section class="ca-panel" :class="{ collapsed }" ref="panel" :style="panelStyle">
    <!-- 拖动把手；右侧小箭头收起 / 展开面板 -->
    <div class="ca-bar" @pointerdown="startDrag">
      <span class="ca-grip" aria-hidden="true"></span>
      <span class="ca-bar-title">{{ panelTitle }}</span>
      <button
        class="ca-collapse"
        type="button"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开面板' : '收起面板'"
        @pointerdown.stop
        @click.stop="collapsed = !collapsed"
      >
        <pi-icon name="caret"/>
      </button>
    </div>
    <div v-if="!hideTabs && !collapsed" class="ca-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="ca-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <div v-if="!collapsed" class="ca-body">
      <!-- 交互识别与作物类型可视化是一体的，框选入口由页面塞进来 -->
      <slot name="actions"/>
      <p class="ca-hint" v-if="recognizing || cropAnalysisLoading">
        {{ recognizing
          ? (cropScanPhase === 'preparing' ? '渲染图层中…' : '正在识别，完成后显示统计信息…')
          : cropAnalysisScope === 'roi' ? '正在统计…' : '正在统计整个流域，首次加载后将缓存结果…' }}
      </p>
      <p class="ca-hint" v-else-if="!result">{{ cropAnalysisNotice || '正在准备数据…' }}</p>

      <template v-else>
        <!-- 作物可视化 -->
        <template v-if="activeTab === 'visual'">
          <div class="ca-row"><span>统计年份</span><b>{{ result.latestYear }}</b></div>
          <div class="ca-row"><span>地块数</span><b>{{ formatCount(result.parcelCount) }}</b></div>
          <div class="ca-row"><span>作物类型数</span><b>{{ result.diversity.richness }}</b></div>
          <div class="ca-row"><span>总面积</span><b>{{ result.totalArea.toFixed(1) }} km²</b></div>

          <div class="ca-sub">各类型与占比</div>
          <div class="ca-type" v-for="item in result.byType" :key="item.code">
            <span class="ca-swatch" :style="{ backgroundColor: colorOf(item.code) }">
              <pi-icon :name="iconOf(item.code)"/>
            </span>
            <span class="ca-name">{{ item.name }}</span>
            <span class="ca-ratio">{{ (item.ratio * 100).toFixed(1) }}%</span>
            <span class="ca-count">{{ formatCount(item.count) }} 块</span>
          </div>

        </template>

        <!-- 作物时间序列 -->
        <template v-else-if="activeTab === 'series'">
          <div class="ca-chain">
            <template v-for="(node, i) in result.series" :key="node.year">
              <span class="ca-arrow" v-if="i">→</span>
              <span class="ca-node">
                <b>{{ node.year }}</b>
                <i>{{ node.name }}</i>
              </span>
            </template>
          </div>
          <div class="ca-row" v-for="node in result.series" :key="node.year">
            <span>{{ node.year }} 主导作物</span>
            <b>{{ node.name }} {{ (node.ratio * 100).toFixed(1) }}%</b>
          </div>
          <p class="ca-tip" v-if="result.years.length < 2">
            目前只取到一年数据，时间序列需要按年份配置多个图层：<br>
            <code>setCropAnalysisYears({2024:'…', 2025:'…', 2026:'…'})</code><br>
            或放 <code>public/static/cropYears.json</code>
          </p>
        </template>

        <!-- 种植分析 -->
        <template v-else>
          <!-- 地块视图 / 网格视图 -->
          <div class="ca-subtabs ca-view-switch">
            <button
              class="ca-subtab"
              :class="{ active: analysisView === 'parcel' }"
              @click="store.setAnalysisView('parcel')"
            >地块视图</button>
            <button
              class="ca-subtab"
              :class="{ active: analysisView === 'grid' }"
              @click="store.setAnalysisView('grid')"
            >网格视图</button>
          </div>

          <!-- 网格视图：10km 网格的汇总 -->
          <template v-if="analysisView === 'grid'">
            <div class="ca-sub">网格多样性（10km）</div>
            <div class="ca-row"><span>网格数</span><b>{{ formatCount(gridStats.gridCount) }}</b></div>
            <div class="ca-row">
              <span>平均每格作物种类数</span>
              <b>{{ gridStats.meanCropTypes.toFixed(2) }} 种/格</b>
            </div>
            <div class="ca-row"><span>平均 Shannon</span><b>{{ gridStats.shannon.toFixed(3) }}</b></div>
            <div class="ca-row"><span>平均 Simpson</span><b>{{ gridStats.simpson.toFixed(3) }}</b></div>
            <div class="ca-row">
              <span>平均地块密度</span>
              <b>{{ gridStats.meanDensity.toFixed(2) }} 个/km²</b>
            </div>
            <div class="ca-row">
              <span>平均优势作物占比</span>
              <b>{{ gridStats.meanDominantPct.toFixed(1) }}%</b>
            </div>
            <p class="ca-tip">按 10km 网格统计，地图上按每格的作物种类数上色。</p>
          </template>

          <!-- 地块视图：稳定性 / 多样性 -->
          <template v-else>
          <div class="ca-subtabs">
            <button
              class="ca-subtab"
              :class="{ active: analysisTab === 'stability' }"
              @click="analysisTab = 'stability'"
            >种植稳定性分析</button>
            <button
              class="ca-subtab"
              :class="{ active: analysisTab === 'diversity' }"
              @click="analysisTab = 'diversity'"
            >种植多样性</button>
          </div>

          <template v-if="analysisTab === 'stability'">
          <div class="ca-base">
            <strong>以 {{ result.stability.baseline || result.baseline }} 年为基准</strong>
            <span>统计每个地块作物类型改变次数</span>
          </div>
          <div class="ca-metrics">
            <div class="ca-metric">
              <span>稳定地块占比</span>
              <strong>{{ stableShare }}</strong>
            </div>
            <div class="ca-metric">
              <span>平均改变次数</span>
              <strong>{{ avgChanges }}</strong>
            </div>
          </div>
          <div class="ca-sub">种植稳定性</div>
          <div class="ca-row"><span>基准年</span><b>{{ result.stability.baseline || result.baseline }}</b></div>
          <div class="ca-row"><span>参与对比年份</span><b>{{ result.stability.years.join(' / ') || '—' }}</b></div>
          <div class="ca-row"><span>可对比地块数</span><b>{{ result.stability.parcelCount }}</b></div>
          <div class="ca-row">
            <span>平均改变次数</span>
            <b>{{ result.stability.averageChanges === null ? '—' : result.stability.averageChanges.toFixed(2) }} 次</b>
          </div>
          <div class="ca-row" v-for="(count, changes) in result.stability.histogram" :key="changes">
            <span>改变 {{ changes }} 次</span><b>{{ count }} 个地块</b>
          </div>

          <!-- 稳定性类型占比：一条堆叠条 + 百分比明细 -->
          <div class="ca-sub">稳定性类型占比</div>
          <div class="ca-stack">
            <span
              v-for="item in stabilityBreakdown"
              :key="item.value"
              class="ca-stack-seg"
              :style="{ width: (item.ratio * 100) + '%', backgroundColor: item.color }"
              :title="item.label + ' ' + (item.ratio * 100).toFixed(1) + '%'"
            ></span>
          </div>
          <div class="ca-row" v-for="item in stabilityBreakdown" :key="item.value">
            <span><i class="ca-dot" :style="{ backgroundColor: item.color }"></i>{{ item.label }}</span>
            <b>{{ (item.ratio * 100).toFixed(1) }}%</b>
          </div>
          <p class="ca-tip" v-if="!result.stability.comparable">
            稳定性需要至少两年数据，当前只取到 {{ result.years.length }} 年
          </p>
          </template>

          <template v-else>
          <div class="ca-sub">种植多样性</div>
          <div class="ca-row"><span>作物种类数</span><b>{{ result.diversity.richness }}</b></div>
          <!-- 地块视图：逐地块三年序列的 Shannon / Simpson 平均 -->
          <template v-if="result.diversityParcel">
            <div class="ca-row">
              <span>Shannon（地块平均）</span>
              <b>{{ result.diversityParcel.shannon.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>Simpson（地块平均）</span>
              <b>{{ result.diversityParcel.simpson.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>参与统计地块数</span>
              <b>{{ formatCount(result.diversityParcel.parcelCount) }}</b>
            </div>
            <p class="ca-tip">按每个地块三年序列的多样性指标取平均；网格口径见「网格视图」。</p>
          </template>
          <!-- 没有地块指标时退回网格统计 -->
          <template v-else-if="result.diversity.fromGrid">
            <div class="ca-row">
              <span>{{ result.diversity.gridKm }}km 网格数</span>
              <b>{{ formatCount(result.diversity.gridCount) }}</b>
            </div>
            <div class="ca-row">
              <span>平均每格作物种类数</span>
              <b>{{ result.diversity.meanCropTypes.toFixed(2) }} 种/格</b>
            </div>
            <div class="ca-row">
              <span>Shannon（网格平均）</span>
              <b>{{ result.diversity.shannon.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>Simpson（网格平均）</span>
              <b>{{ result.diversity.simpson.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>平均地块密度</span>
              <b>{{ result.diversity.meanDensity.toFixed(2) }} 个/km²</b>
            </div>
            <div class="ca-row">
              <span>平均优势作物占比</span>
              <b>{{ result.diversity.meanDominantPct.toFixed(1) }}%</b>
            </div>
            <p class="ca-tip">按 {{ result.diversity.gridKm }}km 网格统计（grid_2024_10km_crop_diversity）。</p>
          </template>
          <template v-else>
            <div class="ca-row">
              <span>Shannon（类型面积占比）</span>
              <b>{{ result.diversity.shannon.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>Simpson（类型面积占比）</span>
              <b>{{ result.diversity.simpson.toFixed(3) }}</b>
            </div>
            <div class="ca-row">
              <span>单位面积作物种类<br>（种/千km²）</span>
              <b>{{ (result.diversity.speciesPerKm2 * 1000).toFixed(2) }}</b>
            </div>
            <p class="ca-tip">网格多样性统计不可用，这里显示按面积占比算的整体指标。</p>
          </template>
          </template>
          </template>
        </template>
      </template>

      <p class="ca-warn" v-if="result && cropAnalysisNotice">{{ cropAnalysisNotice }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import PiIcon from '@/components/part/pi-icon.vue'
import { STABILITY_CLASSES } from '@/utils/crop-types'

const store = useMapStore()
const { panel, panelStyle, startDrag } = usePanelDrag()
const {
  cropAnalysisResult,
  cropAnalysisLoading,
  cropAnalysisNotice,
  cropAnalysisScope,
  cropScanPhase,
  parcelRoiExtent,
  analysisView
} = storeToRefs(store)

const tabs = [
  { id: 'visual', label: '作物可视化' },
  { id: 'series', label: '时间序列' },
  { id: 'analysis', label: '种植分析' }
]
const activeTab = ref('visual')
// 种植分析里的两个子页签：稳定性 / 多样性
const analysisTab = ref('stability')
// 面板收起状态：收起后只留标题栏
const collapsed = ref(false)

// 二级模块导航条上的选择会切到这个面板里的对应页签
/* global defineProps */
const props = defineProps({
  tab: { type: String, default: '' },
  // 二级模块导航条已经在切页签时，面板内部的页签就不重复显示了
  hideTabs: { type: Boolean, default: false }
})
watch(() => props.tab, value => {
  if (value && tabs.some(item => item.id === value)) activeTab.value = value
}, { immediate: true })

const recognizing = computed(() => !!parcelRoiExtent.value && ['preparing','loading','running'].includes(cropScanPhase.value))
const result = computed(() => cropAnalysisResult.value)

// 标题跟着二级模块走，与原型一致
const panelTitle = computed(() => ({
  visual: '作物统计信息',
  series: '作物时间序列',
  analysis: '种植分析'
}[activeTab.value] || '作物统计信息'))

// 多年数据接入前，稳定性两个指标先按原型给的示例值展示
const SAMPLE_STABLE_SHARE = '68.4%'
const SAMPLE_AVG_CHANGES = '1.7 次'
const stableShare = computed(() => {
  const stability = result.value && result.value.stability
  if(!stability || !stability.comparable || !stability.parcelCount) return SAMPLE_STABLE_SHARE
  const stable = Number(stability.histogram && stability.histogram[0]) || 0
  return `${((stable / stability.parcelCount) * 100).toFixed(1)}%`
})
const avgChanges = computed(() => {
  const stability = result.value && result.value.stability
  if(!stability || !stability.comparable || stability.averageChanges === null) return SAMPLE_AVG_CHANGES
  return `${stability.averageChanges.toFixed(1)} 次`
})

// 稳定性三级的占比明细，颜色和地图、图例同源
const stabilityBreakdown = computed(() => {
  const stability = result.value && result.value.stability
  if(!stability || !stability.parcelCount) return []
  return STABILITY_CLASSES.map(item => {
    const count = Number((stability.histogram || {})[item.value]) || 0
    return { ...item, count, ratio: count / stability.parcelCount }
  })
})

// 网格视图的汇总：框选时用选区内的格网，否则用全域网格统计
const gridStats = computed(() => {
  const diversity = result.value && result.value.diversity
  if(diversity && diversity.fromGrid){
    return {
      gridCount: diversity.gridCount,
      meanCropTypes: diversity.meanCropTypes,
      shannon: diversity.shannon,
      simpson: diversity.simpson,
      meanDensity: diversity.meanDensity,
      meanDominantPct: diversity.meanDominantPct
    }
  }
  const summary = store.gridStats && store.gridStats.summary
  if(summary){
    return {
      gridCount: summary.gridCount,
      meanCropTypes: summary.meanCropTypes,
      shannon: summary.meanShannon,
      simpson: summary.meanSimpson,
      meanDensity: summary.meanDensity,
      meanDominantPct: summary.meanDominantPct
    }
  }
  return { gridCount: 0, meanCropTypes: 0, shannon: 0, simpson: 0, meanDensity: 0, meanDominantPct: 0 }
})

const iconOf = code => store.cropAnalysisTypeInfo(code).icon
const colorOf = code => store.cropAnalysisTypeInfo(code).color
const formatCount = value => Number(value || 0).toLocaleString('zh-CN')

onMounted(() => {
  store.getCropAnalysisYears()
  store.getGridStats()
})
</script>

<style scoped>
.ca-panel {
  position: fixed;
  /* 照原型放在左上，让开顶栏和二级导航条 */
  top: calc(var(--header-h) + var(--tabs-h) + 11px);
  left: 11px;
  z-index: 1150;
  width: 356px;
  /* 默认高度避开底部的日期时间轴，内容多了内部滚动 */
  max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 150px);
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  color: #22303f;
  font-size: 15px;
}

/* 拖动把手 */
.ca-bar {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 8px 16px 0;
  cursor: move;
  touch-action: none;
}

.ca-grip {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  background-image: radial-gradient(#a9b8cc 1px, transparent 1px);
  background-size: 4px 4px;
}

.ca-bar-title {
  font-size: 16px;
  font-weight: 600;
  color: #1a56c4;
  white-space: nowrap;
}

/* 收起 / 展开的小箭头 */
.ca-collapse {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: #5b7ba6;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.ca-collapse:hover {
  color: #1a56c4;
  background: #eef4fd;
}

.ca-collapse svg {
  width: 16px;
  height: 16px;
  transition: transform .2s ease;
}

.ca-panel.collapsed .ca-collapse svg {
  transform: rotate(180deg);
}

.ca-panel.collapsed .ca-bar {
  padding-bottom: 8px;
}

.ca-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 16px 0;
}

.ca-tab {
  flex: 1 1 0;
  padding: 9px 6px;
  font-family: inherit;
  font-size: 15px;
  white-space: nowrap;
  color: #1a56c4;
  background-color: #eef4fd;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.ca-tab.active {
  color: #ffffff;
  background-image: linear-gradient(135deg, #1a73e8, #3f8ef5);
}

.ca-body {
  padding: 10px 16px 16px;
  overflow-y: auto;
}

.ca-hint {
  margin: 8px 0;
  color: #8494a8;
  line-height: 1.5;
}

.ca-scope {
  margin: 0 0 8px;
  color: #55637a;
  line-height: 1.5;
}

.ca-scope b {
  color: #1a56c4;
}

.ca-scope em {
  font-style: normal;
  color: #9aa7ba;
}

.ca-warn {
  margin: 10px 0 0;
  color: #d08700;
}

.ca-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  color: #55637a;
}

.ca-row b {
  color: #22303f;
  font-weight: 600;
  text-align: right;
}

.ca-sub {
  margin: 14px 0 6px;
  padding-top: 12px;
  border-top: 1px solid #eaf0f8;
  font-size: 16px;
  font-weight: 600;
  color: #1a56c4;
}

/* 种植分析里的小页签：种植稳定性分析 / 种植多样性 */
.ca-subtabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.ca-subtab {
  flex: 1 1 0;
  padding: 7px 10px;
  font-family: inherit;
  font-size: 13px;
  color: #164f9a;
  background-color: #f2f7fd;
  border: 1px solid #dfeaf8;
  border-radius: 6px;
  cursor: pointer;
}

.ca-subtab.active {
  color: #fff;
  font-weight: 600;
  background-image: linear-gradient(#2c93ff, #156ee4);
  border-color: transparent;
}

/* 地块视图 / 网格视图切换 */
.ca-view-switch {
  margin-bottom: 12px;
}

/* 稳定性类型占比：一条堆叠条 */
.ca-stack {
  display: flex;
  height: 12px;
  margin: 6px 0 10px;
  border-radius: 6px;
  overflow: hidden;
  background-color: #eef4fd;
}

.ca-stack-seg {
  display: block;
  height: 100%;
}

.ca-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: middle;
}

/* 以某年为基准的说明条 */
.ca-base {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  margin-bottom: 10px;
  background-color: #f6faff;
  border-left: 3px solid #2c93ff;
  border-radius: 0 6px 6px 0;
}

.ca-base strong {
  color: #164f9a;
  font-size: 13px;
}

.ca-base span {
  color: #7890aa;
  font-size: 12px;
}

.ca-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 4px;
}

.ca-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background-color: #f5f9fe;
  border: 1px solid #e6eefa;
  border-radius: 8px;
}

.ca-metric span {
  color: #7890aa;
  font-size: 12px;
}

.ca-metric strong {
  color: #102b56;
  font-size: 18px;
}

.ca-type {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 0;
}

.ca-swatch {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background-color: #c7ced8;
}

.ca-swatch svg {
  width: 13px;
  height: 13px;
  color: #ffffff;
}

.ca-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ca-ratio {
  color: #1a56c4;
  font-weight: 600;
}

.ca-count {
  color: #8494a8;
}

.ca-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 6px 0 10px;
}

.ca-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 12px;
  border-radius: 6px;
  background-color: #eef4fd;
}

.ca-node b {
  font-size: 16px;
  color: #1a56c4;
}

.ca-node i {
  font-style: normal;
  color: #22303f;
}

.ca-arrow {
  color: #8494a8;
}

.ca-tip {
  margin: 10px 0 0;
  color: #8494a8;
  line-height: 1.6;
  word-break: break-all;
}

.ca-tip code {
  font-size: 13px;
  color: #1a56c4;
}
</style>
