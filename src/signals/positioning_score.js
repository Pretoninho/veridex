/**
 * positioning_score.js
 * v2.0: Deribit-only positioning score
 *
 * Score de positionnement basé sur le ratio Put/Call Deribit
 * (placement des options institutionnelles)
 */

import { POSITIONING } from '../config/signal_calibration.js'

// ── Score basé sur Put/Call ratio ─────────────────────────────────────────────

/**
 * Calcule un score de positionnement depuis le P/C ratio seul.
 * P/C > 1 → plus de puts → institutionnels défensifs → score bas
 * P/C < 1 → moins de puts → institutionnels offensifs → score haut
 *
 * @param {number|null} pcRatio  Put/Call Deribit  (> 1 = défensif, < 1 = offensif)
 * @returns {number|null} 0-100 (50 = neutre)
 */
function scorePutCallRatio(pcRatio) {
  if (pcRatio == null) return null

  const pcAdj = POSITIONING.pcAdjustments
  let score = POSITIONING.scoreBase

  if      (pcRatio >= pcAdj.veryBearish.threshold)  score += pcAdj.veryBearish.adjustment
  else if (pcRatio >= pcAdj.bearish.threshold)      score += pcAdj.bearish.adjustment
  else if (pcRatio >= pcAdj.mildlyBearish.threshold) score += pcAdj.mildlyBearish.adjustment
  else if (pcRatio <= pcAdj.veryBullish.threshold)  score += pcAdj.veryBullish.adjustment
  else if (pcRatio <= pcAdj.bullish.threshold)      score += pcAdj.bullish.adjustment
  else if (pcRatio <= pcAdj.mildlyBullish.threshold) score += pcAdj.mildlyBullish.adjustment

  return Math.max(0, Math.min(100, score))
}

// ── Score final s6 ────────────────────────────────────────────────────────────

/**
 * Score de positionnement final (s6) — Deribit P/C ratio.
 *
 * v2.0: lsRatio parameter kept for compatibility but ignored.
 * Only pcRatio (Deribit Put/Call) is used.
 *
 * @param {number|null} lsRatio  Ignored (v2.0 - Binance removed)
 * @param {number|null} pcRatio  Put/Call ratio de Deribit options
 * @returns {number|null} 0-100 ou null si pas de donnée
 */
export function calcPositioningScore(lsRatio, pcRatio) {
  // v2.0: ignore lsRatio, use pcRatio only
  if (pcRatio == null) return null
  return scorePutCallRatio(pcRatio)
}

// ── Deprecated functions (v2.0) ──────────────────────────────────────────────

/**
 * Deprecated: calcDivergenceScore no longer exists in v2.0
 * Used to compare Binance L/S vs Deribit P/C
 */
export function calcDivergenceScore() {
  console.warn('[v2.0] calcDivergenceScore deprecated — use calcPositioningScore(null, pcRatio) with P/C ratio only')
  return null
}

/**
 * Deprecated: calcCombinedRatioScore no longer exists in v2.0
 * Use calcPositioningScore instead
 */
export function calcCombinedRatioScore() {
  console.warn('[v2.0] calcCombinedRatioScore deprecated — use calcPositioningScore(null, pcRatio) with P/C ratio only')
  return null
}

/**
 * Interprète le positionnement institutionnel.
 * @param {number|null} lsRatio  Ignored (v2.0 - Binance removed)
 * @param {number|null} pcRatio  Put/Call ratio
 * @param {number|null} s6Score  Score positionning (0-100)
 * @returns {object|null}
 */
export function interpretPositioning(lsRatio, pcRatio, s6Score) {
  // v2.0: ignore lsRatio
  if (pcRatio == null || s6Score == null) return null

  return {
    pcRatio,
    score: s6Score,
    signalType: s6Score >= 60 ? 'bullish' : s6Score <= 40 ? 'bearish' : 'neutral',
    interpretation: s6Score >= 60
      ? 'Institutionnels offensifs (P/C < 1)'
      : s6Score <= 40
      ? 'Institutionnels défensifs (P/C > 1)'
      : 'Positionnement neutre',
  }
}
