<template>
  <section ref="panel" class="pa-panel float-panel" :style="panelStyle">
    <header class="pa-header" @pointerdown="startDrag"><span>{{ titles[mode] }}</span><button @pointerdown.stop @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</button></header>
    <div v-show="!collapsed" class="pa-body">
      <p class="pa-note">{{ year }}年 · 全部农业地块范围</p>
      <p role="status" aria-live="polite" class="pa-status">{{ notice }}</p>
      <button v-if="!loading" class="pa-retry" @click="refresh">重新加载全部数据</button>
      <div v-if="mode === 'stats'" class="pa-switch"><button :class="{on:metric === 'count'}" @click="metric = 'count'">数量分类</button><button :class="{on:metric === 'meanArea'}" @click="metric = 'meanArea'">平均地块面积分类</button></div>
      <template v-else>
        <label class="pa-label">地图指标<select v-model="mapMetric"><option v-if="mode === 'pattern'" value="meanArea">平均地块面积</option><option v-if="mode === 'pattern'" value="connected">连片网格</option><option v-if="mode === 'pattern'" value="hotspots">破碎化高值网格</option><option value="areaDelta">面积净变化（ha）</option><option value="countDelta">地块数量净变化（个）</option></select></label>
        <label class="pa-label">对比基准年份<select v-model="baselineYear"><option v-for="value in availableYears" :key="value" :value="value">{{ value }}年</option></select></label>
      </template>
      <template v-if="result">
        <p class="pa-note">{{ result.count.toLocaleString() }} 个地块 · 总面积 {{ result.totalArea.toFixed(2) }} ha</p>
        <p class="pa-note">固定10 km × 10 km网格 · {{ result.grid.length }}格（其中{{ result.occupiedCount }}格有地块）。展示全部网格，三个年份采用同一网格范围。</p>
        <template v-if="mode === 'stats'">
          <div v-for="(bin,index) in bins" :key="bin.label" class="pa-bin"><span>{{ bin.label }}</span><div class="pa-bar"><i :style="{width:bin.percent+'%',background:COLORS[index]}"></i></div><b>{{ bin.percent.toFixed(1) }}%</b></div>
          <p class="pa-note">分类占比按所选年度含地块网格数计算；空格不参与分级。</p>
        </template>
        <template v-else>
          <p v-if="baselineResult" class="pa-note">{{ baselineYear }}→{{ year }}年：数量 {{ signed(result.count-baselineResult.count,0) }}个，面积 {{ signed(result.totalArea-baselineResult.totalArea,2) }} ha。年度成果差异不直接等同于新增耕地或弃耕。</p>
          <p v-if="year === baselineYear" class="pa-note">当前年与基准年相同，差值为0；切换年份或基准年查看变化。</p>
          <div class="pa-cards"><div v-for="item in cards" :key="item.label"><span>{{ item.label }}</span><b>{{ format(item.value,item.digits) }}</b><small>{{ item.unit }}</small></div></div>
          <p v-if="mode === 'pattern'" class="pa-note">网格邻接率＝有耕地的共边邻接数÷有效网格四邻接总数。连片网格按共边连通分组，不代表田块边界相连。破碎化高值按全范围单位耕地面积地块数前20%筛选，属于探索性高值分布。</p>
          <p v-if="mode === 'pattern'" class="pa-note">形状指数＝周长÷(2√π面积)，越大边界越复杂；最近邻为地块质心到流域内其他质心的最短投影距离。面积重心箭头：基准年→所选年。</p>
        </template>
        <div v-if="selectedCell" class="pa-details"><b>网格 {{ selectedCell.gx }},{{ selectedCell.gy }} 的年度数值</b><div v-for="item in cellHistory" :key="item.year">{{ item.year }}：{{ item.count }}个 · 平均{{ item.meanArea == null ? '—' : item.meanArea.toFixed(2) }} ha · 总面积{{ item.area.toFixed(2) }} ha</div></div>
        <p v-else class="pa-note">点击地图网格可查看三年具体数值，颜色相同也可能有变化。</p>
      </template>
      <template v-if="mode !== 'stats'">
        <h4>同一网格范围的年度变化</h4>
        <select v-model="chartMetric" aria-label="年度图表指标"><option value="meanArea">平均地块面积（ha）</option><option value="count">地块数量（个）</option><option value="totalArea">总面积（ha）</option><option value="density">地块密度（个/km²）</option><option value="meanShape">平均形状指数</option><option value="meanNearest">平均最近邻距离（m）</option></select>
        <svg v-if="series.some(item=>item.value !== null)" class="pa-chart" viewBox="0 0 300 145" role="img" aria-label="同一网格范围的年度指标变化">
          <path d="M30 12 V115 H280" fill="none" stroke="#b8c9dc"/><path v-for="(line,index) in chartLines" :key="index" :d="line" fill="none" stroke="#2686f3" stroke-width="2"/>
          <g v-for="(item,index) in series" :key="item.year"><text :x="40+index*110" y="137" text-anchor="middle">{{ item.year }}</text><template v-if="item.value !== null"><circle :cx="40+index*110" :cy="chartY(item.value)" r="4" fill="#2686f3"/><text :x="40+index*110" :y="chartY(item.value)-8" text-anchor="middle">{{ item.value.toFixed(2) }}</text></template></g>
        </svg>
        <div v-else class="pa-empty">{{ loading ? '正在加载年度变化…' : '暂无年度变化数据，请重新加载。' }}</div>
      </template>
      <p class="pa-note">年度地块为已提取的矢量成果；卫星底图为参考影像，未按2024—2026年切换。{{ config.qualityNote }}</p>
    </div>
  </section>
  <legend-card :title="metricTitle" :items="legend" :note="legendNote"/>
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
import { unByKey } from 'ol/Observable'
import { Style, Stroke, Fill } from 'ol/style'
import useMapStore from '@/stores/map'
import { usePanelDrag } from '@/composables/usePanelDrag'
import LegendCard from '@/components/part/legend-card.vue'
import { analyzeServerGrid, alignAnnualGrids, compareGridYears, changeClass, COLORS, CHANGE_COLORS } from '@/utils/parcel-analysis'

const props = defineProps({mode:{type:String,required:true}})
const store=useMapStore(),{panel,panelStyle,startDrag}=usePanelDrag()
const titles={stats:'耕地统计特征',pattern:'空间格局变化',change:'耕地变化检测'}
const collapsed=ref(false),metric=ref('count'),mapMetric=ref(props.mode === 'change' ? 'areaDelta' : 'meanArea'),chartMetric=ref('meanArea')
const year=computed(()=>store.getCurrentParcelDate().slice(0,4) || '2024')
const baselineYear=ref('2024'),availableYears=['2024','2025','2026']
const notice=ref('正在准备统计…'),loading=ref(false),annual=ref({}),selectedKey=ref(null)
const config=ref({years:{}})
const result=computed(()=>annual.value[year.value] || null)
const baselineResult=computed(()=>annual.value[baselineYear.value] || null)
const changes=computed(()=>compareGridYears(baselineResult.value,result.value))
const selectedCell=computed(()=>result.value?.grid.find(cell=>cell.key === selectedKey.value))
const cellHistory=computed(()=>availableYears.map(value=>({year:value,...annual.value[value]?.grid.find(cell=>cell.key===selectedKey.value)})))
watch([notice,loading],([status,busy])=>{store.parcelAnalysisNotice=status;store.parcelAnalysisLoading=busy},{immediate:true,flush:'sync'})
let layer=null,clickKey=null,controller=null,generation=0,disposed=false,originalVisible=null
const labels=computed(()=>metric.value === 'count' ? ['＜500','500—＜1200','1200—＜2500','2500—＜4000','≥4000'] : ['＜10','10—＜30','30—＜60','60—＜100','≥100'])
const cellClass=cell=>(metric.value === 'count' ? cell.countClass : cell.areaClass)-1
const bins=computed(()=>labels.value.map((label,index)=>({label,percent:result.value?.occupiedCount ? result.value.grid.filter(cell=>cell.count>0 && cellClass(cell) === index).length/result.value.occupiedCount*100 : 0})))
const isChange=computed(()=>props.mode !== 'stats' && ['countDelta','areaDelta'].includes(mapMetric.value))
const tolerance=computed(()=>mapMetric.value === 'countDelta' ? 1 : 0.1)
const metricTitle=computed(()=>props.mode === 'stats' ? (metric.value === 'count' ? '地块数量（个/格）' : '平均地块面积（ha）') : ({meanArea:'平均地块面积（ha）',connected:'共边连通网格',hotspots:'破碎化高值网格',areaDelta:'面积净变化（ha）',countDelta:'数量净变化（个）'})[mapMetric.value])
const colorLegend=computed(()=>{
  if(isChange.value){const t=tolerance.value;return [`减少＞${10*t}`,`减少＞${t}至${10*t}`,`变化绝对值≤${t}`,`增加＞${t}至${10*t}`,`增加＞${10*t}`].map((label,index)=>({label,color:CHANGE_COLORS[index]}))}
  if(props.mode !== 'stats' && mapMetric.value === 'connected') return [{label:'连通组内网格',color:'#2686f3'},{label:'孤立网格',color:'#dce4eb'}]
  if(props.mode !== 'stats' && mapMetric.value === 'hotspots') return [{label:'全范围破碎化高值',color:'#ec8542'},{label:'其他有效网格',color:'#dce4eb'}]
  return (props.mode === 'stats' ? labels.value : ['＜10','10—＜30','30—＜60','60—＜100','≥100']).map((label,index)=>({label,color:COLORS[index]}))
})
const legend=computed(()=>[...colorLegend.value,...(props.mode==='pattern' && baselineYear.value!==year.value && baselineResult.value?.center && result.value?.center ? [{label:'面积重心迁移（基准→所选年）',color:'#8e5ff0'}] : [])])
const legendNote=computed(()=>isChange.value ? `${baselineYear.value}→${year.value}；年度成果净差异，不等同于土地用途变化。` : '固定10公里网格；仅对所选年含地块网格分级，空白不代表低密度。')
const signed=(value,digits)=>`${value>0?'+':''}${value.toFixed(digits)}`
const format=(value,digits=2)=>value == null ? '—' : value.toFixed(digits)
const cards=computed(()=>props.mode === 'change' ? [
  {label:'数量净变化',value:baselineResult.value && result.value ? result.value.count-baselineResult.value.count : null,unit:'个',digits:0},
  {label:'面积净变化',value:baselineResult.value && result.value ? result.value.totalArea-baselineResult.value.totalArea : null,unit:'ha'}
] : [
  {label:'平均地块面积',value:result.value?.meanArea,unit:'ha'},{label:'地块密度',value:result.value?.density,unit:'个/km²'},
  {label:'网格邻接率',value:result.value?.adjacencyRate,unit:'%'},{label:'边界密度',value:result.value?.boundaryDensity,unit:'km/km²'},
  {label:'平均形状指数',value:result.value?.meanShape,unit:'无量纲'},{label:'面积加权形状指数',value:result.value?.weightedShape,unit:'无量纲'},
  {label:'平均最近邻距离',value:result.value?.meanNearest,unit:'m'},{label:'共边连通组数',value:result.value?.components,unit:'组',digits:0}])
const series=computed(()=>availableYears.map(value=>({year:value,value:annual.value[value]?.[chartMetric.value] ?? null})))
const chartY=value=>110-value/Math.max(1,...series.value.map(item=>item.value || 0))*80
const chartLines=computed(()=>series.value.slice(1).flatMap((item,index)=>item.value!==null && series.value[index].value!==null ? [`M${40+index*110} ${chartY(series.value[index].value)} L${150+index*110} ${chartY(item.value)}`] : []))
function clearLayer(){if(layer && store.map) store.map.removeLayer(layer);layer=null}
function color(cell){
  if(isChange.value) return CHANGE_COLORS[changeClass(cell[mapMetric.value],tolerance.value)]
  if(props.mode !== 'stats' && mapMetric.value === 'connected') return result.value.connectedKeys.has(cell.key) ? '#2686f3' : '#dce4eb'
  if(props.mode !== 'stats' && mapMetric.value === 'hotspots') return result.value.hotspotKeys.has(cell.key) ? '#ec8542' : '#dce4eb'
  return COLORS[props.mode === 'stats' ? cellClass(cell) : cell.areaClass-1]
}
function draw(){
  clearLayer();if(!result.value) return
  const projection=store.map.getView().getProjection()
  const cells=isChange.value ? changes.value || [] : result.value.grid.filter(cell=>cell.count>0)
  const items=cells.map(cell=>new Feature({geometry:cell.geometry.clone().transform('EPSG:4326',projection),color:color(cell),key:cell.key}))
  // Centroid migration depends on annual area sums, never on parcel identifiers.
  const before=baselineResult.value?.center,after=result.value.center
  if(props.mode === 'pattern' && before && after && baselineYear.value!==year.value){
    items.push(new Feature({geometry:new LineString([before,after]).transform('EPSG:4326',projection),migration:true}))
    const dx=after[0]-before[0],dy=after[1]-before[1],distance=Math.hypot(dx,dy)
    if(distance>0){const size=Math.min(distance*0.2,0.03),ux=dx/distance,uy=dy/distance
      items.push(new Feature({geometry:new LineString([[after[0]-size*ux-size*uy*0.5,after[1]-size*uy+size*ux*0.5],after,[after[0]-size*ux+size*uy*0.5,after[1]-size*uy-size*ux*0.5]]).transform('EPSG:4326',projection),migration:true}))}
  }
  layer=markRaw(new VectorLayer({source:new VectorSource({features:items}),zIndex:70,style:feature=>feature.get('migration') ? new Style({stroke:new Stroke({color:'#8e5ff0',width:3})}) : new Style({fill:new Fill({color:feature.get('color')+'b3'}),stroke:new Stroke({color:feature.get('color'),width:1})})}))
  store.map.addLayer(layer)
}
async function fetchData(source,signal){
  if(!source?.gridLayer) throw new Error('该年度10公里网格尚未配置')
  const response=await axios.get(`${store.baseUrl}/geoserver/agri-agent/ows`,{signal,timeout:60000,params:{service:'WFS',version:'2.0.0',request:'GetFeature',typeNames:source.gridLayer,outputFormat:'application/json',srsName:'urn:ogc:def:crs:OGC:1.3:CRS84',count:10000,DATA_VERSION:config.value.dataVersion}})
  const data=typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  if(!Array.isArray(data?.features) || Number(data.numberMatched)>data.features.length) throw new Error('服务器网格数据未完整返回')
  return analyzeServerGrid(new GeoJSON().readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:'EPSG:4326'}))
}
async function refresh(){
  if(disposed || !store.map?.getView) return
  const token=++generation;controller?.abort();controller=new AbortController()
  clearLayer();annual.value={};selectedKey.value=null;store.agriParcelLayer?.setVisible(false)
  loading.value=true;notice.value='正在加载全范围的三年10公里网格…'
  try{
    const outcomes=await Promise.all(availableYears.map(async value=>[value,await fetchData(config.value.years[value],controller.signal)]))
    if(token!==generation || disposed) return
    annual.value=markRaw(alignAnnualGrids(Object.fromEntries(outcomes)))
    notice.value=result.value?.count ? `${year.value}年统计完成；可点击网格查看年度数值` : `${year.value}年当前网格范围无地块`
    draw()
  }catch(error){if(token===generation && !controller.signal.aborted) notice.value=error.message === 'Network Error' ? '无法连接网格服务，请重试' : error.message}
  finally{if(token===generation) loading.value=false}
}
watch([year,metric,mapMetric,baselineYear],()=>{if(result.value){notice.value=`${year.value}年统计完成；可点击网格查看年度数值`;draw()}})
onMounted(async()=>{
  originalVisible=store.agriParcelLayer?.getVisible()
  if(store.map?.on) clickKey=markRaw(store.map.on('singleclick',event=>{
    const feature=store.map.forEachFeatureAtPixel(event.pixel,item=>item,{layerFilter:item=>item===layer})
    selectedKey.value=feature?.get('key') || null
  }))
  try{const response=await axios.get('/static/parcelAnalysis.json');if(response.data && typeof response.data==='object') config.value=response.data}
  catch(error){notice.value='无法加载农业网格配置';return}
  if(!disposed) await refresh()
})
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();clearLayer();if(clickKey) unByKey(clickKey);store.parcelAnalysisLoading=false;store.parcelAnalysisNotice='';if(originalVisible != null) store.agriParcelLayer?.setVisible(originalVisible)})
</script>

<style scoped>
.pa-panel{position:fixed;left:12px;top:calc(var(--header-h) + var(--tabs-h) + 12px);width:350px;max-width:calc(100vw - 80px);z-index:1200;pointer-events:auto;overflow:hidden}
.pa-header{display:flex;align-items:center;justify-content:space-between;padding:14px;color:#174e92;font-weight:600;cursor:move;touch-action:none}
.pa-header button,.pa-retry{border:0;background:transparent;color:#267edc;cursor:pointer;font-size:12px}
.pa-body{padding:0 14px 15px;max-height:calc(100vh - 280px);overflow:auto;font-size:12px}.pa-note{color:#688099;line-height:1.7;margin:9px 0}.pa-status{color:#355775;line-height:1.7}
.pa-switch{display:flex;gap:4px;margin-top:10px}.pa-switch button{border:0;border-radius:5px;padding:9px 10px;background:#edf4fc;color:#536e8c;cursor:pointer}.pa-switch .on{color:white;background:#2686f3}
.pa-bin{display:flex;align-items:center;gap:8px;margin:12px 0}.pa-bin>span{width:100px}.pa-bin b{width:45px;text-align:right}.pa-bar{flex:1;height:10px;background:#edf2f6}.pa-bar i{display:block;height:100%}
.pa-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.pa-cards>div{padding:11px;background:#f4f8fc;border-radius:6px}.pa-cards span,.pa-cards small{display:block;color:#7890a8}.pa-cards b{display:block;font-size:20px;color:#174e92;margin:6px 0}
.pa-empty,.pa-details{padding:12px;background:#f4f8fc;color:#536e8c;line-height:1.8;border-radius:6px;margin-top:10px}.pa-chart{width:100%;margin-top:10px;font-size:10px;fill:#68839e}.pa-body select{width:100%;padding:7px;border:1px solid #d7e4f2;border-radius:5px;color:#536e8c;background:white}.pa-label{display:block;margin-top:10px;line-height:2}
@media(max-width:600px){.pa-panel{width:280px}}
</style>
