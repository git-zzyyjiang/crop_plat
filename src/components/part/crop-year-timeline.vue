<template>
  <div ref="panel" class="yt-panel" :style="panelStyle">
    <!-- 这一条既是标题也是拖动窗口的把手 -->
    <div class="yt-bar" @pointerdown="startDrag">
      <span class="yt-grip" aria-hidden="true"></span>
      <span class="yt-title">年份时间轴</span>
    </div>
    <div class="yt-body">
      <button
        class="yt-play"
        :title="playing ? '暂停' : '播放'"
        @click="togglePlay"
      >
        <img :src="playing ? '/img/24gl-pause2.png' : '/img/24gl-play.png'" alt="">
      </button>
      <input
        class="yt-range"
        type="range"
        min="0"
        :max="years.length - 1"
        step="1"
        :value="index"
        :style="{ '--timeline-progress': progress }"
        aria-label="选择年份"
        @input="onDrag"
      >
    </div>
    <div class="yt-ticks">
      <span v-for="year in years" :key="year" :class="{ active: year === currentYear }">{{ year }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import { CROP_YEARS } from '@/utils/crop-types'

const store = useMapStore()
const { cropYear } = storeToRefs(store)
const { panel, panelStyle, startDrag } = usePanelDrag()

const years = CROP_YEARS
const currentYear = computed(() => Number(cropYear.value))
const index = computed(() => Math.max(years.indexOf(currentYear.value), 0))
const progress = computed(() => (years.length > 1 ? index.value / (years.length - 1) * 100 : 0) + '%')

// 播放：每 2 秒前进一年，到 2026 自动停
const playing = ref(false)
let timer = null
const stop = () => {
  if (timer) clearInterval(timer)
  timer = null
  playing.value = false
}
const togglePlay = () => {
  if (playing.value) {
    stop()
    return
  }
  if (index.value >= years.length - 1) store.setCropYear(years[0])
  playing.value = true
  timer = setInterval(() => {
    const next = years.indexOf(Number(cropYear.value)) + 1
    if (next >= years.length) {
      stop()
      return
    }
    store.setCropYear(years[next])
  }, 2000)
}

const onDrag = evt => {
  stop()
  const year = years[Number(evt.target.value)]
  if (year !== undefined) store.setCropYear(year)
}

onBeforeUnmount(stop)
</script>

<style scoped>
/* 样式沿用原来的日期时间轴，去掉日期输入框后只留播放 + 滑杆 + 年份刻度 */
.yt-panel {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 1200;
  width: min(520px, calc(100vw - 32px));
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

.yt-bar { display: flex; align-items: center; gap: 9px; height: 24px; cursor: move; touch-action: none; }
.yt-grip { flex: 0 0 auto; width: 12px; height: 12px; background-image: radial-gradient(rgba(210, 234, 250, .6) 1px, transparent 1px); background-size: 4px 4px; }
.yt-title { font-size: 15px; font-weight: 600; color: #e5f3ff; white-space: nowrap; letter-spacing: .5px; }
.yt-body { display: flex; align-items: center; gap: 12px; margin-top: 10px; }

.yt-play {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(175, 223, 255, .4);
  border-radius: 50%;
  background: linear-gradient(145deg, #49b3fb, #2379e2);
  box-shadow: 0 2px 10px rgba(34, 139, 234, .28);
  cursor: pointer;
  transition: box-shadow .2s, transform .2s;
}
.yt-play:hover { transform: translateY(-1px); box-shadow: 0 3px 14px rgba(72, 180, 255, .45); }
.yt-play img { width: 17px; height: 17px; display: block; filter: brightness(0) invert(1); }

.yt-range {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  appearance: none;
  height: 5px;
  border: none;
  border-radius: 5px;
  background: linear-gradient(to right, #66caff 0%, #398ff1 var(--timeline-progress, 0%), rgba(208, 228, 242, .24) var(--timeline-progress, 0%), rgba(208, 228, 242, .24) 100%);
  cursor: pointer;
}
.yt-range::-webkit-slider-thumb { appearance: none; width: 17px; height: 17px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); cursor: pointer; }
.yt-range::-moz-range-thumb { width: 13px; height: 13px; border: 2px solid #e8f7ff; border-radius: 50%; background: #46acfa; box-shadow: 0 0 0 4px rgba(88, 181, 255, .14), 0 2px 6px rgba(0, 0, 0, .3); cursor: pointer; }
.yt-play:focus-visible, .yt-range:focus-visible { outline: 2px solid #8cd8ff; outline-offset: 4px; }

/* 刻度对齐滑杆两端：左边让开播放按钮，右边留出半个滑块 */
.yt-ticks {
  display: flex;
  justify-content: space-between;
  margin: 8px 8px 0 52px;
}
.yt-ticks span { font-size: 12px; white-space: nowrap; color: #b9d0df; }
.yt-ticks span.active { color: #eaf6ff; font-weight: 600; }

@media (max-width: 520px) {
  .yt-panel { padding: 10px 12px 12px; bottom: 18px; }
  .yt-title { font-size: 13px; }
  .yt-body { gap: 9px; }
  .yt-ticks { margin-left: 49px; margin-right: 6px; }
}
</style>
