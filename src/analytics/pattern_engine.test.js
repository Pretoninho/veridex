import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeDirectionalScore,
  computeEVScore,
  computeFrequencyScore,
  computeStabilityScore,
  analyzeMarketPattern,
} from './pattern_engine.js'

// ── computeDirectionalScore ───────────────────────────────────────────────────

describe('computeDirectionalScore', () => {
  it('retourne probUp - probDown', () => {
    expect(computeDirectionalScore(0.7, 0.2)).toBeCloseTo(0.5)
  })

  it('retourne 0.5 si probUp est null', () => {
    expect(computeDirectionalScore(null, 0.3)).toBe(0.5)
  })

  it('retourne 0.5 si probDown est null', () => {
    expect(computeDirectionalScore(0.6, null)).toBe(0.5)
  })

  it('peut retourner une valeur négative (signal baissier)', () => {
    expect(computeDirectionalScore(0.2, 0.7)).toBeCloseTo(-0.5)
  })
})

// ── computeEVScore ────────────────────────────────────────────────────────────

describe('computeEVScore', () => {
  it('centre sur 0.5 quand ev = 0', () => {
    expect(computeEVScore(0)).toBeCloseTo(0.5)
  })

  it('retourne 1 quand ev >= 2', () => {
    expect(computeEVScore(2)).toBe(1)
    expect(computeEVScore(5)).toBe(1)
  })

  it('retourne 0 quand ev <= -2', () => {
    expect(computeEVScore(-2)).toBe(0)
    expect(computeEVScore(-5)).toBe(0)
  })

  it('retourne 0 si ev est null', () => {
    expect(computeEVScore(null)).toBe(0)
  })
})

// ── computeFrequencyScore ─────────────────────────────────────────────────────

describe('computeFrequencyScore', () => {
  it('retourne 0 pour 0 occurrences', () => {
    expect(computeFrequencyScore(0)).toBe(0)
  })

  it('retourne 0 si occurrences est null/undefined', () => {
    expect(computeFrequencyScore(null)).toBe(0)
    expect(computeFrequencyScore(undefined)).toBe(0)
  })

  it('augmente avec les occurrences', () => {
    const s10  = computeFrequencyScore(10)
    const s100 = computeFrequencyScore(100)
    expect(s100).toBeGreaterThan(s10)
  })

  it('est plafonné à 1', () => {
    expect(computeFrequencyScore(1e9)).toBe(1)
  })
})

// ── computeStabilityScore ─────────────────────────────────────────────────────

describe('computeStabilityScore', () => {
  it('retourne 0 si distribution est falsy', () => {
    expect(computeStabilityScore(null, 10)).toBe(0)
    expect(computeStabilityScore(undefined, 10)).toBe(0)
  })

  it('retourne 0 si occurrences est 0', () => {
    const dist = { bigUp: 2, bigDown: 1, up: 3, down: 2, flat: 2 }
    expect(computeStabilityScore(dist, 0)).toBe(0)
  })

  it('retourne 1 quand aucun mouvement extrême', () => {
    const dist = { bigUp: 0, bigDown: 0, up: 5, down: 3, flat: 2 }
    expect(computeStabilityScore(dist, 10)).toBe(1)
  })

  it('retourne 0 quand tous les mouvements sont extrêmes', () => {
    const dist = { bigUp: 5, bigDown: 5, up: 0, down: 0, flat: 0 }
    expect(computeStabilityScore(dist, 10)).toBe(0)
  })

  it('retourne une valeur intermédiaire', () => {
    const dist = { bigUp: 2, bigDown: 2, up: 3, down: 2, flat: 1 }
    const score = computeStabilityScore(dist, 10)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
    expect(score).toBeCloseTo(0.6)
  })
})

// ── analyzeMarketPattern ──────────────────────────────────────────────────────

// Mock idb-keyval to avoid browser IndexedDB dependency
vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
}))

import { get as idbGet } from 'idb-keyval'

const MARKET = { ivRank: 40, fundingPct: 0.01, spreadPct: 0.2, lsRatio: 1.0, basisPct: 1 }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzeMarketPattern — NO_DATA', () => {
  it('retourne signal NO_DATA si occurrences < minOccurrences', async () => {
    idbGet.mockResolvedValue({ count: 5, outcomes: [], config: {} })
    const result = await analyzeMarketPattern(MARKET)
    expect(result.signal).toBe('NO_DATA')
    expect(result.score).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('retourne signal NO_DATA si le record est absent (idbGet retourne undefined)', async () => {
    idbGet.mockResolvedValue(undefined)
    const result = await analyzeMarketPattern(MARKET)
    expect(result.signal).toBe('NO_DATA')
  })
})

describe('analyzeMarketPattern — NO_STATS', () => {
  it('retourne signal NO_STATS si patternStats est absent', async () => {
    idbGet.mockResolvedValue({ count: 50, outcomes: [], config: {}, patternStats: null })
    const result = await analyzeMarketPattern(MARKET)
    expect(result.signal).toBe('NO_STATS')
  })
})

describe('analyzeMarketPattern — score calculé', () => {
  function makeRecord(opts = {}) {
    const upMoves   = opts.upMoves   ?? 50
    const downMoves = opts.downMoves ?? 20
    const flatMoves = opts.flatMoves ?? 10
    return {
      count: 100,
      outcomes: [],
      config: {},
      patternStats: {
        '24h': {
          occurrences: opts.occurrences ?? (upMoves + downMoves + flatMoves),
          upMoves,
          downMoves,
          flatMoves,
          avgUpMove:   opts.avgUpMove   ?? 1.5,
          avgDownMove: opts.avgDownMove ?? -1,
          distribution: opts.distribution ?? {
            bigDown: 2, down: 18, flat: 10, up: 40, bigUp: 10,
          },
        },
      },
    }
  }

  it('retourne score ∈ [0, 100] et confidence ∈ [0, 100]', async () => {
    idbGet.mockResolvedValue(makeRecord())
    const result = await analyzeMarketPattern(MARKET)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(100)
  })

  it('retourne signal LONG quand probUp élevée et EV positive', async () => {
    idbGet.mockResolvedValue(makeRecord({
      upMoves: 70, downMoves: 5, flatMoves: 5,
      avgUpMove: 2, avgDownMove: -0.5,
      distribution: { bigDown: 0, down: 5, flat: 5, up: 50, bigUp: 20 },
    }))
    const result = await analyzeMarketPattern(MARKET)
    expect(result.signal).toBe('LONG')
    expect(result.score).toBeGreaterThan(65)
  })

  it('retourne signal SHORT quand probDown = 1, EV très négative, faible fréquence', async () => {
    // occurrences=21 (juste au-dessus du seuil) + tous bigDown → freqScore et stabScore faibles
    // → la composante directionnelle (-1) domine et fait passer score < 35
    idbGet.mockResolvedValue(makeRecord({
      upMoves: 0, downMoves: 21, flatMoves: 0,
      avgUpMove: 0, avgDownMove: -3,
      distribution: { bigDown: 21, down: 0, flat: 0, up: 0, bigUp: 0 },
    }))
    const result = await analyzeMarketPattern(MARKET, { minOccurrences: 20 })
    expect(result.signal).toBe('SHORT')
    expect(result.score).toBeLessThan(35)
  })

  it('retourne signal NEUTRAL pour un marché légèrement baissier avec EV modérée', async () => {
    // directional légèrement négatif, EV ≈ -0.55, occurrences faibles → score ≈ 60
    idbGet.mockResolvedValue(makeRecord({
      upMoves: 8, downMoves: 13, flatMoves: 0,
      avgUpMove: 1, avgDownMove: -1.5,
      distribution: { bigDown: 0, down: 13, flat: 0, up: 8, bigUp: 0 },
    }))
    const result = await analyzeMarketPattern(MARKET, { minOccurrences: 20 })
    expect(result.signal).toBe('NEUTRAL')
    expect(result.score).toBeGreaterThanOrEqual(35)
    expect(result.score).toBeLessThanOrEqual(65)
  })

  it('expose hash, config, probUp, probDown, expectedValue et occurrences', async () => {
    idbGet.mockResolvedValue(makeRecord())
    const result = await analyzeMarketPattern(MARKET)
    expect(typeof result.hash).toBe('string')
    expect(result.config).toBeTruthy()
    expect(typeof result.probUp).toBe('number')
    expect(typeof result.probDown).toBe('number')
    expect(typeof result.expectedValue).toBe('number')
    expect(result.occurrences).toBe(80)
  })

  it('respecte le timeframe passé en option', async () => {
    const record = {
      count: 50,
      outcomes: [],
      config: {},
      patternStats: {
        '1h': {
          occurrences: 30,
          upMoves: 20, downMoves: 5, flatMoves: 5,
          avgUpMove: 1, avgDownMove: -0.5,
          distribution: { bigDown: 0, down: 5, flat: 5, up: 20, bigUp: 0 },
        },
      },
    }
    idbGet.mockResolvedValue(record)
    const result = await analyzeMarketPattern(MARKET, { timeframe: '1h', minOccurrences: 10 })
    expect(result.occurrences).toBe(30)
  })
})
