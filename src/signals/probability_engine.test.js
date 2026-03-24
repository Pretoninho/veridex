import { describe, it, expect, beforeEach } from 'vitest'
import {
  patternStats,
  updatePatternStats,
  computeProbabilities,
  storeSignal,
  evaluateSignals,
} from './probability_engine.js'

// Reset patternStats and pending signals before each test by clearing the object
beforeEach(() => {
  for (const key of Object.keys(patternStats)) {
    delete patternStats[key]
  }
  // Flush any leftover pending signals with a neutral price so they don't bleed into subsequent tests
  evaluateSignals(0)
})

// ── updatePatternStats ────────────────────────────────────────────────────────

describe('updatePatternStats', () => {
  it('creates an entry for a new hash', () => {
    updatePatternStats('abc', 0.05)
    expect(patternStats['abc']).toBeDefined()
    expect(patternStats['abc'].occurrences).toBe(1)
  })

  it('increments occurrences on each call', () => {
    updatePatternStats('abc', 0.05)
    updatePatternStats('abc', -0.03)
    expect(patternStats['abc'].occurrences).toBe(2)
  })

  it('counts move > 0.01 as upMove', () => {
    updatePatternStats('h1', 0.02)
    expect(patternStats['h1'].upMoves).toBe(1)
    expect(patternStats['h1'].downMoves).toBe(0)
    expect(patternStats['h1'].flatMoves).toBe(0)
  })

  it('counts move < -0.01 as downMove', () => {
    updatePatternStats('h2', -0.05)
    expect(patternStats['h2'].downMoves).toBe(1)
    expect(patternStats['h2'].upMoves).toBe(0)
    expect(patternStats['h2'].flatMoves).toBe(0)
  })

  it('counts move in [-0.01, 0.01] as flatMove', () => {
    updatePatternStats('h3', 0.005)
    updatePatternStats('h3', -0.005)
    updatePatternStats('h3', 0)
    expect(patternStats['h3'].flatMoves).toBe(3)
    expect(patternStats['h3'].upMoves).toBe(0)
    expect(patternStats['h3'].downMoves).toBe(0)
  })

  it('accumulates sumUpMove and sumDownMove correctly', () => {
    updatePatternStats('h4', 0.03)
    updatePatternStats('h4', 0.07)
    updatePatternStats('h4', -0.04)
    expect(patternStats['h4'].sumUpMove).toBeCloseTo(0.10)
    expect(patternStats['h4'].sumDownMove).toBeCloseTo(-0.04)
  })

  it('boundary: move exactly 0.01 → flatMove', () => {
    updatePatternStats('h5', 0.01)
    expect(patternStats['h5'].flatMoves).toBe(1)
  })

  it('boundary: move exactly -0.01 → flatMove', () => {
    updatePatternStats('h6', -0.01)
    expect(patternStats['h6'].flatMoves).toBe(1)
  })
})

// ── computeProbabilities ──────────────────────────────────────────────────────

describe('computeProbabilities', () => {
  it('returns correct probabilities', () => {
    updatePatternStats('p1', 0.05)
    updatePatternStats('p1', 0.03)
    updatePatternStats('p1', -0.04)
    updatePatternStats('p1', 0.005)

    const result = computeProbabilities(patternStats['p1'])

    expect(result.probUp).toBeCloseTo(2 / 4)
    expect(result.probDown).toBeCloseTo(1 / 4)
    expect(result.probFlat).toBeCloseTo(1 / 4)
  })

  it('returns correct avgUpMove', () => {
    updatePatternStats('p2', 0.04)
    updatePatternStats('p2', 0.06)

    const result = computeProbabilities(patternStats['p2'])
    expect(result.avgUpMove).toBeCloseTo(0.05)
  })

  it('returns correct avgDownMove', () => {
    updatePatternStats('p3', -0.02)
    updatePatternStats('p3', -0.06)

    const result = computeProbabilities(patternStats['p3'])
    expect(result.avgDownMove).toBeCloseTo(-0.04)
  })

  it('returns 0 for avgUpMove when no up moves', () => {
    updatePatternStats('p4', -0.03)
    const result = computeProbabilities(patternStats['p4'])
    expect(result.avgUpMove).toBe(0)
  })

  it('returns 0 for avgDownMove when no down moves', () => {
    updatePatternStats('p5', 0.03)
    const result = computeProbabilities(patternStats['p5'])
    expect(result.avgDownMove).toBe(0)
  })

  it('handles a stat with zero occurrences without dividing by zero', () => {
    const emptyStat = {
      occurrences: 0,
      upMoves: 0,
      downMoves: 0,
      flatMoves: 0,
      sumUpMove: 0,
      sumDownMove: 0,
    }
    const result = computeProbabilities(emptyStat)
    expect(result.probUp).toBe(0)
    expect(result.probDown).toBe(0)
    expect(result.probFlat).toBe(0)
    expect(result.avgUpMove).toBe(0)
    expect(result.avgDownMove).toBe(0)
  })
})

// ── storeSignal / evaluateSignals ─────────────────────────────────────────────

describe('storeSignal + evaluateSignals', () => {
  it('evaluateSignals computes the correct move and updates patternStats', () => {
    storeSignal({ hash: 'sig1', entryPrice: 100, timestamp: Date.now() })
    evaluateSignals(105)

    // move = (105 - 100) / 100 = 0.05 → upMove
    expect(patternStats['sig1'].occurrences).toBe(1)
    expect(patternStats['sig1'].upMoves).toBe(1)
    expect(patternStats['sig1'].downMoves).toBe(0)
  })

  it('evaluateSignals removes all pending signals after processing', () => {
    storeSignal({ hash: 'sig2', entryPrice: 200, timestamp: Date.now() })
    evaluateSignals(190)
    // Second call should not add another occurrence
    evaluateSignals(190)
    expect(patternStats['sig2'].occurrences).toBe(1)
  })

  it('evaluateSignals handles multiple pending signals', () => {
    storeSignal({ hash: 'multi', entryPrice: 100, timestamp: Date.now() })
    storeSignal({ hash: 'multi', entryPrice: 200, timestamp: Date.now() })
    evaluateSignals(110) // moves: +10% and -45%

    expect(patternStats['multi'].occurrences).toBe(2)
    expect(patternStats['multi'].upMoves).toBe(1)   // (110-100)/100 = 0.10
    expect(patternStats['multi'].downMoves).toBe(1) // (110-200)/200 = -0.45
  })

  it('full workflow: store → evaluate → computeProbabilities is deterministic', () => {
    const hash = 'workflow'
    storeSignal({ hash, entryPrice: 1000, timestamp: 1 })
    storeSignal({ hash, entryPrice: 1000, timestamp: 2 })
    storeSignal({ hash, entryPrice: 1000, timestamp: 3 })
    evaluateSignals(1050) // all move +5%

    const result = computeProbabilities(patternStats[hash])
    expect(result.probUp).toBeCloseTo(1)
    expect(result.probDown).toBeCloseTo(0)
    expect(result.avgUpMove).toBeCloseTo(0.05)
  })
})
