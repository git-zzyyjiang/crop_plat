<template>
    <template v-if="isCropWaterRequirement">
        <app-header/>
        <crop-water-page/>
    </template>
    <template v-else>
        <map-view/>
        <bottom-content/>
    </template>
</template>
<script setup>
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import mapView from "@/components/map-view";
import cropWaterPage from "@/components/crop-water-page.vue";
import AppHeader from "@/components/part/app-header.vue";
import bottomContent from '@/components/bottom-content.vue'

const route = useRoute();
const isCropWaterRequirement = computed(() => route.name === "cropWaterRequirement");

// 有二级导航条的模块：地图要给导航条让出高度（见 public/css/index.css）
const TABS_ROUTES = ['agriParcel', 'cropClassification', 'cropWaterRequirement']
watchEffect(() => {
  document.documentElement.classList.toggle('with-module-tabs', TABS_ROUTES.includes(route.name))
})
</script>
<style>
</style>
