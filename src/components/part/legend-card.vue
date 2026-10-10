<template>
  <section ref="panel" class="lc-panel" :style="panelStyle">
    <header class="lc-bar" @pointerdown="startDrag">
      <span class="lc-grip" aria-hidden="true"></span>
      <span class="lc-title">{{ title }}</span>
    </header>
    <ul class="lc-list">
      <li v-for="item in items" :key="item.label">
        <span class="lc-swatch" :style="{ backgroundColor: item.color }"></span>
        <span>{{ item.label }}</span>
      </li>
    </ul>
    <p v-if="note" class="lc-note">{{ note }}</p>
  </section>
</template>

<script setup>
import { usePanelDrag } from '@/composables/usePanelDrag'

defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
  note: { type: String, default: '' }
})

const { panel, panelStyle, startDrag } = usePanelDrag()
</script>

<style scoped>
.lc-panel {
  position: fixed;
  right: 14px;
  bottom: 100px;
  z-index: 1200;
  width: 178px;
  padding: 0 0 10px;
  box-sizing: border-box;
  color: var(--ink-900);
  background-color: rgba(255, 255, 255, 0.97);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(6, 34, 84, 0.22);
  pointer-events: auto;
}

.lc-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 11px;
  cursor: move;
  touch-action: none;
}

.lc-grip {
  width: 10px;
  height: 10px;
  background-image: radial-gradient(#a9b8cc 1px, transparent 1px);
  background-size: 4px 4px;
}

.lc-title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 600;
}

.lc-list {
  margin: 0;
  padding: 0 11px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.lc-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.lc-swatch {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.lc-note {
  margin: 10px 11px 0;
  padding-top: 8px;
  color: var(--ink-300);
  border-top: 1px dashed #e3ecf8;
  font-size: 11px;
  line-height: 1.6;
}
</style>
