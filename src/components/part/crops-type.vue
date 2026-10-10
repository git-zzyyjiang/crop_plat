<template>
  <div id="landType" ref="panel" :style="panelStyle">
    <!-- 这一条同时是标题和拖动把手 -->
    <div class="landUse_p1" @pointerdown="startDrag">
      <span class="legend-grip" aria-hidden="true"></span>
      <span class="legend-title">作物类型</span>
    </div>
    <div class="landUse_p2" id="landUse_p2">
      <div id="legend-container" class="legend-container">
        <div
          class="legend-item"
          :class="{ clicked: isActive(item.code) }"
          v-for="item in cropInfo"
          v-bind:key="item.code"
          @click="clickItem(item.code)"
          :title="activeCodes.length ? (isActive(item.code) ? '再次点击显示全部类型' : '只显示该类型') : '点击只显示该类型'"
        >
          <div class="crop-color" :style="{ backgroundColor: item.color }">
            <pi-icon :name="item.icon"/>
          </div>
          <span class="crop-name">{{ item.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import useMapStore from "@/stores/map";
import {computed, onMounted} from "vue";
import {storeToRefs} from "pinia";
import {usePanelDrag} from "@/composables/usePanelDrag";
import PiIcon from "@/components/part/pi-icon.vue";

    const store = useMapStore()
    const {cropInfo, cropSelectedCodes} = storeToRefs(store)
    const {panel, panelStyle, startDrag} = usePanelDrag()

    const activeCodes = computed(() => cropSelectedCodes.value || [])
    // 没有选中项时表示"全部显示"
    const isActive = code => activeCodes.value.length === 0 || activeCodes.value.includes(code)

    // 初始化
    const initCropLayers = () => {
      if (!store.map || !store.map.addLayer) {
        setTimeout(initCropLayers, 50)
        return
      }

      store.removeCropLayerLine();
      store.removeAdministrativeLayer();
      store.removeCropImageryLayers();

      // store.addCropImageryLayers(); // 作物底图（卫星）
      // store.addAdministrativeLayer(); // 行政区边界
      store.getAndLoadCropInfo(); // 取 10 类作物信息，并加载当前年份的作物图层
    }
    onMounted(initCropLayers)

    // 点一下只看这一类，再点一下回到全部
    const clickItem = code => store.toggleCropType(code)


</script>


<style scoped>
/* 白底小窗口，钉在页面右下角，各类型竖着排一列 */
#landType {
  /* 必须用 fixed：拖动时写的是视口坐标，absolute 会相对 #bottom_right 偏移 */
  position: fixed;
  right: 20px;
  bottom: 28px;
  left: auto;
  top: auto;
  transform: none;
  width: auto;
  height: auto;
  padding: 11px 18px 14px;
  box-sizing: border-box;
  background-color: #ffffff;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  color: #22303f;
  font-size: 15px;
  user-select: none;
}

.landUse_p1 {
  position: static;
  display: flex;
  align-items: center;
  gap: 9px;
  width: auto;
  height: auto;
  margin-bottom: 11px;
  text-align: left;
  cursor: move;
  touch-action: none;
}

.legend-grip {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  background-image: radial-gradient(#a9b8cc 1px, transparent 1px);
  background-size: 4px 4px;
}

.legend-title {
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  color: #1a56c4;
}

.landUse_p2 {
  position: static;
  margin-left: 0;
}

#legend-container {
  margin: 0;
  /* 10 类作物，两列排下来还是比一列省地方 */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  row-gap: 6px;
  column-gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 0;
}

.crop-color {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 10px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .12);
  transition: opacity 0.2s ease;
}

.crop-color svg {
  width: 17px;
  height: 17px;
  color: #ffffff;
}

.crop-name {
  font-size: 15px;
  white-space: nowrap;
  color: #22303f;
}

.legend-item.clicked .crop-color {
  opacity: 1;
}

.legend-item:not(.clicked) .crop-color {
  opacity: 0.32;
}

.legend-item:not(.clicked) .crop-name {
  color: #a9b6c6;
}

.legend-item:active .crop-color {
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
}
</style>
