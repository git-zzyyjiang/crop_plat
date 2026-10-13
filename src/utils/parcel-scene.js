import {toContext} from 'ol/render'
import {transformExtent} from 'ol/proj'

// 使用样式指定的几何绘制：识别过程中是种子点/正在延伸的线，完成后才是面。
export function renderParcelFrame(layer, projection, resolution, createCanvas = () => document.createElement('canvas')) {
  const extent = transformExtent(layer.getExtent(), projection, 'EPSG:4326')
  const width = 1536
  const height = Math.max(256, Math.min(1536, Math.round(width * (extent[3] - extent[1]) / (extent[2] - extent[0]))))
  const canvas = createCanvas()
  const renderer = toContext(canvas.getContext('2d'), {size: [width, height], pixelRatio: 1})
  const styleFunction = layer.getStyleFunction()
  for (const feature of layer.getSource().getFeatures()) {
    const result = styleFunction(feature, resolution)
    const styles = Array.isArray(result) ? result : [result]
    for (const style of styles) {
      if (!style) continue
      const original = style.getGeometryFunction()(feature)
      if (!original) continue
      const geometry = original.clone().transform(projection, 'EPSG:4326')
      geometry.applyTransform((input, output, stride) => {
        output = output || input
        for (let i = 0; i < input.length; i += stride) {
          output[i] = (input[i] - extent[0]) / (extent[2] - extent[0]) * width
          output[i + 1] = (extent[3] - input[i + 1]) / (extent[3] - extent[1]) * height
          for (let j = 2; j < stride; j++) output[i + j] = input[i + j]
        }
        return output
      })
      renderer.setStyle(style)
      renderer.drawGeometry(geometry)
    }
  }
  return {canvas, extent}
}

// 密集采样屏幕矩形边界，兼顾斜视地形；任何点落在天空上都不提交无效范围。
export function screenBoxExtent(start, end, pick) {
  if (Math.abs(end[0] - start[0]) < 8 || Math.abs(end[1] - start[1]) < 8) return null
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (let step = 0; step <= 8; step++) {
    const t = step / 8
    const x = start[0] + (end[0] - start[0]) * t
    const y = start[1] + (end[1] - start[1]) * t
    for (const pixel of [[x,start[1]], [x,end[1]], [start[0],y], [end[0],y]]) {
      const coordinate = pick(pixel)
      if (!coordinate || !coordinate.every(Number.isFinite)) return null
      bounds[0] = Math.min(bounds[0], coordinate[0]); bounds[1] = Math.min(bounds[1], coordinate[1])
      bounds[2] = Math.max(bounds[2], coordinate[0]); bounds[3] = Math.max(bounds[3], coordinate[1])
    }
  }
  return bounds
}

export function nearScreenEdge(pixel, ring, tolerance = 10) {
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) return false
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length = dx * dx + dy * dy
    const t = length ? Math.max(0, Math.min(1, ((pixel[0]-a[0])*dx + (pixel[1]-a[1])*dy) / length)) : 0
    return Math.hypot(pixel[0]-a[0]-t*dx, pixel[1]-a[1]-t*dy) <= tolerance
  })
}

// 在鼠标拾取的地理位置找各边的最近点，再投影真实地形高度；不把弯曲边界视为四条直线。
export function nearTerrainRoiEdge(pixel, ground, extent, project, tolerance = 14) {
  const x = Math.max(extent[0], Math.min(extent[2], ground[0]))
  const y = Math.max(extent[1], Math.min(extent[3], ground[1]))
  const nearest = [[extent[0],y],[extent[2],y],[x,extent[1]],[x,extent[3]]]
  return nearest.some(coordinate => {
    const screen = project(coordinate)
    return screen && Math.hypot(screen[0]-pixel[0],screen[1]-pixel[1]) <= tolerance
  })
}
