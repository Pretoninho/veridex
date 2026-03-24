import { describe, it, expect } from 'vitest'
import {
  scoreIV,
  scoreFunding,
  scoreBasis,
  scoreIVvsRV,
  calcGlobalScore,
  getSignal,
  computeSignal,
  hashMarketState,
} from './signal_engine.js'
import { vi } from 'vitest'

// ── scoreIV ───────────────────────────────────────────────────────────────────

describe('scoreIV', () => {
  it('retourne null si dvol est null', () => {
    expect(scoreIV(null)).toBeNull()
    expect(scoreIV(undefined)).toBeNull()
  })

  const dvol = (current) => ({ current, monthMin: 40, monthMax: 80 })

  it('ratio ≥ 1.20 → 100', () => {
    // avg30 = 60, ratio = 72/60 = 1.20
    expect(scoreIV(dvol(72))).toBe(100)
  })

  it('ratio ≥ 1.10 → 75', () => {
    // ratio = 66/60 = 1.10
    expect(scoreIV(dvol(66))).toBe(75)
  })

  it('ratio ≥ 0.95 → 50', () => {
    // ratio = 57/60 = 0.95
    expect(scoreIV(dvol(57))).toBe(50)
  })

  it('ratio ≥ 0.85 → 25', () => {
    // ratio = 51/60 = 0.85
    expect(scoreIV(dvol(51))).toBe(25)
  })

  it('ratio < 0.85 → 0', () => {
    // ratio = 48/60 = 0.80
    expect(scoreIV(dvol(48))).toBe(0)
  })
})

// ── scoreFunding ──────────────────────────────────────────────────────────────

describe('scoreFunding', () => {
  it('retourne null si funding null', () => {
    expect(scoreFunding(null)).toBeNull()
    expect(scoreFunding({})).toBeNull()
  })

  const f = (r) => ({ avgAnn7d: r })

  it('≥ 30% → 100', () => { expect(scoreFunding(f(35))).toBe(100) })
  it('≥ 15% → 75',  () => { expect(scoreFunding(f(20))).toBe(75) })
  it('≥ 5%  → 50',  () => { expect(scoreFunding(f(8))).toBe(50) })
  it('≥ 0%  → 25',  () => { expect(scoreFunding(f(0))).toBe(25) })
  it('< 0%  → 0',   () => { expect(scoreFunding(f(-5))).toBe(0) })

  it('accepte aussi rateAnn', () => {
    expect(scoreFunding({ rateAnn: 35 })).toBe(100)
  })
})

// ── scoreBasis ────────────────────────────────────────────────────────────────

describe('scoreBasis', () => {
  it('retourne null si basisAvg null', () => {
    expect(scoreBasis(null)).toBeNull()
  })

  it('≥ 15 → 100', () => { expect(scoreBasis(20)).toBe(100) })
  it('≥ 8  → 75',  () => { expect(scoreBasis(10)).toBe(75) })
  it('≥ 3  → 50',  () => { expect(scoreBasis(5)).toBe(50) })
  it('≥ 0  → 25',  () => { expect(scoreBasis(0)).toBe(25) })
  it('< 0  → 0',   () => { expect(scoreBasis(-1)).toBe(0) })
})

// ── scoreIVvsRV ───────────────────────────────────────────────────────────────

describe('scoreIVvsRV', () => {
  it('retourne null si dvol ou rv null', () => {
    expect(scoreIVvsRV(null, { current: 30 })).toBeNull()
    expect(scoreIVvsRV({ current: 60 }, null)).toBeNull()
  })

  it('premium ≥ 20 → 100', () => {
    expect(scoreIVvsRV({ current: 70 }, { current: 40 })).toBe(100)
  })

  it('premium ≥ 10 → 75', () => {
    expect(scoreIVvsRV({ current: 60 }, { current: 45 })).toBe(75)
  })

  it('premium ≥ 0 → 50', () => {
    expect(scoreIVvsRV({ current: 50 }, { current: 50 })).toBe(50)
  })

  it('premium < 0 → 0 (RV > IV)', () => {
    expect(scoreIVvsRV({ current: 40 }, { current: 60 })).toBe(0)
  })
})

// ── calcGlobalScore ───────────────────────────────────────────────────────────

describe('calcGlobalScore', () => {
  it('retourne null si tous les scores sont null', () => {
    expect(calcGlobalScore(null, null, null, null)).toBeNull()
  })

  it('utilise uniquement les composantes non-null (redistribution des poids)', () => {
    // Avec seulement s1=100 (poids 35/35 = 100%)
    expect(calcGlobalScore(100, null, null, null)).toBe(100)
    // Avec seulement s2=100 (poids 25/25 = 100%)
    expect(calcGlobalScore(null, 100, null, null)).toBe(100)
  })

  it('calcul pondéré correct avec 4 composantes', () => {
    // 100*35 + 75*25 + 50*25 + 25*15 = 3500 + 1875 + 1250 + 375 = 7000 / 100 = 70
    expect(calcGlobalScore(100, 75, 50, 25)).toBe(70)
  })

  it('calcul pondéré correct avec 2 composantes', () => {
    // s1=100 (35) + s3=50 (25) → (3500 + 1250) / 60 ≈ 79.17 → arrondi 79
    expect(calcGlobalScore(100, null, 50, null)).toBe(79)
  })

  it('résultat ∈ [0, 100]', () => {
    expect(calcGlobalScore(0, 0, 0, 0)).toBe(0)
    expect(calcGlobalScore(100, 100, 100, 100)).toBe(100)
  })
})

// ── getSignal ─────────────────────────────────────────────────────────────────

describe('getSignal', () => {
  it('retourne null si score null', () => {
    expect(getSignal(null)).toBeNull()
  })

  it('≥ 80 → Exceptionnel', () => {
    const s = getSignal(80)
    expect(s.label).toContain('Exceptionnel')
    expect(s.action).toContain('exceptionnelles')
  })

  it('60-79 → Favorable', () => {
    expect(getSignal(60).label).toContain('Favorable')
  })

  it('40-59 → Neutre', () => {
    expect(getSignal(40).label).toContain('Neutre')
  })

  it('< 40 → Défavorable', () => {
    expect(getSignal(39).label).toContain('Défavorable')
    expect(getSignal(0).label).toContain('Défavorable')
  })

  it('retourne bg et border (couleurs CSS)', () => {
    const s = getSignal(80)
    expect(s.bg).toBeTruthy()
    expect(s.border).toBeTruthy()
    expect(s.color).toMatch(/^var\(--/)
  })
})

// ── computeSignal ─────────────────────────────────────────────────────────────

describe('computeSignal', () => {
  it('calcule le signal complet à partir de données réelles', () => {
    const dvol    = { current: 72, monthMin: 40, monthMax: 80 }
    const funding = { avgAnn7d: 20 }
    const rv      = { current: 45 }
    const basisAvg = 12

    const result = computeSignal({ dvol, funding, rv, basisAvg })

    expect(result.scores.s1).toBe(100) // ratio ≥ 1.20
    expect(result.scores.s2).toBe(75)  // 20% ≥ 15
    expect(result.scores.s3).toBe(75)  // 12% ≥ 8
    expect(result.scores.s4).toBe(100) // premium = 72-45 = 27 ≥ 20 → 100
    expect(result.global).toBeGreaterThan(70)
    expect(result.signal).not.toBeNull()
    expect(result.signal.label).toContain('Exceptionnel')
  })

  it('gère les données partielles (null)', () => {
    const result = computeSignal({ dvol: null, funding: null, rv: null, basisAvg: null })
    expect(result.global).toBeNull()
    expect(result.signal).toBeNull()
  })
})

// ── _hashSignal — payload étendu ──────────────────────────────────────────────

// saveSignal n'est pas testé directement (IndexedDB), mais on teste la cohérence
// du hashMarketState et on vérifie que les champs de contexte n'introduisent pas
// de régression dans hashMarketState.

describe('hashMarketState — déterminisme', () => {
  it('mêmes inputs → même hash', () => {
    const inputs = { dvol: { current: 72, monthMin: 40, monthMax: 80 }, funding: { rateAnn: 15 }, rv: { current: 45 }, basisAvg: 10 }
    expect(hashMarketState(inputs)).toBe(hashMarketState(inputs))
  })

  it('inputs différents → hashes différents', () => {
    const a = { dvol: { current: 72, monthMin: 40, monthMax: 80 }, funding: { rateAnn: 15 }, rv: { current: 45 }, basisAvg: 10 }
    const b = { dvol: { current: 50, monthMin: 40, monthMax: 80 }, funding: { rateAnn: 5  }, rv: { current: 45 }, basisAvg: 5  }
    expect(hashMarketState(a)).not.toBe(hashMarketState(b))
  })

  it('retourne une chaîne non vide', () => {
    expect(typeof hashMarketState({})).toBe('string')
    expect(hashMarketState({}).length).toBeGreaterThan(0)
  })
})
