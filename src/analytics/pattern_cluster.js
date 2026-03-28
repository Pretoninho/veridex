// analytics/pattern_cluster.js
//
// Regroupe une liste de patterns par clé composite (type × direction).

/**
 * @param {Array<{ type?: string, direction?: string, [key: string]: any }>} patterns
 * @returns {Object<string, Array>}  e.g. { 'strong_bullish': [...], 'moderate_bearish': [...] }
 */
export function clusterPatterns(patterns = []) {
  const clusters = {}

  patterns.forEach(p => {
    const key = `${p.type ?? 'unknown'}_${p.direction ?? 'neutral'}`

    if (!clusters[key]) clusters[key] = []

    clusters[key].push(p)
  })

  return clusters
}
