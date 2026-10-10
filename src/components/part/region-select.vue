<template>
  <div class="region-select">
    <select
      class="region-select-input"
      :value="parcelRegionId"
      title="选择地区"
      @change="onChange"
    >
      <option v-for="item in options" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <span class="region-select-hint" v-if="parcelRegionPlaceholder">占位地区</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'

const store = useMapStore()
const {
  parcelRegions,
  parcelRegionId,
  parcelRegionAllId,
  parcelRegionPlaceholder
} = storeToRefs(store)

// 地区列表后面固定跟上“全部”，选中就回到完整视图
const options = computed(() => {
  const list = parcelRegions.value
    .filter(item => item && item.name)
    .map((item, i) => ({ id: item.id || `region-${i}`, name: item.name }))
  return list.concat([{ id: parcelRegionAllId.value, name: '全部' }])
})

const onChange = evt => store.selectParcelRegion(evt.target.value)

if (parcelRegions.value.length === 0) store.getParcelRegions()
</script>

<style scoped>
.region-select {
  position: absolute;
  top: 10px;
  left: 52px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}

.region-select-input {
  max-width: 190px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 14px;
  color: rgb(191, 238, 255);
  background-color: rgba(0, 35, 47, 0.9);
  border: 1px solid rgb(191, 238, 255);
  border-radius: 4px;
  cursor: pointer;
}

.region-select-input:focus {
  outline: none;
  border-color: #ffffff;
}

.region-select-input option {
  color: rgb(191, 238, 255);
  background-color: rgb(0, 35, 47);
}

.region-select-hint {
  font-size: 12px;
  white-space: nowrap;
  color: rgba(191, 238, 255, 0.7);
}
</style>
