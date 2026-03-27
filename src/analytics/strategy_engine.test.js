import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  selectBestPatterns,
  adaptThresholds,
  filterPatterns,
  computePositionSize,
  applyDrawdownControl,
  computeFinalScore,
} from './strategy_engine.js'

// ── Mock idb-keyval (IndexedDB) ───────────────────────────────────────────────
vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
}))

import { get as idbGet } from 'idb-keyval'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────
// adaptThresholds
// ─────────────────────────────────────────────────────────────

describe('adaptThresholds', () => {
  it('retourne seuils stricts pour DVOL faible (< 40)', () => {
    const t = adaptThresholds(30)
    expect(t.minEV).toBe(0.2)
    expect(t.minWinrate).toBe(0.55)
  })

  it('retourne seuils normaux pour DVOL modéré (40 ≤ dvol < 70)', () => {
    const t = adaptThresholds(55)
    expect(t.minEV).toBe(0.1)
    expect(t.minWinrate).toBe(0.5)
  })

  it('retourne seuils intermédiaires pour DVOL élevé (≥ 70)', () => {
    const t = adaptThresholds(80)
    expect(t.minEV).toBe(0.15)
    expect(t.minWinrate).toBe(0.52)
  })

  it('gère la limite exacte dvol = 40', () => {
    const t = adaptThresholds(40)
    expect(t.minEV).toBe(0.1)
    expect(t.minWinrate).toBe(0.5)
  })

  it('gère la limite exacte dvol = 70', () => {
    const t = adaptThresholds(70)
    expect(t.minEV).toBe(0.15)
    expect(t.minWinrate).toBe(0.52)
  })
})

// ─────────────────────────────────────────────────────────────
// filterPatterns
// ─────────────────────────────────────────────────────────────

describe('filterPatterns', () => {
  const patterns = [
    { id: 'a', ev: 0.3, winrate: 0.6 },  // passe DVOL < 40
    { id: 'b', ev: 0.1, winrate: 0.5 },  // ne passe pas DVOL < 40 (ev ≤ minEV)
    { id: 'c', ev: 0.25, winrate: 0.4 }, // ne passe pas (winrate trop faible)
    { id: 'd', ev: 0.12, winrate: 0.51 }, // passe DVOL modéré
  ]

  it('filtre correctement pour DVOL faible', () => {
    const result = filterPatterns(patterns, 30)
    expect(result.map(p => p.id)).toEqual(['a'])
  })

  it('filtre correctement pour DVOL modéré', () => {
    const result = filterPatterns(patterns, 55)
    expect(result.map(p => p.id)).toContain('a')
    expect(result.map(p => p.id)).toContain('d')
    expect(result.map(p => p.id)).not.toContain('c')
  })

  it('retourne un tableau vide si aucun pattern ne passe', () => {
    const bad = [{ id: 'x', ev: 0, winrate: 0 }]
    expect(filterPatterns(bad, 50)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────
// computePositionSize
// ─────────────────────────────────────────────────────────────

describe('computePositionSize', () => {
  it('calcule une taille positive avec un signal favorable', () => {
    const size = computePositionSize({ winrate: 0.6, rewardRisk: 1.5 }, 10000)
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(2000) // max 20 %
  })

  it('retourne 0 si le Kelly est négatif (edge défavorable)', () => {
    // kelly = (0.3 * (1+1) - 1) / 1 = -0.4 → clamped to 0
    const size = computePositionSize({ winrate: 0.3, rewardRisk: 1 }, 10000)
    expect(size).toBe(0)
  })

  it('est plafonné à 20 % du capital', () => {
    const size = computePositionSize({ winrate: 1, rewardRisk: 10 }, 10000)
    expect(size).toBe(2000)
  })

  it('utilise les valeurs par défaut si winrate/rewardRisk absents', () => {
    // winrate=0.5, rr=1 → kelly=(0.5*(1+1)-1)/1 = 0
    const size = computePositionSize({}, 10000)
    expect(size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// applyDrawdownControl
// ─────────────────────────────────────────────────────────────

describe('applyDrawdownControl', () => {
  it('retourne 1 en absence de drawdown', () => {
    expect(applyDrawdownControl(10000, 10000)).toBe(1)
  })

  it('retourne 1 pour un drawdown < 20 %', () => {
    expect(applyDrawdownControl(8500, 10000)).toBe(1)
  })

  it('retourne 0.5 pour un drawdown entre 20 % et 30 %', () => {
    expect(applyDrawdownControl(7500, 10000)).toBe(0.5)
  })

  it('retourne 0.2 pour un drawdown > 30 %', () => {
    expect(applyDrawdownControl(6000, 10000)).toBe(0.2)
  })

  it('retourne 1 si peak est 0 (division par zéro)', () => {
    expect(applyDrawdownControl(0, 0)).toBe(1)
  })

  it('retourne 1 à la limite exacte dd = 20 % (seuil strict > 0.2)', () => {
    // dd = 0.2 exactement → condition dd > 0.2 est fausse → nominal
    expect(applyDrawdownControl(8000, 10000)).toBe(1)
  })

  it('retourne 0.5 dès que dd dépasse strictement 20 %', () => {
    // balance = 7999, peak = 10000 → dd ≈ 0.2001
    expect(applyDrawdownControl(7999, 10000)).toBe(0.5)
  })
})

// ─────────────────────────────────────────────────────────────
// computeFinalScore
// ─────────────────────────────────────────────────────────────

describe('computeFinalScore', () => {
  const signal = { ev: 1, winrate: 0.6 }

  it('applique facteur 0.7 pour DVOL < 40', () => {
    expect(computeFinalScore(signal, 30)).toBeCloseTo(1 * 0.6 * 0.7)
  })

  it('applique facteur 1 pour DVOL modéré', () => {
    expect(computeFinalScore(signal, 55)).toBeCloseTo(1 * 0.6 * 1)
  })

  it('applique facteur 0.8 pour DVOL ≥ 70', () => {
    expect(computeFinalScore(signal, 75)).toBeCloseTo(1 * 0.6 * 0.8)
  })

  it('retourne 0 si EV est 0', () => {
    expect(computeFinalScore({ ev: 0, winrate: 0.6 }, 50)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────
// selectBestPatterns
// ─────────────────────────────────────────────────────────────

describe('selectBestPatterns', () => {
  function makeMfRecord({ upMoves = 60, downMoves = 20, avgUpMove = 1.5, avgDownMove = -1, count = 100 } = {}) {
    return {
      count,
      outcomes: [],
      config: {},
      patternStats: {
        '24h': {
          occurrences: upMoves + downMoves,
          upMoves,
          downMoves,
          flatMoves: 0,
          avgUpMove,
          avgDownMove,
          distribution: { bigDown: 0, down: downMoves, flat: 0, up: upMoves, bigUp: 0 },
        },
      },
    }
  }

  it('retourne un tableau trié par score décroissant', async () => {
    // idbGet est appelé pour 'mf_index' puis pour chaque hash
    idbGet
      .mockResolvedValueOnce(['hash1', 'hash2'])         // mf_index
      .mockResolvedValueOnce(makeMfRecord({ upMoves: 10, downMoves: 40, avgUpMove: 0.5, avgDownMove: -2 })) // hash1 (mauvais)
      .mockResolvedValueOnce(makeMfRecord({ upMoves: 70, downMoves: 5,  avgUpMove: 2,   avgDownMove: -0.5 })) // hash2 (bon)

    const result = await selectBestPatterns()
    expect(result.length).toBe(2)
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
  })

  it('retourne au maximum topN patterns', async () => {
    const hashes = ['h1', 'h2', 'h3', 'h4', 'h5']
    idbGet.mockResolvedValueOnce(hashes)
    hashes.forEach(() => idbGet.mockResolvedValueOnce(makeMfRecord()))

    const result = await selectBestPatterns({ topN: 3 })
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('ignore les patterns sans patternStats pour le timeframe', async () => {
    idbGet
      .mockResolvedValueOnce(['h1'])
      .mockResolvedValueOnce({ count: 10, outcomes: [], config: {}, patternStats: null })

    const result = await selectBestPatterns()
    expect(result).toHaveLength(0)
  })

  it('expose id, ev, winrate, rewardRisk, occurrences et score', async () => {
    idbGet
      .mockResolvedValueOnce(['h1'])
      .mockResolvedValueOnce(makeMfRecord())

    const result = await selectBestPatterns()
    expect(result).toHaveLength(1)
    const p = result[0]
    expect(p.id).toBe('h1')
    expect(typeof p.ev).toBe('number')
    expect(typeof p.winrate).toBe('number')
    expect(typeof p.occurrences).toBe('number')
    expect(typeof p.score).toBe('number')
  })

  it('retourne un tableau vide si aucun pattern enregistré', async () => {
    idbGet.mockResolvedValueOnce([])
    const result = await selectBestPatterns()
    expect(result).toHaveLength(0)
  })
})
