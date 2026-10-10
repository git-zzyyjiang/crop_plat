<template>
  <div id="bottom_right">
<!--    <time-slider/>-->
    <unknown-part/>
  </div>
</template>

<script setup>
import {View} from "ol";
import UnknownPart from "@/components/part/unknown-part";
import {storeToRefs} from "pinia";
import useMapStore from "@/stores/map";
const store = useMapStore()
let {map} = storeToRefs(store)
  const view = new View({
    center:[(72.00+80.47)/2, (38.495+40.18)/2],
    zoom:12.5,
    projection: 'EPSG:4326'
  })
    map.value.setView(view)
    store.addCropLandLayer()
</script>

<style scoped>

</style>