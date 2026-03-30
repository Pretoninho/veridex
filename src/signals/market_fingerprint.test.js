import { describe, it, expect } from 'vitest'
import { classifyMove, computeAdvancedStats, createFingerprint, TIMEFRAMES } from './market_fingerprint.js'

// ── TIMEFRAMES ────────────────────────────────────────────────────────────────

describe('TIMEFRAMES', () => {
  it('contient exactement 1h, 24h et 7d', () => {
    expect(TIMEFRAMES).toEqual(['1h', '24h', '7d'])
  })
})

// ── classifyMove ──────────────────────────────────────────────────────────────

describe('classifyMove', () => {
  it('bigDown si move < -3', () => {
    expect(classifyMove(-5)).toBe('bigDown')
    expect(classifyMove(-3.01)).toBe('bigDown')
  })

  it('down si -3 ≤ move < -0.1', () => {
    expect(classifyMove(-3)).toBe('down')
    expect(classifyMove(-1)).toBe('down')
    expect(classifyMove(-0.11)).toBe('down')
  })

  it('flat si -0.1 ≤ move ≤ 0.1', () => {
    expect(classifyMove(0)).toBe('flat')
    expect(classifyMove(0.1)).toBe('flat')
    expect(classifyMove(-0.1)).toBe('flat')
  })

  it('up si 0.1 < move ≤ 3', () => {
    expect(classifyMove(0.11)).toBe('up')
    expect(classifyMove(1)).toBe('up')
    expect(classifyMove(3)).toBe('up')
  })

  it('bigUp si move > 3', () => {
    expect(classifyMove(3.01)).toBe('bigUp')
    expect(classifyMove(10)).toBe('bigUp')
  })
})

// ── computeAdvancedStats ──────────────────────────────────────────────────────

describe('computeAdvancedStats', () => {
  it('retourne null si stat est null ou occurrences = 0', () => {
    expect(computeAdvancedStats(null)).toBeNull()
    expect(computeAdvancedStats(undefined)).toBeNull()
    expect(computeAdvancedStats({ occurrences: 0 })).toBeNull()
  })

  it('calcule correctement probUp et probDown', () => {
    const stat = {
      occurrences: 10,
      upMoves:     6,
      downMoves:   3,
      flatMoves:   1,
      avgUpMove:   2,
      avgDownMove: -1,
      distribution: { bigDown: 0, down: 3, flat: 1, up: 4, bigUp: 2 },
    }
    const result = computeAdvancedStats(stat)
    expect(result.probUp).toBe(0.6)
    expect(result.probDown).toBe(0.3)
  })

  it('calcule correctement expectedValue', () => {
    const stat = {
      occurrences: 10,
      upMoves:     6,
      downMoves:   3,
      flatMoves:   1,
      avgUpMove:   2,
      avgDownMove: -1,
      distribution: { bigDown: 0, down: 3, flat: 1, up: 4, bigUp: 2 },
    }
    // probUp * avgUpMove + probDown * avgDownMove = 0.6*2 + 0.3*(-1) = 1.2 - 0.3 = 0.9
    const result = computeAdvancedStats(stat)
    expect(result.expectedValue).toBe(0.9)
  })

  it('calcule correctement riskReward', () => {
    const stat = {
      occurrences: 10,
      upMoves:     6,
      downMoves:   3,
      flatMoves:   1,
      avgUpMove:   4,
      avgDownMove: -2,
      distribution: { bigDown: 0, down: 3, flat: 1, up: 4, bigUp: 2 },
    }
    // riskReward = |avgUpMove / avgDownMove| = 4/2 = 2
    const result = computeAdvancedStats(stat)
    expect(result.riskReward).toBe(2)
  })

  it('retourne riskReward null si avgDownMove = 0', () => {
    const stat = {
      occurrences: 5,
      upMoves:     5,
      downMoves:   0,
      flatMoves:   0,
      avgUpMove:   3,
      avgDownMove: 0,
      distribution: { bigDown: 0, down: 0, flat: 0, up: 3, bigUp: 2 },
    }
    const result = computeAdvancedStats(stat)
    expect(result.riskReward).toBeNull()
  })

  it('expose la distribution inchangée', () => {
    const dist = { bigDown: 1, down: 2, flat: 1, up: 3, bigUp: 2 }
    const stat = {
      occurrences: 9,
      upMoves:     5,
      downMoves:   3,
      flatMoves:   1,
      avgUpMove:   1.5,
      avgDownMove: -1,
      distribution: dist,
    }
    const result = computeAdvancedStats(stat)
    expect(result.distribution).toBe(dist)
  })

  it('arrondit probUp et probDown à 3 décimales', () => {
    const stat = {
      occurrences: 3,
      upMoves:     1,
      downMoves:   1,
      flatMoves:   1,
      avgUpMove:   1,
      avgDownMove: -1,
      distribution: { bigDown: 0, down: 1, flat: 1, up: 1, bigUp: 0 },
    }
    // 1/3 ≈ 0.333
    const result = computeAdvancedStats(stat)
    expect(result.probUp).toBe(0.333)
    expect(result.probDown).toBe(0.333)
  })
})

// ── createFingerprint ─────────────────────────────────────────────────────────

describe('createFingerprint', () => {
  it('retourne un config et un hash non vides', () => {
    const fp = createFingerprint({ ivRank: 55, fundingPct: 0.01, spreadPct: 0.2, lsRatio: 1.0, basisPct: 3 })
    expect(fp).toHaveProperty('config')
    expect(fp).toHaveProperty('hash')
    expect(typeof fp.hash).toBe('string')
    expect(fp.hash.length).toBeGreaterThan(0)
  })

  it('arrondit ivRank par tranches de 10', () => {
    const fp = createFingerprint({ ivRank: 54 })
    expect(fp.config.ivRankBucket).toBe(50)
    const fp2 = createFingerprint({ ivRank: 56 })
    expect(fp2.config.ivRankBucket).toBe(60)
  })

  it('classe le spread correctement', () => {
    expect(createFingerprint({ spreadPct: 0.6 }).config.spreadBucket).toBe('wide')
    expect(createFingerprint({ spreadPct: 0.3 }).config.spreadBucket).toBe('normal')
    expect(createFingerprint({ spreadPct: 0.05 }).config.spreadBucket).toBe('tight')
  })

  // v2.0: lsRatio test removed (Binance L/S ratio deprecated)

  it('classe le basis correctement', () => {
    expect(createFingerprint({ basisPct: 12 }).config.basisBucket).toBe('high_contango')
    expect(createFingerprint({ basisPct: 5  }).config.basisBucket).toBe('contango')
    expect(createFingerprint({ basisPct: 0  }).config.basisBucket).toBe('flat')
    expect(createFingerprint({ basisPct: -5 }).config.basisBucket).toBe('backwardation')
  })

  it('deux configurations identiques produisent le même hash', () => {
    const market = { ivRank: 50, fundingPct: 0.01, spreadPct: 0.2, lsRatio: 1.0, basisPct: 3 }
    expect(createFingerprint(market).hash).toBe(createFingerprint(market).hash)
  })

  it('deux configurations différentes produisent des hashs différents', () => {
    const fp1 = createFingerprint({ ivRank: 20, fundingPct: 0.01, spreadPct: 0.2, lsRatio: 1.0, basisPct: 3 })
    const fp2 = createFingerprint({ ivRank: 80, fundingPct: 0.01, spreadPct: 0.2, lsRatio: 1.0, basisPct: 3 })
    expect(fp1.hash).not.toBe(fp2.hash)
  })

  it('gere les valeurs nulles sans crash', () => {
    expect(() => createFingerprint({})).not.toThrow()
    const fp = createFingerprint({})
    expect(fp.config.ivRankBucket).toBeNull()
    expect(fp.config.spreadBucket).toBeNull()
  })
})
