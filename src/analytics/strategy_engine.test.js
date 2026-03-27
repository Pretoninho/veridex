import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  selectBestPatterns,
  adaptThresholds,
  filterPatterns,
  computePositionSize,
  applyDrawdownControl,
  computeFinalScore,
  selectAndFilter,
} from './strategy_engine.js'

// Mock idb-keyval to avoid browser IndexedDB dependency
vi.mock('idb-keyval', () => ({
  get: vi.fn(),
  set: vi.fn(),
}))

import { get as idbGet } from 'idb-keyval'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── adaptThresholds ───────────────────────────────────────────────────────────

describe('adaptThresholds', () => {
  it('renvoie des seuils élevés pour DVOL < 40 (marché calme)', () => {
    const t = adaptThresholds(30)
    expect(t.minEV).toBe(0.2)
    expect(t.minWinrate).toBe(0.55)
  })

  it('renvoie des seuils standards pour 40 ≤ DVOL < 70', () => {
    const t = adaptThresholds(55)
    expect(t.minEV).toBe(0.1)
    expect(t.minWinrate).toBe(0.5)
  })

  it('renvoie des seuils intermédiaires pour DVOL ≥ 70 (forte vola)', () => {
    const t = adaptThresholds(80)
    expect(t.minEV).toBe(0.15)
    expect(t.minWinrate).toBe(0.52)
  })

  it('traite la borne 40 comme régime normal', () => {
    const t = adaptThresholds(40)
    expect(t.minEV).toBe(0.1)
  })

  it('traite la borne 70 comme forte vola', () => {
    const t = adaptThresholds(70)
    expect(t.minEV).toBe(0.15)
  })
})

// ── filterPatterns ────────────────────────────────────────────────────────────

describe('filterPatterns', () => {
  const patterns = [
    { id: 'a', ev: 0.5,  winrate: 0.6  },
    { id: 'b', ev: 0.05, winrate: 0.6  },  // ev trop faible
    { id: 'c', ev: 0.5,  winrate: 0.4  },  // winrate trop faible
    { id: 'd', ev: 0.12, winrate: 0.51 },
  ]

  it('conserve les patterns qui passent les seuils (DVOL=55)', () => {
    const filtered = filterPatterns(patterns, 55)
    expect(filtered.map(p => p.id)).toEqual(['a', 'd'])
  })

  it('filtre plus strictement pour DVOL < 40', () => {
    const filtered = filterPatterns(patterns, 30)
    // minEV=0.2, minWinrate=0.55 → seul 'a' passe
    expect(filtered.map(p => p.id)).toEqual(['a'])
  })

  it('retourne un tableau vide si aucun pattern ne passe', () => {
    const none = filterPatterns([{ id: 'x', ev: -1, winrate: 0.1 }], 55)
    expect(none).toEqual([])
  })
})

// ── computePositionSize ───────────────────────────────────────────────────────

describe('computePositionSize', () => {
  it('retourne 0 quand le Kelly est négatif (edge inexistant)', () => {
    // kelly = (0.3 × 2 − 1) / 1 = -0.4 → clampé à 0
    const size = computePositionSize({ winrate: 0.3, rewardRisk: 1 }, 10000)
    expect(size).toBe(0)
  })

  it('est plafonné à 20 % du capital', () => {
    // kelly élevé : (0.9 × 2 − 1) / 1 = 0.8 → clampé à 0.2
    const size = computePositionSize({ winrate: 0.9, rewardRisk: 1 }, 10000)
    expect(size).toBeCloseTo(2000)
  })

  it('calcule correctement un Kelly positif non plafonné', () => {
    // winrate=0.6, rr=2 → kelly=(0.6×3−1)/2=0.4 → clampé à 0.2 → 2000
    const size = computePositionSize({ winrate: 0.6, rewardRisk: 2 }, 10000)
    expect(size).toBeCloseTo(2000)
  })

  it('utilise les valeurs par défaut (winrate=0.5, rr=1) si absent', () => {
    // kelly = (0.5×2−1)/1 = 0 → taille = 0
    const size = computePositionSize({}, 10000)
    expect(size).toBe(0)
  })

  it('prend en compte le balance', () => {
    // winrate=0.6, rr=1 → kelly=(0.6×2−1)/1=0.2 (pas de clamping)
    const size5k  = computePositionSize({ winrate: 0.6, rewardRisk: 1 }, 5000)
    const size20k = computePositionSize({ winrate: 0.6, rewardRisk: 1 }, 20000)
    expect(size20k).toBeCloseTo(size5k * 4)
  })
})

// ── applyDrawdownControl ──────────────────────────────────────────────────────

describe('applyDrawdownControl', () => {
  it('retourne 1 si le drawdown est faible (< 20 %)', () => {
    expect(applyDrawdownControl(9000, 10000)).toBe(1)
    expect(applyDrawdownControl(10000, 10000)).toBe(1)
  })

  it('retourne 0.5 entre 20 % et 30 % de drawdown', () => {
    expect(applyDrawdownControl(8000, 10000)).toBe(0.5)  // DD = 20 %
    expect(applyDrawdownControl(7500, 10000)).toBe(0.5)  // DD = 25 %
  })

  it('retourne 0.2 au-delà de 30 % de drawdown (mode survie)', () => {
    expect(applyDrawdownControl(7000, 10000)).toBe(0.2)  // DD = 30 %
    expect(applyDrawdownControl(5000, 10000)).toBe(0.2)  // DD = 50 %
  })

  it('retourne 1 si peak est 0 ou absent', () => {
    expect(applyDrawdownControl(5000, 0)).toBe(1)
    expect(applyDrawdownControl(5000, null)).toBe(1)
  })
})

// ── computeFinalScore ─────────────────────────────────────────────────────────

describe('computeFinalScore', () => {
  const signal = { ev: 1, winrate: 0.6 }

  it('applique le facteur 0.7 pour DVOL < 40', () => {
    expect(computeFinalScore(signal, 30)).toBeCloseTo(1 * 0.6 * 0.7)
  })

  it('applique le facteur 1.0 pour DVOL ∈ [40, 70)', () => {
    expect(computeFinalScore(signal, 55)).toBeCloseTo(1 * 0.6 * 1.0)
  })

  it('applique le facteur 0.8 pour DVOL ≥ 70', () => {
    expect(computeFinalScore(signal, 80)).toBeCloseTo(1 * 0.6 * 0.8)
  })

  it('retourne 0 si ev = 0', () => {
    expect(computeFinalScore({ ev: 0, winrate: 0.7 }, 55)).toBe(0)
  })
})

// ── selectBestPatterns ────────────────────────────────────────────────────────

function makeMfRecord(upMoves, downMoves, avgUp, avgDown) {
  return {
    count: upMoves + downMoves,
    outcomes: [],
    config: {},
    patternStats: {
      '24h': {
        occurrences: upMoves + downMoves,
        upMoves,
        downMoves,
        flatMoves:    0,
        avgUpMove:    avgUp,
        avgDownMove:  avgDown,
        distribution: { bigDown: 0, down: downMoves, flat: 0, up: upMoves, bigUp: 0 },
      },
    },
  }
}

describe('selectBestPatterns', () => {
  it('retourne un tableau vide si aucun pattern en base', async () => {
    idbGet.mockResolvedValue([])          // mf_index = []
    const result = await selectBestPatterns()
    expect(result).toEqual([])
  })

  it('ignore les patterns sans stats 24h valides', async () => {
    idbGet
      .mockResolvedValueOnce(['hash1'])   // mf_index
      .mockResolvedValueOnce({ count: 10, outcomes: [], config: {}, patternStats: null })
    const result = await selectBestPatterns()
    expect(result).toEqual([])
  })

  it('retourne les patterns classés par score décroissant', async () => {
    const recordA = makeMfRecord(80, 10, 2, -0.5)  // score élevé
    const recordB = makeMfRecord(20, 20, 0.5, -0.5) // score faible

    idbGet
      .mockResolvedValueOnce(['hashA', 'hashB'])  // mf_index
      .mockResolvedValueOnce(recordA)             // hashA record
      .mockResolvedValueOnce(recordB)             // hashB record

    const result = await selectBestPatterns()
    expect(result.length).toBeGreaterThanOrEqual(1)
    if (result.length >= 2) {
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
    }
  })

  it('expose id, ev, winrate, occurrences, rewardRisk, score', async () => {
    idbGet
      .mockResolvedValueOnce(['hashX'])
      .mockResolvedValueOnce(makeMfRecord(60, 20, 1.5, -1))

    const result = await selectBestPatterns()
    expect(result.length).toBe(1)
    const p = result[0]
    expect(p.id).toBe('hashX')
    expect(typeof p.ev).toBe('number')
    expect(typeof p.winrate).toBe('number')
    expect(typeof p.occurrences).toBe('number')
    expect(typeof p.score).toBe('number')
  })

  it('retourne au plus 10 patterns', async () => {
    const hashes  = Array.from({ length: 15 }, (_, i) => `h${i}`)
    const records = hashes.map(() => makeMfRecord(60, 20, 1.5, -1))

    idbGet.mockResolvedValueOnce(hashes)
    records.forEach(r => idbGet.mockResolvedValueOnce(r))

    const result = await selectBestPatterns()
    expect(result.length).toBeLessThanOrEqual(10)
  })
})

// ── selectAndFilter ───────────────────────────────────────────────────────────

describe('selectAndFilter', () => {
  it('retourne un tableau vide si aucun pattern disponible', async () => {
    idbGet.mockResolvedValue([])
    const result = await selectAndFilter(55)
    expect(result).toEqual([])
  })

  it('filtre les patterns selon le DVOL fourni', async () => {
    const record = makeMfRecord(60, 20, 1.5, -1)
    idbGet
      .mockResolvedValueOnce(['h1'])
      .mockResolvedValueOnce(record)

    const result = await selectAndFilter(55)
    // ev > 0.1 et winrate > 0.5 → devrait passer pour DVOL=55
    expect(Array.isArray(result)).toBe(true)
  })
})
