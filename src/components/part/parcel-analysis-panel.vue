<template>
  <section ref="panel" class="pa-panel float-panel" :style="panelStyle">
    <header class="pa-header" @pointerdown="startDrag"><span>{{ mode === 'stats' ? '耕地统计特征' : '空间格局变化' }}</span><button @pointerdown.stop @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</button></header>
    <div v-show="!collapsed" class="pa-body">
      <p class="pa-note">统计范围：当前地图视野 · {{ year === 'current' ? '现有地块（年份未标定）' : year + '年' }}</p>
      <div v-if="mode === 'stats'" class="pa-switch"><button :class="{on:metric === 'density'}" @click="metric = 'density'">单位面积地块数量</button><button :class="{on:metric === 'meanArea'}" @click="metric = 'meanArea'">平均地块面积</button></div>
      <p role="status" aria-live="polite" class="pa-status">{{ notice }}</p>
      <button v-if="!loading" class="pa-retry" @click="refresh">重新加载当前范围</button>
      <template v-if="result && result.count">
        <p class="pa-note">{{ result.count.toLocaleString() }} 个地块 · 总面积 {{ result.totalArea.toFixed(1) }} ha</p>
        <template v-if="mode === 'stats'">
          <div v-for="(bin,index) in bins" :key="bin.label" class="pa-bin"><span>{{ bin.label }}</span><div class="pa-bar"><i :style="{width:bin.percent+'%',background:COLORS[index]}"></i></div><b>{{ bin.percent.toFixed(1) }}%</b></div>
          <p class="pa-note">0.05°网格；占比按含地块网格数计算。地块按内部点归属网格，面积使用完整地块面积。</p>
        </template>
        <template v-else>
          <div class="pa-cards"><div v-for="item in cards" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b><small>{{ item.unit }}</small></div></div>
          <p class="pa-note">聚合度、连片耕地核心区、破碎化热点暂无计算结果，待统计口径及数据接入。</p>
          <p v-if="baselineResult" class="pa-note">较{{ baselineYear }}年：平均面积 {{ delta(result.meanArea,baselineResult.meanArea) }}，地块密度 {{ delta(result.density,baselineResult.density) }}，边界密度 {{ delta(result.boundaryDensity,baselineResult.boundaryDensity) }}。</p>
          <div v-if="changes" class="pa-change-counts"><span v-for="item in changeLegend" :key="item.kind">{{ item.label }} {{ changes.filter(record=>record.kind === item.kind).length }} 块</span></div>
          <p class="pa-note">{{ changes ? '按稳定地块编号对比：面积变化达到5%标为扩大或缩小；消失不等同于弃耕。' : '年度地块及稳定编号未齐备，地图显示当前平均地块面积。' }}</p>
        </template>
      </template>
      <template v-if="mode === 'pattern'">
        <h4>年度变化（2024—2026）</h4>
        <select v-model="chartMetric" aria-label="年度图表指标"><option value="meanArea">平均地块面积（ha）</option><option value="density">地块密度（个/km²）</option><option value="boundaryDensity">边界密度（km/km²）</option></select>
        <svg v-if="series.some(item=>item.value !== null)" class="pa-chart" viewBox="0 0 300 145" role="img" aria-label="同一地图范围的年度指标变化">
          <path d="M30 12 V115 H280" fill="none" stroke="#b8c9dc"/>
          <path v-for="(line,index) in chartLines" :key="index" :d="line" fill="none" stroke="#2686f3" stroke-width="2"/>
          <g v-for="(item,index) in series" :key="item.year"><text :x="40+index*110" y="137" text-anchor="middle">{{ item.year }}</text><template v-if="item.value !== null"><circle :cx="40+index*110" :cy="chartY(item.value)" r="4" fill="#2686f3"/><text :x="40+index*110" :y="chartY(item.value)-8" text-anchor="middle">{{ item.value.toFixed(2) }}</text></template><text v-else :x="40+index*110" y="70" text-anchor="middle">暂无数据</text></g>
        </svg>
        <div v-else class="pa-empty">暂无年度数据，接入2024—2026年地块后展示趋势。</div>
      </template>
    </div>
  </section>
  <legend-card :title="changes && mode === 'pattern' ? '地块面积变化' : metricTitle" :items="legend" :note="changes && mode === 'pattern' ? '对比最早可用年份与所选年份' : '仅显示含地块网格；空白区域不代表低密度。'"/>
  <div class="pa-years" aria-label="分析年份"><button v-for="value in ['current','2024','2025','2026']" :key="value" :class="{on:year === value}" @click="year=value">{{ value === 'current' ? '现有数据' : value }}</button><span>{{ year === 'current' ? '年份未标定' : year + '年' }}</span></div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch, markRaw } from 'vue'
/* global defineProps */
import axios from 'axios'
import GeoJSON from 'ol/format/GeoJSON'
import Feature from 'ol/Feature'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import LineString from 'ol/geom/LineString'
import { Style, Stroke, Fill } from 'ol/style'
import { unByKey } from 'ol/Observable'
import { transformExtent } from 'ol/proj'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import LegendCard from '@/components/part/legend-card.vue'
import { analyzeParcels, compareParcels, classify, COLORS, DENSITY_BINS, AREA_BINS, CHANGE_COLORS } from '@/utils/parcel-analysis'

const props = defineProps({mode:{type:String,required:true}})
const store = useMapStore()
const {panel,panelStyle,startDrag} = usePanelDrag()
const collapsed=ref(false), metric=ref('density'), year=ref('current'), chartMetric=ref('meanArea')
const notice=ref('正在准备统计…'), loading=ref(false), result=ref(null), annual=ref({}), changes=ref(null)
let layer=null, moveKey=null, debounce=null, controller=null, generation=0, disposed=false
let originalVisible=null
let config={years:{}}
const effectiveMetric=computed(()=>props.mode === 'pattern' ? 'meanArea' : metric.value)
const breaks=computed(()=>effectiveMetric.value === 'density' ? DENSITY_BINS : AREA_BINS)
const labels=computed(()=>effectiveMetric.value === 'density' ? ['＜5','5—＜12','12—＜25','25—＜40','≥40'] : ['＜1','1—＜5','5—＜10','10—＜25','≥25'])
const metricTitle=computed(()=>effectiveMetric.value === 'density' ? '地块密度（个/km²）' : '平均地块面积（ha）')
const changeLegend=[{kind:'stable',label:'基本稳定'},{kind:'expanded',label:'地块扩大'},{kind:'shrunk',label:'地块缩小'},{kind:'added',label:'新增地块'},{kind:'removed',label:'消失地块'}]
const legend=computed(()=>changes.value && props.mode === 'pattern' ? [...changeLegend.map(item=>({...item,color:CHANGE_COLORS[item.kind]})),{label:'重心迁移（起点→终点）',color:'#8e5ff0'}] : labels.value.map((label,index)=>({label,color:COLORS[index]})))
const bins=computed(()=>labels.value.map((label,index)=>({label,percent:result.value?.grid.length ? result.value.grid.filter(cell=>classify(cell[effectiveMetric.value],breaks.value) === index).length/result.value.grid.length*100 : 0})))
const baselineYear=computed(()=>Object.keys(annual.value).sort()[0])
const baselineResult=computed(()=>year.value !== 'current' && baselineYear.value !== year.value ? annual.value[baselineYear.value] : null)
const delta=(value,before)=>before && value != null ? ((value-before)/before*100 >= 0 ? '+' : '')+((value-before)/before*100).toFixed(1)+'%' : '—'
const format=value=>value == null ? '—' : value.toFixed(2)
const cards=computed(()=>[{label:'平均地块面积',value:format(result.value?.meanArea),unit:'ha'},{label:'地块密度',value:format(result.value?.density),unit:'个/km²'},{label:'聚合度',value:'—',unit:'暂无数据'},{label:'边界密度',value:format(result.value?.boundaryDensity),unit:'km/km²'}])
const series=computed(()=>[2024,2025,2026].map(value=>({year:value,value:annual.value[value]?.[chartMetric.value] ?? null})))
const chartY=value=>110-value/Math.max(1,...series.value.map(item=>item.value || 0))*80
const chartLines=computed(()=>series.value.slice(1).flatMap((item,index)=>item.value !== null && series.value[index].value !== null ? [`M${40+index*110} ${chartY(series.value[index].value)} L${150+index*110} ${chartY(item.value)}`] : []))
function clearLayer(){if(layer && store.map) store.map.removeLayer(layer);layer=null}
function draw(){
  clearLayer()
  if(!result.value?.count) return
  const projection=store.map.getView().getProjection()
  const reader=new GeoJSON()
  const items=changes.value && props.mode === 'pattern' ? changes.value.map(record=>{
    const feature=reader.readFeature(reader.writeFeatureObject(record.feature),{dataProjection:'EPSG:4326',featureProjection:projection})
    feature.set('color',CHANGE_COLORS[record.kind]);return feature
  }) : result.value.grid.map(cell=>{
    const geometry=cell.geometry.clone().transform('EPSG:4326',projection)
    return new Feature({geometry,color:COLORS[classify(cell[effectiveMetric.value],breaks.value)]})
  })
  if(changes.value && props.mode === 'pattern'){
    const baseline=Object.keys(annual.value).sort()[0]
    const before=annual.value[baseline]?.center, after=result.value.center
    if(before && after) items.push(new Feature({geometry:new LineString([before,after]).transform('EPSG:4326',projection),migration:true}))
    if(before && after) {
      const dx=after[0]-before[0],dy=after[1]-before[1],distance=Math.hypot(dx,dy)
      if(distance > 0) {
        const size=Math.min(distance*0.2,0.03),ux=dx/distance,uy=dy/distance
        items.push(new Feature({geometry:new LineString([[after[0]-size*ux-size*uy*0.5,after[1]-size*uy+size*ux*0.5],after,[after[0]-size*ux+size*uy*0.5,after[1]-size*uy-size*ux*0.5]]).transform('EPSG:4326',projection),migration:true}))
      }
    }
  }
  layer=new VectorLayer({source:new VectorSource({features:items}),zIndex:70,style:feature=>feature.get('migration') ? new Style({stroke:new Stroke({color:'#8e5ff0',width:3,lineDash:[7,5]})}) : new Style({fill:new Fill({color:feature.get('color')+'b3'}),stroke:new Stroke({color:feature.get('color'),width:1})})})
  store.map.addLayer(layer)
}
async function fetchData(source,extent,signal){
  if(!source || (!source.url && !source.layer)) throw new Error('该年份尚未配置农田地块数据源')
  const response=source.url ? await axios.get(source.url,{signal,timeout:60000}) : await axios.get(`${store.baseUrl}/geoserver/agri-agent/ows`,{signal,timeout:60000,params:{service:'WFS',version:'1.0.0',request:'GetFeature',typeName:source.layer || 'agri-agent:bh_agri_parcel',outputFormat:'application/json',srsName:'EPSG:4326',maxFeatures:6001,bbox:extent.join(',')+',EPSG:4326'}})
  const data=typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  if(!Array.isArray(data?.features)) throw new Error('地块服务返回的数据格式无效')
  if(!source.url && (data.features.length > 6000 || Number(data.totalFeatures) > 6000 || Number(data.numberMatched) > 6000)) throw new Error('当前范围地块过多，请放大地图后统计')
  const features=new GeoJSON().readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:'EPSG:4326'})
  return analyzeParcels(features,extent,source.idField || config.idField)
}
async function refresh(){
  if(disposed || !store.map?.getView) return
  const token=++generation
  controller?.abort();controller=new AbortController()
  const signal=controller.signal
  clearLayer();result.value=null;annual.value={};changes.value=null
  store.agriParcelLayer?.setVisible(false)
  loading.value=true;notice.value='正在统计当前地图范围…'
  const extent=transformExtent(store.map.getView().calculateExtent(store.map.getSize()),store.map.getView().getProjection(),'EPSG:4326')
  try{
    const entries=Object.entries(config.years || {}).filter(([key])=>['2024','2025','2026'].includes(key))
    const selected=year.value === 'current' ? {layer:'agri-agent:bh_agri_parcel'} : config.years?.[year.value]
    if(!selected || (!selected.url && !selected.layer)){notice.value=`${year.value}年农田地块数据尚未接入`;return}
    const current=await fetchData(selected,extent,signal)
    if(token !== generation) return
    result.value=markRaw(current)
    notice.value=current.count ? '统计完成；移动或缩放地图可更新范围' : '当前视野内没有农田地块'
    draw()
    const outcomes=await Promise.allSettled(entries.map(async([key,source])=>[key,await fetchData(source,extent,signal)]))
    if(token !== generation) return
    annual.value=markRaw(Object.fromEntries(outcomes.filter(item=>item.status === 'fulfilled').map(item=>item.value)))
    if(year.value !== 'current'){
      const baseline=Object.keys(annual.value).sort()[0]
      if(baseline && baseline !== year.value) changes.value=compareParcels(annual.value[baseline],current)
    }
    if(outcomes.some(item=>item.status === 'rejected')) notice.value += '；部分年度数据加载失败，可重试'
    draw()
  }catch(error){if(token === generation && !signal.aborted) notice.value=error.message === 'Network Error' ? '无法连接地块服务，请检查服务后重试' : error.message}
  finally{if(token === generation) loading.value=false}
}
watch([()=>props.mode,metric],draw)
watch(year,refresh)
onMounted(async()=>{
  originalVisible=store.agriParcelLayer?.getVisible()
  moveKey=store.map.on('movestart',()=>{generation++;controller?.abort();clearLayer();result.value=null;annual.value={};changes.value=null;notice.value='地图移动后将重新统计';loading.value=true})
  const endKey=store.map.on('moveend',()=>{clearTimeout(debounce);debounce=setTimeout(refresh,350)})
  moveKey=[moveKey,endKey]
  try{const response=await axios.get('/static/parcelAnalysis.json');if(response.data && typeof response.data === 'object') config=response.data}catch(error){/* 未配置年度数据时仍可统计现有地块 */}
  if(!disposed) refresh()
})
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();clearTimeout(debounce);if(moveKey) unByKey(moveKey);clearLayer();if(originalVisible !== null && originalVisible !== undefined) store.agriParcelLayer?.setVisible(originalVisible)})
</script>

<style scoped>
.pa-panel{position:fixed;left:12px;top:calc(var(--header-h) + var(--tabs-h) + 12px);width:330px;max-width:calc(100vw - 80px);z-index:1200;pointer-events:auto;overflow:hidden}
.pa-header{display:flex;align-items:center;justify-content:space-between;padding:14px;color:#174e92;font-weight:600;cursor:move;touch-action:none}
.pa-header button,.pa-retry{border:0;background:transparent;color:#267edc;cursor:pointer;font-size:12px}
.pa-body{padding:0 14px 15px;max-height:calc(100vh - 280px);overflow:auto;font-size:12px}
.pa-note{color:#7890a8;line-height:1.7;margin:9px 0}.pa-status{color:#355775;line-height:1.7}
.pa-switch{display:flex;gap:4px}.pa-switch button,.pa-years button{border:0;border-radius:5px;padding:9px 10px;background:#edf4fc;color:#536e8c;cursor:pointer}.pa-switch .on,.pa-years .on{color:white;background:#2686f3}
.pa-bin{display:flex;align-items:center;gap:8px;margin:12px 0}.pa-bin>span{width:70px}.pa-bin b{width:45px;text-align:right}.pa-bar{flex:1;height:10px;background:#edf2f6}.pa-bar i{display:block;height:100%}
.pa-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.pa-cards>div{padding:11px;background:#f4f8fc;border-radius:6px}.pa-cards span,.pa-cards small{display:block;color:#7890a8}.pa-cards b{display:block;font-size:20px;color:#174e92;margin:6px 0}
.pa-empty{padding:22px 12px;background:#f4f8fc;color:#7890a8;line-height:1.8;text-align:center;border-radius:6px;margin-top:10px}.pa-chart{width:100%;margin-top:10px;font-size:10px;fill:#68839e}.pa-body select{width:100%;padding:7px;border:1px solid #d7e4f2;border-radius:5px;color:#536e8c;background:white}
.pa-years{position:fixed;bottom:32px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:white;border-radius:9px;padding:12px;box-shadow:0 4px 16px #06225433;z-index:1200;pointer-events:auto;white-space:nowrap}.pa-years span{font-size:12px;color:#7890a8}.pa-change-counts{display:flex;flex-wrap:wrap;gap:9px;color:#536e8c}
@media(max-width:600px){.pa-panel{width:280px}.pa-years{gap:4px;max-width:95vw}.pa-years button{padding:8px}.pa-years span{display:none}}
</style>
