import axios from 'axios'
/* global DecompressionStream */

const indexes = new Map()
const tiles = new Map()
let cacheBytes = 0
const MAX_CACHE_BYTES = 32 * 1024 * 1024

// Geometry files and WFS are built from the same deployed archives, with original vertices.
export async function loadFastParcelFeatures(layerName, extent, {signal, baseUrl = '/', onTile, version} = {}) {
  const match = /^agri-agent:beksh_parcel_(2024|2025|2026)$/.exec(layerName)
  if (!match || version !== 'optimized-20261011' || typeof DecompressionStream === 'undefined') return null
  const active = () => !signal?.aborted
  if(!active()) return null
  const year = match[1]
  const root = `${baseUrl}static/parcel-fast/${year}/`
  let index = indexes.get(root)
  if (!index) {
    index = (await axios.get(root+'index.json', {signal, timeout:10000})).data
    if (!active()) return null
    if (index.layer !== layerName || index.version !== version || !Array.isArray(index.tiles)) throw new Error('Invalid parcel tile index')
    indexes.set(root, index)
  }
  const selected = index.tiles.filter(tile => tile.bbox[0] <= extent[2] && tile.bbox[2] >= extent[0]
    && tile.bbox[1] <= extent[3] && tile.bbox[3] >= extent[1])
  // Smaller tiles finish first, so there is visible geometry while dense tiles are still arriving.
  selected.sort((a,b) => a.bytes-b.bytes)
  const seen = new Set()
  let next = 0, failed = false
  const workers = await Promise.allSettled(Array.from({length:Math.min(4,selected.length)}, async () => {
    while(active() && !failed && next < selected.length){
      const tile = selected[next++]
      const key = root+tile.file
      try {
        let data = tiles.get(key)?.data
        if(!data){
          const response = await axios.get(key, {signal, responseType:'arraybuffer', timeout:15000})
          if(!active()) return
          const stream = new Blob([response.data]).stream().pipeThrough(new DecompressionStream('gzip'))
          const text = await new Response(stream).text()
          data = JSON.parse(text)
          if(!Array.isArray(data.features) || data.features.length !== tile.count) throw new Error('Incomplete parcel tile')
          const bytes = text.length*2
          if(bytes <= MAX_CACHE_BYTES){
            while(tiles.size && cacheBytes+bytes > MAX_CACHE_BYTES){
              const oldest = tiles.keys().next().value
              cacheBytes -= tiles.get(oldest).bytes
              tiles.delete(oldest)
            }
            tiles.set(key,{data,bytes});cacheBytes += bytes
          }
        }
        if(!active()) return
        const features = data.features.filter(feature => {
          if(seen.has(feature.id)) return false
          seen.add(feature.id);return true
        })
        if(onTile && features.length) await onTile({type:'FeatureCollection',features})
        await new Promise(resolve => setTimeout(resolve,0))
      }catch(error){failed=true;throw error}
    }
  }))
  if(!active()) return null
  const failure = workers.find(worker => worker.status === 'rejected')
  if(failure) throw failure.reason
  return {complete:true}
}
