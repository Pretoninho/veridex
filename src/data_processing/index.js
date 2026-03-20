/**
 * data_processing/index.js — Point d'entrée du Data Processing
 *
 * Toute la couche strategy_engine et UI importe depuis ici.
 *
 * Architecture :
 *   data_processing/
 *   ├── volatility/
 *   │   ├── greeks.js         ← Black-Scholes pricing + Greeks
 *   │   ├── iv_rank.js        ← IV Rank, IV Percentile, spike detection
 *   │   └── skew.js           ← Skew 25-delta, smile de vol
 *   ├── market_structure/
 *   │   └── term_structure.js ← Basis annualisé, contango/backwardation, signal DI
 *   └── signals/
 *       └── signal_engine.js  ← Score composite (IV + funding + basis + IV/RV)
 */

// ── Volatilité ────────────────────────────────────────────────────────────────
export { calcOptionGreeks, blackScholes, calcDIRateBS } from './volatility/greeks.js'
export { calcIVRank, calcIVPercentile, detectIVSpike, interpretIVRank, analyzeIV } from './volatility/iv_rank.js'
export { calcSkew25d, calcSmile, interpretSkew } from './volatility/skew.js'

// ── Structure des termes ──────────────────────────────────────────────────────
export {
  calcBasis,
  annualizeBasis,
  calcDIRateSimple,
  analyzeTermStructure,
  calcTermStructureSignal,
  findBestDIExpiry,
} from './market_structure/term_structure.js'

// ── Signaux ───────────────────────────────────────────────────────────────────
export {
  scoreIV,
  scoreFunding,
  scoreBasis,
  scoreIVvsRV,
  calcGlobalScore,
  getSignal,
  computeSignal,
} from './signals/signal_engine.js'
