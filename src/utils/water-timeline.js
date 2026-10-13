const YEAR_RANGES = [
  ["2024-01-01", "2024-09-27"],
  ["2025-01-01", "2025-09-27"],
  ["2026-01-01", "2026-09-27"],
];

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildTimelineDates() {
  return YEAR_RANGES.flatMap(([start, end]) => {
    const dates = [];
    const cursor = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (cursor <= last) {
      dates.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  });
}

export const waterTimelineDates = buildTimelineDates();
export const waterTimelineStartDate = waterTimelineDates[0];
export const waterTimelineEndDate = waterTimelineDates[waterTimelineDates.length - 1];

// 数据库按种植年度组织：上一年10月到当年9月属于当年年度。
// 例如 2024-10-21 应请求 year=2025。
export function getWaterSeasonYear(date) {
  const [year, month] = String(date || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return month >= 10 ? year + 1 : year;
}

export function getWaterTimelineDate(index) {
  const safeIndex = Math.max(0, Math.min(waterTimelineDates.length - 1, Number(index) || 0));
  return waterTimelineDates[safeIndex];
}

export function getWaterTimelineIndex(date) {
  const target = Date.parse(`${date}T00:00:00`);
  if (!Number.isFinite(target)) return null;

  let low = 0;
  let high = waterTimelineDates.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleTime = Date.parse(`${waterTimelineDates[middle]}T00:00:00`);
    if (middleTime === target) return middle;
    if (middleTime < target) low = middle + 1;
    else high = middle - 1;
  }

  if (high < 0) return 0;
  if (low >= waterTimelineDates.length) return waterTimelineDates.length - 1;
  const lowDistance = Math.abs(Date.parse(`${waterTimelineDates[low]}T00:00:00`) - target);
  const highDistance = Math.abs(Date.parse(`${waterTimelineDates[high]}T00:00:00`) - target);
  return lowDistance < highDistance ? low : high;
}
