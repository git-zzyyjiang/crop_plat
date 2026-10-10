<template>
  <header class="topbar">
    <div class="topbar-brand">
      <svg class="topbar-logo" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2.4 29.6 10v12L16 29.6 2.4 22V10Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M16 7.4 24.4 12.2v7.6L16 24.6 7.6 19.8v-7.6L16 7.4Z" fill="currentColor" opacity=".32"/>
      </svg>
      <h1 class="topbar-title">巴尔喀什湖流域农业时空智能平台</h1>
    </div>

    <nav class="topbar-menu" aria-label="主导航">
      <button
        v-for="item in items"
        :key="item.name"
        type="button"
        class="topbar-item"
        :class="{ active: isActive(item.name) }"
        :title="item.label"
        @click="go(item.name)"
      >
        <pi-icon :name="item.icon"/>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="topbar-user">
      <span class="topbar-avatar"><pi-icon name="user"/></span>
      <span>研究员</span>
      <pi-icon name="caret" class="topbar-caret"/>
    </div>
  </header>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import PiIcon from '@/components/part/pi-icon.vue'

const route = useRoute()
const router = useRouter()

// 一级模块，顺序与 figma 原型一致
const items = [
  { name: 'home', label: '首页', icon: 'home' },
  { name: 'timeSeriesData', label: '时空数据', icon: 'layers' },
  { name: 'agriParcel', label: '农业地块', icon: 'sprout' },
  { name: 'cropClassification', label: '作物结构', icon: 'asterisk' },
  { name: 'cropWaterRequirement', label: '水资源消耗', icon: 'water' }
]

const isActive = name => route.name === name
const go = name => {
  if (route.name !== name) router.push({ name })
}
</script>
