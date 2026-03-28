/**
 * signals/index.js — Scoring and signal-related logic
 *
 * Exports all signal processing, notification, and market fingerprint utilities.
 */

export {
  scoreIV,
  scoreFunding,
  scoreBasis,
  scoreIVvsRV,
  calcGlobalScore,
  getSignal,
  computeSignal,
  detectMarketAnomaly,
  hashMarketState,
  saveSignal,
  getSignalHistory,
  getAnomalyLog,
  clearAnomalyLog,
} from './signal_engine.js'

export { buildCriteria, computeConvergence } from './convergence.js'
export { interpretSignal, buildStrategySignature, buildMarketRegime } from './signal_interpreter.js'
export { calcPositioningScore, calcDivergenceScore, calcCombinedRatioScore, interpretPositioning } from './positioning_score.js'
export { generateInsight, clearInsightCache } from './insight_generator.js'
export { TIMEFRAMES, createFingerprint, recordPattern, updateOutcomes, getPatternStats, getAllPatterns, classifyMove, computeAdvancedStats } from './market_fingerprint.js'
export { setupSettlementWatcher, captureSettlement, getSettlementHistory, getSettlementByDate, getSettlementByHash, clearSettlementHistory } from './settlement_tracker.js'
export { checkNotifications, notifyAnomaly } from './notification_engine.js'
export { DEFAULT_THRESHOLDS, requestPermission, getPermissionStatus, getThresholds, updateThreshold, resetThresholds, sendNotification, getNotificationHistory, clearNotificationHistory } from './notification_manager.js'
export { SNAPSHOT_VERSION, MIN_OCCURRENCES_TO_EXPORT, GENESIS_HASH, generateSnapshot, verifySnapshot, snapshotToJSON, snapshotFromJSON, getSnapshotHistory } from './snapshot_generator.js'
export { shouldImportSnapshot, importSnapshot, runInitialImport, getImportState, resetImportState } from './snapshot_importer.js'
export { detectExchangeFlowSignal, detectMempoolSignal, detectMinerSignal, compositeOnChainSignal, interpretExchangeFlowsExpert, interpretMempoolExpert, interpretFearGreedExpert, interpretWhalesExpert, interpretHashRateExpert } from './onchain_signals.js'
