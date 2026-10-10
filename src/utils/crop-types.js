/**
 * 10 类作物的唯一来源：编码、名称、配色、图标。
 *
 * 颜色必须和 GeoServer 的 agri-agent:crop-style-10 完全一致
 * （见 geoserver/crop-style-10.sld），改颜色要两边同时改，
 * 否则图例的颜色和地图上的颜色会对不上。
 */

export const CROP_TYPES = [
  { code: 1, name: '早熟谷物', color: '#F2D24B', icon: 'cropEarlyGrain' },
  { code: 2, name: '春季谷物', color: '#E07B2E', icon: 'cropSpringGrain' },
  { code: 3, name: '玉米', color: '#A3D14A', icon: 'cropCorn' },
  { code: 4, name: '水稻', color: '#3E9FE0', icon: 'cropRice' },
  { code: 5, name: '油料作物', color: '#E86FA6', icon: 'cropOil' },
  { code: 6, name: '饲草作物', color: '#35BFA0', icon: 'cropForage' },
  { code: 7, name: '糖用甜菜/长生育期作物', color: '#9B72D9', icon: 'cropBeet' },
  { code: 8, name: '果园/多年生园地', color: '#D8544F', icon: 'cropOrchard' },
  { code: 9, name: '废弃/休耕', color: '#A98E6B', icon: 'cropFallow' },
  { code: 10, name: '其他', color: '#8C97A3', icon: 'cropOther' }
]

// 时间轴和图层按年份切换
export const CROP_YEARS = [2024, 2025, 2026]
export const CROP_LAYER_PREFIX = 'agri-agent:bh_crop_class_'
export const CROP_STYLE_NAME = 'agri-agent:crop-style-10'
export const CROP_STATS_URL = '/static/cutCropStats.json'
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

// 图例点击后传给 WMS 的筛选条件：只显示选中的编码
export const cropFilterExpression = codes => {
  const list = Array.from(new Set((codes || []).map(Number).filter(Number.isFinite)))
  if (list.length === 0) return ''
  return `${CROP_TYPE_FIELD} IN (${list.join(',')})`
}
