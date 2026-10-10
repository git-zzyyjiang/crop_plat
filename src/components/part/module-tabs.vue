<template>
  <nav class="module-tabs" aria-label="二级模块">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="module-tab"
      :class="{ active: tab.id === modelValue || tab.id === activeId }"
      :title="tab.label"
      @click="$emit('update:modelValue', tab.id)"
    >
      <pi-icon :name="tab.icon || 'layers'"/>
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>

<script setup>
import PiIcon from '@/components/part/pi-icon.vue'

defineProps({
  tabs: { type: Array, required: true },
  modelValue: { type: String, default: '' },
  // 额外需要高亮成蓝底的页签（比如框选开启时把「停止框选」点亮）
  activeId: { type: String, default: '' }
})

defineEmits(['update:modelValue'])
</script>
