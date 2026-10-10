<template>
  <div id="landType">
    <div id="landUse">
      <div class="landUse_p1">
        <span class="span" style="">RENDERINGS/Agri Parcel</span>
        <span class="span" style="color: rgb(75, 112, 125)">CLICK TOTOGGLE VISIBILITY</span>
      </div>
      <div class="landUse_p2" id="landUse_p2_copy">
        <div class="button-container" ref="imageList">
          <div v-for="item in imageryInfo" class="button-item" :class="clickedItem===item.index? 'clicked':''" v-bind:key="item.index" @click="clickItem(item.index)">
            <div class="button-color" :style="item.style"></div>
            <span>{{ item.name }}</span>
          </div>
        </div>
      </div>
    </div>
</div>
</template>

<script setup>
import {storeToRefs} from "pinia";
import useMapStore from "@/stores/map";
import {ref} from "vue";
      const  store  = useMapStore()
      store.isShowFeautureInfo = false
      store.removeTimeData()
      store.removeCropImageryLayers()
      store.addCropImageryLayers();
      store.addAdministrativeLayer()
      // store.addCropLandLayer()
      store.addCropLayerLine()
      store.getImageryInfo()
      store.removeClick()
      const {imageryInfo} = storeToRefs(store)
      let clickedItem = ref(0)
    const clickItem = function (index){
        if(index===1){
          store.removeCropLayerLine()
        }else{
          store.addCropLayerLine()
        }
      clickedItem.value = index;
    }
</script>

<style scoped>

</style>