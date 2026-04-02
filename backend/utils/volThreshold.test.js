/**
 * backend/utils/volThreshold.test.js
 *
 * Unit tests for the volatility-based threshold helpers.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  DEFAULT_K,
  DAYS_PER_YEAR,
  extractDirection,
  selectVolSource,
  computeThreshold,
  labelOutcome,
} = require('./volThreshold')

// ── DEFAULT_K ─────────────────────────────────────────────────────────────────

describe('DEFAULT_K', () => {
  it('defaults to 0.75 when SETTLEMENT_K is not set', () => {
    // The module is already loaded; when env var is absent the default is 0.75.
    expect(DEFAULT_K).toBe(0.75)
  })

  it('is a positive finite number', () => {
    expect(Number.isFinite(DEFAULT_K)).toBe(true)
    expect(DEFAULT_K).toBeGreaterThan(0)
  })
})

// ── extractDirection ──────────────────────────────────────────────────────────

describe('extractDirection', () => {
  it('returns LONG for bullish positioning', () => {
    expect(extractDirection({ signal: 'bullish' })).toBe('LONG')
  })

  it('returns SHORT for bearish positioning', () => {
    expect(extractDirection({ signal: 'bearish' })).toBe('SHORT')
  })

  it('returns null for neutral positioning (NO TRADE)', () => {
    expect(extractDirection({ signal: 'neutral' })).toBeNull()
  })

  it('returns null for null input', () => {
    expect(extractDirection(null)).toBeNull()
  })

  it('returns null for unknown signal values', () => {
    expect(extractDirection({ signal: 'unknown' })).toBeNull()
  })
})

// ── selectVolSource ───────────────────────────────────────────────────────────

describe('selectVolSource', () => {
  it('prefers DVOL over RV when both are available', () => {
    const result = selectVolSource({ current: 65 }, { current: 40, avg30: 38 })
    expect(result.source).toBe('DVOL')
    expect(result.volAnn).toBeCloseTo(0.65, 10)
  })

  it('falls back to RV.current when DVOL is absent', () => {
    const result = selectVolSource(null, { current: 50, avg30: 45 })
    expect(result.source).toBe('RV')
    expect(result.volAnn).toBeCloseTo(0.50, 10)
  })

  it('falls back to RV.avg30 when RV.current is absent', () => {
    const result = selectVolSource(null, { avg30: 40 })
    expect(result.source).toBe('RV')
    expect(result.volAnn).toBeCloseTo(0.40, 10)
  })

  it('returns null source when no vol data is available', () => {
    const result = selectVolSource(null, null)
    expect(result.source).toBeNull()
    expect(result.volAnn).toBeNull()
  })

  it('normalises DVOL percentage form (>2) to decimal', () => {
    // 65 % → 0.65
    const { volAnn } = selectVolSource({ current: 65 }, null)
    expect(volAnn).toBeCloseTo(0.65, 10)
  })

  it('keeps DVOL decimal form (≤2) as-is', () => {
    // 0.65 (already decimal) → 0.65
    const { volAnn } = selectVolSource({ current: 0.65 }, null)
    expect(volAnn).toBeCloseTo(0.65, 10)
  })

  it('normalises RV percentage form (>2) to decimal', () => {
    const { volAnn } = selectVolSource(null, { current: 80 })
    expect(volAnn).toBeCloseTo(0.80, 10)
  })
})

// ── computeThreshold ─────────────────────────────────────────────────────────

describe('computeThreshold', () => {
  it('uses DEFAULT_K (0.75) when k is omitted', () => {
    // threshold = 0.75 × 0.65 × sqrt(1/365) ≈ 0.02550…
    const result = computeThreshold(0.65, 1)
    const expected = 0.75 * 0.65 * Math.sqrt(1 / DAYS_PER_YEAR)
    expect(result).toBeCloseTo(expected, 10)
  })

  it('applies k=0.75 consistently across 1h horizon', () => {
    const volAnn = 0.65
    const horizonDays = 1 / 24
    const threshold = computeThreshold(volAnn, horizonDays, 0.75)
    const expected = 0.75 * volAnn * Math.sqrt(horizonDays / DAYS_PER_YEAR)
    expect(threshold).toBeCloseTo(expected, 10)
  })

  it('applies k=0.75 consistently across 4h horizon', () => {
    const volAnn = 0.65
    const horizonDays = 4 / 24
    const threshold = computeThreshold(volAnn, horizonDays, 0.75)
    const expected = 0.75 * volAnn * Math.sqrt(horizonDays / DAYS_PER_YEAR)
    expect(threshold).toBeCloseTo(expected, 10)
  })

  it('applies k=0.75 consistently across 24h horizon', () => {
    const volAnn = 0.65
    const horizonDays = 1
    const threshold = computeThreshold(volAnn, horizonDays, 0.75)
    const expected = 0.75 * volAnn * Math.sqrt(horizonDays / DAYS_PER_YEAR)
    expect(threshold).toBeCloseTo(expected, 10)
  })

  it('scales with k — higher k means higher threshold', () => {
    const threshold075 = computeThreshold(0.65, 1, 0.75)
    const threshold100 = computeThreshold(0.65, 1, 1.00)
    expect(threshold100).toBeGreaterThan(threshold075)
  })

  it('scales with volAnn — higher vol means higher threshold', () => {
    const lowVol  = computeThreshold(0.30, 1, 0.75)
    const highVol = computeThreshold(0.80, 1, 0.75)
    expect(highVol).toBeGreaterThan(lowVol)
  })

  it('scales with horizon — 24h threshold > 4h > 1h', () => {
    const t1h  = computeThreshold(0.65, 1 / 24, 0.75)
    const t4h  = computeThreshold(0.65, 4 / 24, 0.75)
    const t24h = computeThreshold(0.65, 1,      0.75)
    expect(t24h).toBeGreaterThan(t4h)
    expect(t4h).toBeGreaterThan(t1h)
  })

  it('returns a positive value for valid inputs', () => {
    expect(computeThreshold(0.65, 1 / 24, 0.75)).toBeGreaterThan(0)
    expect(computeThreshold(0.65, 4 / 24, 0.75)).toBeGreaterThan(0)
    expect(computeThreshold(0.65, 1,      0.75)).toBeGreaterThan(0)
  })
})

// ── labelOutcome ─────────────────────────────────────────────────────────────

describe('labelOutcome', () => {
  const threshold = 0.015 // 1.5 %

  describe('LONG direction', () => {
    it('returns WIN when return ≥ +threshold', () => {
      expect(labelOutcome('LONG', threshold, threshold)).toBe('WIN')
      expect(labelOutcome('LONG', threshold + 0.001, threshold)).toBe('WIN')
    })

    it('returns LOSS when return ≤ −threshold', () => {
      expect(labelOutcome('LONG', -threshold, threshold)).toBe('LOSS')
      expect(labelOutcome('LONG', -threshold - 0.001, threshold)).toBe('LOSS')
    })

    it('returns FLAT when return is inside [−threshold, +threshold)', () => {
      expect(labelOutcome('LONG', 0,              threshold)).toBe('FLAT')
      expect(labelOutcome('LONG', threshold - 0.001, threshold)).toBe('FLAT')
      expect(labelOutcome('LONG', -(threshold - 0.001), threshold)).toBe('FLAT')
    })
  })

  describe('SHORT direction', () => {
    it('returns WIN when return ≤ −threshold', () => {
      expect(labelOutcome('SHORT', -threshold, threshold)).toBe('WIN')
      expect(labelOutcome('SHORT', -threshold - 0.001, threshold)).toBe('WIN')
    })

    it('returns LOSS when return ≥ +threshold', () => {
      expect(labelOutcome('SHORT', threshold, threshold)).toBe('LOSS')
      expect(labelOutcome('SHORT', threshold + 0.001, threshold)).toBe('LOSS')
    })

    it('returns FLAT when return is inside (−threshold, +threshold)', () => {
      expect(labelOutcome('SHORT', 0,              threshold)).toBe('FLAT')
      expect(labelOutcome('SHORT', threshold - 0.001, threshold)).toBe('FLAT')
      expect(labelOutcome('SHORT', -(threshold - 0.001), threshold)).toBe('FLAT')
    })
  })
})
