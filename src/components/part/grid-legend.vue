<template>
  <section ref="panel" class="gl-panel" :style="panelStyle">
    <header class="gl-bar" @pointerdown="startDrag">
      <span class="gl-grip" aria-hidden="true"></span>
      <span class="gl-title">网格图例</span>
    </header>

    <ul class="gl-list">
      <li v-for="item in items" :key="item.value">
        <span class="gl-swatch" :style="{ backgroundColor: item.color }"></span>
        <span class="gl-label">{{ item.value }} 种作物</span>
        <span class="gl-count">{{ item.countText }}</span>
      </li>
    </ul>

    <p class="gl-note">
      颜色越深，这个 10km 网格里的作物种类越多；右侧是该档的网格数。
    </p>
  </section>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { usePanelDrag } from '@/composables/usePanelDrag'
import useMapStore from '@/stores/map'

const store = useMapStore()
const { panel, panelStyle, startDrag } = usePanelDrag()

// 色阶和每档网格数都来自 gridDiversityStats.json，
// 和地图样式 grid-diversity-10 是同一份来源
const items = computed(() => {
  const stats = store.gridStats
  const palette = (stats && stats.palette) || []
  const histogram = (stats && stats.cropTypeHistogram) || {}
  return palette.map((color, index) => ({
    value: index + 1,
    color,
    countText: Number(histogram[index + 1] || 0).toLocaleString('zh-CN')
  }))
})

onMounted(() => {
  store.getGridStats()
})
</script>

<style scoped>
.gl-panel {
  position: fixed;
  right: 14px;
  bottom: 100px;
  z-index: 1200;
  width: 208px;
  padding: 0 0 10px;
  box-sizing: border-box;
  color: var(--ink-900);
  background-color: rgba(255, 255, 255, 0.97);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(6, 34, 84, 0.22);
  pointer-events: auto;
}

.gl-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 11px;
  cursor: move;
  touch-action: none;
}

.gl-grip {
  width: 10px;
  height: 10px;
  background-image: radial-gradient(#a9b8cc 1px, transparent 1px);
  background-size: 4px 4px;
}

.gl-title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 600;
}

.gl-list {
  margin: 0;
  padding: 0 11px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gl-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.gl-swatch {
  flex: 0 0 auto;
  width: 26px;
  height: 12px;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .1);
}

.gl-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  color: var(--ink-700);
}

.gl-count {
  flex: 0 0 auto;
  color: var(--ink-300);
  font-variant-numeric: tabular-nums;
}

.gl-note {
  margin: 10px 11px 0;
  padding-top: 8px;
  color: var(--ink-300);
  border-top: 1px dashed #e3ecf8;
  font-size: 11px;
  line-height: 1.6;
}
</style>
