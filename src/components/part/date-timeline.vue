<template>
  <div ref="panel" class="dt-panel" :style="panelStyle">
    <!-- 这一条既是标题也是拖动窗口的把手 -->
    <div class="dt-bar" @pointerdown="startDrag">
      <span class="dt-grip" aria-hidden="true"></span>
      <span class="dt-title">日期时间轴</span>
    </div>
    <div class="dt-body">
      <button
        class="dt-play"
        :disabled="parcelTimelineDates.length < 2"
        :title="parcelTimelinePlaying ? '暂停' : '播放'"
        @click="togglePlay"
      >
        <img :src="parcelTimelinePlaying ? '/img/24gl-pause2.png' : '/img/24gl-play.png'" alt="">
      </button>
      <input
        class="dt-range"
        type="range"
        min="0"
        :max="maxIndex"
        step="1"
        :value="parcelTimelineIndex"
        :style="{ '--timeline-progress': (maxIndex ? parcelTimelineIndex / maxIndex * 100 : 0) + '%' }"
        aria-label="选择日期"
        :disabled="parcelTimelineDates.length === 0"
        @input="onDrag"
      >
      <input
        class="dt-date"
        type="date"
        :min="firstDate"
        :max="lastDate"
        :value="currentDate"
        :disabled="parcelTimelineDates.length === 0"
        @change="onPickDate"
      >
    </div>
    <div class="dt-ticks" ref="ticksRef">
      <span v-for="tick in ticks" :key="tick.label" :style="{ left: tick.left }">{{ tick.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'

const store = useMapStore()
const {
  parcelTimelineDates,
  parcelTimelineIndex,
  parcelTimelinePlaying
} = storeToRefs(store)

const maxIndex = computed(() => Math.max(parcelTimelineDates.value.length - 1, 0))
const currentDate = computed(() => store.getCurrentParcelDate())

const dateOf = item => (typeof item === 'string' ? item : (item && item.date) || '')
const firstDate = computed(() => dateOf(parcelTimelineDates.value[0]))
const lastDate = computed(() => {
  const list = parcelTimelineDates.value
  return list.length ? dateOf(list[list.length - 1]) : ''
})

// 刻度可用宽度，用来决定年份标签要不要抽稀
const ticksRef = ref(null)
const ticksWidth = ref(0)
let ticksObserver = null

// 年份刻度：取每年第一条日期所在的位置，位置不够时按间隔抽稀，避免年份挤在一起
const ticks = computed(() => {
  const list = parcelTimelineDates.value
  const total = list.length
  if (total === 0) return []
  const last = Math.max(total - 1, 1)
  const seen = new Set()
  const marks = []
  list.forEach((item, i) => {
    const date = dateOf(item)
    if (!date) return
    const year = date.slice(0, 4)
    if (seen.has(year)) return
    seen.add(year)
    marks.push({ label: year, left: (i / last) * 100 + '%' })
  })
  const width = ticksWidth.value
  if (!width || marks.length < 2) return marks
  // 相邻标签之间至少要留出的间距（年份标签约 25 像素宽，再留一点空隙）
  const MIN_GAP = 34
  // 相邻标签的实际间距是 width * step / (marks.length - 1)，据此反推需要的步长
  const step = Math.ceil((MIN_GAP * (marks.length - 1)) / width)
  return step <= 1 ? marks : marks.filter((_, i) => i % step === 0)
})

const onDrag = evt => store.selectParcelTimelineIndex(evt.target.value)
const onPickDate = evt => store.selectParcelTimelineDate(evt.target.value)
const togglePlay = () => store.toggleParcelTimelinePlay()

// 窗口拖动
const { panel, panelStyle, startDrag } = usePanelDrag()

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && ticksRef.value) {
    ticksObserver = new ResizeObserver(entries => {
      entries.forEach(entry => { ticksWidth.value = entry.contentRect.width })
    })
    ticksObserver.observe(ticksRef.value)
  }
  // 日期列表由 store 里 getParcelTimelineDates 决定数据来源，已经加载过就不重复请求
  if (parcelTimelineDates.value.length === 0) store.getParcelTimelineDates()
})

onBeforeUnmount(() => {
  if (ticksObserver) {
    ticksObserver.disconnect()
    ticksObserver = null
  }
})
</script>

<style scoped>
.dt-panel {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 1200;
  width: min(580px, calc(100vw - 32px));
  padding: 12px 18px 14px;
  box-sizing: border-box;
  background: linear-gradient(135deg, rgba(28, 48, 61, .78), rgba(14, 31, 43, .68));
  border: 1px solid rgba(222, 239, 255, .25);
  border-radius: 16px;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(3, 16, 27, .24), inset 0 1px 0 rgba(255, 255, 255, .1);
  color: #edf6ff;
  font-size: 14px;
  user-select: none;
}
.dt-bar { display: flex; align-items: center; gap: 9px; height: 24px; cursor: move; touch-action: none; }
.dt-grip { flex: 0 0 auto; width: 12px; height: 12px; background-image: radial-gradient(rgba(210, 234, 250, .6) 1px, transparent 1px); background-size: 4px 4px; }
.dt-title { font-size: 15px; font-weight: 600; color: #e5f3ff; white-space: nowrap; letter-spacing: .5px; }
.dt-body { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.dt-play { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid rgba(175, 223, 255, .4); border-radius: 50%; background: linear-gradient(145deg, #49b3fb, #2379e2); box-shadow: 0 2px 10px rgba(34, 139, 234, .28); cursor: pointer; transition: box-shadow .2s, transform .2s; }
.dt-play:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 3px 14px rgba(72, 180, 255, .45); }
.dt-play:disabled { opacity: .4; cursor: default; }
.dt-play img { width: 17px; height: 17px; display: block; filter: brightness(0) invert(1); }
.dt-range { flex: 1 1 auto; min-width: 0; margin: 0; appearance: none; height: 5px; border: none; border-radius: 5px; background: linear-gradient(to right, #66caff 0%, #398ff1 var(--timeline-progress, 0%), rgba(208, 228, 242, .24) var(--timeline-progress, 0%), rgba(208, 228, 242, .24) 100%); cursor: pointer; }
.dt-range:disabled { opacity: .5; cursor: default; }
.dt-range::-webkit-slider-thumb { appearance: none; width: 17px; height: 17px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); cursor: pointer; }
.dt-range::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); cursor: pointer; }
.dt-date { flex: 0 0 auto; width: 142px; box-sizing: border-box; height: 32px; padding: 4px 8px; font-family: inherit; font-size: 14px; color: #eaf6ff; color-scheme: dark; background: rgba(202, 227, 245, .09); border: 1px solid rgba(210, 234, 250, .23); border-radius: 8px; cursor: pointer; }
.dt-date:hover { border-color: rgba(141, 210, 255, .6); }
.dt-date:disabled { opacity: .5; cursor: default; }
.dt-play:focus-visible, .dt-range:focus-visible, .dt-date:focus-visible { outline: 2px solid #8cd8ff; outline-offset: 4px; }
.dt-ticks { position: relative; height: 16px; margin: 8px 154px 0 44px; }
.dt-ticks span { position: absolute; transform: translateX(-50%); font-size: 12px; white-space: nowrap; color: #b9d0df; }
@media (max-width: 520px) {
  .dt-panel { padding: 10px 12px 12px; bottom: 18px; }
  .dt-title { font-size: 13px; }
  .dt-body { gap: 9px; }
  .dt-date { width: 124px; font-size: 12px; }
  .dt-ticks { margin-left: 41px; margin-right: 133px; }
}
</style>
