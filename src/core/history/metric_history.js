/**
 * data_processing/history/metric_history.js
 *
 * Historisation locale des métriques de marché (localStorage).
 * Fenêtre glissante — max MAX_POINTS snapshots, 1 toutes les MIN_INTERVAL_MS.
 *
 * Format stocké : { ts: number, v: number }[]
 * Clé localStorage : `optlab:hist:{asset}:{metric}`
 *
 * Métriques supportées : dvol, rv, ivPremium, fundingAnn, basisAnn, ivRank
 */

const MAX_POINTS       = 720           // ~30 jours à 1pt/heure
const MIN_INTERVAL_MS  = 5 * 60_000   // 5 min entre deux enregistrements

// ── Accès localStorage ────────────────────────────────────────────────────────

function lsKey(asset, metric) {
  return `optlab:hist:${asset}:${metric}`
}

function readSeries(asset, metric) {
  try {
    const raw = localStorage.getItem(lsKey(asset, metric))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSeries(asset, metric, series) {
  try {
    localStorage.setItem(lsKey(asset, metric), JSON.stringify(series))
  } catch {
    // localStorage plein ou indisponible — on ignore silencieusement
  }
}

// ── API publique ───────────────────────────────────────────────────────────────

/**
 * Enregistre un snapshot multi-métrique pour un asset.
 * Throttle : ignore si le dernier point est plus récent que MIN_INTERVAL_MS.
 *
 * @param {string} asset
 * @param {Object} data  — { dvol, rv, ivPremium, fundingAnn, basisAnn, ivRank }
 *   Chaque valeur peut être null/undefined, elle est alors ignorée.
 */
export function recordSnapshot(asset, data) {
  const now = Date.now()
  const metrics = Object.entries(data).filter(([, v]) => Number.isFinite(v))

  for (const [metric, value] of metrics) {
    const series = readSeries(asset, metric)
    const last   = series[series.length - 1]

    // Throttle
    if (last && now - last.ts < MIN_INTERVAL_MS) continue

    series.push({ ts: now, v: value })

    // Fenêtre glissante
    if (series.length > MAX_POINTS) series.splice(0, series.length - MAX_POINTS)

    writeSeries(asset, metric, series)
  }
}

/**
 * Retourne les valeurs brutes d'une métrique dans une fenêtre de temps.
 *
 * @param {string} asset
 * @param {string} metric
 * @param {number} [maxAgeDays=30]
 * @returns {number[]}
 */
export function getMetricHistory(asset, metric, maxAgeDays = 30) {
  const cutoff = Date.now() - maxAgeDays * 86400_000
  return readSeries(asset, metric)
    .filter(p => p.ts >= cutoff)
    .map(p => p.v)
}

/**
 * Retourne les points complets (ts + v) d'une métrique.
 *
 * @param {string} asset
 * @param {string} metric
 * @param {number} [maxAgeDays=30]
 * @returns {{ ts: number, v: number }[]}
 */
export function getMetricPoints(asset, metric, maxAgeDays = 30) {
  const cutoff = Date.now() - maxAgeDays * 86400_000
  return readSeries(asset, metric).filter(p => p.ts >= cutoff)
}

/**
 * Calcule le percentile de `current` dans `values` (% de valeurs < current).
 *
 * @param {number[]} values
 * @param {number}   current
 * @returns {number|null}  — 0 à 100
 */
export function calcPercentile(values, current) {
  if (!values?.length || !Number.isFinite(current)) return null
  const below = values.filter(v => v < current).length
  return Math.round((below / values.length) * 100)
}

/**
 * Retourne la valeur au percentile `pct` d'une série (seuil dynamique).
 *
 * @param {number[]} values
 * @param {number}   pct     — 0 à 100
 * @returns {number|null}
 */
export function calcThresholdAtPct(values, pct) {
  if (!values?.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor((pct / 100) * (sorted.length - 1))
  return sorted[idx]
}

/**
 * Moyenne glissante simple sur une série de valeurs.
 *
 * @param {number[]} values
 * @returns {number|null}
 */
export function calcMovingAvg(values) {
  if (!values?.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Shortcut : percentile d'une valeur par rapport à l'historique stocké.
 *
 * @param {string} asset
 * @param {string} metric
 * @param {number} current
 * @param {number} [maxAgeDays=30]
 * @returns {number|null}
 */
export function livePercentile(asset, metric, current, maxAgeDays = 30) {
  return calcPercentile(getMetricHistory(asset, metric, maxAgeDays), current)
}

/**
 * Shortcut : seuil dynamique au percentile `pct` pour une métrique.
 *
 * @param {string} asset
 * @param {string} metric
 * @param {number} [pct=70]
 * @param {number} [maxAgeDays=30]
 * @returns {number|null}
 */
export function dynamicThreshold(asset, metric, pct = 70, maxAgeDays = 30) {
  return calcThresholdAtPct(getMetricHistory(asset, metric, maxAgeDays), pct)
}

/**
 * Retourne des infos de diagnostic sur une métrique historisée.
 *
 * @param {string} asset
 * @param {string} metric
 * @returns {{ count: number, firstTs: number|null, lastTs: number|null, min: number|null, max: number|null, avg: number|null }}
 */
export function metricDiag(asset, metric) {
  const series = readSeries(asset, metric)
  if (!series.length) return { count: 0, firstTs: null, lastTs: null, min: null, max: null, avg: null }
  const vals = series.map(p => p.v)
  return {
    count:   series.length,
    firstTs: series[0].ts,
    lastTs:  series[series.length - 1].ts,
    min:     Math.min(...vals),
    max:     Math.max(...vals),
    avg:     vals.reduce((a, b) => a + b, 0) / vals.length,
  }
}
