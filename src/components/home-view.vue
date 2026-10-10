<template>
  <div id="bottom_right">
    <section class="home-hero">
      <h2 class="home-hero-title">
        <span>巴尔喀什湖流域</span>
        <span>农业时空智能平台</span>
      </h2>
      <p class="home-hero-desc">
        面向巴尔喀什湖流域，集成多源遥感、地理空间与农业专题数据，提供农业地块、作物分类与水资源消耗等时空信息服务，支撑流域农业资源监测、分析与科学决策。
      </p>
      <button class="home-hero-btn" type="button" @click="start">
        开始探索
        <span class="home-hero-arrow" aria-hidden="true">→</span>
      </button>
    </section>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { View } from 'ol'
import { useRouter } from 'vue-router'
import useMapStore from '@/stores/map'

const store = useMapStore()
const router = useRouter()
const { map } = storeToRefs(store)

const setupPage = () => {
  if (!map.value || !map.value.setView) {
    setTimeout(setupPage, 50)
    return
  }

  store.clearParcelRoi()
  store.removeCropLayerLine()
  store.removeAdministrativeLayer()
  store.removeCropImageryLayers()
  store.removeClick()
  store.isShowFeautureInfo = false

  map.value.setView(new View({
    center: [78.25, 45.72],
    zoom: 7.15,
    projection: 'EPSG:4326'
  }))

  store.clearMap(0)
  store.addBasicLayer('World_Imagery')
  store.addBasinBoundaryLayer()

  // 首页只留底图和流域边界，不叠加时空数据里的那些图层
  store.clearTemporalLayers()
}

const start = () => router.push({ name: 'timeSeriesData' })

onMounted(setupPage)
</script>

<style scoped>
.home-hero {
  position: fixed;
  top: calc(var(--header-h) + 120px);
  left: 37px;
  z-index: 1000;
  width: min(430px, calc(100vw - 80px));
  padding: 22px 24px 24px;
  box-sizing: border-box;
  color: var(--ink-900);
  background-color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  backdrop-filter: blur(6px);
  box-shadow: 0 8px 28px rgba(0, 20, 50, 0.28);
  pointer-events: auto;
}

.home-hero-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 12px;
  color: var(--ink-700);
  font-size: 27px;
  font-weight: 700;
  line-height: 1.22;
  letter-spacing: 1px;
}

.home-hero-desc {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #4a5b74;
  text-align: justify;
}

.home-hero-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 20px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background-image: linear-gradient(#2c93ff, #156ee4);
  border: 0;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(21, 110, 228, 0.45);
  cursor: pointer;
}

.home-hero-btn:hover {
  background-image: linear-gradient(#3ea0ff, #1a7bf0);
}

.home-hero-arrow {
  font-size: 15px;
}
</style>
