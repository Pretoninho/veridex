// analytics/pattern_engine.js
//
// Moteur de scoring de patterns de marché (0 → 100).
//
// Combine 4 dimensions :
//   1. Edge directionnel  (probabilité brute)
//   2. Expected Value     (rentabilité)
//   3. Fréquence          (fiabilité statistique)
//   4. Stabilité          (qualité / dispersion)

import {
  createFingerprint,
  getPatternStats,
  computeAdvancedStats,
} from '../signals/market_fingerprint.js'

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function normalize(value, min, max) {
  if (value == null) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

// ─────────────────────────────────────────────────────────────
// Score Components
// ─────────────────────────────────────────────────────────────

// 1️⃣  Edge directionnel — range [-1 ; 1]
export function computeDirectionalScore(probUp, probDown) {
  if (probUp == null || probDown == null) return 0.5
  return probUp - probDown
}

// 2️⃣  Expected Value — normalisé [0 ; 1]
export function computeEVScore(ev) {
  return normalize(ev, -2, 2)
}

// 3️⃣  Fréquence (log scaling) — [0 ; 1]
export function computeFrequencyScore(occurrences) {
  return clamp(Math.log10((occurrences ?? 0) + 1) / 3, 0, 1)
}

// 4️⃣  Stabilité (moins de mouvements extrêmes = meilleur) — [0 ; 1]
export function computeStabilityScore(distribution, occurrences) {
  if (!distribution || !occurrences) return 0

  const extremeMoves = distribution.bigUp + distribution.bigDown
  const ratio = extremeMoves / occurrences

  return 1 - clamp(ratio, 0, 1)
}

// ─────────────────────────────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * Analyse un snapshot de marché et retourne un score de trading [0 ; 100].
 *
 * @param {{
 *   ivRank?: number|null,
 *   fundingPct?: number|null,
 *   spreadPct?: number|null,
 *   lsRatio?: number|null,
 *   basisPct?: number|null,
 * }} market
 * @param {{ timeframe?: '1h'|'24h'|'7d', minOccurrences?: number }} [options]
 * @returns {Promise<{
 *   hash: string,
 *   config: Object,
 *   score: number,
 *   confidence: number,
 *   signal: 'LONG'|'SHORT'|'NEUTRAL'|'NO_DATA'|'NO_STATS',
 *   probUp: number|null,
 *   probDown: number|null,
 *   expectedValue: number|null,
 *   occurrences: number,
 * }>}
 */
export async function analyzeMarketPattern(market, options = {}) {
  const { timeframe = '24h', minOccurrences = 20 } = options

  const { hash, config } = createFingerprint(market)
  const stats = await getPatternStats(hash)

  if (!stats || stats.occurrences < minOccurrences) {
    return {
      hash,
      config,
      score: 0,
      confidence: 0,
      signal: 'NO_DATA',
      probUp: null,
      probDown: null,
      expectedValue: null,
      occurrences: stats?.occurrences ?? 0,
    }
  }

  const tfStats  = stats.patternStats?.[timeframe]
  const advanced = computeAdvancedStats(tfStats)

  if (!advanced) {
    return {
      hash,
      config,
      score: 0,
      confidence: 0,
      signal: 'NO_STATS',
      probUp: null,
      probDown: null,
      expectedValue: null,
      occurrences: stats.occurrences,
    }
  }

  const { probUp, probDown, expectedValue, distribution } = advanced

  // ── Scores intermédiaires ──────────────────────────────────
  const directional = computeDirectionalScore(probUp, probDown) // [-1 ; 1]
  const evScore     = computeEVScore(expectedValue)             // [0 ; 1]
  const freqScore   = computeFrequencyScore(tfStats.occurrences)
  const stabScore   = computeStabilityScore(distribution, tfStats.occurrences)

  // ── Score final pondéré ────────────────────────────────────
  const rawScore =
    directional * 0.4 +
    evScore     * 0.3 +
    freqScore   * 0.2 +
    stabScore   * 0.1

  // Normalisation vers [0 ; 100]
  const score      = Math.round(clamp((rawScore + 1) / 2, 0, 1) * 100)
  const confidence = Math.round((freqScore * 0.6 + stabScore * 0.4) * 100)

  // ── Signal ─────────────────────────────────────────────────
  let signal = 'NEUTRAL'
  if (score > 65) signal = 'LONG'
  else if (score < 35) signal = 'SHORT'

  return {
    hash,
    config,
    score,
    confidence,
    signal,
    probUp,
    probDown,
    expectedValue,
    occurrences: tfStats.occurrences,
  }
}
