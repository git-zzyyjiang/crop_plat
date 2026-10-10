<template>
<div id="landType">
<div class="landUse_p1">
  <span class="span" >LAND USE/LAND MASS CLASSES</span>
  <span class="span" style="color: rgb(75, 112, 125)">CLICK TOTOGGLE VISIBILITY</span>
</div>
<div class="landUse_p2" id="landUse_p2">
  <div id="legend-container" class="legend-container" ref="landContent">
    <div class="legend-item" :class="clickedItem===item.index?'clicked':''" v-for="item in colorInfo" v-bind:key="item.index" @click="changeColor(item.index)">
      <div class="legend-color" :style="item.style"></div>
      <span>{{ item.color }}</span>
    </div>
  </div>
</div>
</div>
</template>

<script setup>
import {computed,ref} from "vue";
import useMapStore from "@/stores/map";
      let store = useMapStore()
      let clickedItem = ref(0)
      let colorInfo=computed(()=>{
        let info=[]
        for (let i = 0; i < 9; i++) {
          let randomHex = Math.floor(Math.random() * 0xffffff).toString(16)
          randomHex = `#${randomHex.padStart(6, '0')}`
          let item = {'index': i, 'style': `backgroundColor:${randomHex}`, 'color': randomHex}
          info.push(item)
        }
        return info
      }
      )
    store.loadColor(colorInfo.value[0].color)
    const changeColor= function (index){
      clickedItem.value = index
      store.loadColor(colorInfo.value[index].color)
    }
</script>
<style scoped>

</style>