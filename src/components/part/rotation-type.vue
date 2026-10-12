<template>
  <section ref="panel" class="rt-panel" :style="panelStyle">
    <!-- 标题栏也是拖动把手 -->
    <header class="rt-bar" @pointerdown="startDrag">
      <span class="rt-grip" aria-hidden="true"></span>
      <span class="rt-title">轮作类型</span>
    </header>

    <ul class="rt-list">
      <li
        v-for="item in items"
        :key="item.sequence"
        class="rt-item"
        :class="{ clicked: isActive(item.sequence) }"
        :title="activeSequence ? (isActive(item.sequence) ? '再次点击显示前十种全部' : '只显示该轮作类型') : '点击只显示该轮作类型'"
        @click="clickItem(item.sequence)"
      >
        <span class="rt-swatch" :style="{ backgroundColor: item.color }"></span>
        <span class="rt-label">{{ item.label }}</span>
        <span class="rt-count">{{ item.countText }}</span>
      </li>
    </ul>

    <p class="rt-note">
      <template v-if="items.length">
        2024—2026 三年序列，共 {{ totalText }} 种组合，前十种单独列出，其余归入「其他」。
      </template>
      <template v-else>正在读取轮作数据…</template>
    </p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { usePanelDrag } from '@/composables/usePanelDrag'
import useMapStore from '@/stores/map'
import { cropShortName, ROTATION_OTHER_KEY } from '@/utils/crop-types'

const store = useMapStore()
const { rotationSelected } = storeToRefs(store)
const { panel, panelStyle, startDrag } = usePanelDrag()

const stats = ref(null)
const activeSequence = computed(() => rotationSelected.value || '')
// 没选中时前十种都亮着，选中后只有这一类是亮的
const isActive = sequence => !activeSequence.value || activeSequence.value === sequence
const clickItem = sequence => store.toggleRotationType(sequence)
const totalText = computed(() => Number((stats.value && stats.value.sequenceTotal) || 0).toLocaleString('zh-CN'))

// 轮作类型直接用 1009 数据里 SEQUENCE 的统计结果，
// 颜色也从同一份数据来，和地图上的 crop-rotation-10 样式一致
const items = computed(() => {
  const list = (stats.value && stats.value.topSequences) || []
  const rows = list.map(item => ({
    sequence: item.sequence,
    color: item.color,
    label: item.codes.map(cropShortName).join('—'),
    countText: Number(item.count).toLocaleString('zh-CN')
  }))
  // 进不了前十的序列在图上和这里统一叫「其他」
  const other = stats.value && stats.value.other
  if (other) {
    rows.push({
      sequence: ROTATION_OTHER_KEY,
      color: other.color,
      label: '其他',
      countText: Number(other.count).toLocaleString('zh-CN')
    })
  }
  return rows
})

onMounted(async () => {
  stats.value = await store.getCropTemporalStats()
})
</script>

<style scoped>
.rt-panel {
  position: fixed;
  right: 14px;
  bottom: 100px;
  z-index: 1200;
  width: 244px;
  padding: 0 0 10px;
  box-sizing: border-box;
  color: var(--ink-900);
  background-color: rgba(255, 255, 255, 0.97);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(6, 34, 84, 0.22);
  pointer-events: auto;
}

.rt-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 11px;
  cursor: move;
  touch-action: none;
}

.rt-grip {
  width: 10px;
  height: 10px;
  background-image: radial-gradient(#a9b8cc 1px, transparent 1px);
  background-size: 4px 4px;
}

.rt-title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 600;
}

.rt-list {
  margin: 0;
  padding: 0 11px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.rt-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

/* 图例色块和地图配色同源，见 geoserver/crop-rotation-10.sld */
.rt-swatch {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .1);
}

.rt-item {
  cursor: pointer;
}

.rt-item:not(.clicked) .rt-swatch {
  opacity: .3;
}

.rt-item:not(.clicked) .rt-label,
.rt-item:not(.clicked) .rt-count {
  color: #b3bfcd;
}

.rt-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ink-700);
}

.rt-count {
  flex: 0 0 auto;
  color: var(--ink-300);
  font-variant-numeric: tabular-nums;
}

.rt-note {
  margin: 10px 11px 0;
  padding-top: 8px;
  color: var(--ink-300);
  border-top: 1px dashed #e3ecf8;
  font-size: 11px;
  line-height: 1.6;
}
</style>
