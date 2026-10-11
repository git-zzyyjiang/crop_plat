/**
 * 从「网格」文件夹的 grid_2024_10km_crop_diversity shapefile 生成
 * public/static/gridDiversityStats.json —— 种植多样性面板用的 10km 网格统计。
 *
 * 这份数据是 Albers 等积投影（Balkhash_Albers_WGS84，单位米），
 * 前端用的是经纬度，所以脚本里把每个格网的包围盒反算回经纬度，
 * 这样框选时能按经纬度筛选落在选区里的格网。
 *
 * 用法：
 *   node scripts/grid-diversity.cjs "C:\Users\27814\Desktop\网格"
 */

const fs = require('fs')
const path = require('path')

const D2R = Math.PI / 180

// --- Albers 等积投影反算（和 .prj 里的参数一致）------------------------------
const A = 6378137
const F = 1 / 298.257223563
const E2 = F * (2 - F)
const E = Math.sqrt(E2)

const qOf = phi => {
  const s = Math.sin(phi)
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)))
}
const mOf = phi => {
  const s = Math.sin(phi)
  return Math.cos(phi) / Math.sqrt(1 - E2 * s * s)
}
const phiOfQ = q => {
  let lo = -Math.PI / 2 + 1e-9
  let hi = Math.PI / 2 - 1e-9
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (qOf(mid) < q) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const PHI1 = 43 * D2R
const PHI2 = 46 * D2R
const PHI0 = 44 * D2R
const LAM0 = 80 * D2R
const N = (mOf(PHI1) ** 2 - mOf(PHI2) ** 2) / (qOf(PHI2) - qOf(PHI1))
const C = mOf(PHI1) ** 2 + N * qOf(PHI1)
const RHO0 = A * Math.sqrt(C - N * qOf(PHI0)) / N

function albersToLonLat(x, y) {
  let rho = Math.sqrt(x * x + (RHO0 - y) * (RHO0 - y))
  if (N < 0) rho = -rho
  const theta = Math.atan2(x, RHO0 - y)
  const q = (C - (rho * N / A) ** 2) / N
  return [LAM0 / D2R + theta / N / D2R, phiOfQ(q) / D2R]
}

// --- DBF / SHP 读取 ---------------------------------------------------------
function readDbf(file) {
  const buf = fs.readFileSync(file)
  const recordCount = buf.readInt32LE(4)
  const headerSize = buf.readInt16LE(8)
  const recordSize = buf.readInt16LE(10)
  const fieldCount = Math.floor((headerSize - 33) / 32)

  const fields = []
  let offset = 1
  for (let i = 0; i < fieldCount; i++) {
    const base = 32 + i * 32
    const name = buf.toString('ascii', base, base + 11).replace(/\0.*$/, '').trim()
    const length = buf[base + 16]
    fields.push({ name, offset, length })
    offset += length
  }
  const byName = new Map(fields.map(field => [field.name, field]))
  const read = (index, name) => {
    const field = byName.get(name)
    if (!field) return ''
    const at = headerSize + index * recordSize + field.offset
    return buf.toString('ascii', at, at + field.length).trim()
  }
  const num = (index, name) => {
    const raw = read(index, name)
    return raw === '' ? 0 : Number(raw)
  }
  return { recordCount, read, num }
}

// 每个格网的经纬度包围盒
function readGridExtents(file, count) {
  const buf = fs.readFileSync(file)
  const fileLength = buf.readInt32BE(24) * 2
  const boxes = new Array(count)
  let offset = 100
  let index = 0
  while (offset + 8 <= fileLength && index < count) {
    const contentLength = buf.readInt32BE(offset + 4) * 2
    const recordStart = offset + 8
    const shapeType = buf.readInt32LE(recordStart)
    if (shapeType === 5 || shapeType === 15 || shapeType === 25) {
      const numPoints = buf.readInt32LE(recordStart + 40)
      let cursor = recordStart + 44 + buf.readInt32LE(recordStart + 36) * 4
      let minLon = Infinity
      let minLat = Infinity
      let maxLon = -Infinity
      let maxLat = -Infinity
      for (let i = 0; i < numPoints; i++) {
        const [lon, lat] = albersToLonLat(buf.readDoubleLE(cursor), buf.readDoubleLE(cursor + 8))
        if (lon < minLon) minLon = lon
        if (lat < minLat) minLat = lat
        if (lon > maxLon) maxLon = lon
        if (lat > maxLat) maxLat = lat
        cursor += 16
      }
      boxes[index] = [minLon, minLat, maxLon, maxLat]
    }
    index++
    offset = recordStart + contentLength
  }
  return boxes
}

const round = (value, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function main() {
  const dir = process.argv[2] || 'C:\\Users\\27814\\Desktop\\网格'
  const shp = fs.readdirSync(dir).find(name => name.toLowerCase().endsWith('.shp'))
  if (!shp) throw new Error(`没有找到 .shp：${dir}`)

  const dbf = readDbf(path.join(dir, shp.replace(/\.shp$/i, '.dbf')))
  const boxes = readGridExtents(path.join(dir, shp), dbf.recordCount)
  const { recordCount, num, read } = dbf

  const grids = []
  let sumCropTypes = 0
  let sumShannon = 0
  let sumSimpson = 0
  let sumDensity = 0
  let sumDominantPct = 0
  let sumAreaHa = 0
  let validGrids = 0
  const areaByType = {}
  let lonMin = Infinity
  let latMin = Infinity
  let lonMax = -Infinity
  let latMax = -Infinity

  for (let i = 0; i < recordCount; i++) {
    const box = boxes[i] || null
    const nCrop = num(i, 'N_CROP')
    const shannon = num(i, 'SHANNON')
    const simpson = num(i, 'SIMPSON')
    const density = num(i, 'DEN_KM2')
    const domPct = num(i, 'DOM_PCT')
    const areaHa = num(i, 'SUM_HA')

    sumCropTypes += nCrop
    sumShannon += shannon
    sumSimpson += simpson
    sumDensity += density
    sumDominantPct += domPct
    sumAreaHa += areaHa
    if (num(i, 'N_PARCEL') > 0) validGrids++

    // 各类作物的总公顷数，用来数全域到底有几种作物（不能只看第一条记录的 N_ALL）
    for (let k = 1; k <= 10; k++) {
      const key = `A${String(k).padStart(2, '0')}_HA`
      areaByType[k] = (areaByType[k] || 0) + num(i, key)
    }

    if (box) {
      lonMin = Math.min(lonMin, box[0])
      latMin = Math.min(latMin, box[1])
      lonMax = Math.max(lonMax, box[2])
      latMax = Math.max(latMax, box[3])
    }
    grids.push({
      bbox: box ? box.map(value => round(value, 4)) : null,
      nCrop,
      shannon: round(shannon, 4),
      simpson: round(simpson, 4),
      density: round(density, 3),
      dominantPct: round(domPct, 2),
      areaHa: round(areaHa, 1)
    })
  }

  const result = {
    generatedAt: new Date().toISOString(),
    year: recordCount ? num(0, 'YEAR') : 2024,
    gridKm: 10,
    summary: {
      gridCount: recordCount,
      validGridCount: validGrids,
      cropTypeCount: Object.values(areaByType).filter(value => value > 0).length,
      meanCropTypes: round(sumCropTypes / recordCount, 2),
      meanShannon: round(sumShannon / recordCount, 3),
      meanSimpson: round(sumSimpson / recordCount, 3),
      meanDensity: round(sumDensity / recordCount, 2),
      meanDominantPct: round(sumDominantPct / recordCount, 1),
      totalAreaHa: round(sumAreaHa, 0)
    },
    grids
  }

  const outFile = path.join(__dirname, '..', 'public', 'static', 'gridDiversityStats.json')
  fs.writeFileSync(outFile, JSON.stringify(result) + '\n', 'utf8')

  console.log(`grids=${recordCount} valid=${validGrids} areaHa=${result.summary.totalAreaHa}`)
  console.log(`mean cropTypes=${result.summary.meanCropTypes} shannon=${result.summary.meanShannon} simpson=${result.summary.meanSimpson}`)
  console.log(`mean density=${result.summary.meanDensity} dominant=${result.summary.meanDominantPct}%`)
  console.log(`lon/lat bbox = ${round(lonMin, 3)},${round(latMin, 3)} .. ${round(lonMax, 3)},${round(latMax, 3)}`)
  console.log(`written -> ${outFile}`)
}

main()
