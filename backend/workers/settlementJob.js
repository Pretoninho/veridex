/**
 * backend/workers/settlementJob.js
 *
 * Settlement / outcome-labeling job.
 *
 * Every SETTLEMENT_INTERVAL_MS (default 5 minutes), looks for signals that
 * have not yet been fully settled and tries to compute outcomes at:
 *   - +1h  (price_1h_after  / move_1h_pct)
 *   - +4h  (price_4h_after  / move_4h_pct)
 *   - +24h (price_24h_after / move_24h_pct)
 *
 * For each horizon, the nearest ticker row whose timestamp falls within
 * a tolerance window (HORIZON_TOLERANCE_MS) of the target time is used.
 * If no such ticker exists yet (future horizon), the field is left NULL.
 *
 * Once at least one horizon is settled, a row is inserted/updated in the
 * `outcomes` table.  When all three horizons are settled, the signal row is
 * also updated with:
 *   - outcome      : "WIN" | "LOSS" | "FLAT" (based on 4h move by default)
 *   - outcome_price: the 4h price
 *   - pnl          : move_4h_pct (the percentage return)
 *
 * The WIN/LOSS threshold is configurable via SETTLEMENT_WIN_THRESHOLD_PCT
 * (default 0 — any positive move is a WIN).
 *
 * Exports: startSettlementJob, stopSettlementJob, getSettlementStatus
 */

'use strict'

const store = require('./dataStore')

// ── Configuration ─────────────────────────────────────────────────────────────

const SETTLEMENT_INTERVAL_MS   = parseInt(process.env.SETTLEMENT_INTERVAL_MS ?? '300000', 10) // 5 min
const HORIZONS_MS = {
  h1:  1  * 60 * 60_000,
  h4:  4  * 60 * 60_000,
  h24: 24 * 60 * 60_000,
}
const HORIZON_TOLERANCE_MS     = parseInt(process.env.HORIZON_TOLERANCE_MS ?? '120000', 10)    // ±2 min
const WIN_THRESHOLD_PCT        = parseFloat(process.env.SETTLEMENT_WIN_THRESHOLD_PCT ?? '0')
// Batch size: max signals to process per run (prevents long-running queries)
const BATCH_SIZE               = parseInt(process.env.SETTLEMENT_BATCH_SIZE ?? '100', 10)

// ── State ─────────────────────────────────────────────────────────────────────

let _intervalId   = null
let _isRunning    = false
let _lastRunAt    = null
let _settledCount = 0
let _errorCount   = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString() }

/**
 * Classify the outcome of a signal given a percentage move.
 * @param {number} movePct — percentage price change (e.g. 2.5 means +2.5%)
 * @returns {'WIN'|'LOSS'|'FLAT'}
 */
function _classifyOutcome(movePct) {
  if (movePct > WIN_THRESHOLD_PCT)  return 'WIN'
  if (movePct < -WIN_THRESHOLD_PCT) return 'LOSS'
  return 'FLAT'
}

/**
 * Find the nearest ticker price for a given asset at a target timestamp.
 * Returns null if no ticker falls within HORIZON_TOLERANCE_MS.
 *
 * @param {string} asset
 * @param {number} targetTs  — epoch ms
 * @returns {Promise<number|null>}
 */
async function _priceAt(asset, targetTs) {
  const rows = await store.query(
    `SELECT spot FROM tickers
      WHERE asset = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY ABS(timestamp - ?) ASC
      LIMIT 1`,
    [asset, targetTs - HORIZON_TOLERANCE_MS, targetTs + HORIZON_TOLERANCE_MS, targetTs],
  )
  if (!rows.length || rows[0].spot == null) return null
  return Number(rows[0].spot)
}

/**
 * Load all unsettled signals for a given asset (no fully-settled outcome yet).
 * "Unsettled" means either no outcomes row exists, or move_24h_pct is still NULL.
 *
 * @param {string} asset
 * @returns {Promise<Array>}
 */
async function _loadUnsettledSignals(asset) {
  // Use LEFT JOIN so signals with no outcome row at all are included.
  return store.query(
    `SELECT s.id, s.asset, s.timestamp, s.trigger_price, s.outcome,
            o.id AS outcome_id,
            o.price_1h_after, o.price_4h_after, o.price_24h_after,
            o.move_1h_pct,    o.move_4h_pct,    o.move_24h_pct
       FROM signals s
       LEFT JOIN outcomes o ON o.signal_id = s.id
      WHERE s.asset = ?
        AND s.timestamp <= ?
        AND (o.id IS NULL OR o.move_24h_pct IS NULL)
      ORDER BY s.timestamp ASC
      LIMIT ?`,
    [asset, Date.now() - HORIZONS_MS.h1, BATCH_SIZE],
  )
}

/**
 * Upsert an outcomes row: insert if outcome_id is NULL, update otherwise.
 */
async function _upsertOutcome(signalRow, updates) {
  if (signalRow.outcome_id == null) {
    // INSERT
    await store.insert('outcomes', {
      signal_id:       signalRow.id,
      asset:           signalRow.asset,
      price_1h_after:  updates.price_1h_after  ?? null,
      price_4h_after:  updates.price_4h_after  ?? null,
      price_24h_after: updates.price_24h_after ?? null,
      move_1h_pct:     updates.move_1h_pct     ?? null,
      move_4h_pct:     updates.move_4h_pct     ?? null,
      move_24h_pct:    updates.move_24h_pct    ?? null,
    })
  } else {
    // UPDATE — only overwrite NULL columns
    const setClauses = []
    const params     = []

    if (signalRow.price_1h_after == null && updates.price_1h_after != null) {
      setClauses.push('price_1h_after = ?', 'move_1h_pct = ?')
      params.push(updates.price_1h_after, updates.move_1h_pct)
    }
    if (signalRow.price_4h_after == null && updates.price_4h_after != null) {
      setClauses.push('price_4h_after = ?', 'move_4h_pct = ?')
      params.push(updates.price_4h_after, updates.move_4h_pct)
    }
    if (signalRow.price_24h_after == null && updates.price_24h_after != null) {
      setClauses.push('price_24h_after = ?', 'move_24h_pct = ?')
      params.push(updates.price_24h_after, updates.move_24h_pct)
    }

    if (!setClauses.length) return // nothing to update

    params.push(signalRow.outcome_id)
    await store.run(
      `UPDATE outcomes SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    )
  }
}

/**
 * Process settlement for a single signal row.
 * @returns {Promise<boolean>} true if at least one new horizon was settled
 */
async function _settleSignal(row) {
  const triggerPrice = Number(row.trigger_price)
  if (!triggerPrice) return false

  const now    = Date.now()
  const ts     = Number(row.timestamp)
  const updates = {}
  let   changed = false

  // ── +1h horizon ────────────────────────────────────────────────────────────
  if (row.price_1h_after == null && now >= ts + HORIZONS_MS.h1) {
    const p = await _priceAt(row.asset, ts + HORIZONS_MS.h1)
    if (p != null) {
      updates.price_1h_after = p
      updates.move_1h_pct    = Math.round(((p - triggerPrice) / triggerPrice) * 1_000_000) / 10_000
      changed = true
    }
  }

  // ── +4h horizon ────────────────────────────────────────────────────────────
  if (row.price_4h_after == null && now >= ts + HORIZONS_MS.h4) {
    const p = await _priceAt(row.asset, ts + HORIZONS_MS.h4)
    if (p != null) {
      updates.price_4h_after = p
      updates.move_4h_pct    = Math.round(((p - triggerPrice) / triggerPrice) * 1_000_000) / 10_000
      changed = true
    }
  }

  // ── +24h horizon ───────────────────────────────────────────────────────────
  if (row.price_24h_after == null && now >= ts + HORIZONS_MS.h24) {
    const p = await _priceAt(row.asset, ts + HORIZONS_MS.h24)
    if (p != null) {
      updates.price_24h_after = p
      updates.move_24h_pct    = Math.round(((p - triggerPrice) / triggerPrice) * 1_000_000) / 10_000
      changed = true
    }
  }

  if (!changed) return false

  await _upsertOutcome(row, updates)

  // ── Update signals table once 4h is settled (primary outcome horizon) ──────
  // Trigger when: we just computed a 4h price AND the signal doesn't have an
  // outcome label yet (outcome IS NULL in the signals table).
  const just4h = updates.move_4h_pct != null
  if (just4h && row.outcome == null) {
    const outcome = _classifyOutcome(updates.move_4h_pct)
    await store.run(
      'UPDATE signals SET outcome = ?, outcome_price = ?, pnl = ? WHERE id = ?',
      [outcome, updates.price_4h_after, updates.move_4h_pct, row.id],
    )
  }

  return true
}

// ── Main settlement run ───────────────────────────────────────────────────────

async function _run() {
  if (!store.isReady()) return

  const assets = ['BTC', 'ETH']
  let   batch  = 0

  for (const asset of assets) {
    try {
      const rows = await _loadUnsettledSignals(asset)

      for (const row of rows) {
        try {
          const settled = await _settleSignal(row)
          if (settled) {
            batch++
            _settledCount++
          }
        } catch (err) {
          _errorCount++
          console.error(`[settlement] ${_ts()} — Error settling signal ${row.id}:`, err?.message)
        }
      }
    } catch (err) {
      _errorCount++
      console.error(`[settlement] ${_ts()} — Error loading signals for ${asset}:`, err?.message)
    }
  }

  _lastRunAt = Date.now()
  if (batch > 0) {
    console.log(`[settlement] ${_ts()} — Settled ${batch} outcome(s) (total: ${_settledCount})`)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the settlement job.
 */
function startSettlementJob() {
  if (_isRunning) {
    console.warn('[settlement] Already running — ignoring duplicate start')
    return
  }

  if (!store.isReady()) {
    console.error('[settlement] Database not initialized — call initDatabase() first')
    return
  }

  _isRunning = true
  console.log(`[settlement] Starting — runs every ${SETTLEMENT_INTERVAL_MS / 1_000}s`)

  // Run once immediately, then on interval
  _run().catch(err => console.error('[settlement] Initial run error:', err?.message))

  _intervalId = setInterval(() => {
    _run().catch(err => console.error('[settlement] Run error:', err?.message))
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
  console.log('[settlement] Stopped')
}

/**
 * Return current settlement job status.
 */
function getSettlementStatus() {
  return {
    running:      _isRunning,
    lastRunAt:    _lastRunAt,
    settledCount: _settledCount,
    errorCount:   _errorCount,
    intervalMs:   SETTLEMENT_INTERVAL_MS,
  }
}

module.exports = { startSettlementJob, stopSettlementJob, getSettlementStatus }
