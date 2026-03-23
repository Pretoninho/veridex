/**
 * strategy_engine/index.js — Point d'entrée du Strategy Engine
 *
 * Architecture :
 *   strategy_engine/
 *   ├── strategies/
 *   │   └── dual_investment.js  ← Calculs DI (premium, P&L, scoring)
 *   └── decision_engine.js      ← Q-learning pour l'évaluation DI
 */

// ── Dual Investment ───────────────────────────────────────────────────────────
export {
  calcDIRateBS,
  calcDays,
  calcPremiumNative,
  calcPremiumUSD,
  calcPremium,
  marketPremiumPct,
  diScoreBS,
  diScore,
  scoreLabel,
  calcPnL,
  countdown,
  fmtUSD,
  fmtStrike,
  fmtExpiry,
  fmtDuration,
} from './dual_investment.js'

// ── Decision Engine (RL) ──────────────────────────────────────────────────────
export {
  encodeDualState,
  evaluateDualPolicy,
  learnFromSettlement,
  getDualRlMetrics,
  getDualRlSnapshot,
  getDualRewardConfig,
  updateDualRewardConfig,
  resetDualRewardConfig,
  resetDualRl,
} from './decision_engine.js'

export { logTrade, closeTrade, deleteTrade, getTrades, getTradeStats } from './trade_log.js'
