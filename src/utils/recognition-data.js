import axios from 'axios'

// 只缓存已完成的原始响应；不同选区、图层、字段和服务器不会共用结果。
const featuresCache = new Map()
const TTL = 5 * 60 * 1000
const MAX_BYTES = 24 * 1024 * 1024
let cacheBytes = 0

export async function fetchRecognitionFeatures(url, params, {signal, timeout = 60000, fresh = false} = {}) {
  if (signal?.aborted) throw new axios.CanceledError()
  const key = JSON.stringify([url, Object.keys(params).filter(key => key !== 'maxFeatures').sort().map(key => [key, params[key]])])
  const limit = Number(params.maxFeatures)
  for (const [cachedKey, entry] of featuresCache) {
    if (Date.now() - entry.at >= TTL) {
      featuresCache.delete(cachedKey)
      cacheBytes -= entry.bytes
    }
  }
  const cached = featuresCache.get(key)
  if (!fresh && cached && (cached.complete || cached.limit >= limit)) {
    featuresCache.delete(key)
    featuresCache.set(key, cached)
    return {...cached.data, features: cached.data.features.slice(0, limit)}
  }
  const response = await axios.get(url, {params, signal, timeout})
  if (signal?.aborted) throw new axios.CanceledError()
  if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
    const error = new Error('GeoServer returned a WFS exception')
    error.code = 'WFS_EXCEPTION'
    throw error
  }
  const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  if (!Array.isArray(data?.features)) throw new Error('Invalid recognition feature response')
  // 超大统计结果只保留聚合缓存，避免长期占用原始数据的内存。
  if (data.features.length <= 20000) {
    const bytes = JSON.stringify(data).length * 2
    if (bytes <= MAX_BYTES) {
      const previous = featuresCache.get(key)
      if (previous) { featuresCache.delete(key); cacheBytes -= previous.bytes }
      while (featuresCache.size && (cacheBytes + bytes > MAX_BYTES || featuresCache.size >= 64)) {
        const oldest = featuresCache.keys().next().value
        cacheBytes -= featuresCache.get(oldest).bytes
        featuresCache.delete(oldest)
      }
      const total = Number(data.totalFeatures ?? data.numberMatched)
      const complete = Number.isFinite(total) ? total === data.features.length : data.features.length < limit
      featuresCache.set(key, {data, limit, complete, at: Date.now(), bytes})
      cacheBytes += bytes
    }
  }
  return data
}

// 作物配色不再从 GeoServer 的 GetStyles 里反解（那是旧的 4 类样式），
// 现在统一放在 src/utils/crop-types.js，和地图上的 crop-style-10 保持一致。
