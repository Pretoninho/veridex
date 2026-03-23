import { describe, it, expect } from 'vitest'
import { calcSkew25d, calcSmile, interpretSkew } from './skew.js'

// ── calcSkew25d ───────────────────────────────────────────────────────────────

describe('calcSkew25d', () => {
  it('retourne null si une des valeurs est non-finie', () => {
    expect(calcSkew25d(NaN, 60)).toBeNull()
    expect(calcSkew25d(65, NaN)).toBeNull()
    expect(calcSkew25d(null, 60)).toBeNull()
  })

  it('calcule le skew correctement : call IV - put IV', () => {
    const result = calcSkew25d(65, 70)
    expect(result.skew).toBe(-5) // call < put → put skew
  })

  it('skew positif → call skew (FOMO)', () => {
    const result = calcSkew25d(75, 65)
    expect(result.skew).toBe(10)
    expect(result.direction).toBe('call')
  })

  it('skew négatif fort → put skew', () => {
    const result = calcSkew25d(55, 70)
    expect(result.skew).toBe(-15)
    expect(result.direction).toBe('put')
  })

  it('skew ≈ 0 → symmetric', () => {
    const result = calcSkew25d(60, 61)
    expect(result.direction).toBe('symmetric')
  })

  it('retourne label non-vide', () => {
    const result = calcSkew25d(65, 70)
    expect(result.label).toBeTruthy()
    expect(typeof result.label).toBe('string')
  })
})

// ── calcSmile ─────────────────────────────────────────────────────────────────

describe('calcSmile', () => {
  it('retourne null si une valeur est non-finie', () => {
    expect(calcSmile(NaN, 70)).toBeNull()
    expect(calcSmile(65, NaN)).toBeNull()
  })

  it('wings > ATM → smile positif', () => {
    expect(calcSmile(60, 70)).toBe(10)
  })

  it('wings < ATM → smile négatif', () => {
    expect(calcSmile(70, 60)).toBe(-10)
  })

  it('smile = 0 si wings = ATM', () => {
    expect(calcSmile(65, 65)).toBe(0)
  })
})

// ── interpretSkew ─────────────────────────────────────────────────────────────

describe('interpretSkew', () => {
  it('retourne Inconnu si null', () => {
    expect(interpretSkew(null).sentiment).toBe('Inconnu')
  })

  it('>5 → FOMO fort', () => {
    expect(interpretSkew(6).sentiment).toContain('FOMO')
  })

  it('2 à 5 → Léger call bias', () => {
    expect(interpretSkew(3).sentiment).toContain('call')
  })

  it('-2 à 2 → Marché équilibré', () => {
    expect(interpretSkew(0).sentiment).toContain('équilibré')
  })

  it('-5 à -2 → Protection modérée', () => {
    expect(interpretSkew(-3).sentiment).toContain('Protection')
  })

  it('≤-5 → Protection élevée / stress', () => {
    expect(interpretSkew(-6).sentiment).toContain('stress')
  })

  it('retourne une couleur CSS pour chaque cas', () => {
    for (const v of [10, 3, 0, -3, -10]) {
      expect(interpretSkew(v).color).toMatch(/^var\(--/)
    }
  })
})
