/**
 * 10 类作物的唯一来源：编码、名称、配色、图标。
 *
 * 颜色必须和 GeoServer 的 agri-agent:crop-style-10 完全一致
 * （见 geoserver/crop-style-10.sld），改颜色要两边同时改，
 * 否则图例的颜色和地图上的颜色会对不上。
 */

export const CROP_TYPES = [
  { code: 1, name: '早熟谷物', short: '早熟谷物', color: '#F2D24B', icon: 'cropEarlyGrain' },
  { code: 2, name: '春季谷物', short: '春季谷物', color: '#E07B2E', icon: 'cropSpringGrain' },
  { code: 3, name: '玉米', short: '玉米', color: '#A3D14A', icon: 'cropCorn' },
  { code: 4, name: '水稻', short: '水稻', color: '#3E9FE0', icon: 'cropRice' },
  { code: 5, name: '油料作物', short: '油料', color: '#E86FA6', icon: 'cropOil' },
  { code: 6, name: '饲草作物', short: '饲草', color: '#35BFA0', icon: 'cropForage' },
  { code: 7, name: '糖用甜菜/长生育期作物', short: '甜菜', color: '#9B72D9', icon: 'cropBeet' },
  { code: 8, name: '果园/多年生园地', short: '果园', color: '#D8544F', icon: 'cropOrchard' },
  { code: 9, name: '废弃/休耕', short: '休耕', color: '#A98E6B', icon: 'cropFallow' },
  { code: 10, name: '其他', short: '其他', color: '#8C97A3', icon: 'cropOther' }
]

// 时间轴和图层按年份切换
export const CROP_YEARS = [2024, 2025, 2026]
export const CROP_LAYER_PREFIX = 'agri-agent:bh_crop_class_'
export const CROP_STYLE_NAME = 'agri-agent:crop-style-10'
export const CROP_STATS_URL = '/static/cutCropStats.json'
// 1009 分析数据生成的时序/种植分析统计（scripts/temporal-analysis.cjs）
export const CROP_TEMPORAL_STATS_URL = '/static/parcelTemporalStats.json'
// 10km 网格的作物多样性统计（scripts/grid-diversity.cjs 生成）
export const CROP_GRID_STATS_URL = '/static/gridDiversityStats.json'
// 1009 数据发布到 GeoServer 的轮作图层与样式（geoserver/publish-rotation.ps1）
export const CROP_ROTATION_LAYER = 'agri-agent:bh_crop_rotation'
export const CROP_ROTATION_STYLE = 'agri-agent:crop-rotation-10'
// 同一图层另一套样式：按 CHG_BASE 分 0/1/2 三级（种植分析页签用）
export const CROP_STABILITY_STYLE = 'agri-agent:crop-stability-3'
// 新数据一行就是一个地块，用来跨年比对地块的身份
export const CROP_PARCEL_FIELD = 'FID_1'
export const CROP_TYPE_FIELD = 'Max_value'

export const cropLayerName = year => `${CROP_LAYER_PREFIX}${year}`

export const cropTypeByCode = code => {
  const value = Number(code)
  if (!Number.isFinite(value)) return null
  return CROP_TYPES.find(type => type.code === value) || null
}

export const cropTypeName = code => {
  const type = cropTypeByCode(code)
  return type ? type.name : `类型${code}`
}

export const cropTypeColor = code => {
  const type = cropTypeByCode(code)
  return type ? type.color : '#8C97A3'
}

// 轮作序列里的短名，避免"糖用甜菜/长生育期作物—…"把面板撑爆
export const cropShortName = code => {
  const type = cropTypeByCode(code)
  return type ? type.short : String(code)
}

// 图例点击后传给 WMS 的筛选条件：只显示选中的编码
export const cropFilterExpression = codes => {
  const list = Array.from(new Set((codes || []).map(Number).filter(Number.isFinite)))
  if (list.length === 0) return ''
  return `${CROP_TYPE_FIELD} IN (${list.join(',')})`
}

// 点某个轮作类型时，只把该 SEQUENCE 的地块取回来
export const rotationFilterExpression = sequence => {
  if (!sequence) return ''
  return `SEQUENCE IN ('${String(sequence).replace(/'/g, "''")}')`
}

// 点某个稳定性分级时，只把该分级的地块取回来
export const stabilityFilterExpression = value => {
  if (value === '' || value === null || value === undefined) return ''
  return `CHG_BASE = ${Number(value)}`
}
