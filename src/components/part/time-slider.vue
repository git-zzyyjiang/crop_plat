<template>
  <div v-if="visible" ref="panel" class="dt-panel" :style="panelStyle">
    <div class="dt-bar" @pointerdown="startDrag">
      <span class="dt-grip" aria-hidden="true"></span>
      <span class="dt-title">日期时间轴</span>
      <span class="dt-state">{{ statusLabel }}</span>
    </div>
    <div class="dt-body">
      <button class="dt-play" type="button" :title="playing ? '暂停' : '播放'" @click="togglePlay">
        <img :src="playing ? '/img/24gl-pause2.png' : '/img/24gl-play.png'" alt="">
      </button>
      <div class="dt-range-wrap">
        <input class="dt-range" type="range" min="0" :max="sliderMax" step="1" :value="sliderIndex"
          :style="{ '--timeline-progress': progress + '%' }" :aria-label="monthly ? '选择月份' : '选择日期'"
          @input="pickIndex(Number($event.target.value))" @change="pickIndex(Number($event.target.value), true)">
      </div>
      <input v-if="monthly" class="dt-date" type="month" :min="startDate.slice(0,7)" :max="endDate.slice(0,7)" :value="date.slice(0,7)"
        aria-label="选择月份" @change="pickMonth($event.target.value)">
      <input v-else class="dt-date" type="date" :min="startDate" :max="endDate" :value="date"
        aria-label="选择日期" @change="pickDate($event.target.value)">
    </div>
    <div class="dt-ticks">
      <button v-for="year in years" :key="year" type="button" :style="{ left: yearPosition(year) + '%' }"
        @click="pickDate(`${year}-01-01`)">{{ year }}</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'

const START = '2024-01-01'
const store = useMapStore()
const { temporalDate, temporalLayerEnabled, temporalImageDates, temporalLayerInstances, temporalLayerStatus, temporalImageMonthly, temporalTemperatureEndDate } = storeToRefs(store)
const date = computed(() => temporalDate.value)
const monthly = computed(() => temporalImageMonthly.value && !temporalLayerEnabled.value.temperature)
const endDate = computed(() => temporalLayerEnabled.value.temperature
  ? temporalTemperatureEndDate.value
  : new Date().toISOString().slice(0,10))
const startDate = START
const dayCount = computed(() => Math.floor((Date.parse(`${endDate.value}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86400000) + 1)
const dayIndex = computed(() => Math.max(0, Math.min(dayCount.value - 1, Math.floor((Date.parse(`${date.value}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86400000))))
const monthCount = computed(() => (Number(endDate.value.slice(0,4)) - 2024) * 12 + Number(endDate.value.slice(5,7)))
const monthIndex = computed(() => (Number(date.value.slice(0,4)) - 2024) * 12 + Number(date.value.slice(5,7)) - 1)
const sliderMax = computed(() => monthly.value ? monthCount.value - 1 : dayCount.value - 1)
const sliderIndex = computed(() => monthly.value ? monthIndex.value : dayIndex.value)
const progress = computed(() => sliderMax.value > 0 ? sliderIndex.value / sliderMax.value * 100 : 0)
const years = computed(() => Array.from({length:Number(endDate.value.slice(0,4)) - 2024 + 1}, (_,i) => 2024 + i))
const visible = computed(() => ['sentinel1','sentinel2','temperature','precipitation'].some(id => !!temporalLayerEnabled.value[id]))
const sensorNames = {sentinel1:'S1', sentinel2:'S2'}
const formatShort = value => value ? `${Number(value.slice(0,4))}/${Number(value.slice(5,7))}/${Number(value.slice(8,10))}` : ''
const formatMonth = value => value ? `${Number(value.slice(0,4))}/${Number(value.slice(5,7))}` : ''
const statusLabel = computed(() => {
  const labels = ['sentinel1','sentinel2'].filter(id => temporalLayerEnabled.value[id]).map(id => {
    if(temporalLayerStatus.value[id] === 'loading') return `${sensorNames[id]} 搜索中…`
    if(temporalLayerStatus.value[id] === 'error') return `${sensorNames[id]} 暂无影像`
    const dateRange = temporalImageDates.value[id]
    if(!dateRange) return ''
    const [start, end] = dateRange.split('/')
    const format = monthly.value ? formatMonth : formatShort
    return `${sensorNames[id]} ${format(start)}${format(start) === format(end) ? '' : `–${format(end)}`}`
  }).filter(Boolean)
  if(temporalLayerEnabled.value.temperature){
    if(temporalLayerStatus.value.temperature === 'loading') labels.push('气温加载中…')
    else if(temporalLayerStatus.value.temperature === 'error') labels.push('气温数据暂不可用')
    else labels.push(`气温 ${formatShort(date.value)} 日均`)
  }
  if(temporalLayerEnabled.value.precipitation){
    if(temporalLayerStatus.value.precipitation === 'loading') labels.push('年累计降水加载中…')
    else if(temporalLayerStatus.value.precipitation === 'error') labels.push('年累计降水数据暂不可用')
    else {
      const year = Number(date.value.slice(0,4))
      const grid = temporalLayerInstances.value.precipitation?.get?.('temporalWeatherGrid')
      const periodEnd = grid?.periodEnd
      const endLabel = periodEnd && !grid.temporalComplete ? `（截至${Number(periodEnd.slice(5,7))}月${Number(periodEnd.slice(8,10))}日）` : ''
      labels.push(`年累计降水 ${year}${endLabel}`)
    }
  }
  if(labels.length) return labels.join(' · ')
  return `气象 ${(monthly.value ? formatMonth : formatShort)(date.value)}`
})
const yearPosition = year => monthly.value
  ? ((year - 2024) * 12) / Math.max(1, monthCount.value - 1) * 100
  : (Date.parse(`${year}-01-01T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / Math.max(86400000, Date.parse(`${endDate.value}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) * 100
const pickDate = value => store.setTemporalDate(value, true)
const monthAtIndex = index => {
  const monthDate = new Date(`${START}T00:00:00Z`)
  monthDate.setUTCMonth(monthDate.getUTCMonth() + index)
  return `${monthDate.toISOString().slice(0,7)}-01`
}
const pickMonth = value => value && pickDate(`${value}-01`)
const dateAtIndex = index => monthly.value
  ? monthAtIndex(index)
  : new Date(Date.parse(`${START}T00:00:00Z`) + index * 86400000).toISOString().slice(0,10)
const pickIndex = (index, flush=false) => store.setTemporalDate(monthly.value
  ? monthAtIndex(index)
  : new Date(Date.parse(`${START}T00:00:00Z`) + index * 86400000).toISOString().slice(0,10), flush)
const playing = ref(false)
let playTimer = null
const stopPlay = () => { playing.value = false; if(playTimer) window.clearInterval(playTimer); playTimer = null }
const nextIndex = () => sliderIndex.value >= sliderMax.value ? 0 : sliderIndex.value + 1
const preloadNext = index => {
  if(index >= 0 && index <= sliderMax.value) store.preloadTemporalDate(dateAtIndex(index))
}
const startPlayTimer = () => {
  if(playTimer) window.clearInterval(playTimer)
  if(!playing.value) return
  playTimer = window.setInterval(() => {
    const frameLoading = ['sentinel1','sentinel2','temperature','precipitation']
      .some(id => temporalLayerEnabled.value[id] && temporalLayerStatus.value[id] === 'loading')
    if(frameLoading) return
    const targetIndex = nextIndex()
    pickIndex(targetIndex)
    preloadNext(targetIndex >= sliderMax.value ? 0 : targetIndex + 1)
  }, 1800)
}
const togglePlay = () => {
  if(playing.value) return stopPlay()
  playing.value = true
  preloadNext(nextIndex())
  startPlayTimer()
}
watch(monthly, () => {
  if(!playing.value) return
  preloadNext(nextIndex())
  startPlayTimer()
})
const { panel, panelStyle, startDrag } = usePanelDrag()
watch(visible, value => { if(!value) stopPlay() })
onBeforeUnmount(stopPlay)
</script>

<style scoped>
.dt-panel { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 1200; width: min(580px, calc(100vw - 32px)); padding: 12px 18px 14px; box-sizing: border-box; color: #edf6ff; background: linear-gradient(135deg, rgba(28, 48, 61, .78), rgba(14, 31, 43, .68)); border: 1px solid rgba(222, 239, 255, .25); border-radius: 16px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 8px 28px rgba(3, 16, 27, .24), inset 0 1px 0 rgba(255, 255, 255, .1); font-size: 14px; user-select: none; }
.dt-bar { display: flex; align-items: center; gap: 9px; height: 24px; cursor: move; touch-action: none; }
.dt-grip { flex: 0 0 auto; width: 12px; height: 12px; background-image: radial-gradient(rgba(210, 234, 250, .6) 1px, transparent 1px); background-size: 4px 4px; }
.dt-title { color: #e5f3ff; font-size: 15px; font-weight: 600; white-space: nowrap; letter-spacing: .5px; }
.dt-state { margin-left: auto; overflow: hidden; color: #b9d0df; font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
.dt-body { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.dt-play { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid rgba(175, 223, 255, .4); border-radius: 50%; background: linear-gradient(145deg, #49b3fb, #2379e2); box-shadow: 0 2px 10px rgba(34, 139, 234, .28); cursor: pointer; }
.dt-play img { display: block; width: 17px; height: 17px; filter: brightness(0) invert(1); }
.dt-range-wrap { position: relative; flex: 1 1 auto; min-width: 0; height: 18px; display: flex; align-items: center; }
.dt-range { width: 100%; min-width: 0; height: 5px; margin: 0; appearance: none; border: 0; border-radius: 5px; background: linear-gradient(to right, #66caff 0%, #398ff1 var(--timeline-progress), rgba(208, 228, 242, .24) var(--timeline-progress), rgba(208, 228, 242, .24) 100%); cursor: pointer; }
.dt-range::-webkit-slider-thumb { width: 17px; height: 17px; appearance: none; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); }
.dt-range::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); }
.dt-date { flex: 0 0 auto; width: 142px; height: 32px; padding: 4px 8px; box-sizing: border-box; color: #eaf6ff; color-scheme: dark; background: rgba(202, 227, 245, .09); border: 1px solid rgba(210, 234, 250, .23); border-radius: 8px; font-family: inherit; font-size: 14px; cursor: pointer; }
.dt-ticks { position: relative; height: 16px; margin: 8px 154px 0 44px; }
.dt-ticks button { position: absolute; padding: 0; transform: translateX(-50%); color: #b9d0df; background: none; border: 0; font: inherit; font-size: 12px; cursor: pointer; }
.dt-ticks button:focus-visible, .dt-play:focus-visible, .dt-range:focus-visible, .dt-date:focus-visible { outline: 2px solid #8cd8ff; outline-offset: 4px; }
@media (max-width: 520px) { .dt-panel { bottom: 18px; padding: 10px 12px 12px; } .dt-date { width: 124px; font-size: 12px; } .dt-body { gap: 8px; } .dt-ticks { margin-right: 133px; margin-left: 41px; } .dt-state { max-width: 58%; } }
</style>
