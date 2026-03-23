/**
 * core/index.js — Pure calculation functions
 *
 * Exports all pure calculation utilities:
 * - Volatility (Black-Scholes, Greeks, IV Rank, Skew, Max Pain)
 * - Market Structure (term structure, basis, DI rate)
 * - History (metric history, percentile calculations)
 */

export { calcOptionGreeks, blackScholes, calcDIRateBS } from './volatility/greeks.js'
export { calcIVRank, calcIVPercentile, detectIVSpike, interpretIVRank, analyzeIV } from './volatility/iv_rank.js'
export { calcSkew25d, calcSmile, interpretSkew } from './volatility/skew.js'
export { parseInstrument, calculateMaxPain, calculateMaxPainByExpiry, interpretMaxPain } from './volatility/max_pain.js'

export {
  calcBasis,
  annualizeBasis,
  calcDIRateSimple,
  analyzeTermStructure,
  calcTermStructureSignal,
  findBestDIExpiry,
} from './market_structure/term_structure.js'

export {
  recordSnapshot,
  getMetricHistory,
  getMetricPoints,
  calcPercentile,
  calcThresholdAtPct,
  calcMovingAvg,
  livePercentile,
  dynamicThreshold,
  metricDiag,
} from './history/metric_history.js'
