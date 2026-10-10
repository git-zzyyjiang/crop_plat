<template>
  <div class="crop-water-bottom">
    <section ref="panel" class="crop-water-layout float-panel" :style="panelStyle">
      <div class="crop-water-head" @pointerdown="startDrag">
        <div>
          <div class="panel-title">作物耗水量动态监测</div>
         
        </div>

        <button class="water-collapse" type="button" :title="collapsed ? '展开面板' : '收起面板'" @pointerdown.stop @click="collapsed = !collapsed">{{ collapsed ? '»' : '«' }}</button>
      </div>

      <div v-show="!collapsed" class="crop-water-body">
      <p class="water-status" role="status">{{ summaryStatus }} · {{ currentDateText }}</p>
      <div class="crop-water-controls">
        <div class="crop-type-list">
          <button
            class="legend-item"
            :class="{ clicked: cropWaterActiveCrop === item.name }"
            v-for="item in cropTypes"
            :key="item.name"
            type="button"
            @click="changeCrop(item.name)"
          >
            <span
              class="crop-water-color"
              :style="{ backgroundColor: item.color }"
            ></span>
            <span class="crop-water-name">
              <b>{{ item.code }}</b>{{ item.label }}
            </span>
          </button>
        </div>

        <button class="toggle-button" type="button" @click="toggleCylinder">
          {{ cropWaterShowCylinder ? "隐藏水柱" : "显示水柱" }}
        </button>
        <button
          class="toggle-button"
          :class="{ active: cropWaterLockViewport }"
          type="button"
          @click="toggleViewportLock"
        >
          {{ cropWaterLockViewport ? "固定视角" : "自由视角" }}
        </button>
      </div>

      <div class="crop-water-main">
        <div class="metric-grid">
          <button
            class="metric-card metric-card-static"
            type="button"
          >
            <span>当日蓝水耗水量</span>
            <strong>{{ currentData.dailyBlueWater }} <em>m³</em></strong>
          </button>

          <button
            class="metric-card metric-card-static"
            type="button"
          >
            <span>当日绿水耗水量</span>
            <strong>{{ currentData.dailyGreenWater }} <em>m³</em></strong>
          </button>

          <button
            class="metric-card"
            :class="{ active: cropWaterActiveMetric === 'dailyWater' }"
            :style="totalWaterCardStyle"
            @click="changeMetric('dailyWater')"
          >
            <span>当日总需水量</span>
            <strong>{{ currentData.dailyWaterDemand }} <em>m³</em></strong>
          </button>

          <button
            class="metric-card"
            :class="{ active: cropWaterActiveMetric === 'blueWater' }"
            @click="changeMetric('blueWater')"
          >
            <span>累计蓝水耗水量</span>
            <strong>{{ currentData.cumulativeBlueWater }} <em>m³</em></strong>
          </button>

          <button
            class="metric-card"
            :class="{ active: cropWaterActiveMetric === 'greenWater' }"
            type="button"
            @click="changeMetric('greenWater')"
          >
            <span>累计绿水耗水量</span>
            <strong>{{ currentData.cumulativeGreenWater }} <em>m³</em></strong>
          </button>

          <button
            class="metric-card"
            :class="{ active: cropWaterActiveMetric === 'waterFootprint' }"
            type="button"
            @click="changeMetric('waterFootprint')"
          >
            <span>累计总需水量</span>
            <strong>{{ currentData.cumulativeWaterDemand }} <em>m³</em></strong>
          </button>
        </div>

        <div class="chart-card">
          <div class="chart-title-row">
            <div class="chart-title">作物耗水动态过程</div>
            <div class="chart-legend">
              <span class="legend-bar">当日需水量</span>
              <span class="legend-line">累计需水量</span>
            </div>
          </div>

          <p v-if="!chartSeries.length" class="chart-demo-label">{{ trendLoading ? '正在读取趋势数据…' : '演示曲线 · 暂无服务器趋势数据' }}</p>
          <svg class="trend-chart" viewBox="0 0 520 150" preserveAspectRatio="none">
            <defs>
              <linearGradient id="stageGradient" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stop-color="rgba(56, 189, 248, 0.1)" />
                <stop offset="52%" stop-color="rgba(34, 197, 94, 0.12)" />
                <stop offset="100%" stop-color="rgba(245, 158, 11, 0.1)" />
              </linearGradient>
              <linearGradient id="etaBarGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="rgba(125, 211, 252, 0.82)" />
                <stop offset="100%" stop-color="rgba(14, 165, 233, 0.18)" />
              </linearGradient>
              <filter id="cumulativeGlow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect x="0" y="0" width="520" height="150" fill="url(#stageGradient)" />
            <rect
              v-for="stage in stageBands"
              :key="stage.name"
              class="stage-band"
              :x="stage.x"
              y="15"
              :width="stage.width"
              height="116"
            />
            <line class="chart-axis" x1="0" y1="132" x2="520" y2="132" />

            <g>
              <rect
                v-for="bar in dailyBars"
                :key="bar.date"
                class="daily-bar"
                :x="bar.x"
                :y="bar.y"
                :width="bar.width"
                :height="bar.height"
              />
            </g>

            <path class="cumulative-line" :d="cumulativePath" />
            <line
              class="current-line"
              :x1="currentPoint.x"
              y1="14"
              :x2="currentPoint.x"
              y2="132"
            />
            <circle
              class="current-dot"
              :cx="currentPoint.x"
              :cy="currentPoint.y"
              r="5"
            />
            <circle
              class="current-dot-pulse"
              :cx="currentPoint.x"
              :cy="currentPoint.y"
              r="9"
            />

            <g v-if="hoveredChartPoint" class="hover-marker">
              <line
                :x1="hoveredChartPoint.x"
                y1="14"
                :x2="hoveredChartPoint.x"
                y2="132"
              />
              <circle :cx="hoveredChartPoint.x" :cy="hoveredChartPoint.y" r="4.5" />
            </g>

            <rect
              v-for="hit in chartHitAreas"
              :key="hit.date"
              class="chart-hit-area"
              :x="hit.x"
              y="0"
              :width="hit.width"
              height="150"
              @mouseenter="setChartHover(hit.index)"
              @mousemove="setChartHover(hit.index)"
              @mouseleave="clearChartHover"
            />
          </svg>

          <div class="chart-footer">
            <span>{{ startDateText }}<br />生育初期</span>
            <span>快速生长期</span>
            <span>{{ endDateText }}<br />成熟期</span>
          </div>

          <div
            v-if="hoveredChartPoint"
            class="chart-tooltip"
            :style="chartTooltipStyle"
          >
            <b>{{ hoveredChartPoint.date }}</b>
            <span>当日需水量：{{ hoveredChartPoint.dailyEta }} m³</span>
            <span>累计需水量：{{ hoveredChartPoint.cumulativeEta }} m³</span>
          </div>
        </div>
      </div>
      <p v-if="cropWaterShowCylinder" class="water-allocation-note">水柱按可见地块面积分配作物汇总耗水量。</p>
      </div>
    </section>
    <water-date-timeline :index="Number(dayIndex)" :count="totalDays" :playing="cropWaterIsPlaying" :date="currentDateText" :start="startDateText" :end="endDateText" @select-index="selectTimelineIndex" @select-date="selectTimelineDate" @toggle-play="togglePlayback"/>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import useMapStore from "@/stores/map";
import WaterDateTimeline from "@/components/part/water-date-timeline.vue";
import { usePanelDrag } from "@/composables/usePanelDrag";

const store = useMapStore();
const { panel, panelStyle, startDrag } = usePanelDrag();
const collapsed = ref(false);
const summaryStatus = ref("正在读取耗水数据…");
const trendLoading = ref(false);
let disposed = false;
const waterApiBase =
  process.env.VUE_APP_CROP_WATER_API_BASE || "http://localhost:5000";
console.info("Crop water summary API base:", waterApiBase);
const {
  cropWaterShowCylinder,
  cropWaterActiveMetric,
  cropWaterActiveDate,
  cropWaterActiveCrop,
  cropWaterViewportCrop,
  cropWaterSummaryData,
  cropWaterIsPlaying,
  cropWaterLockViewport,
} = storeToRefs(store);

store.isShowFeautureInfo = false;

const cropDateRanges = {
  default: { start: "2026-01-01", end: "2026-09-27" },
};
const activeCropDateRange = computed(
  () => cropDateRanges.default
);
const startDate = computed(() => new Date(activeCropDateRange.value.start));
const endDate = computed(() => new Date(activeCropDateRange.value.end));
const startDateText = computed(() => formatDate(startDate.value));
const endDateText = computed(() => formatDate(endDate.value));
const dayIndex = ref(0);
const chartSeries = ref([]);
const hoveredChartIndex = ref(null);
const isThumbDragging = ref(false);
let chartRequestSeq = 0;
let summaryRequestSeq = 0;
let playbackTimer = null;
let thumbDragState = null;
const summaryCache = new Map();
const summaryPendingCache = new Map();

const chartWidth = 520;

const chartTop = 14;
const chartBottom = 132;
const barTop = 58;

const cropTypes = [
  { code: 1, name: "winterWheat", label: "冬小麦", color: "#5ee34b", factor: 0.86 },
  { code: 2, name: "springWheat", label: "春小麦", color: "#a4db52", factor: 0.9 },
  { code: 3, name: "cotton", label: "棉花", color: "#c08be8", factor: 1.02 },
  { code: 4, name: "corn", label: "玉米", color: "#f8d34a", factor: 1.18 },
  { code: 5, name: "rice", label: "水稻", color: "#38c7cf", factor: 1.15 },
  { code: 8, name: "winterWheatCorn", label: "冬小麦—玉米轮作", color: "#f28c45", factor: 1 },
  { code: 9, name: "winterWheatRice", label: "冬小麦—水稻轮作", color: "#4fa0ec", factor: 1 },
];

const totalDays = computed(() => {
  const diff = endDate.value.getTime() - startDate.value.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
});

const currentDate = computed(() => {
  const date = new Date(startDate.value);
  date.setDate(startDate.value.getDate() + Number(dayIndex.value));
  return date;
});

const currentDateText = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = String(currentDate.value.getMonth() + 1).padStart(2, "0");
  const day = String(currentDate.value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
});





watch(
  () => [cropWaterActiveCrop.value, cropWaterActiveDate.value],
  () => {
    loadSummaryData();
  },
  { immediate: true }
);

watch(
  () => [cropWaterActiveCrop.value, cropWaterActiveDate.value],
  () => {
    loadTrendSeries();
  },
  { immediate: true }
);

watch(
  () => cropWaterActiveDate.value,
  (date) => {
    const nextIndex = getDayIndexFromDate(date);

    if (Number.isFinite(nextIndex) && Number(dayIndex.value) !== nextIndex) {
      dayIndex.value = nextIndex;
    }
  }
);

watch(
  () => cropWaterActiveCrop.value,
  () => {
    const nextIndex = getDayIndexFromDate(cropWaterActiveDate.value);
    dayIndex.value = Number.isFinite(nextIndex) ? nextIndex : 0;
    cropWaterActiveDate.value = currentDateText.value;
  }
);

watch(
  () => cropWaterIsPlaying.value,
  (isPlaying) => {
    if (isPlaying) {
      startPlaybackTimer();
    } else {
      stopPlaybackTimer();
    }
  }
);

onMounted(() => {
  if (!cropTypes.some((item) => item.name === cropWaterActiveCrop.value)) {
    cropWaterActiveCrop.value = cropTypes[0].name;
    cropWaterViewportCrop.value = cropTypes[0].name;
  }
  dayIndex.value = getDayIndexFromDate(cropWaterActiveDate.value) ?? 0;
  changeDate();
  cropWaterShowCylinder.value = false;
});

onBeforeUnmount(() => {
  cropWaterShowCylinder.value = false;
  cropWaterIsPlaying.value = false;
  stopPlaybackTimer();
  stopThumbDrag();
  chartRequestSeq++;
  summaryRequestSeq++;
  disposed = true;
});

function changeCrop(crop) {
  cropWaterIsPlaying.value = false;
  stopPlaybackTimer();
  cropWaterActiveCrop.value = crop;
  cropWaterViewportCrop.value = crop;
  dayIndex.value = 0;
  cropWaterActiveDate.value = currentDateText.value;
}

function changeMetric(metric) {
  cropWaterActiveMetric.value = metric;
}

function selectTimelineIndex(index) {
  dayIndex.value = Math.max(0, Math.min(totalDays.value - 1, index));
  changeDate();
}
function selectTimelineDate(date) {
  const index = getDayIndexFromDate(date);
  if (index !== null) selectTimelineIndex(index);
}

function changeDate() {
  cropWaterActiveDate.value = currentDateText.value;
}

function toggleCylinder() {
  cropWaterShowCylinder.value = !cropWaterShowCylinder.value;
}

function toggleViewportLock() {
  cropWaterLockViewport.value = !cropWaterLockViewport.value;

  console.info("[crop-water] viewport lock toggled", {
    locked: cropWaterLockViewport.value,
    isPlaying: cropWaterIsPlaying.value,
  });

  if (!cropWaterLockViewport.value) {
    cropWaterIsPlaying.value = true;
  }
}

function togglePlayback() {
  cropWaterIsPlaying.value = !cropWaterIsPlaying.value;

  if (cropWaterIsPlaying.value) {
    cropWaterLockViewport.value = false;
  }

  console.info("[crop-water] playback toggled", {
    isPlaying: cropWaterIsPlaying.value,
    locked: cropWaterLockViewport.value,
  });
}



function handleThumbPointerMove(event) {
  if (!thumbDragState) return;

  if (Math.abs(event.clientX - thumbDragState.startX) > 3) {
    thumbDragState.moved = true;
  }

  if (!thumbDragState.moved) return;

  updateDayIndexFromClientX(event.clientX, thumbDragState.rect);
}

function handleThumbPointerUp(event) {
  if (!thumbDragState) return;

  if (thumbDragState.moved) {
    updateDayIndexFromClientX(event.clientX, thumbDragState.rect);
  } else {
    togglePlayback();
  }

  stopThumbDrag();
}

function stopThumbDrag() {
  window.removeEventListener("pointermove", handleThumbPointerMove);
  window.removeEventListener("pointerup", handleThumbPointerUp);
  thumbDragState = null;
  isThumbDragging.value = false;
}

function updateDayIndexFromClientX(clientX, rect) {
  const usableWidth = Math.max(rect.width - 34, 1);
  const localX = Math.min(Math.max(clientX - rect.left - 17, 0), usableWidth);
  const ratio = localX / usableWidth;

  dayIndex.value = Math.round(ratio * (totalDays.value - 1));
  changeDate();
}

function startPlaybackTimer() {
  stopPlaybackTimer();

  playbackTimer = setInterval(() => {
    const nextIndex = Number(dayIndex.value) + 1;
    dayIndex.value = nextIndex >= totalDays.value ? 0 : nextIndex;
    changeDate();
  }, 2800);
}

function stopPlaybackTimer() {
  if (playbackTimer) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
}

function getDayIndexFromDate(date) {
  const time = new Date(date).getTime();

  if (!Number.isFinite(time)) {
    return null;
  }

  return Math.min(
    Math.max(
      Math.round((time - startDate.value.getTime()) / (1000 * 60 * 60 * 24)),
      0
    ),
    totalDays.value - 1
  );
}

async function loadSummaryData() {
  const requestSeq = ++summaryRequestSeq;
  const crop = cropWaterActiveCrop.value;
  const date = cropWaterActiveDate.value;
  summaryStatus.value = "正在读取耗水数据…";
  const summary = await loadSummaryByDate(crop, date, {
    log: true,
  });

  if (
    disposed || requestSeq !== summaryRequestSeq ||
    crop !== cropWaterActiveCrop.value ||
    date !== cropWaterActiveDate.value
  ) {
    return;
  }

  cropWaterSummaryData.value = summary;
  summaryStatus.value = summary ? "耗水数据已接入" : "当前日期暂无耗水数据";
  console.info("[crop-water] summary data applied", {
    crop,
    apiCrop: getSummaryApiCrop(crop),
    date,
    data: summary,
  });
}
async function loadTrendSeries() {
  const requestSeq = ++chartRequestSeq;
  trendLoading.value = true;
  const crop = cropWaterActiveCrop.value;
  const dates = buildDateList(7);
  const rows = await Promise.all(
    dates.map(async (date) => ({
      date,
      summary: await loadSummaryByDate(crop, date),
    }))
  );

  if (disposed || requestSeq !== chartRequestSeq) return;
  trendLoading.value = false;

  chartSeries.value = rows
    .filter((item) => item.summary)
    .map(({ date, summary }) => {
      const dailyEta = getFiniteSummaryValue(summary, "daily_water_demand_m3");
      const blueWater = getFiniteSummaryValue(summary, "daily_blue_water_m3");
      const greenWater = getFiniteSummaryValue(summary, "daily_green_water_m3");
      const cumulativeEta = getFiniteSummaryValue(
        summary,
        "cumulative_water_demand_m3"
      );

      return {
        date,
        dailyEta: dailyEta ?? 0,
        blueWater: blueWater ?? 0,
        greenWater: greenWater ?? 0,
        cumulativeEta: cumulativeEta ?? 0,
      };
    });
}

async function loadSummaryByDate(crop, date, options = {}) {
  const apiCrop = getSummaryApiCrop(crop);
  const cacheKey = `${apiCrop}:${date}`;

  if (summaryCache.has(cacheKey)) {
    const cached = summaryCache.get(cacheKey);
    if (options.log) {
      console.info("Crop daily summary water API cached response:", {
        crop,
        apiCrop,
        date,
        data: cached,
      });
    }
    return cached;
  }

  if (summaryPendingCache.has(cacheKey)) {
    return summaryPendingCache.get(cacheKey);
  }

  const url = `${waterApiBase}/api/water/summary/${apiCrop}/${date}`;
  const request = fetch(url)
    .then(async (response) => {
      const result = await readApiResponseBody(response);

      if (options.log) {
        console.info("Crop daily summary water API response:", {
          crop,
          apiCrop,
          date,
          status: response.status,
          ok: response.ok,
          url,
          data: result,
        });
      }

      if (!response.ok) {
        summaryCache.set(cacheKey, null);
        return null;
      }

      const row = result?.data?.data ?? result?.data ?? result;
      console.info("[crop-water] summary row parsed", {
        crop,
        apiCrop,
        date,
        row,
      });
      summaryCache.set(cacheKey, row || null);
      return row || null;
    })
    .catch((error) => {
      if (options.log) {
        console.warn("Crop daily summary water API request failed.", error);
      }
      summaryCache.set(cacheKey, null);
      return null;
    })
    .finally(() => {
      summaryPendingCache.delete(cacheKey);
    });

  summaryPendingCache.set(cacheKey, request);
  return request;
}

function getSummaryApiCrop(crop) {
  const selected = cropTypes.find((item) => item.name === crop);
  return String(selected?.code ?? 1);
}

async function readApiResponseBody(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function buildMockChartSeries(dates) {
  return buildFixedCropChartSeries(dates, cropWaterActiveCrop.value);
}

function buildFixedCropChartSeries(dates, crop) {
  let cumulativeEta = 0;
  const profile = getFixedCropChartProfile(crop);

  return dates.map((date, index) => {
    const progress = dates.length <= 1 ? 0 : index / (dates.length - 1);
    const normalizedDaily = getInterpolatedProfileValue(profile.points, progress);
    const dailyEta = normalizedDaily * profile.scale;
    const blueWater = dailyEta * profile.blueRatio;
    const greenWater = dailyEta - blueWater;

    cumulativeEta += dailyEta;

    return {
      date,
      dailyEta,
      blueWater,
      greenWater,
      cumulativeEta,
    };
  });
}

function getFixedCropChartProfile(crop) {
  const profiles = {
    wheat: {
      scale: 105,
      blueRatio: 0.34,
      points: [
        [0, 0.52],
        [0.1, 0.68],
        [0.22, 0.95],
        [0.34, 0.82],
        [0.48, 0.5],
        [0.64, 0.34],
        [0.78, 0.42],
        [0.9, 0.58],
        [1, 0.62],
      ],
    },
    corn: {
      scale: 150,
      blueRatio: 0.48,
      points: [
        [0, 0.28],
        [0.1, 0.4],
        [0.2, 0.62],
        [0.34, 1],
        [0.5, 0.92],
        [0.64, 0.54],
        [0.78, 0.42],
        [0.9, 0.5],
        [1, 0.38],
      ],
    },
    vegetables: {
      scale: 126,
      blueRatio: 0.44,
      points: [
        [0, 0.32],
        [0.12, 0.5],
        [0.24, 0.76],
        [0.38, 1],
        [0.54, 0.9],
        [0.7, 0.68],
        [0.84, 0.58],
        [1, 0.42],
      ],
    },
  };

  return profiles[crop] || profiles.wheat;
}

function getInterpolatedProfileValue(points, progress) {
  const t = Math.min(Math.max(Number(progress) || 0, 0), 1);

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];

    if (t >= x1 && t <= x2) {
      const localT = (t - x1) / Math.max(x2 - x1, 0.0001);
      const easedT = localT * localT * (3 - 2 * localT);
      return y1 + (y2 - y1) * easedT;
    }
  }

  return points[points.length - 1]?.[1] ?? 0.5;
}



const currentData = computed(() => {
  const summary = cropWaterSummaryData.value;

  return {
    dailyBlueWater: formatSummaryMetric(summary, "daily_blue_water_m3"),
    dailyGreenWater: formatSummaryMetric(summary, "daily_green_water_m3"),
    dailyWaterDemand: formatSummaryMetric(summary, "daily_water_demand_m3"),
    cumulativeBlueWater: formatSummaryMetric(
      summary,
      "cumulative_blue_water_m3"
    ),
    cumulativeGreenWater: formatSummaryMetric(
      summary,
      "cumulative_green_water_m3"
    ),
    cumulativeWaterDemand: formatSummaryMetric(
      summary,
      "cumulative_water_demand_m3"
    ),
  };
});

const totalWaterMixRatio = computed(() => {
  const summary = cropWaterSummaryData.value;
  const blue = getFiniteSummaryValue(summary, "cumulative_blue_water_m3") ?? 0;
  const green = getFiniteSummaryValue(summary, "cumulative_green_water_m3") ?? 0;

  return getGreenWaterRatio(blue, green);
});

const totalWaterCardStyle = computed(() => {
  const color = mixRgbColor(
    { r: 42, g: 135, b: 235 },
    { r: 42, g: 196, b: 112 },
    amplifyMixRatio(totalWaterMixRatio.value)
  );

  return {
    "--metric-accent": color,
    "--metric-accent-soft": color.replace("rgb", "rgba").replace(")", ", 0.18)"),
  };
});







function getGreenWaterRatio(blue, green) {
  const safeBlue = Number.isFinite(blue) && blue > 0 ? blue : 0;
  const safeGreen = Number.isFinite(green) && green > 0 ? green : 0;
  const total = safeBlue + safeGreen;

  return total > 0 ? safeGreen / total : 0.5;
}

function mixRgbColor(fromColor, toColor, ratio) {
  const t = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const r = Math.round(fromColor.r + (toColor.r - fromColor.r) * t);
  const g = Math.round(fromColor.g + (toColor.g - fromColor.g) * t);
  const b = Math.round(fromColor.b + (toColor.b - fromColor.b) * t);

  return `rgb(${r}, ${g}, ${b})`;
}

function amplifyMixRatio(ratio) {
  const t = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const stretched = Math.min(Math.max((t - 0.5) * 1.8 + 0.5, 0), 1);

  if (stretched < 0.5) {
    return Math.pow(stretched * 2, 1.45) * 0.5;
  }

  return 1 - Math.pow((1 - stretched) * 2, 1.45) * 0.5;
}



function formatMetricValue(value) {
  if (value === undefined || value === null || value === "") return "--";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function getFiniteSummaryValue(summary, key) {
  if (!summary) return null;

  const value = summary[key];
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatSummaryMetric(summary, key) {
  return formatMetricValue(getFiniteSummaryValue(summary, key));
}









/* function getMockData(index) {
  const factor = getCropFactor();
  const seasonalIndex = Number(index) % 365;
  const curve = getCropWaterCurve();
  const daily =
    (curve.base +
      Math.max(Math.sin(seasonalIndex / 17), 0) * 0.35 +
      curve.waves.reduce(
        (sum, wave) =>
          sum +
          Math.exp(-Math.pow((seasonalIndex - wave.center) / wave.width, 2)) *
            wave.height,
        0
      )) *
    factor;
  const total = (index * 1.35 + Math.max(index - 80, 0) * 1.2) * factor;

  return {
    dailyWater: daily,
    blueWater: total * 0.43,
    greenWater: total * 0.57,
    waterFootprint: total * 6.2,
    irrigationWater: total * 0.86 * 0.43,
    totalBlueWater: total * 43,
    totalGreenWater: total * 57,
  };
} */

const activeChartSeries = computed(() =>
  chartSeries.value.length ? chartSeries.value : buildMockChartSeries(buildDateList())
);

const dailyMax = computed(() =>
  Math.max(...activeChartSeries.value.map((item) => item.dailyEta), 1)
);

const cumulativeMax = computed(() =>
  Math.max(...activeChartSeries.value.map((item) => item.cumulativeEta), 1)
);

const dailyBars = computed(() => {
  const values = activeChartSeries.value;
  const slotWidth = chartWidth / Math.max(values.length, 1);
  const barWidth = Math.max(slotWidth * 0.62, 1);

  return values.map((item, index) => {
    const height = (item.dailyEta / dailyMax.value) * (chartBottom - barTop);

    return {
      date: item.date,
      x: index * slotWidth + (slotWidth - barWidth) / 2,
      y: chartBottom - height,
      width: barWidth,
      height,
    };
  });
});

const cumulativePoints = computed(() =>
  activeChartSeries.value.map((item, index) => ({
    x: getChartX(index),
    y:
      chartTop +
      (1 - item.cumulativeEta / cumulativeMax.value) * (chartBottom - chartTop),
  }))
);

const cumulativePath = computed(() => buildSmoothPath(cumulativePoints.value));

const currentPoint = computed(() => {
  const index = activeChartSeries.value.reduce((nearest, item, index, list) =>
    Math.abs(new Date(item.date).getTime() - currentDate.value.getTime()) < Math.abs(new Date(list[nearest].date).getTime() - currentDate.value.getTime()) ? index : nearest, 0);
  const point = cumulativePoints.value[index] ?? { x: 0, y: chartBottom };

  return {
    x: point.x,
    y: point.y,
  };
});

const stageBands = computed(() => [
  { name: "生育初期", x: 0, width: chartWidth * 0.28 },
  { name: "快速生长期", x: chartWidth * 0.28, width: chartWidth * 0.47 },
  { name: "成熟期", x: chartWidth * 0.75, width: chartWidth * 0.25 },
]);

const chartHitAreas = computed(() => {
  const values = activeChartSeries.value;
  const slotWidth = chartWidth / Math.max(values.length, 1);

  return values.map((item, index) => ({
    date: item.date,
    index,
    x: index * slotWidth,
    width: slotWidth,
  }));
});

const hoveredChartPoint = computed(() => {
  if (hoveredChartIndex.value === null) return null;

  const index = hoveredChartIndex.value;
  const item = activeChartSeries.value[index];
  const point = cumulativePoints.value[index];

  if (!item || !point) return null;

  return {
    x: point.x,
    y: point.y,
    date: item.date,
    dailyEta: item.dailyEta.toFixed(2),
    blueWater: item.blueWater.toFixed(2),
    greenWater: item.greenWater.toFixed(2),
    cumulativeEta: item.cumulativeEta.toFixed(2),
  };
});

const chartTooltipStyle = computed(() => {
  const point = hoveredChartPoint.value;
  if (!point) return {};

  const leftPercent = (point.x / chartWidth) * 100;

  return {
    left: `${Math.min(Math.max(leftPercent, 16), 84)}%`,
  };
});

function setChartHover(index) {
  hoveredChartIndex.value = index;
}

function clearChartHover() {
  hoveredChartIndex.value = null;
}

function buildDateList(step = 1) {
  const dates = [];

  for (let i = 0; i < totalDays.value; i += step) {
    dates.push(formatDate(getDateByIndex(i)));
  }

  const finalDate = formatDate(getDateByIndex(totalDays.value - 1));
  if (dates[dates.length - 1] !== finalDate) dates.push(finalDate);

  return dates;
}

function getDateByIndex(index) {
  const date = new Date(startDate.value);
  date.setDate(startDate.value.getDate() + Number(index));
  return date;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getChartX(index) {
  const count = Math.max(activeChartSeries.value.length - 1, 1);
  return (index / count) * chartWidth;
}

function buildSmoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const previous = points[i - 1] || current;
    const afterNext = points[i + 2] || next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }

  return path;
}
</script>

<style scoped>
.crop-water-bottom { position: static; color: var(--ink-900); pointer-events: none; }
.crop-water-layout { position: fixed; top: calc(var(--header-h) + var(--tabs-h) + 11px); left: 11px; z-index: 1000; width: min(390px, calc(100vw - 90px)); box-sizing: border-box; pointer-events: auto; }
.crop-water-head { display: flex; align-items: center; justify-content: space-between; height: 45px; padding: 0 15px; border-bottom: 1px solid #e6edf5; cursor: move; touch-action: none; user-select: none; }
.panel-title { color: var(--ink-700); font-size: 16px; font-weight: 600; }
.water-collapse { padding: 0 4px; color: var(--ink-300); font-size: 20px; background: none; border: 0; cursor: pointer; }
.crop-water-body { max-height: calc(100vh - var(--header-h) - var(--tabs-h) - 190px); padding: 12px 15px 15px; overflow-y: auto; scrollbar-width: thin; }
.water-status { margin: 0 0 12px; color: var(--ink-300); font-size: 11px; }
.crop-water-controls { display: flex; flex-wrap: wrap; gap: 8px; }
.crop-type-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; width: 100%; margin-bottom: 4px; }
.legend-item { display: flex; align-items: center; min-width: 0; padding: 8px; border: 1px solid #e1eaf6; border-radius: 6px; background: #f6f9fe; color: var(--ink-900); font: inherit; cursor: pointer; }
.legend-item.clicked { border-color: var(--brand-400); background: #eaf4ff; }
.crop-water-color { flex: 0 0 auto; width: 12px; height: 12px; margin-right: 6px; border-radius: 3px; }
.crop-water-name { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-900); font-size: 12px; line-height: 1.4; }
.crop-water-name b { font-size: 10px; color: var(--ink-300); }
.legend-item.clicked .crop-water-name { color: var(--brand-500); font-weight: 600; }
.toggle-button { flex: 1; min-height: 32px; border: 1px solid #cfe0f5; border-radius: 6px; background: #eef5ff; color: var(--ink-500); font: inherit; font-size: 12px; cursor: pointer; }
.toggle-button.active { color: #fff; border-color: var(--brand-500); background: linear-gradient(#2c93ff, #156ee4); }
.crop-water-main { margin-top: 14px; }
.metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.metric-card { min-width: 0; padding: 10px 9px; text-align: left; background: #f5f8fd; border: 1px solid #e3ebf5; border-radius: 6px; font: inherit; color: var(--ink-900); cursor: pointer; }
.metric-card.active { background: var(--metric-accent-soft, #eaf4ff); border-color: var(--metric-accent, var(--brand-400)); }
.metric-card-static { cursor: default; }
.metric-card span { display: block; color: #708198; font-size: 11px; }
.metric-card strong { display: block; margin-top: 5px; color: var(--metric-accent, var(--ink-500)); font-size: 16px; overflow-wrap: anywhere; }
.metric-card em { color: var(--ink-300); font-size: 10px; font-style: normal; font-weight: 400; }
.chart-card { position: relative; margin-top: 14px; padding-top: 12px; border-top: 1px solid #e6edf5; }
.chart-title-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 7px; }
.chart-title { font-size: 13px; font-weight: 600; color: var(--ink-700); }
.chart-legend { display: flex; gap: 10px; color: var(--ink-300); font-size: 10px; }
.chart-legend span::before { content: ''; display: inline-block; width: 8px; height: 6px; margin-right: 4px; border-radius: 1px; background: #46acfa; }
.chart-legend .legend-line::before { height: 2px; background: #2db284; vertical-align: middle; }
.chart-demo-label { margin: 8px 0 0; color: var(--ink-300); font-size: 10px; }
.trend-chart { display: block; width: 100%; height: 150px; margin-top: 10px; overflow: visible; }
.stage-band { fill: rgba(56, 189, 248, .05); }
.stage-band:nth-of-type(2) { fill: rgba(34, 197, 94, .05); }
.chart-axis { stroke: #cfe0f5; stroke-width: 1; }
.daily-bar { fill: url(#etaBarGradient); }
.cumulative-line { fill: none; stroke: #2db284; stroke-width: 2.5; }
.current-line { stroke: #156ee4; stroke-width: 1; stroke-dasharray: 4 4; }
.current-dot { fill: #fff; stroke: #156ee4; stroke-width: 2; }
.current-dot-pulse { fill: #156ee420; stroke: #156ee440; stroke-width: 1; }
.hover-marker line { stroke: #7890aa; stroke-dasharray: 3 3; }
.hover-marker circle { fill: #fff; stroke: #2db284; stroke-width: 2; }
.chart-hit-area { fill: transparent; cursor: crosshair; }
.chart-footer { display: flex; justify-content: space-between; margin-top: 5px; color: var(--ink-300); font-size: 10px; line-height: 1.5; }
.chart-footer span:last-child { text-align: right; }
.chart-tooltip { position: absolute; bottom: 48px; transform: translateX(-50%); max-width: 95%; padding: 9px 11px; background: var(--panel-bg); border: 1px solid #d8e5f5; border-radius: 6px; box-shadow: var(--panel-shadow); color: var(--ink-900); font-size: 11px; white-space: nowrap; pointer-events: none; }
.chart-tooltip b, .chart-tooltip span { display: block; }
.chart-tooltip b { color: var(--ink-700); margin-bottom: 4px; }
.water-allocation-note { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: var(--ink-300); }
button:focus-visible { outline: 2px solid var(--brand-400); outline-offset: 2px; }
@media (max-width: 520px) { .crop-water-layout { width: calc(100vw - 78px); } .metric-card strong { font-size: 14px; } }
</style>
