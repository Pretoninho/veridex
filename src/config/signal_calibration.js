/**
 * src/config/signal_calibration.js
 *
 * Central configuration file for all signal parameters.
 * This is the single source of truth for 140+ thresholds, weights, and constants.
 *
 * Organization:
 * 1. Score Calculation Thresholds (scoreIV, scoreFunding, etc.)
 * 2. Global Score Weighting (s1-s6 component weights)
 * 3. Signal Interpretation Boundaries (80/60/40 classification)
 * 4. Positioning Thresholds (retail/instit ratios, adjustments)
 * 5. Convergence Criteria (percentile targets, minimums)
 * 6. On-Chain Signal Parameters (exchange flows, mempool, hash rate)
 * 7. Notification Thresholds (defaults for price move, IV spike, etc.)
 * 8. Market Fingerprint Bucketing (IV, funding, spread, basis)
 * 9. Timing & Windows (anomaly detection, IV spike window, settlement)
 * 10. Storage & Limits (max histories, max items)
 * 11. API Configuration (Claude, Anthropic, caching)
 * 12. Strike Pricing & Options (OTM multipliers, example gains)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCORE CALCULATION THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE_THRESHOLDS = {
  // IV Score: Ratio of DVOL vs 30-day average
  // High ratio = elevated volatility
  IV: {
    extreme: 1.20,   // Score 100: DVOL/avg30 >= 1.20
    high: 1.10,      // Score 75:  DVOL/avg30 >= 1.10
    normal: 0.95,    // Score 50:  DVOL/avg30 >= 0.95
    low: 0.85,       // Score 25:  DVOL/avg30 >= 0.85
    // Score 0: DVOL/avg30 < 0.85
  },

  // Funding Score: Annualized funding rate (%)
  // High rate = markets are bullish
  Funding: {
    extreme: 30,     // Score 100: >= 30%/year
    high: 15,        // Score 75:  >= 15%/year
    normal: 5,       // Score 50:  >= 5%/year
    zero: 0,         // Score 25:  >= 0%/year
    // Score 0: < 0%/year (negative funding)
  },

  // Basis Score: Annualized futures basis (%)
  // High basis = cash-and-carry premium available
  Basis: {
    extreme: 15,     // Score 100: >= 15%/year
    high: 8,         // Score 75:  >= 8%/year
    normal: 3,       // Score 50:  >= 3%/year
    zero: 0,         // Score 25:  >= 0%/year
    // Score 0: < 0%/year (backwardation)
  },

  // IV vs Realized Vol Premium Score
  // Positive premium = vol is expensive
  IVvRV: {
    extreme: 20,     // Score 100: DVOL - RV >= 20 pts
    high: 10,        // Score 75:  DVOL - RV >= 10 pts
    neutral: 0,      // Score 50:  DVOL - RV >= 0 pts
    // Score 0: DVOL - RV < 0 (rare: RV > IV)
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GLOBAL SCORE WEIGHTING
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  // Complete scenario: All 6 components available (s1-s6)
  complete: {
    s1_iv: 0.30,            // IV Rank
    s2_funding: 0.20,       // Funding Rate
    s3_basis: 0.20,         // Futures Basis
    s4_ivVsRv: 0.15,        // IV vs RV Premium
    s5_onChain: 0.10,       // On-Chain Sentiment
    s6_positioning: 0.15,   // Positioning Divergence
  },

  // Without positioning (s5 + s6, no s6)
  withoutPositioning: {
    s1_iv: 0.30,
    s2_funding: 0.20,
    s3_basis: 0.20,
    s4_ivVsRv: 0.15,
    s5_onChain: 0.15,       // Extra 5% to on-chain
  },

  // Minimal scenario: Only traditional components (s1-s4)
  minimal: {
    s1_iv: 0.35,            // Increase to 35%
    s2_funding: 0.25,       // Increase to 25%
    s3_basis: 0.25,         // Increase to 25%
    s4_ivVsRv: 0.15,        // Keep at 15%
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SIGNAL INTERPRETATION BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNAL_BOUNDARIES = {
  exceptional: 80,   // 🔥 Exceptionnel: Score >= 80
  favorable: 60,     // ✓ Favorable:    Score >= 60
  neutral: 40,       // ~ Neutre:       Score >= 40
  // Unfavorable: Score < 40 (↓ Défavorable)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. POSITIONING THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

export const POSITIONING = {
  // L/S Ratio thresholds (Binance Long/Short sentiment)
  lsRatio: {
    bullish: 1.2,           // Retail bullish: L/S > 1.2
    bearish: 0.8,           // Retail bearish: L/S < 0.8
    strongBullish: 1.5,     // Strong signal: L/S > 1.5
    strongBearish: 0.7,     // Strong signal: L/S < 0.7
  },

  // P/C Ratio thresholds (Deribit Put/Call ratio, inverted interpretation)
  pcRatio: {
    bullish: 0.85,          // Instit bullish (fewer puts): P/C < 0.85
    bearish: 1.15,          // Instit bearish (more puts): P/C > 1.15
    strongBullish: 0.7,     // Strong signal: P/C < 0.7
    strongBearish: 1.3,     // Strong signal: P/C > 1.3
  },

  // Score Adjustments for L/S Ratio (lsRatio > 1 = retail bullish)
  lsAdjustments: {
    veryBullish: { threshold: 2.0, adjustment: -25 },    // Retail extremely long
    bullish: { threshold: 1.5, adjustment: -15 },         // Moderately long
    mildlyBullish: { threshold: 1.2, adjustment: -5 },    // Slightly long
    veryBearish: { threshold: 0.5, adjustment: +25 },     // Retail extremely short
    bearish: { threshold: 0.7, adjustment: +15 },         // Moderately short
    mildlyBearish: { threshold: 0.85, adjustment: +5 },   // Slightly short
  },

  // Score Adjustments for P/C Ratio (pcRatio < 1 = instit bullish)
  pcAdjustments: {
    veryBearish: { threshold: 1.5, adjustment: -25 },     // High puts (defensive)
    bearish: { threshold: 1.2, adjustment: -15 },         // Moderately defensive
    mildlyBearish: { threshold: 1.0, adjustment: -5 },    // Slightly defensive
    veryBullish: { threshold: 0.5, adjustment: +25 },     // Low puts (offensive)
    bullish: { threshold: 0.7, adjustment: +15 },         // Moderately offensive
    mildlyBullish: { threshold: 0.85, adjustment: +5 },   // Slightly offensive
  },

  // Math.tanh() normalization parameters
  tanh: {
    retailMultiplier: 2,     // Math.tanh((lsRatio - 1) * 2)
    institMultiplier: 2,     // Math.tanh((1 - pcRatio) * 2)
    divergenceNormalizer: 2, // Math.tanh(divergence / 2)
  },

  // Base score and scaling
  scoreBase: 50,             // Center score before adjustments
  scoreMultiplier: 50,       // divergence * 50
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CONVERGENCE CRITERIA
// ─────────────────────────────────────────────────────────────────────────────

export const CONVERGENCE = {
  // Minimum requirements
  MIN_HIST_POINTS: 20,       // Need 20+ data points for dynamic thresholds
  MIN_CONVERGENCE: 3,        // Need 3+ criteria simultaneously aligned
  STRONG_CONVERGENCE: 5,     // 5+ criteria = strong signal
  MODERATE_CONVERGENCE: 3,   // 3-4 criteria = moderate signal
  WEAK_CONVERGENCE: 1,       // 1-2 criteria = weak signal

  // Dynamic criteria thresholds (percentile-based if enough history, else absolute)
  criteria: {
    ivRank: {
      dynamicPercentile: 70,   // Use 70th percentile if available
      absoluteThreshold: 60,   // Fallback: 60%
    },
    dvol: {
      dynamicPercentile: 60,
      absoluteThreshold: 60,   // 60%
    },
    ivPremium: {
      dynamicPercentile: 65,
      absoluteThreshold: 5,    // 5 pts
    },
    funding: {
      dynamicPercentile: 70,
      absoluteThreshold: 10,   // 10%
    },
    basis: {
      dynamicPercentile: 60,
      absoluteThreshold: 3,    // 3%
    },
    skew: {
      dynamicPercentile: 65,
      absoluteThreshold: 4,    // 4 pts
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ON-CHAIN SIGNALS
// ─────────────────────────────────────────────────────────────────────────────

export const ONCHAIN_SIGNALS = {
  // Exchange Flow Strength Multipliers
  flow: {
    strongMultiplier: 2.5,    // >= 2.5× average = strong signal
    moderateMultiplier: 1.5,  // >= 1.5× average = moderate signal
    // < 1.5× = weak signal
  },

  // Mempool Thresholds (sats/vB)
  mempool: {
    criticalFee: 100,         // > 100 sats/vB = critical congestion
    congestedFee: 50,         // > 50 sats/vB = congested
    // < 50 sats/vB = normal
    criticalTxCount: 100000,  // > 100k pending txs = congested
    emptyTxCount: 5000,       // < 5k pending = anormally empty
  },

  // Hash Rate Change Thresholds (%)
  hashRate: {
    bullish: 5,               // > +5% change = bullish
    bearish: -5,              // < -5% change = bearish
    durationDays: 7,          // Calculate change over 7 days
    durationDaysMax: 30,      // Max estimation 30 days
  },

  // Fear & Greed Index Thresholds
  fearGreed: {
    extremeFear: 25,          // <= 25 = extreme fear
    fear: 45,                 // <= 45 = fear
    neutral: 55,              // <= 55 = neutral
    greed: 75,                // <= 75 = greed
    // > 75 = extreme greed
    significantDelta: 5,      // >= 5 points change = momentum signal
  },

  // On-Chain Score Interpretation (Expert)
  scoreInterpretation: {
    favorable: 70,            // >= 70 = favorable on-chain context
    neutral: 50,              // >= 50 = neutral
    weak: 35,                 // <= 35 = weak on-chain context
  },

  // On-Chain Score Interpretation (Novice UI)
  scoreInterpretationNovice: {
    positive: 65,             // >= 65 = positive sentiment
    neutral: 45,              // >= 45 = neutral sentiment
    negative: 0,              // < 45 = negative sentiment
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. NOTIFICATION THRESHOLDS (Defaults)
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_DEFAULTS = {
  // N1: Price Move Detection
  price_move_pct: 5.0,                // 5% threshold
  price_move_window_ms: 3_600_000,    // 1 hour window

  // N2: IV Spike Detection
  iv_spike_low: 50,                   // IV Rank < 50 = compression alert
  iv_spike_high: 70,                  // IV Rank > 70 = expansion alert
  iv_spike_window_ms: 14_400_000,     // 4 hour window

  // N3: Funding Change
  funding_change_ann: 20.0,           // 20% annualized change threshold
  funding_change_window_ms: 900_000,  // 15 minute window

  // N4: Liquidations
  liquidations_usd: 50_000_000,       // $50M threshold
  liquidations_window_ms: 3_600_000,  // 1 hour window

  // N5: Settlement Alert
  settlement_delta_pct: 0.3,          // 0.3% vs spot delta

  // N6-N8: Expiry Warnings
  expiry_warning_24h: 86_400_000,     // 24 hours
  expiry_warning_1h: 3_600_000,       // 1 hour

  // N9: Funding Fixing
  funding_fixing_warning: 1_800_000,  // 30 minutes before fixing

  // Signal Change Thresholds
  score_thresholds: [40, 60, 75, 90], // Category boundaries
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. NOTIFICATION COOLDOWNS (Anti-Spam)
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_COOLDOWNS = {
  price_move: 1_800_000,       // 30 minutes
  iv_spike: 3_600_000,         // 1 hour
  funding_change: 900_000,     // 15 minutes
  liquidations: 1_800_000,     // 30 minutes
  settlement: 86_400_000,      // 24 hours
  anomaly: 1_800_000,          // 30 minutes
  signal_change: 1_800_000,    // 30 minutes
  expiry: 3_600_000,           // 1 hour
  funding_fixing: 28_800_000,  // 8 hours
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. MARKET FINGERPRINT BUCKETING
// ─────────────────────────────────────────────────────────────────────────────

export const FINGERPRINT_BUCKETING = {
  // Bucketing granularity
  ivRank: 10,                  // Bucket by 10 (0, 10, 20, ..., 100)
  funding: 5,                  // Bucket by 5% intervals

  // Spread Classification
  spread: {
    wide: 0.5,                 // >= 0.5%
    normal: 0.1,               // >= 0.1%
    tight: 0.1,                // < 0.1%
  },

  // L/S Ratio Classification
  lsRatio: {
    longHeavy: 1.2,            // >= 1.2
    shortHeavy: 0.8,           // <= 0.8
  },

  // Basis Classification (%)
  basis: {
    highContango: 10,          // >= 10%
    contango: 2,               // >= 2%
    flat: -2,                  // >= -2%
    backwardation: -2,         // < -2%
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. TIMING & WINDOWS
// ─────────────────────────────────────────────────────────────────────────────

export const TIMING = {
  // Anomaly Detection
  ANOMALY_THRESHOLD: 3,        // Need 3+ indicators changing
  ANOMALY_WINDOW_MS: 10_000,   // 10 second window
  INDICATOR_CHANGE_PCT: 1,     // 1% relative change = significant

  // Deduplication
  ANOMALY_DEDUP_MS: 60_000,    // 1 minute dedup window
  NOTIFICATION_DEDUP_MS: 60_000, // 1 minute dedup window

  // Settlement Time
  SETTLEMENT_HOUR_UTC: 8,      // 08:00 UTC
  SETTLEMENT_WINDOW_SEC: 59,   // Capture within 08:00:00-08:00:59

  // Funding Fixing Schedule (UTC)
  FUNDING_FIXING_TIMES: [
    { hour: 0, minute: 0 },    // 00:00 UTC
    { hour: 8, minute: 0 },    // 08:00 UTC
    { hour: 16, minute: 0 },   // 16:00 UTC
  ],

  // Polling & Refresh Intervals
  SETTLEMENT_CHECK_INTERVAL: 30_000, // 30 seconds
  SIGNAL_POLLING_INTERVAL: 15_000,   // 15 seconds

  // Liquidation Accumulation Window
  LIQUIDATION_WINDOW_MS: 3_600_000, // 1 hour

  // Pattern Outcome Windows
  outcomeWindows: {
    oneHour: 300_000,          // 5 minutes after 1h mark
    fourHours: 300_000,        // 5 minutes after 4h mark
    twentyFourHours: 300_000,  // 5 minutes after 24h mark
    sevenDays: 300_000,        // 5 minutes after 7d mark
  },

  // Weekly/Monthly/Quarterly Settlement Markers
  settlementMarkers: {
    weeklyDay: 5,              // Friday (0=Sun, 5=Fri)
    monthlyDayMin: 25,         // From 25th of month
    quarterlyMonths: [3, 6, 9, 12], // Mar, Jun, Sep, Dec
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. STORAGE & LIMITS
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_LIMITS = {
  // Signal History
  MAX_ANOMALIES: 200,
  MAX_SIGNALS_STORED: 500,
  MAX_NOTIFICATION_HISTORY: 200,

  // Settlement History
  MAX_SETTLEMENT_HISTORY: 365,    // 1 year

  // Pattern Storage
  MAX_OUTCOMES_PER_PATTERN: 200,
  MAX_CHAIN_LENGTH: 365,
  MIN_OCCURRENCES_TO_EXPORT: 2,

  // localStorage Keys
  THRESHOLDS_KEY: 'veridex_notif_thresholds',
  HISTORY_KEY: 'veridex_notif_history',
  COOLDOWNS_KEY: 'veridex_notif_cooldowns',
  ANOMALY_LOG_KEY: 'veridex_anomaly_log',
  SIGNALS_IDB_KEY: 'signal_history',

  // IndexedDB Keys
  SETTLEMENT_IDB_KEY_BTC: 'settlement_history_BTC',
  SETTLEMENT_IDB_KEY_ETH: 'settlement_history_ETH',
  FINGERPRINT_IDB_PREFIX: 'mf_',
  FINGERPRINT_INDEX_KEY: 'mf_index',
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. API CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const API_CONFIG = {
  // Claude API (Insight Generation)
  ANTHROPIC_API_URL: 'https://api.anthropic.com/v1/messages',
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  CLAUDE_MAX_TOKENS: 60,

  // API Caching
  INSIGHT_CACHE_TTL_MS: 300_000, // 5 minutes
  INSIGHT_CACHE_ROUNDING: 0.1,   // Round to 1 decimal place

  // API Keys (from env)
  VITE_ANTHROPIC_API_KEY: 'env:VITE_ANTHROPIC_API_KEY',
  VITE_CRYPTOQUANT_API_KEY: 'env:VITE_CRYPTOQUANT_API_KEY',

  // API Rates & Limits
  DERIBIT_RATE_LIMIT: 500,       // 500 requests per 10 seconds
  BINANCE_RATE_LIMIT: 1200,      // 1200 requests per minute
  CRYPTOQUANT_RATE_LIMIT: 100,   // 100 requests per day (free tier)
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. OPTIONS PRICING & CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

export const OPTIONS_CALC = {
  // Call & Put Strike Selection
  call_strike_otm_multiplier: 1.08,   // 8% out-of-the-money above spot
  put_strike_otm_multiplier: 0.92,    // 8% out-of-the-money below spot

  // Gain Estimation
  example_amount_usd: 1000,           // Example position size ($)
  min_holding_period_days: 7,         // Minimum 7 days
  max_holding_period_days: 30,        // Maximum 30 days
  default_apr: 10,                    // 10% default APR if no funding
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. SIGNAL INTERPRETER THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

export const INTERPRETER = {
  // IV Rank Regimes
  ivRank: {
    highVol: 70,               // IV Rank >= 70 = HIGH_VOL regime
    lowVol: 30,                // IV Rank <= 30 = LOW_VOL regime
  },

  // Spot Recommendations
  spot: {
    attentif: 80,              // >= 80 = "Attentif" (attentive/favorable)
    neutre: 60,                // >= 60 = "Neutre" (neutral)
    prudent: 40,               // >= 40 = "Prudent" (cautious)
    // < 40 = "Cash" (stay in cash)
  },

  // Funding Interpretation
  funding: {
    high: 15,                  // >= 15% annualized
    moderate: 5,               // >= 5% annualized
  },

  // Basis Interpretation
  basis: {
    highContango: 8,           // >= 8%
    backwardation: -2,         // <= -2%
  },

  // Options Regimes
  options: {
    // High Vol Regime: Sell vol
    highVolScore: 80,          // >= 80 score for selling vol
    spreadsScore: 60,          // >= 60 for selling spreads
    selectiveScore: 40,        // >= 40 for selective buying

    // Low Vol Regime: Buy vol
    lowVolScore: 40,           // >= 40 for buying vol
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

export const SNAPSHOT_CONFIG = {
  VERSION: 1,                  // Snapshot schema version
  GENESIS_HASH: '00000000',    // Initial blockchain-style chain hash
  IDB_CHAIN_KEY_BTC: 'snapshot_chain_BTC',
  IDB_CHAIN_KEY_ETH: 'snapshot_chain_ETH',
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Get weight scenario based on data availability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get appropriate weight scenario based on data availability
 * @param {boolean} hasS5 - Has on-chain score
 * @param {boolean} hasS6 - Has positioning score
 * @returns {object} Weight scenario
 */
export function getWeightScenario(hasS5, hasS6) {
  if (hasS5 && hasS6) return SCORE_WEIGHTS.complete
  if (hasS5 && !hasS6) return SCORE_WEIGHTS.withoutPositioning
  return SCORE_WEIGHTS.minimal
}

/**
 * Calculate individual weights for components.
 * When cal (calibration object) is provided, uses user-defined weights from
 * localStorage; otherwise falls back to static SCORE_WEIGHTS defaults.
 *
 * @param {boolean} hasS5 - Has on-chain component
 * @param {boolean} hasS6 - Has positioning component
 * @param {object|null} [cal] - Optional calibration object from getCalibration()
 * @returns {object} { w1, w2, w3, w4, w5, w6 }
 */
export function getComponentWeights(hasS5, hasS6, cal = null) {
  if (cal) {
    if (hasS5 && hasS6) return {
      w1: (cal.w_complete_s1_iv          ?? SCORE_WEIGHTS.complete.s1_iv)          * 100,
      w2: (cal.w_complete_s2_funding      ?? SCORE_WEIGHTS.complete.s2_funding)     * 100,
      w3: (cal.w_complete_s3_basis        ?? SCORE_WEIGHTS.complete.s3_basis)       * 100,
      w4: (cal.w_complete_s4_ivVsRv       ?? SCORE_WEIGHTS.complete.s4_ivVsRv)      * 100,
      w5: (cal.w_complete_s5_onChain      ?? SCORE_WEIGHTS.complete.s5_onChain)     * 100,
      w6: (cal.w_complete_s6_positioning  ?? SCORE_WEIGHTS.complete.s6_positioning) * 100,
    }
    if (hasS5 && !hasS6) return {
      w1: (cal.w_nopos_s1_iv       ?? SCORE_WEIGHTS.withoutPositioning.s1_iv)       * 100,
      w2: (cal.w_nopos_s2_funding   ?? SCORE_WEIGHTS.withoutPositioning.s2_funding)  * 100,
      w3: (cal.w_nopos_s3_basis     ?? SCORE_WEIGHTS.withoutPositioning.s3_basis)    * 100,
      w4: (cal.w_nopos_s4_ivVsRv    ?? SCORE_WEIGHTS.withoutPositioning.s4_ivVsRv)   * 100,
      w5: (cal.w_nopos_s5_onChain   ?? SCORE_WEIGHTS.withoutPositioning.s5_onChain)  * 100,
      w6: 0,
    }
    // minimal (s1–s4 uniquement)
    return {
      w1: (cal.w_min_s1_iv       ?? SCORE_WEIGHTS.minimal.s1_iv)       * 100,
      w2: (cal.w_min_s2_funding   ?? SCORE_WEIGHTS.minimal.s2_funding)  * 100,
      w3: (cal.w_min_s3_basis     ?? SCORE_WEIGHTS.minimal.s3_basis)    * 100,
      w4: (cal.w_min_s4_ivVsRv    ?? SCORE_WEIGHTS.minimal.s4_ivVsRv)   * 100,
      w5: 0,
      w6: 0,
    }
  }
  // Fallback : poids statiques
  const weights = getWeightScenario(hasS5, hasS6)
  return {
    w1: weights.s1_iv * 100,
    w2: weights.s2_funding * 100,
    w3: weights.s3_basis * 100,
    w4: weights.s4_ivVsRv * 100,
    w5: (weights.s5_onChain      ?? 0) * 100,
    w6: (weights.s6_positioning  ?? 0) * 100,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Get funding fixing time for today
// ─────────────────────────────────────────────────────────────────────────────

export function getFundingFixingTimes() {
  const now = new Date()
  return TIMING.FUNDING_FIXING_TIMES.map(({ hour, minute }) => {
    const fixing = new Date(now)
    fixing.setUTCHours(hour, minute, 0, 0)
    return fixing
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Validate threshold value
// ─────────────────────────────────────────────────────────────────────────────

export function validateThresholdValue(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { valid: false, error: `${key} must be a finite number` }
  }
  if (value < 0) {
    return { valid: false, error: `${key} cannot be negative` }
  }
  return { valid: true }
}
