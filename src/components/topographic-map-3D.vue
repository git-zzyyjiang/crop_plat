<template>
  <div class="map-wrapper">
    <div id="cesium-container" ref="cesiumContainerRef" class="cesium-view"></div>
    
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner">3D 地图引擎初始化中...</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, shallowRef, markRaw, ref } from 'vue';
import useMapStore from '@/stores/map';
// import { storeToRefs } from 'pinia';

const isLoading = ref(true); // 控制加载动画的显示
let viewer = null;
const viewerInstance = shallowRef(null);
const mapStore = useMapStore();

// 用于全局存储编译好的遮罩实例
let globalMaskPrimitive = null; 

defineExpose({
  viewer: viewerInstance
});

onMounted(() => {
  // 使用 setTimeout 宏任务代替 requestAnimationFrame
  // 给 Vue 50ms 的时间去渲染 DOM 和 Loading 动画，避免白屏卡顿
  setTimeout(async () => {
    if (!window.Cesium) return console.error('Cesium 未加载');
    const Cesium = window.Cesium;
    
    // 建议生产环境中配置专属 Ion Token
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxZDZmZTRjZi0xYjM1LTQ2NTctYTgzMy1kZWM3YjlhMGFmZmQiLCJpZCI6NDI3OTQzLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3NzgwNjg1NDJ9.ZsSc6ecX4wca79hiIUgNGrnRcm2hgwkoRQnpJtaiO7E';

    /* ==========================================
       1. 核心视图初始化与参数配置
       ========================================== */
    // 【核心优化】：使用 markRaw 彻底阻断 Vue 的响应式劫持，并关闭所有非必要控件
    viewer = markRaw(new Cesium.Viewer('cesium-container', {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false, 
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      creditContainer: document.createElement('div'), // 阻止版权信息在页面生成
      terrainExaggeration: 3.0 
    }));
    
    viewerInstance.value = viewer;

    // 【核心优化】：限制高分屏的初始渲染压力
    const supportsImageRenderingPixelated = viewer.cesiumWidget._supportsImageRenderingPixelated;
    if (supportsImageRenderingPixelated) {
      let vtxResolution = window.devicePixelRatio || 1.0;
      viewer.resolutionScale = Math.min(1.2 / vtxResolution, 1.0); 
    }

    viewer.imageryLayers.removeAll();

    // 动态地形夸张与场景配置
    if (viewer.scene.verticalExaggeration !== undefined) {
      viewer.scene.verticalExaggeration = 5; 
    }
    
    // 开启深度测试，防止透视地球背面
    viewer.scene.globe.depthTestAgainstTerrain = true;
    
    // 关闭全局光照，大幅节省 GPU 计算资源
    viewer.scene.globe.enableLighting = false; 
    viewer.scene.globe.show = true;
    
    // 放大最大视距，允许用户看全貌
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 12000000; 
    
    // 锁定虚拟时间，确保光线固定
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date('2024-06-21T06:00:00Z'));
    viewer.clock.shouldAnimate = false;

    // 取消原生右键事件
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    /* ==========================================
       2. 加载基础地图与地形资源
       ========================================== */
    try {
      const terrainProvider = await Cesium.createWorldTerrainAsync({
        requestWaterMask: false,     // 关闭水面掩膜
        requestVertexNormals: false  // 关闭顶点法线请求
      });
      viewer.terrainProvider = terrainProvider;

      const arcgisProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer',
        { enablePickFeatures: false }
      );
      viewer.imageryLayers.addImageryProvider(arcgisProvider);
    } catch (error) {
      console.error('地图基础资源加载异常:', error);
    }

    /* ==========================================
       3. 核心资源加载完毕，关闭 Loading，执行飞行和渲染
       ========================================== */
    isLoading.value = false;
    initScene(Cesium);
  }, 50); 
});

/**
 * 初始化场景核心动作
 */
async function initScene(Cesium) {
  viewer.scene.globe.maximumScreenSpaceError = 2.0; // 飞行期间保持常规渲染精度

  // 任务A：触发飞行，但不阻塞主线程，让它在后台飞
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(81.2, 38.9, 420000),
    orientation: {
      heading: Cesium.Math.toRadians(-10),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0
    },
    duration: 2.0,
    complete: () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.scene.globe.maximumScreenSpaceError = 1.5; // 飞行结束后提高地形与影像精度
        
        // 飞行结束后，把分辨率恢复到接近屏幕原生状态
        const vtxResolution = window.devicePixelRatio || 1.0;
        viewer.resolutionScale = Math.min(1.5 / vtxResolution, 1.0);

        // 飞行结束时，如果遮罩已经在 Worker 中偷偷编译好了，直接让它现身
        if (globalMaskPrimitive) {
          globalMaskPrimitive.show = true;
        }
      }
    }
  });

  // 任务B：在相机飞行的这 2 秒内，主线程抓紧解析流域的 GeoJSON
  const [basinHoles] = await Promise.all([
    parseBasinHoles(Cesium),
    loadLabelOnlyLayer(Cesium)
  ]).catch(err => {
    console.warn('矢量数据并行加载异常:', err);
    return [[]]; 
  });

  // 数据解析完后，立刻创建遮罩丢给底层 Web Worker 编译，但初始设为隐藏状态
  if (basinHoles && basinHoles.length > 0) {
    globalMaskPrimitive = createExternalMask(Cesium, basinHoles);
  }
}

/**
 * 后台解析流域边界数据
 */
async function parseBasinHoles(Cesium) {
  try {
    const basinBoundaryUrl = mapStore.basinBoundaryUrl;
    if (!basinBoundaryUrl) return [];
    
    const dataSource = await Cesium.GeoJsonDataSource.load(basinBoundaryUrl, {
      clampToGround: true 
    });
    
    const entities = dataSource.entities.values;
    const holes = []; 
    for (let i = 0; i < entities.length; i++) {
      if (entities[i].polygon) {
        holes.push(entities[i].polygon.hierarchy.getValue(Cesium.JulianDate.now()));
      }
    }
    return holes;
  } catch (error) {
    console.error('解析流域边界失败:', error);
    return [];
  }
}

/**
 * 加载纯文字标签图层
 */
async function loadLabelOnlyLayer(Cesium) {
  try {
    const dataSource = await Cesium.GeoJsonDataSource.load('/data/balkhash-labels.geojson', {
      clampToGround: true 
    });

    const entities = dataSource.entities.values;
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const featureName = entity.properties['name:zh']?.getValue() || entity.properties['name']?.getValue();

      if (featureName) {
        if (entity.billboard) entity.billboard.show = false;
        if (entity.point) entity.point.show = false;

        entity.label = {
          text: featureName,
          font: 'bold 0.8rem 微软雅黑, sans-serif',
          fillColor: Cesium.Color.BLACK,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 1.5,
          outlineColor: Cesium.Color.WHITE, 
          pixelOffset: new Cesium.Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000)
        };
      } else {
        entity.show = false;
      }
    }
    viewer.dataSources.add(dataSource);
  } catch (error) {
    console.error('标签数据加载失败:', error);
  }
}

/**
 * 创建“大陆级”反向遮罩，完美避开极点与国际日期变更线的计算崩溃
 */
function createExternalMask(Cesium, basinHoles) {
  const existingMask = viewer.scene.primitives._primitives.find(
    p => p.geometryInstances && p.geometryInstances.id === 'continental-mask-primitive'
  );
  if (existingMask) viewer.scene.primitives.remove(existingMask);

  // 设定亚欧大陆级超大边界 (经度 0~150，纬度 0~80)
  const minLon = 0, maxLon = 150;
  const minLat = 0, maxLat = 80;

  const maskPositions = Cesium.Cartesian3.fromDegreesArray([
    minLon, minLat,
    maxLon, minLat,
    maxLon, maxLat,
    minLon, maxLat
  ]);

  const polygonGeometry = new Cesium.PolygonGeometry({
    polygonHierarchy: new Cesium.PolygonHierarchy(maskPositions, basinHoles),
    arcType: Cesium.ArcType.RHUMB 
  });

  const geometryInstance = new Cesium.GeometryInstance({
    geometry: polygonGeometry,
    id: 'continental-mask-primitive',
    attributes: {
      color: Cesium.ColorGeometryInstanceAttribute.fromColor(
        Cesium.Color.BLACK.withAlpha(0.65)
      )
    }
  });

  const maskPrimitive = new Cesium.GroundPrimitive({
    geometryInstances: geometryInstance,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: true
    }),
    asynchronous: true, // 在 Web Worker 中异步编译，不阻塞主线程
    show: false         // 刚创建时先隐藏，防止突然闪现
  });

  viewer.scene.primitives.add(maskPrimitive);
  
  return maskPrimitive; // 将实例返回给外层，以便后续控制显示
}

// 释放实例
onUnmounted(() => {
  if (viewer && !viewer.isDestroyed()) {
    viewer.destroy();
    viewer = null;
    viewerInstance.value = null;
  }
});
</script>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
}

.cesium-view {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

/* Loading 遮罩样式 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(15, 23, 42, 0.9); /* 深色背景掩盖渲染黑屏 */
  display: flex;
  justify-content: center;
  align-items: center;
  color: #fff;
  z-index: 999;
  font-size: 1.2rem;
  font-family: sans-serif;
}

.spinner {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

:deep(.cesium-viewer-bottom),
:deep(.cesium-viewer-cesiumWidgetCreditsContainer),
:deep(.cesium-button) {
  display: none !important;
}
</style>