<template>
  <div ref="panel" class="dt-panel" :style="panelStyle">
    <div class="dt-bar" @pointerdown="startDrag">
      <span class="dt-grip" aria-hidden="true"></span><span class="dt-title">日期时间轴</span>
      <span class="dt-status">{{ index + 1 }} / {{ count }}</span>
    </div>
    <div class="dt-body">
      <button class="dt-play" type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停逐日播放' : '播放逐日变化'" @click="$emit('toggle-play')">
        <img :src="playing ? '/img/24gl-pause2.png' : '/img/24gl-play.png'" alt="">
      </button>
      <input class="dt-range" type="range" min="0" :max="count - 1" step="1" :value="index" :style="{ '--timeline-progress': (count > 1 ? index / (count - 1) * 100 : 0) + '%' }" aria-label="选择耗水日期" @input="$emit('select-index', Number($event.target.value))">
      <input class="dt-date" type="date" :min="start" :max="end" :value="date" aria-label="选择耗水日期" @change="$emit('select-date', $event.target.value)">
    </div>
    <div class="dt-ticks">
      <template v-if="years.length"><button v-for="year in years" :key="year" type="button" :style="{ left: yearPosition(year) + '%' }" @click="$emit('select-date', year + '-06-15')">{{ year }}</button></template>
      <template v-else><span>{{ start }}</span><span class="dt-last">{{ end }}</span></template>
    </div>
  </div>
</template>
<script setup>
/* global defineProps, defineEmits */
import { usePanelDrag } from '@/composables/usePanelDrag'
const props = defineProps({ index: { type: Number, required: true }, count: { type: Number, required: true }, playing: Boolean, date: String, start: String, end: String, years: { type: Array, default: () => [] } })
defineEmits(['select-index', 'select-date', 'toggle-play'])
const { panel, panelStyle, startDrag } = usePanelDrag()
const yearPosition = year => (Date.parse(year + '-01-01') - Date.parse(props.start)) / Math.max(86400000, Date.parse(props.end) - Date.parse(props.start)) * 100
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

.dt-status { margin-left: auto; color: #b9d0df; font-size: 12px; }
.dt-ticks span:first-child { left: 0; }
.dt-ticks .dt-last { left: 100%; }
.dt-ticks button { position: absolute; transform: translateX(-50%); padding: 0; color: #b9d0df; background: none; border: 0; font: inherit; font-size: 12px; cursor: pointer; }
</style>
