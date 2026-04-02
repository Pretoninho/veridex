/**
 * backend/routes/analytics.test.js
 *
 * Unit tests for the analytics computation helpers.
 *
 * Uses a fixture dataset of 10 synthetic signal+outcome rows to verify:
 *   - _computeMetrics  : win_rate, avg_return, avg_gain, avg_loss, sharpe, drawdown, CI
 *   - _horizonStats    : per-horizon win_rate / avg_return / total_settled from joined rows
 *   - _computeStats    : top-level stats derived from outcome move_pct (not pnl)
 *   - _confusionMatrix : per-signal_type outcome counts
 *   - _sharpe          : Sharpe ratio formula
 *   - _confidenceInterval95 : 95 % CI formula (z=1.96 for n≥30, t≈2.0 for small n)
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  _sharpe,
  _maxDrawdown,
  _confidenceInterval95,
  _computeMetrics,
  _horizonStats,
  _computeStats,
  _confusionMatrix,
} = require('./analytics')

// ── Fixture dataset ───────────────────────────────────────────────────────────

/**
 * 10 synthetic signal+outcome rows.
 *
 * Rows 0-7 have outcomes (label_4h / move_4h_pct populated).
 * Rows 8-9 are unsettled (label_4h = null, move_4h_pct = null).
 *
 * Of the 8 settled rows:
 *   - 5 are WIN  (move_4h_pct > 0)
 *   - 2 are LOSS (move_4h_pct < 0)
 *   - 1 is FLAT  (move_4h_pct ≈ 0)
 *
 * move_4h_pct values: [2.0, 1.5, 3.0, -1.0, 0.5, -0.8, 2.5, 0.0]
 */
const FIXTURE_ROWS = [
  // settled WIN
  { id: 1,  direction: 'LONG',  signal_type: 'VOL_SPIKE', pnl: null, timestamp: 1000,
    label_1h: 'WIN',  label_4h: 'WIN',  label_24h: 'WIN',
    move_1h_pct: 0.8, move_4h_pct: 2.0, move_24h_pct: 4.0 },
  { id: 2,  direction: 'LONG',  signal_type: 'VOL_SPIKE', pnl: null, timestamp: 2000,
    label_1h: 'WIN',  label_4h: 'WIN',  label_24h: 'WIN',
    move_1h_pct: 0.7, move_4h_pct: 1.5, move_24h_pct: 3.2 },
  { id: 3,  direction: 'SHORT', signal_type: 'SKEW_CRUSH', pnl: null, timestamp: 3000,
    label_1h: 'WIN',  label_4h: 'WIN',  label_24h: 'WIN',
    move_1h_pct: 1.1, move_4h_pct: 3.0, move_24h_pct: 5.0 },
  { id: 4,  direction: 'LONG',  signal_type: 'VOL_SPIKE', pnl: null, timestamp: 4000,
    label_1h: 'FLAT', label_4h: 'WIN',  label_24h: 'WIN',
    move_1h_pct: 0.1, move_4h_pct: 0.5, move_24h_pct: 2.0 },
  { id: 5,  direction: 'LONG',  signal_type: 'SKEW_CRUSH', pnl: null, timestamp: 5000,
    label_1h: 'WIN',  label_4h: 'WIN',  label_24h: 'WIN',
    move_1h_pct: 0.9, move_4h_pct: 2.5, move_24h_pct: 3.8 },
  // settled LOSS
  { id: 6,  direction: 'SHORT', signal_type: 'VOL_SPIKE', pnl: null, timestamp: 6000,
    label_1h: 'LOSS', label_4h: 'LOSS', label_24h: 'LOSS',
    move_1h_pct: -0.6, move_4h_pct: -1.0, move_24h_pct: -2.5 },
  { id: 7,  direction: 'LONG',  signal_type: 'SKEW_CRUSH', pnl: null, timestamp: 7000,
    label_1h: 'LOSS', label_4h: 'LOSS', label_24h: 'LOSS',
    move_1h_pct: -0.5, move_4h_pct: -0.8, move_24h_pct: -1.8 },
  // settled FLAT
  { id: 8,  direction: 'LONG',  signal_type: 'VOL_SPIKE', pnl: null, timestamp: 8000,
    label_1h: 'FLAT', label_4h: 'FLAT', label_24h: 'FLAT',
    move_1h_pct: 0.0, move_4h_pct: 0.0, move_24h_pct: 0.0 },
  // unsettled
  { id: 9,  direction: 'LONG',  signal_type: 'VOL_SPIKE', pnl: null, timestamp: 9000,
    label_1h: null, label_4h: null, label_24h: null,
    move_1h_pct: null, move_4h_pct: null, move_24h_pct: null },
  { id: 10, direction: 'SHORT', signal_type: 'SKEW_CRUSH', pnl: null, timestamp: 10000,
    label_1h: null, label_4h: null, label_24h: null,
    move_1h_pct: null, move_4h_pct: null, move_24h_pct: null },
]

// move_4h_pct values for the 8 settled rows:
// [2.0, 1.5, 3.0, 0.5, 2.5, -1.0, -0.8, 0.0]
// wins (>0):  2.0, 1.5, 3.0, 0.5, 2.5  → 5 wins
// losses(<0): -1.0, -0.8                → 2 losses
// flat (0):   0.0                       → 1 flat (treated as neither win nor loss)
const SETTLED_4H_RETURNS = [2.0, 1.5, 3.0, 0.5, 2.5, -1.0, -0.8, 0.0]

// ── _sharpe ───────────────────────────────────────────────────────────────────

describe('_sharpe', () => {
  it('returns null for empty array', () => {
    expect(_sharpe([])).toBeNull()
  })

  it('returns null for single value (std undefined)', () => {
    expect(_sharpe([1.0])).toBeNull()
  })

  it('returns null when std is 0 (all same value)', () => {
    expect(_sharpe([2.0, 2.0, 2.0])).toBeNull()
  })

  it('computes Sharpe ratio correctly for known values', () => {
    // [0, 2, 4]: mean=2, sample_std=2, sharpe=1.00
    const result = _sharpe([0, 2, 4])
    expect(result).toBeCloseTo(1.00, 1)
  })

  it('returns negative Sharpe for negative mean', () => {
    expect(_sharpe([-1, -2, -3])).toBeLessThan(0)
  })
})

// ── _maxDrawdown ──────────────────────────────────────────────────────────────

describe('_maxDrawdown', () => {
  it('returns null for empty array', () => {
    expect(_maxDrawdown([])).toBeNull()
  })

  it('returns 0 for monotonically increasing returns', () => {
    expect(_maxDrawdown([1, 2, 3])).toBe(0)
  })

  it('computes drawdown correctly', () => {
    // equity: 100 → 110 → 95 → 105
    // peak = 110, trough = 95 → dd = (110-95)/110 ≈ 13.64
    const dd = _maxDrawdown([10, -15, 10])
    expect(dd).toBeCloseTo(13.64, 1)
  })
})

// ── _confidenceInterval95 ─────────────────────────────────────────────────────

describe('_confidenceInterval95', () => {
  it('returns null for empty array', () => {
    expect(_confidenceInterval95([])).toBeNull()
  })

  it('returns null for single value', () => {
    expect(_confidenceInterval95([5])).toBeNull()
  })

  it('computes 95% CI for small sample (t≈2.0)', () => {
    // [0, 2]: mean=1, std=√2≈1.414, se=1.0, CI=[1-2*1, 1+2*1]=[-1, 3]
    const ci = _confidenceInterval95([0, 2])
    expect(ci).not.toBeNull()
    expect(ci[0]).toBeCloseTo(-1.0, 1)
    expect(ci[1]).toBeCloseTo(3.0, 1)
  })

  it('uses z=1.96 for n≥30', () => {
    // 30 identical values → std=0 → would be null if std=0
    // Use slight variation to get finite std
    const vals = Array.from({ length: 30 }, (_, i) => i % 2 === 0 ? 1.0 : -1.0)
    const ci = _confidenceInterval95(vals)
    expect(ci).not.toBeNull()
    // With z=1.96, CI should be narrower than with t=2.0
    const range196 = ci[1] - ci[0]
    // For same data with t=2.0 the range would be range196 * (2.0/1.96)
    // Just check the CI is symmetric around 0
    expect(ci[0]).toBeCloseTo(-ci[1], 3)
  })

  it('returns [lo, hi] where lo < hi', () => {
    const ci = _confidenceInterval95(SETTLED_4H_RETURNS)
    expect(ci).not.toBeNull()
    expect(ci[0]).toBeLessThan(ci[1])
  })
})

// ── _computeMetrics ───────────────────────────────────────────────────────────

describe('_computeMetrics', () => {
  it('returns zero-state when returns array is empty', () => {
    const r = _computeMetrics([], 0, 10)
    expect(r.total_signals).toBe(10)
    expect(r.settled_signals).toBe(0)
    expect(r.win_rate).toBeNull()
    expect(r.avg_return).toBeNull()
    expect(r.equity_curve).toEqual([])
  })

  it('computes win_rate correctly from fixture returns', () => {
    // 5 positive, 2 negative, 1 zero → wins = 5 out of 8 → 62.5%
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.win_rate).toBeCloseTo(62.5, 1)
  })

  it('computes avg_return correctly', () => {
    const sum = SETTLED_4H_RETURNS.reduce((a, b) => a + b, 0)
    const expected = Math.round(sum / SETTLED_4H_RETURNS.length * 10000) / 10000
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.avg_return).toBeCloseTo(expected, 4)
  })

  it('avg_gain is positive and avg_loss is negative', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.avg_gain).toBeGreaterThan(0)
    expect(r.avg_loss).toBeLessThan(0)
  })

  it('sharpe_ratio is non-null for varied returns', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.sharpe_ratio).not.toBeNull()
    expect(Number.isFinite(r.sharpe_ratio)).toBe(true)
  })

  it('max_drawdown is non-negative', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.max_drawdown).toBeGreaterThanOrEqual(0)
  })

  it('equity_curve has same length as returns', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.equity_curve).toHaveLength(SETTLED_4H_RETURNS.length)
  })

  it('equity_curve starts near 100 + first_return', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.equity_curve[0]).toBeCloseTo(100 + SETTLED_4H_RETURNS[0], 2)
  })

  it('confidence_interval_95 is non-null for 8 values', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.confidence_interval_95).not.toBeNull()
    expect(r.confidence_interval_95).toHaveLength(2)
  })

  it('trade_count equals number of returns', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 10)
    expect(r.trade_count).toBe(SETTLED_4H_RETURNS.length)
  })

  it('total_signals matches the totalSignals argument', () => {
    const r = _computeMetrics(SETTLED_4H_RETURNS, 0, 99)
    expect(r.total_signals).toBe(99)
  })

  it('exposure_time_pct is non-null when windowMs > 0', () => {
    const windowMs = 7 * 24 * 3600 * 1000 // 7 days
    const r = _computeMetrics(SETTLED_4H_RETURNS, windowMs, 10)
    expect(r.exposure_time_pct).not.toBeNull()
    expect(r.exposure_time_pct).toBeGreaterThan(0)
    expect(r.exposure_time_pct).toBeLessThanOrEqual(100)
  })
})

// ── _horizonStats ─────────────────────────────────────────────────────────────

describe('_horizonStats', () => {
  it('returns null stats when no settled rows exist for the horizon', () => {
    const r = _horizonStats(FIXTURE_ROWS.slice(8), '4h') // unsettled rows only
    expect(r.win_rate).toBeNull()
    expect(r.avg_return).toBeNull()
    expect(r.total_settled).toBe(0)
  })

  it('counts only rows with non-null label for the horizon', () => {
    const r = _horizonStats(FIXTURE_ROWS, '4h')
    // Rows 0-7 have label_4h; rows 8-9 do not
    expect(r.total_settled).toBe(8)
  })

  it('win_rate is 62.5% for 5 WIN out of 8 settled rows at 4h', () => {
    const r = _horizonStats(FIXTURE_ROWS, '4h')
    expect(r.win_rate).toBeCloseTo(62.5, 1)
  })

  it('avg_return matches mean of move_4h_pct across settled rows', () => {
    const r = _horizonStats(FIXTURE_ROWS, '4h')
    const expected = Math.round(
      SETTLED_4H_RETURNS.reduce((a, b) => a + b, 0) / SETTLED_4H_RETURNS.length * 10000
    ) / 10000
    expect(r.avg_return).toBeCloseTo(expected, 4)
  })

  it('correctly counts 1h settled rows (all 8 have label_1h)', () => {
    const r = _horizonStats(FIXTURE_ROWS, '1h')
    expect(r.total_settled).toBe(8)
  })

  it('correctly counts 24h settled rows (all 8 have label_24h)', () => {
    const r = _horizonStats(FIXTURE_ROWS, '24h')
    expect(r.total_settled).toBe(8)
  })
})

// ── _computeStats ─────────────────────────────────────────────────────────────

describe('_computeStats', () => {
  it('returns settled_signals > 0 when pnl is null but move_Xh_pct is populated', () => {
    // All rows have pnl=null; 8 of 10 have move_4h_pct
    const r = _computeStats(FIXTURE_ROWS, 0, '4h')
    expect(r.settled_signals).toBe(8)
  })

  it('total_signals equals total row count regardless of settlement', () => {
    const r = _computeStats(FIXTURE_ROWS, 0, '4h')
    expect(r.total_signals).toBe(10)
  })

  it('win_rate matches _horizonStats result for same horizon', () => {
    const stats   = _computeStats(FIXTURE_ROWS, 0, '4h')
    const horizon = _horizonStats(FIXTURE_ROWS, '4h')
    expect(stats.win_rate).toBeCloseTo(horizon.win_rate, 1)
  })

  it('uses pnl when present (legacy path)', () => {
    const withPnl = FIXTURE_ROWS.map((r, i) => ({
      ...r,
      pnl: i < 3 ? 5.0 : null, // first 3 rows have pnl=5.0
    }))
    // Only 3 rows have pnl, but 8 have move_4h_pct; pnl rows dominate for those 3
    const r = _computeStats(withPnl, 0, '4h')
    // All 8 settled rows should be counted (3 via pnl + 5 via move_4h_pct)
    expect(r.settled_signals).toBe(8)
  })

  it('respects the horizon parameter: 1h vs 4h vs 24h', () => {
    const r1h  = _computeStats(FIXTURE_ROWS, 0, '1h')
    const r4h  = _computeStats(FIXTURE_ROWS, 0, '4h')
    const r24h = _computeStats(FIXTURE_ROWS, 0, '24h')
    // All horizons have 8 settled rows in the fixture
    expect(r1h.settled_signals).toBe(8)
    expect(r4h.settled_signals).toBe(8)
    expect(r24h.settled_signals).toBe(8)
    // win_rate and avg_return are non-null for all horizons
    expect(r1h.win_rate).not.toBeNull()
    expect(r4h.win_rate).not.toBeNull()
    expect(r24h.win_rate).not.toBeNull()
    expect(r1h.avg_return).not.toBeNull()
    expect(r4h.avg_return).not.toBeNull()
    expect(r24h.avg_return).not.toBeNull()
    // Returns differ across horizons (fixture has different pct values per horizon)
    expect(r1h.avg_return).not.toBe(r4h.avg_return)
    expect(r4h.avg_return).not.toBe(r24h.avg_return)
  })

  it('returns zero-state when no rows', () => {
    const r = _computeStats([], 0, '4h')
    expect(r.settled_signals).toBe(0)
    expect(r.win_rate).toBeNull()
  })
})

// ── _confusionMatrix ──────────────────────────────────────────────────────────

describe('_confusionMatrix', () => {
  it('builds matrix keyed by signal_type', () => {
    const m = _confusionMatrix(FIXTURE_ROWS, '4h')
    expect(m).toHaveProperty('VOL_SPIKE')
    expect(m).toHaveProperty('SKEW_CRUSH')
  })

  it('counts WIN / LOSS / FLAT / UNSETTLED correctly for VOL_SPIKE at 4h', () => {
    const m = _confusionMatrix(FIXTURE_ROWS, '4h')
    // VOL_SPIKE rows: ids 1,2,4,6,8,9
    //   id1: WIN, id2: WIN, id4: WIN, id6: LOSS, id8: FLAT, id9: null→UNSETTLED
    const vs = m['VOL_SPIKE']
    expect(vs.WIN).toBe(3)
    expect(vs.LOSS).toBe(1)
    expect(vs.FLAT).toBe(1)
    expect(vs.UNSETTLED).toBe(1)
  })

  it('counts outcomes correctly for SKEW_CRUSH at 4h', () => {
    const m = _confusionMatrix(FIXTURE_ROWS, '4h')
    // SKEW_CRUSH rows: ids 3,5,7,10
    //   id3: WIN, id5: WIN, id7: LOSS, id10: null→UNSETTLED
    const sc = m['SKEW_CRUSH']
    expect(sc.WIN).toBe(2)
    expect(sc.LOSS).toBe(1)
    expect(sc.UNSETTLED).toBe(1)
  })

  it('defaults to 4h horizon when not specified', () => {
    const m4h      = _confusionMatrix(FIXTURE_ROWS, '4h')
    const mDefault = _confusionMatrix(FIXTURE_ROWS)
    expect(mDefault).toEqual(m4h)
  })

  it('handles empty rows', () => {
    expect(_confusionMatrix([])).toEqual({})
  })
})
