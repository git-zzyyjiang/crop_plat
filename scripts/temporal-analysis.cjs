/**
 * 从「1009」文件夹的 parcel_temporal_analysis.dbf 生成
 * public/static/parcelTemporalStats.json —— 作物时间序列 / 种植分析用的统计。
 *
 * 这份数据是分析方给的权威结果，字段含义：
 *   CROP24 / CROP25 / CROP26  三年的作物编码（1-10，和 cut 数据、地图配色一致）
 *   SEQUENCE                  三年序列，形如 "3-7-3"
 *   CHG_BASE                  相对基准年(2024)改变的年数，0 / 1 / 2
 *   N_TYPES                   三年里出现过几种作物，1 / 2 / 3
 *   STAB_IDX / SHANNON / SIMPSON / DOM_CROP  稳定性与多样性指标
 *
 * 用法：
 *   node scripts/temporal-analysis.cjs "C:\Users\27814\Desktop\1009"
 */

const fs = require('fs')
const path = require('path')

const TOP_SEQUENCES = 10 // 轮作类型面板最多列几条

// 轮作类型在图上用的颜色，按排名取，和 src/utils/crop-types.js 的 10 类作物色一致。
// 改这里要同步改 crop-types.js，否则图例和地图对不上。
const ROTATION_COLORS = [
  '#F2D24B', '#E07B2E', '#A3D14A', '#3E9FE0', '#E86FA6',
  '#35BFA0', '#9B72D9', '#D8544F', '#A98E6B', '#8C97A3'
]

// 与 src/utils/crop-types.js 的短名保持一致，只用于 SLD 里的中文标题
const CROP_SHORT = ['早熟谷物', '春季谷物', '玉米', '水稻', '油料', '饲草', '甜菜', '果园', '休耕', '其他']

const xmlEscape = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

// 按 SEQUENCE 字段着色：只画进前十种，其余组合不匹配任何规则、不上色
function buildRotationSld(items) {
  const rules = items.map((item, index) => {
    const color = item.color
    const label = item.codes.map(code => CROP_SHORT[code - 1] || code).join('—')
    return `        <Rule>
          <Name>rotation_${index + 1}</Name>
          <Title>${xmlEscape(label)}</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>SEQUENCE</ogc:PropertyName>
              <ogc:Literal>${xmlEscape(item.sequence)}</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <PolygonSymbolizer>
            <Fill>
              <CssParameter name="fill">${color}</CssParameter>
              <CssParameter name="fill-opacity">0.9</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">${color}</CssParameter>
              <CssParameter name="stroke-width">0.15</CssParameter>
              <CssParameter name="stroke-opacity">0.9</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>`
  }).join('\n\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- 由 scripts/temporal-analysis.cjs 生成，不要手改。
     数据源：1009/parcel_temporal_analysis，按 SEQUENCE 取地块数前 ${items.length} 种。 -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>bh_crop_rotation</Name>
    <UserStyle>
      <Name>crop-rotation-10</Name>
      <Title>轮作类型（前 ${items.length} 种）</Title>
      <FeatureTypeStyle>

${rules}

      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
`
}

function readDbf(file) {
  const buf = fs.readFileSync(file)
  const recordCount = buf.readInt32LE(4)
  const headerSize = buf.readInt16LE(8)
  const recordSize = buf.readInt16LE(10)
  const fieldCount = Math.floor((headerSize - 33) / 32)

  const fields = []
  let offset = 1 // 跳过 1 字节的删除标记
  for (let i = 0; i < fieldCount; i++) {
    const base = 32 + i * 32
    const name = buf.toString('ascii', base, base + 11).replace(/\0.*$/, '').trim()
    const length = buf[base + 16]
    fields.push({ name, offset, length })
    offset += length
  }
  const byName = new Map(fields.map(field => [field.name, field]))

  const read = (recordIndex, name) => {
    const field = byName.get(name)
    if (!field) return ''
    const at = headerSize + recordIndex * recordSize + field.offset
    return buf.toString('ascii', at, at + field.length).trim()
  }
  const readInt = (recordIndex, name) => {
    const raw = read(recordIndex, name)
    return raw === '' ? null : Number(raw)
  }
  const readFloat = (recordIndex, name) => {
    const raw = read(recordIndex, name)
    return raw === '' ? null : Number(raw)
  }

  return { recordCount, readInt, readFloat, read }
}

const round = (value, digits = 3) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function main() {
  const dir = process.argv[2] || 'C:\\Users\\27814\\Desktop\\1009'
  const dbfName = fs.readdirSync(dir).find(name => name.toLowerCase().endsWith('.dbf'))
  if (!dbfName) throw new Error(`没有找到 .dbf：${dir}`)
  const dbf = readDbf(path.join(dir, dbfName))
  const { recordCount, readInt, readFloat } = dbf

  const sequenceCounts = new Map()
  const changesHistogram = {}
  const typesHistogram = {}
  const dominantCounts = {}
  let areaHa = 0
  let stabSum = 0
  let stabCount = 0
  let shannonSum = 0
  let simpsonSum = 0
  let diversityCount = 0

  for (let i = 0; i < recordCount; i++) {
    const sequence = dbf.read(i, 'SEQUENCE')
    if (sequence) sequenceCounts.set(sequence, (sequenceCounts.get(sequence) || 0) + 1)

    const changes = readInt(i, 'CHG_BASE')
    if (changes !== null) changesHistogram[changes] = (changesHistogram[changes] || 0) + 1

    const types = readInt(i, 'N_TYPES')
    if (types !== null) typesHistogram[types] = (typesHistogram[types] || 0) + 1

    const dominant = readInt(i, 'DOM_CROP')
    if (dominant !== null) dominantCounts[dominant] = (dominantCounts[dominant] || 0) + 1

    const area = readFloat(i, 'AREA_HA')
    if (area !== null) areaHa += area

    const stab = readFloat(i, 'STAB_IDX')
    if (stab !== null) { stabSum += stab; stabCount++ }

    const shannon = readFloat(i, 'SHANNON')
    const simpson = readFloat(i, 'SIMPSON')
    if (shannon !== null && simpson !== null) {
      shannonSum += shannon
      simpsonSum += simpson
      diversityCount++
    }
  }

  const sequences = Array.from(sequenceCounts.entries())
    .map(([sequence, count]) => ({
      sequence,
      codes: sequence.split('-').map(Number),
      count,
      ratio: round(count / recordCount, 5)
    }))
    .sort((a, b) => b.count - a.count)

  // 前十种按排名分配颜色：图例色块、地图配色、SLD 用的是同一组颜色
  const topSequences = sequences.slice(0, TOP_SEQUENCES).map((item, index) => ({
    ...item,
    color: ROTATION_COLORS[index % ROTATION_COLORS.length]
  }))

  let changesSum = 0
  Object.entries(changesHistogram).forEach(([changes, count]) => {
    changesSum += Number(changes) * count
  })

  const result = {
    generatedAt: new Date().toISOString(),
    parcelCount: recordCount,
    totalAreaHa: round(areaHa, 1),
    sequenceTotal: sequences.length,
    topSequences,
    stability: {
      baseline: 2024,
      years: [2024, 2025, 2026],
      changes: changesHistogram,
      averageChanges: round(changesSum / recordCount, 3),
      stableShare: round((changesHistogram[0] || 0) / recordCount, 4),
      averageStabilityIndex: stabCount ? round(stabSum / stabCount, 3) : null
    },
    diversity: {
      typesHistogram,
      averageShannon: diversityCount ? round(shannonSum / diversityCount, 3) : null,
      averageSimpson: diversityCount ? round(simpsonSum / diversityCount, 3) : null,
      dominant: dominantCounts
    }
  }

  const outFile = path.join(__dirname, '..', 'public', 'static', 'parcelTemporalStats.json')
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8')
  // 图层样式和统计同源，一起生成，避免配色漂移
  const sldFile = path.join(__dirname, '..', 'geoserver', 'crop-rotation-10.sld')
  fs.writeFileSync(sldFile, buildRotationSld(topSequences), 'utf8')

  console.log(`parcels=${recordCount} sequences=${sequences.length} totalAreaHa=${result.totalAreaHa}`)
  console.log(`changes=${JSON.stringify(changesHistogram)} avg=${result.stability.averageChanges} stable=${result.stability.stableShare}`)
  console.log(`types=${JSON.stringify(typesHistogram)} shannon=${result.diversity.averageShannon} simpson=${result.diversity.averageSimpson}`)
  console.log('top sequences:')
  result.topSequences.forEach(item => console.log(`  ${item.sequence}  ${item.count}`))
  console.log(`written -> ${outFile}`)
  console.log(`written -> ${sldFile}`)
}

main()
