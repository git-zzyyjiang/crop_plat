<template>
  <div class="field-panel">
    <div class="panel-header">
      <div>
        <div class="title">地块详情</div>
        <div class="subtitle">属性与耗水信息</div>
      </div>

    </div>

    <div class="section">
      <div class="row">
        <span>地块编号</span>
        <b>{{ displayNullable(field.objectId) }}</b>
      </div>

      <div class="row">
        <span>作物类别</span>
        <b>{{ displayNullable(field.cropName) }}</b>
      </div>

      <div class="row">
        <span>类别代码</span>
        <b>{{ displayNullable(field.cropCode) }}</b>
      </div>

      <div class="row">
        <span>面积</span>
        <b>{{ formatArea(field.area) }}</b>
      </div>

    </div>

    <div class="divider"></div>

    <div v-if="mode === 'change'" class="section">
      <div class="row highlight">
        <span>本月耗水量</span>
        <b>{{ formatVolume(field.monthlyCurrent) }}</b>
      </div>

      <div class="row">
        <span>上月耗水量</span>
        <b>{{ formatVolume(field.monthlyPrevious) }}</b>
      </div>

      <div class="row" :class="changeTone(field.monthlyDelta)">
        <span>月变化量</span>
        <b>{{ formatVolume(field.monthlyDelta, true) }}</b>
      </div>
    </div>
    <div v-else-if="field.waterAvailable" class="section">
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
/* global defineProps */
const props = defineProps({
  field: {
    type: Object,
    required: true,
  },
  mode: {
    type: String,
    default: "crop",
  },
});

function formatValue(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return "--";
  }

  return num.toFixed(2);
}

function formatVolume(value, signed = false) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const absolute = Math.abs(num);
  const scale = absolute >= 1e8 ? 1e8 : absolute >= 1e4 ? 1e4 : 1;
  const prefix = scale === 1e8 ? "亿" : scale === 1e4 ? "万" : "";
  const digits = scale === 1 ? 0 : 2;
  const display = (num / scale).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${signed && num > 0 ? "+" : ""}${display} ${prefix}m³`;
}

function changeTone(value) {
  const num = Number(value);
  return num > 0 ? "increase" : num < 0 ? "decrease" : "unchanged";
}

function displayNullable(value) {
  return value === undefined || value === null || value === "" || value === "unknown"
    ? "null"
    : value;
}

function formatArea(value) {
  const nullableValue = displayNullable(value);

  if (nullableValue === "null") {
    return "null";
  }

  // 时空变化模块维持原有精确值，仅年度耗水监测压缩大数显示。
  if (props.mode !== "crop") {
    return `${nullableValue} m²`;
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "null";
  }
  if (Math.abs(num) >= 1e8) {
    return `${(num / 1e8).toFixed(2)} 亿 m²`;
  }
  if (Math.abs(num) >= 1e4) {
    return `${(num / 1e4).toFixed(2)} 万 m²`;
  }
  return `${num.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} m²`;
}
</script>

<style scoped>
.field-panel { position: fixed; top: calc(var(--header-h) + var(--tabs-h) + 12px); right: 72px; z-index: 1050; width: min(310px, calc(100vw - 90px)); padding: 16px; box-sizing: border-box; background: linear-gradient(145deg, rgba(18, 48, 63, .94), rgba(10, 31, 43, .9)); border: 1px solid rgba(161, 211, 235, .22); border-radius: 14px; box-shadow: 0 10px 30px rgba(3, 16, 27, .3), inset 0 1px 0 rgba(255, 255, 255, .08); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); color: #eaf6ff; }
.panel-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.title { font-size: 16px; font-weight: 600; color: #eaf6ff; }
.subtitle { margin-top: 4px; font-size: 12px; color: #9db8c8; }
.section { display: flex; flex-direction: column; gap: 9px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
.row span { color: #9db8c8; }
.row b { color: #eaf6ff; font-size: 13px; text-align: right; overflow-wrap: anywhere; }
.row.highlight { padding: 8px 10px; border-radius: 8px; background: rgba(72, 150, 191, .18); border: 1px solid rgba(141, 210, 255, .22); }
.row.highlight b { font-size: 16px; }
.row.green b { color: #52d6a3; }
.row.blue b { color: #62b5ff; }
.row.increase b { color: #ff7c84; }
.row.decrease b { color: #62b5ff; }
.row.unchanged b { color: #b4c0cc; }
.divider { height: 1px; margin: 14px 0; background: rgba(161, 211, 235, .16); }
.no-water-data { padding: 12px; border-radius: 8px; color: #9db8c8; background: rgba(202, 227, 245, .08); text-align: center; font-size: 12px; }
</style>
