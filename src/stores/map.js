import {defineStore, storeToRefs} from "pinia";
import axios from "axios";
import {Layer, Tile} from "ol/layer";
import {OSM, TileWMS, WMTS, XYZ} from "ol/source";
// 注意：这里必须改名。ol 的 Map 会盖掉原生的 Map，
// 后果是 new Map() 拿到的是地图对象，拿它当字典用就会报 "xxx.values is not a function"
import {Map as OlMap, View} from "ol";
import {unByKey} from "ol/Observable";
import {getRenderPixel} from 'ol/render';
// 新增

import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';

import { Style, Stroke, Fill, Text, Circle } from 'ol/style';

import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Point from 'ol/geom/Point';
import MultiPoint from 'ol/geom/MultiPoint';
import MultiLineString from 'ol/geom/MultiLineString';
import { fromLonLat } from 'ol/proj';

import OSMXML from 'ol/format/OSMXML';
import EsriJSON from 'ol/format/EsriJSON';

import { transformExtent } from 'ol/proj';

import { apply } from 'ol-mapbox-style';
import { markRaw } from 'vue';
import VectorTileLayer from 'ol/layer/VectorTile';
import { getArea } from 'ol/sphere';

import PointerInteraction from 'ol/interaction/Pointer';

import TileLayer from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import { fromArrayBuffer } from 'geotiff';
import { sampleParcelMarkers, loadParcelAnimationFeatures, parcelSweepProgress } from '@/utils/parcel-animation';
import { fetchRecognitionFeatures } from '@/utils/recognition-data';
import {
    CROP_TYPES, CROP_YEARS, CROP_STYLE_NAME, CROP_STATS_URL, CROP_TEMPORAL_STATS_URL,
    CROP_ROTATION_LAYER, CROP_ROTATION_STYLE, CROP_STABILITY_STYLE,
    CROP_PARCEL_FIELD, CROP_TYPE_FIELD,
    cropLayerName, cropTypeName, cropFilterExpression,
    rotationFilterExpression, stabilityFilterExpression
} from '@/utils/crop-types';



// 巴尔喀什湖流域的经纬度边界框
const BALKHASH_EXTENT = [72.828369, 43.325178, 81.738281, 47.620975];

// 农田地块边界叠加的参数。
// 地块数据存在 PostGIS 里，整个流域约 34 万个面，全量加载不现实，
// 因此按当前视图范围分块取数，并对范围大小和要素数量设上限。
const PARCEL_LAYER_NAME = 'agri-agent:bh_agri_parcel';
const PARCEL_MAX_SPAN = 0.2;        // 视图经纬度跨度上限（度），超过则不取数，等用户放大
const PARCEL_MAX_FEATURES = 6000;   // 单次取数的要素上限
const PARCEL_SNAP = 1e-6;           // 顶点合并精度（度），约 0.1 米
const PARCEL_REFRESH_DELAY = 400;   // 地图移动后重新取数的防抖时间（毫秒）

// 农田页日期时间轴。数据还没接入，这里先把接口留出来：
//   1) 日期列表：优先读 /static/parcelTimeline.json，读不到就用下面的占位区间生成；
//   2) 图层数据：由 parcelTimelineSource 描述（见 setParcelTimelineDates），
//      没配置时拖动时间轴只更新日期显示，不发任何请求。
const PARCEL_TIMELINE_DEFAULT_RANGE = {start: '2024-01-01', end: '2026-09-30', step: 'day'};
const PARCEL_TIMELINE_DEBOUNCE = 250;   // 拖动时间轴后延迟取数的时间（毫秒）
const PARCEL_TIMELINE_PLAY_INTERVAL = 1200; // 自动播放时每帧间隔（毫秒）

// 框选截取：拖出矩形后自动缩放居中，并把矩形以外的内容遮住，
// 之后切换日期、开关图层都只在矩形内可见。再点一次按钮取消。
const PARCEL_ROI_MASK_COLOR = 'rgba(0, 0, 0, 0.45)'; // 选区外压一层阴影：底图仍在，只是暗下来
const PARCEL_ROI_PADDING = 32; // 选区四周留白（像素）
const PARCEL_ROI_MIN_PIXELS = 8; // 框选的最小边长（像素）
const PARCEL_ROI_EDGE_TOLERANCE = 8; // 按住选中框边框拖动的判定范围（像素）

// 作物结构分析。统计范围跟着框选走，选区一变就重新取数重算。
// 三年的地块是同一套边界的三份年度分类，行号（FID_1）逐年在同一条地块上，
// 所以跨年比较直接按行号来，不需要另找稳定主键。
// 全流域的数字用 scripts/cut-stats.cjs 离线算好的 JSON：30 多万个面
// 不可能每次进页面都从 WFS 拉一遍；只有框选范围才现算。
const CROP_ANALYSIS_DEFAULT_YEARS = Object.fromEntries(CROP_YEARS.map(year => [year, cropLayerName(year)]));
const CROP_ANALYSIS_BASELINE_YEAR = CROP_YEARS[0]; // 稳定性分析的基准年
const CROP_ANALYSIS_PARCEL_FIELD = CROP_PARCEL_FIELD; // 地块标识，三年同一个编号
const CROP_ANALYSIS_TYPE_FIELD = CROP_TYPE_FIELD;     // 作物类型编码 1-10
const CROP_ANALYSIS_MAX_FEATURES = 400000; // 单年单次取数的要素上限
// 框选后先让框内空着（只留底图），这段时间进度条显示"渲染图层中"
const CROP_ANALYSIS_PREPARE_MS = 1000;
// 换色动画至少跑这么久：每种颜色停留 1.2 秒，6 秒大约轮 5 种，不必把 10 种走完
const CROP_ANALYSIS_BLINK_MIN_MS = 6000;
// 识别动画里每种颜色停留的时间
const CROP_ANALYSIS_SCAN_COLOR_MS = 1200;
// 动画层建好之后由 startCropAnalysisScan 赋值，startCropAnalysisBlink 等满 1 秒再调用它开跑
let cropScanStartHook = null;
const CROP_ANALYSIS_BLINK_CLASS = 'map-identifying'; // 只用于清理旧版标记
const CROP_ANALYSIS_SCAN_INTERVAL = 80;

// 没有框选时默认统计整个流域，用的是流域图层的范围
const CROP_ANALYSIS_FULL_EXTENT = [72.4875, 42.2583, 85.0006, 49.1297];
// 离线统计 JSON 的模块级缓存，一次会话只请求一次
let cropStatsPromise = null;
let cropTemporalStatsPromise = null;

// 农田页地区下拉框。数据还没接入，先内置几个流域内的地点作为占位，
// 接数据时用 setParcelRegions 传入，或者放 /static/parcelRegions.json。
// "全部"这个选项固定排在最后，选中后回到下面的完整视图。
const PARCEL_REGION_ALL_ID = '__all__';
const PARCEL_DEFAULT_VIEW = {center: [78.25, 45.72], zoom: 7.15}; // 要和 land-mass.vue 里的初始视图一致
const PARCEL_REGION_PADDING = 24; // 用 extent 定位时四周留白（像素）
const PARCEL_REGION_PLACEHOLDER = [
    {id: 'balkhash-lake', name: '巴尔喀什湖', center: [76.5, 46.2], zoom: 7.2},
    {id: 'kapchagay', name: '卡普恰盖水库', center: [77.07, 43.89], zoom: 9.5},
    {id: 'ili-delta', name: '伊犁河三角洲', center: [74.0, 45.4], zoom: 9},
    {id: 'taldykorgan', name: '塔尔迪库尔干', center: [78.37, 45.02], zoom: 9.5}
];

// 要素属性名的大小写在不同数据源上不一样：shapefile 里是 Max_gridco / FID_1，
// 换成 PostGIS 之后变成了 max_gridco / fid_1。这里忽略大小写读一次，两边都能用。
const readFeatureProperty = (properties, name) => {
    if(!properties || !name) return undefined
    if(properties[name] !== undefined) return properties[name]
    const lower = String(name).toLowerCase()
    const key = Object.keys(properties).find(k => k.toLowerCase() === lower)
    return key === undefined ? undefined : properties[key]
}


// 时空数据模块：本地数据包 public/data/temporal/。
// 高程、坡度的 TIFF 像元值按需读取，读完缓存在这里。
const temporalRasterCache = new Map()
const temporalRasterPromises = new Map()
const TEMPORAL_RASTER_EXTENT = [68, 40, 88, 50]
const TEMPORAL_WEATHER_EXTENT = [67.875, 39.875, 88.125, 50.125]


const useMapStore =  defineStore('map',{
    state:()=>({
            currentYear:2023,
            currentMonth:1,
            map: null,
            // 时空数据模块：当前年月、已加载图层、地图色块显隐、悬停结果
            temporalYear:2024,
            temporalMonth:6,
            temporalLayerInstances:{},
            temporalLayerEnabled:{},
            temporalLayerRequests:{},
            temporalRequestRevision:0,
            temporalAnnotationLayers:{},
            temporalClipKeys:{},
            temporalAnimationTimers:{},
            temporalBasinFeatures:[],
            temporalBasinPromise:null,
            temporalNamedRiverFeatures:[],
            temporalPointerEnabled:true,
            temporalLayerColorVisibility:{},
            temporalLayerStatus:{},
            temporalHoverGroup:'imagery',
            temporalHoverInfo:null,
            temporalRefreshTimer:null,
            yearInfo:[],
            monthInfo:[],
            featureInfo:[],
            cropInfo:[],
            cropYear:CROP_YEARS[0], // 当前查看的年份，和年份时间轴同步
            cropSelectedCodes:[],   // 图例选中的作物编码，空数组表示显示全部
            cropStats:null,         // 离线统计的全流域数字（scripts/cut-stats.cjs 生成）
            cropTemporalStats:null, // 1009 数据的时序 / 种植分析统计（scripts/temporal-analysis.cjs 生成）
            cropTab:'visual',       // 二级页签，决定地图上显示哪一层
            rotationSelected:'',    // 选中的轮作序列，空串表示前十种全显示
            stabilitySelected:'',   // 选中的稳定性分级 0/1/2，空串表示三级全显示
            rotationLayer:null,     // 分析图层：作物时间序列看轮作类型，种植分析看稳定性
            imageryInfo:[],
            topoInfo:[], // 地形图信息
            yearPlayer: {},
            monthPlayer: {},
            isYearPlaying:false,
            isMonthPlaying:false,
            is3D:false,
            cropClassificationLayers:[],
            
            basinBoundaryUrl:'', // 用于将流域边界shp的url传递给3D视图
            basinBasicLayer:new Layer({}), // 流域底图layer
            basinBoundaryLayer:new Layer({}), // 流域边界layer
            basinMaskLayer:new Layer({}), // 流域遮罩layer
            basinLabelLayer:new Layer({}), // 流域标签layer
            agriParcelLayer:new Layer({}), // 农田地块layer

            // 农田地块边界与交点叠加
            parcelBoundaryLayer:new Layer({}), // 地块红色边界层
            parcelJunctionLayer:new Layer({}), // 地块边界交点标注层
            parcelBoundaryEnabled:false, // 叠加层开关
            parcelBoundaryLoading:false, // 是否正在取数
            parcelBoundaryNotice:'', // 取数受限时的提示
            parcelBoundaryCount:0, // 当前参与渲染的地块数
            parcelJunctionCount:0, // 当前标注的交点数
            parcelBoundaryMoveKey:null, // moveend 监听句柄
            parcelBoundaryTimer:null, // 防抖定时器
            parcelBoundaryReqId:0, // 请求序号，用于丢弃过期响应

            // 农田页日期时间轴
            parcelTimelineDates:[], // 可选日期，元素为 'YYYY-MM-DD' 或 {date, layer}
            parcelTimelineSource:null, // 数据源配置，接入数据时设置
            parcelTimelineLayer:new Layer({}), // 当前日期对应的图层
            parcelTimelineIndex:0, // 当前选中的日期下标
            parcelTimelinePlaying:false, // 是否正在自动播放
            parcelTimelineLoading:false, // 是否正在取数
            parcelTimelineNotice:'', // 状态提示
            parcelTimelineTimer:null, // 播放定时器
            parcelTimelineApplyTimer:null, // 拖动防抖定时器
            parcelTimelineReqId:0, // 请求序号，用于丢弃过期响应

            // 框选截取
            parcelIdentifyEnabled:false,
            parcelIdentifyLayer:null,
            parcelIdentifyTimer:null,
            parcelIdentifyViewKey:null,
            parcelIdentifyRenderKeys:null,
            parcelIdentifyAbort:null,
            parcelIdentifyOverview:false,
            parcelIdentifyReqId:0,
            parcelIdentifyCount:0,
            parcelIdentifyPhase:'idle',
            parcelIdentifyProgress:0,
            parcelIdentifyNotice:'请在地图上拖出一个矩形',
            parcelIdentifyOriginalVisible:null,
            parcelRoiState:'idle', // idle 未启用 / drawing 待框选 / applied 已框选
            parcelRoiMode:'draw', // draw 继续画框 / pan 拖动地图；不改变已有选区
            parcelRoiMaskLayer:new Layer({}), // 选区外的遮罩
            parcelRoiOutlineLayer:new Layer({}), // 选区边框
            parcelRoiDrawer:null, // 划框的交互
            parcelRoiSketchLayer:null, // 划框过程中的预览图层
            parcelRoiSketchSource:null, // 预览图层的数据源
            parcelRoiBoxSource:null, // 选区要素的数据源（框选后可以拖）
            parcelRoiMaskSource:null, // 遮罩要素的数据源
            parcelRoiRefs:null, // 当前选区的几何引用（{boxGeometry, maskFeature, worldRing}）
            parcelRoiDrag:null, // 拖动选区的交互
            parcelRoiExtent:null, // 选区范围（视图投影）
            parcelRoiPrevView:null, // 取消时用来还原视图

            // 作物结构分析
            cropAnalysisYears:{...CROP_ANALYSIS_DEFAULT_YEARS}, // 年份 -> 图层名
            cropAnalysisYearsLoaded:[], // 实际取到数据的年份
            cropAnalysisResult:null, // 算好的统计结果
            cropAnalysisLoading:false,
            cropAnalysisNotice:'',
            cropAnalysisExtent:null, // 这份统计对应的选区
            cropAnalysisScope:'full', // full 整个流域 / roi 框选范围
            cropAnalysisFullResult:null, // 整个流域的结果缓存，避免每次取消框选都重取
            cropAnalysisPendingKey:'', // 正在取数的范围标识，用来去重
            cropAnalysisBlinkStopTimer:null, // 到点定格的定时器
            cropAnalysisBlinkMaxTimer:null, // 超时兜底定格的定时器，统计太慢时用
            cropAnalysisBlinkContainer:null, // 挂色相动画的作物图层容器
            cropScanLayer:null, // 统计期间的扫描叠加层
            cropScanTimer:null, // 扫描层的换色定时器
            cropScanReqId:0,
            cropScanAbort:null,
            cropScanData:null,
            cropScanPhase:'idle',
            cropScanProgress:0,
            cropScanRenderKeys:null,
            cropScanTargetLayer:null,
            cropScanOriginalVisible:null,
            cropAnalysisBlinkStartedAt:0,
            cropAnalysisReqId:0,
            cropAnalysisAbort:null,

            // 地区下拉框
            parcelRegions:[], // 可选地区
            parcelRegionId:PARCEL_REGION_ALL_ID, // 当前选中的地区
            parcelRegionAllId:PARCEL_REGION_ALL_ID, // “全部”那一项的 id
            parcelRegionAllView:null, // “全部”对应的视图，不设就用 PARCEL_DEFAULT_VIEW
            parcelRegionPlaceholder:false, // 是否用的内置占位地区

            timeLayer: new Layer({}),
            landLayer:new Layer({}),
            colorLayer:new Layer({}),
            cropLayer:new Layer({}), // 农作物layer
            basicLayer:new Layer({}),
            cropLandLayer:new Layer({}),
            cropLayerLine:new Layer({}),
            huanTaiLandLayer:new Layer({}),
            huanTaiColorLayer:new Layer({}),
            administrativeLayer:new Layer({}),
            cropImageryLayers:[{},{}],
            clickItem:-1, // 当前选中的要素ID
            featureId:0,
            currentCrop:'',
            cropList:CROP_TYPES.map(item=>item.code), // 作物类型编码 1-10

            // currentTopo: '', // 当前选中的地形图要素
            isShowFeautureInfo:false,
            clickChoose:{},
            baseUrl:process.env.VUE_APP_GEOSERVER_URL,
            cropWaterShowCylinder:true,
            cropWaterActiveMetric:'blueWater',
            cropWaterActiveDate:'2019-04-18',
            cropWaterActiveCrop:'cotton',
            cropWaterViewportCrop:'wheat',
            cropWaterFocusCrop:null,
            cropWaterFocusRequestId:0,
            cropWaterSummaryData:null,
            cropWaterIsPlaying:false,
            cropWaterLockViewport:false,
    }),
    actions:{
        getTemporalBasinFeatures:async function(){
            if(this.temporalBasinFeatures.length) return this.temporalBasinFeatures
            if(this.temporalBasinPromise) return this.temporalBasinPromise
            const url = `${this.baseUrl}/geoserver/agri-agent/ows`
            this.temporalBasinPromise = axios.get('/data/temporal/basin_boundary.geojson')
            .catch(() => axios.get(url, {timeout:30000, params:{
                service:'WFS', version:'1.0.0', request:'GetFeature',
                typeName:'agri-agent:bh-basin-shp', outputFormat:'application/json', srsName:'EPSG:4326'
            }})).then(res => {
                const projection = this.map?.getView?.().getProjection?.() || 'EPSG:4326'
                this.temporalBasinFeatures = new GeoJSON().readFeatures(res.data, {
                    dataProjection:'EPSG:4326', featureProjection:projection
                }).filter(feature => ['Polygon','MultiPolygon'].includes(feature.getGeometry()?.getType()))
                return this.temporalBasinFeatures
            }).catch(error => {
                console.warn('流域裁剪边界加载失败', error)
                this.temporalBasinFeatures = []
                return []
            }).finally(() => { this.temporalBasinPromise = null })
            return this.temporalBasinPromise
        },
        clipTemporalLayerToBasin:function(id, layer){
            if(!layer || ![
                'rivers','lakes','country_border','province_border','boundaries',
                'elevation','slope','sentinel1','sentinel2'
            ].includes(id)) return
            if(this.temporalClipKeys[id]) unByKey(this.temporalClipKeys[id])
            const saved = new WeakSet()
            const drawRing = (context, event, ring) => {
                ring.forEach((coordinate, index) => {
                    const pixel = getRenderPixel(event, this.map.getPixelFromCoordinate(coordinate))
                    if(index) context.lineTo(pixel[0], pixel[1])
                    else context.moveTo(pixel[0], pixel[1])
                })
                context.closePath()
            }
            const before = layer.on('prerender', event => {
                const context = event.context
                const features = this.temporalBasinFeatures
                if(!context?.save || !context?.clip || !features.length) return
                context.save()
                saved.add(context)
                context.beginPath()
                features.forEach(feature => {
                    const geometry = feature.getGeometry()
                    if(geometry.getType() === 'Polygon') geometry.getCoordinates().forEach(ring => drawRing(context, event, ring))
                    else geometry.getCoordinates().forEach(polygon => polygon.forEach(ring => drawRing(context, event, ring)))
                })
                context.clip('evenodd')
            })
            const after = layer.on('postrender', event => {
                if(saved.has(event.context)){
                    event.context.restore()
                    saved.delete(event.context)
                }
            })
            this.temporalClipKeys[id] = markRaw([before, after])
            this.getTemporalBasinFeatures().then(features => {
                if(this.temporalLayerInstances[id] !== layer || !features.length) return
                // 静态矢量仍需先下载文件，但把流域包围盒外的要素立即移除，
                // 避免河湖和全球行政边界继续参与命中检测与每帧绘制；最终显示再由上面的精确边界裁剪。
                const source = layer.getSource?.()
                if(source?.getFeatures && source?.removeFeature){
                    const basinExtent = features.reduce((extent, feature) => {
                        const current = feature.getGeometry()?.getExtent?.()
                        if(!current) return extent
                        if(!extent) return current.slice()
                        extent[0] = Math.min(extent[0], current[0])
                        extent[1] = Math.min(extent[1], current[1])
                        extent[2] = Math.max(extent[2], current[2])
                        extent[3] = Math.max(extent[3], current[3])
                        return extent
                    }, null)
                    const prune = feature => {
                        if(basinExtent && !feature.getGeometry()?.intersectsExtent?.(basinExtent)) source.removeFeature(feature)
                    }
                    source.getFeatures().slice().forEach(prune)
                    const addKey = source.on('addfeature', event => prune(event.feature))
                    this.temporalClipKeys[id]?.push(addKey)
                }
                layer.changed()
            })
        },
        addTemporalHydroAnnotations:function(id, root){
            if(!this.map || !['rivers','lakes'].includes(id)) return
            const level = id === 'rivers' ? 'river' : 'lake'
            const layer = new VectorLayer({
                source:new VectorSource({url:root + '01_basemap/hydro_labels.geojson', format:new GeoJSON(), projection:'EPSG:4326'}),
                zIndex:72,
                declutter:true,
                minZoom:id === 'rivers' ? 6 : 4,
                style:feature => {
                    if(feature.get('level') !== level) return null
                    const river = level === 'river'
                    return new Style({text:new Text({
                        text:feature.get('name') || '',
                        textAlign:'center', textBaseline:'middle',
                        font:'600 12px sans-serif',
                        fill:new Fill({color:river ? '#064b70' : '#eaf9ff'}),
                        stroke:new Stroke({color:river ? 'rgba(255,255,255,.95)' : 'rgba(4,52,79,.92)', width:3}),
                        padding:[2,4,2,4]
                    })})
                }
            })
            this.temporalAnnotationLayers[id] = markRaw(layer)
            this.map.addLayer(layer)
        },
        setTemporalPointerEnabled:function(enabled){
            this.temporalPointerEnabled = !!enabled
            if(!this.temporalPointerEnabled){
                this.temporalHoverInfo = null
                const target = this.map?.getTargetElement?.()
                if(target) target.style.cursor = ''
            }
        },
        //网络请求接口
        loadingInfo(name){
            return axios.get(`/static/${name}.json`)
        },

        //获取作物信息
        getAndLoadCropInfo:function(){
            // 10 类作物的名称和颜色来自 utils/crop-types.js，和 GeoServer 上的
            // crop-style-10 是同一套配色，不再读 /static/crop.json
            this.cropInfo = CROP_TYPES
            this.cropSelectedCodes = []
            this.reloadCropLayer()
        },

        //获取要素信息
        getFeatureInfo:async function(){
            try {
                let res = await this.loadingInfo('featureInfo')
                this.featureInfo = res.data
                this.loadFeature(this.featureInfo)
            }catch(error){
                alert("无法获取地理要素数据")
            }
        },

        //获取图层类型信息
        getImageryInfo:async function(){
            try {
                let res = await this.loadingInfo('imageInfo')
                this.imageryInfo= res.data
                // this.addHuanTaiLand()
                // this.addHuanTaiColor(0)
            }catch(error){
                alert("无法获取地表图层数据")
            }
        },

        //获取地形图信息
        getTopoInfo:async function(){
            try {
                let res = await this.loadingInfo('topoInfo')
                this.topoInfo = res.data
                // this.loadTopo(this.topoInfo)
            }catch(error){
                alert("无法获取地形图数据")
            }
        },
        getYearInfo:async function(){
            try {
                let res = await this.loadingInfo('yearInfo')
                this.yearInfo = res.data
            }catch(error){
                alert("无法获取年份数据")
            }
        },

        //获取月份表
        getMonthInfo:async function(){
            try{
                let res = await this.loadingInfo('monthInfo')
                this.monthInfo = res.data
            }catch(error){
                alert("无法获取月份数据")
            }
        },

        //载入要素信息
        loadFeature:function(list){
            list.forEach((item)=>{
                // this.addFeatureLayer([])
            })
        },

        //载入颜色信息
        loadColor:function(color){
            let info={"fillColor": color,"opacity": "0.5", "strokeColor": "#000000", "strokeWidth": "0.1"}
            this.addColorLayer(info)
        },

        // 按当前年份 + 图例选择重新加载作物图层
        reloadCropLayer:function(){
            this.addCropLayer(this.cropSelectedCodes)
        },

        // 点图例：只看这一类；点已选中的这一类就回到“全部”
        toggleCropType:function(code){
            const current = this.cropSelectedCodes || []
            this.cropSelectedCodes = current.includes(code) ? [] : [code]
            this.reloadCropLayer()
        },

        // 换年份：地图图层跟着换，统计也重算
        setCropYear:function(year){
            const next = Number(year)
            if(!CROP_YEARS.includes(next) || this.cropYear === next) return
            this.cropYear = next
            this.reloadCropLayer()
            if(this.isCropBlinkRoute()) this.refreshCropAnalysis(true)
        },

        // 切二级页签时决定地图显示哪一层：
        //   作物类型可视化 -> 逐年作物分类（作物类型图层）
        //   作物时间序列   -> 轮作类型（1009 数据发布的图层）
        //   种植分析       -> 不显示分类图层，只看底图和流域边界
        setCropTab:function(tab){
            this.cropTab = tab
            if(!this.map) return
            if(this.cropLayer && this.cropLayer.setVisible) this.cropLayer.setVisible(tab === 'visual')
            // 作物时间序列和种植分析共用一份发布好的 1009 图层，换的是样式和筛选条件
            if(tab === 'series' || tab === 'analysis') this.reloadRotationLayer()
            else this.removeRotationLayer()
        },

        // 点某个轮作类型只看这一类，再点一次回到前十种全部
        toggleRotationType:function(sequence){
            this.rotationSelected = this.rotationSelected === sequence ? '' : sequence
            if(this.cropTab === 'series') this.reloadRotationLayer()
        },

        // 点某个稳定性分级只看这一级，再点一次回到三级全显示
        toggleStabilityClass:function(value){
            this.stabilitySelected = this.stabilitySelected === value ? '' : value
            if(this.cropTab === 'analysis') this.reloadRotationLayer()
        },

        reloadRotationLayer:function(){
            if(!this.map || !this.map.addLayer) return
            const isAnalysis = this.cropTab === 'analysis'
            const params = {
                LAYERS: CROP_ROTATION_LAYER,
                VERSION: '1.1.1',
                TILED: true,
                STYLES: isAnalysis ? CROP_STABILITY_STYLE : CROP_ROTATION_STYLE
            }
            const filter = isAnalysis
                ? stabilityFilterExpression(this.stabilitySelected)
                : rotationFilterExpression(this.rotationSelected)
            if(filter) params.CQL_FILTER = filter
            const source = new TileWMS({
                url:`${this.baseUrl}/geoserver/agri-agent/wms`,
                params,
                projection:'EPSG:4326',
                serverType:'geoserver'
            })
            const layer = new Tile({ source, className: 'ol-layer rotation-layer' })
            this.removeRotationLayer()
            this.rotationLayer = markRaw(layer)
            this.map.addLayer(layer)
        },

        removeRotationLayer:function(){
            if(this.rotationLayer && this.map && this.map.removeLayer){
                this.map.removeLayer(this.rotationLayer)
            }
            this.rotationLayer = null
        },




        // 添加基础图层
        // params: {type: ArcGIS的图层类型}
        // type: World_Topo_Map | World_Imagery | World_Street_Map | World_Terrain_Base | World_Shaded_Relief | 
        //       World_Physical_Map | NatGeo_World_Map | World_Ocean_Base | World_Boundaries_and_Places ...
        addBasicLayer:function(type='World_Imagery'){
            const URL = `https://server.arcgisonline.com/ArcGIS/rest/services/${type}/MapServer/tile/{z}/{y}/{x}`
            const layer = new Tile({
                source:new XYZ({
                    url: URL,
                    crossOrigin: "anonymous"
                })
            });


            this.clearMap(0);
            this.basicLayer = layer;
            if(this.map && this.map.addLayer) this.map.addLayer(this.basicLayer);
        },

        // 10.4 本地数据包：时空数据面板里的图层全部由这里统一加载/移除。
        setTemporalPeriod:function({year, month}){
            const nextYear = Number(year)
            const nextMonth = Number(month)
            if(this.temporalYear === nextYear && this.temporalMonth === nextMonth) return
            this.temporalYear = nextYear
            this.temporalMonth = nextMonth
            if(this.temporalRefreshTimer) clearTimeout(this.temporalRefreshTimer)
            this.temporalRefreshTimer = setTimeout(() => {
                Object.keys(this.temporalLayerEnabled).filter(id => this.temporalLayerEnabled[id]
                    && ['sentinel1','sentinel2','temperature','precipitation'].includes(id))
                    .forEach(id => this.loadTemporalLayer(id, true))
                this.temporalRefreshTimer = null
            }, 180)
        },
        setTemporalLayer:function(id, visible){
            if(!this.map) return
            this.temporalLayerEnabled[id] = !!visible
            if(!visible){
                this.temporalLayerRequests[id] = ++this.temporalRequestRevision
                const layer = this.temporalLayerInstances[id]
                if(layer) this.map.removeLayer(layer)
                const annotationLayer = this.temporalAnnotationLayers[id]
                if(annotationLayer) this.map.removeLayer(annotationLayer)
                delete this.temporalAnnotationLayers[id]
                if(this.temporalAnimationTimers[id]) clearInterval(this.temporalAnimationTimers[id])
                delete this.temporalAnimationTimers[id]
                if(this.temporalClipKeys[id]) unByKey(this.temporalClipKeys[id])
                delete this.temporalClipKeys[id]
                delete this.temporalLayerInstances[id]
                delete this.temporalLayerStatus[id]
                if(id === 'rivers') this.temporalNamedRiverFeatures = []
                if(this.temporalHoverInfo && this.temporalHoverInfo.layerId.split(',').includes(id)) this.temporalHoverInfo = null
                return
            }
            this.loadTemporalLayer(id, false)
        },
        setTemporalLayerColorVisibility:function(id, visible){
            this.temporalLayerColorVisibility[id] = visible
            const layer = this.temporalLayerInstances[id]
            if(layer && layer.setVisible) layer.setVisible(visible)
        },
        setTemporalHoverGroup:function(group){
            this.temporalHoverGroup = group
            this.temporalHoverInfo = null
        },
        loadTemporalLayer:async function(id, replace){
            if(!this.map) return
            const previous = this.temporalLayerInstances[id]
            if(previous && !replace) return
            this.temporalLayerEnabled[id] = true
            const request = ++this.temporalRequestRevision
            this.temporalLayerRequests[id] = request
            const current = () => this.temporalLayerEnabled[id] && this.temporalLayerRequests[id] === request
            if(previous) this.map.removeLayer(previous)
            const previousAnnotation = this.temporalAnnotationLayers[id]
            if(previousAnnotation) this.map.removeLayer(previousAnnotation)
            delete this.temporalAnnotationLayers[id]
            if(this.temporalAnimationTimers[id]) clearInterval(this.temporalAnimationTimers[id])
            delete this.temporalAnimationTimers[id]
            if(id === 'rivers') this.temporalNamedRiverFeatures = []
            this.temporalLayerStatus[id] = 'loading'
            const root = '/data/temporal/'
            const year = this.temporalYear
            const baseVector = (file, zIndex, style) => new VectorLayer({
                source: new VectorSource({
                    url: root + file,
                    format: new GeoJSON(),
                    projection: 'EPSG:4326'
                }),
                style,
                zIndex
            })
            let layer
            if(id === 'sentinel1' || id === 'sentinel2'){
                try {
                    const res = await axios.get(root + '04_imagery/services.json')
                    if(!current()) return
                    const prefix = id === 'sentinel1' ? 'S1_' : 'S2_'
                    const service = res.data.layers.find(item => item.id === prefix + year)
                    if(!service) throw new Error('所选年份暂无影像配置')
                    const serviceMinZoom = id === 'sentinel1' ? 6 : 9
                    layer = new Tile({
                        source: new XYZ({
                            url: service.xyz_url,
                            projection: 'EPSG:3857',
                            crossOrigin: 'anonymous',
                            minZoom: serviceMinZoom,
                            maxZoom: 14
                        }),
                        zIndex: 5
                    })
                    let hasLoadedTile = false
                    layer.getSource().on('tileloaderror', () => {
                        if(current() && !hasLoadedTile) this.temporalLayerStatus[id] = 'error'
                    })
                    layer.getSource().on('tileloadend', () => {
                        if(!current()) return
                        hasLoadedTile = true
                        this.temporalLayerStatus[id] = 'ready'
                    })
                } catch(error) {
                    if(!current()) return
                    this.temporalLayerStatus[id] = 'error'
                    console.error('影像图层加载失败', error)
                    return
                }
            } else if(id === 'temperature' || id === 'precipitation'){
                layer = new ImageLayer({
                    source:new ImageStatic({
                        url:root + `05_weather/${year}/${id}_${year}_basin.png?v=contour-2`,
                        imageExtent:TEMPORAL_WEATHER_EXTENT,
                        projection:'EPSG:4326',
                        interpolate:true
                    }),
                    opacity:.68,
                    zIndex:12
                })
                axios.get(root + `05_weather/${year}/${id}_${year}_grid.json`).then(response => {
                    if(this.temporalLayerInstances[id] !== layer) return
                    layer.set('temporalWeatherGrid', markRaw(response.data))
                    this.temporalLayerStatus[id] = 'ready'
                }).catch(() => { if(current()) this.temporalLayerStatus[id] = 'error' })
            } else if(id === 'rivers'){
                const source = new VectorSource()
                const baseStyle = new Style({stroke:new Stroke({color:'#075b86', width:2.2})})
                const flowStroke = new Stroke({color:'rgba(91,211,255,.95)', width:1.15, lineDash:[8,10], lineDashOffset:0})
                const flowStyle = new Style({stroke:flowStroke})
                layer = new VectorLayer({source, zIndex:32, style:[baseStyle, flowStyle]})
                this.addTemporalHydroAnnotations(id, root)
                // 直接加载离线永久裁切后的河网，浏览器不再解析和渲染流域外数据。
                Promise.all(['rivers_major_basin','rivers_named_basin'].map(async name => {
                    const res = await axios.get(`${root}01_basemap/${name}.geojson`)
                    return {name, features:new GeoJSON().readFeatures(res.data, {dataProjection:'EPSG:4326', featureProjection:'EPSG:4326'})}
                })).then(groups => {
                    if(this.temporalLayerInstances[id] !== layer) return
                    groups.forEach(group => source.addFeatures(group.features))
                    const namedGroup = groups.find(group => group.name === 'rivers_named_basin')
                    this.temporalNamedRiverFeatures = markRaw(namedGroup ? namedGroup.features : [])
                    this.temporalLayerStatus[id] = 'ready'
                }).catch(() => { if(current()) this.temporalLayerStatus[id] = 'error' })
                let dashOffset = 0
                this.temporalAnimationTimers[id] = setInterval(() => {
                    if(this.temporalLayerInstances[id] !== layer) return
                    dashOffset = (dashOffset - 1) % 18
                    flowStroke.setLineDashOffset(dashOffset)
                    layer.changed()
                }, 160)
            } else if(id === 'lakes'){
                layer = new VectorLayer({
                    source:new VectorSource({url:root + '01_basemap/lakes.geojson', format:new GeoJSON(), projection:'EPSG:4326'}),
                    zIndex:24,
                    style:new Style({
                        fill:new Fill({color:'rgba(18,112,163,.78)'}),
                        stroke:new Stroke({color:'#064f7b', width:1.8})
                    })
                })
                this.addTemporalHydroAnnotations(id, root)
            } else if(id === 'mountains'){
                layer = baseVector('01_basemap/mountain_ranges.geojson', 20, new Style({fill:new Fill({color:'rgba(255,145,0,.3)'}), stroke:new Stroke({color:'#e85d04', width:1.8})}))
            } else if(id === 'country_border' || id === 'province_border'){
                // 原型把行政边界拆成「国家边界」「州界」两栏，这里一栏一个图层
                const isCountry = id === 'country_border'
                const source = new VectorSource()
                layer = new VectorLayer({source, zIndex: isCountry ? 31 : 30, style:new Style({
                    stroke:new Stroke({color:isCountry ? '#b6162b' : '#c97800', width:isCountry ? 2.6 : 1.9, lineDash:isCountry ? undefined : [6,4]})
                })})
                const labelLevel = isCountry ? 'country' : 'province'
                const annotationLayer = new VectorLayer({
                    source:new VectorSource({url:root + '02_boundaries/admin_labels.geojson', format:new GeoJSON(), projection:'EPSG:4326'}),
                    zIndex:70,
                    declutter:true,
                    minZoom:0,
                    style:feature => {
                        if(feature.get('level') !== labelLevel) return null
                        const country = labelLevel === 'country'
                        return new Style({text:new Text({
                            text:feature.get('name') || '',
                            textAlign:'center', textBaseline:'middle',
                            font:country ? '700 14px sans-serif' : '600 11px sans-serif',
                            fill:new Fill({color:country ? '#68202a' : '#6f4a12'}),
                            stroke:new Stroke({color:'rgba(255,255,255,.95)', width:country ? 4 : 3}),
                            padding:[2,4,2,4]
                        })})
                    }
                })
                this.temporalAnnotationLayers[id] = markRaw(annotationLayer)
                this.map.addLayer(annotationLayer)
                axios.get(`${root}02_boundaries/${isCountry ? 'country_borders' : 'province_borders'}.geojson`)
                    .then(res => {
                        if(!current()) return
                        source.addFeatures(new GeoJSON().readFeatures(res.data, {featureProjection:'EPSG:4326'}))
                        this.temporalLayerStatus[id] = 'ready'
                    })
                    .catch(() => { if(current()) this.temporalLayerStatus[id] = 'error' })
            } else if(id === 'boundaries'){
                const source = new VectorSource()
                layer = new VectorLayer({source, zIndex: 30, style: feature => new Style({
                    stroke: new Stroke({
                        color: feature.get('__boundaryType') === 'country' ? '#e63946' : '#f59e0b',
                        width: feature.get('__boundaryType') === 'country' ? 2.4 : 1.7,
                        lineDash: feature.get('__boundaryType') === 'country' ? undefined : [6, 4]
                    })
                })})
                Promise.all(['country_borders', 'province_borders'].map(async name => {
                    const res = await axios.get(`${root}02_boundaries/${name}.geojson`)
                    const features = new GeoJSON().readFeatures(res.data, {featureProjection:'EPSG:4326'})
                    features.forEach(feature => feature.set('__boundaryType', name === 'country_borders' ? 'country' : 'province'))
                    source.addFeatures(features)
                })).then(() => { this.temporalLayerStatus[id] = 'ready' }).catch(() => { if(current()) this.temporalLayerStatus[id] = 'error' })
            } else if(id === 'elevation' || id === 'slope'){
                const image = id === 'elevation' ? 'elevation_m.png' : 'slope_deg.png'
                layer = new ImageLayer({
                    source: new ImageStatic({
                        url: root + `03_terrain/${image}`,
                        imageExtent: TEMPORAL_RASTER_EXTENT,
                        projection: 'EPSG:4326'
                    }),
                    opacity: .82,
                    zIndex: id === 'elevation' ? 3 : 4
                })
            } else {
                delete this.temporalLayerStatus[id]
                return
            }
            this.temporalLayerInstances[id] = markRaw(layer)
            this.clipTemporalLayerToBasin(id, layer)
            if(this.temporalLayerColorVisibility[id] === false) layer.setVisible(false)
            this.map.addLayer(layer)
            if(id !== 'temperature' && id !== 'precipitation'
                && id !== 'sentinel1' && id !== 'sentinel2' && id !== 'boundaries'
                && id !== 'country_border' && id !== 'province_border'){
                this.temporalLayerStatus[id] = 'ready'
            }
        },
        getTemporalRasterValue:async function(id, coordinate){
            const file = id === 'elevation' ? 'elevation_m.tif' : 'slope_deg.tif'
            let raster = temporalRasterCache.get(id)
            if(!raster){
                let loading = temporalRasterPromises.get(id)
                if(!loading){
                    loading = (async () => {
                        const response = await fetch(`/data/temporal/03_terrain/${file}`)
                        if(!response.ok) throw new Error(`无法读取 ${file}`)
                        const tiff = await fromArrayBuffer(await response.arrayBuffer())
                        const image = await tiff.getImage()
                        const bands = await image.readRasters({interleave:false})
                        return {
                            values: bands[0],
                            width: image.getWidth(),
                            height: image.getHeight(),
                            extent: image.getBoundingBox() || TEMPORAL_RASTER_EXTENT,
                            noData: Number(image.getGDALNoData())
                        }
                    })()
                    temporalRasterPromises.set(id, loading)
                }
                try {
                    raster = await loading
                    temporalRasterCache.set(id, raster)
                } finally {
                    temporalRasterPromises.delete(id)
                }
            }
            const [x, y] = coordinate
            const [minX, minY, maxX, maxY] = raster.extent
            if(x < minX || x > maxX || y < minY || y > maxY) return null
            const column = Math.min(raster.width - 1, Math.max(0, Math.floor((x - minX) / (maxX - minX) * raster.width)))
            const row = Math.min(raster.height - 1, Math.max(0, Math.floor((maxY - y) / (maxY - minY) * raster.height)))
            const value = Number(raster.values[row * raster.width + column])
            return Number.isFinite(value) && Math.abs(value) < 100000 && value !== raster.noData ? value : null
        },

        // 添加时间序列图层
        addTimeData:async function({year,month}){
            console.log(this.baseUrl)
            try{
                let res =  await axios({
                    headers:{
                        "Content-Type":"application/json; charset=utf-8",
                        "Accept": "application/json",
                        "Authorization": "Basic " + btoa("admin:geoserver")
                    },
                    url:`${this.baseUrl}/geoserver/rest/workspaces/test/coveragestores/changji_${year}${month}/coverages/changji_${year}${month}.json`,
                    method:'get',
                    data:{},
                })
                let info   = res.data.coverage.latLonBoundingBox
                const Source = new TileWMS({
                    url:`${this.baseUrl}/geoserver/test/wms`,
                    params: {
                        LAYERS: `test:changji_${year}${month}`,
                        VERSION: '1.1.1',
                        TILED: true,
                        STYLES:'resetChannel'
                    },
                    projection:info.crs,
                    serverType:'geoserver'
                })
                const timeLayer = new Tile({
                    source:Source
                })
                // this.clearMap(0)
                this.removeCropImageryLayers()
                this.removeCropLayer()
                this.removeCropLayerLine()
                this.removeTimeData()
                this.timeLayer = timeLayer
                // this.map.addLayer(this.timeLayer)
                this.addAdministrativeLayer()
                this.map.getLayers().insertAt(1,this.timeLayer)
            }catch(err){
                clearInterval(this.yearPlayer)
                clearInterval(this.monthPlayer)
                this.isYearPlaying=false,
                this.isMonthPlaying=false,
                alert(`无法获取对应${year}年${month}月的数据`)
            }
        },

        // 添加作物底图
        addCropLandLayer:function(){
            const cropLandSource = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    // LAYERS:'test:huantai_landmass',
                    LAYERS:'test:changji_layer_0',
                    VERSION:'1.1.1',
                    TILED:true,
                    // STYLES:'resetChannel'
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })
            const cropLandLayer = new Tile({
                source:cropLandSource,
            })
            // this.clearMap(0)
            this.cropLandLayer=cropLandLayer
            this.map.addLayer(this.cropLandLayer)
        },


        // 作物的影像底图
        addCropImageryLayers:function(){
            if(!this.map || !this.map.addLayer) return
            let i=0;
            // console.log(this.cropImageryLayers)
            this.cropImageryLayers.forEach(layer=>{
                if(Object.keys(layer).length !== 0){
                    this.map.addLayer(layer)
                    i++;
                    // return layer;
                }else{
                    const cropLandSource = new TileWMS({
                        url:`${this.baseUrl}/geoserver/test/wms`,
                        params:{
                            // LAYERS:'test:huantai_landmass',
                            LAYERS:`test:changji_layer_${i}`,
                            VERSION:'1.1.1',
                            TILED:true,
                            // STYLES:'resetChannel'
                        },
                        projection:'EPSG:4326',
                        serverType:'geoserver'
                    })
                    const cropLandLayer = new Tile({
                        source:cropLandSource,
                    })
                    this.map.addLayer(cropLandLayer)
                    // return cropLandLayer;
                    this.cropImageryLayers[i]=cropLandLayer;
                    i++;
                }

            })
        },

        // 作物边界
        addCropLayerLine:function(){
            if(!this.map || !this.map.addLayer) return
            const Source = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    LAYERS:'test:changji_parcel_shp',
                    VERSION: '1.1.1',
                    TILED: true,
                    STYLES:'crop_line',
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })
            const cropLayerLine = new Tile({
                source:Source,
            })
            // this.clearMap(0)
            this.cropLayerLine = cropLayerLine
            this.map.addLayer(this.cropLayerLine)
        },

        removeCropLayerLine:function(){
            if(!this.map || !this.map.removeLayer) return
            this.map.removeLayer(this.cropLayerLine)
        },

        // 添加农作物图层：当前年份的 cut 图层，可按图例只显示某几类。
        // codes 是选中的作物编码数组，空数组表示显示全部
        addCropLayer:function(codes){
            if(!this.map || !this.map.addLayer) return

            const params = {
                LAYERS: cropLayerName(this.cropYear),
                VERSION: '1.1.1',
                TILED: true,
                STYLES: CROP_STYLE_NAME
            }
            // 图例点选时只取选中的编码；不选就把整层都拿回来
            const filter = cropFilterExpression(codes)
            if(filter) params.CQL_FILTER = filter

            // this.map.removeLayer(this.cropLandLayer)
            const source = new TileWMS({
                url:`${this.baseUrl}/geoserver/agri-agent/wms`,
                params,
                projection:'EPSG:4326',
                serverType:'geoserver'
            })

            const cropLayer = new Tile({
                source:source,
                // 给容器带上 crop-layer 类，统计期间靠它做色相循环动画
                className: 'ol-layer crop-layer'
            })


            let viewResolution = this.map.getView().getResolution();
            let store = useMapStore()
            let{currentCrop,featureId,cropList,isShowFeautureInfo} = storeToRefs(store)
            if(Object.getOwnPropertyNames(this.clickChoose).length!==0){
                unByKey(this.clickChoose)
            }
            //每次加载图层前一定要重新添加点选，否则会出现按钮叠加，会报错
            this.clickChoose = this.map.on('singleclick', function(evt) {
                // 正在画框时不去查要素，免得和框选操作抢事件
                if (store.parcelRoiState === 'drawing') return
                let url = source.getFeatureInfoUrl(
                    evt.coordinate, viewResolution, 'EPSG:4326',
                    {
                        'INFO_FORMAT': 'application/json'
                    }); // 这里可以根据需要调整返回信息的格式

                if (url) {
                    fetch(url)
                        .then(function (response) {
                            return response.json();
                        })
                        .then(function (json) {
                            // 这里处理返回的信息，例如弹窗显示
                            // 点到没有作物的位置时 features 是空数组，这里要挡一下
                            const feature = json && json.features && json.features[0]
                            if (!feature || !feature.properties) return
                            // console.log(feature.properties)
                            // 用统一的取名方法，编码超出图例范围时也能显示成“类型N”
                            currentCrop.value = store.cropAnalysisTypeName(
                                Number(readFeatureProperty(feature.properties, CROP_ANALYSIS_TYPE_FIELD))
                            )
                            featureId.value = readFeatureProperty(feature.properties, CROP_ANALYSIS_PARCEL_FIELD)
                            // console.log(currentCrop.value,featureId.value)
                            if(!isShowFeautureInfo.value){
                                isShowFeautureInfo.value = !isShowFeautureInfo.value
                            }
                        })
                        .catch(function (err) {
                            console.warn('作物要素点选失败：', err)
                        });
                }
            });
            this.removeTimeData()
            this.removeCropLayer()
            // this.clearMap(2)
            this.cropLayer = cropLayer
            this.map.addLayer(this.cropLayer)
            // 已经框选时，新加载的图层也要裁到框内，
            // 否则换类型 / 换年份之后框外又会冒出作物色（框选状态下只应显示框内的数据）
            if(this.parcelRoiExtent) this.cropLayer.setExtent(this.parcelRoiExtent)
        },

        // 行政区矢量边界
        addAdministrativeLayer:function(){
            if(!this.map || !this.map.addLayer) return
            const source = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params: {
                    // LAYERS:'test:huantai_croptype',
                    LAYERS:'test:changji_administrative_shp',
                    VERSION: '1.1.1',
                    TILED: true,
                    STYLES:'changji_administrative',
                    // env:`other:${other};wheat:${wheat};cotton:${cotton};corn:${corn};fruit:${fruit}`,
                    // env:`other:${other};wheat:${wheat};fallow:${fallow};oilseed:${oilseed};orange:${orange}`;
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })
            const administratorLayer = new Tile({
                source:source
            })
            this.administrativeLayer = administratorLayer
            this.map.addLayer(this.administrativeLayer)
        },


        

        // 添加农田地块（多个shp）
        // addAgriParcelLayer:function(){
        //     if(!this.map || !this.map.addLayer) return

        //     // 10 个图层名称（workspace:layer）
        //     const layers = [
        //         'agri-agent:agri-parcel-liyv-1',
        //         'agri-agent:agri-parcel-liyv-2',
        //         'agri-agent:agri-parcel-liyv-3',
        //         'agri-agent:agri-parcel-liyv-4',
        //         'agri-agent:agri-parcel-bu8',
        //         'agri-agent:agri-parcel-bu9',
        //         'agri-agent:agri-parcel-bu11',
        //         'agri-agent:agri-parcel-bu12',
        //         'agri-agent:agri-parcel-bu13',
        //         'agri-agent:agri-parcel-bu101'
        //     ]

        //     const layersParam = layers.join(',')
        //     const wmsUrl = `${this.baseUrl}/geoserver/agri-agent/wms`
        //     const params = {
        //         LAYERS: layersParam,
        //         VERSION: '1.1.1',
        //         TILED: true,
        //     }

        //     // 获取数据源
        //     const parcelSource = new TileWMS({
        //         url: wmsUrl,
        //         params: params,
        //         projection: 'EPSG:4326',
        //         serverType: 'geoserver'
        //     })
        //     // 创建layer
        //     const parcelLayer = new Tile({
        //         source: parcelSource,
        //         zIndex: 50
        //     })

        //     // 移除之前可能存在的同类图层
        //     this.removeAgriParcelLayer()
        //     this.agriParcelLayer = parcelLayer
        //     this.map.addLayer(this.agriParcelLayer)
        // },


        // 添加农田地块
        addAgriParcelLayer: function() {
            if (!this.map || !this.map.addLayer) return       


            const parcelSource = new TileWMS({
                url: `${this.baseUrl}/geoserver/agri-agent/wms`,
                params:{
                    LAYERS: PARCEL_LAYER_NAME,
                    VERSION: '1.1.1',
                    TILED: true,
                    STYLES: 'red-polygon'
                },
                projection: 'EPSG:4326',
                serverType: 'geoserver'
            })
            
            const parcelLayer = new Tile({
                source: parcelSource,
                zIndex: 50
            })


            this.removeAgriParcelLayer()
            this.agriParcelLayer = parcelLayer
            this.map.addLayer(this.agriParcelLayer)
        },


        // 移除农田地块
        removeAgriParcelLayer:function(){
            if(!this.map || !this.map.removeLayer) return
            try{
                if(this.agriParcelLayer && Object.getOwnPropertyNames(this.agriParcelLayer).length!==0){
                    this.map.removeLayer(this.agriParcelLayer)
                    this.agriParcelLayer = new Layer({})
                }
            }catch(e){console.warn(e)}
        },

        // ============ 农田地块边界与交点叠加 ============
        // 把当前视图范围内的地块取回来，沿每个地块的外环画红色边线，
        // 并把被两个及以上地块共同占用的顶点标成交点。

        // 当前视图范围，转成 EPSG:4326 的经纬度范围
        getViewExtentLonLat:function(){
            if(!this.map || !this.map.getView || !this.map.getSize) return null
            const view = this.map.getView()
            const extent = view.calculateExtent(this.map.getSize())
            if(!extent) return null
            return transformExtent(extent, view.getProjection(), 'EPSG:4326')
        },

        // 找出被两个及以上地块共用的顶点，即地块之间的交点。
        // 顶点先按 snap 精度归并到一个栅格键上，避免浮点误差导致同一个点算成两个。
        findParcelJunctions:function(geojson, snap){
            const bucket = new Map()
            const features = (geojson && geojson.features) || []
            for(let i = 0; i < features.length; i++){
                const geom = features[i] && features[i].geometry
                if(!geom || !geom.coordinates) continue
                const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
                if(!Array.isArray(polygons)) continue
                const seen = new Set() // 同一个地块内的重复顶点只算一次
                for(const polygon of polygons){
                    if(!Array.isArray(polygon)) continue
                    for(const ring of polygon){
                        if(!Array.isArray(ring)) continue
                        for(const coord of ring){
                            if(!Array.isArray(coord) || coord.length < 2) continue
                            const key = Math.round(coord[0] / snap) + ',' + Math.round(coord[1] / snap)
                            if(seen.has(key)) continue
                            seen.add(key)
                            let item = bucket.get(key)
                            if(!item){
                                item = {x: coord[0], y: coord[1], owners: new Set()}
                                bucket.set(key, item)
                            }
                            item.owners.add(i)
                        }
                    }
                }
            }
            const points = []
            bucket.forEach(item => {
                if(item.owners.size >= 2) points.push([item.x, item.y])
            })
            return points
        },

        // 开关叠加层
        toggleParcelBoundaryOverlay:function(){
            if(this.parcelBoundaryEnabled){
                this.removeParcelBoundaryOverlay()
            }else{
                this.addParcelBoundaryOverlay()
            }
        },

        addParcelBoundaryOverlay:function(){
            if(!this.map || !this.map.addLayer) return
            this.parcelBoundaryEnabled = true
            this.parcelBoundaryNotice = ''
            // 地图移动后重新取数，加防抖，避免拖动一次打一串请求
            if(this.map.on && !this.parcelBoundaryMoveKey){
                this.parcelBoundaryMoveKey = this.map.on('moveend', () => {
                    if(!this.parcelBoundaryEnabled) return
                    if(this.parcelBoundaryTimer) clearTimeout(this.parcelBoundaryTimer)
                    this.parcelBoundaryTimer = setTimeout(() => {
                        this.parcelBoundaryTimer = null
                        this.refreshParcelBoundaryOverlay()
                    }, PARCEL_REFRESH_DELAY)
                })
            }
            this.refreshParcelBoundaryOverlay()
        },

        removeParcelBoundaryOverlay:function(){
            this.parcelBoundaryEnabled = false
            this.parcelBoundaryLoading = false
            this.parcelBoundaryNotice = ''
            this.parcelBoundaryCount = 0
            this.parcelJunctionCount = 0
            if(this.parcelBoundaryTimer){
                clearTimeout(this.parcelBoundaryTimer)
                this.parcelBoundaryTimer = null
            }
            if(this.parcelBoundaryMoveKey){
                unByKey(this.parcelBoundaryMoveKey)
                this.parcelBoundaryMoveKey = null
            }
            this.parcelBoundaryReqId++
            this.removeParcelBoundaryLayers()
        },

        removeParcelBoundaryLayers:function(){
            if(!this.map || !this.map.removeLayer) return
            try{
                if(Object.getOwnPropertyNames(this.parcelBoundaryLayer).length !== 1){
                    this.map.removeLayer(this.parcelBoundaryLayer)
                }
            }catch(e){console.warn(e)}
            try{
                if(Object.getOwnPropertyNames(this.parcelJunctionLayer).length !== 1){
                    this.map.removeLayer(this.parcelJunctionLayer)
                }
            }catch(e){console.warn(e)}
            this.parcelBoundaryLayer = new Layer({})
            this.parcelJunctionLayer = new Layer({})
        },

        refreshParcelBoundaryOverlay:async function(){
            if(!this.parcelBoundaryEnabled || !this.map) return
            const extent = this.getViewExtentLonLat()
            if(!extent) return

            // 范围太大时要素数量会失控，先不取数，提示用户放大
            const span = Math.max(extent[2] - extent[0], extent[3] - extent[1])
            if(span > PARCEL_MAX_SPAN){
                this.removeParcelBoundaryLayers()
                this.parcelBoundaryCount = 0
                this.parcelJunctionCount = 0
                this.parcelBoundaryNotice = '请放大地图后查看地块边界'
                return
            }

            const reqId = ++this.parcelBoundaryReqId
            this.parcelBoundaryLoading = true
            this.parcelBoundaryNotice = ''
            try{
                const url = `${this.baseUrl}/geoserver/agri-agent/ows`
                    + `?service=WFS&version=1.0.0&request=GetFeature`
                    + `&typeName=${PARCEL_LAYER_NAME}`
                    + `&outputFormat=application/json`
                    + `&maxFeatures=${PARCEL_MAX_FEATURES}`
                    + `&bbox=${extent[0]},${extent[1]},${extent[2]},${extent[3]}`
                const res = await axios.get(url, {timeout:60000})
                if(reqId !== this.parcelBoundaryReqId) return // 已有更新的请求，丢弃这次结果

                const data = res.data
                // GeoServer 出错时返回 200 加一份 XML 异常，这里挡一下
                if(typeof data === 'string' && data.trim().charAt(0) === '<'){
                    console.warn('地块边界取数失败：', data.slice(0, 500))
                    this.removeParcelBoundaryLayers()
                    this.parcelBoundaryCount = 0
                    this.parcelJunctionCount = 0
                    this.parcelBoundaryNotice = '地块服务返回异常'
                    return
                }

                const geojson = typeof data === 'string' ? JSON.parse(data) : data
                const count = (geojson.features || []).length
                const projection = this.map.getView().getProjection()
                const features = new GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: projection
                })

                // 红色边线，只描边不填充，避免盖住底图影像
                const boundaryLayer = new VectorLayer({
                    source: new VectorSource({features}),
                    zIndex: 60,
                    style: new Style({
                        stroke: new Stroke({color: 'rgba(255,0,0,0.9)', width: 1.2}),
                        fill: null
                    })
                })

                const junctions = this.findParcelJunctions(geojson, PARCEL_SNAP)
                const junctionFeatures = junctions.map(coordinate =>
                    new Feature({geometry: new Point(fromLonLat(coordinate, projection))})
                )
                const junctionLayer = new VectorLayer({
                    source: new VectorSource({features: junctionFeatures}),
                    zIndex: 61,
                    style: new Style({
                        image: new Circle({
                            radius: 3.5,
                            fill: new Fill({color: 'rgba(255,0,0,0.95)'}),
                            stroke: new Stroke({color: '#ffffff', width: 1})
                        })
                    })
                })

                this.removeParcelBoundaryLayers()
                this.parcelBoundaryLayer = boundaryLayer
                this.parcelJunctionLayer = junctionLayer
                this.map.addLayer(this.parcelBoundaryLayer)
                this.map.addLayer(this.parcelJunctionLayer)
                this.parcelBoundaryCount = count
                this.parcelJunctionCount = junctions.length
                if(count >= PARCEL_MAX_FEATURES){
                    this.parcelBoundaryNotice = '范围偏大，显示的可能不完整'
                }
            }catch(e){
                if(reqId !== this.parcelBoundaryReqId) return
                console.warn('地块边界取数失败：', e)
                this.removeParcelBoundaryLayers()
                this.parcelBoundaryCount = 0
                this.parcelJunctionCount = 0
                this.parcelBoundaryNotice = '地块数据获取失败'
            }finally{
                if(reqId === this.parcelBoundaryReqId) this.parcelBoundaryLoading = false
            }
        },

        // ============ 农田页日期时间轴 ============
        // 拖动时间轴切换日期，日期对应的图层由 parcelTimelineSource 描述。
        // 数据接入前 source 为空，拖动只更新日期显示，不发起请求。

        // 输出 YYYY-MM-DD
        formatDate:function(date){
            const pad = n => (n < 10 ? '0' + n : '' + n)
            return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        },

        // 数据接入前用的占位日期，按 step（day/month/year）在区间内步进
        buildPlaceholderDates:function(range){
            const dates = []
            const start = new Date((range && range.start) || '2018-01-01')
            const end = new Date((range && range.end) || '2023-12-31')
            if(isNaN(start) || isNaN(end) || start > end) return dates
            const step = (range && range.step) || 'month'
            const cursor = new Date(start)
            while(cursor <= end && dates.length < 5000){
                dates.push(this.formatDate(cursor))
                if(step === 'day'){
                    cursor.setDate(cursor.getDate() + 1)
                }else if(step === 'year'){
                    cursor.setFullYear(cursor.getFullYear() + 1)
                }else{
                    cursor.setDate(1) // 先归到月初，避免 1 月 31 日加一个月跳到 3 月
                    cursor.setMonth(cursor.getMonth() + 1)
                }
            }
            return dates
        },

        // 读取日期列表：优先用 /static/parcelTimeline.json，读不到就用占位区间
        getParcelTimelineDates:async function(){
            let dates = []
            try{
                const res = await axios.get('/static/parcelTimeline.json')
                if(Array.isArray(res.data)) dates = res.data
            }catch(e){
                dates = []
            }
            dates = dates
                .map(item => (typeof item === 'string' ? item : (item && item.date)))
                .filter(Boolean)
            if(dates.length === 0){
                // 数据还没接入，先用占位日期把交互跑起来
                this.setParcelTimelineDates(this.buildPlaceholderDates(PARCEL_TIMELINE_DEFAULT_RANGE))
                this.parcelTimelineNotice = '占位日期'
                return
            }
            this.setParcelTimelineDates(dates)
        },

        // 数据接入接口。dates 支持两种写法：
        //   ['2023-05-01', '2023-06-01', ...]
        //   [{date:'2023-05-01', layer:'agri-agent:parcel_20230501'}, ...]
        // source 描述怎么把日期变成图层：
        //   {type:'wms', url:'http://host:8080/geoserver/xxx/wms',
        //    layerTemplate:'agri-agent:parcel_{ymd}', styles:'', version:'1.1.1',
        //    projection:'EPSG:4326', zIndex:5}
        // layerTemplate 支持 {date} {year} {month} {day} {ymd} 占位符；
        // dates 里带 layer 的条目优先用自带的图层名，不再套模板。
        setParcelTimelineDates:function(dates, source){
            this.parcelTimelineDates = Array.isArray(dates) ? dates.slice() : []
            if(source !== undefined) this.parcelTimelineSource = source
            if(this.parcelTimelineIndex >= this.parcelTimelineDates.length){
                this.parcelTimelineIndex = Math.max(0, this.parcelTimelineDates.length - 1)
            }
            this.applyParcelTimelineDate()
        },

        // 日期列表里第 index 条对应的日期字符串，形如 2023-05-01
        getParcelDateAt:function(index){
            const item = this.parcelTimelineDates[index]
            if(!item) return ''
            return typeof item === 'string' ? item : (item.date || '')
        },

        // 当前选中的日期
        getCurrentParcelDate:function(){
            return this.getParcelDateAt(this.parcelTimelineIndex)
        },

        // 拖动时间轴：先更新下标让界面跟手，取数做防抖
        selectParcelTimelineIndex:function(index){
            const max = this.parcelTimelineDates.length - 1
            if(max < 0) return
            const next = Math.min(Math.max(Number(index) || 0, 0), max)
            if(next === this.parcelTimelineIndex) return
            this.parcelTimelineIndex = next
            if(this.parcelTimelineApplyTimer) clearTimeout(this.parcelTimelineApplyTimer)
            this.parcelTimelineApplyTimer = setTimeout(() => {
                this.parcelTimelineApplyTimer = null
                this.applyParcelTimelineDate()
            }, PARCEL_TIMELINE_DEBOUNCE)
        },

        // 精确落到某一天（日期选择器用）。命中了就用那天，没命中取最接近的一天
        selectParcelTimelineDate:function(date){
            const list = this.parcelTimelineDates
            if(!list.length || !date) return
            let best = 0
            let bestDiff = Infinity
            for(let i = 0; i < list.length; i++){
                const value = this.getParcelDateAt(i)
                if(!value) continue
                if(value === date){
                    best = i
                    break
                }
                const diff = Math.abs(new Date(value) - new Date(date))
                if(diff < bestDiff){
                    bestDiff = diff
                    best = i
                }
            }
            this.selectParcelTimelineIndex(best)
        },

        // 把模板里的日期占位符替换掉
        resolveParcelLayerName:function(template, date){
            const parts = String(date || '').split('-')
            return String(template || '')
                .replace(/\{date\}/g, date || '')
                .replace(/\{year\}/g, parts[0] || '')
                .replace(/\{month\}/g, parts[1] || '')
                .replace(/\{day\}/g, parts[2] || '')
                .replace(/\{ymd\}/g, (parts[0] || '') + (parts[1] || '') + (parts[2] || ''))
        },

        // 按当前日期换图。没有配置数据源时只更新状态，方便先看交互
        applyParcelTimelineDate:async function(){
            const date = this.getCurrentParcelDate()
            if(!date) return
            this.removeParcelTimelineLayer()
            if(!this.parcelTimelineSource){
                this.parcelTimelineNotice = '数据未接入'
                return
            }

            const reqId = ++this.parcelTimelineReqId
            this.parcelTimelineLoading = true
            this.parcelTimelineNotice = ''
            try{
                const source = this.parcelTimelineSource
                const item = this.parcelTimelineDates[this.parcelTimelineIndex]
                const layerName = (item && typeof item === 'object' && item.layer)
                    || this.resolveParcelLayerName(source.layerTemplate, date)
                if(!source.url || !layerName) throw new Error('数据源配置不完整')

                const wmsSource = new TileWMS({
                    url: source.url,
                    params:{
                        LAYERS: layerName,
                        VERSION: source.version || '1.1.1',
                        TILED: true,
                        STYLES: source.styles || ''
                    },
                    projection: source.projection || 'EPSG:4326',
                    serverType: 'geoserver'
                })
                const layer = new Tile({
                    source: wmsSource,
                    zIndex: source.zIndex || 5
                })
                if(reqId !== this.parcelTimelineReqId) return // 已有更新的日期，丢弃这次结果
                this.parcelTimelineLayer = layer
                if(this.map && this.map.addLayer) this.map.addLayer(layer)
            }catch(e){
                console.warn('日期图层加载失败：', e)
                this.parcelTimelineNotice = '该日期暂无数据'
            }finally{
                if(reqId === this.parcelTimelineReqId) this.parcelTimelineLoading = false
            }
        },

        removeParcelTimelineLayer:function(){
            if(!this.map || !this.map.removeLayer) return
            try{
                if(Object.getOwnPropertyNames(this.parcelTimelineLayer).length !== 1){
                    this.map.removeLayer(this.parcelTimelineLayer)
                }
            }catch(e){console.warn(e)}
            this.parcelTimelineLayer = new Layer({})
        },

        toggleParcelTimelinePlay:function(){
            if(this.parcelTimelinePlaying){
                this.stopParcelTimelinePlay()
                return
            }
            if(this.parcelTimelineDates.length < 2) return
            this.parcelTimelinePlaying = true
            this.parcelTimelineTimer = setInterval(() => {
                const next = (this.parcelTimelineIndex + 1) % this.parcelTimelineDates.length
                this.parcelTimelineIndex = next
                this.applyParcelTimelineDate()
            }, PARCEL_TIMELINE_PLAY_INTERVAL)
        },

        stopParcelTimelinePlay:function(){
            this.parcelTimelinePlaying = false
            if(this.parcelTimelineTimer){
                clearInterval(this.parcelTimelineTimer)
                this.parcelTimelineTimer = null
            }
        },

        // ============ 框选截取 ============
        // 拖出矩形后自动缩放居中，矩形以外统一盖成灰色、不显示任何数据。
        // 不点“取消框选”就可以一直框选下去；按住选区的边框可以整体拖动它。

        setMapCursor:function(cursor){
            if(!this.map || !this.map.getTargetElement) return
            const target = this.map.getTargetElement()
            if(target && target.style) target.style.cursor = cursor || ''
        },

        toggleParcelRoi:function(){
            if(this.parcelRoiState === 'idle'){
                this.startParcelRoiDraw()
            }else{
                this.clearParcelRoi()
            }
        },

        // 进入框选模式。这个模式会一直开着，直到点“取消框选”
        startParcelRoiDraw:function(){
            if(!this.map || !this.map.addInteraction) return
            this.stopParcelRoi()
            this.clearParcelRoiLayers()

            this.parcelRoiState = 'drawing'
            this.setParcelRoiMode('draw')
        },

        // 切换操作只替换交互，保留选框、识别结果和退出时要恢复的视图。
        setParcelRoiMode:function(mode){
            if(this.parcelRoiState === 'idle' || !['draw','pan'].includes(mode) || !this.map?.addInteraction) return
            this.stopParcelRoi()
            this.parcelRoiMode = mode
            if(mode === 'pan'){
                this.setMapCursor('grab')
                return
            }

            // 画框和拖动都用自己写的交互。ol 自带的 Draw 在这个页面里收不到指针事件，
            // 实测拖拽会变成地图平移，所以不走它。
            this.parcelRoiDrawer = this.createParcelRoiDrawer()
            this.map.addInteraction(this.parcelRoiDrawer)
            // 拖动交互后加，OpenLayers 会先问它：按住边框才拖动，其余位置交回给画框
            this.parcelRoiDrag = this.createParcelRoiDrag()
            this.map.addInteraction(this.parcelRoiDrag)

            this.setMapCursor('crosshair')
        },

        // 按下拉框，拖动实时预览，松手应用
        createParcelRoiDrawer:function(){
            const self = this
            const state = {start: null}
            const toExtent = coordinate => [
                Math.min(state.start[0], coordinate[0]),
                Math.min(state.start[1], coordinate[1]),
                Math.max(state.start[0], coordinate[0]),
                Math.max(state.start[1], coordinate[1])
            ]
            return new PointerInteraction({
                handleDownEvent: evt => {
                    if(self.parcelRoiMode !== 'draw' || self.parcelRoiState === 'idle' || evt.originalEvent?.button > 0) return false
                    state.start = evt.coordinate.slice()
                    self.showParcelRoiSketch(toExtent(evt.coordinate))
                    return true
                },
                handleDragEvent: evt => {
                    if(!state.start) return
                    self.showParcelRoiSketch(toExtent(evt.coordinate))
                },
                handleUpEvent: evt => {
                    if(!state.start) return false
                    const extent = toExtent(evt.coordinate)
                    state.start = null
                    self.hideParcelRoiSketch()
                    if(self.isParcelRoiExtentUsable(extent)) self.applyParcelRoi(extent)
                    return false
                }
            })
        },

        // 拉框过程中的预览框
        showParcelRoiSketch:function(extent){
            if(!this.map || !this.map.addLayer) return
            const ring = this.extentToRing(extent)
            if(this.parcelRoiSketchSource){
                const feature = this.parcelRoiSketchSource.getFeatures()[0]
                if(feature) feature.getGeometry().setCoordinates([ring])
                return
            }
            this.parcelRoiSketchSource = new VectorSource({features: [new Feature(new Polygon([ring]))]})
            this.parcelRoiSketchLayer = new VectorLayer({
                source: this.parcelRoiSketchSource,
                zIndex: 902,
                style: new Style({
                    stroke: new Stroke({color: 'rgba(255,0,0,0.9)', width: 2}),
                    fill: new Fill({color: 'rgba(255,0,0,0.15)'})
                })
            })
            this.map.addLayer(this.parcelRoiSketchLayer)
        },

        hideParcelRoiSketch:function(){
            if(this.map && this.map.removeLayer && this.parcelRoiSketchLayer){
                try{ this.map.removeLayer(this.parcelRoiSketchLayer) }catch(e){console.warn(e)}
            }
            this.parcelRoiSketchLayer = null
            if(this.parcelRoiSketchSource){
                this.parcelRoiSketchSource.clear()
                this.parcelRoiSketchSource = null
            }
        },

        // 只有按住选区边框时才进入拖动。
        // 没用 ol 的 Translate：选区填充是透明的，它的命中检测点不到，会变成地图平移。
        createParcelRoiDrag:function(){
            const self = this
            const dragState = {start: null, ring: null}
            return new PointerInteraction({
                handleDownEvent: evt => {
                    if(self.parcelRoiMode !== 'draw' || self.parcelRoiState === 'idle' || evt.originalEvent?.button > 0) return false
                    if(!self.parcelRoiRefs) return false
                    if(!self.isOnParcelRoiEdge(evt.coordinate)) return false
                    dragState.start = evt.coordinate.slice()
                    dragState.ring = self.parcelRoiRefs.boxGeometry.getCoordinates()[0].map(point => point.slice())
                    return true
                },
                handleDragEvent: evt => {
                    const refs = self.parcelRoiRefs
                    if(!dragState.start || !refs) return
                    const dx = evt.coordinate[0] - dragState.start[0]
                    const dy = evt.coordinate[1] - dragState.start[1]
                    refs.boxGeometry.setCoordinates([
                        dragState.ring.map(point => [point[0] + dx, point[1] + dy])
                    ])
                    self.syncParcelRoi()
                },
                handleUpEvent: () => {
                    if(!dragState.start) return false
                    dragState.start = null
                    // 拖完再重算，避免拖动过程中反复取数
                    self.refreshParcelRoiContent()
                    return false
                },
                handleMoveEvent: evt => {
                    if(self.parcelRoiState === 'idle' || self.parcelRoiMode !== 'draw') return
                    self.setMapCursor(self.isOnParcelRoiEdge(evt.coordinate) ? 'move' : 'crosshair')
                }
            })
        },

        // 指针是否落在选区的边框上，按屏幕像素算，容差 PARCEL_ROI_EDGE_TOLERANCE
        isOnParcelRoiEdge:function(coordinate){
            const refs = this.parcelRoiRefs
            if(!refs || !this.map || !this.map.getPixelFromCoordinate) return false
            const pixel = this.map.getPixelFromCoordinate(coordinate)
            if(!pixel) return false
            const ring = refs.boxGeometry.getCoordinates()[0]
            let min = Infinity
            for(let i = 1; i < ring.length; i++){
                const a = this.map.getPixelFromCoordinate(ring[i - 1])
                const b = this.map.getPixelFromCoordinate(ring[i])
                if(!a || !b) continue
                min = Math.min(min, this.distanceToSegment(pixel, a, b))
            }
            return min <= PARCEL_ROI_EDGE_TOLERANCE
        },

        distanceToSegment:function(point, a, b){
            const dx = b[0] - a[0]
            const dy = b[1] - a[1]
            const lengthSq = dx * dx + dy * dy
            let t = lengthSq === 0 ? 0 : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq
            t = Math.min(Math.max(t, 0), 1)
            return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy))
        },

        // 把遮罩的挖空、记录的选区范围、数据图层的裁剪范围都同步到当前选区
        syncParcelRoi:function(){
            const refs = this.parcelRoiRefs
            if(!refs) return
            const ring = refs.boxGeometry.getCoordinates()[0]
            refs.maskFeature.getGeometry().setCoordinates([refs.worldRing, ring])
            this.parcelRoiExtent = refs.boxGeometry.getExtent()
            this.setParcelRoiLayerExtent(this.parcelRoiExtent)
        },

        // 数据图层按矩形裁掉，框外就不再出数据；
        // 底图和遮罩自身跳过。extent 传 null 表示恢复
        setParcelRoiLayerExtent:function(extent){
            if(!this.map || !this.map.getLayers) return
            const skip = [this.basicLayer, this.parcelRoiMaskLayer, this.parcelRoiOutlineLayer, this.parcelRoiSketchLayer]
            this.map.getLayers().forEach(layer => {
                if(!layer || skip.indexOf(layer) !== -1) return
                if(typeof layer.setExtent !== 'function') return
                layer.setExtent(extent || undefined)
            })
        },

        // 移除框选相关的交互（画框和拖动），退出模式时用
        stopParcelRoi:function(){
            if(this.map && this.map.removeInteraction){
                if(this.parcelRoiDrawer) this.map.removeInteraction(this.parcelRoiDrawer)
                if(this.parcelRoiDrag) this.map.removeInteraction(this.parcelRoiDrag)
            }
            this.parcelRoiDrawer = null
            this.parcelRoiDrag = null
            this.parcelRoiMode = 'draw'
            this.hideParcelRoiSketch()
            this.setMapCursor('')
        },

        // 只点一下没拖动会产生一个退化的矩形，这种直接丢掉
        isParcelRoiExtentUsable:function(extent){
            if(!extent || !this.map || !this.map.getView) return false
            const resolution = this.map.getView().getResolution() || 0
            const minSize = PARCEL_ROI_MIN_PIXELS * resolution
            return (extent[2] - extent[0]) >= minSize && (extent[3] - extent[1]) >= minSize
        },

        // 应用选区：记住原视图，缩放居中，再把选区以外盖成灰色
        applyParcelRoi:function(extent){
            if(!this.map || !this.map.getView || !extent) return
            const view = this.map.getView()
            const projection = view.getProjection()

            // 只记第一次的视图，退出时回到框选之前
            if(!this.parcelRoiPrevView){
                this.parcelRoiPrevView = {center: view.getCenter(), zoom: view.getZoom()}
            }
            view.fit(extent, {
                padding: [PARCEL_ROI_PADDING, PARCEL_ROI_PADDING, PARCEL_ROI_PADDING, PARCEL_ROI_PADDING],
                duration: 400
            })

            const worldRing = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]
                .map(coordinate => fromLonLat(coordinate, projection))
            const ring = this.extentToRing(extent)
            const boxGeometry = new Polygon([ring])
            const maskFeature = new Feature(new Polygon([worldRing, ring]))
            // markRaw 避免 Vue 把 OpenLayers 的几何对象包成响应式的
            const roiRefs = markRaw({boxGeometry, maskFeature, worldRing})

            // 选区和遮罩各用一个要素，选区挪动时同步更新遮罩
            const boxSource = new VectorSource({features: [new Feature(boxGeometry)]})
            const maskSource = new VectorSource({features: [maskFeature]})

            const maskLayer = new VectorLayer({
                source: maskSource,
                zIndex: 900,
                style: new Style({fill: new Fill({color: PARCEL_ROI_MASK_COLOR}), stroke: null})
            })
            const outlineLayer = new VectorLayer({
                source: boxSource,
                zIndex: 901,
                style: new Style({
                    stroke: new Stroke({color: 'rgba(255,0,0,0.9)', width: 2}),
                    fill: null
                })
            })

            this.clearParcelRoiLayers()
            this.parcelRoiRefs = roiRefs
            this.parcelRoiMaskLayer = maskLayer
            this.parcelRoiOutlineLayer = outlineLayer
            this.parcelRoiBoxSource = boxSource
            this.parcelRoiMaskSource = maskSource
            this.map.addLayer(this.parcelRoiMaskLayer)
            this.map.addLayer(this.parcelRoiOutlineLayer)

            this.parcelRoiState = 'applied'
            // 先记下选区范围（统计和扫描请求都要用它），把请求发出去，
            // 最后再裁剪图层。
            // 反过来的话裁剪会触发一堆瓦片重载，把连接占满，扫描请求要排很久
            this.parcelRoiExtent = boxGeometry.getExtent()
            this.refreshParcelRoiContent()
            this.syncParcelRoi()
        },

        // 矩形范围转成闭合的环
        extentToRing:function(extent){
            return [
                [extent[0], extent[1]],
                [extent[2], extent[1]],
                [extent[2], extent[3]],
                [extent[0], extent[3]],
                [extent[0], extent[1]]
            ]
        },

        // 只清选区相关的图层，交互不动（框选模式还要继续用）
        clearParcelRoiLayers:function(){
            if(this.parcelRoiBoxSource){
                this.parcelRoiBoxSource.clear()
                this.parcelRoiBoxSource = null
            }
            if(this.parcelRoiMaskSource){
                this.parcelRoiMaskSource.clear()
                this.parcelRoiMaskSource = null
            }
            if(this.map && this.map.removeLayer){
                try{
                    if(Object.getOwnPropertyNames(this.parcelRoiMaskLayer).length !== 1){
                        this.map.removeLayer(this.parcelRoiMaskLayer)
                    }
                }catch(e){console.warn(e)}
                try{
                    if(Object.getOwnPropertyNames(this.parcelRoiOutlineLayer).length !== 1){
                        this.map.removeLayer(this.parcelRoiOutlineLayer)
                    }
                }catch(e){console.warn(e)}
            }
            this.parcelRoiMaskLayer = new Layer({})
            this.parcelRoiOutlineLayer = new Layer({})
        },

        // 退出框选：清掉交互和图层。restoreView 为 false 时不还原视图（比如切地区时用）
        clearParcelRoi:function(restoreView){
            this.clearParcelIdentification()
            this.clearCropAnalysisBlink()
            this.cropScanPhase = 'idle'
            this.cropScanProgress = 0
            this.stopParcelRoi()
            this.clearParcelRoiLayers()
            this.parcelRoiRefs = null
            // 恢复数据图层的显示范围
            this.setParcelRoiLayerExtent(null)
            const prev = this.parcelRoiPrevView
            if(restoreView !== false && prev && prev.center && this.map && this.map.getView){
                this.map.getView().animate({center: prev.center, zoom: prev.zoom, duration: 400})
            }
            this.parcelRoiPrevView = null
            this.parcelRoiExtent = null
            this.parcelRoiState = 'idle'
            // 选区没了，统计结果也跟着清掉
            this.refreshCropAnalysis()
        },

        // 农田与作物页面共享框选交互，分别更新各自的数据。
        refreshParcelRoiContent:function(){
            if(this.parcelIdentifyEnabled) this.refreshParcelIdentification()
            else this.refreshCropAnalysis()
        },

        clearParcelIdentification:function(){
            this.parcelIdentifyReqId++
            if(this.parcelIdentifyAbort) this.parcelIdentifyAbort.abort()
            this.parcelIdentifyAbort = null
            if(this.parcelIdentifyRenderKeys) unByKey(this.parcelIdentifyRenderKeys)
            this.parcelIdentifyRenderKeys = null
            if(this.parcelIdentifyViewKey) unByKey(this.parcelIdentifyViewKey)
            this.parcelIdentifyViewKey = null
            if(this.parcelIdentifyTimer) clearInterval(this.parcelIdentifyTimer)
            this.parcelIdentifyTimer = null
            if(this.parcelIdentifyLayer && this.map) this.map.removeLayer(this.parcelIdentifyLayer)
            this.parcelIdentifyLayer = null
            if(this.parcelIdentifyOriginalVisible !== null && this.agriParcelLayer){
                this.agriParcelLayer.setVisible(this.parcelIdentifyOriginalVisible)
            }
            this.parcelIdentifyOriginalVisible = null
            this.parcelIdentifyCount = 0
            this.parcelIdentifyOverview = false
            this.parcelIdentifyPhase = 'idle'
            this.parcelIdentifyProgress = 0
            this.parcelIdentifyNotice = '请在地图上拖出一个矩形'
        },

        refreshParcelIdentification:async function(){
            this.clearParcelIdentification()
            if(!this.parcelIdentifyEnabled || !this.parcelRoiExtent || !this.map) return
            const requestId = this.parcelIdentifyReqId
            const controller = new AbortController()
            this.parcelIdentifyAbort = markRaw(controller)
            const isCurrent = () => requestId === this.parcelIdentifyReqId && !controller.signal.aborted
            const projection = this.map.getView().getProjection()
            const extent = transformExtent(this.parcelRoiExtent, projection, 'EPSG:4326')
            this.parcelIdentifyPhase = 'loading'
            this.parcelIdentifyNotice = '正在加载选区地块…'
            try{
                const request = async (bounds, limit) => {
                    if(limit === 160) this.parcelIdentifyNotice = '正在分区加载大范围地块…'
                    return fetchRecognitionFeatures(`${this.baseUrl}/geoserver/agri-agent/ows`, {
                            service:'WFS', version:'1.0.0', request:'GetFeature',
                            typeName:PARCEL_LAYER_NAME, outputFormat:'application/json',
                            srsName:'EPSG:4326', maxFeatures:limit,
                            bbox:bounds.join(',') + ',EPSG:4326'
                    }, {signal:controller.signal})
                }
                const result = await loadParcelAnimationFeatures(request, extent, isCurrent, PARCEL_MAX_FEATURES)
                if(!result || !isCurrent()) return
                const {data, overview} = result
                this.parcelIdentifyOverview = overview
                const features = new GeoJSON().readFeatures(data, {dataProjection:'EPSG:4326', featureProjection:projection})
                    .filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.getGeometry()?.getType()))
                if(!features.length){
                    this.parcelIdentifyNotice = '选区内没有农田地块，请移动选区或重新框选'
                    return
                }
                // 完整边界用于连线，动画标记按屏幕空间抽稀，避免密集圆点遮挡地块。
                const records = new Map()
                for(const feature of features){
                    const geometry = feature.getGeometry()
                    const polygons = geometry.getType() === 'Polygon' ? [geometry.getCoordinates()] : geometry.getCoordinates()
                    const rings = polygons.flat().filter(ring => ring.length >= 2)
                    const paths = rings.map(ring => {
                        const lengths = [0]
                        for(let i=1;i<ring.length;i++) lengths.push(lengths[i-1]+Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1]))
                        return {ring,lengths,total:lengths[lengths.length-1]}
                    })
                    const bounds = geometry.getExtent()
                    const position = Math.max(0,Math.min(1,((bounds[0]+bounds[2])/2-this.parcelRoiExtent[0])/(this.parcelRoiExtent[2]-this.parcelRoiExtent[0])))
                    records.set(feature, {rings, paths, position})
                }
                const refreshMarkers = () => {
                    const size = this.map.getSize()
                    const pixels = this.extentToRing(this.parcelRoiExtent).map(coordinate => this.map.getPixelFromCoordinate(coordinate))
                    const bounds = [Math.max(0,Math.min(...pixels.map(p => p[0]))),Math.max(0,Math.min(...pixels.map(p => p[1]))),
                        Math.min(size[0],Math.max(...pixels.map(p => p[0]))),Math.min(size[1],Math.max(...pixels.map(p => p[1])))]
                    const markers = sampleParcelMarkers(records, coordinate => this.map.getPixelFromCoordinate(coordinate), bounds)
                    records.forEach((record, feature) => {
                        const marker = markers.get(feature)
                        record.pointStages = Array.from({length:9}, (_,stage) => new MultiPoint(marker.points.slice(0,Math.ceil(marker.points.length*stage/8))))
                        record.showTip = marker.showTip
                        record.tipPath = marker.tipPath
                    })
                }
                refreshMarkers()
                let phase = 'points'
                let progress = 0
                let pointReveal = 0
                let pointOpacity = 0
                let fillProgress = 0
                const pointStyle = new Style({image:new Circle({radius:2.3,
                    fill:new Fill({color:'#ff5752'}), stroke:new Stroke({color:'#fff0e8',width:0.7})})})
                pointStyle.getImage().setOpacity(0)
                const lineStyle = new Style({stroke:new Stroke({color:'rgba(255,65,55,0.85)',width:overview ? 1.9 : 1.4})})
                const tipStyle = new Style({image:new Circle({radius:2.6,fill:new Fill({color:'#ffc0a9'}),stroke:new Stroke({color:'#ff6252',width:0.8})})})
                const faceStyle = new Style({stroke:new Stroke({color:'rgba(255,65,55,0.9)',width:1}),fill:new Fill({color:'rgba(255,35,25,0.36)'})})
                const layer = new VectorLayer({source:new VectorSource({features}),zIndex:65,
                    style:feature => {
                        const record = records.get(feature)
                        if(phase === 'points'){
                            pointStyle.setGeometry(record.pointStages[Math.min(8,Math.floor(pointReveal*8))])
                            return pointStyle
                        }
                        if(phase === 'lines'){
                            const localProgress = overview ? parcelSweepProgress(progress,record.position) : progress
                            if(localProgress === 0) return pointOpacity > 0 ? (pointStyle.setGeometry(record.pointStages[8]),pointStyle) : []
                            const lines = record.paths.map(({ring,lengths,total}) => {
                                const distance = localProgress * total
                                let index = 0
                                while(index < ring.length-2 && lengths[index+1] < distance) index++
                                const a = ring[index], b = ring[index+1]
                                const segment = lengths[index+1]-lengths[index]
                                const fraction = segment ? Math.min(1,(distance-lengths[index])/segment) : 1
                                return [...ring.slice(0,index+1),[a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction]]
                            })
                            lineStyle.setGeometry(new MultiLineString(lines))
                            const styles = [lineStyle]
                            if(pointOpacity > 0){
                                pointStyle.setGeometry(record.pointStages[8])
                                styles.push(pointStyle)
                            }
                            if(record.showTip && localProgress > 0 && localProgress < 0.98){
                                const line = lines[record.paths.indexOf(record.tipPath)]
                                tipStyle.setGeometry(new Point(line[line.length-1]))
                                styles.push(tipStyle)
                            }
                            return styles
                        }
                        const localFill = overview ? parcelSweepProgress(fillProgress,record.position) : fillProgress
                        faceStyle.getFill().setColor(`rgba(255,35,25,${0.36*localFill})`)
                        return faceStyle
                    }})
                this.parcelIdentifyViewKey = markRaw(this.map.on('moveend', () => {
                    if(requestId !== this.parcelIdentifyReqId || phase === 'faces') return
                    refreshMarkers()
                    layer.changed()
                }))
                layer.setExtent(this.parcelRoiExtent)
                this.parcelIdentifyLayer = markRaw(layer)
                this.parcelIdentifyOriginalVisible = this.agriParcelLayer.getVisible()
                this.agriParcelLayer.setVisible(false)
                this.map.addLayer(layer)
                if(overview){
                    const roi = this.parcelRoiExtent.slice(), saved = new WeakSet()
                    const renderRing = event => this.extentToRing(roi).map(coordinate => getRenderPixel(event,this.map.getPixelFromCoordinate(coordinate)))
                    const path = (context, pixels) => {
                        context.beginPath()
                        pixels.forEach((pixel,index) => index ? context.lineTo(...pixel) : context.moveTo(...pixel))
                        context.closePath()
                    }
                    this.parcelIdentifyRenderKeys = markRaw([
                        this.agriParcelLayer.on('prerender',event => {
                            const context = event.context
                            if(!context?.save || phase !== 'faces') return
                            context.save();saved.add(context)
                            const reveal = roi.slice();reveal[2] = roi[0]+(roi[2]-roi[0])*fillProgress
                            path(context,this.extentToRing(reveal).map(coordinate => getRenderPixel(event,this.map.getPixelFromCoordinate(coordinate))))
                            context.clip()
                            context.globalAlpha *= Math.min(1,fillProgress*4)
                        }),
                        this.agriParcelLayer.on('postrender',event => {if(saved.has(event.context)){event.context.restore();saved.delete(event.context)}}),
                        layer.on('postrender',event => {
                            const context = event.context
                            if(!context?.save || !['lines','faces'].includes(phase)) return
                            const sweep = phase === 'lines' ? progress : fillProgress
                            if(sweep <= 0 || sweep >= 1) return
                            const x = roi[0]+(roi[2]-roi[0])*sweep, halfWidth = (roi[2]-roi[0])*.012
                            context.save();path(context,renderRing(event));context.clip()
                            const band = [Math.max(roi[0],x-halfWidth),roi[1],Math.min(roi[2],x+halfWidth),roi[3]]
                            path(context,this.extentToRing(band).map(coordinate => getRenderPixel(event,this.map.getPixelFromCoordinate(coordinate))))
                            context.fillStyle = 'rgba(255,170,140,0.12)';context.fill()
                            const top = getRenderPixel(event,this.map.getPixelFromCoordinate([x,roi[3]]))
                            const bottom = getRenderPixel(event,this.map.getPixelFromCoordinate([x,roi[1]]))
                            context.beginPath();context.moveTo(...top);context.lineTo(...bottom)
                            context.strokeStyle = 'rgba(255,185,150,0.85)';context.lineWidth = event.frameState.pixelRatio*1.5;context.stroke();context.restore()
                        })
                    ])
                }
                this.parcelIdentifyCount = features.length
                this.parcelIdentifyPhase = 'points'
                this.parcelIdentifyNotice = '正在显示地块边界点…'
                const started = Date.now()
                const pointDuration = overview ? 2500 : 2000
                const lineDuration = overview ? 7000 : 5000
                const faceStart = pointDuration+lineDuration+1000
                const faceDuration = overview ? 3500 : 2000
                const totalDuration = faceStart+faceDuration
                this.parcelIdentifyTimer = setInterval(() => {
                    if(requestId !== this.parcelIdentifyReqId) return
                    const elapsed = Date.now() - started
                    // 大范围分区依次连线，并扫描显示完整 WMS 地块面。
                    this.parcelIdentifyProgress = Math.min(100,elapsed/totalDuration*100)
                    if(elapsed < pointDuration){
                        pointReveal = Math.min(1,elapsed/1300)
                        pointOpacity = Math.min(0.85,elapsed/700)
                        pointStyle.getImage().setRadius(2.3 + Math.sin(elapsed/240)*0.2)
                    }else if(elapsed < faceStart){
                        phase = 'lines'
                        progress = Math.min(1,(elapsed-pointDuration)/lineDuration)
                        pointOpacity = Math.max(0,0.85*(1-(elapsed-pointDuration)/1600))
                        tipStyle.getImage().setOpacity(Math.min(0.9,(1-progress)*5))
                        this.parcelIdentifyPhase = 'lines'
                        this.parcelIdentifyNotice = progress < 1 ? (overview ? '正在分区连接地块边界…' : '正在逐段连接地块边界…') : '边界已闭合，正在生成地块面…'
                    }else{
                        phase = 'faces'
                        fillProgress = Math.min(1,(elapsed-faceStart)/faceDuration)
                        this.parcelIdentifyPhase = 'faces'
                        this.parcelIdentifyNotice = overview ? '正在逐步显示选区完整地块…' : '正在填充地块面…'
                        if(overview && this.parcelIdentifyOriginalVisible) this.agriParcelLayer.setVisible(true)
                        if(elapsed >= totalDuration){
                            this.parcelIdentifyPhase = 'done'
                            this.parcelIdentifyNotice = overview ? '大范围演示完成，已显示选区完整地块' : '识别完成，可拖动边框查看其他区域'
                            if(overview){
                                unByKey(this.parcelIdentifyRenderKeys)
                                this.parcelIdentifyRenderKeys = null
                                this.map.removeLayer(layer)
                                this.parcelIdentifyLayer = null
                                this.agriParcelLayer.setVisible(this.parcelIdentifyOriginalVisible)
                            }
                            clearInterval(this.parcelIdentifyTimer)
                            this.parcelIdentifyTimer = null
                            if(this.parcelIdentifyViewKey) unByKey(this.parcelIdentifyViewKey)
                            this.parcelIdentifyViewKey = null
                        }
                    }
                    pointStyle.getImage().setOpacity(pointOpacity)
                    layer.changed()
                    if(overview && phase === 'faces') this.agriParcelLayer.changed()
                },60)
            }catch(error){
                if(requestId !== this.parcelIdentifyReqId) return
                controller.abort()
                this.parcelIdentifyNotice = '地块数据加载失败，请重新框选重试'
                console.warn('地块动态识别失败',error)
            }finally{
                if(this.parcelIdentifyAbort === controller) this.parcelIdentifyAbort = null
                if(requestId === this.parcelIdentifyReqId && this.parcelIdentifyPhase === 'loading') this.parcelIdentifyPhase = 'idle'
            }
        },

        // ============ 作物结构分析 ============
        // 统计范围来自框选：选区一变就重新取数重算

        // 接入多年数据的接口，形如 {2024:'图层名', 2025:'图层名'}
        setCropAnalysisYears:function(years){
            if(years && typeof years === 'object' && !Array.isArray(years)){
                this.cropAnalysisYears = {...years}
            }
            this.refreshCropAnalysis()
        },

        getCropAnalysisYears:async function(){
            try{
                const res = await axios.get('/static/cropYears.json')
                const data = res.data
                if(data && typeof data === 'object' && !Array.isArray(data)){
                    this.cropAnalysisYears = {...data}
                }
            }catch(e){
                // 没配就继续用默认的
            }
            this.refreshCropAnalysis()
        },

        // 编码就是 1-10，不需要再做别名合并
        normalizeCropType:function(code){
            return code
        },

        // 类型编码转名称 / 颜色 / 图标，没有对应项的用“类型N”兜底
        cropAnalysisTypeInfo:function(code){
            const info = CROP_TYPES.find(item => item.code === Number(code))
            if(info) return {name: info.name, color: info.color, icon: info.icon}
            const unknown = code === null || code === undefined || isNaN(code)
            return {name: unknown ? '未知' : ('类型' + code), color: '#8C97A3', icon: 'cropOther'}
        },

        cropAnalysisTypeName:function(code){
            return this.cropAnalysisTypeInfo(code).name
        },

        // 地图的 DOM 容器（#mapView）。统计期间给它挂个标记类，
        // CSS 里用 `.map-identifying .crop-layer` 选中作物图层做动画。
        // 之所以不直接操作图层容器：OpenLayers 7 没有公开获取它的接口
        getMapTargetElement:function(){
            if(!this.map || !this.map.getTargetElement) return null
            return this.map.getTargetElement() || null
        },

        // 识别动画（扫描闪烁 + 进度条）只在「作物结构」页出现，别处不要
        isCropBlinkRoute:function(){
            if(typeof window === 'undefined' || !window.location) return false
            return String(window.location.hash || '').indexOf('cropClassification') !== -1
        },

        // 把时空数据加载的图层全部撤掉（离开时空数据页时用，
        // 否则这些图层会跟着到农业地块 / 作物结构那边去）
        clearTemporalLayers:function(){
            if(this.temporalRefreshTimer) clearTimeout(this.temporalRefreshTimer)
            this.temporalRefreshTimer = null
            this.temporalLayerEnabled = {}
            this.temporalLayerRequests = {}
            this.temporalRequestRevision++
            if(this.map && this.map.removeLayer){
                Object.keys(this.temporalLayerInstances).forEach(id => {
                    const layer = this.temporalLayerInstances[id]
                    if(layer){
                        try{ this.map.removeLayer(layer) }catch(e){console.warn(e)}
                    }
                })
                Object.values(this.temporalAnnotationLayers).forEach(layer => {
                    try{ this.map.removeLayer(layer) }catch(e){console.warn(e)}
                })
            }
            Object.values(this.temporalClipKeys).forEach(keys => unByKey(keys))
            this.temporalClipKeys = {}
            Object.values(this.temporalAnimationTimers).forEach(timer => clearInterval(timer))
            this.temporalAnimationTimers = {}
            this.temporalLayerInstances = {}
            this.temporalAnnotationLayers = {}
            this.temporalLayerStatus = {}
            this.temporalNamedRiverFeatures = []
            this.temporalHoverInfo = null
        },

        // 扫描层和地图用同一个年份的作物图层
        getCropScanLayerName:function(){
            return cropLayerName(this.cropYear)
        },

        // 地块始终完整显示；候选作物颜色切换后逐块锁定真实分类。
        startCropAnalysisScan:async function(extent){
            this.stopCropAnalysisScan()
            if(!this.map || !extent || !this.cropLayer?.on) return false
            const reqId = ++this.cropScanReqId
            const layerName = this.getCropScanLayerName()
            if(!layerName) return false
            const controller = new AbortController()
            this.cropScanAbort = markRaw(controller)
            try{
                // 这里不能传 propertyName：这批图层是 Shapefile 存储，几何字段不叫 geom，
                // 名字写错 GeoServer 会直接返回 ServiceExceptionReport，动画就出不来了。
                // 返回全部字段即可，代码只读 FID_1 和 Max_value。
                const data = await fetchRecognitionFeatures(`${this.baseUrl}/geoserver/agri-agent/ows`, {
                    service:'WFS',version:'1.0.0',request:'GetFeature',typeName:layerName,
                    outputFormat:'application/json',srsName:'EPSG:4326',maxFeatures:20001,
                    bbox:extent.join(',')+',EPSG:4326'
                }, {signal:controller.signal})
                if(reqId !== this.cropScanReqId) return false
                if(!Array.isArray(data?.features) || !data.features.length) return false
                if(data.features.length > 20000){
                    this.cropAnalysisNotice = '选区地块较多，请缩小范围查看逐块识别动画'
                    return false
                }
                const total = Number(data.totalFeatures ?? data.numberMatched)
                if(!Number.isFinite(total) || total === data.features.length){
                    this.cropScanData = markRaw({layerName, extent:extent.join(','), data})
                }
                const projection = this.map.getView().getProjection()
                const features = new GeoJSON().readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:projection})
                    .filter(feature=>['Polygon','MultiPolygon'].includes(feature.getGeometry()?.getType()))
                const selectedCodes = this.cropSelectedCodes || []
                const selected = features.filter(feature=>{
                    const code = Number(readFeatureProperty(feature.getProperties(),CROP_ANALYSIS_TYPE_FIELD))
                    return selectedCodes.length === 0 || selectedCodes.includes(code)
                })
                if(!selected.length) return false
                // 换色动画用图例那套颜色，和地图上的分类色同源
                const styles = new Map(CROP_TYPES.map(type=>[type.code, new Style({
                    fill:new Fill({color:type.color}),
                    stroke:new Stroke({color:'rgba(30,45,35,0.4)',width:0.6})
                })]))
                const fallbackStyle = styles.get(CROP_TYPES[CROP_TYPES.length - 1].code)
                const styleOf = code => styles.get(code) || fallbackStyle
                const candidates = new Map()
                selected.forEach((feature,index)=>{
                    // 每块地的起始颜色不同、启动时间错开，整片看过去像在逐块识别。
                    // 只记偏移，不记真实类型：识别期间不做定格。
                    candidates.set(feature,{offset:index%CROP_TYPES.length,delay:(index%7)*170})
                })
                let elapsed = 0
                const layer = new VectorLayer({source:new VectorSource({features:selected}),zIndex:890,
                    // 整段识别过程都在十种作物色之间缓慢轮换，最后交给真实分类图层
                    style:feature=>{
                        const record = candidates.get(feature)
                        const step = Math.floor(Math.max(0,elapsed-record.delay)/CROP_ANALYSIS_SCAN_COLOR_MS)
                        return styleOf(CROP_TYPES[(record.offset+step)%CROP_TYPES.length].code)
                    }})
                // 只裁掉框外部分，框内全部地块始终完整存在。
                const saved = new WeakSet()
                this.cropScanRenderKeys = markRaw([
                    layer.on('prerender',event=>{
                        const context = event.context
                        if(!context?.save || !context?.clip) return
                        context.save(); saved.add(context);context.beginPath()
                        const corners = [[extent[0],extent[1]],[extent[2],extent[1]],[extent[2],extent[3]],[extent[0],extent[3]]]
                            .map(point=>getRenderPixel(event,this.map.getPixelFromCoordinate(fromLonLat(point,projection))))
                        corners.forEach((point,index)=>index ? context.lineTo(...point) : context.moveTo(...point))
                        context.closePath();context.clip()
                    }),
                    layer.on('postrender',event=>{if(saved.has(event.context)){event.context.restore();saved.delete(event.context)}})
                ])
                // 先挂上但不显示：等 1 秒的"渲染图层中"走完，再由 startCropAnalysisBlink 放出来
                layer.setVisible(false)
                this.cropScanLayer = markRaw(layer)
                this.cropScanTargetLayer = null
                this.cropScanOriginalVisible = null
                this.map.addLayer(layer)
                cropScanStartHook = () => {
                    if(reqId !== this.cropScanReqId || !this.cropScanLayer) return
                    layer.setVisible(true)
                    this.cropAnalysisBlinkStartedAt = Date.now()
                    this.cropScanPhase = 'running'
                    this.cropScanProgress = 0
                    this.cropScanTimer = setInterval(()=>{
                        if(reqId !== this.cropScanReqId) return
                        elapsed = Date.now()-this.cropAnalysisBlinkStartedAt
                        this.cropScanProgress = Math.min(100,elapsed/CROP_ANALYSIS_BLINK_MIN_MS*100)
                        layer.changed()
                        if(elapsed >= CROP_ANALYSIS_BLINK_MIN_MS){
                            this.cropScanPhase = 'done'
                            this.stopCropAnalysisBlink()
                        }
                    },CROP_ANALYSIS_SCAN_INTERVAL)
                }
                return true
            }catch(error){
                if(reqId === this.cropScanReqId) console.warn('作物识别动画加载失败',error)
                return false
            }
        },

        stopCropAnalysisScan:function(){
            this.cropScanReqId++
            cropScanStartHook = null
            this.cropScanAbort?.abort()
            this.cropScanAbort = null
            this.cropScanData = null
            if(this.cropScanTimer) clearInterval(this.cropScanTimer)
            this.cropScanTimer = null
            if(this.cropScanRenderKeys) unByKey(this.cropScanRenderKeys)
            this.cropScanRenderKeys = null
            if(this.cropScanTargetLayer && this.cropScanOriginalVisible !== null) this.cropScanTargetLayer.setVisible(this.cropScanOriginalVisible)
            this.cropScanOriginalVisible = null
            this.cropScanTargetLayer = null
            // 清理旧版扫描层，原始作物图层始终保留。
            if(this.cropScanLayer && this.map) this.map.removeLayer(this.cropScanLayer)
            this.cropScanLayer = null
        },

        // 定格：摘扫描层、去掉整层滤镜、还原透明度。
        // 正常到点、统计返回、超时兜底都走这里，所以必须可以重复调用
        clearCropAnalysisBlink:function(){
            if(this.cropAnalysisBlinkStopTimer){
                clearTimeout(this.cropAnalysisBlinkStopTimer)
                this.cropAnalysisBlinkStopTimer = null
            }
            if(this.cropAnalysisBlinkMaxTimer){
                clearTimeout(this.cropAnalysisBlinkMaxTimer)
                this.cropAnalysisBlinkMaxTimer = null
            }
            this.stopCropAnalysisScan()
            // 识别期间作物图层是收起来的，任何退出路径都要把它还回来
            this.restoreCropLayerAfterScan()
            // 扫描层成功挂上时会把 container 置空，这里用地图容器兜底，
            // 保证标记类一定被摘掉，不留下一直在变的颜色
            const target = this.cropAnalysisBlinkContainer || this.getMapTargetElement()
            if(target && target.classList) target.classList.remove(CROP_ANALYSIS_BLINK_CLASS)
            this.cropAnalysisBlinkContainer = null
            // 兜底：把可能被改过的透明度还原
            if(this.cropLayer && this.cropLayer.setOpacity) this.cropLayer.setOpacity(1)
            this.cropAnalysisBlinkStartedAt = 0
            if(this.cropScanPhase !== 'done') this.cropScanPhase = 'idle'
        },

        // 识别结束 / 取数失败时还原作物图层（框选时依然只显示框内）
        restoreCropLayerAfterScan:function(){
            if(this.cropLayer && this.cropLayer.setVisible){
                this.cropLayer.setVisible(this.cropTab === 'visual')
            }
        },

        // 框选后的两段式识别：
        //   第 1 秒 —— 框内收掉作物图层，只留底图，进度条显示"渲染图层中"
        //   之后   —— 框内逐块在十种作物色之间换色，持续至少 6 秒
        startCropAnalysisBlink:async function(extent){
            this.clearCropAnalysisBlink()
            if(!this.cropLayer) return
            this.cropScanPhase = 'preparing'
            this.cropScanProgress = 0
            // 框内先什么图层都不显示
            if(this.cropLayer.setVisible) this.cropLayer.setVisible(false)
            const prepareStartedAt = Date.now()
            const pending = this.startCropAnalysisScan(extent)
            const scanRequest = this.cropScanReqId
            const ready = await pending
            if(scanRequest !== this.cropScanReqId) return
            if(!ready){
                // 取不到数据就把图层还回去，不要停在空白底图上
                if(this.cropScanPhase === 'preparing'){
                    this.restoreCropLayerAfterScan()
                    this.cropScanPhase = 'idle'
                }
                return
            }
            // 取数常常不到 1 秒，这里补足空白展示的时间再开始换色
            const wait = CROP_ANALYSIS_PREPARE_MS - (Date.now() - prepareStartedAt)
            if(wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
            if(scanRequest !== this.cropScanReqId) return
            if(typeof cropScanStartHook === 'function') cropScanStartHook()
        },

        // 统计提前返回时仍等换色动画跑满，随后恢复原作物图层。
        stopCropAnalysisBlink:function(){
            const elapsed = this.cropAnalysisBlinkStartedAt
                ? Date.now() - this.cropAnalysisBlinkStartedAt
                : CROP_ANALYSIS_BLINK_MIN_MS
            const wait = Math.max(CROP_ANALYSIS_BLINK_MIN_MS - elapsed, 0)
            if(wait > 0){
                if(this.cropAnalysisBlinkStopTimer) clearTimeout(this.cropAnalysisBlinkStopTimer)
                this.cropAnalysisBlinkStopTimer = setTimeout(() => {
                    if(this.cropScanPhase === 'running'){this.cropScanPhase = 'done';this.cropScanProgress = 100}
                    this.clearCropAnalysisBlink()
                }, wait)
            }else{
                this.clearCropAnalysisBlink()
            }
        },

        // 按当前范围取数并重算。没有框选时统计整个流域，
        // 全流域那次的结果会缓存，取消框选时直接复用，不重复取数
        refreshCropAnalysis:async function(force){
            if(!this.isCropBlinkRoute()) { this.cancelCropAnalysisRequest(); return }
            if(!this.map || this.parcelIdentifyEnabled) return
            const isRoi = !!this.parcelRoiExtent
            const extent = isRoi ? this.parcelRoiExtent : CROP_ANALYSIS_FULL_EXTENT
            this.cropAnalysisScope = isRoi ? 'roi' : 'full'

            // 没有框选：直接用离线统计好的数字。全流域 35 万个面不能每次进页面
            // 都从 WFS 拉属性，那样面板要转很久。
            if(!isRoi){
                this.cancelCropAnalysisRequest()
                this.stopCropAnalysisBlink()
                this.cropAnalysisExtent = extent.slice()
                this.cropAnalysisNotice = ''
                this.cropAnalysisLoading = true
                const statsReqId = ++this.cropAnalysisReqId
                try{
                    const [stats, temporal] = await Promise.all([
                        this.getCropStats(), this.getCropTemporalStats()
                    ])
                    if(statsReqId !== this.cropAnalysisReqId) return
                    const result = stats ? this.cropAnalysisFromStats(stats, this.cropYear, temporal) : null
                    if(result){
                        this.cropAnalysisFullResult = result
                        this.cropAnalysisYearsLoaded = CROP_YEARS.slice()
                        this.cropAnalysisResult = result
                    }else{
                        this.cropAnalysisResult = null
                        this.cropAnalysisNotice = '全流域统计数据不可用，请确认已生成 public/static/cutCropStats.json'
                    }
                }catch(e){
                    if(statsReqId === this.cropAnalysisReqId){
                        this.cropAnalysisResult = null
                        this.cropAnalysisNotice = '全流域统计数据读取失败'
                    }
                }finally{
                    if(statsReqId === this.cropAnalysisReqId){
                        this.cropAnalysisLoading = false
                        this.cropAnalysisPendingKey = ''
                    }
                }
                return
            }

            // 同一范围和数据源去重；新范围立刻取消旧统计，给识别请求让出带宽。
            const pendingKey = `${this.baseUrl}|${JSON.stringify(this.cropAnalysisYears)}|${isRoi ? 'roi' : 'full'}|${extent.join(',')}`
            if(!force && this.cropAnalysisLoading && this.cropAnalysisPendingKey === pendingKey){
                return
            }
            this.cancelCropAnalysisRequest()
            this.cropAnalysisPendingKey = pendingKey
            const controller = new AbortController()
            this.cropAnalysisAbort = markRaw(controller)
            const reqId = ++this.cropAnalysisReqId
            // loading 要在扫描层取数之前就置上：那一段也属于"统计中"，
            // 不置的话面板会继续显示上一次的结果，看起来像已经出结果了
            this.cropAnalysisLoading = true
            this.cropAnalysisNotice = ''

            // 先准备识别图层，完整响应直接复用于统计；统计提前完成也保留12秒动画。
            if(isRoi && this.isCropBlinkRoute()) await this.startCropAnalysisBlink(extent)
            if(reqId !== this.cropAnalysisReqId) return
            try{
                // 框选范围现算。先取当前年份带几何的数据算每个地块的面积 ——
                // 三年的边界是同一套，面积算一次就够，其余年份只取属性。
                const orderedYears = [this.cropYear, ...CROP_YEARS.filter(y => y !== this.cropYear)]
                const records = []
                const loadedYears = []
                const areaByParcel = new Map()
                for(const year of orderedYears){
                    const layer = cropLayerName(year)
                    const needGeometry = year === this.cropYear
                    const params = {
                        service:'WFS',version:'1.0.0',request:'GetFeature',typeName:layer,
                        outputFormat:'application/json',srsName:'EPSG:4326',
                        maxFeatures:CROP_ANALYSIS_MAX_FEATURES,
                        bbox:`${extent.join(',')},EPSG:4326`
                    }
                    if(!needGeometry){
                        params.propertyName = `${CROP_ANALYSIS_PARCEL_FIELD},${CROP_ANALYSIS_TYPE_FIELD}`
                    }
                    let geojson
                    try{
                        const scan = this.cropScanData
                        geojson = needGeometry && scan?.layerName === layer && scan.extent === extent.join(',')
                            ? scan.data
                            : await fetchRecognitionFeatures(`${this.baseUrl}/geoserver/agri-agent/ows`, params,
                                {signal:controller.signal, timeout:300000, fresh:!!force})
                    }catch(error){
                        // 尚未发布的年份保持原来的跳过行为。
                        if(error.code === 'WFS_EXCEPTION') continue
                        throw error
                    }
                    if(reqId !== this.cropAnalysisReqId) return
                    const features = (geojson && geojson.features) || []
                    loadedYears.push(year)
                    if(features.length >= CROP_ANALYSIS_MAX_FEATURES){
                        this.cropAnalysisNotice = '范围偏大，数据可能不完整，建议缩小框选'
                    }
                    if(needGeometry){
                        new GeoJSON().readFeatures(geojson,{dataProjection:'EPSG:4326',featureProjection:'EPSG:4326'})
                            .forEach(feature => {
                                const geometry = feature.getGeometry()
                                const parcel = readFeatureProperty(feature.getProperties(), CROP_ANALYSIS_PARCEL_FIELD)
                                if(!geometry || parcel === undefined || parcel === null) return
                                areaByParcel.set(String(parcel), getArea(geometry, {projection:'EPSG:4326'}) / 1e6)
                            })
                    }
                    features.forEach(feature => {
                        const props = feature && feature.properties
                        if(!props) return
                        const parcel = readFeatureProperty(props, CROP_ANALYSIS_PARCEL_FIELD)
                        const key = parcel === undefined || parcel === null ? null : String(parcel)
                        records.push({
                            year,
                            parcel: key,
                            type: Number(readFeatureProperty(props, CROP_ANALYSIS_TYPE_FIELD)),
                            // 面积单位统一成平方公里
                            area: key === null ? 0 : (areaByParcel.get(key) || 0)
                        })
                    })
                }
                if(reqId !== this.cropAnalysisReqId) return
                const result = this.computeCropAnalysis(records, extent, loadedYears)
                result.loadedYears = loadedYears
                if(reqId !== this.cropAnalysisReqId) return
                this.cropAnalysisYearsLoaded = loadedYears
                this.cropAnalysisExtent = extent.slice()
                this.cropAnalysisResult = result
            }catch(e){
                if(reqId !== this.cropAnalysisReqId || controller.signal.aborted) return
                console.warn('作物结构分析取数失败：', e && (e.message || e))
                this.cropAnalysisResult = null
                this.cropAnalysisNotice = '作物结构分析取数失败'
            }finally{
                if(reqId === this.cropAnalysisReqId){
                    this.cropAnalysisLoading = false
                    this.cropAnalysisPendingKey = ''
                    this.cropAnalysisAbort = null
                    this.stopCropAnalysisBlink()
                }
            }
        },

        cancelCropAnalysisRequest:function(){
            this.cropAnalysisReqId++
            this.cropAnalysisAbort?.abort()
            this.cropAnalysisAbort = null
            this.cropAnalysisLoading = false
            this.cropAnalysisPendingKey = ''
        },

        // 取离线统计好的全流域数字（scripts/cut-stats.cjs 生成），整个会话只请求一次
        getCropStats:async function(){
            if(this.cropStats) return this.cropStats
            if(!cropStatsPromise){
                cropStatsPromise = axios.get(CROP_STATS_URL)
                    .then(res => res.data)
                    .catch(e => {
                        console.warn('作物统计 JSON 读取失败：', e && (e.message || e))
                        cropStatsPromise = null
                        return null
                    })
            }
            this.cropStats = await cropStatsPromise
            return this.cropStats
        },

        // 取 1009 数据算出来的时序 / 种植分析统计（轮作序列、跨年改变次数、多样性）
        getCropTemporalStats:async function(){
            if(this.cropTemporalStats) return this.cropTemporalStats
            if(!cropTemporalStatsPromise){
                cropTemporalStatsPromise = axios.get(CROP_TEMPORAL_STATS_URL)
                    .then(res => res.data)
                    .catch(e => {
                        console.warn('时序分析统计 JSON 读取失败：', e && (e.message || e))
                        cropTemporalStatsPromise = null
                        return null
                    })
            }
            this.cropTemporalStats = await cropTemporalStatsPromise
            return this.cropTemporalStats
        },

        // 把离线统计按当前年份拼成面板要的结构，字段和 computeCropAnalysis 对齐。
        // temporal 是 1009 数据算出来的时序统计，稳定性以它的口径为准
        cropAnalysisFromStats:function(stats, year, temporal){
            const data = stats && stats.years && stats.years[String(year)]
            if(!data) return null
            const byType = data.byType
                .map(item => ({
                    code: item.code,
                    name: cropTypeName(item.code),
                    count: item.count,
                    area: item.areaKm2,
                    ratio: item.ratio,
                    perKm2: data.totalAreaKm2 ? item.count / data.totalAreaKm2 : 0
                }))
                .sort((a, b) => b.area - a.area)
            const ratios = byType.map(item => item.ratio)
            return {
                years: CROP_YEARS.slice(),
                latestYear: Number(year),
                baseline: stats.baselineYear,
                patchCount: data.parcelCount,
                parcelCount: data.parcelCount,
                totalArea: data.totalAreaKm2,
                byType,
                diversity: {
                    richness: byType.filter(item => item.count > 0).length,
                    shannon: ratios.reduce((sum, p) => (p > 0 ? sum - p * Math.log(p) : sum), 0),
                    simpson: 1 - ratios.reduce((sum, p) => sum + p * p, 0),
                    speciesPerKm2: data.totalAreaKm2 ? byType.length / data.totalAreaKm2 : 0,
                    // 新数据一个地块只有一个作物类型，"地块平均"类指标没有意义
                    parcelShannon: 0,
                    parcelSimpson: 0,
                    parcelTypesPerKm2: 0,
                    parcelUsable: 0
                },
                series: (stats.series || []).map(item => ({
                    year: item.year, code: item.code, name: item.name, ratio: item.ratio
                })),
                // 稳定性用 1009 的口径：相对基准年(2024)发生改变的年数，取值 0 / 1 / 2
                stability: temporal && temporal.stability
                    ? {
                        baseline: temporal.stability.baseline,
                        years: temporal.stability.years,
                        parcelCount: temporal.parcelCount,
                        averageChanges: temporal.stability.averageChanges,
                        histogram: temporal.stability.changes,
                        comparable: true
                    }
                    : (stats.stability || {
                        years: [], parcelCount: 0, averageChanges: null, histogram: {}, comparable: false
                    })
            }
        },

        // 把要素记录算成统计结果
        computeCropAnalysis:function(records, extent, years){
            const sortedYears = (years || []).slice().sort((a, b) => a - b)
            // 面积在取数时已经按球面公式换算成平方公里，这里直接用
            const latestYear = sortedYears.length ? sortedYears[sortedYears.length - 1] : null
            const latest = records.filter(r => r.year === latestYear)

            const typeMap = new Map()
            let totalArea = 0
            latest.forEach(r => {
                const area = r.area || 0
                totalArea += area
                const item = typeMap.get(r.type) || {code: r.type, count: 0, area: 0}
                item.count += 1
                item.area += area
                typeMap.set(r.type, item)
            })
            const byType = Array.from(typeMap.values())
                .map(item => ({
                    ...item,
                    name: this.cropAnalysisTypeName(item.code),
                    ratio: totalArea ? item.area / totalArea : 0,
                    perKm2: totalArea ? item.count / totalArea : 0
                }))
                .sort((a, b) => b.area - a.area)

            const richness = byType.length
            const shannonOf = ratios => ratios.reduce((sum, p) => p > 0 ? sum - p * Math.log(p) : sum, 0)
            const simpsonOf = ratios => 1 - ratios.reduce((sum, p) => sum + p * p, 0)
            const overallRatios = byType.map(item => item.ratio)

            // 按地块统计：每个地块内部各作物类型的面积占比
            const parcelMap = new Map()
            latest.forEach(r => {
                if(!r.parcel) return
                const area = r.area || 0
                const perType = parcelMap.get(r.parcel) || {total: 0, types: new Map()}
                perType.total += area
                perType.types.set(r.type, (perType.types.get(r.type) || 0) + area)
                parcelMap.set(r.parcel, perType)
            })
            let parcelShannonSum = 0
            let parcelSimpsonSum = 0
            let parcelTypesPerKm2Sum = 0
            let parcelUsable = 0
            parcelMap.forEach(perType => {
                if(!perType.total) return
                const ratios = Array.from(perType.types.values()).map(area => area / perType.total)
                parcelShannonSum += shannonOf(ratios)
                parcelSimpsonSum += simpsonOf(ratios)
                parcelTypesPerKm2Sum += perType.types.size / perType.total
                parcelUsable += 1
            })

            // 多年序列：每年取面积占比最大的作物
            const series = sortedYears.map(year => {
                const areaByType = new Map()
                let yearArea = 0
                records.forEach(r => {
                    if(r.year !== year) return
                    const area = r.area || 0
                    yearArea += area
                    areaByType.set(r.type, (areaByType.get(r.type) || 0) + area)
                })
                let topCode = null
                let topArea = -1
                areaByType.forEach((area, code) => {
                    if(area > topArea){ topArea = area; topCode = code }
                })
                return {
                    year,
                    code: topCode,
                    name: topCode === null ? '暂无数据' : this.cropAnalysisTypeName(topCode),
                    ratio: yearArea ? topArea / yearArea : 0
                }
            })

            // 种植稳定性：和 1009 数据同一口径 —— 统计地块相对基准年(2024)改变的年数，
            // 取值 0 / 1 / 2。不是相邻两年的变化次数，那两种算法结果不一样。
            const stabilityYears = sortedYears.filter(y => y >= CROP_ANALYSIS_BASELINE_YEAR)
            const parcelYearType = new Map()
            records.forEach(r => {
                if(!r.parcel || !stabilityYears.includes(r.year)) return
                const area = r.area || 0
                const perYear = parcelYearType.get(r.parcel) || new Map()
                const current = perYear.get(r.year)
                // 同一年同一地块可能有多个斑块，取面积最大的那一类
                if(!current || area > current.area) perYear.set(r.year, {type: r.type, area})
                parcelYearType.set(r.parcel, perYear)
            })
            let stableParcels = 0
            let changeSum = 0
            const histogram = {}
            parcelYearType.forEach(perYear => {
                const baseline = perYear.get(CROP_ANALYSIS_BASELINE_YEAR)
                if(!baseline) return
                let changes = 0
                stabilityYears.forEach(year => {
                    if(year === CROP_ANALYSIS_BASELINE_YEAR) return
                    const current = perYear.get(year)
                    if(current && current.type !== baseline.type) changes += 1
                })
                stableParcels += 1
                changeSum += changes
                histogram[changes] = (histogram[changes] || 0) + 1
            })

            return {
                years: sortedYears,
                latestYear,
                baseline: CROP_ANALYSIS_BASELINE_YEAR,
                patchCount: latest.length,
                parcelCount: parcelMap.size,
                totalArea,
                byType,
                diversity: {
                    richness,
                    shannon: shannonOf(overallRatios),
                    simpson: simpsonOf(overallRatios),
                    speciesPerKm2: totalArea ? richness / totalArea : 0,
                    parcelShannon: parcelUsable ? parcelShannonSum / parcelUsable : 0,
                    parcelSimpson: parcelUsable ? parcelSimpsonSum / parcelUsable : 0,
                    parcelTypesPerKm2: parcelUsable ? parcelTypesPerKm2Sum / parcelUsable : 0,
                    parcelUsable
                },
                series,
                stability: {
                    years: stabilityYears,
                    parcelCount: stableParcels,
                    averageChanges: stableParcels ? changeSum / stableParcels : null,
                    histogram,
                    // 少于两年没法比，界面上要提示需要补数据
                    comparable: stabilityYears.length >= 2
                }
            }
        },

        // ============ 地区下拉框 ============
        // 读地区列表：优先 /static/parcelRegions.json，读不到就用内置占位地区
        getParcelRegions:async function(){
            let list = []
            try{
                const res = await axios.get('/static/parcelRegions.json')
                if(Array.isArray(res.data)) list = res.data
            }catch(e){
                list = []
            }
            list = list.filter(item => item && item.name)
            if(list.length === 0){
                this.setParcelRegions(PARCEL_REGION_PLACEHOLDER)
                this.parcelRegionPlaceholder = true
                return
            }
            this.setParcelRegions(list)
            this.parcelRegionPlaceholder = false
        },

        // 数据接入接口。每个地区的定位方式二选一：
        //   {id, name, center:[lon,lat], zoom}
        //   {id, name, extent:[minx,miny,maxx,maxy]}
        // 第二参数可选，用来指定“全部”要回到的视图：{center:[lon,lat], zoom}
        setParcelRegions:function(list, allView){
            this.parcelRegions = Array.isArray(list) ? list.slice() : []
            if(allView !== undefined) this.parcelRegionAllView = allView
            this.parcelRegionId = PARCEL_REGION_ALL_ID
        },

        // 选中某个地区：地图自动切过去；“全部”回到完整视图
        selectParcelRegion:function(id){
            if(!this.map || !this.map.getView) return
            // 已经框选过就先撤掉遮罩，否则地图挪走后整个画面都被遮住
            if(this.parcelRoiState !== 'idle') this.clearParcelRoi(false)

            this.parcelRegionId = id || PARCEL_REGION_ALL_ID
            const view = this.map.getView()

            if(this.parcelRegionId === PARCEL_REGION_ALL_ID){
                const home = this.parcelRegionAllView || PARCEL_DEFAULT_VIEW
                view.animate({center: home.center, zoom: home.zoom, duration: 600})
                return
            }

            const region = this.parcelRegions.find(item => item && item.id === this.parcelRegionId)
            if(!region) return
            if(Array.isArray(region.extent) && region.extent.length === 4){
                view.fit(region.extent, {
                    padding: [PARCEL_REGION_PADDING, PARCEL_REGION_PADDING, PARCEL_REGION_PADDING, PARCEL_REGION_PADDING],
                    duration: 600
                })
            }else if(Array.isArray(region.center) && region.center.length === 2){
                view.animate({
                    center: region.center,
                    zoom: typeof region.zoom === 'number' ? region.zoom : view.getZoom(),
                    duration: 600
                })
            }
        },

        removeCropLayer:function(){
            if(!this.map || !this.map.removeLayer) return
            this.map.removeLayer(this.cropLayer)
        },
        removeAdministrativeLayer:function(){
            if(!this.map || !this.map.removeLayer) return
            this.map.removeLayer(this.administrativeLayer)
        },
        removeCropImageryLayers:function(){
            if(!this.map || !this.map.removeLayer) return
            this.cropImageryLayers.forEach(layer=>{
                if(Object.keys(layer).length !== 0){
                    console.log(true)
                    this.map.removeLayer(layer);
                }
            })
        },
        removeClick:function (){
            if(!this.clickChoose || Object.getOwnPropertyNames(this.clickChoose).length===0) return
            unByKey(this.clickChoose)
        },
        removeTimeData:function(){
            if(!this.map || !this.map.removeLayer) return
            this.map.removeLayer(this.timeLayer)
        },


    

        // 流域底图（ArcGIS底图）
        // param：{type:arcgis底图类型}
        addBasinBasicLayer:function(type='NatGeo_World_Map'){
            const URL = `https://server.arcgisonline.com/ArcGIS/rest/services/${type}/MapServer/tile/{z}/{y}/{x}`
            const basinBasicLayer = new Tile({
                source:new XYZ({
                    url: URL,
                    crossOrigin: "anonymous"
                })
            })

            this.basinBasicLayer = basinBasicLayer
            this.map.addLayer(this.basinBasicLayer)
        },


        // 移除流域底图
        removeBasinLayer:function(){
            if(this.map && this.map.removeLayer && Object.getOwnPropertyNames(this.basinBasicLayer).length!==1){
                this.map.removeLayer(this.basinBasicLayer)
                this.basinBasicLayer = new Layer({})
            }
            // 移除流域所有图层
            try{
                if(this.basinBoundaryLayer && this.map && this.map.removeLayer){
                    this.map.removeLayer(this.basinBoundaryLayer)
                    this.basinBoundaryLayer = new Layer({})
                }
            }catch(e){}
            try{
                if(this.basinMaskLayer && this.map && this.map.removeLayer){
                    this.map.removeLayer(this.basinMaskLayer)
                    this.basinMaskLayer = new Layer({})
                }
            }catch(e){}
            try{
                if(this.basinLabelLayer && this.map && this.map.removeLayer){
                    this.map.removeLayer(this.basinLabelLayer)
                    this.basinLabelLayer = new Layer({})
                }
            }catch(e){}
        },

        // 添加流域边界图层
        addBasinBoundaryLayer:function(){
            console.log("add BasinLayer!!")
            this.basinBoundaryUrl = `${this.baseUrl}/geoserver/agri-agent/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=agri-agent:bh-basin-shp&outputFormat=application/json`

            const basinSource = new VectorSource({
                url: this.basinBoundaryUrl,
                format: new GeoJSON(),
            });

            // boundary stroke (will be placed above the mask)
            const basinBoundaryLayer = new VectorLayer({
                source: basinSource,
                zIndex: 4,
                style: new Style({
                    stroke: new Stroke({
                        color: 'rgba(255,0,0,0.5)',
                        width: 3
                    }),
                })
            });

            // 流域内部高亮遮罩
            const maskSource = new VectorSource();
            const maskLayer = new VectorLayer({
                source: maskSource,
                zIndex: 3,
                style: new Style({
                    fill: new Fill({ color: 'rgba(0,0,0,0.6)' }),
                    stroke: null
                })
            });

            // 添加遮罩
            const buildMask = () => {
                const features = basinSource.getFeatures();
                if(!features || features.length === 0) return;

                // world ring in lon/lat then transformed to map projection
                const viewProj = this.map.getView().getProjection();
                const worldRingLonLat = [
                    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
                ];
                const worldRing = worldRingLonLat.map(c => fromLonLat(c, viewProj));

                const holes = [];
                features.forEach(f => {
                    const geom = f.getGeometry();
                    if(!geom) return;
                    const type = geom.getType();
                    if(type === 'Polygon'){
                        const rings = geom.getCoordinates();
                        rings.forEach(r => holes.push(r));
                    } else if(type === 'MultiPolygon'){
                        const polys = geom.getCoordinates();
                        polys.forEach(poly => {
                            poly.forEach(r => holes.push(r));
                        })
                    }
                });

                const maskCoords = [worldRing].concat(holes);
                const maskFeature = new Feature(new Polygon(maskCoords));
                maskSource.clear();
                maskSource.addFeature(maskFeature);
            };

            basinSource.on('change', () => {
                // wait until features are loaded into the source
                if(basinSource.getState && basinSource.getState() === 'ready'){
                    buildMask();
                } else if(basinSource.getFeatures().length>0){
                    buildMask();
                }
            });

            this.basinBoundaryLayer = basinBoundaryLayer;
            this.basinMaskLayer = maskLayer;
            this.map.addLayer(this.basinMaskLayer);
            this.map.addLayer(this.basinBoundaryLayer);
        },


        // 添加流域标签（自定义geojson）
        // 添加流域标签（自定义geojson）
addBasinLabelLayer: function() {
    const labelSource = new VectorSource({
        url: '/data/balkhash-labels.geojson', 
        format: new GeoJSON(),
    });

    const labelLayer = new VectorLayer({
        source: labelSource,
        // 修改点 1：将 style 函数改为箭头函数 (以保留 this 指向)，并接收 resolution 参数
        style: (feature, resolution) => {
            const name = feature.get('name:zh') || feature.get('name');

            if (!name) return null;

            // 修改点 2：通过 resolution 获取当前的缩放级别 (zoom)
            // 注意：确保 this.map 已经被正确初始化并且可以访问
            let zoom = this.map.getView().getZoomForResolution(resolution);
            
            // 修改点 3：根据缩放级别计算动态字体大小 (单位：px)
            // 基础算法示例：zoom 变大（地图放大）时，字体也适度变大
            // 你可以根据实际的初始视角（如 zoom=5）和视觉需求调整这里的基数和乘数
            let fontSize = 12 + (zoom - 5) * 1.5; 

            // 修改点 4：限制字体大小的上下限，避免缩放过度导致字体看不清或占满全屏
            // 这里限制最小 12px，最大 26px
            fontSize = Math.max(10, Math.min(fontSize, 26)); 

            // 可选：当地图缩放到很小（视角很高）时，直接隐藏标签以防止密密麻麻
            // if (zoom < 4) return null;

            return new Style({
                text: new Text({
                    text: name,
                    // 修改点 5：使用模板字符串将动态计算的字体大小应用到 font 属性中
                    font: `bold ${fontSize}px "FangSong", serif`,
                    fill: new Fill({
                        color: '#000000'
                    }),
                    stroke: new Stroke({
                        color: '#FFFFFF',
                        width: 1.5
                    }),
                    offsetY: -15 // 向上偏移 15 像素
                })
            });
        },
        zIndex: 99
    });
    
    this.basinLabelLayer = labelLayer;
    this.map.addLayer(this.basinLabelLayer);
    
    return labelLayer;
},

        // 添加流域标签（天地图）
        addBasinLabelLayer1: function() {
            const tk = "37680d3f8085db6effbc0c031cca6106"; 
            const URL = `http://t{0-7}.tianditu.gov.cn/cta_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cta&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tk}`;

            const labelLayer = new Tile({
                source: new XYZ({
                    url: URL,
                    crossOrigin: 'anonymous' // 解决跨域导致 Canvas 污染的问题
                }),
                zIndex: 99, // 设置一个较高的 zIndex，确保注记文字盖在底层地图之上
                extent: BALKHASH_EXTENT
            });

            this.basinLabelLayer = labelLayer;
            this.map.addLayer(this.basinLabelLayer);
        },

        // 添加流域标签 arcgis
        addBasinLabelLayer2: function() {
            const labelUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}`;

            const labelLayer = new Tile({
                source: new XYZ({
                    url: labelUrl,
                    crossOrigin: 'anonymous'
                }),
                zIndex: 99, // 确保注记在最上层
                name: 'BasinLabel',
                extent: BALKHASH_EXTENT
            });

            this.basinLabelLayer = labelLayer;
            this.map.addLayer(this.basinLabelLayer);
        },

        // 添加流域标签 OSM
        addBasinLabelLayer3: function() {
            // 使用 osm-cn 中文瓦片服务（由 OSM 中国社区维护）
            // 注意：此服务中文覆盖集中在中国境内，海外区域可能退化为英文
            const labelUrl = `https://tile.openstreetmap.org/{z}/{x}/{y}.png`;

            // 更推荐使用支持中文的 CartoDb Voyager（中文地名优先渲染）
            const cartoLabelUrl = `https://{a-c}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png`;

            const labelLayer = new Tile({
                source: new XYZ({
                    url: cartoLabelUrl,
                    crossOrigin: 'anonymous',
                    // 通过 Accept-Language 头提示服务器优先返回中文（部分服务支持）
                    tileLoadFunction: function(tile, src) {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', src);
                        xhr.setRequestHeader('Accept-Language', 'zh-CN,zh;q=0.9');
                        xhr.responseType = 'blob';
                        xhr.onload = function() {
                            const objectUrl = URL.createObjectURL(xhr.response);
                            tile.getImage().src = objectUrl;
                        };
                        xhr.send();
                    }
                }),
                zIndex: 99,
                name: 'BasinLabel'
            });

            this.basinLabelLayer = labelLayer;
            this.map.addLayer(this.basinLabelLayer);
        },

        // 添加流域标签 Google
        addBasinLabelLayer4: function() {
            // 谷歌纯标签与路网透明层，强制中文
            const googleLabelUrl = 'https://mt0.google.com/vt/lyrs=h&hl=zh-CN&gl=CN&x={x}&y={y}&z={z}';

            const labelLayer = new TileLayer({
                source: new XYZ({
                    url: googleLabelUrl,
                    crossOrigin: 'anonymous'
                }),
                zIndex: 99, 
                // 关键折中策略：设置半透明。
                // 这会让不需要的城市和公路“融入”底图，不喧宾夺主，同时保留基本的中文地理参考。
                opacity: 0.6, 
                name: 'BasinLabel_Chinese_Google'
            });

            this.basinLabelLayer = labelLayer;
            this.map.addLayer(this.basinLabelLayer);
        },


        addLandMap:function(){
            const landSource = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    LAYERS:'test:feichen',
                    VERSION:'1.1.1',
                    TILED:true
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })

            const landLayer = new Tile({
                source:landSource
            })
            this.clearMap(0)
            this.landLayer = landLayer
            this.map.addLayer(this.landLayer)
        },
        // 添加颜色图层
        addColorLayer:function({fillColor,opacity,strokeColor,strokeWidth}) {
            const colorSource = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    LAYERS:'test:feichen_RetGEO',
                    VERSION:'1.1.1',
                    TILED:true,
                    STYLES:'041493',
                    env:`fillColor:${fillColor};opacity:${opacity};strokeColor:${strokeColor};strokeWidth:${strokeWidth}`
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })
            const colorLayer = new Tile({
                source:colorSource,
            })
            this.clearMap(1)
            this.colorLayer = colorLayer
            this.map.addLayer(this.colorLayer)
        },
        addHuanTaiLand:function(){
            const huanTaiLandSource = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    LAYERS:'test:huantai_landmass',
                    VERSION:'1.1.1',
                    TILED:true,
                    STYLES:'resetChannel'
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })

            const huanTaiLandLayer = new Tile({
                source:huanTaiLandSource
            })
            this.clearMap(0)
            this.huanTaiLandLayer = huanTaiLandLayer
            this.map.addLayer(this.huanTaiLandLayer)
        },
        addHuanTaiColor:function(index){
            let styleSheet= ['huantai_landmass_green_style','huantai_landmass_colorful_style']
            const huanTaiColorSource = new TileWMS({
                url:`${this.baseUrl}/geoserver/test/wms`,
                params:{
                    LAYERS:'test:huantai_shape',
                    VERSION:'1.1.1',
                    TILED:true,
                    STYLES:styleSheet[index]
                },
                projection:'EPSG:4326',
                serverType:'geoserver'
            })

            const huanTaiColorLayer = new Tile({
                source:huanTaiColorSource
            })
            this.clearMap(3)
            this.huanTaiColorLayer = huanTaiColorLayer
            this.map.addLayer(this.huanTaiColorLayer)
        },





        //移除图层的函数
        clearMap:function(i){
            // 如果 map 未初始化，直接返回，避免对不可用的数据源或未挂载的 map 进行操作
            if(!this.map || !this.map.removeLayer) return

            if(Object.getOwnPropertyNames(this.basicLayer).length!==1){
                // this.map.removeLayer(this.basicLayer)
                // this.basicLayer={}
            }
            if(Object.getOwnPropertyNames(this.timeLayer).length!==1){
                this.map.removeLayer(this.timeLayer)
                this.timeLayer={}
            }
            if(Object.getOwnPropertyNames(this.landLayer).length!==1&&i!==1){
                this.map.removeLayer(this.landLayer)
                this.landLayer={}
            }
            if(Object.getOwnPropertyNames(this.colorLayer).length!==1){
                this.map.removeLayer(this.colorLayer)
                this.colorLayer={}
            }
            if(Object.getOwnPropertyNames(this.cropLayer).length!==1){
                this.map.removeLayer(this.cropLayer)
                this.cropLayer={}
            }
            if(Object.getOwnPropertyNames(this.cropLandLayer).length!==1&&i!==2){
                this.map.removeLayer(this.cropLandLayer)
                this.cropLandLayer={}
            }
            if(Object.getOwnPropertyNames(this.huanTaiColorLayer).length!==1){
                this.map.removeLayer(this.huanTaiColorLayer)
                this.huanTaiColorLayer={}
            }
            if(Object.getOwnPropertyNames(this.huanTaiLandLayer).length!==1&&i!==3){
                this.map.removeLayer(this.huanTaiLandLayer)
                this.huanTaiLandLayer={}
            }
            
            // 移除流域底图、边界等
            this.removeBasinLayer();
            // 移除农田图层
            this.removeAgriParcelLayer();
            // 移除地块边界与交点叠加
            this.removeParcelBoundaryOverlay();
            // 移除日期时间轴的图层并停止播放
            this.stopParcelTimelinePlay();
            this.removeParcelTimelineLayer();
            // 取消框选截取
            this.clearParcelRoi();
        },

        addFeatureLayer:function(list){
            // console.log(list)
            console.log("获得信息",list)
        },


        changeHuanTaiColor:function(index){
            if(index===0){
                this.addHuanTaiColor(0)
            }else if(index===1){
                this.addHuanTaiColor(1)
            }
        },

        // 初始化地图
        initMap:function(){
            console.log("init map!!")
            const map = new OlMap({
                target: 'mapView',
                view: new View({
                    center: [(72 + 82) / 2, (42 + 50) / 2],
                    zoom: 6.5,
                    projection: "EPSG:4326",
                }),
            })
            this.map = markRaw(map)
            
            // 时空数据面板的悬停取值：自动查询全部已勾选图层。
            // 隐藏地图色块时仍然从已加载的数据源读值，提示内容不受显示状态影响。
            let hoverRequestId = 0
            let lastTemporalHoverPixel = null
            let lastTemporalHoverLayerKey = ''
            map.on('pointermove', event => {
                if(event.dragging) return
                const pointer = event.originalEvent
                const position = {left:pointer.clientX, top:pointer.clientY}
                const activeIds = Object.keys(this.temporalLayerInstances)
                if(!this.temporalPointerEnabled || !activeIds.length){
                    lastTemporalHoverPixel = null
                    lastTemporalHoverLayerKey = ''
                    this.temporalHoverInfo = null
                    map.getTargetElement().style.cursor = ''
                    return
                }
                map.getTargetElement().style.cursor = 'crosshair'
                if(this.temporalBasinFeatures.length && !this.temporalBasinFeatures.some(feature => feature.getGeometry()?.intersectsCoordinate?.(event.coordinate))){
                    lastTemporalHoverPixel = null
                    this.temporalHoverInfo = null
                    return
                }
                const layerKey = activeIds.slice().sort().join(',')
                if(lastTemporalHoverPixel && lastTemporalHoverLayerKey === layerKey){
                    const dx = event.pixel[0] - lastTemporalHoverPixel[0]
                    const dy = event.pixel[1] - lastTemporalHoverPixel[1]
                    if(dx * dx + dy * dy < 16){
                        if(this.temporalHoverInfo){
                            this.temporalHoverInfo = {
                                ...this.temporalHoverInfo,
                                ...position,
                                coordinateLabel:`${Number(event.coordinate[0]).toFixed(4)}°E, ${Number(event.coordinate[1]).toFixed(4)}°N`
                            }
                        }
                        return
                    }
                }
                lastTemporalHoverPixel = event.pixel.slice()
                lastTemporalHoverLayerKey = layerKey
                const requestId = ++hoverRequestId
                const featureByLayer = {}
                map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
                    const id = Object.keys(this.temporalLayerInstances).find(key => this.temporalLayerInstances[key] === layer)
                    if(id && activeIds.includes(id) && !featureByLayer[id]) featureByLayer[id] = feature
                }, {
                    hitTolerance: 5,
                    layerFilter: layer => activeIds.some(id => !['rivers','temperature','precipitation'].includes(id) && this.temporalLayerInstances[id] === layer)
                })
                // 河流不参加通用图层命中检测；只在3条命名河流中寻找距指针最近的一条。
                if(activeIds.includes('rivers') && this.temporalNamedRiverFeatures.length){
                    let closestRiver = null
                    let closestDistanceSquared = 49
                    this.temporalNamedRiverFeatures.forEach(feature => {
                        const closestCoordinate = feature.getGeometry()?.getClosestPoint?.(event.coordinate)
                        if(!closestCoordinate) return
                        const closestPixel = map.getPixelFromCoordinate(closestCoordinate)
                        const dx = closestPixel[0] - event.pixel[0]
                        const dy = closestPixel[1] - event.pixel[1]
                        const distanceSquared = dx * dx + dy * dy
                        if(distanceSquared <= closestDistanceSquared){
                            closestDistanceSquared = distanceSquared
                            closestRiver = feature
                        }
                    })
                    if(closestRiver) featureByLayer.rivers = closestRiver
                }
                // PNG仅负责显示；鼠标数值从精简规则网格读取，不加载数千个矢量多边形。
                activeIds.forEach(id => {
                    if(!['temperature','precipitation'].includes(id)) return
                    const layer = this.temporalLayerInstances[id]
                    const grid = layer?.get?.('temporalWeatherGrid')
                    if(!grid) return
                    const column = Math.round((event.coordinate[0] - grid.origin[0]) / grid.step[0])
                    const row = Math.round((event.coordinate[1] - grid.origin[1]) / grid.step[1])
                    if(column < 0 || row < 0 || column >= grid.width || row >= grid.height) return
                    const value = grid.values[row * grid.width + column]
                    if(value === null || value === undefined) return
                    featureByLayer[id] = {getProperties:() => ({value, units:grid.units, year:grid.year})}
                })
                // 隐藏地图色块时仍从已加载的矢量数据源读取鼠标位置对应的数据，保证提示值不受显示状态影响。
                activeIds.forEach(id => {
                    if(['rivers','temperature','precipitation'].includes(id)) return
                    const layer = this.temporalLayerInstances[id]
                    if(featureByLayer[id] || !layer || layer.getVisible()) return
                    const source = layer.getSource && layer.getSource()
                    const features = source && source.getFeaturesAtCoordinate
                        ? source.getFeaturesAtCoordinate(event.coordinate)
                        : []
                    if(features && features.length) featureByLayer[id] = features[0]
                })
                const items = []
                const labels = {
                    temperature:'气温', precipitation:'降水量', rivers:'河流', lakes:'湖泊',
                    boundaries:'行政边界',
                    country_border:'国家边界', province_border:'州界'
                }
                const translated = {
                    'Tien Shan':'天山山脉', 'Tian Shan':'天山山脉', 'Borohoro Mountains':'博罗科努山脉',
                    'Alataw Mountains':'阿拉套山脉', 'Tarbagatai Mountains':'塔尔巴哈台山脉',
                    'Altai Mountains':'阿尔泰山脉', 'Kazakh Uplands':'哈萨克丘陵',
                    'Lake Balkhash':'巴尔喀什湖', 'Balkhash':'巴尔喀什湖', 'Ili':'伊犁河', 'Ile':'伊犁河'
                }
                activeIds.forEach(id => {
                    const feature = featureByLayer[id]
                    if(!feature || id === 'elevation' || id === 'slope') return
                    const get = name => readFeatureProperty(feature.getProperties(), name)
                    if(id === 'temperature' || id === 'precipitation'){
                        const value = Number(get('value'))
                        const rawUnit = get('units') || (id === 'temperature' ? '°C' : 'mm')
                        const unit = rawUnit === 'degC' ? '°C' : rawUnit
                        const dataYear = get('year') || this.temporalYear
                        items.push({id, label:labels[id], value:`${Number.isFinite(value) ? value.toFixed(2) : '无数据'} ${unit} · ${dataYear}年`})
                        return
                    }
                    let name = get('name_zh') || get('NAME_ZH') || get('name_zht') || get('NAME_ZHT') || get('name_en') || get('NAME_EN') || get('name') || get('NAME') || get('label') || get('LABEL')
                    if(name && translated[name]) name = translated[name]
                    if(id === 'boundaries' || id === 'country_border' || id === 'province_border'){
                        const leftName = get('NAME_L') || get('ADM0_LEFT')
                        const rightName = get('NAME_R') || get('ADM0_RIGHT')
                        name = leftName && rightName ? `${leftName} / ${rightName}` : name || leftName || rightName || get('ADM0_NAME') || (id === 'province_border' ? '州界' : '国界')
                    }
                    if(id === 'rivers' && !name) return
                    items.push({id, label:labels[id], value:name || '名称未提供'})
                })
                const rasterIds = activeIds.filter(id => id === 'elevation' || id === 'slope')
                const [minX, minY, maxX, maxY] = TEMPORAL_RASTER_EXTENT
                const [x, y] = event.coordinate
                const inRasterBounds = x >= minX && x <= maxX && y >= minY && y <= maxY
                const rasterItemIds = rasterIds.filter(id => inRasterBounds)
                if(rasterItemIds.length){
                    rasterItemIds.forEach(id => items.push({id, label:id === 'elevation' ? '高程' : '坡度', value:'正在读取像元…'}))
                }
                if(!items.length){
                    this.temporalHoverInfo = null
                    return
                }
                const coordinateLabel = `${Number(event.coordinate[0]).toFixed(4)}°E, ${Number(event.coordinate[1]).toFixed(4)}°N`
                this.temporalHoverInfo = { ...position, title:'已勾选图层信息', coordinateLabel, items, layerId:items.map(item => item.id).join(',') }
                if(rasterItemIds.length){
                    Promise.all(rasterItemIds.map(id => this.getTemporalRasterValue(id, event.coordinate))).then(values => {
                        if(requestId !== hoverRequestId || !rasterItemIds.every(id => this.temporalLayerInstances[id])) return
                        const current = this.temporalHoverInfo
                        if(!current) return
                        const rasterValues = Object.fromEntries(rasterItemIds.map((id, index) => [id, values[index]]))
                        current.items = current.items.map(item => {
                            if(!Object.prototype.hasOwnProperty.call(rasterValues, item.id)) return item
                            const value = rasterValues[item.id]
                            return { ...item, value:value === null ? '无有效像元' : item.id === 'elevation' ? `${value.toFixed(1)} 米` : `${value.toFixed(2)}°` }
                        })
                    }).catch(error => {
                        if(requestId !== hoverRequestId || !this.temporalHoverInfo) return
                        console.warn('读取地形像元失败', error)
                        this.temporalHoverInfo.items = this.temporalHoverInfo.items.map(item => rasterItemIds.includes(item.id) ? { ...item, value:'数值读取失败' } : item)
                    })
                }
            })
            map.getTargetElement().addEventListener('pointerleave', () => {
                lastTemporalHoverPixel = null
                lastTemporalHoverLayerKey = ''
                hoverRequestId += 1
                this.temporalHoverInfo = null
                map.getTargetElement().style.cursor = ''
            })
        },
        compare:function(map){
            console.log(map===this.map)
        },
    },

    getters:{

    }
})
export default useMapStore
