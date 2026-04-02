/**
 * backend/routes/analytics.js
 *
 * Analytics & export routes.
 *
 * GET /analytics/stats?asset=BTC&days=7&horizon=4h
 *   Returns edge metrics for a given asset + time window + settlement horizon.
 *   Metrics: win_rate, avg_return, avg_gain, avg_loss, sharpe_ratio, max_drawdown,
 *            trade_count, exposure_time_pct, confidence_interval_95, per-horizon breakdown.
 *
 * GET /analytics/export?asset=BTC&type=signals&format=csv&days=30
 *   Export ticks / signals / outcomes as CSV or JSON for offline analysis.
 *   type   : "signals" | "ticks" | "outcomes"
 *   format : "csv" | "json"
 *   days   : lookback window (1-365, default 30)
 *
 * Results are cached for 5 minutes (stats only) to avoid costly DB scans.
 */

'use strict'

const express    = require('express')
const router     = express.Router()
const store      = require('../workers/dataStore')
const { SmartCache } = require('../utils/cache')

const SUPPORTED_ASSETS   = ['BTC', 'ETH']
const SUPPORTED_HORIZONS = ['1h', '4h', '24h']
const _cache = new SmartCache({ ttlMs: 5 * 60_000 }) // 5-minute TTL

// ── Stats computation helpers ─────────────────────────────────────────────────

/**
 * Compute Sharpe ratio from an array of return values.
 * Assumes risk-free rate = 0.
 * @param {number[]} returns
 * @returns {number|null}
 */
function _sharpe(returns) {
  if (returns.length < 2) return null
  const mean     = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  const std      = Math.sqrt(variance)
  if (std === 0) return null
  return Math.round((mean / std) * 100) / 100
}

/**
 * Compute max drawdown from sequential return values (simulated equity curve).
 * @param {number[]} returns
 * @returns {number|null} max drawdown as a positive percentage
 */
function _maxDrawdown(returns) {
  if (!returns.length) return null
  let equity = 100
  let peak   = 100
  let maxDD  = 0

  for (const r of returns) {
    equity += r
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak * 100
    if (dd > maxDD) maxDD = dd
  }

  return Math.round(maxDD * 100) / 100
}

/**
 * Build an equity curve array from sequential return values.
 * Starts at 100 (notional).
 * @param {number[]} returns
 * @returns {number[]}
 */
function _equityCurve(returns) {
  let equity = 100
  return returns.map(r => {
    equity += r
    return Math.round(equity * 100) / 100
  })
}

/**
 * 95% confidence interval for the mean.
 * Uses z=1.96 for n>=30, t~2.0 for smaller samples.
 * @param {number[]} values
 * @returns {[number, number]|null}
 */
function _confidenceInterval95(values) {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / n
  const std  = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  const se   = std / Math.sqrt(n)
  const t    = n >= 30 ? 1.96 : 2.0
  return [
    Math.round((mean - t * se) * 10000) / 10000,
    Math.round((mean + t * se) * 10000) / 10000,
  ]
}

/**
 * Compute full edge metrics from a list of return values.
 */
function _computeMetrics(returns, windowMs, totalSignals) {
  if (!returns.length) {
    return {
      total_signals:          totalSignals,
      settled_signals:        0,
      win_rate:               null,
      avg_return:             null,
      avg_gain:               null,
      avg_loss:               null,
      sharpe_ratio:           null,
      max_drawdown:           null,
      trade_count:            0,
      exposure_time_pct:      null,
      confidence_interval_95: null,
      equity_curve:           [],
    }
  }

  const wins   = returns.filter(r => r > 0)
  const losses = returns.filter(r => r < 0)
  const n      = returns.length

  const winRate = Math.round((wins.length / n) * 10000) / 100
  const avgRet  = Math.round(returns.reduce((a, b) => a + b, 0) / n * 10000) / 10000
  const avgGain = wins.length   ? Math.round(wins.reduce((a, b)   => a + b, 0) / wins.length   * 10000) / 10000 : null
  const avgLoss = losses.length ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length * 10000) / 10000 : null

  // Approximate exposure time: assume each trade is held for 4h
  const AVG_HOLD_MS  = 4 * 60 * 60_000
  const exposurePct  = windowMs > 0
    ? Math.min(100, Math.round((n * AVG_HOLD_MS / windowMs) * 10000) / 100)
    : null

  return {
    total_signals:          totalSignals,
    settled_signals:        n,
    win_rate:               winRate,
    avg_return:             avgRet,
    avg_gain:               avgGain,
    avg_loss:               avgLoss,
    sharpe_ratio:           _sharpe(returns),
    max_drawdown:           _maxDrawdown(returns),
    trade_count:            n,
    exposure_time_pct:      exposurePct,
    confidence_interval_95: _confidenceInterval95(returns),
    equity_curve:           _equityCurve(returns),
  }
}

/**
 * Extract return values for a given horizon from outcome-joined signal rows.
 */
function _returnsForHorizon(rows, horizon) {
  const col = horizon === '1h' ? 'move_1h_pct'
    : horizon === '24h'        ? 'move_24h_pct'
    : 'move_4h_pct'

  return rows
    .map(r => (r[col] != null ? Number(r[col]) : null))
    .filter(v => v != null)
}

/**
 * Build confusion matrix: counts per signal_type x outcome.
 */
function _confusionMatrix(rows) {
  const matrix = {}
  for (const row of rows) {
    const type    = row.signal_type ?? 'UNKNOWN'
    const outcome = row.outcome     ?? 'UNSETTLED'
    if (!matrix[type]) matrix[type] = { WIN: 0, LOSS: 0, FLAT: 0, UNSETTLED: 0 }
    matrix[type][outcome] = (matrix[type][outcome] ?? 0) + 1
  }
  return matrix
}

// ── GET /analytics/stats ──────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const asset   = (req.query.asset ?? 'BTC').toUpperCase()
  const rawDays = parseInt(req.query.days ?? '7', 10)
  const days    = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 7
  const horizon = SUPPORTED_HORIZONS.includes(req.query.horizon) ? req.query.horizon : '4h'

  if (!SUPPORTED_ASSETS.includes(asset)) {
    return res.status(400).json({
      error: `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`,
    })
  }

  if (!store.isReady()) {
    return res.status(503).json({ error: 'Database not initialized' })
  }

  const cacheKey = `analytics:${asset}:${days}:${horizon}`
  const cached   = _cache.get(cacheKey)
  if (cached) {
    return res.json({ ...cached, cached: true })
  }

  try {
    const since    = Date.now() - days * 24 * 3600 * 1000
    const windowMs = days * 24 * 3600 * 1000

    const signalRows = await store.query(
      `SELECT s.id, s.signal_type, s.signal_score, s.trigger_price, s.outcome, s.pnl, s.timestamp,
              o.move_1h_pct, o.move_4h_pct, o.move_24h_pct
         FROM signals s
         LEFT JOIN outcomes o ON o.signal_id = s.id
        WHERE s.asset = ? AND s.timestamp >= ?
        ORDER BY s.timestamp ASC`,
      [asset, since],
    )

    const returns      = _returnsForHorizon(signalRows, horizon)
    const metrics      = _computeMetrics(returns, windowMs, signalRows.length)
    const confusionMtx = _confusionMatrix(signalRows)

    // Per-horizon breakdown
    const horizonBreakdown = {}
    for (const h of ['1h', '4h', '24h']) {
      const hReturns = _returnsForHorizon(signalRows, h)
      if (!hReturns.length) {
        horizonBreakdown[h] = { settled: 0, win_rate: null, avg_return: null, sharpe_ratio: null }
      } else {
        const hWins = hReturns.filter(r => r > 0)
        horizonBreakdown[h] = {
          settled:      hReturns.length,
          win_rate:     Math.round((hWins.length / hReturns.length) * 10000) / 100,
          avg_return:   Math.round(hReturns.reduce((a, b) => a + b, 0) / hReturns.length * 10000) / 10000,
          sharpe_ratio: _sharpe(hReturns),
        }
      }
    }

    const payload = {
      asset,
      days,
      horizon,
      ...metrics,
      horizon_breakdown: horizonBreakdown,
      confusion_matrix:  confusionMtx,
      last_update:       new Date().toISOString(),
      cached:            false,
    }

    _cache.set(cacheKey, payload)
    res.json(payload)
  } catch (err) {
    console.error(`[analytics] Error computing stats for ${asset}:`, err?.message)
    res.status(500).json({ error: 'Failed to compute analytics', detail: err?.message })
  }
})

// ── GET /analytics/export ─────────────────────────────────────────────────────

const EXPORT_TYPES   = ['signals', 'ticks', 'outcomes']
const EXPORT_FORMATS = ['csv', 'json']

/**
 * Converts an array of objects to CSV string.
 */
function _toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape  = (v) => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ].join('\r\n')
}

/**
 * GET /analytics/export?asset=BTC&type=signals&format=csv&days=30
 */
router.get('/export', async (req, res) => {
  const asset   = (req.query.asset ?? 'BTC').toUpperCase()
  const type    = (req.query.type ?? 'signals').toLowerCase()
  const format  = (req.query.format ?? 'json').toLowerCase()
  const rawDays = parseInt(req.query.days ?? '30', 10)
  const days    = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30

  if (!SUPPORTED_ASSETS.includes(asset)) {
    return res.status(400).json({ error: `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}` })
  }
  if (!EXPORT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Unsupported type "${type}". Supported: ${EXPORT_TYPES.join(', ')}` })
  }
  if (!EXPORT_FORMATS.includes(format)) {
    return res.status(400).json({ error: `Unsupported format "${format}". Supported: ${EXPORT_FORMATS.join(', ')}` })
  }
  if (!store.isReady()) {
    return res.status(503).json({ error: 'Database not initialized' })
  }

  const since = Date.now() - days * 24 * 3600 * 1000

  try {
    let rows
    if (type === 'signals') {
      rows = await store.query(
        `SELECT s.id, s.asset, s.timestamp, s.signal_type, s.signal_score,
                s.trigger_price, s.outcome, s.outcome_price, s.pnl,
                o.move_1h_pct, o.move_4h_pct, o.move_24h_pct
           FROM signals s
           LEFT JOIN outcomes o ON o.signal_id = s.id
          WHERE s.asset = ? AND s.timestamp >= ?
          ORDER BY s.timestamp ASC`,
        [asset, since],
      )
    } else if (type === 'ticks') {
      rows = await store.query(
        `SELECT id, asset, timestamp, spot, iv_rank, funding, oi, skew, basis
           FROM tickers
          WHERE asset = ? AND timestamp >= ?
          ORDER BY timestamp ASC`,
        [asset, since],
      )
    } else {
      rows = await store.query(
        `SELECT o.id, o.signal_id, o.asset, s.timestamp AS signal_timestamp,
                s.trigger_price, o.price_1h_after, o.price_4h_after, o.price_24h_after,
                o.move_1h_pct, o.move_4h_pct, o.move_24h_pct, o.settled_at
           FROM outcomes o
           JOIN signals s ON s.id = o.signal_id
          WHERE o.asset = ? AND s.timestamp >= ?
          ORDER BY s.timestamp ASC`,
        [asset, since],
      )
    }

    const filename = `veridex_${asset}_${type}_${days}d`

    if (format === 'csv') {
      const csv = _toCsv(rows)
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      })
      return res.send(csv)
    }

    res.set({
      'Content-Type':        'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
    })
    return res.json({
      asset,
      type,
      days,
      exported_at: new Date().toISOString(),
      count:       rows.length,
      rows,
    })
  } catch (err) {
    console.error(`[analytics] Export error (${type}/${format}):`, err?.message)
    res.status(500).json({ error: 'Export failed', detail: err?.message })
  }
})

module.exports = router
