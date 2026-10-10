<template>
  <section ref="panel" class="water-analysis float-panel" :style="panelStyle">
    <header class="panel-heading" @pointerdown="startDrag">
      <pi-icon :name="mode === 'annual' ? 'water' : 'chart'"/>
      <span>{{ mode === 'annual' ? '年度耗水量' : '耗水量时空变化分析' }}</span>
      <button class="collapse-button" type="button" @pointerdown.stop @click="collapsed = !collapsed" :title="collapsed ? '展开面板' : '收起面板'">{{ collapsed ? '»' : '«' }}</button>
    </header>
    <div v-show="!collapsed" class="analysis-body">
      <p class="analysis-status" role="status">{{ loading ? '正在读取耗水数据…' : message }} · {{ date }}</p>
      <template v-if="mode === 'annual'">
        <div class="annual-date-range">
          <span>{{ year }}-04-01</span>
          <input type="range" :min="growingStart" :max="growingEnd" :value="index" aria-label="年度生育期日期" @input="pickIndex(Number($event.target.value))">
          <span>{{ year }}-10-31</span>
        </div>
        <div class="analysis-metrics">
          <article v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ formatNumber(metric.value) }}</strong><small>万 m³</small></article>
        </div>
        <div class="analysis-chart">
          <h3>年度耗水过程</h3>
          <div v-if="monthly.length" class="monthly-bars"><div v-for="(value, month) in monthly" :key="month"><i :style="{ height: (Math.max(0, value) / monthlyMax * 100) + '%' }" :title="`${month + 1}月：${value}`"></i><small>{{ month + 1 }}月</small></div></div>
          <p v-else class="empty-data">暂无服务器月度过程数据</p>
        </div>
      </template>
      <template v-else>
        <p class="analysis-label">2018—{{ year }} 年变化指标</p>
        <div class="analysis-metrics">
          <article v-for="metric in changes" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ formatInteger(metric.value) }}</strong><small>{{ metric.rate === null ? '--' : metric.rate + '%' }}</small></article>
        </div>
        <div class="analysis-chart"><h3>耗水量变化趋势 <small>单位：万 m³</small></h3>
          <div v-if="history.length" class="history-bars"><div v-for="item in history" :key="item.year"><span>{{ formatNumber(item.value) }}</span><i :style="{ height: Math.max(3, item.value / historyMax * 95) + 'px' }"></i><small>{{ item.year }}</small></div></div>
          <p v-else class="empty-data">暂无服务器年度趋势数据</p>
        </div>
      </template>
    </div>
  </section>
  <water-date-timeline :index="index" :count="totalDays" :playing="playing" :date="date" :start="startDate" :end="endDate" :years="years" @select-index="pickIndex" @select-date="pickDate" @toggle-play="togglePlay"/>
</template>
<script setup>
/* global defineProps */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import { normalizeAnnualData, normalizeChangeData } from '@/utils/water-statistics'
import PiIcon from '@/components/part/pi-icon.vue'
import WaterDateTimeline from '@/components/part/water-date-timeline.vue'

const props = defineProps({ mode: { type: String, required: true } })
const { cropWaterActiveDate } = storeToRefs(useMapStore())
const { panel, panelStyle, startDrag } = usePanelDrag()
const years = [2024, 2025, 2026]
const startDate = '2024-01-01', endDate = '2026-12-31', dayMs = 86400000
const startTime = Date.parse(startDate), totalDays = Math.round((Date.parse(endDate) - startTime) / dayMs) + 1
const date = computed(() => cropWaterActiveDate.value)
const year = computed(() => Number(date.value.slice(0, 4)))
const index = computed(() => Math.max(0, Math.min(totalDays - 1, Math.round((Date.parse(date.value) - startTime) / dayMs))))
const growingStart = computed(() => Math.round((Date.UTC(year.value, 3, 1) - startTime) / dayMs))
const growingEnd = computed(() => Math.round((Date.UTC(year.value, 9, 31) - startTime) / dayMs))
const collapsed = ref(false), playing = ref(false), loading = ref(false), message = ref('')
const annual = ref(null), change = ref(null)
const metrics = computed(() => [
  { label: '当日蓝水耗水量', value: annual.value?.blue },
  { label: '当日绿水耗水量', value: annual.value?.green },
  { label: '当日灌溉需水量', value: annual.value?.irrigation },
  { label: '当日土壤水耗水量', value: annual.value?.soil },
  { label: '累计绿水耗水量', value: annual.value?.totalGreen },
  { label: '累计总耗水量', value: annual.value?.total }
])
const changes = computed(() => [
  { label: '耗水量上升地块', value: change.value?.rising, rate: change.value?.risingRate ?? null },
  { label: '耗水量下降地块', value: change.value?.falling, rate: change.value?.fallingRate ?? null },
  { label: '耗水量持平地块', value: change.value?.stable, rate: change.value?.stableRate ?? null }
])
const monthly = computed(() => annual.value?.monthly || [])
const monthlyMax = computed(() => Math.max(...monthly.value, 1))
const history = computed(() => (change.value?.history || []).filter(item => item.year <= year.value).sort((a, b) => a.year - b.year))
const historyMax = computed(() => Math.max(...history.value.map(item => item.value), 1))
const apiBase = (process.env.VUE_APP_CROP_WATER_API_BASE || 'http://localhost:5000').replace(/\/$/, '')
let controller = null, requestId = 0, loadTimer = null, playTimer = null, disposed = false

function formatNumber(value) { return value === undefined || value === null ? '--' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function formatInteger(value) { return value === undefined || value === null ? '--' : Math.round(value).toLocaleString('zh-CN') }
function stopPlay() { playing.value = false; clearInterval(playTimer); playTimer = null }
function pickIndex(value) { cropWaterActiveDate.value = new Date(startTime + Math.max(0, Math.min(totalDays - 1, value)) * dayMs).toISOString().slice(0, 10) }
function pickDate(value) { const time = Date.parse(value); if (Number.isFinite(time)) { stopPlay(); pickIndex(Math.round((time - startTime) / dayMs)) } }
function togglePlay() { if (playing.value) return stopPlay(); playing.value = true; playTimer = setInterval(() => pickIndex((index.value + 1) % totalDays), 1200) }
async function loadData() {
  const id = ++requestId
  controller?.abort(); controller = new AbortController()
  const activeController = controller
  const timeout = setTimeout(() => activeController.abort(), 8000)
  loading.value = true
  annual.value = null; change.value = null
  try {
    const endpoint = props.mode === 'annual' ? `/api/water/annual?year=${year.value}&date=${date.value}` : `/api/water/change?startYear=2018&endYear=${year.value}`
    const response = await fetch(apiBase + endpoint, { signal: activeController.signal })
    const payload = await response.json()
    if (disposed || id !== requestId) return
    if (!response.ok) {
      message.value = payload?.message || payload?.data?.message || '耗水数据暂时不可用，请检查服务连接'
      return
    }
    const normalized = props.mode === 'annual' ? normalizeAnnualData(payload) : normalizeChangeData(payload)
    if (props.mode === 'annual') annual.value = normalized
    else change.value = normalized
    message.value = normalized ? '数据已接入' : payload?.message || payload?.data?.message || '当前年份暂无耗水数据'
  } catch (error) {
    if (!disposed && id === requestId) message.value = '耗水数据暂时不可用，请检查服务连接'
  } finally { clearTimeout(timeout); if (!disposed && id === requestId) loading.value = false }
}
watch(() => props.mode === 'annual' ? `${props.mode}:${date.value}` : `${props.mode}:${year.value}`, () => {
  controller?.abort(); requestId++; annual.value = null; change.value = null; loading.value = true
  clearTimeout(loadTimer); loadTimer = setTimeout(loadData, 250)
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; requestId++; controller?.abort(); clearTimeout(loadTimer); stopPlay() })
</script>
<style scoped>
.water-analysis { position: fixed; top: calc(var(--header-h) + var(--tabs-h) + 11px); left: 11px; z-index: 1000; width: min(390px, calc(100vw - 90px)); pointer-events: auto; }
.panel-heading { cursor: move; touch-action: none; user-select: none; }
.collapse-button { margin-left: auto; padding: 0 4px; color: var(--ink-300); background: none; border: 0; font-size: 20px; cursor: pointer; }
.analysis-body { max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 190px); padding: 12px 15px 15px; overflow-y: auto; }
.analysis-status,.analysis-label { margin: 0 0 12px; color: var(--ink-300); font-size: 12px; line-height: 1.7; }
.annual-date-range { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 10px; color: var(--ink-300); }
.annual-date-range input { flex: 1; min-width: 0; accent-color: var(--brand-500); }
.analysis-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.analysis-metrics article { position: relative; padding: 10px; background: #f5f8fd; border: 1px solid #e3ebf5; border-radius: 6px; }
.analysis-metrics span { display: block; color: #708198; font-size: 11px; }
.analysis-metrics strong { display: block; margin-top: 6px; color: var(--ink-500); font-size: 17px; overflow-wrap: anywhere; }
.analysis-metrics small { display: block; margin-top: 4px; color: var(--ink-300); font-size: 10px; }
.analysis-chart { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e6edf5; }
.analysis-chart h3 { margin: 0 0 12px; color: var(--ink-700); font-size: 13px; }
.analysis-chart h3 small { float: right; font-weight: 400; font-size: 10px; color: var(--ink-300); }
.empty-data { margin: 20px 0; text-align: center; color: var(--ink-300); font-size: 12px; }
.monthly-bars,.history-bars { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; height: 145px; }
.monthly-bars > div,.history-bars > div { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 0; }
.monthly-bars i,.history-bars i { display: block; width: 16px; max-width: 70%; min-height: 2px; border-radius: 2px 2px 0 0; background: linear-gradient(#46acfa, #156ee4); }
.monthly-bars small,.history-bars small,.history-bars span { margin-top: 5px; font-size: 9px; color: var(--ink-300); }
.history-bars span { margin: 0 0 3px; }
</style>
