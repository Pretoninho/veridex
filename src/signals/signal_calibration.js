/**
 * signals/signal_calibration.js
 *
 * Persistance et accès aux paramètres de calibration des signaux et patterns.
 *
 * Les valeurs par défaut (DEFAULT_CALIBRATION) sont désormais dérivées de
 * src/config/signal_calibration.js — source unique de vérité.
 *
 * Stockage : localStorage (clé STORAGE_KEY)
 */

import {
  SCORE_THRESHOLDS,
  SIGNAL_BOUNDARIES,
  TIMING,
  FINGERPRINT_BUCKETING,
  POSITIONING,
  CONVERGENCE,
  ONCHAIN_SIGNALS,
} from '../config/signal_calibration.js'

const STORAGE_KEY = 'veridex_calibration'

// ── Valeurs par défaut (dérivées du config centralisé) ────────────────────────

/** @type {Record<string, number>} */
export const DEFAULT_CALIBRATION = {
  // --- Filtre DVOL (signal_engine.js › dvolFilter) ---
  dvol_calm_max:     40,
  dvol_agitated_min: 70,

  // --- Score IV – ratio current / avg30j ---
  iv_ratio_t1: SCORE_THRESHOLDS.IV.low,       // 0.85
  iv_ratio_t2: SCORE_THRESHOLDS.IV.normal,    // 0.95
  iv_ratio_t3: SCORE_THRESHOLDS.IV.high,      // 1.10
  iv_ratio_t4: SCORE_THRESHOLDS.IV.extreme,   // 1.20

  // --- Score Funding – taux annualisé en % ---
  funding_t1: SCORE_THRESHOLDS.Funding.zero,     // 0
  funding_t2: SCORE_THRESHOLDS.Funding.normal,   // 5
  funding_t3: SCORE_THRESHOLDS.Funding.high,     // 15
  funding_t4: SCORE_THRESHOLDS.Funding.extreme,  // 30

  // --- Score Basis – basis annualisé en % ---
  basis_score_t1: SCORE_THRESHOLDS.Basis.zero,     // 0
  basis_score_t2: SCORE_THRESHOLDS.Basis.normal,   // 3
  basis_score_t3: SCORE_THRESHOLDS.Basis.high,     // 8
  basis_score_t4: SCORE_THRESHOLDS.Basis.extreme,  // 15

  // --- Score IV/RV – prime IV − RV ---
  ivvsrv_t1: SCORE_THRESHOLDS.IVvRV.neutral,  // 0
  ivvsrv_t2: SCORE_THRESHOLDS.IVvRV.high,     // 10
  ivvsrv_t3: SCORE_THRESHOLDS.IVvRV.extreme,  // 20

  // --- Signal global ---
  signal_unfav_max: SIGNAL_BOUNDARIES.neutral,      // 40
  signal_neutr_max: SIGNAL_BOUNDARIES.favorable,    // 60
  signal_fav_max:   SIGNAL_BOUNDARIES.exceptional,  // 80

  // --- Détection d'anomalies ---
  anomaly_threshold: TIMING.ANOMALY_THRESHOLD,  // 3
  anomaly_window_ms: TIMING.ANOMALY_WINDOW_MS,  // 10000

  // --- Bucketing patterns ---
  move_small:       0.1,  // zone plate : |move| < seuil (%) — pas de constante dans FINGERPRINT_BUCKETING
  move_big:         3.0,
  spread_tight_max: FINGERPRINT_BUCKETING.spread.tight,   // 0.1
  spread_wide_min:  FINGERPRINT_BUCKETING.spread.wide,    // 0.5
  ls_short_max:     FINGERPRINT_BUCKETING.lsRatio.shortHeavy, // 0.8
  ls_long_min:      FINGERPRINT_BUCKETING.lsRatio.longHeavy,  // 1.2
  basis_back_max:   FINGERPRINT_BUCKETING.basis.backwardation, // -2
  basis_flat_max:   FINGERPRINT_BUCKETING.basis.contango,      // 2
  basis_high_min:   FINGERPRINT_BUCKETING.basis.highContango,  // 10

  // --- Positioning – L/S Ratio ---
  ls_bullish:       POSITIONING.lsRatio.bullish,       // 1.2
  ls_bearish:       POSITIONING.lsRatio.bearish,       // 0.8
  ls_strong_bull:   POSITIONING.lsRatio.strongBullish, // 1.5
  ls_strong_bear:   POSITIONING.lsRatio.strongBearish, // 0.7

  // --- Positioning – P/C Ratio ---
  pc_bullish:       POSITIONING.pcRatio.bullish,       // 0.85
  pc_bearish:       POSITIONING.pcRatio.bearish,       // 1.15
  pc_strong_bull:   POSITIONING.pcRatio.strongBullish, // 0.7
  pc_strong_bear:   POSITIONING.pcRatio.strongBearish, // 1.3

  // --- Convergence ---
  conv_min_hist:    CONVERGENCE.MIN_HIST_POINTS,     // 20
  conv_min:         CONVERGENCE.MIN_CONVERGENCE,     // 3
  conv_strong:      CONVERGENCE.STRONG_CONVERGENCE,  // 5

  // --- On-Chain – Fear & Greed ---
  fg_extreme_fear:  ONCHAIN_SIGNALS.fearGreed.extremeFear,   // 25
  fg_fear:          ONCHAIN_SIGNALS.fearGreed.fear,          // 45
  fg_neutral:       ONCHAIN_SIGNALS.fearGreed.neutral,       // 55
  fg_greed:         ONCHAIN_SIGNALS.fearGreed.greed,         // 75
  fg_delta:         ONCHAIN_SIGNALS.fearGreed.significantDelta, // 5

  // --- On-Chain – Hash Rate ---
  hashrate_bull:    ONCHAIN_SIGNALS.hashRate.bullish,  // 5
  hashrate_bear:    ONCHAIN_SIGNALS.hashRate.bearish,  // -5

  // --- On-Chain – Score ---
  onchain_favorable: ONCHAIN_SIGNALS.scoreInterpretation.favorable, // 70
  onchain_neutral:   ONCHAIN_SIGNALS.scoreInterpretation.neutral,   // 50
  onchain_weak:      ONCHAIN_SIGNALS.scoreInterpretation.weak,      // 35
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CALIBRATION }
    return { ...DEFAULT_CALIBRATION, ...JSON.parse(raw) }
  } catch (_) {
    return { ...DEFAULT_CALIBRATION }
  }
}

function _save(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch (_) {}
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Retourne la configuration de calibration courante.
 * Les clés manquantes (migration) sont complétées par DEFAULT_CALIBRATION.
 *
 * @returns {Record<string, number>}
 */
export function getCalibration() {
  return _load()
}

/**
 * Met à jour un paramètre et persiste la configuration.
 *
 * @param {string} key
 * @param {number} value
 * @returns {Record<string, number>} nouvelle configuration complète
 */
export function updateCalibration(key, value) {
  if (!(key in DEFAULT_CALIBRATION)) {
    console.warn('[calibration] clé inconnue :', key)
    return _load()
  }
  const current = _load()
  const updated  = { ...current, [key]: value }
  _save(updated)
  return updated
}

/**
 * Réinitialise tous les paramètres aux valeurs par défaut.
 *
 * @returns {Record<string, number>} DEFAULT_CALIBRATION
 */
export function resetCalibration() {
  localStorage.removeItem(STORAGE_KEY)
  return { ...DEFAULT_CALIBRATION }
}
