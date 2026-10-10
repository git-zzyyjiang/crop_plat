<template>
  <div id="landType">
    <div class="landUse_p1">
      <span class="span" >LAND USE/LAND COVER CLASSES</span>
      <span class="span" style="color: rgb(75, 112, 125)">CLICK TOTOGGLE VISIBILITY</span>
    </div>
    <div class="landUse_p2" id="landUse_p2">
      <div id="legend-container" class="legend-container" ref="landContent">
        <div class="legend-item clicked" v-for="item in featureInfo" v-bind:key="item.index" @click="clickItem(item.index)">
          <div class="legend-color" :style="item.style"></div>
          <span>{{ item.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import useMapStore from "@/stores/map";
import { storeToRefs} from "pinia";
import {ref,getCurrentInstance} from 'vue'
      const store = useMapStore()
      store.getFeatureInfo()
     store.addBasicLayer()
     const {featureInfo} = storeToRefs(store)
      let clickedItem = ref(-1)
      let  pageInstance = getCurrentInstance()
    const clickItem = function(index) {
      if (clickedItem.value === index) {
        for (let i = 0; i < 9; i++) {
          pageInstance.refs.landContent.children[i].classList.add("clicked")
        }
        clickedItem.value = -1
        store.loadFeature(featureInfo.value)
      } else {
        for (let i = 0; i < 9; i++) {
          pageInstance.refs.landContent.children[i].classList.remove("clicked")
        }
        pageInstance.refs.landContent.children[index].classList.add("clicked");
        clickedItem.value = index;
        store.loadFeature([featureInfo.value[index]])
      }
    }
</script>
<style scoped>

</style>