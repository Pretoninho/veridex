// analytics/strategy_engine.js
//
// Cerveau de trading structuré :
//   • sélection automatique des meilleurs patterns (backtest interne)
//   • filtrage adaptatif selon le régime de volatilité (DVOL)
//   • position sizing Kelly simplifié
//   • contrôle du drawdown
//   • score EV pondéré par DVOL

import { getAllPatterns, computeAdvancedStats } from '../signals/market_fingerprint.js'

// ── 1. Sélection des meilleurs patterns ──────────────────────────────────────

/**
 * Récupère et classe les patterns par score (EV × winrate × log(occurrences)).
 * Retourne les 10 meilleurs patterns avec des données suffisantes (24h).
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   ev: number,
 *   winrate: number,
 *   occurrences: number,
 *   rewardRisk: number|null,
 *   score: number,
 * }>>}
 */
export async function selectBestPatterns() {
  const patterns = await getAllPatterns()

  return patterns
    .map(p => {
      const tfStats = p.patternStats?.['24h']
      const advanced = computeAdvancedStats(tfStats)
      if (!advanced) return null

      const ev          = advanced.expectedValue || 0
      const winrate     = advanced.probUp         || 0
      const occurrences = p.occurrences           || 0

      return {
        id:        p.hash,
        ev,
        winrate,
        occurrences,
        rewardRisk: advanced.riskReward ?? null,
        score:      ev * winrate * Math.log(occurrences + 1),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

// ── 2. Filtrage adaptatif selon DVOL ─────────────────────────────────────────

/**
 * Retourne les seuils minimaux d'EV et de winrate selon le niveau de DVOL.
 *
 * Régimes :
 *   DVOL < 40  → marché calme  : exiger un edge plus fort
 *   DVOL < 70  → régime normal : seuils standards
 *   DVOL ≥ 70  → forte vola    : légèrement plus strict pour limiter le risque
 *
 * @param {number} dvol — DVOL actuel (ex: 55)
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
 * Filtre les patterns en fonction des seuils adaptatifs calculés à partir du DVOL.
 *
 * @param {Array<{ ev: number, winrate: number }>} patterns
 * @param {number} dvol
 * @returns {Array}
 */
export function filterPatterns(patterns, dvol) {
  const { minEV, minWinrate } = adaptThresholds(dvol)

  return patterns.filter(p =>
    p.ev      > minEV &&
    p.winrate > minWinrate
  )
}

// ── 3. Position sizing — Kelly simplifié ─────────────────────────────────────

/**
 * Calcule la taille de position selon le critère de Kelly simplifié.
 * Plafonnée à 20 % du capital pour limiter l'exposition maximale.
 *
 * Kelly = (winrate × (R/R + 1) − 1) / R/R
 *
 * @param {{ winrate?: number, rewardRisk?: number }} signal
 * @param {number} balance — capital disponible
 * @returns {number} — montant en devise à allouer
 */
export function computePositionSize(signal, balance) {
  const winrate = signal.winrate    || 0.5
  const rr      = signal.rewardRisk || 1

  const kelly     = (winrate * (rr + 1) - 1) / rr
  const safeKelly = Math.max(0, Math.min(kelly, 0.2))

  return balance * safeKelly
}

// ── 4. Contrôle du drawdown ───────────────────────────────────────────────────

/**
 * Retourne un facteur multiplicatif [0 ; 1] appliqué à la taille de position
 * en fonction du drawdown courant par rapport au pic de capital.
 *
 *   DD < 20 % → pas de réduction
 *   DD ≥ 20 % → taille réduite à 50 %
 *   DD ≥ 30 % → mode survie : taille réduite à 20 %
 *
 * @param {number} balance — capital actuel
 * @param {number} peak    — capital maximum historique
 * @returns {number} — facteur entre 0 et 1
 */
export function applyDrawdownControl(balance, peak) {
  if (!peak || peak <= 0) return 1

  const dd = (peak - balance) / peak

  if (dd >= 0.3) return 0.2
  if (dd >= 0.2) return 0.5
  return 1
}

// ── 5. Score EV final pondéré par DVOL ───────────────────────────────────────

/**
 * Score de décision final : EV × winrate, pondéré par le régime DVOL.
 *
 *   DVOL < 40  → dvolFactor = 0.7  (marché calme : edge moins fiable)
 *   DVOL < 70  → dvolFactor = 1.0  (régime normal)
 *   DVOL ≥ 70  → dvolFactor = 0.8  (forte vola : plus de risque de gap)
 *
 * @param {{ ev: number, winrate: number }} signal
 * @param {number} dvol
 * @returns {number}
 */
export function computeFinalScore(signal, dvol) {
  const dvolFactor =
    dvol < 40 ? 0.7 :
    dvol < 70 ? 1.0 :
                0.8

  return signal.ev * signal.winrate * dvolFactor
}

// ── 6. Pipeline complet ───────────────────────────────────────────────────────

/**
 * Sélectionne les meilleurs patterns et les filtre selon le DVOL courant.
 * Point d'entrée principal du pipeline stratégie.
 *
 * @param {number} dvol — DVOL actuel
 * @returns {Promise<Array>} — patterns filtrés prêts à trader
 */
export async function selectAndFilter(dvol) {
  const best     = await selectBestPatterns()
  const filtered = filterPatterns(best, dvol)
  return filtered
}
