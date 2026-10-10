<template>
  <div class="field-panel">
    <div class="panel-header">
      <div>
        <div class="title">地块详情</div>
        <div class="subtitle">属性与耗水信息</div>
      </div>

      <button class="close-btn" @click="$emit('close')">×</button>
    </div>

    <div class="section">
      <div class="row">
        <span>地块编号</span>
        <b>{{ field.objectId }}</b>
      </div>

      <div class="row">
        <span>作物类别</span>
        <b>{{ field.cropName || "--" }}</b>
      </div>

      <div class="row">
        <span>类别代码</span>
        <b>{{ field.cropCode ?? "--" }}</b>
      </div>

      <div class="row">
        <span>面积</span>
        <b>{{ field.area }} m²</b>
      </div>

      <div class="row">
        <span>周长</span>
        <b>{{ field.length }} m</b>
      </div>
    </div>

    <div class="divider"></div>

    <div v-if="field.waterAvailable" class="section">
      <div class="row highlight">
        <span>当日总耗水量</span>
        <b>{{ formatValue(field.dailyWater) }} mm</b>
      </div>

      <div class="row green">
        <span>绿水耗水量</span>
        <b>{{ formatValue(field.greenWater) }} mm</b>
      </div>

      <div class="row blue">
        <span>蓝水耗水量</span>
        <b>{{ formatValue(field.blueWater) }} mm</b>
      </div>

    </div>
    <div v-else class="no-water-data">无单地块耗水数据</div>
  </div>
</template>

<script setup>
/* global defineProps, defineEmits */
defineProps({
  field: {
    type: Object,
    required: true,
  },
});

defineEmits(["close"]);

function formatValue(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return "--";
  }

  return num.toFixed(2);
}
</script>

<style scoped>
.field-panel { position: fixed; top: calc(var(--header-h) + var(--tabs-h) + 12px); right: 72px; z-index: 1050; width: min(310px, calc(100vw - 90px)); padding: 16px; box-sizing: border-box; background: var(--panel-bg); border-radius: var(--panel-radius); box-shadow: var(--panel-shadow); color: var(--ink-900); }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.title { font-size: 16px; font-weight: 600; color: var(--ink-700); }
.subtitle { margin-top: 4px; font-size: 12px; color: var(--ink-300); }
.close-btn { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: #edf5ff; color: var(--ink-500); font-size: 20px; cursor: pointer; }
.section { display: flex; flex-direction: column; gap: 9px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
.row span { color: #708198; }
.row b { color: var(--ink-500); font-size: 13px; text-align: right; overflow-wrap: anywhere; }
.row.highlight { padding: 8px 10px; border-radius: 6px; background: #edf5ff; border: 1px solid #d8e5f5; }
.row.highlight b { font-size: 16px; }
.row.green b { color: #21966f; }
.row.blue b { color: #156ee4; }
.divider { height: 1px; margin: 14px 0; background: #e6edf5; }
.no-water-data { padding: 12px; border-radius: 6px; color: var(--ink-300); background: #f5f8fd; text-align: center; font-size: 12px; }
</style>
