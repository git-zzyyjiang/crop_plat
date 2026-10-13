// 大小选区都加载完整地块，不再用代表地块动画切换到整幅 WMS 面。
export async function loadParcelAnimationFeatures(request, extent, isCurrent, pageSize = 6000, onPage = null) {
  // 第一页同时提供总数和实际地块，省掉一次只取少量要素的探测请求。
  const firstLimit = onPage ? Math.min(600, pageSize) : pageSize
  const first = await request(extent, firstLimit, 0)
  if (!isCurrent()) return null
  const total = Number(first.numberMatched ?? first.totalFeatures)
  if (onPage) await onPage(first, total)
  if (!isCurrent()) return null
  if ((Number.isFinite(total) && total === first.features.length) || (!Number.isFinite(total) && !first.features.length)) return {data: first}
  const pages = [first.features]
  let offset = first.features.length
  let last = first
  // 连线首批只取少量要素，后续恢复大页，兼顾首屏速度和请求数量。
  if (onPage && firstLimit < pageSize && (Number.isFinite(total) ? offset < total : offset > 0)) {
    last = await request(extent, pageSize, offset)
    if (!isCurrent()) return null
    pages.push(last.features)
    offset += last.features.length
    await onPage(last, total)
    if (!isCurrent()) return null
  }
  // 服务器可能限制单页数量，后续按实际返回的数量继续翻页。
  const step = Math.min(pageSize, last.features.length)
  if (!step && total > offset) throw new Error('地块分页服务返回空数据')
  if (Number.isFinite(total)) {
    const remaining = step ? Math.max(0, Math.ceil((total - offset) / step)) : 0
    const pageOffset = pages.length
    let next = 0, failed = false
    const workers = await Promise.allSettled(Array.from({length: Math.min(6, remaining)}, async () => {
      while (isCurrent() && !failed && next < remaining) {
        const index = next++
        try {
          const page = await request(extent, step, offset + index * step)
          if (!isCurrent()) return
          pages[index + pageOffset] = page.features
          if (onPage) await onPage(page, total)
        } catch (error) { failed = true; throw error }
      }
    }))
    if (!isCurrent()) return null
    const failure = workers.find(worker => worker.status === 'rejected')
    if (failure) throw failure.reason
  } else if (step) {
    // 没有总数时，按实际页大小持续翻页，直到服务返回空页。
    const signatures = new Set(pages.map(features => JSON.stringify(features.map(feature => feature.id ?? feature))))
    while (isCurrent()) {
      const page = await request(extent, step, offset)
      if (!isCurrent()) return null
      const signature = JSON.stringify(page.features.map(feature => feature.id ?? feature))
      if (page.features.length && signatures.has(signature)) throw new Error('地块服务未返回正确的分页数据')
      signatures.add(signature)
      pages.push(page.features)
      if (onPage) await onPage(page, total)
      offset += page.features.length
      if (!page.features.length) break
    }
  }
  if (!isCurrent()) return null
  const unique = new Map()
  pages.forEach(page => page.forEach(feature => unique.set(feature.id ?? JSON.stringify(feature), feature)))
  if (Number.isFinite(total) && unique.size < total) throw new Error('选区地块未加载完整，请重新框选重试')
  return {data: {type: 'FeatureCollection', features: [...unique.values()]}}
}

// 每个环都有起点；优先从选框内的顶点开始，避免先画框外部分。
export function prepareParcelPaths(rings, extent) {
  return rings.map(coordinates => {
    const vertices = coordinates.slice(0, -1)
    let start = vertices.findIndex(point => point[0] >= extent[0] && point[0] <= extent[2] && point[1] >= extent[1] && point[1] <= extent[3])
    if(start < 0){
      // 跨越选框但没有顶点落在框内时，从可见边段的中点起笔。
      for(let i = 0; i < vertices.length; i++){
        const a = vertices[i], b = vertices[(i + 1) % vertices.length]
        let enter = 0, leave = 1
        for(let axis = 0; axis < 2; axis++){
          const delta = b[axis] - a[axis]
          if(!delta){
            if(a[axis] < extent[axis] || a[axis] > extent[axis + 2]) leave = -1
          }else{
            const first = (extent[axis] - a[axis]) / delta, last = (extent[axis + 2] - a[axis]) / delta
            enter = Math.max(enter, Math.min(first, last))
            leave = Math.min(leave, Math.max(first, last))
          }
        }
        if(enter <= leave){
          const fraction = (enter + leave) / 2
          start = i + 1
          vertices.splice(start, 0, [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction])
          break
        }
      }
    }
    const offset = Math.max(0, start)
    const ring = [...vertices.slice(offset), ...vertices.slice(0, offset)]
    ring.push(ring[0])
    const lengths = [0]
    for (let i = 1; i < ring.length; i++) lengths.push(lengths[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]))
    return {ring, lengths, total: lengths[lengths.length - 1]}
  })
}

// 保留已绘制的部分，沿边界连续前进，只有进度到 1 时才闭合。
export function traceParcelPaths(paths, progress) {
  return paths.map(({ring, lengths, total}) => {
    if (progress >= 1) return ring
    const distance = Math.max(0, progress) * total
    let low = 0, high = ring.length - 2
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (lengths[middle + 1] < distance) low = middle + 1
      else high = middle
    }
    const a = ring[low], b = ring[low + 1], segment = lengths[low + 1] - lengths[low]
    const fraction = segment ? Math.min(1, (distance - lengths[low]) / segment) : 0
    return [...ring.slice(0, low + 1), [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]]
  })
}

export const PARCEL_ANIMATION_TIMING = {points: 1200, lines: 6000, closed: 400, faces: 2200}

export function getParcelAnimationTiming(count, extent) {
  // 面积只用于选择动画速度，不参与业务统计。extent 为经纬度选框。
  const latitude = extent ? (extent[1] + extent[3]) / 2 * Math.PI / 180 : 0
  const km2 = extent ? Math.abs((extent[2] - extent[0]) * (extent[3] - extent[1])) * 111.32 ** 2 * Math.cos(latitude) : 0
  // 大范围直接显示完整边界，再快速填充，省去逐个起点和生长路径。
  if(count > 10000 || km2 > 5000) return {points:0, lines:150, closed:0, faces:250}
  if(count > 2000 || km2 > 1000) return {points:0, lines:300, closed:0, faces:300}
  return PARCEL_ANIMATION_TIMING
}
