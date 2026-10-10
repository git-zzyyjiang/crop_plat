<template>
  <section ref="panel" class="rt-panel" :style="panelStyle">
    <!-- 标题栏也是拖动把手 -->
    <header class="rt-bar" @pointerdown="startDrag">
      <span class="rt-grip" aria-hidden="true"></span>
      <span class="rt-title">轮作类型</span>
    </header>

    <ul class="rt-list">
      <li v-for="item in items" :key="item.label">
        <span class="rt-swatch" :style="{ backgroundColor: item.color }"></span>
        <span class="rt-label">{{ item.label }}</span>
      </li>
    </ul>

    <p class="rt-note">示例序列来自原型稿；逐地块轮作类型需要按地块统计 2024—2026 的作物序列，暂未接入，逐年主导作物见左侧统计面板。</p>
  </section>
</template>

<script setup>
import { usePanelDrag } from '@/composables/usePanelDrag'

const { panel, panelStyle, startDrag } = usePanelDrag()

// 原型稿里的示例轮作序列，颜色沿用原来的取色习惯，
// 接入真实数据前不要当成实际统计结果
const items = [
  { label: '小麦—玉米—小麦', color: '#d9a039' },
  { label: '玉米—小麦—玉米', color: '#4d9ae8' },
  { label: '小麦—其他—小麦', color: '#e8578f' },
  { label: '玉米—蔬菜—玉米', color: '#58c98a' }
]
</script>

<style scoped>
.rt-panel {
  position: fixed;
  right: 14px;
  bottom: 100px;
  z-index: 1200;
  width: 196px;
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

.rt-swatch {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.06);
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
