<template>
  <section ref="panel" class="layer-tree float-panel" :class="{ collapsed }" :style="panelStyle" aria-label="数据图层">
    <header class="panel-heading tree-drag-handle" @pointerdown="startDrag">
      <pi-icon name="layers"/>
      <span>数据图层</span>
      <button
        class="tree-collapse"
        type="button"
        :title="collapsed ? '展开面板' : '收起面板'"
        @pointerdown.stop
        @click.stop="collapsed = !collapsed"
      >{{ collapsed ? '»' : '«' }}</button>
    </header>

    <div v-show="!collapsed" class="tree-body">
      <label class="pointer-toggle">
        <span>图层指针</span>
        <input
          type="checkbox"
          :checked="temporalPointerEnabled"
          @change="store.setTemporalPointerEnabled($event.target.checked)"
        >
      </label>
      <div v-for="group in tree" :key="group.id" class="tree-group">
        <label class="tree-row is-group">
          <input
            type="checkbox"
            :checked="groupState(group) === 'all'"
            :indeterminate.prop="groupState(group) === 'some'"
            @change="toggleGroup(group, $event.target.checked)"
          >
          <button
            class="tree-caret"
            type="button"
            :title="open[group.id] === false ? '展开' : '收起'"
            @click.prevent="open[group.id] = open[group.id] === false"
          >{{ open[group.id] === false ? '›' : '⌄' }}</button>
          <span class="tree-name">{{ group.label }}</span>
        </label>

        <div v-show="open[group.id] !== false" class="tree-children">
          <div v-for="child in group.children" :key="child.id" class="tree-child">
            <label class="tree-row">
              <input type="checkbox" :checked="isOn(child.id)" @change="toggleChild(child.id, $event.target.checked)">
              <span class="tree-name">{{ child.label }}</span>
              <span v-if="isOn(child.id)" class="tree-load-status" :class="temporalLayerStatus[child.id]" :title="statusText(temporalLayerStatus[child.id])">{{ temporalLayerStatus[child.id] === 'loading' ? '…' : temporalLayerStatus[child.id] === 'error' ? '!' : '' }}</span>
            </label>
            <div v-if="isOn(child.id) && legendOf(child.id)" class="inline-legend">
              <div class="legend-bar" :style="{ background: `linear-gradient(90deg, ${legendOf(child.id).colors.join(',')})` }"></div>
              <div class="legend-scale"><span>{{ legendOf(child.id).min }}</span><span>{{ legendOf(child.id).max }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="layer-status">已启用 {{ enabledCount }} 个图层</footer>
  </section>
</template>

<script setup>
/* global defineExpose */
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'
import PiIcon from '@/components/part/pi-icon.vue'
import { usePanelDrag } from '@/composables/usePanelDrag'

const store = useMapStore()
const { temporalLayerInstances, temporalLayerEnabled, temporalLayerStatus, temporalPointerEnabled } = storeToRefs(store)

const collapsed = ref(false)
const { panel, panelStyle, startDrag } = usePanelDrag()
const open = reactive({
  basemap: true,
  boundaries: true,
  terrain: true,
  imagery: true,
  weather: true
})

// 图层树结构照 figma 原型：标准底图 / 行政边界 / 地形 / 影像 / 气象
const tree = [
  {
    id: 'basemap',
    label: '标准底图',
    children: [
      { id: 'rivers', label: '河流' },
      { id: 'lakes', label: '湖泊' }
    ]
  },
  {
    id: 'boundaries',
    label: '行政边界',
    children: [
      { id: 'country_border', label: '国家边界' },
      { id: 'province_border', label: '州界' }
    ]
  },
  {
    id: 'terrain',
    label: '地形',
    children: [
      { id: 'elevation', label: '高程' },
      { id: 'slope', label: '坡度' }
    ]
  },
  {
    id: 'imagery',
    label: '影像',
    children: [
      { id: 'sentinel1', label: 'Sentinel-1' },
      { id: 'sentinel2', label: 'Sentinel-2' }
    ]
  },
  {
    id: 'weather',
    label: '气象',
    children: [
      { id: 'temperature', label: '气温' },
      { id: 'precipitation', label: '降水' }
    ]
  }
]

// 默认一个都不勾选，由用户自己点
const DEFAULT_ON = []
const LEGENDS = {
  elevation: { colors:['#205b35','#72a34d','#d6c785','#a17a55','#dddddd','#ffffff'], min:'0 m', max:'5000+ m' },
  slope: { colors:['#ffffcc','#c2e699','#78c679','#31a354','#006837','#004529'], min:'0°', max:'45°+' },
  temperature: { colors:['#313695','#74add1','#ffffbf','#f46d43','#a50026'], min:'−10°C', max:'30°C' },
  precipitation: { colors:['#ffffd9','#edf8b1','#7fcdbb','#41b6c4','#225ea8','#081d58'], min:'0 mm', max:'1500 mm' }
}

const isOn = id => !!temporalLayerEnabled.value[id]
const legendOf = id => LEGENDS[id]
const statusText = status => ({ loading: '正在加载', error: '加载失败，可重新勾选重试', ready: '已加载' }[status] || '')
const groupState = group => {
  const on = group.children.filter(child => isOn(child.id)).length
  if (on === 0) return 'none'
  return on === group.children.length ? 'all' : 'some'
}
// 只统计真正的数据图层；分组根节点仅用于批量开关，不能重复计数。
const enabledCount = computed(() => tree.reduce((total, group) => (
  total + group.children.filter(child => isOn(child.id)).length
), 0))

const toggleChild = (id, visible) => store.setTemporalLayer(id, visible)
const toggleGroup = (group, visible) => {
  group.children.forEach(child => store.setTemporalLayer(child.id, visible))
}

// 默认打开原型里展示的那几层，让面板一进来就有内容。
// 由页面在准备好底图之后调用（子组件的 onMounted 早于父组件，不能自己跑）
const applyDefaults = () => {
  DEFAULT_ON.forEach(id => {
    if (!temporalLayerInstances.value[id]) store.setTemporalLayer(id, true)
  })
}

onMounted(() => {})

defineExpose({ applyDefaults })
</script>

<style scoped>
.layer-tree {
  position: fixed;
  top: calc(var(--header-h) + 11px);
  left: 11px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: 234px;
  /* 底部要给年度时间轴留位置，不然页脚会被压住 */
  max-height: calc(100vh - var(--header-h) - 118px);
  overflow: hidden;
  pointer-events: auto;
}

.layer-tree.collapsed {
  width: auto;
}

.tree-drag-handle { cursor: move; touch-action: none; user-select: none; }

.tree-collapse {
  margin-left: auto;
  padding: 0 4px;
  color: var(--ink-300);
  background: none;
  border: 0;
  font-size: 13px;
  cursor: pointer;
}

.tree-collapse:hover {
  color: var(--brand-500);
}

.tree-body {
  overflow-y: auto;
  padding: 0 0 2px;
}

.pointer-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 15px;
  color: var(--ink-700);
  background: #f8fafc;
  border-bottom: 1px solid #eef3fa;
  font-size: 12px;
  cursor: pointer;
}

.pointer-toggle input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--brand-500);
  cursor: pointer;
}

.tree-group + .tree-group {
  border-top: 1px solid #eef3fa;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 15px;
  color: var(--ink-900);
  font-size: 13px;
  cursor: pointer;
}

.tree-row:hover {
  background-color: #f4f9ff;
}

.tree-row.is-group {
  color: var(--ink-700);
  font-weight: 600;
}

.tree-row input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0;
  flex: 0 0 auto;
  accent-color: var(--brand-500);
  cursor: pointer;
}

.tree-caret {
  width: 12px;
  padding: 0;
  color: var(--ink-300);
  background: none;
  border: 0;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.tree-children .tree-row {
  padding-left: 38px;
}

.inline-legend { margin: -2px 17px 7px 55px; }
.legend-bar { height: 7px; border: 1px solid rgba(21, 52, 77, .12); border-radius: 4px; }
.legend-scale { display: flex; justify-content: space-between; margin-top: 2px; color: var(--ink-300); font-size: 9px; line-height: 1.2; }

.layer-status {
  flex: 0 0 auto;
  padding: 7px 0 7px 15px;
  color: var(--ink-300);
  background-color: #f8fafc;
  border-top: 1px solid #eef3fa;
  font-size: 11px;
}
.tree-load-status { margin-left: auto; padding: 0 4px; color: var(--ink-300); font-size: 12px; }
.tree-load-status.error { color: #cf5166; }
</style>
