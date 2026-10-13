function unwrapApiData(payload) {
  return payload?.data?.data ?? payload?.data ?? payload
}

function pickNumber(source, ...keys) {
  for (const key of keys) {
    const raw = source?.[key]
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return null
}

export function normalizeAnnualData(payload) {
  const row = unwrapApiData(payload)
  if (!row || typeof row !== 'object') return null
  const monthlySource = row.monthly ?? row.monthly_water ?? row.monthlyWater ?? row.monthly_values
  const monthly = Array.isArray(monthlySource)
    ? monthlySource.map(item => Number(item?.value ?? item?.water ?? item)).filter(Number.isFinite)
    : null
  const blueRaw = pickNumber(row, 'daily_blue_water_m3', 'blue', 'blue_water', 'blueWater', 'total_blue_water_m3', 'totalBlueWaterM3')
  const greenRaw = pickNumber(row, 'daily_green_water_m3', 'green', 'green_water', 'greenWater', 'total_green_water_m3', 'totalGreenWaterM3')
  const irrigationRaw = pickNumber(row, 'irrigation_applied_m3', 'irrigation', 'irrigation_water', 'irrigationWater', 'total_irrigation_use_m3', 'totalIrrigationUseM3')
  const soilRaw = pickNumber(row, 'soil', 'soil_water', 'soilWater', 'total_soil_water_m3', 'totalSoilWaterM3')
  const dailyTotalRaw = pickNumber(row, 'daily_water_demand_m3', 'daily_total_water_m3', 'total', 'total_water', 'totalWater', 'total_water_m3', 'totalWaterM3')
  const cumulativeGreenRaw = pickNumber(row, 'cumulative_green_water_m3', 'total_green_water_m3', 'totalGreenWaterM3')
  const cumulativeTotalRaw = pickNumber(row, 'cumulative_water_demand_m3', 'cumulative_total_water_m3')
  if ([blueRaw, greenRaw, irrigationRaw, soilRaw, dailyTotalRaw, cumulativeGreenRaw, cumulativeTotalRaw].every(value => value === null) && !monthly?.length) return null
  const divisor = row.unit === '万 m³' || row.unit === '万m3' ? 1 : 10000
  const blue = blueRaw === null ? null : blueRaw / divisor
  const green = greenRaw === null ? null : greenRaw / divisor
  return {
    blue,
    green,
    irrigation: irrigationRaw === null ? null : irrigationRaw / divisor,
    soil: soilRaw === null ? null : soilRaw / divisor,
    totalGreen: cumulativeGreenRaw === null ? green : cumulativeGreenRaw / divisor,
    total: cumulativeTotalRaw === null
      ? (dailyTotalRaw === null ? (blue !== null && green !== null ? blue + green : null) : dailyTotalRaw / divisor)
      : cumulativeTotalRaw / divisor,
    monthly: monthly?.length === 12 ? monthly : []
  }
}

export function normalizeChangeData(payload) {
  const envelope = payload?.data?.data ? payload.data : payload
  const row = unwrapApiData(payload)
  if (!row || typeof row !== 'object') return null
  const stats = row.stats ?? row.summary ?? row
  const rising = pickNumber(stats, 'increase_field_count', 'rising', 'increase', 'increased', 'rising_count', 'risingCount', 'increase_count', 'increaseCount', 'increased_count', 'increasedCount', 'up_count', 'upCount')
  const falling = pickNumber(stats, 'decrease_field_count', 'falling', 'decrease', 'decreased', 'falling_count', 'fallingCount', 'decrease_count', 'decreaseCount', 'decreased_count', 'decreasedCount', 'down_count', 'downCount')
  const stable = pickNumber(stats, 'unchanged_field_count', 'stable', 'unchanged', 'unchanged_count', 'stable_count', 'stableCount', 'unchangedCount', 'same_count', 'sameCount')
  if ([rising, falling, stable].some(value => value === null)) return null
  const total = Math.max(rising + falling + stable, 1)
  let historyRows = []
  const history = row.history ?? row.trend ?? row.yearly
  if (Array.isArray(history)) {
    const parsed = history.map(item => ({
      year: Number(item.year),
      value: Number(item.value ?? item.water ?? item.total)
    })).filter(item => Number.isFinite(item.year) && Number.isFinite(item.value))
    historyRows = parsed
  }
  return {
    history: historyRows,
    rising,
    risingRate: Number((pickNumber(stats, 'risingRate', 'rising_rate') ?? rising / total * 100).toFixed(1)),
    falling,
    fallingRate: Number((pickNumber(stats, 'fallingRate', 'falling_rate') ?? falling / total * 100).toFixed(1)),
    stable,
    stableRate: Number((pickNumber(stats, 'stableRate', 'stable_rate') ?? stable / total * 100).toFixed(1)),
    researchFieldCount: pickNumber(row, 'research_field_count', 'researchFieldCount'),
    currentFieldCount: pickNumber(row, 'current_field_count', 'currentFieldCount'),
    previousFieldCount: pickNumber(row, 'previous_field_count', 'previousFieldCount'),
    comparableFieldCount: pickNumber(row, 'comparable_field_count', 'comparableFieldCount') ?? rising + falling + stable,
    currentTotal: pickNumber(row, 'current_total_m3', 'current_total', 'current_total_eta_m3', 'currentTotal', 'current_value_total', 'currentValueTotal'),
    previousTotal: pickNumber(row, 'previous_total_m3', 'previous_total', 'previous_total_eta_m3', 'previousTotal', 'previous_value_total', 'previousValueTotal'),
    deltaTotal: pickNumber(row, 'delta_total', 'delta_total_eta_m3', 'delta_m3', 'deltaTotal', 'total_delta', 'totalDelta'),
    averageDelta: pickNumber(row, 'average_delta_m3', 'averageDeltaM3'),
    deltaRate: pickNumber(row, 'delta_rate', 'deltaRate'),
    previousDate: row.previous_date ?? row.previousDate ?? envelope?.previous_date ?? envelope?.previousDate ?? null,
    previousMonth: row.previous_month ?? row.previousMonth ?? envelope?.previous_month ?? envelope?.previousMonth ?? null,
    scope: (row.data_scope ?? envelope?.data_scope) === 'research_region' ? '全研究区' : '全研究区'
  }
}
