<template>
  <div id="bottom_right">
    <!-- 地形图组件 -->
    <topographic-view />
  </div>
</template>

<script setup>
import { View } from "ol";
import TopographicView from "@/components/part/topographic-view.vue";
import useMapStore from "@/stores/map";
import { storeToRefs } from "pinia";
import { onMounted } from "vue";
import { fromLonLat } from "ol/proj";

const store = useMapStore();
let { map } = storeToRefs(store);

// 设置地图视图中心和缩放级别

const setMapView = () => {
  if (!map.value || !map.value.setView) {
    setTimeout(setMapView, 50);
    return;
  }

  // const view = new View({
  //   center: fromLonLat([78.25, 45.72]),
  //   zoom: 6.52,
  // });
  const view = new View({
    center: [78.25, 45.72],
    zoom: 7.15,
    projection: "EPSG:4326",
  });
  map.value.setView(view);


  // store.addBasicLayer();
  store.clearMap(0);

  store.addBasicLayer('NatGeo_World_Map'); // 底图
  store.addBasinBoundaryLayer(); // 流域边界及外部遮罩
  // store.addBasinLabelLayer(); // 标签

  // store.switchToTopoBasin();

  console.log("加载完毕")
};


onMounted(setMapView);
</script>

<style scoped>
</style>
