// 标记仅用于演示动画，地块和边界的原始几何始终保持完整。
const priority = (x, y) => ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0)

// 超过细节动画上限时分区取代表地块；完整结果继续由现有 WMS 图层绘制。
export async function loadParcelAnimationFeatures(request, extent, isCurrent, detailLimit = 6000) {
  // 先用少量地块和总数判断范围，避免大选区下载6001个边界后又全部丢弃。
  const probeLimit = Math.min(128, detailLimit + 1)
  let first = await request(extent, probeLimit)
  if (!isCurrent()) return null
  const total = Number(first.totalFeatures ?? first.numberMatched)
  if (!(total > detailLimit)) {
    const complete = Number.isFinite(total) ? total === first.features.length : first.features.length < probeLimit
    if (!complete) first = await request(extent, detailLimit + 1)
    if (!isCurrent()) return null
    if (first.features.length <= detailLimit) return {data: first, overview: false}
  }
  const divisions = 5, perCell = Math.max(1, Math.min(160, Math.floor(detailLimit / (divisions * divisions))))
  const cells = [], results = new Array(divisions * divisions)
  const dx = (extent[2] - extent[0]) / divisions, dy = (extent[3] - extent[1]) / divisions
  for (let y = 0; y < divisions; y++) for (let x = 0; x < divisions; x++) {
    cells.push([extent[0] + x * dx, extent[1] + y * dy, extent[0] + (x + 1) * dx, extent[1] + (y + 1) * dy])
  }
  let next = 0, failed = false
  const workers = await Promise.allSettled(Array.from({length: 4}, async () => {
    while (isCurrent() && !failed && next < cells.length) {
      const index = next++
      try { results[index] = await request(cells[index], perCell) }
      catch (error) { failed = true; throw error }
    }
  }))
  if (!isCurrent()) return null
  const failure = workers.find(worker => worker.status === 'rejected')
  if (failure) throw failure.reason
  const unique = new Map()
  results.forEach(result => result.features.slice(0, perCell).forEach(feature => {
    const key = feature.id ?? JSON.stringify(feature.geometry)
    if (!unique.has(key)) unique.set(key, feature)
  }))
  return {data: {type: 'FeatureCollection', features: [...unique.values()].slice(0, detailLimit)}, overview: true}
}

export const parcelSweepProgress = (progress, position) => Math.max(0, Math.min(1, (progress - .45 * position) / .55))

export function sampleParcelMarkers(records, getPixel, bounds) {
  const width = Math.max(0, bounds[2] - bounds[0])
  const height = Math.max(0, bounds[3] - bounds[1])
  const area = width * height
  const budget = Math.max(24, Math.min(600, Math.round(area / 2400)))
  const spacing = Math.max(22, Math.sqrt(area / budget))
  const cells = new Map(), tips = new Map(), result = new Map()
  const inside = pixel => pixel && pixel[0] >= bounds[0] && pixel[0] <= bounds[2] && pixel[1] >= bounds[1] && pixel[1] <= bounds[3]
  for (const [feature, record] of records) {
    result.set(feature, {points: [], showTip: false})
    for (const ring of record.rings) {
      for (const coordinate of ring.slice(0, -1)) {
        const pixel = getPixel(coordinate)
        if (!inside(pixel)) continue
        const x = Math.floor((pixel[0] - bounds[0]) / spacing)
        const y = Math.floor((pixel[1] - bounds[1]) / spacing)
        const key = `${x},${y}`
        const distance = Math.hypot(pixel[0] - bounds[0] - (x + .5) * spacing, pixel[1] - bounds[1] - (y + .5) * spacing)
        if (!cells.has(key) || distance < cells.get(key).distance) cells.set(key, {feature, coordinate, pixel, distance, x, y})
      }
    }
    // 仅在少量有代表性的地块显示移动光点，避免每个地块都出现亮点。
    const path = record.paths.reduce((best, candidate) => !best || candidate.total > best.total ? candidate : best, null)
    if (!path) continue
    const pixels = path.ring.map(getPixel).filter(Boolean)
    if (!pixels.length) continue
    const west = Math.min(...pixels.map(p => p[0])), east = Math.max(...pixels.map(p => p[0]))
    const north = Math.min(...pixels.map(p => p[1])), south = Math.max(...pixels.map(p => p[1]))
    const center = [(west + east) / 2, (north + south) / 2]
    if (!inside(center) || Math.max(east - west, south - north) < 16) continue
    const x = Math.floor((center[0] - bounds[0]) / 90), y = Math.floor((center[1] - bounds[1]) / 90)
    const key = `${x},${y}`, size = (east - west) * (south - north)
    if (!tips.has(key) || size > tips.get(key).size) tips.set(key, {feature, size, x, y, path})
  }
  // 空间均匀选取，避免达到上限后只有前几个地块能显示标记。
  const selected = [], bins = new Map(), minimumDistance = spacing * .7
  for (const candidate of [...cells.values()].sort((a, b) => priority(a.x, a.y) - priority(b.x, b.y))) {
    const x = Math.floor(candidate.pixel[0] / minimumDistance), y = Math.floor(candidate.pixel[1] / minimumDistance)
    let crowded = false
    for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dy = -1; dy <= 1 && !crowded; dy++) {
      crowded = (bins.get(`${x + dx},${y + dy}`) || []).some(pixel => Math.hypot(pixel[0] - candidate.pixel[0], pixel[1] - candidate.pixel[1]) < minimumDistance)
    }
    if (crowded) continue
    selected.push(candidate)
    const key = `${x},${y}`
    if (!bins.has(key)) bins.set(key, [])
    bins.get(key).push(candidate.pixel)
    if (selected.length >= budget) break
  }
  selected.forEach(candidate => result.get(candidate.feature).points.push(candidate.coordinate))
  const tipBudget = Math.max(1, Math.min(48, Math.round(area / 18000)))
  ;[...tips.values()].sort((a, b) => priority(a.x, a.y) - priority(b.x, b.y)).slice(0, tipBudget).forEach(tip => {
    const marker = result.get(tip.feature)
    marker.showTip = true
    marker.tipPath = tip.path
  })
  return result
}
