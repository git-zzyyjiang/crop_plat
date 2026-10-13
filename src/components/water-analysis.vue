<template>
  <section ref="panel" class="water-analysis float-panel" :style="panelStyle">
    <header class="panel-heading" @pointerdown="startDrag">
      <pi-icon :name="mode === 'annual' ? 'water' : 'chart'"/>
      <span>{{ mode === 'annual' ? '年度耗水量' : '耗水量时空变化分析' }}</span>
    </header>
    <div v-show="!collapsed" class="analysis-body">
      <p v-if="mode === 'annual'" class="analysis-status" role="status">{{ loading ? '正在读取耗水数据…' : message }} · {{ date }}</p>
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
        <p class="analysis-label">{{ formatMonthLabel(date) }} 对比 {{ formatMonthLabel(displayPreviousDate) }} · 全研究区地块月耗水变化</p>
        <p class="analysis-scope" role="status">
          <template v-if="loading">正在统计全研究区地块…</template>
          <template v-else-if="change">全研究区 {{ formatInteger(change.researchFieldCount) }} 个地块 · 全部参与比较</template>
          <template v-else>{{ message || '当前月份暂无地块变化数据' }}</template>
        </p>
        <div v-if="loading" class="analysis-loading" role="progressbar" aria-label="正在计算全研究区耗水变化">
          <i></i>
        </div>
        <div class="change-metric-grid" :class="{ 'is-refreshing': loading }" aria-live="polite">
          <article v-for="metric in changeCards" :key="metric.label" :class="metric.tone">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.display }}</strong>
            <small>{{ metric.unit }}<template v-if="metric.note"> · {{ metric.note }}</template></small>
          </article>
        </div>
        <div class="analysis-chart" :class="{ 'is-refreshing': loading }"><h3>当月变化分布 <small>{{ change?.scope || '全研究区' }}</small></h3>
          <div class="change-distribution">
            <i class="increase" :style="{ flex: Math.max(changes[0].value || 0, 1) }"></i>
            <i class="decrease" :style="{ flex: Math.max(changes[1].value || 0, 1) }"></i>
            <i class="unchanged" :style="{ flex: Math.max(changes[2].value || 0, 1) }"></i>
          </div>
          <div class="change-distribution-labels"><span>上升</span><span>下降</span><span>持平</span></div>
        </div>
      </template>
    </div>
  </section>
  <water-date-timeline :index="index" :count="timelineCount" :playing="playing" :date="date" :start="timelineStart" :end="timelineEnd" :years="timelineYears" :monthly="mode === 'change'" :availability-loading="mode === 'change' && changeStatusLoading" :play-disabled="mode === 'change' && !changeStatusReady" @select-index="pickIndex" @select-date="pickDate" @toggle-play="togglePlay"/>
</template>
<script setup>
/* global defineProps, defineEmits */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import { normalizeAnnualData, normalizeChangeData } from '@/utils/water-statistics'
import { getWaterSeasonYear, getWaterTimelineDate, getWaterTimelineIndex, waterTimelineDates, waterTimelineEndDate, waterTimelineStartDate } from '@/utils/water-timeline'
import PiIcon from '@/components/part/pi-icon.vue'
import WaterDateTimeline from '@/components/part/water-date-timeline.vue'

const props = defineProps({
  mode: { type: String, required: true },
  changeStats: { type: Object, default: null },
  changeMonth: { type: String, default: '2024-01' },
  changeMonths: { type: Array, default: () => [] },
  changeResultVersion: { type: String, default: '' },
  changeStatusReady: Boolean,
  changeStatusLoading: Boolean,
  changeStatusError: { type: String, default: '' },
})
const emit = defineEmits(['update:change-month', 'request-change-focus'])
const { cropWaterActiveDate } = storeToRefs(useMapStore())
const { panel, panelStyle, startDrag } = usePanelDrag()
const years = [2024, 2025, 2026]
const startDate = waterTimelineStartDate, endDate = waterTimelineEndDate, totalDays = waterTimelineDates.length
const fallbackChangeMonths = []
for (let yearValue = 2024, monthValue = 1; yearValue < 2026 || (yearValue === 2026 && monthValue <= 9);) {
  fallbackChangeMonths.push(`${yearValue}-${String(monthValue).padStart(2, '0')}`)
  monthValue += 1
  if (monthValue > 12) { yearValue += 1; monthValue = 1 }
}
const changeMonths = computed(() => props.changeMonths.length ? props.changeMonths : fallbackChangeMonths)
const date = computed(() => props.mode === 'change'
  ? (props.changeMonth || cropWaterActiveDate.value?.slice(0, 7) || changeMonths.value[0])
  : cropWaterActiveDate.value)
const previousDate = computed(() => {
  if (props.mode === 'change') {
    const [yearPart, monthPart] = date.value.split('-').map(Number)
    const current = new Date(Date.UTC(yearPart, monthPart - 2, 1))
    return current.toISOString().slice(0, 7)
  }
  const [yearPart, monthPart, dayPart] = date.value.split('-').map(Number)
  const current = new Date(Date.UTC(yearPart, monthPart - 1, dayPart - 1))
  return current.toISOString().slice(0, 10)
})
const year = computed(() => Number(date.value.slice(0, 4)))
const seasonYear = computed(() => getWaterSeasonYear(date.value) ?? year.value)
const displayPreviousDate = computed(() => props.mode === 'change' && loading.value
  ? previousDate.value
  : change.value?.previousMonth || change.value?.previousDate || previousDate.value)
const index = computed(() => props.mode === 'change'
  ? Math.max(changeMonths.value.indexOf(date.value), 0)
  : getWaterTimelineIndex(date.value) ?? 0)
const timelineStart = computed(() => props.mode === 'change' ? changeMonths.value[0] : startDate)
const timelineEnd = computed(() => props.mode === 'change' ? changeMonths.value[changeMonths.value.length - 1] : endDate)
const timelineCount = computed(() => props.mode === 'change' ? Math.max(changeMonths.value.length, 1) : totalDays)
const timelineYears = computed(() => props.mode === 'change'
  ? [...new Set(changeMonths.value.map(value => Number(value.slice(0, 4))).filter(Number.isFinite))]
  : years)
const growingStart = computed(() => getWaterTimelineIndex(`${year.value}-04-01`) ?? 0)
const growingEnd = computed(() => getWaterTimelineIndex(`${year.value}-09-27`) ?? totalDays - 1)
const collapsed = ref(false), playing = ref(false), loading = ref(false), message = ref('')
const pendingChangeFocus = ref(true)
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
const changeCards = computed(() => {
  const rising = formatCompact(change.value?.rising, '块')
  const falling = formatCompact(change.value?.falling, '块')
  const stable = formatCompact(change.value?.stable, '块')
  const current = formatCompact(change.value?.currentTotal, 'm³')
  const previous = formatCompact(change.value?.previousTotal, 'm³')
  const delta = formatCompact(change.value?.deltaTotal, 'm³', true)
  return [
    { label: '耗水量上升地块', ...rising, note: formatRate(change.value?.risingRate), tone: 'increase' },
    { label: '耗水量下降地块', ...falling, note: formatRate(change.value?.fallingRate), tone: 'decrease' },
    { label: '耗水量持平地块', ...stable, note: formatRate(change.value?.stableRate), tone: 'unchanged' },
    { label: '当月区域耗水量', ...current, tone: '' },
    { label: '上月区域耗水量', ...previous, tone: '' },
    { label: '月变化量', ...delta, tone: deltaClass.value }
  ]
})
const monthly = computed(() => annual.value?.monthly || [])
const monthlyMax = computed(() => Math.max(...monthly.value, 1))
const history = computed(() => (change.value?.history || []).filter(item => item.year <= year.value).sort((a, b) => a.year - b.year))
const historyMax = computed(() => Math.max(...history.value.map(item => item.value), 1))
const deltaClass = computed(() => (change.value?.deltaTotal ?? 0) > 0 ? 'delta-increase' : (change.value?.deltaTotal ?? 0) < 0 ? 'delta-decrease' : 'delta-unchanged')
const apiBase = (process.env.VUE_APP_CROP_WATER_API_BASE || 'http://localhost:5000').replace(/\/$/, '')
let controller = null, requestId = 0, loadTimer = null, playTimer = null, disposed = false
const monthlySummaryCache = new Map()
const monthlySummaryPending = new Map()
const monthlySummaryCacheLimit = 40
const changeLoadingDisplayMs = 2000
const playbackHoldMs = 3500

function formatNumber(value) { return value === undefined || value === null ? '--' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function formatInteger(value) { return value === undefined || value === null ? '--' : Math.round(value).toLocaleString('zh-CN') }
function formatRate(value) { return value === undefined || value === null ? '--' : `占比 ${value}%` }
function formatMonthLabel(value) {
  const match = /^(\d{4})-(\d{2})/.exec(value || '')
  return match ? `${match[1]}年${Number(match[2])}月` : value
}
function formatCompact(value, baseUnit, signed = false) {
  if (value === undefined || value === null) return { display: '--', unit: baseUnit }
  const number = Number(value)
  const absolute = Math.abs(number)
  const scale = absolute >= 100000000 ? 100000000 : absolute >= 10000 ? 10000 : 1
  const prefix = scale === 100000000 ? '亿' : scale === 10000 ? '万' : ''
  const digits = scale === 1 ? 0 : 2
  return {
    display: `${signed && number > 0 ? '+' : ''}${(number / scale).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`,
    unit: `${prefix}${baseUnit}`
  }
}
function stopPlay() { playing.value = false; clearInterval(playTimer); playTimer = null }
function waitForChangeLoadingDisplay(startedAt) {
  if (props.mode !== 'change') return Promise.resolve()
  const remaining = changeLoadingDisplayMs - (Date.now() - startedAt)
  return remaining > 0 ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve()
}
function schedulePlaybackAdvance() {
  clearTimeout(playTimer)
  if (!playing.value || disposed) return
  playTimer = setTimeout(() => {
    playTimer = null
    if (!playing.value || disposed) return
    pickIndex((index.value + 1) % timelineCount.value, false)
  }, playbackHoldMs)
}
function cacheMonthlySummary(month, value) {
  const key = getMonthlySummaryCacheKey(month)
  monthlySummaryCache.delete(key)
  monthlySummaryCache.set(key, value)
  while (monthlySummaryCache.size > monthlySummaryCacheLimit) {
    monthlySummaryCache.delete(monthlySummaryCache.keys().next().value)
  }
}
function getMonthlySummaryCacheKey(month) {
  return `${props.changeResultVersion || 'unversioned'}:${month}`
}
function requestMonthlySummary(month, signal) {
  const version = encodeURIComponent(props.changeResultVersion || 'unversioned')
  return fetch(`${apiBase}/api/water/change/monthly/summary?month=${encodeURIComponent(month)}&v=${version}`, {
    cache: 'no-cache',
    signal,
  })
}
function prefetchAdjacentSummaries(month) {
  const currentIndex = changeMonths.value.indexOf(month)
  const neighbors = [changeMonths.value[currentIndex - 1], changeMonths.value[currentIndex + 1]].filter(Boolean)
  const idle = window.requestIdleCallback || ((callback) => setTimeout(callback, 350))
  idle(() => {
    neighbors.forEach((neighbor) => {
      const cacheKey = getMonthlySummaryCacheKey(neighbor)
      if (monthlySummaryCache.has(cacheKey) || monthlySummaryPending.has(cacheKey)) return
      const pending = requestMonthlySummary(neighbor)
        .then(async (response) => {
          if (!response.ok) return
          const normalized = normalizeChangeData(await response.json())
          if (normalized && !disposed) cacheMonthlySummary(neighbor, normalized)
        })
        .catch(() => {})
        .finally(() => monthlySummaryPending.delete(cacheKey))
      monthlySummaryPending.set(cacheKey, pending)
    })
  })
}
function pickIndex(value, requestFocus = true) {
  if (props.mode === 'change') {
    pendingChangeFocus.value = requestFocus
    emit('update:change-month', changeMonths.value[value] || changeMonths.value[0])
  }
  else cropWaterActiveDate.value = getWaterTimelineDate(value)
}
function pickDate(value) {
  stopPlay()
  if (props.mode === 'change') {
    if (changeMonths.value.includes(value)) {
      pendingChangeFocus.value = true
      emit('update:change-month', value)
    }
    return
  }
  const nextIndex = getWaterTimelineIndex(value)
  if (nextIndex !== null) pickIndex(nextIndex)
}
function togglePlay() {
  if (playing.value) return stopPlay()
  playing.value = true
  if (props.mode === 'change') schedulePlaybackAdvance()
  else playTimer = setInterval(() => pickIndex((index.value + 1) % timelineCount.value, false), 1200)
}
async function loadData() {
  const startedAt = Date.now()
  const id = ++requestId
  if (props.mode === 'change' && !props.changeStatusReady) {
    loading.value = props.changeStatusLoading
    change.value = null
    message.value = props.changeStatusError || (props.changeStatusLoading ? '正在确认月度地块数据状态…' : '月度地块数据尚未就绪')
    return
  }
  controller?.abort(); controller = new AbortController()
  const activeController = controller
  // 月度全量统计首次计算可能较慢；年度接口仍维持原有超时。
  const timeoutMs = props.mode === 'annual' ? 8000 : 120000
  const timeout = setTimeout(() => activeController.abort(), timeoutMs)
  loading.value = true
  if (props.mode === 'annual') annual.value = null
  else {
    const cached = monthlySummaryCache.get(getMonthlySummaryCacheKey(date.value))
    if (cached) change.value = cached
    if (pendingChangeFocus.value) {
      pendingChangeFocus.value = false
      emit('request-change-focus')
    }
  }
  try {
    const endpoint = props.mode === 'annual'
      ? `/api/water/annual?year=${seasonYear.value}&date=${date.value}`
      : `/api/water/change/monthly/summary?month=${date.value}`
    const response = props.mode === 'change'
      ? await requestMonthlySummary(date.value, activeController.signal)
      : await fetch(apiBase + endpoint, { signal: activeController.signal })
    const payload = await response.json()
    await waitForChangeLoadingDisplay(startedAt)
    if (disposed || id !== requestId) return
    if (!response.ok) {
      if (props.mode === 'change') change.value = monthlySummaryCache.get(getMonthlySummaryCacheKey(date.value)) || null
      message.value = payload?.message || payload?.data?.message || '耗水数据暂时不可用，请检查服务连接'
      return
    }
    const normalized = props.mode === 'annual' ? normalizeAnnualData(payload) : normalizeChangeData(payload)
    if (props.mode === 'annual') annual.value = normalized
    else {
      change.value = normalized
      if (normalized) {
        cacheMonthlySummary(date.value, normalized)
        prefetchAdjacentSummaries(date.value)
      }
    }
    message.value = normalized ? '数据已接入' : payload?.message || payload?.data?.message || '当前年份暂无耗水数据'
  } catch (error) {
    if (!disposed && id === requestId) await waitForChangeLoadingDisplay(startedAt)
    if (!disposed && id === requestId) {
      if (props.mode === 'change') change.value = monthlySummaryCache.get(getMonthlySummaryCacheKey(date.value)) || null
      message.value = error?.name === 'AbortError'
        ? '全研究区统计耗时较长，请稍后重新选择日期'
        : '耗水数据暂时不可用，请检查服务连接'
    }
  } finally {
    clearTimeout(timeout)
    if (!disposed && id === requestId) {
      loading.value = false
      if (props.mode === 'change' && playing.value) schedulePlaybackAdvance()
    }
  }
}
watch(() => `${props.mode}:${date.value}:${props.changeResultVersion}:${props.changeStatusReady}:${props.changeStatusLoading}:${props.changeStatusError}`, () => {
  controller?.abort(); requestId++; if (props.mode === 'annual') annual.value = null; loading.value = true
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
.analysis-scope { margin: -5px 0 12px; color: #52708d; font-size: 11px; }
.analysis-loading { position: relative; height: 4px; margin: -4px 0 12px; overflow: hidden; border-radius: 999px; background: #e5edf6; }
.analysis-loading i { position: absolute; top: 0; bottom: 0; width: 42%; border-radius: inherit; background: linear-gradient(90deg, #2f85ed, #55c9f5); animation: analysis-progress 1.15s ease-in-out infinite; }
@keyframes analysis-progress { from { left: -42%; } to { left: 100%; } }
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
.change-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.change-metric-grid article { min-height: 66px; padding: 10px 11px; background: #f5f8fd; border: 1px solid #e3ebf5; border-radius: 6px; box-sizing: border-box; }
.change-metric-grid.is-refreshing,.analysis-chart.is-refreshing { opacity: .62; transition: opacity .18s ease; }
.change-metric-grid span { display: block; color: #708198; font-size: 11px; }
.change-metric-grid strong { display: inline-block; margin-top: 6px; color: var(--ink-500); font-size: 17px; line-height: 1; }
.change-metric-grid small { margin-left: 5px; color: var(--ink-300); font-size: 10px; white-space: nowrap; }
.change-metric-grid .increase strong,.change-metric-grid .delta-increase strong { color: #c54e58; }
.change-metric-grid .decrease strong,.change-metric-grid .delta-decrease strong { color: #3978c5; }
.change-metric-grid .unchanged strong,.change-metric-grid .delta-unchanged strong { color: #768493; }
.change-distribution { display: flex; gap: 2px; height: 22px; overflow: hidden; border-radius: 4px; background: #edf2f7; }
.change-distribution i { display: block; min-width: 2px; }
.change-distribution .increase { background: #D85B61; }
.change-distribution .decrease { background: #4D8FDB; }
.change-distribution .unchanged { background: #AAB4BE; }
.change-distribution-labels { display: flex; justify-content: space-between; margin-top: 5px; color: var(--ink-300); font-size: 10px; }
.empty-data { margin: 20px 0; text-align: center; color: var(--ink-300); font-size: 12px; }
.monthly-bars,.history-bars { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; height: 145px; }
.monthly-bars > div,.history-bars > div { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 0; }
.monthly-bars i,.history-bars i { display: block; width: 16px; max-width: 70%; min-height: 2px; border-radius: 2px 2px 0 0; background: linear-gradient(#46acfa, #156ee4); }
.monthly-bars small,.history-bars small,.history-bars span { margin-top: 5px; font-size: 9px; color: var(--ink-300); }
.history-bars span { margin: 0 0 3px; }
</style>
