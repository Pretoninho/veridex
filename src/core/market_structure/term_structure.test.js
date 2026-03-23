import { describe, it, expect } from 'vitest'
import {
  calcBasis,
  annualizeBasis,
  calcDIRateSimple,
  analyzeTermStructure,
  calcTermStructureSignal,
  findBestDIExpiry,
} from './term_structure.js'

// ── calcBasis ─────────────────────────────────────────────────────────────────

describe('calcBasis', () => {
  it('contango : futures > spot → basis positif', () => {
    expect(calcBasis(51000, 50000)).toBeCloseTo(2, 5)
  })

  it('backwardation : futures < spot → basis négatif', () => {
    expect(calcBasis(49000, 50000)).toBeCloseTo(-2, 5)
  })

  it('basis = 0 si futures = spot', () => {
    expect(calcBasis(50000, 50000)).toBe(0)
  })

  it('retourne 0 si spot = 0', () => {
    expect(calcBasis(50000, 0)).toBe(0)
  })
})

// ── annualizeBasis ────────────────────────────────────────────────────────────

describe('annualizeBasis', () => {
  it('annualise correctement pour 30 jours', () => {
    // 2% / 30j * 365 ≈ 24.33% /an
    expect(annualizeBasis(2, 30)).toBeCloseTo(24.33, 1)
  })

  it('annualise correctement pour 7 jours', () => {
    expect(annualizeBasis(1, 7)).toBeCloseTo(52.14, 1)
  })

  it('retourne null si days <= 0', () => {
    expect(annualizeBasis(2, 0)).toBeNull()
    expect(annualizeBasis(2, -1)).toBeNull()
  })

  it('retourne null si days non-fini', () => {
    expect(annualizeBasis(2, NaN)).toBeNull()
  })
})

// ── calcDIRateSimple ──────────────────────────────────────────────────────────

describe('calcDIRateSimple', () => {
  it('retourne null si iv = 0 ou null', () => {
    expect(calcDIRateSimple(0, 7)).toBeNull()
    expect(calcDIRateSimple(null, 7)).toBeNull()
  })

  it('retourne null si days = 0 ou null', () => {
    expect(calcDIRateSimple(65, 0)).toBeNull()
    expect(calcDIRateSimple(65, null)).toBeNull()
  })

  it('retourne un taux positif pour des entrées normales', () => {
    const rate = calcDIRateSimple(65, 7)
    expect(rate).toBeGreaterThan(0)
  })

  it('taux plus élevé avec IV plus haute', () => {
    expect(calcDIRateSimple(80, 7)).toBeGreaterThan(calcDIRateSimple(40, 7))
  })
})

// ── analyzeTermStructure ──────────────────────────────────────────────────────

describe('analyzeTermStructure', () => {
  const makeRow = (days, basisAnn, isPerp = false) =>
    ({ instrument: `BTC-${days}D`, days, basisAnn, isPerp })

  it('détecte contango si avgBasisAnn > 0.5', () => {
    const rows = [makeRow(7, 10), makeRow(14, 20), makeRow(30, 15)]
    const result = analyzeTermStructure(rows)
    expect(result.structure).toBe('contango')
  })

  it('détecte backwardation si avgBasisAnn < -0.5', () => {
    const rows = [makeRow(7, -10), makeRow(14, -8)]
    const result = analyzeTermStructure(rows)
    expect(result.structure).toBe('backwardation')
  })

  it('détecte flat si avgBasisAnn ∈ [-0.5, 0.5]', () => {
    const rows = [makeRow(7, 0.1), makeRow(14, -0.1)]
    const result = analyzeTermStructure(rows)
    expect(result.structure).toBe('flat')
  })

  it('ignore les rows perpetuels (isPerp=true)', () => {
    const rows = [makeRow(null, null, true), makeRow(7, 15)]
    const result = analyzeTermStructure(rows)
    expect(result.structure).toBe('contango')
    expect(result.dated).toHaveLength(1)
  })

  it('retourne flat et nulls si aucune row datée', () => {
    const rows = [makeRow(null, null, true)]
    const result = analyzeTermStructure(rows)
    expect(result.structure).toBe('flat')
    expect(result.avgBasisAnn).toBeNull()
  })

  it('calcule avgBasisAnn, maxBasisAnn, minBasisAnn', () => {
    const rows = [makeRow(7, 10), makeRow(14, 20)]
    const result = analyzeTermStructure(rows)
    expect(result.avgBasisAnn).toBe(15)
    expect(result.maxBasisAnn).toBe(20)
    expect(result.minBasisAnn).toBe(10)
  })
})

// ── calcTermStructureSignal ───────────────────────────────────────────────────

describe('calcTermStructureSignal', () => {
  it('retourne données insuffisantes si avgBasisAnn = null', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: null, structure: 'flat' }, 0)
    expect(result.strength).toBe('neutral')
    expect(result.signal).toContain('insuffisantes')
  })

  it('contango + funding > 10 → signal fort Sell High + Short Perp', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: 15, structure: 'contango' }, 15)
    expect(result.strength).toBe('strong')
    expect(result.signal).toContain('Sell High')
    expect(result.signal).toContain('Perp')
  })

  it('contango + funding ∈ (0, 10] → signal modéré Sell High', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: 15, structure: 'contango' }, 5)
    expect(result.strength).toBe('moderate')
    expect(result.signal).toContain('Sell High')
  })

  it('backwardation + funding < 0 → signal fort Buy Low + Long Perp', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: -10, structure: 'backwardation' }, -8)
    expect(result.strength).toBe('strong')
    expect(result.signal).toContain('Buy Low')
    expect(result.signal).toContain('Perp')
  })

  it('backwardation seule → signal modéré Buy Low', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: -10, structure: 'backwardation' }, 2)
    expect(result.strength).toBe('moderate')
    expect(result.signal).toContain('Buy Low')
  })

  it('flat → marché neutre', () => {
    const result = calcTermStructureSignal({ avgBasisAnn: 0.1, structure: 'flat' }, 0)
    expect(result.strength).toBe('neutral')
    expect(result.signal).toContain('neutre')
  })
})

// ── findBestDIExpiry ──────────────────────────────────────────────────────────

describe('findBestDIExpiry', () => {
  it('retourne null si aucune row datée avec diRate', () => {
    const rows = [{ isPerp: true, diRate: null, basisAnn: null }]
    expect(findBestDIExpiry(rows)).toBeNull()
  })

  it('sélectionne la row avec diRate + |basisAnn| le plus élevé', () => {
    const rows = [
      { isPerp: false, diRate: 10, basisAnn: 5, instrument: 'A' },
      { isPerp: false, diRate: 20, basisAnn: 8, instrument: 'B' },
      { isPerp: false, diRate: 15, basisAnn: 2, instrument: 'C' },
    ]
    const best = findBestDIExpiry(rows)
    // B : 20 + 8 = 28 > A : 10+5=15 > C : 15+2=17
    expect(best.instrument).toBe('B')
  })

  it('ignore les rows perpetuelles', () => {
    const rows = [
      { isPerp: true,  diRate: 100, basisAnn: 100, instrument: 'PERP' },
      { isPerp: false, diRate: 10,  basisAnn: 5,   instrument: 'A' },
    ]
    expect(findBestDIExpiry(rows).instrument).toBe('A')
  })
})
