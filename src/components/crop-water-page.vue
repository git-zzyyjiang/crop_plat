<template>
  <div class="crop-water-page">
    <module-tabs v-model="activeTab" :tabs="tabs"/>
    <crop-water-map
      ref="cropWaterMapRef"
      :mode="activeTab"
      :change-month="changeMonth"
      :change-focus-request-id="changeFocusRequestId"
      :change-ready="changeStatusReady"
      :change-result-version="changeStatus?.result_version || ''"
      @select-field="selectedField = $event"
      @change-stats="changeStats = $event"
    />
    <div class="map-tools">
      <span class="map-tool primary water-mode" title="三维耗水展示">3D</span>
      <button class="map-tool" type="button" title="放大" @click="cropWaterMapRef?.zoom(1)">+</button>
      <button class="map-tool" type="button" title="缩小" @click="cropWaterMapRef?.zoom(-1)">−</button>
      <button class="map-tool" type="button" title="全屏显示" @click="toggleFullscreen"><pi-icon name="expand"/></button>
    </div>
    <crop-water-field-info
      v-if="selectedField"
      :field="selectedField"
      :mode="activeTab"
    />
    <crop-water-requirement v-if="activeTab === 'crop'"/>
    <water-analysis
      v-else-if="activeTab === 'change'"
      :mode="activeTab"
      :change-stats="changeStats"
      :change-month="changeMonth"
      :change-months="changeAvailableMonths"
      :change-result-version="changeStatus?.result_version || ''"
      :change-status-ready="changeStatusReady"
      :change-status-loading="changeStatusLoading"
      :change-status-error="changeStatusError"
      @update:change-month="changeMonth = $event"
      @request-change-focus="changeFocusRequestId += 1"
    />
    <div v-if="activeTab === 'change'" class="change-legend" aria-label="耗水量变化图例">
      <div class="change-legend-title">耗水量变化</div>
      <div><i class="legend-swatch increase"></i>耗水量上升地块</div>
      <div><i class="legend-swatch decrease"></i>耗水量下降地块</div>
      <div><i class="legend-swatch unchanged"></i>耗水量持平地块</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import useMapStore from "@/stores/map";
import PiIcon from "@/components/part/pi-icon.vue";
import ModuleTabs from "@/components/part/module-tabs.vue";
import WaterAnalysis from "@/components/water-analysis.vue";
import CropWaterMap from "@/components/crop-water-map.vue";
import CropWaterFieldInfo from "@/components/crop-water-field-info.vue";
import CropWaterRequirement from "@/components/crop-water-requirement.vue";

const selectedField = ref(null);
const changeStats = ref(null);
const changeFocusRequestId = ref(0);
const changeStatus = ref(null);
const changeStatusLoading = ref(false);
const changeStatusError = ref("");
const cropWaterMapRef = ref(null);
const activeTab = ref('crop');
const tabs = [
  { id: 'crop', label: '年度耗水监测', icon: 'water' },
  { id: 'change', label: '时空变化', icon: 'chart' }
];
const { cropWaterActiveCrop, cropWaterActiveDate } = storeToRefs(useMapStore());
const changeMonth = ref(cropWaterActiveDate.value.slice(0, 7));
const waterApiBase = (process.env.VUE_APP_CROP_WATER_API_BASE || "http://localhost:5000").replace(/\/$/, "");
const changeStatusReady = computed(() => Boolean(changeStatus.value?.ready));
const changeAvailableMonths = computed(() => Array.isArray(changeStatus.value?.available_months)
  ? changeStatus.value.available_months
  : []);
let changeStatusController = null;
watch([cropWaterActiveCrop, cropWaterActiveDate], clearSelection);
watch(changeMonth, clearSelection);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

function clearSelection() {
  selectedField.value = null;
  cropWaterMapRef.value?.clearSelectedField();
}

watch(activeTab, (tab) => {
  changeStats.value = null;
  if (tab === "change") loadChangeStatus();
});

async function loadChangeStatus() {
  changeStatusController?.abort();
  const controller = new AbortController();
  changeStatusController = controller;
  changeStatusLoading.value = true;
  changeStatusError.value = "";
  try {
    const response = await fetch(`${waterApiBase}/api/water/change/monthly/status`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `月度数据状态请求失败：${response.status}`);
    if (!payload?.ready || !Array.isArray(payload.available_months) || !payload.available_months.length) {
      throw new Error(payload?.building_months?.length ? "月度地块数据正在生成，请稍后重试" : "暂无可用的月度地块数据");
    }
    changeStatus.value = payload;
    if (!payload.available_months.includes(changeMonth.value)) {
      changeMonth.value = findNearestMonth(changeMonth.value, payload.available_months);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      changeStatus.value = null;
      changeStatusError.value = error?.message || "月度地块数据状态暂时不可用";
    }
  } finally {
    if (changeStatusController === controller) {
      changeStatusController = null;
      changeStatusLoading.value = false;
    }
  }
}

function findNearestMonth(target, months) {
  const targetValue = monthValue(target);
  return [...months].sort((left, right) =>
    Math.abs(monthValue(left) - targetValue) - Math.abs(monthValue(right) - targetValue)
  )[0];
}

function monthValue(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(month) ? year * 12 + month - 1 : 0;
}

onBeforeUnmount(() => changeStatusController?.abort());
</script>

<style scoped>
.crop-water-page {
  position: absolute;
  top: calc(var(--header-h) + var(--tabs-h));
  left: 0;
  width: 100%;
  height: calc(100vh - var(--header-h) - var(--tabs-h));
  overflow: hidden;
  background: rgb(12, 44, 54);
}
.water-mode { box-sizing: border-box; cursor: default; }
.change-legend { position: fixed; right: 18px; bottom: 92px; z-index: 1000; min-width: 150px; padding: 10px 13px; border: 1px solid rgba(255,255,255,.7); border-radius: 4px; background: rgba(255,255,255,.92); box-shadow: 0 4px 16px rgba(6,34,84,.18); color: #40566d; font-size: 11px; line-height: 1.9; pointer-events: none; }
.change-legend-title { margin-bottom: 3px; color: #1f4d78; font-weight: 600; }
.legend-swatch { display: inline-block; width: 13px; height: 13px; margin-right: 7px; vertical-align: -2px; border-radius: 1px; }
.legend-swatch.increase { background: #D85B61; }
.legend-swatch.decrease { background: #4D8FDB; }
.legend-swatch.unchanged { background: #AAB4BE; }
</style>
