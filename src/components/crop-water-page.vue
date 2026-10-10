<template>
  <div class="crop-water-page">
    <module-tabs v-model="activeTab" :tabs="tabs"/>
    <crop-water-map
      ref="cropWaterMapRef"
      @select-field="selectedField = $event"
    />
    <div class="map-tools">
      <span class="map-tool primary water-mode" title="三维耗水展示">3D</span>
      <button class="map-tool" type="button" title="放大" @click="cropWaterMapRef?.zoom(1)">+</button>
      <button class="map-tool" type="button" title="缩小" @click="cropWaterMapRef?.zoom(-1)">−</button>
      <button class="map-tool" type="button" title="全屏显示" @click="toggleFullscreen"><pi-icon name="expand"/></button>
    </div>
    <div class="water-map-hint">左键平移 · 右键旋转 · 滚轮缩放</div>
    <crop-water-field-info
      v-if="selectedField"
      :field="selectedField"
      @close="clearSelection"
    />
    <crop-water-requirement v-if="activeTab === 'crop'"/>
    <water-analysis v-else :mode="activeTab"/>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import useMapStore from "@/stores/map";
import PiIcon from "@/components/part/pi-icon.vue";
import ModuleTabs from "@/components/part/module-tabs.vue";
import WaterAnalysis from "@/components/water-analysis.vue";
import CropWaterMap from "@/components/crop-water-map.vue";
import CropWaterFieldInfo from "@/components/crop-water-field-info.vue";
import CropWaterRequirement from "@/components/crop-water-requirement.vue";

const selectedField = ref(null);
const cropWaterMapRef = ref(null);
const activeTab = ref('crop');
const tabs = [
  { id: 'crop', label: '作物耗水监测', icon: 'water' },
  { id: 'annual', label: '年度耗水展示', icon: 'layers' },
  { id: 'change', label: '时空变化', icon: 'chart' }
];
const { cropWaterActiveCrop, cropWaterActiveDate } = storeToRefs(useMapStore());
watch([cropWaterActiveCrop, cropWaterActiveDate], clearSelection);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

function clearSelection() {
  selectedField.value = null;
  cropWaterMapRef.value?.clearSelectedField();
}
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
.water-map-hint { position: absolute; right: 14px; bottom: 14px; z-index: 10; padding: 6px 12px; border-radius: 20px; background: #102c4380; color: #d2e3f0; font-size: 11px; pointer-events: none; }
</style>
