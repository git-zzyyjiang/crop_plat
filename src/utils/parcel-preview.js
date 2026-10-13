import axios from 'axios'

const cache = new Map()

// These seeds come from the same published parcel archives as the annual WFS layers.
// Only use them for those exact layers; other sources continue with live page previews.
export async function loadParcelPreviewPoints(layerName, extent, {signal, baseUrl = '/'} = {}) {
  const match = /^agri-agent:beksh_parcel_(2024|2025|2026)$/.exec(layerName)
  if (!match || signal?.aborted) return []
  const year = match[1]
  let values = cache.get(year)
  if (!values) {
    const response = await axios.get(`${baseUrl}static/parcel-preview/${year}.bin`, {
      responseType: 'arraybuffer', signal, timeout: 10000
    })
    if (signal?.aborted) return []
    if (!(response.data instanceof ArrayBuffer) || response.data.byteLength % 8) throw new Error('Invalid parcel seed data')
    values = new Float32Array(response.data)
    cache.set(year, values)
  }
  const points = []
  for (let i = 0; i < values.length; i += 2) {
    const x = values[i], y = values[i + 1]
    if (x >= extent[0] && x <= extent[2] && y >= extent[1] && y <= extent[3]) points.push([x, y])
    // Keep large selections and cancellation responsive while filtering the compact index.
    if (i && i % 65536 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (signal?.aborted) return []
    }
  }
  return points
}
