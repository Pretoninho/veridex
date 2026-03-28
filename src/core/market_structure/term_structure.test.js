import { describe, it, expect } from 'vitest'
import {
  calcBasis,
  annualizeBasis,
  analyzeTermStructure,
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
