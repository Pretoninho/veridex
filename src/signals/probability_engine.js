/**
 * signals/probability_engine.js
 *
 * Moteur de probabilités qui suit les résultats historiques des signaux (basés sur hash)
 * et calcule les probabilités de mouvements de prix.
 *
 * - Chaque signal est identifié par un hash unique
 * - Signaux stockés avec prix d'entrée et timestamp
 * - Support multi-timeframe (1h, 24h, 7d)
 * - Après évaluation, les statistiques de pattern sont mises à jour et le signal supprimé
 *
 * Aucune dépendance externe — JS pur et déterministe.
 */

import { TIMEFRAMES, classifyMove, computeAdvancedStats } from './market_fingerprint.js'

export { TIMEFRAMES, classifyMove, computeAdvancedStats }

// ── Stockage ──────────────────────────────────────────────────────────────────

/**
 * Statistiques accumulées par hash de signal et par timeframe.
 * @type {Object.<string, Object.<string, {
 *   occurrences: number,
 *   upMoves: number,
 *   downMoves: number,
 *   flatMoves: number,
 *   avgUpMove: number,
 *   avgDownMove: number,
 *   distribution: { bigDown: number, down: number, flat: number, up: number, bigUp: number }
 * }>>}
 */
export const patternStats = {}

// ── Signaux en attente d'évaluation ──────────────────────────────────────────

/**
 * @type {Array<{ hash: string, entryPrice: number, timestamp: number }>}
 */
const _pendingSignals = []

// ── Fonctions utilitaires ─────────────────────────────────────────────────────

/**
 * Retourne une structure de statistiques vide pour un timeframe.
 * @returns {{ occurrences: number, upMoves: number, downMoves: number, flatMoves: number, avgUpMove: number, avgDownMove: number, distribution: Object }}
 */
function _emptyTimeframeStat() {
  return {
    occurrences: 0,
    upMoves:     0,
    downMoves:   0,
    flatMoves:   0,
    avgUpMove:   0,
    avgDownMove: 0,
    distribution: { bigDown: 0, down: 0, flat: 0, up: 0, bigUp: 0 },
  }
}

/**
 * Met à jour une moyenne courante avec une nouvelle valeur.
 * @param {number} currentAvg - Moyenne courante
 * @param {number} count      - Nouveau nombre d'observations (après incrément)
 * @param {number} newValue   - Nouvelle valeur à intégrer
 * @returns {number}
 */
function _updateRunningAverage(currentAvg, count, newValue) {
  return ((currentAvg * (count - 1)) + newValue) / count
}

/**
 * Intègre un mouvement (en fraction, ex: 0.05 = +5%) dans une statistique
 * de timeframe (mise à jour in-place).
 * Met à jour les compteurs directionnels, les moyennes courantes et la distribution.
 *
 * Seuils directionnels : upMove si move > 0.01, downMove si move < -0.01.
 * La distribution utilise classifyMove avec conversion fraction → %.
 *
 * @param {{ occurrences: number, upMoves: number, downMoves: number, flatMoves: number, avgUpMove: number, avgDownMove: number, distribution: Object }} stat
 * @param {number} move — variation en fraction (ex: 0.025 = +2.5%)
 */
function _applyMove(stat, move) {
  stat.occurrences += 1
  // Conversion fraction → % pour la classification (ex: 0.05 → 5%)
  stat.distribution[classifyMove(move * 100)] += 1

  if (move > 0.01) {
    stat.upMoves += 1
    stat.avgUpMove = _updateRunningAverage(stat.avgUpMove, stat.upMoves, move)
  } else if (move < -0.01) {
    stat.downMoves += 1
    stat.avgDownMove = _updateRunningAverage(stat.avgDownMove, stat.downMoves, move)
  } else {
    stat.flatMoves += 1
  }
}

// ── Fonctions principales ─────────────────────────────────────────────────────

/**
 * Met à jour les statistiques accumulées pour un hash avec un nouveau mouvement de prix.
 * Le timeframe est optionnel et vaut '24h' par défaut (rétrocompatibilité).
 *
 * @param {string} hash                  - Hash unique du signal
 * @param {number} move                  - Variation de prix en fraction (ex: 0.025 = +2.5%)
 * @param {string} [timeframe='24h']     - Timeframe à mettre à jour ('1h', '24h', '7d')
 */
export function updatePatternStats(hash, move, timeframe = '24h') {
  if (!patternStats[hash]) {
    patternStats[hash] = {}
    for (const tf of TIMEFRAMES) {
      patternStats[hash][tf] = _emptyTimeframeStat()
    }
  }

  _applyMove(patternStats[hash][timeframe], move)
}

/**
 * Calcule les probabilités et tailles de mouvements moyens depuis les statistiques
 * d'un timeframe. Compatible rétroactivement : accepte un objet stat de timeframe.
 *
 * @param {{
 *   occurrences: number,
 *   upMoves: number,
 *   downMoves: number,
 *   flatMoves: number,
 *   avgUpMove: number,
 *   avgDownMove: number
 * }} stat - Statistiques d'un timeframe (ex: patternStats[hash]['24h'])
 * @returns {{
 *   probUp: number,
 *   probDown: number,
 *   probFlat: number,
 *   avgUpMove: number,
 *   avgDownMove: number
 * }}
 */
export function computeProbabilities(stat) {
  if (!stat || !stat.occurrences) {
    return { probUp: 0, probDown: 0, probFlat: 0, avgUpMove: 0, avgDownMove: 0 }
  }

  const n = stat.occurrences

  const probUp   = stat.upMoves   / n
  const probDown = stat.downMoves / n
  const probFlat = stat.flatMoves / n

  return {
    probUp,
    probDown,
    probFlat,
    avgUpMove:   stat.avgUpMove,
    avgDownMove: stat.avgDownMove,
  }
}

/**
 * Calcule les métriques avancées (probabilités, espérance, risque/récompense, distribution)
 * pour un hash et un timeframe donnés.
 * Wrapper autour de computeAdvancedStats de market_fingerprint.js.
 *
 * @param {string} hash
 * @param {string} [timeframe='24h']
 * @returns {{ probUp: number, probDown: number, expectedValue: number, riskReward: number|null, distribution: Object }|null}
 */
export function computeAdvancedStatsForHash(hash, timeframe = '24h') {
  const entry = patternStats[hash]
  if (!entry) return null
  return computeAdvancedStats(entry[timeframe])
}

/**
 * Retourne les statistiques multi-timeframes pour un hash donné.
 *
 * @param {string} hash
 * @returns {Object.<string, Object>|null}
 */
export function getTimeframeStats(hash) {
  return patternStats[hash] ?? null
}

/**
 * Stocke un signal pour évaluation ultérieure contre un prix futur.
 *
 * @param {{ hash: string, entryPrice: number, timestamp: number }} signal
 */
export function storeSignal({ hash, entryPrice, timestamp }) {
  _pendingSignals.push({ hash, entryPrice, timestamp })
}

/**
 * Évalue tous les signaux en attente contre le prix actuel, met à jour
 * patternStats pour chacun et supprime les signaux traités.
 *
 * @param {number} currentPrice          - Prix de marché actuel
 * @param {string} [timeframe='24h']     - Timeframe à mettre à jour ('1h', '24h', '7d')
 */
export function evaluateSignals(currentPrice, timeframe = '24h') {
  for (const signal of _pendingSignals) {
    const move = (currentPrice - signal.entryPrice) / signal.entryPrice
    updatePatternStats(signal.hash, move, timeframe)
  }
  _pendingSignals.length = 0
}
