// analytics/strategy_engine.js
//
// Moteur de stratégie de trading structuré.
//
// Fournit :
//   1. Sélection automatique des meilleurs patterns (backtest)
//   2. Filtrage adaptatif selon la volatilité (DVOL)
//   3. Position sizing via Kelly simplifié
//   4. Contrôle du drawdown
//   5. Score EV final ajusté au régime de marché

import { getAllPatterns, computeAdvancedStats } from '../signals/market_fingerprint.js'

// ─────────────────────────────────────────────────────────────
// 1. Sélection automatique des meilleurs patterns
// ─────────────────────────────────────────────────────────────

/**
 * Récupère tous les patterns enregistrés et les classe par score composite.
 * Score = EV × winrate × log(occurrences + 1)
 *
 * @param {{ timeframe?: '1h'|'24h'|'7d', topN?: number }} [options]
 * @returns {Promise<Array<{
 *   id: string,
 *   ev: number,
 *   winrate: number,
 *   rewardRisk: number|null,
 *   occurrences: number,
 *   score: number,
 * }>>}
 */
export async function selectBestPatterns({ timeframe = '24h', topN = 10 } = {}) {
  const patterns = await getAllPatterns()

  return patterns
    .map(p => {
      const tfStat = p.patternStats?.[timeframe]
      if (!tfStat) return null

      const advanced = computeAdvancedStats(tfStat)
      if (!advanced) return null

      const ev          = advanced.expectedValue ?? 0
      const winrate     = advanced.probUp         ?? 0
      const rewardRisk  = advanced.riskReward     ?? null
      const occurrences = p.occurrences           ?? 0

      return {
        id: p.hash,
        ev,
        winrate,
        rewardRisk,
        occurrences,
        score: ev * winrate * Math.log(occurrences + 1),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

// ─────────────────────────────────────────────────────────────
// 2. Filtrage adaptatif selon le régime de volatilité (DVOL)
// ─────────────────────────────────────────────────────────────

/**
 * Retourne les seuils EV et winrate adaptés au niveau de DVOL.
 *
 * @param {number} dvol — DVOL index (Deribit Volatility Index)
 * @returns {{ minEV: number, minWinrate: number }}
 */
export function adaptThresholds(dvol) {
  if (dvol < 40) {
    return { minEV: 0.2, minWinrate: 0.55 }
  }
  if (dvol < 70) {
    return { minEV: 0.1, minWinrate: 0.5 }
  }
  return { minEV: 0.15, minWinrate: 0.52 }
}

/**
 * Filtre une liste de patterns selon les seuils adaptatifs issus du DVOL.
 *
 * @param {Array<{ ev: number, winrate: number }>} patterns
 * @param {number} dvol
 * @returns {Array<{ ev: number, winrate: number }>}
 */
export function filterPatterns(patterns, dvol) {
  const { minEV, minWinrate } = adaptThresholds(dvol)

  return patterns.filter(p =>
    p.ev > minEV &&
    p.winrate > minWinrate
  )
}

// ─────────────────────────────────────────────────────────────
// 3. Position sizing — Kelly simplifié
// ─────────────────────────────────────────────────────────────

/**
 * Calcule la taille de position en unités de balance via Kelly fractionné.
 * Le résultat est plafonné à 20 % du capital (cap direct à 0.2).
 *
 * @param {{ winrate?: number, rewardRisk?: number }} signal
 * @param {number} balance — capital disponible
 * @returns {number} — montant à allouer
 */
export function computePositionSize(signal, balance) {
  const winrate = signal.winrate  ?? 0.5
  const rr      = signal.rewardRisk ?? 1

  const kelly     = (winrate * (rr + 1) - 1) / rr
  const safeKelly = Math.max(0, Math.min(kelly, 0.2))

  return balance * safeKelly
}

// ─────────────────────────────────────────────────────────────
// 4. Contrôle du drawdown
// ─────────────────────────────────────────────────────────────

/**
 * Retourne un facteur multiplicatif de réduction de taille basé sur le drawdown.
 *
 * - dd > 30 % → mode survie (facteur 0.2)
 * - dd > 20 % → réduction modérée (facteur 0.5)
 * - sinon     → nominal (facteur 1)
 *
 * @param {number} balance — capital actuel
 * @param {number} peak    — capital au plus haut historique
 * @returns {number} — facteur entre 0 et 1
 */
export function applyDrawdownControl(balance, peak) {
  if (peak <= 0) return 1

  const dd = (peak - balance) / peak

  if (dd > 0.3) return 0.2
  if (dd > 0.2) return 0.5

  return 1
}

// ─────────────────────────────────────────────────────────────
// 5. Score EV final ajusté au régime DVOL
// ─────────────────────────────────────────────────────────────

/**
 * Calcule le score EV final en pondérant par le régime de volatilité.
 *
 * - DVOL < 40 : marché calme, on réduit la confiance (facteur 0.7)
 * - DVOL < 70 : régime normal                         (facteur 1)
 * - DVOL ≥ 70 : haute volatilité, on tempère          (facteur 0.8)
 *
 * @param {{ ev: number, winrate: number }} signal
 * @param {number} dvol
 * @returns {number}
 */
export function computeFinalScore(signal, dvol) {
  const dvolFactor =
    dvol < 40 ? 0.7 :
    dvol < 70 ? 1   :
    0.8

  return signal.ev * signal.winrate * dvolFactor
}
