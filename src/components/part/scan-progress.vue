<template>
  <div v-if="visible" class="scan-progress" role="status" aria-live="polite">
    <div class="scan-progress-track" role="progressbar" aria-label="地块识别进度" :aria-valuenow="controlled && !waiting ? Math.round(progress) : undefined" :aria-valuemin="0" :aria-valuemax="100">
      <div class="scan-progress-fill" :class="{ done, controlled, waiting }" :style="controlled && !waiting ? {width: progress + '%'} : null"></div>
    </div>
    <span>{{ statusText }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import useMapStore from '@/stores/map'

/* global defineProps */
const props = defineProps({mode:{type:String,default:'crop'}})
const store = useMapStore()
const { parcelRoiExtent, cropAnalysisLoading, parcelIdentifyPhase, parcelIdentifyProgress, cropScanPhase, cropScanProgress } = storeToRefs(store)

const phase = ref('idle') // idle / running / done
let doneTimer = null

const isParcel = computed(() => props.mode === 'parcel')
const controlled = computed(() => isParcel.value || cropScanPhase.value !== 'idle')
const animationPhase = computed(() => isParcel.value ? parcelIdentifyPhase.value : cropScanPhase.value)
const progress = computed(() => isParcel.value ? parcelIdentifyProgress.value : cropScanProgress.value)
const waiting = computed(() => controlled.value && (animationPhase.value === 'loading' || animationPhase.value === 'preparing'))
const visible = computed(() => !!parcelRoiExtent.value && (controlled.value ? animationPhase.value !== 'idle' && (animationPhase.value !== 'done' || phase.value === 'done') : phase.value !== 'idle'))
const done = computed(() => controlled.value ? animationPhase.value === 'done' : phase.value === 'done')
const statusText = computed(() => {
  if(done.value) return '识别完成'
  if(!isParcel.value){
    // 框选后第 1 秒先收起图层，进度条显示"渲染图层中"
    if(animationPhase.value === 'preparing') return '渲染图层中…'
    return waiting.value ? '正在识别… · 加载作物地块' : '正在识别… · 逐块识别作物类型'
  }
  const stage = {loading:'加载地块',points:'显示边界点',lines:'连接边界线',faces:'生成地块面'}[parcelIdentifyPhase.value]
  return `正在识别…${stage ? ' · '+stage : ''}`
})

watch(() => controlled.value ? animationPhase.value : cropAnalysisLoading.value, state => {
  if(doneTimer) {clearTimeout(doneTimer);doneTimer=null}
  if(controlled.value){
    phase.value = state === 'done' ? 'done' : state === 'idle' ? 'idle' : 'running'
    if(state === 'done') doneTimer=setTimeout(()=>{phase.value='idle'},1200)
    return
  }
  if(state){phase.value='running';return}
  if(phase.value === 'running'){
    phase.value='done'
    doneTimer=setTimeout(()=>{phase.value='idle'},900)
  }
}, {immediate:true})

onBeforeUnmount(() => { if(doneTimer) clearTimeout(doneTimer) })
</script>

<style scoped>
.scan-progress {
  position: fixed;
  /* 固定停在页面正中间 */
  left: 50%;
  top: 50%;
  z-index: 1250;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;
  transform: translate(-50%, -50%);
  color: #fff;
  background-color: rgba(6, 34, 84, 0.74);
  border-radius: 8px;
  font-size: 11px;
  pointer-events: none;
}

.scan-progress-track {
  width: 110px;
  height: 6px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.28);
  border-radius: 3px;
}

.scan-progress-fill {
  height: 100%;
  width: 0;
  border-radius: 3px;
  background-image: linear-gradient(90deg, #56d5ff, #2c93ff);
  /* 兜底动画：框选识别走的是下面 controlled 的按进度控制 */
  animation: scanFill 8s linear forwards;
}

.scan-progress-fill.done {
  width: 100%;
  animation: none;
  background-image: linear-gradient(90deg, #58c98a, #17a673);
}

.scan-progress-fill.controlled { animation: none; transition: width 60ms linear; }
.scan-progress-fill.waiting { width: 35%; animation: scanWaiting 1.2s ease-in-out infinite; }
@keyframes scanWaiting { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

@keyframes scanFill {
  from { width: 0; }
  to { width: 100%; }
}
</style>
