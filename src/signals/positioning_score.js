/**
 * positioning_score.js
 * Score de positionnement croisé — Retail (Binance) vs Institutionnels (Deribit)
 */

// ── Divergence ────────────────────────────────────────────────────────────────

/**
 * Calcule un score de divergence entre retail et institutionnels.
 * Quand ils divergent → signal contrarian fort
 * Quand ils convergent → signal directionnel confirmé
 *
 * @param {number|null} lsRatio  Long/Short Binance (> 1 = bullish retail)
 * @param {number|null} pcRatio  Put/Call Deribit  (> 1 = défensif institutionnels)
 * @returns {number|null} 0-100 (50 = neutre, > 50 = contrarian haussier)
 */
export function calcDivergenceScore(lsRatio, pcRatio) {
  if (lsRatio == null || pcRatio == null) return null

  // lsRatio > 1 → retail bullish → score positif
  const retailSignal = Math.tanh((lsRatio - 1) * 2)

  // pcRatio > 1 → plus de puts → instit bearish → score négatif
  const institutSignal = Math.tanh((1 - pcRatio) * 2)

  // Divergence = retail et institutionnels opposés
  const divergence = retailSignal - institutSignal

  // Normaliser à -1 → +1
  const normalizedDiv = Math.tanh(divergence / 2)

  return Math.round(50 + normalizedDiv * 50)
}

// ── Ratio combiné ─────────────────────────────────────────────────────────────

/**
 * Score par paliers depuis les deux ratios indépendamment.
 *
 * @param {number|null} lsRatio
 * @param {number|null} pcRatio
 * @returns {number|null} 0-100
 */
export function calcCombinedRatioScore(lsRatio, pcRatio) {
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

// ── Score final s6 ────────────────────────────────────────────────────────────

/**
 * Score de positionnement croisé final (s6).
 * Moyenne pondérée de la divergence et du ratio combiné.
 *
 * @param {number|null} lsRatio
 * @param {number|null} pcRatio
 * @returns {number|null} 0-100 ou null si aucune donnée
 */
export function calcPositioningScore(lsRatio, pcRatio) {
  if (lsRatio == null && pcRatio == null) return null

  const divergenceScore = calcDivergenceScore(lsRatio, pcRatio)
  const combinedScore   = calcCombinedRatioScore(lsRatio, pcRatio)

  const scores = [divergenceScore, combinedScore].filter(s => s != null)
  if (!scores.length) return null

  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

// ── Interprétation ────────────────────────────────────────────────────────────

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

/**
 * Interprète le positionnement croisé.
 *
 * @param {number|null} lsRatio
 * @param {number|null} pcRatio
 * @param {number|null} score   résultat de calcPositioningScore
 * @returns {object|null}
 */
export function interpretPositioning(lsRatio, pcRatio, score) {
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
