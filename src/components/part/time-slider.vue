<template>
  <div v-if="visible" ref="panel" class="dt-panel" :style="panelStyle">
    <div class="dt-bar" @pointerdown="startDrag">
      <span class="dt-grip" aria-hidden="true"></span>
      <span class="dt-title">年度时间轴</span>
      <span class="dt-state">{{ position }} · 年度数据</span>
    </div>
    <div class="dt-body">
      <button class="dt-play" type="button" :title="playing ? '暂停' : '播放'" @click="togglePlay">
        <img :src="playing ? '/img/24gl-pause2.png' : '/img/24gl-play.png'" alt="">
      </button>
      <input class="dt-range" type="range" min="0" :max="YEARS.length - 1" step="1"
        :value="yearIndex" :style="{ '--timeline-progress': progress + '%' }" aria-label="选择年份"
        @input="pickIndex(Number($event.target.value))">
      <select class="dt-date" :value="year" aria-label="当前年份" @change="pickYear(Number($event.target.value))">
        <option v-for="item in YEARS" :key="item" :value="item">{{ item }} 年</option>
      </select>
    </div>
    <div class="dt-ticks">
      <button v-for="(item, index) in YEARS" :key="item" type="button" :class="{ active: item === year }"
        :style="{ left: (index / (YEARS.length - 1) * 100) + '%' }" @click="pickYear(item)">{{ item }}</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'

const YEARS = [2024, 2025, 2026]
const TEMPORAL_IDS = ['sentinel1', 'sentinel2', 'temperature', 'precipitation']
const store = useMapStore()
const { temporalYear, temporalMonth, temporalLayerEnabled } = storeToRefs(store)
const playing = ref(false)
let playTimer = null

const year = computed(() => Number(temporalYear.value))
const yearIndex = computed(() => Math.max(0, YEARS.indexOf(year.value)))
const progress = computed(() => yearIndex.value / (YEARS.length - 1) * 100)
const position = computed(() => `${yearIndex.value + 1} / ${YEARS.length}`)
const visible = computed(() => TEMPORAL_IDS.some(id => !!temporalLayerEnabled.value[id]))
const { panel, panelStyle, startDrag } = usePanelDrag()

const pickYear = value => store.setTemporalPeriod({ year: value, month: temporalMonth.value })
const pickIndex = index => pickYear(YEARS[index])
const stopPlay = () => {
  playing.value = false
  if (playTimer) window.clearInterval(playTimer)
  playTimer = null
}
const togglePlay = () => {
  if (playing.value) return stopPlay()
  playing.value = true
  playTimer = window.setInterval(() => pickIndex((yearIndex.value + 1) % YEARS.length), 1600)
}

onBeforeUnmount(stopPlay)
watch(visible, value => { if(!value) stopPlay() })
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
.dt-range { flex: 1 1 auto; min-width: 0; height: 5px; margin: 0; appearance: none; border: 0; border-radius: 5px; background: linear-gradient(to right, #66caff 0%, #398ff1 var(--timeline-progress), rgba(208, 228, 242, .24) var(--timeline-progress), rgba(208, 228, 242, .24) 100%); cursor: pointer; }
.dt-range::-webkit-slider-thumb { width: 17px; height: 17px; appearance: none; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); }
.dt-range::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); }
.dt-date { flex: 0 0 auto; width: 142px; height: 32px; padding: 4px 8px; box-sizing: border-box; color: #eaf6ff; background: rgba(202, 227, 245, .09); border: 1px solid rgba(210, 234, 250, .23); border-radius: 8px; font-family: inherit; font-size: 14px; cursor: pointer; }
.dt-date option { color: #173044; }
.dt-ticks { position: relative; height: 16px; margin: 8px 154px 0 44px; }
.dt-ticks button { position: absolute; padding: 0; transform: translateX(-50%); color: #b9d0df; background: none; border: 0; font: inherit; font-size: 12px; cursor: pointer; }
.dt-ticks button.active { color: #8cd8ff; font-weight: 600; }
.dt-play:focus-visible, .dt-range:focus-visible, .dt-date:focus-visible, .dt-ticks button:focus-visible { outline: 2px solid #8cd8ff; outline-offset: 4px; }
@media (max-width: 520px) { .dt-panel { bottom: 18px; padding: 10px 12px 12px; } .dt-date { width: 124px; font-size: 12px; } .dt-ticks { margin-right: 133px; margin-left: 41px; } }
</style>
