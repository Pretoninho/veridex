/**
 * data_processing/volatility/iv_rank.js
 *
 * IV Rank, IV Percentile et détection de spikes.
 *
 * IV Rank     : position de l'IV actuelle dans [min, max] sur une période — 0 à 100
 * IV Percentile : % de jours où l'IV était inférieure à la valeur actuelle
 * Spike       : IV actuelle > moyenne + seuil de déviation
 */

/**
 * Calcule l'IV Rank sur une période.
 * IVR = (current - min) / (max - min) * 100
 *
 * @param {number} current       — IV actuelle (ex: DVOL current)
 * @param {number} periodMin     — min de la période
 * @param {number} periodMax     — max de la période
 * @returns {number|null}        — 0 à 100
 */
export function calcIVRank(current, periodMin, periodMax) {
  if (!Number.isFinite(current) || !Number.isFinite(periodMin) || !Number.isFinite(periodMax)) return null
  if (periodMax <= periodMin) return null
  return Math.round(((current - periodMin) / (periodMax - periodMin)) * 100)
}

/**
 * Calcule l'IV Percentile.
 * % de jours où l'IV était INFÉRIEURE à l'IV actuelle.
 *
 * @param {number} current        — IV actuelle
 * @param {number[]} history      — historique des valeurs IV
 * @returns {number|null}         — 0 à 100
 */
export function calcIVPercentile(current, history) {
  if (!Number.isFinite(current) || !history?.length) return null
  const below = history.filter(v => Number.isFinite(v) && v < current).length
  return Math.round((below / history.length) * 100)
}

/**
 * Détecte si l'IV actuelle constitue un spike par rapport à la moyenne.
 *
 * @param {number} current        — IV actuelle
 * @param {number[]} history      — historique des valeurs IV
 * @param {number} [threshold=10] — seuil de % au-dessus de la moyenne pour déclencher
 * @returns {{ isSpike: boolean, avg: number, deviation: number } | null}
 */
export function detectIVSpike(current, history, threshold = 10) {
  if (!Number.isFinite(current) || !history?.length) return null
  const valid = history.filter(v => Number.isFinite(v))
  if (!valid.length) return null
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length
  const deviation = current - avg
  return {
    isSpike: deviation > threshold,
    avg,
    deviation,
    deviationPct: (deviation / avg) * 100,
  }
}

/**
 * Interprétation textuelle de l'IV Rank.
 *
 * @param {number|null} ivr
 * @returns {{ label: string, color: string }}
 */
export function interpretIVRank(ivr) {
  if (ivr == null) return { label: 'N/A', color: 'var(--text-muted)' }
  if (ivr >= 80) return { label: 'Très élevée', color: 'var(--call)' }
  if (ivr >= 60) return { label: 'Élevée',      color: 'var(--atm)' }
  if (ivr >= 40) return { label: 'Normale',      color: 'var(--accent2)' }
  if (ivr >= 20) return { label: 'Basse',        color: 'var(--text-dim)' }
  return                { label: 'Très basse',   color: 'var(--put)' }
}

/**
 * Calcule IV Rank + Percentile + Spike en une seule passe à partir d'un objet DVOL normalisé.
 *
 * @param {{ current: number, monthMin: number, monthMax: number, history: Array }} dvol
 * @returns {{ ivRank, ivPercentile, spike, interpretation } | null}
 */
export function analyzeIV(dvol) {
  if (!dvol) return null
  const histValues = dvol.history?.map(h => Array.isArray(h) ? h[1] : h).filter(Number.isFinite) ?? []
  const ivRank       = calcIVRank(dvol.current, dvol.monthMin, dvol.monthMax)
  const ivPercentile = calcIVPercentile(dvol.current, histValues)
  const spike        = detectIVSpike(dvol.current, histValues)
  return { ivRank, ivPercentile, spike, interpretation: interpretIVRank(ivRank) }
}
