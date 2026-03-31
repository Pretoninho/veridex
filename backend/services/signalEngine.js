/**
 * backend/services/signalEngine.js
 *
 * Pure signal scoring engine — no browser dependencies (no IndexedDB, no localStorage).
 * Adapted from src/signals/signal_engine.js and src/signals/positioning_score.js.
 */

'use strict'

// ── Score functions ───────────────────────────────────────────────────────────

/**
 * IV score based on DVOL current vs. 30-day range.
 * @param {{ current: number, monthMin: number, monthMax: number }|null} dvol
 * @returns {number|null} 0–100
 */
function scoreIV(dvol) {
  if (!dvol) return null
  const avg30 = (dvol.monthMin + dvol.monthMax) / 2
  const ratio = dvol.current / avg30
  if (ratio >= 1.20) return 100
  if (ratio >= 1.10) return 75
  if (ratio >= 0.95) return 50
  if (ratio >= 0.85) return 25
  return 0
}

/**
 * Funding rate score (annualized).
 * @param {{ rateAnn?: number, avgAnn7d?: number }|null} funding
 * @returns {number|null} 0–100
 */
function scoreFunding(funding) {
  if (!funding) return null
  const r = funding.rateAnn ?? funding.avgAnn7d
  if (r == null) return null
  if (r >= 30) return 100
  if (r >= 15) return 75
  if (r >= 5)  return 50
  if (r >= 0)  return 25
  return 0
}

/**
 * Basis futures score (average annualized basis in %).
 * @param {number|null} basisAvg
 * @returns {number|null} 0–100
 */
function scoreBasis(basisAvg) {
  if (basisAvg == null) return null
  if (basisAvg >= 15) return 100
  if (basisAvg >= 8)  return 75
  if (basisAvg >= 3)  return 50
  if (basisAvg >= 0)  return 25
  return 0
}

/**
 * IV vs. RV premium score.
 * @param {{ current: number }|null} dvol
 * @param {{ current: number }|null} rv
 * @returns {number|null} 0–100
 */
function scoreIVvsRV(dvol, rv) {
  if (!dvol || !rv) return null
  const premium = dvol.current - rv.current
  if (premium >= 20) return 100
  if (premium >= 10) return 75
  if (premium >= 0)  return 50
  return 0
}

// ── Positioning score (from positioning_score.js) ────────────────────────────

function calcDivergenceScore(lsRatio, pcRatio) {
  if (lsRatio == null || pcRatio == null) return null
  const retailSignal  = Math.tanh((lsRatio - 1) * 2)
  const institutSignal = Math.tanh((1 - pcRatio) * 2)
  const divergence    = retailSignal - institutSignal
  const normalizedDiv = Math.tanh(divergence / 2)
  return Math.round(50 + normalizedDiv * 50)
}

function calcCombinedRatioScore(lsRatio, pcRatio) {
  if (lsRatio == null && pcRatio == null) return null

  let score = 50

  if (lsRatio != null) {
    if      (lsRatio >= 2.0)  score -= 25
    else if (lsRatio >= 1.5)  score -= 15
    else if (lsRatio >= 1.2)  score -= 5
    else if (lsRatio <= 0.5)  score += 25
    else if (lsRatio <= 0.7)  score += 15
    else if (lsRatio <= 0.85) score += 5
  }

  if (pcRatio != null) {
    if      (pcRatio >= 1.5)  score -= 25
    else if (pcRatio >= 1.2)  score -= 15
    else if (pcRatio >= 1.0)  score -= 5
    else if (pcRatio <= 0.5)  score += 25
    else if (pcRatio <= 0.7)  score += 15
    else if (pcRatio <= 0.85) score += 5
  }

  return Math.max(0, Math.min(100, score))
}

function calcPositioningScore(lsRatio, pcRatio) {
  if (lsRatio == null && pcRatio == null) return null

  const divergenceScore = calcDivergenceScore(lsRatio, pcRatio)
  const combinedScore   = calcCombinedRatioScore(lsRatio, pcRatio)

  const scores = [divergenceScore, combinedScore].filter(s => s != null)
  if (!scores.length) return null

  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

const RETAIL_LABELS = {
  bullish: { label: 'Long',   color: 'put'     },
  bearish: { label: 'Short',  color: 'call'    },
  neutral: { label: 'Neutre', color: 'neutral' },
}

const INSTIT_LABELS = {
  bullish: { label: 'Offensif', color: 'call'    },
  bearish: { label: 'Défensif', color: 'put'     },
  neutral: { label: 'Neutre',   color: 'neutral' },
}

function interpretPositioning(lsRatio, pcRatio, score) {
  if (score == null) return null

  const retailBullish   = lsRatio != null && lsRatio > 1.2
  const retailBearish   = lsRatio != null && lsRatio < 0.8
  const institutBullish = pcRatio != null && pcRatio < 0.85
  const institutBearish = pcRatio != null && pcRatio > 1.15

  let divergenceType = 'neutral'
  let signal         = 'neutral'
  let strength       = 'weak'

  if (retailBullish && institutBearish) {
    divergenceType = 'retail_bullish_instit_bearish'
    signal         = 'bearish'
    strength       = (lsRatio > 1.5 && pcRatio > 1.3) ? 'strong' : 'moderate'
  } else if (retailBearish && institutBullish) {
    divergenceType = 'retail_bearish_instit_bullish'
    signal         = 'bullish'
    strength       = (lsRatio < 0.7 && pcRatio < 0.7) ? 'strong' : 'moderate'
  } else if (retailBullish && institutBullish) {
    divergenceType = 'consensus_bullish'
    signal         = 'bullish'
    strength       = 'moderate'
  } else if (retailBearish && institutBearish) {
    divergenceType = 'consensus_bearish'
    signal         = 'bearish'
    strength       = 'moderate'
  }

  const retailLabel = retailBullish
    ? RETAIL_LABELS.bullish
    : retailBearish
    ? RETAIL_LABELS.bearish
    : RETAIL_LABELS.neutral

  const institutLabel = institutBullish
    ? INSTIT_LABELS.bullish
    : institutBearish
    ? INSTIT_LABELS.bearish
    : INSTIT_LABELS.neutral

  let expertAction = ''
  if (divergenceType === 'retail_bullish_instit_bearish') {
    expertAction =
      `Retail massivement long (L/S ${lsRatio?.toFixed(2)}) ` +
      `· Institutionnels défensifs ` +
      `(P/C ${pcRatio?.toFixed(2)}). ` +
      `Signal contrarian baissier ${strength}. ` +
      `Réduire exposition longue — ` +
      `envisager short perp ou puts ATM.`
  } else if (divergenceType === 'retail_bearish_instit_bullish') {
    expertAction =
      `Retail paniqué (L/S ${lsRatio?.toFixed(2)}) ` +
      `· Institutionnels offensifs ` +
      `(P/C ${pcRatio?.toFixed(2)}). ` +
      `Signal contrarian haussier ${strength}. ` +
      `Réduire shorts — ` +
      `envisager long spot ou calls OTM.`
  } else if (divergenceType === 'consensus_bullish') {
    expertAction =
      `Consensus haussier : retail long ` +
      `(L/S ${lsRatio?.toFixed(2)}) ` +
      `· institutionnels offensifs ` +
      `(P/C ${pcRatio?.toFixed(2)}). ` +
      `Momentum confirmé mais surveiller ` +
      `le retournement.`
  } else if (divergenceType === 'consensus_bearish') {
    expertAction =
      `Consensus baissier : retail short ` +
      `(L/S ${lsRatio?.toFixed(2)}) ` +
      `· institutionnels défensifs ` +
      `(P/C ${pcRatio?.toFixed(2)}). ` +
      `Momentum baissier confirmé.`
  } else {
    expertAction =
      `Positionnement neutre. ` +
      `Pas d'edge directionnel ` +
      `depuis le croisement retail/institutionnels.`
  }

  return {
    score,
    signal,
    strength,
    divergenceType,
    retailLabel,
    institutLabel,
    lsRatio,
    pcRatio,
    expertAction,
  }
}

// ── Global score ──────────────────────────────────────────────────────────────

/**
 * Compute weighted composite score.
 * Null components are excluded and weights redistributed.
 */
function calcGlobalScore(s1, s2, s3, s4, s5, s6) {
  const hasS5 = s5 != null
  const hasS6 = s6 != null

  const w1 = hasS5 ? 30 : 35
  const w2 = hasS5 ? 20 : 25
  const w3 = hasS5 ? 20 : 25
  const w4 = 15
  const w5 = hasS6 ? 10 : 15
  const w6 = hasS6 ? 15 : 0

  let total = 0, weights = 0
  if (s1 != null) { total += s1 * w1; weights += w1 }
  if (s2 != null) { total += s2 * w2; weights += w2 }
  if (s3 != null) { total += s3 * w3; weights += w3 }
  if (s4 != null) { total += s4 * w4; weights += w4 }
  if (s5 != null) { total += s5 * w5; weights += w5 }
  if (s6 != null) { total += s6 * w6; weights += w6 }
  return weights > 0 ? Math.round(total / weights) : null
}

// ── Signal interpretation ─────────────────────────────────────────────────────

function getSignal(score) {
  if (score == null) return null
  if (score >= 80) return {
    label:  'Exceptionnel',
    action: 'Conditions exceptionnelles — multiples opportunités actives',
  }
  if (score >= 60) return {
    label:  'Favorable',
    action: 'Conditions favorables — bon moment pour agir',
  }
  if (score >= 40) return {
    label:  'Neutre',
    action: 'Marché neutre — être sélectif sur les positions',
  }
  return {
    label:  'Défavorable',
    action: 'Attendre un meilleur contexte de marché',
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Compute a full signal from normalized market data.
 *
 * @param {{
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   onChainScore?: number|null,
 *   spot?: number|null,
 *   asset?: string,
 *   lsRatio?: number|null,
 *   pcRatio?: number|null,
 * }} inputs
 * @returns {{
 *   asset: string,
 *   spot: number|null,
 *   scores: { s1, s2, s3, s4, s5, s6 },
 *   global: number|null,
 *   signal: object|null,
 *   positioning: object|null,
 *   timestamp: number,
 * }}
 */
function computeSignal({ dvol, funding, rv, basisAvg, onChainScore = null, spot = null, asset = 'BTC',
  lsRatio = null, pcRatio = null }) {
  const s1 = scoreIV(dvol)
  const s2 = scoreFunding(funding)
  const s3 = scoreBasis(basisAvg)
  const s4 = scoreIVvsRV(dvol, rv)
  const s5 = onChainScore ?? null
  const s6 = calcPositioningScore(lsRatio, pcRatio)
  const global = calcGlobalScore(s1, s2, s3, s4, s5, s6)
  const positioning = interpretPositioning(lsRatio, pcRatio, s6)

  // Calculate dvolFactor for multi-timeframe analysis
  const dvolFactor = dvol != null
    ? dvol.current / ((dvol.monthMin + dvol.monthMax) / 2)
    : 1

  return {
    asset: asset.toUpperCase(),
    spot,
    scores: { s1, s2, s3, s4, s5, s6 },
    global,
    signal: getSignal(global),
    positioning,
    dvolFactor,
    timestamp: Date.now(),
  }
}

module.exports = { computeSignal }
