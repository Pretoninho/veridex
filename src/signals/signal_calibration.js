/**
 * signals/signal_calibration.js
 *
 * Persistance et accès aux paramètres de calibration des signaux et patterns.
 *
 * Les valeurs par défaut (DEFAULT_CALIBRATION) correspondent exactement aux
 * seuils codés en dur dans signal_engine.js et market_fingerprint.js.
 *
 * Stockage : localStorage (clé STORAGE_KEY)
 */

const STORAGE_KEY = 'veridex_calibration'

// ── Valeurs par défaut ────────────────────────────────────────────────────────

/** @type {Record<string, number>} */
export const DEFAULT_CALIBRATION = {
  // --- Filtre DVOL (signal_engine.js › dvolFilter) ---
  dvol_calm_max:     40,    // DVOL < seuil → facteur 0.7 (marché trop calme)
  dvol_agitated_min: 70,    // DVOL ≥ seuil → facteur 0.8 (marché trop agité)

  // --- Score IV – ratio current / avg30j (signal_engine.js › scoreIV) ---
  iv_ratio_t1: 0.85,        // ratio < t1  → score 0
  iv_ratio_t2: 0.95,        // ratio ≥ t1  → score 25
  iv_ratio_t3: 1.10,        // ratio ≥ t2  → score 50
  iv_ratio_t4: 1.20,        // ratio ≥ t3  → score 75 / ≥ t4 → score 100

  // --- Score Funding – taux annualisé en % (signal_engine.js › scoreFunding) ---
  funding_t1: 0,            // taux < t1  → score 0
  funding_t2: 5,            // taux ≥ t1  → score 25
  funding_t3: 15,           // taux ≥ t2  → score 50
  funding_t4: 30,           // taux ≥ t3  → score 75 / ≥ t4 → score 100

  // --- Score Basis – basis annualisé en % (signal_engine.js › scoreBasis) ---
  basis_score_t1: 0,        // basis < t1  → score 0
  basis_score_t2: 3,        // basis ≥ t1  → score 25
  basis_score_t3: 8,        // basis ≥ t2  → score 50
  basis_score_t4: 15,       // basis ≥ t3  → score 75 / ≥ t4 → score 100

  // --- Score IV/RV – prime IV − RV (signal_engine.js › scoreIVvsRV) ---
  ivvsrv_t1: 0,             // prime < t1  → score 0
  ivvsrv_t2: 10,            // prime ≥ t1  → score 50
  ivvsrv_t3: 20,            // prime ≥ t2  → score 100

  // --- Signal global (signal_engine.js › getSignal) ---
  signal_unfav_max: 40,     // score < seuil → Défavorable
  signal_neutr_max: 60,     // score ≥ seuil → Neutre → Favorable
  signal_fav_max:   80,     // score ≥ seuil → Exceptionnel

  // --- Détection d'anomalies (signal_engine.js) ---
  anomaly_threshold: 3,     // nb min. d'indicateurs simultanés
  anomaly_window_ms: 10000, // fenêtre de comparaison en ms

  // --- Bucketing patterns (market_fingerprint.js) ---
  move_small:       0.1,    // zone plate : |move| < seuil (%)
  move_big:         3.0,    // grand mouvement : |move| ≥ seuil (%)

  spread_tight_max: 0.1,    // spread tight si spreadPct < seuil
  spread_wide_min:  0.5,    // spread wide  si spreadPct ≥ seuil

  ls_short_max:     0.8,    // L/S short_heavy si lsRatio ≤ seuil
  ls_long_min:      1.2,    // L/S long_heavy  si lsRatio ≥ seuil

  basis_back_max:  -2,      // backwardation si basisPct < seuil
  basis_flat_max:   2,      // flat          si basisPct < seuil (haute borne)
  basis_high_min:  10,      // high_contango si basisPct ≥ seuil
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
