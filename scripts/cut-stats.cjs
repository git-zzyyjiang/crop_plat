/**
 * 从 cut 文件夹的 Shapefile 统计每一年的作物类型数量与面积，
 * 生成 public/static/cutCropStats.json 供「作物统计信息」面板直接读取。
 *
 * 为什么离线算：新数据没有面积字段，前端要面积就得下载 30 多万个多边形，
 * 浏览器扛不住。这里一次性算好，页面只读一个几 KB 的 JSON。
 *
 * 用法：
 *   node scripts/cut-stats.cjs "C:\Users\27814\Desktop\cut"
 */

const fs = require('fs')
const path = require('path')

const EARTH_RADIUS = 6378137 // WGS84 长半轴，米
const TO_RAD = Math.PI / 180

// 与 GeoServer 的 crop-style-10.sld 一一对应
const CROP_TYPES = [
  { code: 1, name: '早熟谷物' },
  { code: 2, name: '春季谷物' },
  { code: 3, name: '玉米' },
  { code: 4, name: '水稻' },
  { code: 5, name: '油料作物' },
  { code: 6, name: '饲草作物' },
  { code: 7, name: '糖用甜菜/长生育期作物' },
  { code: 8, name: '果园/多年生园地' },
  { code: 9, name: '废弃/休耕' },
  { code: 10, name: '其他' }
]

// --- DBF：读出每行的作物编码 ------------------------------------------------
function readDbfCodes(file) {
  const buf = fs.readFileSync(file)
  const recordCount = buf.readInt32LE(4)
  const headerSize = buf.readInt16LE(8)
  const recordSize = buf.readInt16LE(10)

  const fieldCount = (headerSize - 33) / 32
  let typeOffset = -1
  let typeLength = 0
  for (let i = 0; i < fieldCount; i++) {
    const base = 32 + i * 32
    const name = buf.toString('ascii', base, base + 11).replace(/\0.*$/, '').trim()
    if (name.toLowerCase() === 'max_value') {
      typeOffset = 1 // 跳过 1 字节的删除标记
      for (let j = 0; j < i; j++) typeOffset += buf[32 + j * 32 + 16]
      typeLength = buf[base + 16]
    }
  }
  if (typeOffset < 0) throw new Error(`找不到 Max_value 字段：${file}`)

  const codes = new Int16Array(recordCount)
  for (let i = 0; i < recordCount; i++) {
    const at = headerSize + i * recordSize + typeOffset
    const raw = buf.toString('ascii', at, at + typeLength).trim()
    codes[i] = raw === '' ? 0 : Number(raw) || 0
  }
  return codes
}

// --- SHP：逐条算多边形面积 --------------------------------------------------
// 球面多边形面积，比「平方度 × cos(纬度)」更准，单位平方米。
function ringArea(points, start, end) {
  let total = 0
  for (let i = start; i < end; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[i + 1 === end ? start : i + 1]
    total += (x2 - x1) * TO_RAD * (2 + Math.sin(y1 * TO_RAD) + Math.sin(y2 * TO_RAD))
  }
  return total * EARTH_RADIUS * EARTH_RADIUS / 2
}

function readShpAreas(file, count) {
  const buf = fs.readFileSync(file)
  const fileLength = buf.readInt32BE(24) * 2
  const areas = new Float64Array(count)

  let offset = 100
  let index = 0
  while (offset + 8 <= fileLength) {
    const contentLength = buf.readInt32BE(offset + 4) * 2
    const recordStart = offset + 8
    const shapeType = buf.readInt32LE(recordStart)

    if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
      const numParts = buf.readInt32LE(recordStart + 36)
      const numPoints = buf.readInt32LE(recordStart + 40)
      let cursor = recordStart + 44
      const parts = []
      for (let i = 0; i < numParts; i++) {
        parts.push(buf.readInt32LE(cursor))
        cursor += 4
      }
      const points = new Array(numPoints)
      for (let i = 0; i < numPoints; i++) {
        points[i] = [buf.readDoubleLE(cursor), buf.readDoubleLE(cursor + 8)]
        cursor += 16
      }
      let area = 0
      for (let p = 0; p < numParts; p++) {
        const start = parts[p]
        const end = p + 1 < numParts ? parts[p + 1] : numPoints
        if (end - start >= 3) area += ringArea(points, start, end)
      }
      areas[index] = Math.abs(area)
    } else {
      areas[index] = 0
    }

    index++
    offset = recordStart + contentLength
  }
  return areas
}

// --- 主流程 -----------------------------------------------------------------
const round1 = value => Math.round(value * 10) / 10

// 年份目录可能写成 24 / 2024 / 2024年，自动认一下，换一批数据不用改脚本
function resolveYearDir(root, year) {
  const short = String(year).slice(2)
  for (const name of [String(year), short, `${year}年`, `${short}年`]) {
    const dir = path.join(root, name)
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
  }
  throw new Error(`在 ${root} 下找不到 ${year} 的目录`)
}

function main() {
  const cutRoot = process.argv[2] || 'C:\\Users\\27814\\Desktop\\cut'
  const outFile = path.join(__dirname, '..', 'public', 'static', 'cutCropStats.json')
  const yearList = [2024, 2025, 2026]

  // 三年的 .shp 完全一致（同一次导出的地块边界），所以几何只读一次、
  // 行号就是同一个地块，跨年比较直接按行号来。
  const codesByYear = new Map()
  let areas = null
  for (const year of yearList) {
    const dirPath = resolveYearDir(cutRoot, year)
    const shp = fs.readdirSync(dirPath).find(name => name.toLowerCase().endsWith('.shp'))
    if (!shp) throw new Error(`没有找到 .shp：${dirPath}`)
    const codes = readDbfCodes(path.join(dirPath, shp.replace(/\.shp$/i, '.dbf')))
    codesByYear.set(year, codes)
    if (!areas) areas = readShpAreas(path.join(dirPath, shp), codes.length)
  }

  const parcelCount = areas.length
  const years = {}
  for (const year of yearList) {
    const codes = codesByYear.get(year)
    const byType = new Map()
    let totalArea = 0
    for (let i = 0; i < codes.length; i++) {
      const area = areas[i] || 0
      totalArea += area
      const item = byType.get(codes[i]) || { count: 0, area: 0 }
      item.count++
      item.area += area
      byType.set(codes[i], item)
    }
    years[year] = {
      year,
      parcelCount: codes.length,
      totalAreaKm2: round1(totalArea / 1e6),
      byType: CROP_TYPES.map(type => {
        const item = byType.get(type.code) || { count: 0, area: 0 }
        return {
          code: type.code,
          name: type.name,
          count: item.count,
          areaKm2: round1(item.area / 1e6),
          ratio: totalArea ? item.area / totalArea : 0
        }
      })
    }
  }

  // 每年主导作物（按面积占比）
  const series = yearList.map(year => {
    const list = years[year].byType
    const top = list.reduce((best, item) => (item.areaKm2 > best.areaKm2 ? item : best), list[0])
    return { year, code: top.code, name: top.name, ratio: top.ratio }
  })

  // 种植稳定性：地块类型在 2024 → 2025 → 2026 之间改变的次数
  const histogram = {}
  let changesSum = 0
  for (let i = 0; i < parcelCount; i++) {
    const sequence = yearList.map(year => codesByYear.get(year)[i])
    let changes = 0
    for (let k = 1; k < sequence.length; k++) if (sequence[k] !== sequence[k - 1]) changes++
    histogram[changes] = (histogram[changes] || 0) + 1
    changesSum += changes
  }

  const latest = yearList[yearList.length - 1]
  const ratios = years[latest].byType.map(item => item.ratio)
  const result = {
    generatedAt: new Date().toISOString(),
    baselineYear: yearList[0],
    types: CROP_TYPES,
    years,
    series,
    stability: {
      baseline: yearList[0],
      years: yearList,
      parcelCount,
      averageChanges: parcelCount ? changesSum / parcelCount : null,
      histogram,
      comparable: true
    },
    diversity: {
      latestYear: latest,
      richness: years[latest].byType.filter(item => item.count > 0).length,
      shannon: ratios.reduce((sum, p) => (p > 0 ? sum - p * Math.log(p) : sum), 0),
      simpson: 1 - ratios.reduce((sum, p) => sum + p * p, 0)
    }
  }

  for (const year of yearList) {
    console.log(`${year}: parcels=${years[year].parcelCount} area=${years[year].totalAreaKm2} km2`)
  }
  console.log(`stability: avgChanges=${result.stability.averageChanges.toFixed(3)} histogram=${JSON.stringify(histogram)}`)

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8')
  console.log(`written -> ${outFile}`)
}

main()
