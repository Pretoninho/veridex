/**
 * backend/utils/volThreshold.js
 *
 * Volatility-based, direction-aware trading outcome helpers.
 *
 * Direction rule (strict):
 *   - Trade direction comes ONLY from computeSignal().positioning.signal
 *   - 'bullish' → LONG
 *   - 'bearish' → SHORT
 *   - 'neutral' → null  (NO TRADE — do not settle)
 *
 * Volatility source priority:
 *   - DVOL / IV (primary) when dvol.current is available
 *   - Fallback to rv.current, then rv.avg30
 *
 * Threshold formula:
 *   sigmaT    = volAnn × sqrt(T_days / DAYS_PER_YEAR)
 *   threshold = k × sigmaT
 */

'use strict'

/** Number of calendar days used to annualise volatility. */
const DAYS_PER_YEAR = 365

/**
 * Default k multiplier.
 * Configurable via SETTLEMENT_K environment variable (default 0.75).
 */
const DEFAULT_K = parseFloat(process.env.SETTLEMENT_K ?? '0.75')

/**
 * Map computeSignal positioning output to a trade direction.
 * Returns null (NO TRADE) for neutral positioning signals.
 *
 * @param {{ signal: string }|null} positioning
 * @returns {'LONG'|'SHORT'|null}
 */
function extractDirection(positioning) {
  if (!positioning) return null
  if (positioning.signal === 'bullish') return 'LONG'
  if (positioning.signal === 'bearish') return 'SHORT'
  return null
}

/**
 * Select the annualised volatility and its source.
 * Priority: DVOL (IV) first, then RV.current, then RV.avg30.
 *
 * Handles both percentage form (e.g. 65 for 65 %) and decimal form
 * (e.g. 0.65).  Values > 2 are assumed to be in percent form.
 *
 * @param {{ current?: number }|null} dvol
 * @param {{ current?: number, avg30?: number }|null} rv
 * @returns {{ volAnn: number|null, source: 'DVOL'|'RV'|null }}
 */
function selectVolSource(dvol, rv) {
  if (dvol?.current != null) {
    const raw = dvol.current
    // Values > 2 are assumed to be in percentage form (e.g. 65 for 65 %);
    // values ≤ 2 are assumed to already be in decimal form (e.g. 0.65).
    // The threshold of 2 is safe because real-world annualised crypto vol
    // rarely falls below 200 % in decimal form, and never below 2 % in
    // percentage form.
    const volAnn = raw > 2 ? raw / 100 : raw
    return { volAnn, source: 'DVOL' }
  }
  if (rv) {
    const raw = rv.current ?? rv.avg30 ?? null
    if (raw != null) {
      // Same normalisation as DVOL above.
      const volAnn = raw > 2 ? raw / 100 : raw
      return { volAnn, source: 'RV' }
    }
  }
  return { volAnn: null, source: null }
}

/**
 * Compute the dynamic move threshold for a given horizon.
 *
 *   threshold = k × volAnn × sqrt(T_days / DAYS_PER_YEAR)
 *
 * @param {number} volAnn      - annualised vol as a decimal (e.g. 0.65 for 65 %)
 * @param {number} horizonDays - horizon expressed in fractional days
 *                               (1/24 for 1 h, 4/24 for 4 h, 1 for 24 h)
 * @param {number} [k]         - multiplier (defaults to DEFAULT_K)
 * @returns {number}             threshold as a decimal (e.g. 0.015 for 1.5 %)
 */
function computeThreshold(volAnn, horizonDays, k = DEFAULT_K) {
  return k * volAnn * Math.sqrt(horizonDays / DAYS_PER_YEAR)
}

/**
 * Label a directional outcome as WIN / LOSS / FLAT.
 *
 * LONG  → WIN if ret ≥ +threshold, LOSS if ret ≤ −threshold, else FLAT
 * SHORT → WIN if ret ≤ −threshold, LOSS if ret ≥ +threshold, else FLAT
 *
 * @param {'LONG'|'SHORT'} direction
 * @param {number} ret       - return as a decimal (e.g. 0.02 for +2 %)
 * @param {number} threshold - threshold as a decimal (e.g. 0.015 for 1.5 %)
 * @returns {'WIN'|'LOSS'|'FLAT'}
 */
function labelOutcome(direction, ret, threshold) {
  if (direction === 'LONG') {
    if (ret >= threshold)  return 'WIN'
    if (ret <= -threshold) return 'LOSS'
  } else {
    if (ret <= -threshold) return 'WIN'
    if (ret >= threshold)  return 'LOSS'
  }
  return 'FLAT'
}

module.exports = {
  DEFAULT_K,
  DAYS_PER_YEAR,
  extractDirection,
  selectVolSource,
  computeThreshold,
  labelOutcome,
}
