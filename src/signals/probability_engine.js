/**
 * signals/probability_engine.js
 *
 * Probability engine that tracks historical outcomes of signals (hash-based)
 * and computes probabilities of price movements.
 *
 * - Each signal is identified by a unique hash
 * - Signals are stored with entry price and timestamp
 * - After evaluating a signal against the current price, pattern statistics
 *   are updated and the processed signal is removed
 *
 * No external dependencies — deterministic, pure JS.
 */

// ── Storage ───────────────────────────────────────────────────────────────────

/**
 * Accumulated statistics per signal hash.
 * @type {Object.<string, {
 *   occurrences: number,
 *   upMoves: number,
 *   downMoves: number,
 *   flatMoves: number,
 *   sumUpMove: number,
 *   sumDownMove: number
 * }>}
 */
export const patternStats = {}

// ── Pending signals waiting to be evaluated ───────────────────────────────────

/**
 * @type {Array<{ hash: string, entryPrice: number, timestamp: number }>}
 */
const _pendingSignals = []

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Updates the accumulated statistics for a given hash with a new price move.
 *
 * @param {string} hash   - Unique signal hash
 * @param {number} move   - Percentage price change (float, e.g. 0.025 = +2.5%)
 */
export function updatePatternStats(hash, move) {
  if (!patternStats[hash]) {
    patternStats[hash] = {
      occurrences: 0,
      upMoves: 0,
      downMoves: 0,
      flatMoves: 0,
      sumUpMove: 0,
      sumDownMove: 0,
    }
  }

  const stat = patternStats[hash]
  stat.occurrences++

  if (move > 0.01) {
    stat.upMoves++
    stat.sumUpMove += move
  } else if (move < -0.01) {
    stat.downMoves++
    stat.sumDownMove += move
  } else {
    stat.flatMoves++
  }
}

/**
 * Computes probabilities and average move sizes from accumulated statistics.
 *
 * @param {{
 *   occurrences: number,
 *   upMoves: number,
 *   downMoves: number,
 *   flatMoves: number,
 *   sumUpMove: number,
 *   sumDownMove: number
 * }} stat
 * @returns {{
 *   probUp: number,
 *   probDown: number,
 *   probFlat: number,
 *   avgUpMove: number,
 *   avgDownMove: number
 * }}
 */
export function computeProbabilities(stat) {
  if (!stat.occurrences) {
    return { probUp: 0, probDown: 0, probFlat: 0, avgUpMove: 0, avgDownMove: 0 }
  }

  const n = stat.occurrences

  const probUp   = stat.upMoves   / n
  const probDown = stat.downMoves / n
  const probFlat = stat.flatMoves / n

  const avgUpMove   = stat.upMoves   > 0 ? stat.sumUpMove   / stat.upMoves   : 0
  const avgDownMove = stat.downMoves > 0 ? stat.sumDownMove / stat.downMoves : 0

  return { probUp, probDown, probFlat, avgUpMove, avgDownMove }
}

/**
 * Stores a signal so it can be evaluated later against a future price.
 *
 * @param {{ hash: string, entryPrice: number, timestamp: number }} signal
 */
export function storeSignal({ hash, entryPrice, timestamp }) {
  _pendingSignals.push({ hash, entryPrice, timestamp })
}

/**
 * Evaluates all pending signals against the current price, updates
 * patternStats for each, and removes the processed signals.
 *
 * @param {number} currentPrice - Current market price
 */
export function evaluateSignals(currentPrice) {
  for (const signal of _pendingSignals) {
    const move = (currentPrice - signal.entryPrice) / signal.entryPrice
    updatePatternStats(signal.hash, move)
  }
  _pendingSignals.length = 0
}
