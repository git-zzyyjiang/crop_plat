<template>
  <section class="ph-panel float-panel">
    <header class="panel-heading">
      <pi-icon :name="icon"/>
      <span>{{ title }}</span>
    </header>
    <div class="ph-body">
      <p v-if="subtitle" class="ph-sub">{{ subtitle }}</p>

      <div v-if="metrics.length" class="ph-metrics">
        <div v-for="item in metrics" :key="item.label" class="ph-metric">
          <span class="ph-metric-label">{{ item.label }}</span>
          <strong class="ph-metric-value">{{ item.value }}</strong>
          <em v-if="item.delta" class="ph-metric-delta" :class="{ down: item.delta.indexOf('-') === 0 }">{{ item.delta }}</em>
        </div>
      </div>

      <ul v-if="legend.length" class="ph-legend">
        <li v-for="item in legend" :key="item.label">
          <span class="ph-swatch" :style="{ backgroundColor: item.color }"></span>
          <span>{{ item.label }}</span>
        </li>
      </ul>

      <p class="ph-note">{{ note }}</p>
    </div>
  </section>
</template>

<script setup>
import PiIcon from '@/components/part/pi-icon.vue'

defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: 'chart' },
  subtitle: { type: String, default: '' },
  note: { type: String, default: '示例数据，待接入真实数据后替换。' },
  metrics: { type: Array, default: () => [] },
  legend: { type: Array, default: () => [] }
})
</script>

<style scoped>
.ph-panel {
  position: fixed;
  top: calc(var(--header-h) + var(--tabs-h) + 11px);
  left: 11px;
  z-index: 1000;
  width: 256px;
  max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 120px);
  overflow-y: auto;
  pointer-events: auto;
}

.ph-body {
  padding: 4px 15px 14px;
}

.ph-sub {
  margin: 0 0 10px;
  color: var(--ink-300);
  font-size: 11px;
}

.ph-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.ph-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  background-color: #f5f9fe;
  border: 1px solid #e6eefa;
  border-radius: 7px;
}

.ph-metric-label {
  color: var(--ink-300);
  font-size: 11px;
}

.ph-metric-value {
  color: var(--ink-900);
  font-size: 15px;
}

.ph-metric-delta {
  color: #17a673;
  font-size: 11px;
  font-style: normal;
}

.ph-metric-delta.down {
  color: #e2704a;
}

.ph-legend {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ph-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-900);
  font-size: 12px;
}

.ph-swatch {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  border-radius: 3px;
}

.ph-note {
  margin: 14px 0 0;
  padding-top: 10px;
  color: var(--ink-300);
  border-top: 1px dashed #e3ecf8;
  font-size: 11px;
  line-height: 1.6;
}
</style>
