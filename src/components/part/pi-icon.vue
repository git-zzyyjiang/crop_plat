<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d"/>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { ICON_PATHS } from './platform-icons'

const props = defineProps({
  name: { type: String, required: true }
})

const paths = computed(() => ICON_PATHS[props.name] || [])
</script>
