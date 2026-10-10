<template>
  <div id="bottom" :class="{ 'crop-water-mode': isCropWaterRequirement }">
    <app-header v-if="!isCropWaterRequirement" />
    <router-view/>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed } from "vue";
import AppHeader from "@/components/part/app-header.vue";

const route = useRoute()
const isCropWaterRequirement = computed(() => route.name === 'cropWaterRequirement')
</script>

<style scoped>
.crop-water-mode {
  height: 36% !important;
}
</style>
