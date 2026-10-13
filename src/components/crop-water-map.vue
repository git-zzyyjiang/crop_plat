<template>
  <div ref="cesiumRef" class="map-container"></div>
  <div v-if="mapLoading || mapError" class="water-map-status float-panel" role="status">{{ mapLoading ? '正在加载三维地块…' : mapError }}<button v-if="mapError" type="button" @click="retryFieldData">重试</button></div>
  <div class="season-environment-overlay" :style="seasonEnvironmentStyle"></div>
  <div class="sun-direction-overlay" :style="sunDirectionOverlayStyle"></div>
</template>

<script setup>
/* global defineEmits, defineExpose */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Feature from "ol/Feature";
import MVT from "ol/format/MVT";
import { createXYZ } from "ol/tilegrid";
import useMapStore from "@/stores/map";
import { getWaterSeasonYear } from "@/utils/water-timeline";
import { getCropColor } from "@/utils/crop-colors";

const Cesium = window.Cesium;
const store = useMapStore();
const {
  cropWaterShowCylinder,
  cropWaterActiveMetric,
  cropWaterActiveDate,
  cropWaterActiveCrop,
  cropWaterSummaryData,
  cropWaterViewportCrop,
  cropWaterFocusCrop,
  cropWaterFocusRequestId,
  cropWaterIsPlaying,
  cropWaterLockViewport,
} = storeToRefs(store);

const props = defineProps({
  mode: { type: String, default: "crop" },
  changeMonth: { type: String, default: "2024-01" },
  changeFocusRequestId: { type: Number, default: 0 },
  changeReady: Boolean,
  changeResultVersion: { type: String, default: "" },
});
const emit = defineEmits(["select-field", "change-stats"]);

const cesiumRef = ref(null);
const mapLoading = ref(true);
const mapError = ref('');
let metadataController = null;
let changeFocusController = null;
let changeFocusRequestSeq = 0;
let pendingChangeFocus = false;
const changeFocusCache = new Map();
const activeCrop = computed(() => cropWaterActiveCrop.value);
const activeMapDate = computed(() => props.mode === "change"
  ? `${props.changeMonth || "2024-01"}-01`
  : cropWaterActiveDate.value);

const sunDirectionOverlayStyle = computed(() => {
  const date = new Date(activeMapDate.value);
  const yearStart = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Number.isFinite(date.getTime())
    ? Math.floor((date.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24))
    : 1;
  const seasonalAngle = 118 + Math.sin(((dayOfYear - 80) / 365) * Math.PI * 2) * 42;

  return {
    background: `linear-gradient(${seasonalAngle.toFixed(
      1
    )}deg, rgba(255, 232, 171, 0.16), rgba(255, 255, 255, 0.025) 42%, rgba(13, 31, 43, 0.12))`,
  };
});
const seasonEnvironmentStyle = computed(() => {
  const date = new Date(activeMapDate.value);
  const month = Number.isFinite(date.getTime()) ? date.getMonth() + 1 : 1;
  const cropOpacityBoost = activeCrop.value === "vegetables" ? 0.04 : 0;

  if (month >= 3 && month <= 5) {
    return {
      background:
        "linear-gradient(180deg, rgba(178, 235, 194, 0.12), rgba(255, 255, 255, 0.02))",
      opacity: 0.75 + cropOpacityBoost,
    };
  }

  if (month >= 6 && month <= 8) {
    return {
      background:
        "linear-gradient(180deg, rgba(255, 194, 94, 0.16), rgba(255, 112, 67, 0.08))",
      opacity: 0.85 + cropOpacityBoost,
    };
  }

  if (month >= 9 && month <= 11) {
    return {
      background:
        "linear-gradient(180deg, rgba(255, 193, 7, 0.12), rgba(141, 110, 99, 0.08))",
      opacity: 0.7 + cropOpacityBoost,
    };
  }

  return {
    background:
      "linear-gradient(180deg, rgba(120, 170, 210, 0.12), rgba(20, 40, 65, 0.12))",
    opacity: 0.8 + cropOpacityBoost,
  };
});
const cropWaterDisplayLayers = [
  {
    name: "agri-agent:water-wheat-shp",
    crop: "winterWheat",
    style: "agri-agent:wheat-style",
    aliases: ["water-wheat-shp", "split_1", "wheat"],
  },
  {
    name: "agri-agent:water-corn-shp",
    crop: "springWheat",
    style: "agri-agent:corn-style",
    aliases: ["water-corn-shp", "split_2", "corn"],
  },
  {
    name: "agri-agent:water-vegetable-shp",
    crop: "cotton",
    style: "agri-agent:vegetable-style",
    aliases: ["water-vegetable-shp", "split_3", "vegetable"],
  },
];
let activeCropWaterDisplayLayers = cropWaterDisplayLayers.map((layer) => ({ ...layer }));

const workspace = "agri-agent";
const fallbackCropWaterExtent = {
  west: 80.2,
  south: 42.2,
  east: 86.4,
  north: 45.6,
};
const geoserverBase =
  process.env.VUE_APP_CROP_GEOSERVER_BASE ||
  `${(process.env.VUE_APP_GEOSERVER_URL || "http://localhost:8080").replace(/\/$/, "")}/geoserver`;
const waterApiBase =
  process.env.VUE_APP_CROP_WATER_API_BASE || "http://localhost:5000";
const supportedCropCodes = new Set([1, 2, 3, 4, 5, 8, 9]);
const cropCodeByKey = {
  winterWheat: 1,
  springWheat: 2,
  cotton: 3,
  corn: 4,
  rice: 5,
  winterWheatCorn: 8,
  winterWheatRice: 9,
};
const cropKeyByCode = Object.fromEntries(
  Object.entries(cropCodeByKey).map(([key, code]) => [code, key])
);
const changeColorByClass = {
  increase: "#D85B61",
  decrease: "#4D8FDB",
  unchanged: "#AAB4BE",
};
const mvtFormat = new MVT({
  layers: ["fields"],
  idProperty: "field_id",
  featureClass: Feature,
});
const changeMvtFormat = new MVT({
  layers: ["field_changes"],
  idProperty: "field_id",
  featureClass: Feature,
});
const mvtTileGrid = createXYZ({ minZoom: 0, maxZoom: 18, tileSize: 256 });












let viewer = null;
let cachedGeojson = null;
let cylinderEntities = [];
let clickHandler = null;
let selectedHighlight = null;
let cameraMoveEndRemove = null;
let refreshTimer = null;
let animationFrameId = null;
let animatedCylinderItems = [];
let visibleLabelEntities = [];


let currentWaterDataMap = new Map();
let hasInitializedCylinderLayer = false;
let isUnmounted = false;

let cylinderRefreshTimer = null;
let lastOrbitCylinderRefreshTime = 0;
let cylinderRequestSeq = 0;
let demoCylinderItems = [];
let demoCylinderAnimationId = null;
let selectedWaterFieldId = null;
let labelLayoutFrame = 0;
let cropWaterImageryLayers = [];
let cropWaterLayerExtents = new Map();
let cropWaterDenseFocusCenters = new Map();
let seasonalOrbitFrameId = null;
let seasonalOrbitTarget = null;
let seasonalOrbitCurrent = null;
let seasonalOrbitRoute = [];
let seasonalOrbitRouteIndex = 0;
let seasonalOrbitHeading = 0;
let seasonalOrbitPitchCurrent = null;
let seasonalOrbitRollCurrent = 0;
let seasonalOrbitHeight = null;
let seasonalOrbitLastTime = 0;
let mvtFieldDataSource = null;
let basinBoundaryDataSource = null;
let mvtMetadata = null;
let mvtReloadTimer = null;
let mvtRequestSeq = 0;
let mvtPendingRequests = new Map();
let lastMvtAutoFocusedCrop = null;
let currentMvtCropFeatures = [];
const cylinderScaleFallback = 12.86;
const cylinderScaleStorageKey = "cropWaterDailyScaleV1";
let currentCylinderVisualMax = cylinderScaleFallback;
let cylinderScaleController = null;
let lastCylinderAutoFocusKey = null;
const mvtTileCache = new Map();
const cylinderCenterCache = new WeakMap();
const fieldDailyCache = new Map();
const fieldDailyPendingCache = new Map();
let loadedMvtYear = null;
let loadedMvtMode = null;

const animatedCylinderSlices = 40;

const cylinderWfsSrs = "EPSG:4326";


const demoMaxCylinderHeight = 520;
const zeroValueThreshold = 0.01;
const labelValueThreshold = zeroValueThreshold;
const cylinderTransitionMs = 900;

const cropWaterTimelineStartDate = "2024-01-01";



const cylinderVisualRadius = 46;

const maxNearbyCylinders = 24;
const cylinderDataConcurrency = 12;
const cylinderCameraHeightLimit = 6000;
const duplicateCylinderCenterDistanceMeters = 12;
const seasonalFocusCameraHeight = 2000;
const seasonalMoveSpeed = 0.0009;
const seasonalOrbitHeadingSpeed = 0;
const orbitCylinderRefreshMs = 7000;

onMounted(async () => {
  if (!Cesium) {
    mapError.value = "三维引擎未加载，请刷新页面";
    mapLoading.value = false;
    return;
  }

  try {
    loadCylinderScale();
    viewer = await initCesium();
    if (isUnmounted) return;

    await initializeBasinBoundary();
    if (isUnmounted) return;

    try { await initializeMvtFieldLayer(); } catch (error) {
      if (isUnmounted) return;
      mapError.value = "地块数据暂时不可用，请检查耗水服务连接";
      flyToFallbackCropExtent();
      console.warn("耗水地块加载失败", error);
    }
    if (isUnmounted) return;

    updateSeasonalVisualization();
    if (cropWaterShowCylinder.value) {
      await addCylinderLayer();
    }
    if (isUnmounted) return;
    enableClickInfo();
    enableCameraLabelRefresh();
    updateViewportCropFromCamera();
    if (cropWaterFocusCrop.value) {
      focusCropArea(cropWaterFocusCrop.value);
    }
    viewer.scene.requestRender();
  } catch (error) {
    if (!isUnmounted) mapError.value = "三维视图初始化失败，请刷新页面";
    console.error("Crop water map failed to initialize.", error);
  } finally { mapLoading.value = false; }
});

watch(
  () => [cropWaterShowCylinder.value, cropWaterActiveMetric.value],
  () => {
    if (!viewer) return;

    if (cropWaterShowCylinder.value) {
      currentWaterDataMap = new Map();
      addCylinderLayer();
    } else {
      hasInitializedCylinderLayer = false;
      lastCylinderAutoFocusKey = null;
      removeCylinderLayer();
    }
  }
);

watch(
  () => [cropWaterActiveCrop.value, activeMapDate.value],
  async ([crop], previous = []) => {
    updateSeasonalVisualization();

    const previousCrop = previous[0];
    const previousDate = previous[1] || "";
    const canAnimateCylinderDateChange =
      props.mode === "crop" &&
      cropWaterShowCylinder.value &&
      animatedCylinderItems.length > 0 &&
      crop === previousCrop &&
      activeMapDate.value !== previousDate &&
      activeMapDate.value.slice(0, 4) === previousDate.slice(0, 4);

    if (cropWaterShowCylinder.value) {
      currentWaterDataMap = new Map();
      if (!canAnimateCylinderDateChange) removeCylinderLayer();
    }

    if (props.mode === "change") {
      const requestedYear = getActiveMvtYear();
      if (requestedYear !== loadedMvtYear) {
        if (loadedMvtMode === "change" && mvtMetadata) {
          loadedMvtYear = requestedYear;
          mvtRequestSeq++;
          clearMvtPendingRequests();
          scheduleMvtFieldReload(0);
          return;
        }
        try {
          await initializeMvtFieldLayer();
        } catch (error) {
          if (!isUnmounted && error.name !== "AbortError") mapError.value = "地块变化数据暂时不可用，请检查耗水服务连接";
        }
      } else {
        scheduleMvtFieldReload(0);
      }
      return;
    }

    if (cropWaterActiveDate.value.slice(0, 4) !== (previous[1] || "").slice(0, 4)) {
      const requestedYear = cropWaterActiveDate.value.slice(0, 4);
      const cameraSnapshot = captureCameraView();
      try {
        await initializeMvtFieldLayer();
      } catch (error) {
        if (!isUnmounted && error.name !== "AbortError") mapError.value = "地块数据暂时不可用，请检查耗水服务连接";
      } finally {
        if (requestedYear === cropWaterActiveDate.value.slice(0, 4)) {
          restoreCameraView(cameraSnapshot);
        }
      }
    } else if (crop !== previousCrop) {
      lastMvtAutoFocusedCrop = null;
      lastCylinderAutoFocusKey = null;
      if (crop) {
        focusMvtCropFromOverview(crop);
      } else {
        mvtRequestSeq++;
        clearMvtPendingRequests();
        mvtFieldDataSource?.entities.removeAll();
        currentMvtCropFeatures = [];
        removeCylinderLayer();
        viewer.scene.requestRender();
      }
    } else if (cropWaterShowCylinder.value) {
      if (canAnimateCylinderDateChange) await updateCylinderLayerForDate();
      else addCylinderLayer();
    }
  }
);

watch(
  () => props.changeFocusRequestId,
  () => {
    if (props.mode !== "change") return;
    pendingChangeFocus = true;
    if (!viewer || !mvtMetadata || loadedMvtMode !== "change") return;
    focusChangeDenseArea().then((focused) => {
      if (focused) pendingChangeFocus = false;
    });
  }
);

function captureCameraView() {
  if (!viewer?.camera) return null;

  return {
    destination: Cesium.Cartesian3.clone(viewer.camera.positionWC),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll,
    },
  };
}

function restoreCameraView(snapshot) {
  if (!viewer?.camera || !snapshot) return;

  viewer.camera.setView(snapshot);
  viewer.scene.requestRender();
}

watch(
  () => props.mode,
  () => {
    if (!viewer) return;
    cropWaterShowCylinder.value = false;
    metadataController?.abort();
    clearMvtPendingRequests();
    mvtRequestSeq++;
    if (mvtFieldDataSource) {
      viewer.dataSources.remove(mvtFieldDataSource, true);
      mvtFieldDataSource = null;
    }
    loadedMvtYear = null;
    loadedMvtMode = null;
    mvtMetadata = null;
    currentMvtCropFeatures = [];
    clearSelectedField();
    emit("change-stats", null);
    if (props.mode === "change") {
      if (!props.changeReady) {
        mapLoading.value = true;
        viewer.scene.requestRender();
        return;
      }
      initializeMvtFieldLayer().catch((error) => {
        if (!isUnmounted && error.name !== "AbortError") {
          mapError.value = "地块变化数据暂时不可用，请检查耗水服务连接";
        }
      });
    } else {
      loadCylinderScale();
      initializeMvtFieldLayer().catch((error) => {
        if (!isUnmounted && error.name !== "AbortError") {
          mapError.value = "地块数据暂时不可用，请检查耗水服务连接";
        }
      });
    }
    viewer.scene.requestRender();
  }
);

watch(
  () => [props.changeReady, props.changeResultVersion],
  async ([ready, version], previous = []) => {
    if (props.mode !== "change" || !viewer || !ready) return;
    if (version && version !== previous[1]) {
      mvtTileCache.clear();
      changeFocusCache.clear();
    }
    pendingChangeFocus = true;
    mapLoading.value = true;
    try {
      await initializeMvtFieldLayer();
    } catch (error) {
      if (!isUnmounted && error?.name !== "AbortError") {
        mapError.value = "地块变化数据暂时不可用，请检查耗水服务连接";
      }
    } finally {
      if (!isUnmounted) mapLoading.value = false;
    }
  }
);

watch(
  () => cropWaterSummaryData.value,
  () => {
    if (viewer && cropWaterShowCylinder.value && currentMvtCropFeatures.length) {
      addCylinderLayer();
    }
  }
);

watch(
  () => cropWaterIsPlaying.value,
  () => {
    if (!viewer) return;

    console.info("[crop-water-map] playback changed", {
      isPlaying: cropWaterIsPlaying.value,
      locked: cropWaterLockViewport.value,
    });

    if (cropWaterIsPlaying.value) {
      if (cropWaterLockViewport.value) {
        console.info("[crop-water-map] playback requested while locked, unlocking viewport");
        cropWaterLockViewport.value = false;
      }

      updateSeasonalVisualization();
      if (!cropWaterLockViewport.value) {
        console.info("[crop-water-map] starting orbit from playback");
        startSeasonalOrbitFromCurrentView();
      }

      // 不启动自动相机巡航，保持当前手动调整的位置
      stopSeasonalOrbit();

      if (cropWaterShowCylinder.value) {
        startDemoCylinderAnimation();
      }
    } else {
      stopDemoCylinderAnimation();
      stopSeasonalOrbit();
    }
  }
);
watch(
  () => cropWaterLockViewport.value,
  () => {
    if (!viewer) return;

    console.info("[crop-water-map] viewport lock changed", {
      locked: cropWaterLockViewport.value,
      isPlaying: cropWaterIsPlaying.value,
    });

    if (cropWaterLockViewport.value) {
      stopSeasonalOrbit();
    } else {
      cropWaterIsPlaying.value = true;
      console.info("[crop-water-map] starting orbit from unlock button");
      startSeasonalOrbitFromCurrentView();
    }
  }
);

watch(
  () => cropWaterFocusRequestId.value,
  () => {
    if (!viewer || !cropWaterFocusCrop.value) return;

    focusCropArea(cropWaterFocusCrop.value);
  }
);

onBeforeUnmount(() => {
  isUnmounted = true;
  metadataController?.abort();
  changeFocusController?.abort();
  cylinderScaleController?.abort();


  if (cylinderRefreshTimer) {
    clearTimeout(cylinderRefreshTimer);
    cylinderRefreshTimer = null;
  }
  if (mvtReloadTimer) {
    clearTimeout(mvtReloadTimer);
    mvtReloadTimer = null;
  }
  clearMvtPendingRequests();
  mvtTileCache.clear();
  if (viewer && mvtFieldDataSource) {
    viewer.dataSources.remove(mvtFieldDataSource, true);
    mvtFieldDataSource = null;
  }
  if (viewer && basinBoundaryDataSource) {
    viewer.dataSources.remove(basinBoundaryDataSource, true);
    basinBoundaryDataSource = null;
  }
  removeCylinderLayer();
  stopSeasonalOrbit();
  disableCameraLabelRefresh();

  if (clickHandler) {
    clickHandler.destroy();
    clickHandler = null;
  }

  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
});

async function initCesium() {
  const viewerInstance = new Cesium.Viewer(cesiumRef.value, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer: false,
    skyBox: false,
    skyAtmosphere: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });

  viewer = viewerInstance;
  flyToFallbackCropExtent();
  viewerInstance.scene.globe.depthTestAgainstTerrain = false;

  viewerInstance.scene.globe.enableLighting = true;
  viewerInstance.shadows = false;
  viewerInstance.scene.light = new Cesium.SunLight();

  viewerInstance.scene.postProcessStages.fxaa.enabled = true;
  viewerInstance.scene.requestRenderMode = true;
  viewerInstance.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  viewerInstance.imageryLayers.removeAll();

  let imageryTimeout;
  try {
    const arcgisProvider =
      await Promise.race([Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
      ), new Promise((_, reject) => { imageryTimeout = setTimeout(() => reject(new Error("底图连接超时")), 8000); })]);
    if (isUnmounted) { clearTimeout(imageryTimeout); return viewerInstance; }

    viewerInstance.imageryLayers.addImageryProvider(arcgisProvider);
  } catch (error) {
    if (isUnmounted) return viewerInstance;
    console.warn("ArcGIS imagery failed to load.", error);

    viewerInstance.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
      })
    );
  }

  clearTimeout(imageryTimeout);
  return viewerInstance;
}

async function initializeBasinBoundary() {
  if (!viewer || basinBoundaryDataSource || isUnmounted) return;

  try {
    const source = await Cesium.GeoJsonDataSource.load(
      "/data/temporal/basin_boundary.geojson",
      {
        stroke: Cesium.Color.RED.withAlpha(0.9),
        strokeWidth: 5,
        fill: Cesium.Color.TRANSPARENT,
        clampToGround: false,
      }
    );
    if (isUnmounted || !viewer) return;

    basinBoundaryDataSource = source;
    await viewer.dataSources.add(source);
    if (!cropWaterActiveCrop.value) {
      await viewer.flyTo(source, {
        duration: 0.6,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(-8),
          Cesium.Math.toRadians(-40),
          0
        ),
      });
    }
  } catch (error) {
    console.warn("研究区边界加载失败", error);
  }
}

function getActiveMvtTemporalKey() {
  return props.mode === "change"
    ? (props.changeMonth || "2024-01")
    : cropWaterActiveDate.value;
}

function getChangeCacheKey(month) {
  return `${props.changeResultVersion || "unversioned"}:${month}`;
}

function getActiveMvtYear() {
  const temporalKey = getActiveMvtTemporalKey();
  return props.mode === "change"
    ? Number(temporalKey.slice(0, 4))
    : getWaterSeasonYear(temporalKey);
}

async function initializeMvtFieldLayer() {
  if (!viewer) return;

  const mode = props.mode;
  if (mode === "change" && !props.changeReady) return;
  const year = getActiveMvtYear();
  // 年份或模块变化时先移除旧数据源，避免年度作物颜色与变化分类颜色叠加。
  if (loadedMvtYear !== year || loadedMvtMode !== mode) {
    loadedMvtYear = null;
    loadedMvtMode = null;
    mvtMetadata = null;
    mvtRequestSeq++;
    clearMvtPendingRequests();
    if (mvtFieldDataSource) {
      viewer.dataSources.remove(mvtFieldDataSource, true);
      mvtFieldDataSource = null;
    }
    currentMvtCropFeatures = [];
    removeCylinderLayer();
    viewer.scene.requestRender();
  }
  if (![2024, 2025, 2026].includes(year)) {
    metadataController?.abort();
    mapError.value = "";
    return;
  }
  const metadataUrl = mode === "change"
    ? `${waterApiBase.replace(/\/$/, "")}/api/water/change`
    : `${waterApiBase.replace(/\/$/, "")}/api/water/fields/metadata?year=${year}`;
  metadataController?.abort();
  const controller = new AbortController();
  metadataController = controller;
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;
  try { response = await fetch(metadataUrl, { cache: "no-store", signal: controller.signal }); }
  finally { clearTimeout(timeout); }
  if (isUnmounted || controller !== metadataController || mode !== props.mode || year !== getActiveMvtYear()) return;

  if (!response.ok) {
    throw new Error(`地块元数据请求失败：${response.status}`);
  }

  const metadata = await response.json();
  if (controller !== metadataController || mode !== props.mode || year !== getActiveMvtYear()) return;
  if (!metadata.available) throw new Error(`地块数据未提供：${year}`);
  const expectedLayerName = mode === "change" ? "field_changes" : "fields";
  if (metadata?.layer_name !== expectedLayerName) {
    throw new Error(`地块矢量瓦片的 source-layer 必须为 ${expectedLayerName}`);
  }

  mvtRequestSeq++;
  clearMvtPendingRequests();
  mvtMetadata = metadata;
  loadedMvtYear = year;
  loadedMvtMode = mode;
  mapError.value = "";
  if (mvtFieldDataSource) viewer.dataSources.remove(mvtFieldDataSource, true);
  mvtFieldDataSource = new Cesium.CustomDataSource("crop-water-mvt-fields");
  await viewer.dataSources.add(mvtFieldDataSource);

  // 仅替换年度数据源，不重置相机。时间轴跨年时保持用户当前比例尺和位置。

  if (!cropWaterActiveCrop.value && props.mode !== "change") {
    mvtFieldDataSource.entities.removeAll();
    currentMvtCropFeatures = [];
    viewer.scene.requestRender();
    return;
  }

  if (mode === "change" && pendingChangeFocus) {
    const focused = await focusChangeDenseArea();
    if (focused) {
      pendingChangeFocus = false;
      return;
    }
  }
  await reloadVisibleMvtFields();
}

async function retryFieldData() {
  if (!viewer || mapLoading.value || isUnmounted) return;
  mapLoading.value = true;
  mapError.value = "";
  try { await initializeMvtFieldLayer(); }
  catch (error) { if (!isUnmounted) mapError.value = "地块数据暂时不可用，请检查耗水服务连接"; }
  finally { mapLoading.value = false; }
}

function scheduleMvtFieldReload(delay = 180) {
  if (!viewer || !mvtFieldDataSource) return;
  if (mvtReloadTimer) clearTimeout(mvtReloadTimer);

  mvtReloadTimer = setTimeout(() => {
    mvtReloadTimer = null;
    reloadVisibleMvtFields();
  }, delay);
}

async function reloadVisibleMvtFields() {
  if (!viewer || !mvtFieldDataSource || !mvtMetadata || isUnmounted) return;

  const mode = props.mode;
  const year = loadedMvtYear;
  const activeDate = getActiveMvtTemporalKey();

  if (!cropWaterActiveCrop.value && props.mode !== "change") {
    mvtRequestSeq++;
    clearMvtPendingRequests();
    mvtFieldDataSource.entities.removeAll();
    currentMvtCropFeatures = [];
    removeCylinderLayer();
    viewer.scene.requestRender();
    return [];
  }

  if (loadedMvtMode !== mode || year !== getActiveMvtYear()) {
    mvtRequestSeq++; clearMvtPendingRequests();
    mvtFieldDataSource.entities.removeAll(); currentMvtCropFeatures = []; removeCylinderLayer();
    viewer.scene.requestRender(); return [];
  }
  const rectangle = viewer.camera.computeViewRectangle();
  if (!rectangle) return;

  const requestSeq = ++mvtRequestSeq;
  clearMvtPendingRequests();

  const bbox = clipBboxToMvtBounds(rectangleToBbox(rectangle));
  if (!bbox) {
    mvtFieldDataSource.entities.removeAll();
    currentMvtCropFeatures = [];
    viewer.scene.requestRender();
    return [];
  }

  const { zoom, tiles } = getVisibleMvtTiles(bbox);
  const activeCode = cropCodeByKey[cropWaterActiveCrop.value] ?? null;
  console.info("[crop-water-map] MVT 请求", JSON.stringify({
    mode: props.mode,
    year: loadedMvtYear,
    date: activeDate,
    zoom,
    tiles: tiles.length,
  }));
  const results = await Promise.allSettled(
    tiles.map((tile) => loadMvtTileBuffer(tile, requestSeq, mode, year, activeDate))
  );

  if (requestSeq !== mvtRequestSeq || isUnmounted || mode !== props.mode || year !== loadedMvtYear || activeDate !== getActiveMvtTemporalKey()) return;

  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    console.warn(
      "[crop-water-map] MVT 瓦片加载失败",
      JSON.stringify(rejected.map((result) => result.reason?.message || String(result.reason)))
    );
  }

  const tileFeatures = [];
  let decodedCount = 0;
  const codes = new Set();
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status !== "fulfilled" || !result.value) continue;
    const decoded = decodeMvtTileFeatures(tiles[index], result.value, activeCode, mode);
    decodedCount += decoded.total;
    decoded.codes.forEach((code) => codes.add(code));
    for (const feature of decoded.features) tileFeatures.push(feature);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (requestSeq !== mvtRequestSeq || isUnmounted) return;
  }

  const uniqueFeatures = dedupeMvtFeatures(tileFeatures);

  if (mode === "change") {
    emit("change-stats", summarizeChangeFeatures(uniqueFeatures));
  }

  console.info(
    "[crop-water-map] MVT 视口瓦片",
    JSON.stringify({
      zoom,
      tiles: tiles.length,
      decoded: decodedCount,
      rejected: rejected.length,
      codes: Array.from(codes),
      decodedFeatures: tileFeatures.length,
      uniqueFeatures: uniqueFeatures.length,
    })
  );

  await renderMvtFieldFeatures(uniqueFeatures, zoom, mode);
  return uniqueFeatures;
}

function pickFiniteNumber(source, keys) {
  for (const key of keys) {
    const raw = source?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeChangeFocus(payload) {
  const row = payload?.data?.data ?? payload?.data ?? payload;
  if (!row || typeof row !== "object" || row.available === false) return null;

  const center = Array.isArray(row.center)
    ? { longitude: row.center[0], latitude: row.center[1] }
    : (row.center ?? row.focus ?? row.location ?? row);
  let longitude = pickFiniteNumber(center, ["longitude", "lon", "lng", "x", "center_lon", "center_lng", "focus_lon", "focus_lng"]);
  let latitude = pickFiniteNumber(center, ["latitude", "lat", "y", "center_lat", "focus_lat"]);
  const bounds = Array.isArray(row.bbox ?? row.bounds ?? row.extent)
    ? (row.bbox ?? row.bounds ?? row.extent).map(Number)
    : null;
  if ((!Number.isFinite(longitude) || !Number.isFinite(latitude)) && bounds?.length >= 4 && bounds.slice(0, 4).every(Number.isFinite)) {
    longitude = (bounds[0] + bounds[2]) / 2;
    latitude = (bounds[1] + bounds[3]) / 2;
  }
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  const camera = row.camera ?? row.view ?? row.recommended_camera ?? {};
  const height = pickFiniteNumber(camera, ["height", "height_m", "camera_height", "camera_height_m", "recommended_height_m"])
    ?? pickFiniteNumber(row, ["height", "height_m", "camera_height", "camera_height_m", "recommended_height_m"])
    ?? 5200;
  const heading = pickFiniteNumber(camera, ["heading", "heading_deg"])
    ?? pickFiniteNumber(row, ["heading", "heading_deg"])
    ?? -8;
  const pitch = pickFiniteNumber(camera, ["pitch", "pitch_deg"])
    ?? pickFiniteNumber(row, ["pitch", "pitch_deg"])
    ?? -48;
  return {
    longitude,
    latitude,
    height: Math.max(900, Math.min(height, 50000)),
    heading,
    pitch,
  };
}

async function focusChangeDenseArea() {
  if (!viewer || !mvtMetadata || isUnmounted || props.mode !== "change") return false;

  const activeMonth = getActiveMvtTemporalKey();
  const focusCacheKey = getChangeCacheKey(activeMonth);
  const cachedTarget = changeFocusCache.get(focusCacheKey);
  if (cachedTarget) {
    flyToChangeFocus(cachedTarget);
    return true;
  }
  const requestSeq = ++changeFocusRequestSeq;
  changeFocusController?.abort();
  const controller = new AbortController();
  changeFocusController = controller;
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `${waterApiBase.replace(/\/$/, "")}/api/water/change/monthly/focus?month=${encodeURIComponent(activeMonth)}&v=${encodeURIComponent(props.changeResultVersion || "unversioned")}`,
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error(`最佳展示区域请求失败：${response.status}`);
    const target = normalizeChangeFocus(await response.json());
    if (requestSeq !== changeFocusRequestSeq || isUnmounted || props.mode !== "change" || activeMonth !== getActiveMvtTemporalKey()) return false;
    if (!target) throw new Error("最佳展示区域未返回有效坐标");
    changeFocusCache.set(focusCacheKey, target);
    while (changeFocusCache.size > 40) changeFocusCache.delete(changeFocusCache.keys().next().value);
    flyToChangeFocus(target);
    prefetchAdjacentFocus(activeMonth);
    return true;
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("最佳展示区域定位失败，改用瓦片聚合定位", error);
    if (requestSeq !== changeFocusRequestSeq || isUnmounted || props.mode !== "change" || activeMonth !== getActiveMvtTemporalKey()) return false;
    return focusChangeDenseAreaFromTiles();
  } finally {
    clearTimeout(timeout);
    if (changeFocusController === controller) changeFocusController = null;
  }
}

function flyToChangeFocus(target) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(target.longitude, target.latitude, target.height),
    duration: 0.9,
    orientation: {
      heading: Cesium.Math.toRadians(target.heading),
      pitch: Cesium.Math.toRadians(target.pitch),
      roll: 0,
    },
    complete: () => scheduleMvtFieldReload(0),
  });
}

function prefetchAdjacentFocus(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dates = [new Date(Date.UTC(year, monthNumber - 2, 1)), new Date(Date.UTC(year, monthNumber, 1))];
  dates.forEach((date) => {
    const neighbor = date.toISOString().slice(0, 7);
    if (neighbor < "2024-01" || neighbor > "2026-09") return;
    const cacheKey = getChangeCacheKey(neighbor);
    if (changeFocusCache.has(cacheKey)) return;
    fetch(`${waterApiBase.replace(/\/$/, "")}/api/water/change/monthly/focus?month=${encodeURIComponent(neighbor)}&v=${encodeURIComponent(props.changeResultVersion || "unversioned")}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const target = normalizeChangeFocus(payload);
        if (target) changeFocusCache.set(cacheKey, target);
      })
      .catch(() => {});
  });
}

async function focusChangeDenseAreaFromTiles() {
  if (!viewer || !mvtMetadata || isUnmounted || props.mode !== "change") return false;

  const bounds = Array.isArray(mvtMetadata.bounds)
    ? mvtMetadata.bounds.map(Number)
    : null;
  if (!bounds?.every(Number.isFinite)) {
    scheduleMvtFieldReload(0);
    return false;
  }

  const mode = props.mode;
  const year = loadedMvtYear;
  const activeMonth = getActiveMvtTemporalKey();
  const requestSeq = ++mvtRequestSeq;
  clearMvtPendingRequests();

  const minZoom = Number(mvtMetadata.minzoom) || 0;
  let zoom = Math.max(minZoom, Math.min(Number(mvtMetadata.cluster_maxzoom) || 10, 7));
  let tiles = createMvtTileList(
    { west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] },
    zoom
  );
  while (tiles.length > 24 && zoom > minZoom) {
    zoom -= 1;
    tiles = createMvtTileList(
      { west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] },
      zoom
    );
  }

  const results = await Promise.allSettled(
    tiles.map((tile) => loadMvtTileBuffer(tile, requestSeq, mode, year, activeMonth))
  );
  if (requestSeq !== mvtRequestSeq || isUnmounted || mode !== props.mode || activeMonth !== getActiveMvtTemporalKey()) return false;

  const candidates = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status !== "fulfilled" || !result.value) continue;
    const decoded = decodeMvtTileFeatures(tiles[index], result.value, null, mode);
    for (const feature of decoded.features) {
      const coordinate = getFirstMvtCoordinate(feature.coordinates);
      if (!coordinate?.slice(0, 2).every(Number.isFinite)) continue;
      const properties = feature.properties || {};
      const fieldCount = Number(properties.field_count) ||
        Number(properties.increase_count || 0) +
        Number(properties.decrease_count || 0) +
        Number(properties.unchanged_count || 0) || 1;
      candidates.push({ coordinate, fieldCount });
    }
  }

  const target = candidates.sort((a, b) => b.fieldCount - a.fieldCount)[0];
  if (!target) {
    scheduleMvtFieldReload(0);
    return false;
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(target.coordinate[0], target.coordinate[1], 5200),
    duration: 0.9,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-48),
      roll: 0,
    },
    complete: () => scheduleMvtFieldReload(0),
  });
  return true;
}

async function focusMvtCropFromOverview(crop) {
  if (!viewer || !mvtMetadata || isUnmounted || props.mode === "change") return;

  const activeCode = cropCodeByKey[crop];
  const bounds = Array.isArray(mvtMetadata.bounds)
    ? mvtMetadata.bounds.map(Number)
    : null;
  if (!activeCode || !bounds?.every(Number.isFinite)) {
    scheduleMvtFieldReload(0);
    return;
  }

  const requestSeq = ++mvtRequestSeq;
  const mode = props.mode;
  const year = loadedMvtYear;
  const activeDate = cropWaterActiveDate.value;
  clearMvtPendingRequests();
  const zoom = Math.max(Number(mvtMetadata.minzoom) || 0, 7);
  const tiles = createMvtTileList(
    { west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] },
    zoom
  );
  const results = await Promise.allSettled(
    tiles.map((tile) => loadMvtTileBuffer(tile, requestSeq, mode, year, activeDate))
  );
  if (requestSeq !== mvtRequestSeq || isUnmounted || mode !== props.mode || year !== loadedMvtYear || activeDate !== cropWaterActiveDate.value) return;

  const features = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status !== "fulfilled" || !result.value) continue;
    features.push(
      ...decodeMvtTileFeatures(tiles[index], result.value, activeCode, mode).features
    );
  }

  const uniqueFeatures = dedupeMvtFeatures(features);

  const extent = getMvtCropClusterExtent(uniqueFeatures) || getNearestMvtCropExtent(uniqueFeatures);
  if (!extent) {
    scheduleMvtFieldReload(0);
    return;
  }

  cropWaterLayerExtents.set(crop, extent);
  cropWaterDenseFocusCenters.set(crop, extent);
  lastMvtAutoFocusedCrop = crop;
  viewer.camera.flyTo({
    destination: getCropFocusDestination(extent),
    duration: 0.9,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
  });
}

function getNearestMvtCropExtent(features) {
  const cameraRectangle = viewer?.camera?.computeViewRectangle();
  const cameraCenter = cameraRectangle
    ? [
        Cesium.Math.toDegrees((cameraRectangle.west + cameraRectangle.east) / 2),
        Cesium.Math.toDegrees((cameraRectangle.south + cameraRectangle.north) / 2),
      ]
    : null;
  const centers = features
    .map((feature) => getFirstMvtCoordinate(feature.coordinates))
    .filter((coordinate) => coordinate?.length >= 2 && coordinate.slice(0, 2).every(Number.isFinite));
  if (!centers.length) return null;

  const origin = cameraCenter || centers[0];
  const nearest = centers.reduce((best, center) =>
    getCenterDistanceMeters(center, origin) < getCenterDistanceMeters(best, origin)
      ? center
      : best
  );
  return {
    lon: nearest[0],
    lat: nearest[1],
    west: nearest[0] - 0.018,
    east: nearest[0] + 0.018,
    south: nearest[1] - 0.014,
    north: nearest[1] + 0.014,
  };
}

function getMvtCropClusterExtent(features) {
  const centers = features
    .map((feature) => getFirstMvtCoordinate(feature.coordinates))
    .filter((coordinate) =>
      coordinate?.length >= 2 && coordinate.slice(0, 2).every(Number.isFinite)
    );
  if (!centers.length) return null;

  const gridSize = 0.35;
  const cells = new Map();
  for (const center of centers) {
    const key = `${Math.floor(center[0] / gridSize)}:${Math.floor(center[1] / gridSize)}`;
    const cell = cells.get(key) || { count: 0, lon: 0, lat: 0 };
    cell.count += 1;
    cell.lon += center[0];
    cell.lat += center[1];
    cells.set(key, cell);
  }
  const best = [...cells.values()].sort((a, b) => b.count - a.count)[0];
  const averageLon = best.lon / best.count;
  const averageLat = best.lat / best.count;
  const representative = centers.reduce((nearest, center) =>
    Math.hypot(center[0] - averageLon, center[1] - averageLat) <
    Math.hypot(nearest[0] - averageLon, nearest[1] - averageLat) ? center : nearest
  );
  const centerLon = representative[0];
  const centerLat = representative[1];
  return {
    lon: centerLon,
    lat: centerLat,
    west: centerLon - 0.02,
    east: centerLon + 0.02,
    south: centerLat - 0.02,
    north: centerLat + 0.02,
  };
}

// A field may be returned by more than one visible vector tile.  At exact
// geometry zoom the backend can return the same buffered geometry from both
// tiles, so rendering every tile feature creates a second polygon on top of
// the real field.  Keep legitimate multipart geometries, but drop identical
// geometries for the same field across tile boundaries.
function dedupeMvtFeatures(features) {
  const seen = new Set();
  const unique = [];

  for (const feature of features || []) {
    const fieldKey = feature.properties?.field_id ?? feature.id ?? "unknown";
    const geometryKey = getMvtGeometryKey(feature.geometryType, feature.coordinates);
    const key = `${fieldKey}:${geometryKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(feature);
  }

  if (unique.length !== (features || []).length) {
    console.info("[crop-water-map] MVT 重复地块已去重", JSON.stringify({
      before: (features || []).length,
      after: unique.length,
    }));
  }
  return normalizeChangeClassesByField(unique);
}

function normalizeChangeClassesByField(features) {
  if (props.mode !== "change") return features;
  const classByField = new Map();

  for (const feature of features) {
    const fieldId = normalizeFeatureId(feature.properties?.field_id ?? feature.properties?.gid ?? feature.id);
    if (fieldId === null) continue;
    const delta = Number(feature.properties?.delta);
    const inferredClass = Number.isFinite(delta)
      ? (delta > 0 ? "increase" : delta < 0 ? "decrease" : "unchanged")
      : feature.properties?.change_class;
    if (!classByField.has(fieldId) && changeColorByClass[inferredClass]) {
      classByField.set(fieldId, inferredClass);
    }
  }

  return features.map((feature) => {
    const fieldId = normalizeFeatureId(feature.properties?.field_id ?? feature.properties?.gid ?? feature.id);
    const changeClass = fieldId === null ? null : classByField.get(fieldId);
    if (!changeClass || feature.properties?.change_class === changeClass) return feature;
    return { ...feature, properties: { ...feature.properties, change_class: changeClass } };
  });
}

function summarizeChangeFeatures(features) {
  const counts = { increase: 0, decrease: 0, unchanged: 0 };
  const seenFields = new Set();

  for (const feature of features || []) {
    const fieldId = normalizeFeatureId(
      feature.properties?.field_id ?? feature.properties?.gid ?? feature.id
    );
    const changeClass = feature.properties?.change_class;
    if (fieldId === null || seenFields.has(fieldId)) continue;
    seenFields.add(fieldId);
    if (changeClass === "increase") counts.increase++;
    else if (changeClass === "decrease") counts.decrease++;
    else if (changeClass === "unchanged") counts.unchanged++;
  }

  const total = counts.increase + counts.decrease + counts.unchanged;
  if (!total) return null;
  return {
    rising: counts.increase,
    falling: counts.decrease,
    stable: counts.unchanged,
    total,
    scope: "当前地图范围",
  };
}

function getMvtGeometryKey(type, coordinates) {
  // MVT coordinates can differ by tiny floating-point amounts between tiles;
  // 5 decimal places is sub-meter-ish at this map scale and avoids false
  // negatives without merging separate neighbouring shapes.
  const rounded = JSON.stringify(normalizeCoordinates(coordinates));
  return `${type || "unknown"}:${rounded}`;
}

function normalizeCoordinates(value) {
  if (!Array.isArray(value)) return value;
  if (value.length && typeof value[0] === "number") {
    return value.map((number) => Number.isFinite(number) ? Number(number.toFixed(5)) : number);
  }
  return value.map(normalizeCoordinates);
}

function getVisibleMvtTiles(bbox) {
  const canvasWidth = Math.max(viewer?.scene?.canvas?.clientWidth || 900, 320);
  const lonSpan = Math.max(bbox.east - bbox.west, 0.0001);
  // 变化接口在 0—10 级返回聚合点，11 级返回简化地块，12 级以上返回精确地块。
  const metadataMinZoom = props.mode === "change"
    ? 0
    : Number(mvtMetadata?.minzoom) || 7;
  const metadataMaxZoom = Number(mvtMetadata?.maxzoom) || 18;
  const requestedZoom = Math.floor(Math.log2((360 * canvasWidth) / (256 * lonSpan))) + 1;
  let zoom = clamp(
    metadataMinZoom,
    requestedZoom,
    Math.min(metadataMaxZoom, 13)
  );
  let tiles = createMvtTileList(bbox, zoom);

  while (tiles.length > 16 && zoom > metadataMinZoom) {
    zoom -= 1;
    tiles = createMvtTileList(bbox, zoom);
  }

  return { zoom, tiles };
}

function createMvtTileList(bbox, zoom) {
  const maxIndex = 2 ** zoom - 1;
  const minX = clamp(0, lonToTileX(bbox.west, zoom), maxIndex);
  const maxX = clamp(0, lonToTileX(bbox.east, zoom), maxIndex);
  const minY = clamp(0, latToTileY(bbox.north, zoom), maxIndex);
  const maxY = clamp(0, latToTileY(bbox.south, zoom), maxIndex);
  const tiles = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z: zoom, x, y, key: `${zoom}/${x}/${y}` });
    }
  }

  return tiles;
}

function lonToTileX(longitude, zoom) {
  return Math.floor(((longitude + 180) / 360) * 2 ** zoom);
}

function latToTileY(latitude, zoom) {
  const safeLatitude = clamp(-85.05112878, latitude, 85.05112878);
  const radians = Cesium.Math.toRadians(safeLatitude);
  return Math.floor(
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom
  );
}

function clipBboxToMvtBounds(bbox) {
  const bounds = Array.isArray(mvtMetadata?.bounds)
    ? mvtMetadata.bounds.map(Number)
    : null;
  if (!bounds?.every(Number.isFinite)) return bbox;

  const clipped = {
    west: Math.max(bbox.west, bounds[0]),
    south: Math.max(bbox.south, bounds[1]),
    east: Math.min(bbox.east, bounds[2]),
    north: Math.min(bbox.north, bounds[3]),
  };

  return clipped.west < clipped.east && clipped.south < clipped.north
    ? clipped
    : null;
}

async function loadMvtTileBuffer(tile, requestSeq, mode, year, activeDate) {
  const cacheKey = `${mode}:${mode === "change" ? props.changeResultVersion : year}:${activeDate}:${tile.key}`;
  const cached = mvtTileCache.get(cacheKey);
  if (cached) {
    mvtTileCache.delete(cacheKey);
    mvtTileCache.set(cacheKey, cached);
    return cached;
  }

  const controller = new AbortController();
  mvtPendingRequests.set(cacheKey, controller);
  const url = mode === "change"
    ? `${waterApiBase.replace(/\/$/, "")}/api/water/change/monthly/tiles/${tile.z}/${tile.x}/${tile.y}.mvt?month=${activeDate}&v=${encodeURIComponent(props.changeResultVersion || "unversioned")}`
    : `${waterApiBase.replace(/\/$/, "")}/api/water/fields/tiles/${tile.z}/${tile.x}/${tile.y}.pbf?year=${year}`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MVT ${response.status}: ${url}`);

    const buffer = await response.arrayBuffer();
    if (requestSeq !== mvtRequestSeq || controller.signal.aborted || mode !== props.mode || year !== loadedMvtYear || activeDate !== getActiveMvtTemporalKey()) return null;

    cacheMvtTile(cacheKey, buffer);
    return buffer;
  } finally {
    if (mvtPendingRequests.get(cacheKey) === controller) {
      mvtPendingRequests.delete(cacheKey);
    }
  }
}

function decodeMvtTileFeatures(tile, buffer, activeCode, mode) {
  const extent = mvtTileGrid.getTileCoordExtent([tile.z, tile.x, tile.y]);
  const sourceFeatures = (mode === "change" ? changeMvtFormat : mvtFormat).readFeatures(buffer, {
    extent,
    featureProjection: "EPSG:3857",
  });
  const features = [];
  const codes = new Set();
  for (const feature of sourceFeatures) {
    const properties = { ...feature.getProperties() };
    delete properties.geometry;
    const code = Number(properties.max_value ?? properties.crop_code);
    codes.add(Number.isFinite(code) ? code : null);
    if (mode !== "change" && (!supportedCropCodes.has(code) || code !== activeCode)) continue;

    const geometry = feature.getGeometry();
    if (!geometry) continue;

    // ST_AsMVTGeom uses a 64-unit buffer around every tile.  The buffer is
    // useful for native vector-tile renderers, but Cesium receives each tile
    // fragment as an independent polygon, so the buffered area would be
    // painted again by the neighbouring tile. Clip in Web Mercator before
    // converting to lon/lat so cross-tile fields remain complete without
    // drawing the buffer twice.
    const clippedCoordinates = clipMvtGeometryToTile(
      geometry.getType(),
      geometry.getCoordinates(),
      extent
    );
    if (!clippedCoordinates) continue;

    const clippedGeometry = geometry.clone();
    clippedGeometry.setCoordinates(clippedCoordinates);
    clippedGeometry.transform("EPSG:3857", "EPSG:4326");
    features.push({
      tileKey: tile.key,
      id: feature.getId() ?? properties.field_id ?? properties.gid,
      properties,
      geometryType: clippedGeometry.getType(),
      coordinates: clippedGeometry.getCoordinates(),
    });
  }

  return { features, total: sourceFeatures.length, codes };
}

function clipMvtGeometryToTile(type, coordinates, extent) {
  if (type === "Polygon") {
    return clipMvtPolygonToExtent(coordinates, extent);
  }
  if (type === "MultiPolygon") {
    const polygons = coordinates
      .map((polygon) => clipMvtPolygonToExtent(polygon, extent))
      .filter(Boolean);
    return polygons.length ? polygons : null;
  }
  return coordinates;
}

function clipMvtPolygonToExtent(rings, extent) {
  if (!Array.isArray(rings) || !rings.length) return null;
  const clippedRings = rings
    .map((ring) => clipMvtRingToExtent(ring, extent))
    .filter((ring) => ring && ring.length >= 4);
  return clippedRings.length ? clippedRings : null;
}

function clipMvtRingToExtent(ring, extent) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let output = ring
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])]);
  if (output.length < 3 || output.some((point) => !point.every(Number.isFinite))) return null;

  const edges = [
    { inside: (point) => point[0] >= extent[0], intersect: (a, b) => intersectMvtVertical(a, b, extent[0]) },
    { inside: (point) => point[0] <= extent[2], intersect: (a, b) => intersectMvtVertical(a, b, extent[2]) },
    { inside: (point) => point[1] >= extent[1], intersect: (a, b) => intersectMvtHorizontal(a, b, extent[1]) },
    { inside: (point) => point[1] <= extent[3], intersect: (a, b) => intersectMvtHorizontal(a, b, extent[3]) },
  ];

  for (const edge of edges) {
    if (!output.length) return null;
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousInside = edge.inside(previous);
    for (const current of input) {
      const currentInside = edge.inside(current);
      if (currentInside !== previousInside) {
        output.push(edge.intersect(previous, current));
      }
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }

  const compact = output.filter((point, index) => {
    const previous = output[(index + output.length - 1) % output.length];
    return point[0] !== previous[0] || point[1] !== previous[1];
  });
  if (compact.length < 3) return null;
  const first = compact[0];
  const last = compact[compact.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) compact.push([...first]);
  return compact;
}

function intersectMvtVertical(a, b, x) {
  const denominator = b[0] - a[0];
  const ratio = denominator ? (x - a[0]) / denominator : 0;
  return [x, a[1] + (b[1] - a[1]) * ratio];
}

function intersectMvtHorizontal(a, b, y) {
  const denominator = b[1] - a[1];
  const ratio = denominator ? (y - a[1]) / denominator : 0;
  return [a[0] + (b[0] - a[0]) * ratio, y];
}

function cacheMvtTile(key, features) {
  mvtTileCache.set(key, features);
  while (mvtTileCache.size > 512) {
    mvtTileCache.delete(mvtTileCache.keys().next().value);
  }
}

function clearMvtPendingRequests() {
  for (const controller of mvtPendingRequests.values()) controller.abort();
  mvtPendingRequests.clear();
}

async function renderMvtFieldFeatures(features, zoom, mode) {
  if (!mvtFieldDataSource) return;

  currentMvtCropFeatures = features;
  mvtFieldDataSource.entities.removeAll();
  // 年度监测保持原有点/面策略；时空变化按后端三级瓦片协议显示。
  const overview = mode === "change"
    ? zoom <= 10
    : zoom < Number(mvtMetadata?.exact_geometry_minzoom || 12);
  const revision = mvtRequestSeq;
  const maxFeatures = mode === "change"
    ? (overview ? 12000 : 5000)
    : (overview ? 4000 : 1600);
  const step = Math.max(1, Math.ceil(features.length / maxFeatures));

  console.info(
    "[crop-water-map] MVT 地块已加载",
    JSON.stringify({
      crop: cropWaterActiveCrop.value,
      cropCode: cropCodeByKey[cropWaterActiveCrop.value] ?? 1,
      zoom,
      matched: features.length,
      rendered: Math.ceil(features.length / step),
    })
  );

  const entities = mvtFieldDataSource.entities;
  const seenOverviewFields = new Set();
  entities.suspendEvents();
  try {
  for (let index = 0; index < features.length; index += step) {
    if (revision !== mvtRequestSeq || isUnmounted || !viewer) return;
    if (index > 0 && Math.floor(index / step) % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (revision !== mvtRequestSeq || isUnmounted || !viewer) return;
    }
    const feature = features[index];
    const fieldKey = feature.properties?.field_id ?? feature.id;
    if (overview && fieldKey != null && seenOverviewFields.has(fieldKey)) continue;
    if (overview && fieldKey != null) seenOverviewFields.add(fieldKey);
    const code = Number(feature.properties.max_value ?? feature.properties.crop_code);
    const color = Cesium.Color.fromCssColorString(
      mode === "change"
        ? changeColorByClass[feature.properties?.change_class] || "#AAB4BE"
      : getCropColor(code)
    );

    const isChangeCluster = mode === "change" && (
      ["cluster", "monthly_cluster"].includes(feature.properties?.data_scope) || feature.geometryType === "Point"
    );
    if (overview || isChangeCluster) {
      addMvtOverviewEntity(feature, color, index, mode);
    } else {
      addMvtPolygonEntities(feature, color, index, mode);
    }
  }

  } finally { entities.resumeEvents(); }
  if (revision !== mvtRequestSeq || isUnmounted || !viewer) return;
  // 只在用户切换作物时由 focusMvtCropFromOverview 调整视角。
  // 日期、年份或瓦片刷新只替换图层，不改变相机。

  if (cropWaterShowCylinder.value && features.length) {
    if (cylinderRefreshTimer) clearTimeout(cylinderRefreshTimer);
    cylinderRefreshTimer = setTimeout(() => {
      cylinderRefreshTimer = null;
      addCylinderLayer();
    }, 80);
  }

  viewer.scene.requestRender();
}

function focusMvtCropFeatures(features) {
  const crop = cropWaterActiveCrop.value;
  if (!viewer || !crop || !features.length || lastMvtAutoFocusedCrop === crop) return;

  const extent = getMvtCropClusterExtent(features);
  if (!extent) return;

  cropWaterLayerExtents.set(crop, extent);
  lastMvtAutoFocusedCrop = crop;
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      extent.west,
      extent.south,
      extent.east,
      extent.north
    ),
    duration: 0.8,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
  });
}

function addMvtOverviewEntity(feature, color, index, mode) {
  const coordinate = getFirstMvtCoordinate(feature.coordinates);
  if (!coordinate) return;
  const fieldCount = Math.max(Number(feature.properties?.field_count) || 1, 1);
  const pixelSize = mode === "change"
    ? clamp(7, 5 + Math.log2(fieldCount + 1) * 1.7, 20)
    : 4;

  const entity = mvtFieldDataSource.entities.add({
    id: `mvt-point:${feature.tileKey}:${feature.id}:${index}`,
    position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1], 0),
    point: {
      pixelSize,
      color: color.withAlpha(mode === "change" ? 0.88 : 0.72),
      outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
      outlineWidth: mode === "change" ? 1.5 : 0.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  entity.mvtFieldProperties = feature.properties;
}

function addMvtPolygonEntities(feature, color, featureIndex, mode) {
  const polygons =
    feature.geometryType === "Polygon"
      ? [feature.coordinates]
      : feature.geometryType === "MultiPolygon"
        ? feature.coordinates
        : [];

  polygons.forEach((polygon, polygonIndex) => {
    const hierarchy = createCesiumPolygonHierarchy(polygon);
    if (!hierarchy) return;

    const entity = mvtFieldDataSource.entities.add({
      id: `mvt-polygon:${feature.tileKey}:${feature.id}:${featureIndex}:${polygonIndex}`,
      polygon: {
        hierarchy,
        material: color.withAlpha(0.62),
        outline: true,
        outlineColor: color.brighten(0.32, new Cesium.Color()).withAlpha(0.96),
        outlineWidth: 1.2,
        height: 0,
      },
    });
    entity.mvtFieldProperties = feature.properties;
  });
}

function createCesiumPolygonHierarchy(rings) {
  if (!Array.isArray(rings) || !Array.isArray(rings[0]) || rings[0].length < 3) {
    return null;
  }

  const toPositions = (ring) =>
    Cesium.Cartesian3.fromDegreesArray(
      ring.flatMap((coordinate) => [Number(coordinate[0]), Number(coordinate[1])])
    );
  const holes = rings.slice(1).filter((ring) => ring.length >= 3).map(
    (ring) => new Cesium.PolygonHierarchy(toPositions(ring))
  );

  return new Cesium.PolygonHierarchy(toPositions(rings[0]), holes);
}

function getFirstMvtCoordinate(coordinates) {
  let current = coordinates;
  while (Array.isArray(current) && Array.isArray(current[0])) current = current[0];
  return Array.isArray(current) && current.length >= 2 ? current : null;
}







function flyToFallbackCropExtent() {
  if (!viewer) return;

  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(
      fallbackCropWaterExtent.west,
      fallbackCropWaterExtent.south,
      fallbackCropWaterExtent.east,
      fallbackCropWaterExtent.north
    ),
    duration: 1.2,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
  });
}



async function loadLayerGeojson(layerName, bbox = null, maxFeatures = null) {
  const qualifiedLayerName = layerName.includes(":")
    ? layerName
    : `${workspace}:${layerName}`;
  const layerWorkspace = qualifiedLayerName.split(":")[0];
  const bboxQuery = bbox
    ? `&BBOX=${encodeURIComponent(
        `${bbox.west},${bbox.south},${bbox.east},${bbox.north},${cylinderWfsSrs}`
      )}`
    : "";
  const maxFeaturesQuery = maxFeatures
    ? `&maxFeatures=${maxFeatures}&count=${maxFeatures}`
    : "";
  const wfsUrl =
    `${geoserverBase}/${layerWorkspace}/ows?` +
    "service=WFS&version=1.0.0&request=GetFeature" +
    `&typeName=${encodeURIComponent(qualifiedLayerName)}` +
    bboxQuery +
    maxFeaturesQuery +
    "&outputFormat=application/json" +
    `&srsName=${cylinderWfsSrs}`;
  const response = await fetch(wfsUrl);

  if (!response.ok) {
    throw new Error(
      `WFS request failed for ${qualifiedLayerName}: ${response.status}`
    );
  }

  const geojson = await response.json();

  return {
    type: "FeatureCollection",
    features: (geojson.features || []).map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties || {}),
        sourceLayer: layerName,
      },
    })),
  };
}





function getQuantile(values, quantile) {
  if (!values.length) return 0;

  const index = Math.min(
    Math.max(Math.round((values.length - 1) * quantile), 0),
    values.length - 1
  );

  return values[index];
}





async function focusCropArea(crop) {
  if (!viewer || !crop) return;

  const extent = await ensureCropFocusExtent(crop);
  if (!extent) return;

  if (cropWaterIsPlaying.value) {
    cropWaterIsPlaying.value = false;
    stopSeasonalOrbit();
    stopDemoCylinderAnimation();
  }

  viewer.camera.flyTo({
    destination: getCropFocusDestination(extent),
    duration: 1.1,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
    complete: () => {
      cropWaterViewportCrop.value = crop;
      viewer.scene.requestRender();

      if (cropWaterShowCylinder.value) {
        addCylinderLayer();
      }
    },
  });
}

function getCropFocusDestination(extent) {
  const lon = Number.isFinite(extent.lon)
    ? extent.lon
    : (extent.west + extent.east) / 2;
  const lat = Number.isFinite(extent.lat)
    ? extent.lat
    : (extent.south + extent.north) / 2;
  const lonSpan = Math.max(Math.abs(extent.east - extent.west), 0.015);
  const latSpan = Math.max(Math.abs(extent.north - extent.south), 0.012);
  const lonMeters =
    lonSpan * 111320 * Math.max(Math.cos(Cesium.Math.toRadians(lat)), 0.2);
  const latMeters = latSpan * 110540;
  const height = clamp(2200, Math.max(lonMeters, latMeters) * 1.35, 6500);

  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

async function ensureCropFocusExtent(crop) {
  const cachedFocus = cropWaterDenseFocusCenters.get(crop);
  const cachedExtent = cropWaterLayerExtents.get(crop);

  if (cachedFocus) {
    return cachedFocus;
  }

  const layer = activeCropWaterDisplayLayers.find((item) => item.crop === crop);

  if (!layer) {
    return getFallbackCropFocusExtent(crop);
  }

  try {
    const geojson = await loadLayerGeojson(layer.name, null, 1200);
    const extent = getGeojsonExtent(geojson);
    const denseFocus = getDenseFeatureFocusExtent(geojson);

    if (extent) {
      cropWaterLayerExtents.set(crop, extent);
    }

    if (denseFocus) {
      cropWaterDenseFocusCenters.set(crop, denseFocus);
      return denseFocus;
    }

    if (extent) {
      return extent;
    }
  } catch (error) {
    console.warn(`Failed to load focus extent for ${crop}.`, error);
  }

  return cachedExtent || getFallbackCropFocusExtent(crop);
}

function getDenseFeatureFocusExtent(geojson) {
  const centers = (geojson?.features || [])
    .map((feature) => getFeatureCenter(feature))
    .filter((center) => Array.isArray(center) && center.every(Number.isFinite));

  if (!centers.length) return null;

  const lonValues = centers.map((center) => center[0]).sort((a, b) => a - b);
  const latValues = centers.map((center) => center[1]).sort((a, b) => a - b);
  const lonSpan = Math.max(lonValues[lonValues.length - 1] - lonValues[0], 0.01);
  const latSpan = Math.max(latValues[latValues.length - 1] - latValues[0], 0.01);
  const lonRadius = clamp(0.06, lonSpan * 0.08, 0.36);
  const latRadius = clamp(0.05, latSpan * 0.08, 0.28);
  let bestCenter = centers[0];
  let bestScore = -1;

  for (const center of centers) {
    let score = 0;

    for (const candidate of centers) {
      const lonDistance = Math.abs(candidate[0] - center[0]) / lonRadius;
      const latDistance = Math.abs(candidate[1] - center[1]) / latRadius;
      const distance = Math.hypot(lonDistance, latDistance);

      if (distance <= 1) {
        score += 1 - distance * 0.35;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCenter = center;
    }
  }

  let cluster = centers.filter((center) => {
    const lonDistance = Math.abs(center[0] - bestCenter[0]) / (lonRadius * 1.45);
    const latDistance = Math.abs(center[1] - bestCenter[1]) / (latRadius * 1.45);

    return Math.hypot(lonDistance, latDistance) <= 1;
  });

  if (cluster.length < Math.min(centers.length, 8)) {
    cluster = [...centers]
      .sort((a, b) => {
        const distanceA = Math.hypot(
          (a[0] - bestCenter[0]) / lonRadius,
          (a[1] - bestCenter[1]) / latRadius
        );
        const distanceB = Math.hypot(
          (b[0] - bestCenter[0]) / lonRadius,
          (b[1] - bestCenter[1]) / latRadius
        );

        return distanceA - distanceB;
      })
      .slice(0, Math.min(centers.length, 80));
  }

  const clusterLonValues = cluster.map((center) => center[0]).sort((a, b) => a - b);
  const clusterLatValues = cluster.map((center) => center[1]).sort((a, b) => a - b);
  const west = getQuantile(clusterLonValues, 0.05);
  const east = getQuantile(clusterLonValues, 0.95);
  const south = getQuantile(clusterLatValues, 0.05);
  const north = getQuantile(clusterLatValues, 0.95);
  const lonPadding = Math.max((east - west) * 0.45, 0.035);
  const latPadding = Math.max((north - south) * 0.45, 0.03);

  return {
    lon: bestCenter[0],
    lat: bestCenter[1],
    west: west - lonPadding,
    east: east + lonPadding,
    south: south - latPadding,
    north: north + latPadding,
  };
}

function getFallbackCropFocusExtent(crop) {
  const fallbackExtents = {
    wheat: { west: 80.2, south: 42.2, east: 82.4, north: 45.6 },
    corn: { west: 82.4, south: 42.2, east: 84.4, north: 45.6 },
    vegetables: { west: 84.4, south: 42.2, east: 86.4, north: 45.6 },
  };

  return fallbackExtents[crop] || fallbackCropWaterExtent;
}

function getGeojsonExtent(geojson) {
  const extent = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };

  for (const feature of geojson.features || []) {
    eachCoordinate(feature.geometry?.coordinates, (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      extent.west = Math.min(extent.west, lon);
      extent.south = Math.min(extent.south, lat);
      extent.east = Math.max(extent.east, lon);
      extent.north = Math.max(extent.north, lat);
    });
  }

  if (![extent.west, extent.south, extent.east, extent.north].every(Number.isFinite)) {
    return null;
  }

  return extent;
}

















function enableClickInfo() {
  if (!viewer) return;

  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  clickHandler.setInputAction(async (click) => {
    try {
      const fieldInfo =
        getMvtPickedFieldInfo(click.position) ||
        (cropWaterImageryLayers.length ? await getWmsFeatureInfo(click.position) : null);

      if (!fieldInfo) {
        clearSelectedField();
        return;
      }

      selectedWaterFieldId = String(fieldInfo.objectId);
      refreshCylinderLabelVisibility();
      emit("select-field", fieldInfo);
      if (props.mode === "change") return;
      const year = getWaterSeasonYear(cropWaterActiveDate.value);
      const date = cropWaterActiveDate.value;
      if (year) {
        const row = await loadFieldDaily(fieldInfo.objectId, year, date);
        if (selectedWaterFieldId !== String(fieldInfo.objectId) || cropWaterActiveDate.value !== date) return;
        emit("select-field", {
          ...fieldInfo,
          area:
            fieldInfo.area ??
            (getNullableFiniteNumber(row?.field_area_m2) == null
              ? null
              : formatNumber(row.field_area_m2)),
          waterAvailable: !!row,
          dailyWater: getNullableFiniteNumber(row?.total_eta_mm),
          blueWater: getNullableFiniteNumber(row?.blue_water_mm),
          greenWater: getNullableFiniteNumber(row?.green_water_mm),
        });
      }
    } catch (error) {
      console.warn("GetFeatureInfo failed.", error);
      clearSelectedField();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function getMvtPickedFieldInfo(position) {
  if (!viewer || !position) return null;

  const picked = viewer.scene.pick(position);
  const entity = picked?.id;
  const properties = entity?.mvtFieldProperties;
  if (!properties) return null;

  return buildFieldInfoFromProperties(properties, properties.field_id ?? properties.gid);
}

async function getWmsFeatureInfo(position) {
  if (!viewer || !position) return null;

  const cameraRectangle = viewer.camera.computeViewRectangle();
  if (!cameraRectangle) return null;

  const bbox = rectangleToBbox(cameraRectangle);
  const canvas = viewer.scene.canvas;
  const width = Math.round(canvas.clientWidth || canvas.width);
  const height = Math.round(canvas.clientHeight || canvas.height);
  const x = Math.round(position.x);
  const y = Math.round(position.y);
  const layers = activeCropWaterDisplayLayers.map((layer) => layer.name).join(",");
  const url =
    `${geoserverBase}/${workspace}/wms?` +
    [
      "SERVICE=WMS",
      "VERSION=1.1.1",
      "REQUEST=GetFeatureInfo",
      `LAYERS=${encodeURIComponent(layers)}`,
      `QUERY_LAYERS=${encodeURIComponent(layers)}`,
      "STYLES=",
      "INFO_FORMAT=application/json",
      "FEATURE_COUNT=5",
      `SRS=${cylinderWfsSrs}`,
      `BBOX=${encodeURIComponent(
        `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
      )}`,
      `WIDTH=${width}`,
      `HEIGHT=${height}`,
      `X=${x}`,
      `Y=${y}`,
    ].join("&");
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GetFeatureInfo request failed: ${response.status}`);
  }

  const result = await response.json();
  const feature = result.features?.[0];

  if (!feature) return null;

  console.info("Clicked parcel properties:", feature.properties);

  return buildFieldInfoFromProperties(feature.properties || {}, feature.id);
}

function buildFieldInfoFromProperties(props, fallbackId) {
  const objectId = pickProperty(
    props,
    "OBJECTID",
    "objectid",
    "field_id",
    "gid",
    "FID_1",
    "FID",
    "id"
  ) ?? fallbackId ?? null;
  const area = pickProperty(
    props,
    "Shape_Area",
    "SHAPE_Area",
    "SHAPE_AREA",
    "shape_area",
    "shape_Area",
    "area",
    "AREA",
    "Shape__Area",
    "Shape_Area_",
    "Shape_Area1",
    "Shape_Area2",
    "Shape_Ar",
    "Shape_A",
    "st_area",
    "ST_AREA",
    "geom_area"
  ) ?? pickPropertyByPattern(props, ["area", "acre"]);
  const length = pickProperty(
    props,
    "Shape_Leng",
    "SHAPE_Leng",
    "SHAPE_LENG",
    "Shape_Length",
    "SHAPE_Length",
    "SHAPE_LENGTH",
    "shape_leng",
    "shape_Leng",
    "shape_length",
    "shape_Length",
    "length",
    "LENGTH",
    "Shape__Length",
    "Shape_Leng_",
    "Shape_Len",
    "Shape_Le",
    "Shape_L",
    "st_length",
    "ST_LENGTH",
    "geom_length"
  ) ?? pickPropertyByPattern(props, ["leng", "length", "perim", "perimeter"]);
  const waterMatch = findWaterDataByObjectIds(
    [
      objectId,
      props.OBJECTID,
      props.objectid,
      props.field_id,
      props.gid,
      props.FID_1,
      props.FID,
    ]
      .map((value) => normalizeFeatureId(value))
      .filter((value) => value !== null)
  );
  const waterData = waterMatch?.waterData;
  const cropCode = Number(props.max_value ?? props.crop_code);

  return {
    objectId,
    cropCode: Number.isFinite(cropCode) ? cropCode : null,
    cropName: props.crop_name ?? getCropNameByCode(cropCode),
    cropSupported: props.crop_supported !== false,
    waterAvailable: !!waterData,
    area: area == null ? null : formatNumber(area),
    length: length == null ? null : formatNumber(length),
    dailyWater: getNullableFiniteNumber(
      waterData?.dailyWater ?? waterData?.eta ?? waterData?.eta_mm
    ),
    blueWater: getNullableFiniteNumber(
      waterData?.blueWater ?? waterData?.blue_water_mm
    ),
    greenWater: getNullableFiniteNumber(
      waterData?.greenWater ?? waterData?.green_water_mm
    ),
    totalWater: getNullableFiniteNumber(
      waterData?.totalWater ?? waterData?.eta ?? waterData?.eta_mm
    ),
    irrigationWater: getNullableFiniteNumber(
      waterData?.irrigationWater ?? waterData?.irrigation_use_mm
    ),
    monthlyCurrent: getNullableFiniteNumber(props.current_value),
    monthlyPrevious: getNullableFiniteNumber(props.previous_value),
    monthlyDelta: getNullableFiniteNumber(props.delta),
    changeClass: props.change_class ?? null,
  };
}

function getCropNameByCode(code) {
  return {
    1: "冬小麦",
    2: "春小麦",
    3: "棉花",
    4: "玉米",
    5: "水稻",
    8: "冬小麦—玉米轮作",
    9: "冬小麦—水稻轮作",
  }[Number(code)] ?? null;
}

function pickProperty(source, ...keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function pickPropertyByPattern(source, patterns) {
  const entries = Object.entries(source || {});

  for (const [key, value] of entries) {
    const normalizedKey = key.toLowerCase();

    if (
      patterns.some((pattern) => normalizedKey.includes(pattern)) &&
      value !== undefined &&
      value !== null
    ) {
      return value;
    }
  }

  return undefined;
}



function resetSelectedStyle() {
  if (!selectedHighlight || !selectedHighlight.polygon) return;

  selectedHighlight.polygon.material =
    Cesium.Color.fromCssColorString("#A7F3D0").withAlpha(0.35);
  selectedHighlight.polygon.outlineColor =
    Cesium.Color.fromCssColorString("#10B981");
  selectedHighlight.polygon.outlineWidth = 1.1;
  selectedHighlight = null;
}

function clearSelectedField() {
  selectedWaterFieldId = null;
  refreshCylinderLabelVisibility();
  resetSelectedStyle();
  emit("select-field", null);
}

function zoom(step) {
  if (!viewer || viewer.isDestroyed()) return;
  const distance = Math.max(100, viewer.camera.positionCartographic.height * .35);
  if (step > 0) viewer.camera.zoomIn(distance);
  else viewer.camera.zoomOut(distance);
  viewer.scene.requestRender();
}

defineExpose({
  zoom,
  clearSelectedField,
});





function startDemoCylinderAnimation() {
  if (!viewer || demoCylinderAnimationId) return;

  let lastTime = performance.now();

  function animate() {
    if (!viewer || !demoCylinderItems.length) {
      demoCylinderAnimationId = null;
      return;
    }

    const now = performance.now();
    const delta = Math.min(now - lastTime, 34);
    lastTime = now;
    let hasMovingItem = false;

    for (const item of demoCylinderItems) {
      item.progress = Math.min(item.progress + delta / 900, 1);
      const easedProgress = easeInOutSine(item.progress);
      item.currentHeight = lerp(item.startHeight, item.targetHeight, easedProgress);
      item.primitive.modelMatrix = getCylinderModelMatrixForHeight(
        item.baseMatrix,
        item.geometryHeight,
        item.currentHeight
      );

      if (item.progress < 1) {
        hasMovingItem = true;
      }
    }

    viewer.scene.requestRender();

    if (hasMovingItem || cropWaterIsPlaying.value) {
      demoCylinderAnimationId = requestAnimationFrame(animate);
    } else {
      demoCylinderAnimationId = null;
    }
  }

  demoCylinderAnimationId = requestAnimationFrame(animate);
}



function stopDemoCylinderAnimation() {
  if (demoCylinderAnimationId) {
    cancelAnimationFrame(demoCylinderAnimationId);
    demoCylinderAnimationId = null;
  }
}







/* function getDemoCylinderHeightFromValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= zeroValueThreshold) return 0;

  const normalizedValue = Math.min(number / visualMaxMetricValue, 1);
  const boostedValue = Math.pow(normalizedValue, cylinderVisualGamma);

  return (
    minNonZeroCylinderHeight +
    boostedValue * (demoMaxCylinderHeight - minNonZeroCylinderHeight)
  );
}
 */
function getDemoCylinderHeightFromValue(value) {
  const v = Number(value) || 0;

  if (v <= 0) return 0;

  const maxHeight = demoMaxCylinderHeight;
  const maxValue = Math.max(currentCylinderVisualMax, 0.01);
  const normalizedValue = Math.min(v / maxValue, 1);

  return Math.min(maxHeight, normalizedValue * maxHeight);
}

async function loadCylinderScale() {
  if (props.mode !== "crop" || cylinderScaleController) return;

  try {
    const cached = JSON.parse(localStorage.getItem(cylinderScaleStorageKey) || "null");
    const cachedMax = Number(cached?.global_max);
    if (Number.isFinite(cachedMax) && cachedMax > 0) {
      currentCylinderVisualMax = cachedMax;
    }
  } catch (error) {
    console.warn("读取水柱全局量程缓存失败", error);
  }

  const controller = new AbortController();
  cylinderScaleController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const url = `${waterApiBase.replace(/\/$/, "")}/api/water/fields/daily/scale`;

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const row = payload?.data?.data ?? payload?.data ?? payload;
    const globalMax = Number(row?.global_max);
    if (!Number.isFinite(globalMax) || globalMax <= 0) {
      throw new Error("量程接口没有返回有效 global_max");
    }

    const previousMax = currentCylinderVisualMax;
    currentCylinderVisualMax = globalMax;
    try {
      localStorage.setItem(cylinderScaleStorageKey, JSON.stringify({
        global_max: globalMax,
        metric: row?.metric || "total_eta_mm",
        unit: row?.unit || "mm",
      }));
    } catch (error) {
      console.warn("缓存水柱全局量程失败", error);
    }

    console.info("[crop-water-map] global cylinder scale loaded", {
      globalMax,
      metric: row?.metric,
      unit: row?.unit,
    });

    if (
      Math.abs(previousMax - globalMax) > 0.001 &&
      viewer && cropWaterShowCylinder.value && props.mode === "crop"
    ) {
      addCylinderLayer();
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("全局水柱量程请求失败，使用缓存或默认量程", {
        url,
        fallback: currentCylinderVisualMax,
        error,
      });
    }
  } finally {
    clearTimeout(timeoutId);
    if (cylinderScaleController === controller) cylinderScaleController = null;
  }
}
function getCylinderTransitionDuration() {
  return cylinderTransitionMs;
}

function updateCylinderLabelRanks() {
  const rankedItems = [...animatedCylinderItems]
    .filter((item) => shouldPrintMetricLabelValue(item.targetValue))
    .sort((a, b) => (b.targetValue || 0) - (a.targetValue || 0));

  for (let i = 0; i < rankedItems.length; i++) {
    rankedItems[i].labelRank = i;
    rankedItems[i].labelLayoutRank = i;
  }

  updateCylinderLabelLayout(rankedItems);
}

function shouldShowCylinderLabel(item) {
  if (!item || !shouldPrintMetricLabelValue(item.targetValue)) return false;
  if (!shouldShowCylinderDisk(item)) return false;

  if (selectedWaterFieldId && String(item.seed) === selectedWaterFieldId) {
    return true;
  }

  const cameraHeight =
    viewer?.camera?.positionCartographic?.height ?? Number.POSITIVE_INFINITY;
  const labelLimit = getCylinderLabelLimit(cameraHeight);

  return (item.labelLayoutRank ?? Number.POSITIVE_INFINITY) < labelLimit;
}

function shouldShowCylinderBody(item) {
  return Math.max(Number(item?.targetValue) || 0, Number(item?.currentValue) || 0) > zeroValueThreshold && Number(item?.currentHeight) > 1;
}

function shouldShowCylinderDisk(item) {
  const targetValue = Math.max(Number(item?.targetValue) || 0, Number(item?.currentValue) || 0);

  return Number.isFinite(targetValue) && targetValue >= labelValueThreshold && Number(item?.currentHeight) > 1;
}

function refreshCylinderLabelVisibility() {
  updateCylinderLabelRanks();

  for (const item of animatedCylinderItems) {
    item.heightState.showLabel = shouldShowCylinderLabel(item);
    item.labelEntity.show = item.heightState.showLabel;
  }

  viewer?.scene?.requestRender();
}

function updateCylinderLabelLayout(rankedItems) {
  labelLayoutFrame++;

  if (!viewer?.scene) return;

  const acceptedScreenPoints = [];
  const minDistance = getCylinderLabelPixelDistance();

  for (const item of rankedItems) {
    item.labelLayoutRank = Number.POSITIVE_INFINITY;

    if (!shouldPrintMetricLabelValue(item.targetValue)) continue;

    const worldPosition = Cesium.Cartesian3.fromDegrees(
      item.lon,
      item.lat,
      (item.currentHeight || item.targetHeight || 0) + 24
    );
    const screenPosition = toScreenPosition(worldPosition);

    if (!screenPosition) continue;

    if (selectedWaterFieldId && String(item.seed) === selectedWaterFieldId) {
      item.labelLayoutRank = -1;
      acceptedScreenPoints.push(screenPosition);
      continue;
    }

    const overlaps = acceptedScreenPoints.some((point) => {
      const dx = point.x - screenPosition.x;
      const dy = point.y - screenPosition.y;

      return dx * dx + dy * dy < minDistance * minDistance;
    });

    if (overlaps) continue;

    item.labelLayoutRank = acceptedScreenPoints.length;
    item.labelLayoutFrame = labelLayoutFrame;
    acceptedScreenPoints.push(screenPosition);
  }
}

function getCylinderLabelPixelDistance() {
  const cameraHeight =
    viewer?.camera?.positionCartographic?.height ?? Number.POSITIVE_INFINITY;

  if (cameraHeight > 450000) return 120;
  if (cameraHeight > 180000) return 108;
  if (cameraHeight > 80000) return 94;

  return 78;
}

function getCylinderLabelLimit(cameraHeight) {
  if (cameraHeight > 900000) return 3;
  if (cameraHeight > 450000) return 6;
  if (cameraHeight > 180000) return 10;
  if (cameraHeight > 80000) return 16;

  return 28;
}

function getFeatureCylinderRadius() {
  return cylinderVisualRadius;
}

function getUniqueCylinderFeatures(features) {
  const uniqueFeatures = [], seenObjectIds = new Set(), buckets = new Map();
  const lonCell = duplicateCylinderCenterDistanceMeters / (111320 * .5);
  const latCell = duplicateCylinderCenterDistanceMeters / 110540;
  for (let index = 0; index < features.length; index++) {
    const feature = features[index], objectId = getFeatureObjectId(feature, index);
    if (objectId !== null && seenObjectIds.has(objectId)) continue;
    const center = getFeatureCenter(feature);
    if (!center) continue;
    const x = Math.floor(center[0] / lonCell), y = Math.floor(center[1] / latCell);
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of buckets.get((x + dx) + ':' + (y + dy)) || []) neighbors.push(other);
    }
    if (isCylinderCenterTooClose(center, neighbors)) continue;
    if (objectId !== null) seenObjectIds.add(objectId);
    const key = x + ':' + y;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(center);
    uniqueFeatures.push(feature);
  }
  return uniqueFeatures;
}

function isCylinderCenterTooClose(center, acceptedCenters) {
  return acceptedCenters.some(
    (acceptedCenter) =>
      getCenterDistanceMeters(center, acceptedCenter) <
      duplicateCylinderCenterDistanceMeters
  );
}

function getCenterDistanceMeters(a, b) {
  const centerLat = (a[1] + b[1]) / 2;
  const lonMeters =
    (a[0] - b[0]) * 111320 * Math.max(Math.cos(Cesium.Math.toRadians(centerLat)), 0.1);
  const latMeters = (a[1] - b[1]) * 110540;

  return Math.hypot(lonMeters, latMeters);
}

function selectCylinderFeaturesForViewport(features) {
  const rectangle = viewer?.camera?.computeViewRectangle();
  if (!rectangle) return [];
  const centerLon = Cesium.Math.toDegrees((rectangle.west + rectangle.east) / 2);
  const centerLat = Cesium.Math.toDegrees((rectangle.south + rectangle.north) / 2);
  return [...features]
    .map((feature) => {
      const center = getFeatureCenter(feature);
      return { feature, distance: center ? getCenterDistanceMeters(center, [centerLon, centerLat]) : Infinity };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxNearbyCylinders)
    .map(({ feature }) => feature);
}

function getDayIndexFromDate(date) {
  const current = new Date(date);
  const start = new Date(cropWaterTimelineStartDate);
  const diff = current.getTime() - start.getTime();

  return Math.max(Math.floor(diff / (1000 * 60 * 60 * 24)), 0);
}



function getCurrentCropMvtCylinderFeatures() {
  if (!cropWaterActiveCrop.value) return [];
  const activeCode = cropCodeByKey[cropWaterActiveCrop.value] ?? null;

  return currentMvtCropFeatures
    .filter((feature) => {
      const code = Number(
        feature.properties?.max_value ?? feature.properties?.crop_code
      );
      return code === activeCode && feature.coordinates;
    })
    .map((feature) => ({
      type: "Feature",
      geometry: {
        type: feature.geometryType,
        coordinates: feature.coordinates,
      },
      properties: {
        ...feature.properties,
        field_id: feature.properties?.field_id ?? feature.id,
        objectid: feature.properties?.field_id ?? feature.id,
        crop: cropWaterActiveCrop.value,
        sourceLayer: "fields",
      },
    }));
}

async function loadFieldDaily(fieldId, year, date) {
  const key = `${year}:${date}:${fieldId}`;
  if (fieldDailyCache.has(key)) return fieldDailyCache.get(key);
  if (fieldDailyPendingCache.has(key)) return fieldDailyPendingCache.get(key);

  const request = fetch(
    `${waterApiBase.replace(/\/$/, "")}/api/water/fields/${encodeURIComponent(fieldId)}/daily?year=${year}&date=${date}`
  )
    .then(async (response) => {
      const payload = await response.json();
      const row = response.ok && payload.available ? payload.data : null;
      // 后端数据可能在页面打开后补齐。只缓存有效记录，避免一次 404
      // 让该地块在当前日期内一直停留在“无数据”状态。
      if (row) {
        fieldDailyCache.set(key, row);
        if (fieldDailyCache.size > 1200) fieldDailyCache.delete(fieldDailyCache.keys().next().value);
      } else {
        fieldDailyCache.delete(key);
      }
      return row;
    })
    .catch((error) => {
      console.warn("单地块耗水请求失败", fieldId, error);
      return null;
    })
    .finally(() => fieldDailyPendingCache.delete(key));

  fieldDailyPendingCache.set(key, request);
  return request;
}

function normalizeFieldDaily(row) {
  return {
    dailyWater: getNullableFiniteNumber(row?.total_eta_m3),
    totalWater: getNullableFiniteNumber(row?.total_eta_m3),
    blueWater: getNullableFiniteNumber(row?.blue_water_m3),
    greenWater: getNullableFiniteNumber(row?.green_water_m3),
    waterFootprint: getNullableFiniteNumber(row?.total_eta_m3),
    irrigationWater: getNullableFiniteNumber(row?.irrigation_applied_m3),
    dailyWaterMm: getNullableFiniteNumber(row?.total_eta_mm),
    blueWaterMm: getNullableFiniteNumber(row?.blue_water_mm),
    greenWaterMm: getNullableFiniteNumber(row?.green_water_mm),
    areaM2: getNullableFiniteNumber(row?.field_area_m2),
  };
}

function focusVisibleCylinderCluster(features) {
  if (!viewer || !features.length) return;

  const focusKey = cropWaterActiveCrop.value;
  if (lastCylinderAutoFocusKey === focusKey) return;

  const extent = getDenseFeatureFocusExtent({
    type: "FeatureCollection",
    features,
  });
  if (!extent) return;

  lastCylinderAutoFocusKey = focusKey;
  viewer.camera.flyTo({
    destination: getCropFocusDestination(extent),
    duration: 0.9,
    orientation: {
      heading: Cesium.Math.toRadians(-8),
      pitch: Cesium.Math.toRadians(-40),
      roll: 0,
    },
  });
}

async function updateCylinderLayerForDate() {
  if (!viewer?.scene || !animatedCylinderItems.length || props.mode !== "crop") return;

  const requestSeq = ++cylinderRequestSeq;
  const year = getWaterSeasonYear(cropWaterActiveDate.value);
  const date = cropWaterActiveDate.value;
  const items = [...animatedCylinderItems];
  const dailyRows = [];

  for (let offset = 0; offset < items.length; offset += cylinderDataConcurrency) {
    dailyRows.push(...await Promise.all(
      items.slice(offset, offset + cylinderDataConcurrency).map((item) =>
        loadFieldDaily(item.seed, year, date)
      )
    ));
    if (requestSeq !== cylinderRequestSeq || isUnmounted || !viewer || !cropWaterShowCylinder.value) return;
  }

  const nextWaterDataMap = new Map();
  items.forEach((item, index) => {
    const row = dailyRows[index];
    if (row) nextWaterDataMap.set(normalizeFeatureId(item.seed), normalizeFieldDaily(row));
  });
  currentWaterDataMap = nextWaterDataMap;

  for (const item of items) {
    const targetValue = getFeatureCylinderValue(item.feature, item.seed);
    const targetHeight = getDemoCylinderHeightFromValue(targetValue);
    const waterMixRatio = getFeatureGreenWaterRatio(item.feature, item.seed);
    item.startHeight = item.currentHeight;
    item.targetHeight = targetHeight;
    item.startValue = item.currentValue;
    item.targetValue = targetValue;
    item.durationMs = getCylinderTransitionDuration(targetValue);
    item.progress = 0;
    item.hasStarted = false;
    item.heightState.waterMixRatio = waterMixRatio;
    item.primitive.appearance.material.uniforms.color = getColorByMetric(waterMixRatio);

    const showGauge = Math.max(item.currentValue || 0, targetValue) > zeroValueThreshold;
    item.shellPrimitive.show = showGauge;
    for (const ring of item.gaugeRingEntities || []) ring.show = showGauge;
  }

  updateCylinderLabelRanks();
  startCylinderTransitionAnimation();
}

async function addCylinderLayer() {
  if (!viewer || !viewer.scene) return;

  const requestSeq = ++cylinderRequestSeq;
  const year = getWaterSeasonYear(cropWaterActiveDate.value);
  const date = cropWaterActiveDate.value;
  if (year !== loadedMvtYear || viewer.camera.positionCartographic.height > cylinderCameraHeightLimit) {
    removeCylinderLayer();
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  if (requestSeq !== cylinderRequestSeq || isUnmounted || !viewer || !cropWaterShowCylinder.value) return;
  const cameraRectangle = viewer.camera.computeViewRectangle();
  if (!cameraRectangle) return;

  let allFeatures = getCurrentCropMvtCylinderFeatures();
  if (!allFeatures.length) {
    await reloadVisibleMvtFields();
    allFeatures = getCurrentCropMvtCylinderFeatures();
  }

  if (
    requestSeq !== cylinderRequestSeq ||
    isUnmounted ||
    !cropWaterShowCylinder.value
  ) {
    return;
  }

  const previousCylinderItems = new Map(
    animatedCylinderItems.map((item) => [item.key, item])
  );
  const shouldPlayEntryAnimation = !hasInitializedCylinderLayer;

  removeCylinderLayer();
  stopDemoCylinderAnimation();
  clearVisibleLabels();

  const visibleFeatures = [];

  for (const feature of allFeatures) {
    const center = getFeatureCenter(feature);
    if (!center) continue;

    const point = Cesium.Cartographic.fromDegrees(center[0], center[1]);

    if (
      Cesium.Rectangle.contains(cameraRectangle, point) &&
      isFeatureCenterInMainViewport(center)
    ) {
      visibleFeatures.push(feature);
    }
  }

  const uniqueVisibleFeatures = getUniqueCylinderFeatures(visibleFeatures);
  const candidates = selectCylinderFeaturesForViewport(uniqueVisibleFeatures);
  const dailyRows = [];
  for (let offset = 0; offset < candidates.length; offset += cylinderDataConcurrency) {
    dailyRows.push(...await Promise.all(candidates.slice(offset, offset + cylinderDataConcurrency).map((feature) =>
      loadFieldDaily(getFeatureObjectId(feature), year, date)
    )));
    if (requestSeq !== cylinderRequestSeq || isUnmounted || !cropWaterShowCylinder.value) return;
  }
  currentWaterDataMap = new Map();
  let availableDailyCount = 0;
  candidates.forEach((feature, index) => {
    const row = dailyRows[index];
    if (!row) return;
    const fieldId = getFeatureObjectId(feature);
    currentWaterDataMap.set(fieldId, normalizeFieldDaily(row));
    availableDailyCount += 1;
  });
  // 候选地块即使当前日期没有记录，也保留为零高度状态；后续日期
  // 出现数据时可以直接从地面平滑升起，无需删除并重建水柱。
  const animatedFeatures = candidates;
  console.info("[crop-water-map] parcel cylinder render candidates", JSON.stringify({
    crop: cropWaterActiveCrop.value,
    date: cropWaterActiveDate.value,
    metric: cropWaterActiveMetric.value,
    apiFeatureCount: allFeatures.length,
    visibleFeatureCount: visibleFeatures.length,
    uniqueVisibleCount: uniqueVisibleFeatures.length,
    availableDailyCount,
    animatedFeatureCount: animatedFeatures.length,
    firstFeature: animatedFeatures[0]?.properties,
    firstCenter: animatedFeatures[0] ? getFeatureCenter(animatedFeatures[0]) : null,
  }));
  updateViewportCropFromFeatures(animatedFeatures);

  for (let i = 0; i < animatedFeatures.length; i++) {
    if (i > 0 && i % 8 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (requestSeq !== cylinderRequestSeq || isUnmounted || !viewer || !cropWaterShowCylinder.value) return;
    }
    const feature = animatedFeatures[i];
    const center = getFeatureCenter(feature);
    if (!center) continue;

    const [lon, lat] = center;
    const objectId = getFeatureObjectId(feature, i);
    const crop = getFeatureCrop(feature);
    const itemKey = getCylinderItemKey(crop, objectId);
    const previousItem = previousCylinderItems.get(itemKey);
    const hasPreviousItem = !!previousItem;
    const shouldAnimateFromGround = shouldPlayEntryAnimation;
    const gaugeRadius = getFeatureCylinderRadius();
    const waterRadius = gaugeRadius * 0.7;
    const targetValue = getFeatureCylinderValue(feature, objectId);
    const waterMixRatio = getFeatureGreenWaterRatio(feature, objectId);
    const rawTargetHeight = getDemoCylinderHeightFromValue(targetValue);
    const previousHeight = previousItem?.currentHeight ?? rawTargetHeight;
    const previousValue = previousItem?.currentValue ?? targetValue;
    const targetHeight = rawTargetHeight;
    const shouldAnimateValueChange =
      hasPreviousItem &&
      (Math.abs(previousHeight - targetHeight) > 0.5 ||
        Math.abs(previousValue - targetValue) > 0.001);
    const shouldAnimateCylinder =
      shouldAnimateFromGround || shouldAnimateValueChange;
    const baseMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(lon, lat, 0)
    );

    const primitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.CylinderGeometry({
            length: demoMaxCylinderHeight,
            topRadius: waterRadius,
            bottomRadius: waterRadius,
            slices: animatedCylinderSlices,
            vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
          }),
        }),
        modelMatrix: getCylinderModelMatrixForHeight(
          baseMatrix,
          demoMaxCylinderHeight,
          shouldAnimateFromGround ? zeroValueThreshold : previousHeight
        ),
        appearance: new Cesium.MaterialAppearance({
          translucent: true,
          closed: true,
          faceForward: true,
          flat: true,
          material: Cesium.Material.fromType("Color", {
            color: getColorByMetric(waterMixRatio),
          }),
        }),
        asynchronous: false,
      })
    );
    primitive.show =
      targetValue > zeroValueThreshold &&
      (shouldAnimateFromGround ? targetHeight : previousHeight) > 1;

    const shellPrimitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.CylinderGeometry({
            length: demoMaxCylinderHeight,
            topRadius: gaugeRadius,
            bottomRadius: gaugeRadius,
            slices: animatedCylinderSlices,
            vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
          }),
        }),
        modelMatrix: getCylinderModelMatrixForHeight(
          baseMatrix,
          demoMaxCylinderHeight,
          demoMaxCylinderHeight
        ),
        appearance: new Cesium.MaterialAppearance({
          translucent: true,
          closed: false,
          faceForward: true,
          flat: true,
          material: Cesium.Material.fromType("Color", {
            color: Cesium.Color.fromCssColorString("#D9F4FF").withAlpha(0.24),
          }),
        }),
        asynchronous: false,
      })
    );
    shellPrimitive.show = targetValue > zeroValueThreshold;

    const pulseOffset = seededRandom(hashString(String(objectId))) * Math.PI * 2;
    const heightState = {
      value: shouldAnimateFromGround
        ? 0
        : previousHeight,
      metricValue: shouldAnimateFromGround
        ? 0
        : previousValue,
      pulseOffset,
      waterMixRatio,
      showGlow:
        (shouldAnimateFromGround ? 0 : previousValue) > zeroValueThreshold,
      showLabel: false,
    };
    const topEntity = viewer.entities.add({
      name: `${getMetricLabel()} base`,
      position: new Cesium.CallbackProperty(
        () => Cesium.Cartesian3.fromDegrees(lon, lat, heightState.value),
        false
      ),
      show: targetValue > zeroValueThreshold && heightState.value > 1,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(
          () => waterRadius,
          false
        ),
        semiMinorAxis: new Cesium.CallbackProperty(
          () => waterRadius,
          false
        ),
        height: 0,
        heightReference: Cesium.HeightReference.NONE,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () => getTopSurfaceColor(heightState),
            false
          )
        ),
        outline: true,
        outlineColor: new Cesium.CallbackProperty(
          () => Cesium.Color.WHITE.withAlpha(0.82),
          false
        ),
      },
    });

    const glowEntity = viewer.entities.add({
      name: `${getMetricLabel()} base glow`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      show: heightState.showGlow,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(
          () => gaugeRadius * 1.08,
          false
        ),
        semiMinorAxis: new Cesium.CallbackProperty(
          () => gaugeRadius * 1.08,
          false
        ),
        height: 1.6,
        heightReference: Cesium.HeightReference.NONE,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () => getTopGlowColor(heightState),
            false
          )
        ),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#D9F4FF").withAlpha(0.68),
      },
    });

    const gaugeRingEntities = [0.25, 0.5, 0.75, 1].map((ratio) =>
      viewer.entities.add({
        name: `${getMetricLabel()} gauge tick`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        show: targetValue > zeroValueThreshold,
        ellipse: {
          semiMajorAxis: gaugeRadius * 1.03,
          semiMinorAxis: gaugeRadius * 1.03,
          height: demoMaxCylinderHeight * ratio,
          material: Cesium.Color.TRANSPARENT,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#D9F4FF").withAlpha(
            ratio === 1 ? 0.92 : 0.56
          ),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9000),
        },
      })
    );

    const labelState = { item: null };
    const labelEntity = viewer.entities.add({
      name: `${getMetricLabel()} label`,
      show: false,
      position: new Cesium.CallbackProperty(
        () => Cesium.Cartesian3.fromDegrees(lon, lat, heightState.value + 22),
        false
      ),
      label: {
        text: new Cesium.CallbackProperty(
          () => formatVisibleMetricLabelValue(labelState.item?.targetValue),
          false
        ),
        font: "13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -6),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    const item = {
      primitive,
      shellPrimitive,
      topEntity,
      glowEntity,
      labelEntity,
      feature,
      key: itemKey,
      baseMatrix,
      seed: objectId,
      crop,
      geometryHeight: demoMaxCylinderHeight,
      targetHeight,
      currentHeight: shouldAnimateFromGround
        ? 0
        : previousHeight,
      startHeight: shouldAnimateFromGround
        ? 0
        : previousHeight,
      targetValue,
      currentValue: shouldAnimateFromGround
        ? 0
        : previousValue,
      startValue: shouldAnimateFromGround
        ? 0
        : previousValue,
      labelRank: i,
      lon,
      lat,
      heightState,
      gaugeRingEntities,
      durationMs: getCylinderTransitionDuration(targetValue),
      progress: shouldAnimateCylinder ? 0 : 1,
      hasStarted: !shouldAnimateCylinder,
      startDelayMs: 0,
    };
    labelState.item = item;
    animatedCylinderItems.push(item);
    cylinderEntities.push(primitive);
    cylinderEntities.push(shellPrimitive);
    cylinderEntities.push(topEntity);
    cylinderEntities.push(glowEntity);
    cylinderEntities.push(labelEntity);
    cylinderEntities.push(...gaugeRingEntities);
  }

  hasInitializedCylinderLayer = true;
  updateCylinderLabelRanks();
  startCylinderTransitionAnimation();
}

function startCylinderTransitionAnimation() {
  if (!viewer?.scene) return;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  let lastAnimationTime = performance.now();
  let lastLabelLayoutTime = 0;

  function animate() {
    if (!viewer?.scene) {
      animationFrameId = null;
      return;
    }

    const now = performance.now();
    const frameDelta = Math.min(now - lastAnimationTime, 34);
    lastAnimationTime = now;
    let hasAnimatingItem = false;

    for (const item of animatedCylinderItems) {
      if (!item.hasStarted) item.hasStarted = true;
      item.progress = Math.min(item.progress + frameDelta / item.durationMs, 1);

      const easedProgress = easeInOutSine(item.progress);
      item.currentHeight = lerp(item.startHeight, item.targetHeight, easedProgress);
      item.currentValue = lerp(item.startValue, item.targetValue, easedProgress);
      item.primitive.modelMatrix = getCylinderModelMatrixForHeight(
        item.baseMatrix,
        item.geometryHeight,
        item.currentHeight
      );
      item.heightState.value = item.currentHeight;
      item.heightState.metricValue = item.currentValue;
      item.heightState.showLabel = shouldShowCylinderLabel(item);
      item.labelEntity.show = item.heightState.showLabel;
      const shouldShowCylinder = shouldShowCylinderBody(item);
      const shouldShowGauge = Math.max(item.currentValue || 0, item.targetValue || 0) > zeroValueThreshold;
      item.heightState.showGlow = shouldShowCylinder;
      item.glowEntity.show = shouldShowCylinder;
      item.primitive.show = shouldShowCylinder;
      item.shellPrimitive.show = shouldShowGauge;
      for (const ring of item.gaugeRingEntities || []) ring.show = shouldShowGauge;
      item.topEntity.show = shouldShowCylinderDisk(item);

      if (item.progress < 1) hasAnimatingItem = true;
    }

    if (now - lastLabelLayoutTime > 260) {
      lastLabelLayoutTime = now;
      updateCylinderLabelRanks();
      for (const item of animatedCylinderItems) {
        item.heightState.showLabel = shouldShowCylinderLabel(item);
        item.labelEntity.show = item.heightState.showLabel;
      }
    }

    viewer.scene.requestRender();
    if (hasAnimatingItem) animationFrameId = requestAnimationFrame(animate);
    else animationFrameId = null;
  }

  animate();
}





function getCylinderItemKey(crop, objectId) {
  return `${crop || "crop"}:${objectId}`;
}

function isFeatureCenterInMainViewport(center) {
  if (!viewer?.scene || !Array.isArray(center)) return false;

  const position = Cesium.Cartesian3.fromDegrees(center[0], center[1], 0);
  const screenPosition = toScreenPosition(position);
  const canvas = viewer.scene.canvas;
  const width = canvas?.clientWidth || canvas?.width || 1;
  const height = canvas?.clientHeight || canvas?.height || 1;

  if (!screenPosition) return false;

  return (
    screenPosition.x >= -cylinderVisualRadius &&
    screenPosition.x <= width + cylinderVisualRadius &&
    screenPosition.y >= -cylinderVisualRadius &&
    screenPosition.y <= height + cylinderVisualRadius
  );
}

function rectangleToBbox(rectangle) {
  const west = Cesium.Math.toDegrees(rectangle.west);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const north = Cesium.Math.toDegrees(rectangle.north);

  return { west, south, east, north };
}

function updateViewportCropFromCamera() {
  if (!viewer?.camera || !cropWaterLayerExtents.size) return;

  const cameraRectangle = viewer.camera.computeViewRectangle();
  if (!cameraRectangle) return;

  const viewport = rectangleToBbox(cameraRectangle);
  const viewportCenter = {
    lon: (viewport.west + viewport.east) / 2,
    lat: (viewport.south + viewport.north) / 2,
  };
  const centeredCrop = getCropContainingPoint(viewportCenter);
  const nextCrop = centeredCrop || getBestOverlappingCrop(viewport);

  if (nextCrop && cropWaterViewportCrop.value !== nextCrop) {
    cropWaterViewportCrop.value = nextCrop;
  }
}

function updateViewportCropFromFeatures(features) {
  if (!viewer?.scene || !Array.isArray(features) || !features.length) return;

  const canvas = viewer.scene.canvas;
  const width = canvas?.clientWidth || canvas?.width || 1;
  const height = canvas?.clientHeight || canvas?.height || 1;
  const centerX = width / 2;
  const centerY = height / 2;
  const cropScores = new Map();

  for (const feature of features) {
    const center = getFeatureCenter(feature);
    const crop = getFeatureCrop(feature);
    if (!center || !crop) continue;

    const screenPosition = toScreenPosition(
      Cesium.Cartesian3.fromDegrees(center[0], center[1], 0)
    );
    if (!screenPosition) continue;

    const normalizedDistance = Math.hypot(
      (screenPosition.x - centerX) / width,
      (screenPosition.y - centerY) / height
    );
    const centerWeight = Math.max(1.4 - normalizedDistance * 2.2, 0.25);
    const areaWeight = Math.sqrt(Math.max(getApproximateGeometryArea(feature), 1));
    const score = centerWeight * Math.min(areaWeight / 1200, 4);

    cropScores.set(crop, (cropScores.get(crop) || 0) + score);
  }

  let bestCrop = null;
  let bestScore = 0;

  for (const [crop, score] of cropScores.entries()) {
    if (score > bestScore) {
      bestCrop = crop;
      bestScore = score;
    }
  }

  if (bestCrop && cropWaterViewportCrop.value !== bestCrop) {
    cropWaterViewportCrop.value = bestCrop;
  }
}

function getCropContainingPoint(point) {
  for (const [crop, extent] of cropWaterLayerExtents.entries()) {
    if (
      point.lon >= extent.west &&
      point.lon <= extent.east &&
      point.lat >= extent.south &&
      point.lat <= extent.north
    ) {
      return crop;
    }
  }

  return null;
}

function getBestOverlappingCrop(viewport) {
  let bestCrop = null;
  let bestScore = 0;

  for (const [crop, extent] of cropWaterLayerExtents.entries()) {
    const west = Math.max(viewport.west, extent.west);
    const east = Math.min(viewport.east, extent.east);
    const south = Math.max(viewport.south, extent.south);
    const north = Math.min(viewport.north, extent.north);
    const score = Math.max(east - west, 0) * Math.max(north - south, 0);

    if (score > bestScore) {
      bestScore = score;
      bestCrop = crop;
    }
  }

  return bestCrop;
}





function lerp(start, end, amount) {
  return start + (end - start) * amount;
}









function getCylinderModelMatrixForHeight(baseMatrix, geometryHeight, displayHeight) {
  const safeGeometryHeight = Math.max(Number(geometryHeight) || 1, 1);
  const safeDisplayHeight = Math.max(Number(displayHeight) || 0, 0.01);
  const scaleZ = safeDisplayHeight / safeGeometryHeight;
  const translation = Cesium.Matrix4.fromTranslation(
    new Cesium.Cartesian3(0, 0, safeDisplayHeight / 2)
  );
  const scale = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(1, 1, scaleZ));
  const localMatrix = Cesium.Matrix4.multiply(
    translation,
    scale,
    new Cesium.Matrix4()
  );

  return Cesium.Matrix4.multiply(baseMatrix, localMatrix, new Cesium.Matrix4());
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function removeCylinderLayer() {
  if (!viewer || !viewer.scene) return;

  stopDemoCylinderAnimation();

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  for (const item of cylinderEntities) {
    if (!item) continue;

    if (item instanceof Cesium.Primitive) {
      viewer.scene.primitives.remove(item);
    } else {
      viewer.entities.remove(item);
    }
  }

  cylinderEntities = [];
  animatedCylinderItems = [];
  demoCylinderItems = [];
  clearVisibleLabels();
}

function enableCameraLabelRefresh() {
  if (!viewer || cameraMoveEndRemove) return;

  cameraMoveEndRemove = viewer.camera.moveEnd.addEventListener(() => {
    scheduleMvtFieldReload(120);
    if (!cropWaterShowCylinder.value) {
      updateViewportCropFromCamera();
      return;
    }

    if (cylinderRefreshTimer) {
      clearTimeout(cylinderRefreshTimer);
    }

    cylinderRefreshTimer = setTimeout(() => {
      cylinderRefreshTimer = null;
      addCylinderLayer();
    }, 260);
  });
}

/* function updateSeasonalVisualization() {
  if (!viewer) return;

  const seasonalState = getSeasonalCropState(cropWaterActiveDate.value);

  resetCropWaterLayerDisplay();

  if (cropWaterIsPlaying.value) {
    if (!cropWaterLockViewport.value && !seasonalOrbitTarget) {
      initializeSeasonalOrbitFromCurrentView(seasonalState);
    }
    viewer.scene.requestRender();
    return;
  }

  viewer.scene.requestRender();
} */
function updateSeasonalVisualization() {
  if (!viewer) return;

  updateSceneEnvironmentByDate();

  const seasonalState = getSeasonalCropState(cropWaterActiveDate.value);

  resetCropWaterLayerDisplay();

  if (cropWaterIsPlaying.value) {
    if (!cropWaterLockViewport.value && !seasonalOrbitTarget) {
      initializeSeasonalOrbitFromCurrentView(seasonalState);
    }
    viewer.scene.requestRender();
    return;
  }

  viewer.scene.requestRender();
}
function updateSceneEnvironmentByDate() {
  if (!viewer) return;

  const date = new Date(cropWaterActiveDate.value);
  if (!Number.isFinite(date.getTime())) return;

  // 固定到当地下午，避免夜晚太暗
  date.setHours(14, 0, 0, 0);

  viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);

  const month = date.getMonth() + 1;

  if (month >= 6 && month <= 8) {
    viewer.scene.globe.brightness = 1.08;
  } else if (month >= 12 || month <= 2) {
    viewer.scene.globe.brightness = 0.88;
  } else {
    viewer.scene.globe.brightness = 1.0;
  }

  viewer.scene.requestRender();
}
function resetCropWaterLayerDisplay() {
  const activeCropName = cropWaterActiveCrop.value;

  for (const item of cropWaterImageryLayers) {
    item.imageryLayer.show = Boolean(activeCropName) && item.crop === activeCropName;
    item.imageryLayer.alpha = 0.9;
    item.imageryLayer.brightness = 1;
    item.imageryLayer.contrast = 1.05;
  }
}

function startSeasonalOrbitFromCurrentView() {
  if (!viewer || !cropWaterIsPlaying.value) return;

  console.info("[crop-water-map] startSeasonalOrbitFromCurrentView", {
    locked: cropWaterLockViewport.value,
    activeCrop: cropWaterActiveCrop.value,
    activeDate: cropWaterActiveDate.value,
  });

  if (typeof viewer.camera.cancelFlight === "function") {
    viewer.camera.cancelFlight();
  }

  const seasonalState = getSeasonalCropState(cropWaterActiveDate.value);
  initializeSeasonalOrbitFromCurrentView(seasonalState);
  stopSeasonalOrbit(false);
  startSeasonalOrbit();
}

function initializeSeasonalOrbitFromCurrentView(seasonalState) {
  if (!viewer?.camera) return;

  const cameraPosition = viewer.camera.positionCartographic;
  const cameraRectangle = viewer.camera.computeViewRectangle();
  if (!cameraPosition) return;

  const lon = Cesium.Math.toDegrees(cameraPosition.longitude);
  const lat = Cesium.Math.toDegrees(cameraPosition.latitude);
  const bbox = cameraRectangle ? rectangleToBbox(cameraRectangle) : null;
  const fallbackSpan = getCurrentCameraRouteSpan();

  seasonalOrbitTarget = {
    lon,
    lat,
    west: bbox?.west ?? lon - fallbackSpan.lon,
    east: bbox?.east ?? lon + fallbackSpan.lon,
    south: bbox?.south ?? lat - fallbackSpan.lat,
    north: bbox?.north ?? lat + fallbackSpan.lat,
    focusCrops: seasonalState?.focusCrops ?? [],
    activeCrop: seasonalState?.activeCrop,
  };
  seasonalOrbitCurrent = { lon, lat };
  seasonalOrbitHeading = viewer.camera.heading;
  seasonalOrbitPitchCurrent = viewer.camera.pitch;
  seasonalOrbitRollCurrent = viewer.camera.roll;
  seasonalOrbitHeight = cameraPosition.height;
  seasonalOrbitRoute = buildSeasonalOrbitRoute(seasonalOrbitTarget);
  seasonalOrbitRouteIndex = 0;
}

function startSeasonalOrbit() {
  if (!viewer || seasonalOrbitFrameId || !cropWaterIsPlaying.value) return;

  console.info("[crop-water-map] startSeasonalOrbit", {
    hasTarget: !!seasonalOrbitTarget,
    routeLength: seasonalOrbitRoute.length,
  });

  if (cropWaterShowCylinder.value && !animatedCylinderItems.length) {
    addCylinderLayer();
  }

  if (!seasonalOrbitTarget) {
    const seasonalState = getSeasonalCropState(cropWaterActiveDate.value);
    const center = getSeasonalFocusCenter(seasonalState);
    if (!center) return;

    seasonalOrbitTarget = {
      lon: center.lon,
      lat: center.lat,
      west: center.west,
      east: center.east,
      south: center.south,
      north: center.north,
      focusCrops: seasonalState.focusCrops ?? [],
      activeCrop: seasonalState.activeCrop,
    };
    seasonalOrbitCurrent = {
      lon: seasonalOrbitTarget.lon,
      lat: seasonalOrbitTarget.lat,
    };
    seasonalOrbitHeading = Cesium.Math.toRadians(seasonalState.heading ?? 0);
    seasonalOrbitPitchCurrent = viewer.camera.pitch;
    seasonalOrbitRollCurrent = viewer.camera.roll;
    seasonalOrbitHeight = viewer.camera.positionCartographic?.height ?? seasonalFocusCameraHeight;
    seasonalOrbitRoute = buildSeasonalOrbitRoute(seasonalOrbitTarget);
    seasonalOrbitRouteIndex = 0;
  }

  if (!seasonalOrbitCurrent) {
    seasonalOrbitRoute = seasonalOrbitRoute.length
      ? seasonalOrbitRoute
      : buildSeasonalOrbitRoute(seasonalOrbitTarget);
    seasonalOrbitCurrent = {
      lon: seasonalOrbitTarget.lon,
      lat: seasonalOrbitTarget.lat,
    };
  }

  seasonalOrbitLastTime = performance.now();
  lastOrbitCylinderRefreshTime = 0;

  const orbit = () => {
    if (!viewer || !cropWaterIsPlaying.value || !seasonalOrbitTarget) {
      seasonalOrbitFrameId = null;
      return;
    }

    const now = performance.now();
    const deltaSeconds = Math.min((now - seasonalOrbitLastTime) / 1000, 0.08);
    seasonalOrbitLastTime = now;
    if (!seasonalOrbitRoute.length) {
      seasonalOrbitRoute = buildSeasonalOrbitRoute(seasonalOrbitTarget);
      seasonalOrbitRouteIndex = 0;
    }

    const sweepTarget = seasonalOrbitRoute[seasonalOrbitRouteIndex] || {
      lon: seasonalOrbitTarget.lon,
      lat: seasonalOrbitTarget.lat,
    };
    seasonalOrbitCurrent = movePointAtConstantSpeed(
      seasonalOrbitCurrent,
      sweepTarget,
      seasonalMoveSpeed * deltaSeconds
    );
    if (
      Math.hypot(
        sweepTarget.lon - seasonalOrbitCurrent.lon,
        sweepTarget.lat - seasonalOrbitCurrent.lat
    ) < seasonalMoveSpeed * Math.max(deltaSeconds, 1)
    ) {
      if (seasonalOrbitRouteIndex < seasonalOrbitRoute.length - 1) {
        seasonalOrbitRouteIndex++;
      } else {
        seasonalOrbitRoute.push(
          getForwardSeasonalRoutePoint(
            seasonalOrbitRoute[seasonalOrbitRoute.length - 1] ||
              seasonalOrbitCurrent
          )
        );
        seasonalOrbitRouteIndex++;
      }
    }
    seasonalOrbitHeading += seasonalOrbitHeadingSpeed * deltaSeconds;

    const destination = Cesium.Cartesian3.fromDegrees(
      seasonalOrbitCurrent.lon,
      seasonalOrbitCurrent.lat,
      seasonalOrbitHeight ??
        viewer.camera.positionCartographic?.height ??
        seasonalFocusCameraHeight
    );

    viewer.camera.setView({
      destination,
      orientation: {
        heading: seasonalOrbitHeading,
        pitch: seasonalOrbitPitchCurrent ?? viewer.camera.pitch,
        roll: seasonalOrbitRollCurrent ?? viewer.camera.roll,
      },
    });
    updateViewportCropFromCamera();

    if (
      cropWaterShowCylinder.value &&
      now - lastOrbitCylinderRefreshTime > orbitCylinderRefreshMs
    ) {
      lastOrbitCylinderRefreshTime = now;
      addCylinderLayer();
    }

    viewer.scene.requestRender();

    seasonalOrbitFrameId = requestAnimationFrame(orbit);
  };

  seasonalOrbitFrameId = requestAnimationFrame(orbit);
}

function buildSeasonalOrbitRoute(target) {
  if (!target) return [];

  const firstPoint = getForwardSeasonalRoutePoint(target);
  const secondPoint = getForwardSeasonalRoutePoint(firstPoint);
  const thirdPoint = getForwardSeasonalRoutePoint(secondPoint);

  return [firstPoint, secondPoint, thirdPoint];
}

function getForwardSeasonalRoutePoint(origin) {
  if (!origin) return null;

  const lonSpan = Number.isFinite(origin.east - origin.west)
    ? Math.abs(origin.east - origin.west)
    : 0;
  const latSpan = Number.isFinite(origin.north - origin.south)
    ? Math.abs(origin.north - origin.south)
    : 0;
  const fallbackSpan = getCurrentCameraRouteSpan();
  const routeStep = clamp(
    0.006,
    Math.min(lonSpan || fallbackSpan.lon, latSpan || fallbackSpan.lat) * 0.24,
    0.02
  );
  const heading = seasonalOrbitHeading || viewer?.camera?.heading || 0;
  const latRadians = Cesium.Math.toRadians(origin.lat);
  const longitudeScale = Math.max(Math.cos(latRadians), 0.35);

  return {
    lon: origin.lon + (Math.sin(heading) * routeStep) / longitudeScale,
    lat: origin.lat + Math.cos(heading) * routeStep,
  };
}

function getCurrentCameraRouteSpan() {
  const height = viewer?.camera?.positionCartographic?.height ?? 8000;
  const baseSpan = clamp(0.006, height / 110000000, 0.028);

  return {
    lon: baseSpan,
    lat: baseSpan * 0.62,
  };
}

function stopSeasonalOrbit(releaseCamera = true) {
  if (seasonalOrbitFrameId) {
    cancelAnimationFrame(seasonalOrbitFrameId);
    seasonalOrbitFrameId = null;
  }

  if (releaseCamera && viewer?.camera) {
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }
}

function movePointAtConstantSpeed(current, target, maxStep) {
  if (!current || !target) return target;

  const lonDelta = target.lon - current.lon;
  const latDelta = target.lat - current.lat;
  const distance = Math.hypot(lonDelta, latDelta);

  if (!Number.isFinite(distance) || distance <= maxStep || distance === 0) {
    return { lon: target.lon, lat: target.lat };
  }

  const ratio = maxStep / distance;

  return {
    lon: current.lon + lonDelta * ratio,
    lat: current.lat + latDelta * ratio,
  };
}

function getSeasonalFocusCenter(seasonalState) {
  if (!seasonalState?.focusCrops?.length) return null;

  if (seasonalState.activeCrop) {
    const denseCenter = cropWaterDenseFocusCenters.get(seasonalState.activeCrop);
    if (denseCenter) {
      return denseCenter;
    }
  }

  const extent = getCropUnionExtent(seasonalState.focusCrops);
  if (!extent) return null;

  return {
    ...extent,
    lon: (extent.west + extent.east) / 2,
    lat: (extent.south + extent.north) / 2,
  };
}

function getCropUnionExtent(crops) {
  const extent = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };

  for (const crop of crops) {
    const cropExtent = cropWaterLayerExtents.get(crop);
    if (!cropExtent) continue;

    extent.west = Math.min(extent.west, cropExtent.west);
    extent.south = Math.min(extent.south, cropExtent.south);
    extent.east = Math.max(extent.east, cropExtent.east);
    extent.north = Math.max(extent.north, cropExtent.north);
  }

  if (![extent.west, extent.south, extent.east, extent.north].every(Number.isFinite)) {
    return null;
  }

  const lonPadding = Math.max((extent.east - extent.west) * 0.14, 0.08);
  const latPadding = Math.max((extent.north - extent.south) * 0.14, 0.06);

  return {
    west: extent.west - lonPadding,
    south: extent.south - latPadding,
    east: extent.east + lonPadding,
    north: extent.north + latPadding,
  };
}

function getSeasonalCropState(date) {
  const time = new Date(date).getTime();
  const dateTime = (value) => new Date(value).getTime();
  const makeWeights = (activeCrop, strength) => ({
    wheat: activeCrop === "wheat" ? strength : 0.02,
    corn: activeCrop === "corn" ? strength : 0.02,
    vegetables: activeCrop === "vegetables" ? strength : 0.02,
  });

  if (time < dateTime("2025-05-01")) {
    const progress = smoothDateProgress(time, "2024-10-05", "2025-05-01");
    const springPeak = Math.exp(-Math.pow((progress - 0.78) / 0.22, 2));

    return {
      weights: makeWeights("wheat", lerp(0.45, 1.1, springPeak)),
      energy: lerp(0.46, 0.98, springPeak),
      focusKey: "wheat-2024-2025",
      focusCrops: ["wheat"],
      activeCrop: "wheat",
      heading: 8,
    };
  }

  if (time < dateTime("2025-05-10")) {
    const progress = smoothDateProgress(time, "2025-05-01", "2025-05-10");

    return {
      weights: makeWeights("vegetables", lerp(0.7, 0.95, progress)),
      energy: lerp(0.78, 0.94, progress),
      focusKey: "vegetables-2025",
      focusCrops: ["vegetables"],
      activeCrop: "vegetables",
      heading: 16,
    };
  }

  if (time < dateTime("2025-09-26")) {
    const progress = smoothDateProgress(time, "2025-05-10", "2025-09-25");

    return {
      weights: makeWeights("corn", lerp(0.72, 1.12, progress)),
      energy: lerp(0.82, 1.0, progress),
      focusKey: "corn-2025",
      focusCrops: ["corn"],
      activeCrop: "corn",
      heading: 18,
    };
  }

  const progress = smoothDateProgress(time, "2025-09-26", "2025-10-05");

  return {
    weights: makeWeights("corn", lerp(0.82, 0.62, progress)),
    energy: lerp(0.76, 0.62, progress),
    focusKey: "corn-harvest-2025",
    focusCrops: ["corn"],
    activeCrop: "corn",
    heading: 20,
  };
}

function smoothDateProgress(time, startDate, endDate) {
  return smoothStep(0, 1, clamp01(
    (time - new Date(startDate).getTime()) /
      Math.max(new Date(endDate).getTime() - new Date(startDate).getTime(), 1)
  ));
}

function smoothStep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));

  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 1);
}

function clamp(min, value, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function disableCameraLabelRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (cylinderRefreshTimer) {
    clearTimeout(cylinderRefreshTimer);
    cylinderRefreshTimer = null;
  }

  if (cameraMoveEndRemove) {
    cameraMoveEndRemove();
    cameraMoveEndRemove = null;
  }
}

function clearVisibleLabels() {
  if (!viewer) return;

  for (const labelEntity of visibleLabelEntities) {
    viewer.entities.remove(labelEntity);
  }

  visibleLabelEntities = [];
}

function toScreenPosition(worldPosition) {
  if (!viewer || !viewer.scene || !worldPosition) return null;

  if (
    Cesium.SceneTransforms &&
    typeof Cesium.SceneTransforms.wgs84ToWindowCoordinates === "function"
  ) {
    return Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      viewer.scene,
      worldPosition
    );
  }

  if (typeof viewer.scene.cartesianToCanvasCoordinates === "function") {
    return viewer.scene.cartesianToCanvasCoordinates(worldPosition);
  }

  return null;
}

function getFeatureCylinderValue(feature, objectId) {
  const waterMatch = findWaterDataByObjectIds(
    [
      objectId,
      feature.properties?.OBJECTID,
      feature.properties?.objectid,
      feature.properties?.field_id,
      feature.properties?.gid,
      feature.properties?.FID_1,
      feature.properties?.FID,
    ]
      .map((value) => normalizeFeatureId(value))
      .filter((value) => value !== null)
  );
  const apiValue = getMetricValueFromWaterData(waterMatch?.waterData);

  if (Number.isFinite(apiValue)) {
    return apiValue;
  }

  return 0;
}

function getMetricValueFromWaterData(waterData) {
  if (!waterData) return undefined;

  return toFiniteNumber(waterData.dailyWaterMm);
}





function hashString(value) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function getColorByMetric(greenWaterRatio = 0.5) {
  const blue = new Cesium.Color(35 / 255, 157 / 255, 245 / 255, 0.86);
  const green = new Cesium.Color(39 / 255, 213 / 255, 148 / 255, 0.86);

  if (cropWaterActiveMetric.value === "greenWater") {
    return green;
  }

  if (
    cropWaterActiveMetric.value === "blueWater" ||
    cropWaterActiveMetric.value === "irrigationWater"
  ) {
    return blue;
  }

  if (
    cropWaterActiveMetric.value === "waterFootprint" ||
    cropWaterActiveMetric.value === "totalWater"
  ) {
    return mixCesiumColor(blue, green, amplifyMixRatio(greenWaterRatio)).withAlpha(0.88);
  }

  return mixCesiumColor(blue, green, 0.5).withAlpha(0.86);
}

function amplifyMixRatio(ratio) {
  const t = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const stretched = Math.min(Math.max((t - 0.5) * 1.8 + 0.5, 0), 1);

  if (stretched < 0.5) {
    return Math.pow(stretched * 2, 1.45) * 0.5;
  }

  return 1 - Math.pow((1 - stretched) * 2, 1.45) * 0.5;
}

function getFeatureGreenWaterRatio(feature, objectId) {
  const waterData = getFeatureWaterDataByObjectIds([
    objectId,
    feature?.properties?.OBJECTID,
    feature?.properties?.objectid,
    feature?.properties?.field_id,
    feature?.properties?.FID_1,
    feature?.properties?.FID,
  ]
    .map((value) => normalizeFeatureId(value))
    .filter((value) => value !== null));
  const blue = toFiniteNumber(
    waterData?.blueWater ??
      feature?.properties?.blueWater ??
      feature?.properties?.blue_water_mm
  );
  const green = toFiniteNumber(
    waterData?.greenWater ??
      feature?.properties?.greenWater ??
      feature?.properties?.green_water_mm
  );
  const total = blue + green;

  if (total > 0) {
    return green / total;
  }

  return 0.5;
}

function getFallbackGreenWaterRatio(feature, objectId) {
  const crop = getFeatureCrop(feature);
  const cropBaseRatio = {
    wheat: 0.58,
    corn: 0.48,
    vegetables: 0.52,
  }[crop] ?? 0.5;
  const seed = hashString(
    [
      objectId,
      crop,
      cropWaterActiveDate.value,
      feature?.properties?.sourceLayer,
    ].join(":")
  );
  const localVariation = (seededRandom(seed) - 0.5) * 0.24;
  const seasonalVariation =
    Math.sin(getDayIndexFromDate(cropWaterActiveDate.value) / 17 + seededRandom(seed + 11) * 6.28) *
    0.04;

  return Math.min(Math.max(cropBaseRatio + localVariation + seasonalVariation, 0.18), 0.82);
}

function mixCesiumColor(fromColor, toColor, ratio) {
  const t = Math.min(Math.max(Number(ratio) || 0, 0), 1);

  return new Cesium.Color(
    lerp(fromColor.red, toColor.red, t),
    lerp(fromColor.green, toColor.green, t),
    lerp(fromColor.blue, toColor.blue, t),
    lerp(fromColor.alpha, toColor.alpha, t)
  );
}

function getTopSurfaceColor(heightState) {
  const pulse = getPulseValue(heightState);
  const alpha = heightState?.showGlow ? 0.78 + pulse * 0.12 : 0.68;

  return getColorByMetric(heightState?.waterMixRatio).withAlpha(alpha);
}

function getTopGlowColor(heightState) {
  const pulse = getPulseValue(heightState);
  const alpha = heightState?.showGlow ? 0.09 + pulse * 0.08 : 0;

  return getColorByMetric(heightState?.waterMixRatio).withAlpha(alpha);
}



function getPulseValue(heightState) {
  const now = performance.now ? performance.now() : Date.now();
  const offset = heightState?.pulseOffset || 0;

  return (Math.sin(now / 720 + offset) + 1) / 2;
}

function formatMetricLabelValue(value) {
  const number = Number(value);
  const formattedValue = Number.isFinite(number) ? number.toFixed(2) : "--";

  return `${formattedValue} mm`;
}

function formatVisibleMetricLabelValue(value) {
  const number = Number(value);

  if (!shouldPrintMetricLabelValue(number)) {
    return "";
  }

  return formatMetricLabelValue(number);
}

function shouldPrintMetricLabelValue(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= labelValueThreshold;
}

function getMetricLabel() {
  const labels = {
    dailyWater: "当日总需水量",
    totalWater: "当日总耗水量",
    blueWater: "当日蓝水耗水量",
    greenWater: "当日绿水耗水量",
    waterFootprint: "当日总耗水量",
    irrigationWater: "当日灌溉用水量",
  };

  return labels[cropWaterActiveMetric.value] || "作物需水量";
}

function getFeatureCrop(feature) {
  const sourceLayer = feature?.properties?.sourceLayer;
  const cropFromLayer = activeCropWaterDisplayLayers.find(
    (layer) => layer.name === sourceLayer
  )?.crop;
  const cropCode = Number(
    feature?.properties?.max_value ?? feature?.properties?.crop_code
  );

  return (
    cropFromLayer ||
    feature?.properties?.crop ||
    feature?.properties?.crop_type ||
    cropKeyByCode[cropCode] ||
    cropWaterActiveCrop.value
  );
}

function getFeatureObjectId(feature, fallbackIndex = 0) {
  return normalizeFeatureId(
    feature.properties?.OBJECTID ??
      feature.properties?.objectid ??
      feature.properties?.field_id ??
      feature.properties?.gid ??
      feature.properties?.FID_1 ??
      feature.properties?.FID ??
      fallbackIndex + 1
  );
}

function normalizeFeatureId(value) {
  if (value === undefined || value === null || value === "unknown") return null;

  const text = String(value).trim();
  if (!text) return null;

  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}







function findWaterDataByObjectIds(objectIds) {
  for (const objectId of objectIds) {
    const waterData = currentWaterDataMap.get(objectId);

    if (waterData) {
      return {
        objectId,
        waterData,
      };
    }
  }

  return null;
}



function getFeatureWaterDataByObjectIds(objectIds) {
  const apiWaterMatch = findWaterDataByObjectIds(objectIds);

  if (apiWaterMatch?.waterData) {
    return apiWaterMatch.waterData;
  }

  if (!cachedGeojson) return null;

  const feature = cachedGeojson.features.find((item) => {
    const featureObjectId = getFeatureObjectId(item);

    return objectIds.includes(featureObjectId);
  });

  if (!feature) return null;

  return {
    dailyWater: toFiniteNumber(
      feature.properties?.dailyWater ??
        feature.properties?.eta ??
        feature.properties?.eta_mm ??
        toFiniteNumber(feature.properties?.greenWater ?? feature.properties?.green_water_mm) +
          toFiniteNumber(feature.properties?.blueWater ?? feature.properties?.blue_water_mm)
    ),
    totalWater: toFiniteNumber(
      feature.properties?.totalWater ??
        feature.properties?.eta ??
        feature.properties?.eta_mm ??
        toFiniteNumber(feature.properties?.green_water_mm) +
          toFiniteNumber(feature.properties?.blue_water_mm)
    ),
    blueWater: toFiniteNumber(
      feature.properties?.blueWater ?? feature.properties?.blue_water_mm
    ),
    greenWater: toFiniteNumber(
      feature.properties?.greenWater ?? feature.properties?.green_water_mm
    ),
    waterFootprint: toFiniteNumber(
      feature.properties?.waterFootprint ??
        feature.properties?.eta ??
        feature.properties?.eta_mm ??
        feature.properties?.water_footprint_mm
    ),
    irrigationWater: toFiniteNumber(
      feature.properties?.irrigationWater ?? feature.properties?.irrigation_use_mm
    ),
  };
}



function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : value;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getNullableFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getFeatureCenter(feature) {
  if (!feature?.geometry) return null;

  if (cylinderCenterCache.has(feature.geometry)) return cylinderCenterCache.get(feature.geometry);
  const center = getPointInsideGeometry(feature.geometry) || getAverageCoordinateCenter(feature.geometry.coordinates);
  cylinderCenterCache.set(feature.geometry, center);
  return center;
}

function getAverageCoordinateCenter(coordinates) {
  let lonSum = 0;
  let latSum = 0;
  let count = 0;

  eachCoordinate(coordinates, (lon, lat) => {
    lonSum += lon;
    latSum += lat;
    count++;
  });

  if (count === 0) return null;

  const lon = lonSum / count;
  const lat = latSum / count;

  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function getPointInsideGeometry(geometry) {
  if (!geometry?.coordinates) return null;

  if (geometry.type === "Polygon") {
    return getPointInsidePolygon(geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates
      .map((polygon) => ({
        polygon,
        bounds: getPolygonBounds(polygon),
      }))
      .filter((item) => item.bounds)
      .sort((a, b) => getBoundsArea(b.bounds) - getBoundsArea(a.bounds));

    for (const item of polygons) {
      const point = getPointInsidePolygon(item.polygon, item.bounds);
      if (point) return point;
    }
  }

  return null;
}

function getPointInsidePolygon(polygon, bounds = getPolygonBounds(polygon)) {
  if (!bounds) return null;

  const center = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
  if (isPointInPolygon(center, polygon)) return center;

  const averageCenter = getAverageCoordinateCenter(polygon);
  if (averageCenter && isPointInPolygon(averageCenter, polygon)) {
    return averageCenter;
  }

  const samples = [5, 9, 15, 25];
  for (const sampleCount of samples) {
    const point = findInteriorGridPoint(polygon, bounds, sampleCount);
    if (point) return point;
  }

  return null;
}

function findInteriorGridPoint(polygon, bounds, sampleCount) {
  const center = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
  let bestPoint = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let y = 1; y < sampleCount; y++) {
    for (let x = 1; x < sampleCount; x++) {
      const point = [
        bounds.west + ((bounds.east - bounds.west) * x) / sampleCount,
        bounds.south + ((bounds.north - bounds.south) * y) / sampleCount,
      ];

      if (!isPointInPolygon(point, polygon)) continue;

      const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = point;
      }
    }
  }

  return bestPoint;
}

function getPolygonBounds(polygon) {
  const outerRing = polygon?.[0];
  if (!Array.isArray(outerRing) || !outerRing.length) return null;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (const point of outerRing) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }

  if (![west, south, east, north].every(Number.isFinite)) return null;

  return { west, south, east, north };
}

function getBoundsArea(bounds) {
  return Math.max(bounds.east - bounds.west, 0) * Math.max(bounds.north - bounds.south, 0);
}

function isPointInPolygon(point, polygon) {
  const outerRing = polygon?.[0];
  if (!isPointInRing(point, outerRing)) return false;

  for (let i = 1; i < polygon.length; i++) {
    if (isPointInRing(point, polygon[i])) return false;
  }

  return true;
}

function isPointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  const [lon, lat] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);

    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

    const edgeHeight = yj - yi;
    if (Math.abs(edgeHeight) < 1e-12) continue;

    const intersects =
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / edgeHeight + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function getApproximateGeometryArea(feature) {
  if (!feature?.geometry) return 0;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  eachCoordinate(feature.geometry.coordinates, (lon, lat) => {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  });

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return 0;
  }

  const centerLat = (south + north) / 2;
  const widthMeters =
    Math.abs(east - west) * 111320 * Math.max(Math.cos(Cesium.Math.toRadians(centerLat)), 0.1);
  const heightMeters = Math.abs(north - south) * 110540;

  return widthMeters * heightMeters;
}

function eachCoordinate(value, callback) {
  if (!Array.isArray(value)) return;

  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    callback(value[0], value[1]);
    return;
  }

  for (const child of value) {
    eachCoordinate(child, callback);
  }
}
</script>

<style scoped>
.map-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.sun-direction-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
  mix-blend-mode: soft-light;
  opacity: 0.9;
  transition: background 1.4s linear;
}

:deep(.cesium-widget-credits) {
  display: none !important;
}

.season-environment-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
  transition: background 1.2s linear, opacity 1.2s linear;
}

.crop-growth-overlay {
  position: absolute;
  right: 34px;
  bottom: calc(36% + 24px);
  z-index: 100000;
  width: 112px;
  height: 112px;
  pointer-events: none;
  --growth-progress: 0;
  --growth-main-height: 48px;
  --growth-main-top: 18px;
  --growth-side-height: 30px;
  --growth-side-opacity: 0;
  --growth-leaf-scale: 1;
  --growth-head-opacity: 0;
  --growth-head-scale: 0.72;
  --growth-bloom-opacity: 0;
  --growth-maturity: 0;
  filter:
    drop-shadow(0 8px 12px rgba(0, 0, 0, 0.32))
    drop-shadow(0 0 14px rgba(170, 236, 105, 0.32));
  animation: cropFloat 2.6s ease-in-out infinite;
}

.growth-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.growth-svg-crop {
  display: none;
  transform-box: fill-box;
  transform-origin: 50% 100%;
  transform:
    translateY(calc((1 - var(--growth-progress)) * 8px))
    scale(calc(0.76 + var(--growth-progress) * 0.24));
  transition:
    transform 0.35s ease,
    opacity 0.35s ease;
}

.growth-crop-cotton .growth-svg-cotton,
.growth-crop-corn .growth-svg-corn,
.growth-crop-rice .growth-svg-rice,
.growth-crop-wheat .growth-svg-wheat {
  display: block;
}

.svg-stem,
.svg-panicle-line {
  fill: none;
  stroke: #65c75b;
  stroke-width: 5.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform-box: fill-box;
  transform-origin: 50% 100%;
}

.svg-side-stem {
  opacity: var(--growth-side-opacity);
}

.svg-leaf,
.svg-head,
.svg-head path,
.svg-head ellipse,
.svg-head circle {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.svg-leaf {
  fill: url("#unused");
  fill: #70d665;
  transform: scale(var(--growth-leaf-scale));
}

.svg-head {
  opacity: var(--growth-head-opacity);
  transform: scale(var(--growth-head-scale));
}

.growth-stage-seedling .svg-head,
.growth-stage-seedling .svg-side-stem {
  opacity: 0;
}

.growth-stage-seedling .svg-leaf {
  transform: scale(0.72);
}

.growth-stage-dormancy .growth-svg {
  opacity: 0.62;
  filter: drop-shadow(0 0 12px rgba(145, 205, 255, 0.22));
}

.growth-svg-cotton .svg-stem {
  stroke: #5fc65c;
}

.growth-svg-cotton .svg-leaf {
  fill: #69d160;
}

.growth-svg-cotton .svg-cotton-boll {
  opacity: var(--growth-bloom-opacity);
  transform: scale(calc(0.55 + var(--growth-bloom-opacity) * 0.55));
}

.growth-svg-cotton .svg-cotton-boll circle {
  fill: #fff8dd;
  stroke: rgba(210, 244, 188, 0.82);
  stroke-width: 1.8;
}

.growth-svg-corn .svg-stem {
  stroke: #73c24a;
  stroke-width: 6;
}

.growth-svg-corn .svg-leaf {
  fill: #67c84b;
}

.growth-svg-corn .svg-corn-husk {
  fill: #6fb84d;
  stroke: rgba(44, 115, 47, 0.35);
  stroke-width: 1.2;
  opacity: var(--growth-head-opacity);
}

.growth-svg-corn .svg-corn-ear {
  transform-origin: 48px 78px;
}

.growth-svg-corn .svg-corn-cob {
  fill: #f3ba36;
  stroke: #d08c22;
  stroke-width: 2;
}

.growth-svg-corn .svg-kernel {
  fill: #ffe278;
  stroke: rgba(164, 105, 23, 0.26);
  stroke-width: 0.7;
}

.growth-svg-rice .svg-stem,
.growth-svg-rice .svg-panicle-line {
  stroke: #7ac76a;
  stroke-width: 3.5;
}

.growth-svg-rice .svg-leaf {
  fill: #78c96f;
}

.growth-svg-rice .svg-rice-panicle ellipse {
  fill: #d4b852;
  stroke: #9c7a28;
  stroke-width: 1;
  transform: rotate(20deg);
}

.growth-svg-wheat .svg-stem,
.growth-svg-wheat .svg-panicle-line {
  stroke: #c59232;
  stroke-width: 4;
}

.growth-svg-wheat .svg-leaf,
.growth-svg-wheat .svg-wheat-head path:not(.svg-panicle-line) {
  fill: #d9a83a;
}

.growth-stage-maturity .svg-leaf,
.growth-stage-ripening .svg-leaf,
.growth-stage-grain-filling .svg-leaf {
  fill: rgb(
    calc(112 + var(--growth-maturity) * 108),
    calc(214 - var(--growth-maturity) * 42),
    calc(96 - var(--growth-maturity) * 48)
  );
}

.growth-stage-ripening.growth-crop-rice .svg-leaf {
  fill: #79bd67;
}

.growth-part {
  position: absolute;
  display: block;
  transition:
    opacity 0.35s ease,
    transform 0.35s ease,
    background 0.35s ease,
    height 0.35s ease,
    width 0.35s ease;
}

.growth-part::before,
.growth-part::after {
  content: "";
  position: absolute;
  display: block;
}

.growth-stem {
  width: 7px;
  border-radius: 999px;
  background: linear-gradient(180deg, #d7ff72, #5ecb57);
  transform-origin: bottom center;
}

.growth-stem-main {
  left: 35px;
  top: var(--growth-main-top);
  height: var(--growth-main-height);
  transform: rotate(18deg);
}

.growth-stem-side {
  left: 25px;
  top: 30px;
  height: var(--growth-side-height);
  opacity: var(--growth-side-opacity);
  transform: rotate(-16deg);
}

.growth-leaf {
  width: 29px;
  height: 17px;
  border-radius: 100% 0 100% 0;
  background: linear-gradient(135deg, #e8ff7b, #6fda61 55%, #2ea84d);
  box-shadow: inset 4px 0 8px rgba(255, 255, 255, 0.25);
}

.growth-leaf-left {
  left: 17px;
  top: 40px;
  transform: rotate(24deg) scale(var(--growth-leaf-scale));
  transform-origin: right center;
}

.growth-leaf-right {
  left: 39px;
  top: 30px;
  transform: rotate(-54deg) scale(var(--growth-leaf-scale));
  transform-origin: left center;
}

.growth-head {
  left: 36px;
  top: 8px;
  width: 16px;
  height: 24px;
  border-radius: 999px 999px 4px 4px;
  background: linear-gradient(180deg, #f8dc62, #c99120);
  opacity: var(--growth-head-opacity);
  transform: scale(var(--growth-head-scale));
  transform-origin: bottom center;
}

.growth-bloom {
  right: 9px;
  top: 14px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #ffd34d;
  box-shadow: 0 0 14px rgba(255, 211, 77, 0.8);
  opacity: var(--growth-bloom-opacity);
  transform: scale(calc(0.45 + var(--growth-bloom-opacity) * 0.72));
}

.growth-stage-seedling .growth-stem-main {
  height: var(--growth-main-height);
  top: var(--growth-main-top);
}

.growth-stage-seedling .growth-leaf-right,
.growth-stage-seedling .growth-stem-side,
.growth-stage-seedling .growth-head {
  opacity: calc(var(--growth-side-opacity) * 0.8);
}

.growth-stage-flowering .growth-bloom,
.growth-stage-tasseling .growth-bloom,
.growth-stage-heading .growth-bloom {
  opacity: max(0.35, var(--growth-bloom-opacity));
  transform: scale(calc(0.72 + var(--growth-bloom-opacity) * 0.4));
}

.growth-stage-maturity .growth-leaf,
.growth-stage-ripening .growth-leaf,
.growth-stage-grain-filling .growth-leaf {
  background: linear-gradient(
    135deg,
    rgb(
      calc(232 + var(--growth-maturity) * 23),
      calc(255 - var(--growth-maturity) * 22),
      calc(123 - var(--growth-maturity) * 18)
    ),
    rgb(
      calc(111 + var(--growth-maturity) * 106),
      calc(218 - var(--growth-maturity) * 45),
      calc(97 - var(--growth-maturity) * 60)
    ) 55%,
    rgb(
      calc(46 + var(--growth-maturity) * 110),
      calc(168 - var(--growth-maturity) * 46),
      calc(77 - var(--growth-maturity) * 44)
    )
  );
}

.growth-stage-ripening.growth-crop-rice .growth-leaf {
  background: linear-gradient(135deg, #d9ef8a, #77bd67);
}

.growth-stage-dormancy {
  opacity: 0.62;
  filter:
    drop-shadow(0 8px 12px rgba(0, 0, 0, 0.28))
    drop-shadow(0 0 14px rgba(145, 205, 255, 0.2));
}

.growth-stage-dormancy .growth-leaf,
.growth-stage-dormancy .growth-stem {
  background: linear-gradient(135deg, #c9e9ff, #78a8d2);
}

.growth-crop-cotton .growth-stem-main {
  left: 36px;
  top: calc(68px - var(--growth-main-height));
  width: 6px;
  height: var(--growth-main-height);
  background: linear-gradient(180deg, #d7ff7a, #54b84d);
  transform: rotate(16deg);
}

.growth-crop-cotton .growth-stem-side {
  left: 32px;
  top: calc(64px - var(--growth-side-height));
  width: 5px;
  height: var(--growth-side-height);
  opacity: var(--growth-side-opacity);
  background: linear-gradient(180deg, #c5f66e, #4aa248);
  transform: rotate(-24deg);
}

.growth-crop-cotton .growth-leaf-left {
  left: 18px;
  top: 43px;
  width: 29px;
  height: 16px;
  background: linear-gradient(135deg, #dfff77, #5fc65c 58%, #238a45);
  transform: rotate(22deg) scale(var(--growth-leaf-scale));
  transform-origin: right center;
}

.growth-crop-cotton .growth-leaf-right {
  left: 38px;
  top: 37px;
  width: 28px;
  height: 15px;
  background: linear-gradient(135deg, #e8ff8c, #6ad064 58%, #2d994b);
  transform: rotate(-38deg) scale(var(--growth-leaf-scale));
  transform-origin: left center;
}

.growth-crop-cotton .growth-head {
  left: 29px;
  top: 13px;
  width: 22px;
  height: 20px;
  border-radius: 50%;
  opacity: var(--growth-bloom-opacity);
  background: #fff9e8;
  box-shadow:
    -8px 3px 0 -2px #f3ffe0,
    8px 3px 0 -2px #f3ffe0,
    0 9px 0 -3px #e5f7d4,
    0 0 16px rgba(255, 255, 230, 0.86);
  transform: scale(calc(0.55 + var(--growth-bloom-opacity) * 0.55));
  transform-origin: center;
}

.growth-crop-cotton .growth-head::before {
  left: 7px;
  top: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.86);
}

.growth-crop-cotton .growth-bloom {
  right: 21px;
  top: 28px;
  width: 8px;
  height: 8px;
  background: #f7e8bc;
  opacity: calc(var(--growth-bloom-opacity) * 0.8);
  box-shadow: 0 0 10px rgba(255, 245, 214, 0.62);
}

.growth-crop-corn .growth-stem-main {
  left: 34px;
  top: var(--growth-main-top);
  width: 10px;
  height: var(--growth-main-height);
  background: linear-gradient(180deg, #e2ff76, #63b842);
  transform: rotate(0deg);
}

.growth-crop-corn .growth-leaf-left {
  left: 9px;
  top: 42px;
  width: 42px;
  height: 16px;
  border-radius: 90% 0 90% 0;
  background: linear-gradient(135deg, #d6fb74, #5dbb3f 60%, #287b36);
  transform: rotate(18deg) scale(var(--growth-leaf-scale));
  transform-origin: right center;
}

.growth-crop-corn .growth-leaf-right {
  left: 37px;
  top: 30px;
  width: 42px;
  height: 16px;
  border-radius: 0 90% 0 90%;
  background: linear-gradient(45deg, #e3ff87, #6fc34c 58%, #2b8540);
  transform: rotate(-44deg) scale(var(--growth-leaf-scale));
  transform-origin: left center;
}

.growth-crop-corn .growth-head {
  left: 29px;
  top: calc(var(--growth-main-top) - 2px);
  width: 21px;
  height: 36px;
  border-radius: 45% 45% 42% 42%;
  opacity: var(--growth-head-opacity);
  background:
    radial-gradient(circle at 30% 22%, #fff18c 0 2px, transparent 3px),
    radial-gradient(circle at 65% 34%, #ffd65c 0 2px, transparent 3px),
    radial-gradient(circle at 38% 52%, #ffd65c 0 2px, transparent 3px),
    radial-gradient(circle at 68% 68%, #d99422 0 2px, transparent 3px),
    linear-gradient(180deg, #ffe977, #d98a20);
  box-shadow:
    inset 4px 0 6px rgba(255, 255, 255, 0.24),
    0 0 12px rgba(255, 206, 68, 0.45);
  transform: scale(var(--growth-head-scale)) rotate(-4deg);
}

.growth-crop-corn .growth-head::before,
.growth-crop-corn .growth-head::after {
  bottom: -5px;
  width: 11px;
  height: 25px;
  border-radius: 90% 0 90% 0;
  background: rgba(108, 180, 68, 0.82);
}

.growth-crop-corn .growth-head::before {
  left: -6px;
  transform: rotate(30deg);
}

.growth-crop-corn .growth-head::after {
  right: -6px;
  transform: rotate(-50deg);
}

.growth-crop-corn .growth-bloom {
  display: none;
}

.growth-crop-rice .growth-stem {
  width: 3px;
  height: var(--growth-main-height);
  background: linear-gradient(180deg, #dffb84, #75c469);
}

.growth-crop-rice .growth-stem-main {
  left: 36px;
  top: var(--growth-main-top);
  transform: rotate(-8deg);
}

.growth-crop-rice .growth-stem-side {
  left: 43px;
  top: calc(var(--growth-main-top) + 2px);
  opacity: var(--growth-side-opacity);
  transform: rotate(10deg);
}

.growth-crop-rice .growth-leaf-left {
  left: 24px;
  top: 48px;
  width: 24px;
  height: 7px;
  border-radius: 100% 0 100% 0;
  background: linear-gradient(135deg, #dfff82, #6fc56b);
  opacity: 0.78;
  transform: rotate(34deg) scale(calc(0.72 + var(--growth-progress) * 0.28));
  transform-origin: right center;
}

.growth-crop-rice .growth-leaf-right {
  left: 39px;
  top: 45px;
  width: 24px;
  height: 7px;
  border-radius: 0 100% 0 100%;
  background: linear-gradient(45deg, #e6ff92, #76c96f);
  opacity: 0.78;
  transform: rotate(-52deg) scale(calc(0.72 + var(--growth-progress) * 0.28));
  transform-origin: left center;
}

.growth-crop-rice .growth-head {
  left: 38px;
  top: calc(var(--growth-main-top) + 7px);
  width: 11px;
  height: 34px;
  border-radius: 999px;
  opacity: var(--growth-head-opacity);
  background:
    radial-gradient(ellipse at 50% 12%, #f6dc74 0 2px, transparent 3px),
    radial-gradient(ellipse at 48% 30%, #e0ca64 0 2px, transparent 3px),
    radial-gradient(ellipse at 52% 48%, #ccb551 0 2px, transparent 3px),
    radial-gradient(ellipse at 46% 66%, #b99b3d 0 2px, transparent 3px),
    radial-gradient(ellipse at 50% 84%, #a88631 0 2px, transparent 3px);
  transform: rotate(32deg) scale(var(--growth-head-scale));
  transform-origin: top center;
}

.growth-crop-rice .growth-head::before {
  left: 5px;
  top: -4px;
  width: 2px;
  height: 34px;
  border-radius: 999px;
  background: rgba(133, 111, 43, 0.82);
  transform: rotate(-6deg);
}

.growth-crop-rice .growth-head::after {
  left: -7px;
  top: 4px;
  width: 10px;
  height: 28px;
  border-radius: 999px;
  background:
    radial-gradient(ellipse at 50% 20%, #ead06a 0 2px, transparent 3px),
    radial-gradient(ellipse at 50% 45%, #cdb45a 0 2px, transparent 3px),
    radial-gradient(ellipse at 50% 70%, #a88631 0 2px, transparent 3px);
  transform: rotate(-15deg);
}

.growth-crop-rice .growth-bloom {
  display: none;
}

.growth-crop-wheat .growth-stem-main {
  left: 35px;
  top: var(--growth-main-top);
  height: var(--growth-main-height);
  width: 5px;
  background: linear-gradient(180deg, #f7d76e, #a97824);
  transform: rotate(0deg);
}

.growth-crop-wheat .growth-leaf {
  background: linear-gradient(135deg, #f8d971, #bd8e2e);
}

.growth-crop-wheat .growth-head {
  left: 29px;
  top: calc(var(--growth-main-top) - 3px);
  width: 22px;
  height: 38px;
  opacity: var(--growth-head-opacity);
  background:
    radial-gradient(ellipse at 28% 12%, #ffe99a 0 3px, transparent 4px),
    radial-gradient(ellipse at 70% 23%, #e2b74f 0 3px, transparent 4px),
    radial-gradient(ellipse at 27% 38%, #f7d76e 0 3px, transparent 4px),
    radial-gradient(ellipse at 72% 52%, #c8902e 0 3px, transparent 4px),
    radial-gradient(ellipse at 30% 68%, #e5b64a 0 3px, transparent 4px),
    linear-gradient(180deg, #f4d36e, #9c6d1f);
  transform: rotate(-8deg) scale(var(--growth-head-scale));
}

.growth-crop-wheat .growth-head::before,
.growth-crop-wheat .growth-head::after {
  top: 4px;
  width: 1.5px;
  height: 38px;
  border-radius: 999px;
  background: rgba(255, 236, 157, 0.72);
}

.growth-crop-wheat .growth-head::before {
  left: 6px;
  transform: rotate(-28deg);
}

.growth-crop-wheat .growth-head::after {
  right: 6px;
  transform: rotate(28deg);
}

.growth-crop-wheat .growth-bloom {
  display: none;
}

.crop-growth-overlay.growth-stage-seedling .growth-stem-main {
  left: 36px;
  top: 38px;
  width: 5px;
  height: 30px;
  transform: rotate(0deg);
}

.crop-growth-overlay.growth-stage-seedling .growth-stem-side,
.crop-growth-overlay.growth-stage-seedling .growth-head,
.crop-growth-overlay.growth-stage-seedling .growth-bloom {
  opacity: 0;
}

.crop-growth-overlay.growth-stage-seedling .growth-leaf-left {
  left: 21px;
  top: 44px;
  width: 25px;
  height: 13px;
  transform: rotate(22deg) scale(0.92);
  transform-origin: right center;
}

.crop-growth-overlay.growth-stage-seedling .growth-leaf-right {
  left: 36px;
  top: 39px;
  width: 25px;
  height: 13px;
  transform: rotate(-42deg) scale(0.92);
  transform-origin: left center;
}

.crop-growth-overlay.growth-crop-cotton.growth-stage-seedling .growth-leaf-left,
.crop-growth-overlay.growth-crop-cotton.growth-stage-seedling .growth-leaf-right {
  background: linear-gradient(135deg, #ddff82, #5fc65c 58%, #268c45);
}

@keyframes cropFloat {
  0% {
    transform: translateY(0px) scale(1);
  }

  50% {
    transform: translateY(-5px) scale(1.08);
  }

  100% {
    transform: translateY(0px) scale(1);
  }
}
.water-map-status { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 20; max-width: min(400px, 55vw); padding: 10px 14px; font-size: 12px; line-height: 1.7; }
.water-map-status button { margin-left: 10px; padding: 3px 9px; border: 0; border-radius: 4px; background: var(--brand-500); color: white; cursor: pointer; }
.water-year-notice { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 20; padding: 10px 14px; color: var(--ink-300); font-size: 12px; }
</style>
