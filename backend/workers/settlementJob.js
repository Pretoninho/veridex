/**
 * backend/workers/settlementJob.js
 *
 * Periodic settlement job.
 *
 * Every SETTLEMENT_INTERVAL_MS (default 5 minutes) this job:
 *   1. Finds directional signals (direction IS NOT NULL) whose 1h / 4h / 24h
 *      target times have elapsed and whose outcomes are not yet fully settled.
 *   2. Looks up the closest ticker price at or after each target timestamp.
 *   3. Computes the return, volatility-based threshold, and WIN/LOSS/FLAT label.
 *   4. Persists (insert or update) the outcomes row for each settled horizon.
 *
 * Neutral signals (direction = null) are skipped — no outcome is produced.
 *
 * Exports: startSettlementJob, stopSettlementJob, getSettlementStatus
 */

'use strict'

const store = require('./dataStore')
const { computeThreshold, labelOutcome } = require('../utils/volThreshold')

// ── Configuration ─────────────────────────────────────────────────────────────

/** How often the settlement loop runs (ms). */
const SETTLEMENT_INTERVAL_MS = parseInt(process.env.SETTLEMENT_INTERVAL_MS ?? '300000', 10)

/** Maximum signals processed per settlement run (safety limit). */
const BATCH_SIZE = 200

/** Horizon definitions: key used in column names, duration in ms and fractional days. */
const HORIZONS = [
  { key: '1h',  ms: 1  * 3_600_000, days: 1  / 24 },
  { key: '4h',  ms: 4  * 3_600_000, days: 4  / 24 },
  { key: '24h', ms: 24 * 3_600_000, days: 1       },
]

// ── State ─────────────────────────────────────────────────────────────────────

let _intervalId = null
let _isRunning  = false
let _runCount   = 0
let _errorCount = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString() }

/**
 * Settle a single signal for all eligible, unsettled horizons.
 *
 * @param {object} sig          - signal row (id, asset, timestamp, trigger_price, direction, vol_ann, k)
 * @param {object|null} outcome - existing outcomes row (may be null or partial)
 * @param {number} now          - current epoch ms
 */
async function _settleSignal(sig, outcome, now) {
  const triggerPrice = Number(sig.trigger_price)
  const volAnn       = sig.vol_ann != null ? Number(sig.vol_ann) : null
  const k            = sig.k       != null ? Number(sig.k)       : 0.75

  const updates = {}

  for (const h of HORIZONS) {
    // Skip if this horizon's target time has not elapsed yet
    const targetTs = Number(sig.timestamp) + h.ms
    if (targetTs > now) continue

    // Skip if already settled for this horizon
    if (outcome?.[`label_${h.key}`] != null) continue

    // Find the closest ticker at or after the target timestamp
    const ticks = await store.query(
      'SELECT spot FROM tickers WHERE asset = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT 1',
      [sig.asset, targetTs],
    )

    if (!ticks.length || ticks[0].spot == null) continue

    const priceH    = Number(ticks[0].spot)
    const ret       = (priceH - triggerPrice) / triggerPrice          // decimal
    const retPct    = ret * 100                                       // percent
    const threshold = volAnn != null ? computeThreshold(volAnn, h.days, k) : null
    const threshPct = threshold != null ? threshold * 100 : null
    const label     = (threshold != null && sig.direction)
      ? labelOutcome(sig.direction, ret, threshold)
      : null

    updates[`price_${h.key}_after`] = priceH
    updates[`move_${h.key}_pct`]    = Math.round(retPct    * 1_000_000) / 1_000_000
    updates[`threshold_${h.key}`]   = threshPct != null ? Math.round(threshPct * 1_000_000) / 1_000_000 : null
    updates[`label_${h.key}`]       = label
  }

  if (!Object.keys(updates).length) return

  if (outcome) {
    // UPDATE existing row
    const keys      = Object.keys(updates)
    const setClauses = keys.map(c => `${c} = ?`).join(', ')
    await store.run(
      `UPDATE outcomes SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE signal_id = ?`,
      [...Object.values(updates), sig.id],
    )
  } else {
    // INSERT new row
    await store.insert('outcomes', {
      signal_id: sig.id,
      asset:     sig.asset,
      ...updates,
    })
  }
}

// ── Settlement run ────────────────────────────────────────────────────────────

async function _run() {
  const now = Date.now()

  // The earliest horizon is 1h — only fetch signals at least 1h old.
  const minHorizonMs = HORIZONS[0].ms
  const cutoff       = now - minHorizonMs

  try {
    // Fetch directional signals old enough for at least 1h settlement.
    const signals = await store.query(
      `SELECT id, asset, timestamp, trigger_price, direction, vol_ann, k
       FROM signals
       WHERE direction IS NOT NULL
         AND timestamp <= ?
       ORDER BY timestamp ASC
       LIMIT ?`,
      [cutoff, BATCH_SIZE],
    )

    if (!signals.length) return

    // Load existing outcome rows for these signals in one query.
    const ids = signals.map(s => s.id)
    const existingOutcomes = await store.query(
      `SELECT signal_id, label_1h, label_4h, label_24h,
              price_1h_after, price_4h_after, price_24h_after
       FROM outcomes
       WHERE signal_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )

    const outcomeMap = new Map(existingOutcomes.map(o => [Number(o.signal_id), o]))

    let settled = 0
    for (const sig of signals) {
      const existing = outcomeMap.get(Number(sig.id)) ?? null

      // Skip fully settled signals (all three horizon labels are non-null — including FLAT)
      if (existing?.label_1h != null && existing?.label_4h != null && existing?.label_24h != null) continue

      try {
        await _settleSignal(sig, existing, now)
        settled++
      } catch (err) {
        _errorCount++
        console.error(`[settlementJob] ${_ts()} — Error settling signal ${sig.id}:`, err?.message)
      }
    }

    if (settled > 0) {
      console.log(`[settlementJob] ${_ts()} — Run #${_runCount}: settled ${settled} signal(s)`)
    }
  } catch (err) {
    _errorCount++
    console.error(`[settlementJob] ${_ts()} — Run #${_runCount} failed:`, err?.message)
  } finally {
    _runCount++
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the settlement job.
 * Requires the dataStore to be initialized first (store.isReady() === true).
 */
function startSettlementJob() {
  if (_isRunning) {
    console.warn('[settlementJob] Already running — ignoring duplicate start')
    return
  }

  if (!store.isReady()) {
    console.error('[settlementJob] Database not initialized — call initDatabase() first')
    return
  }

  _isRunning = true
  console.log(`[settlementJob] Starting — interval ${SETTLEMENT_INTERVAL_MS / 1_000}s`)

  // Run immediately on start
  _run().catch(err => console.error('[settlementJob] Initial run error:', err?.message))

  _intervalId = setInterval(() => {
    _run().catch(err => console.error('[settlementJob] Run error:', err?.message))
  }, SETTLEMENT_INTERVAL_MS)
}

/**
 * Stop the settlement job.
 */
function stopSettlementJob() {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
  }
  _isRunning = false
  console.log('[settlementJob] Stopped')
}

/**
 * Return current settlement job status (for health checks).
 */
function getSettlementStatus() {
  return {
    running:    _isRunning,
    intervalMs: SETTLEMENT_INTERVAL_MS,
    runCount:   _runCount,
    errorCount: _errorCount,
  }
}

module.exports = { startSettlementJob, stopSettlementJob, getSettlementStatus }
