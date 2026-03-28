import { describe, it, expect } from 'vitest'
import { riskOfRuin } from './risk.js'

describe('riskOfRuin', () => {
  it('retourne 1 pour un winrate ≤ 0.5', () => {
    expect(riskOfRuin(0.5, 100, 10000)).toBe(1)
    expect(riskOfRuin(0.3, 100, 10000)).toBe(1)
    expect(riskOfRuin(0,   100, 10000)).toBe(1)
  })

  it('retourne une valeur entre 0 et 1 pour un edge positif', () => {
    const ror = riskOfRuin(0.6, 100, 10000)
    expect(ror).toBeGreaterThan(0)
    expect(ror).toBeLessThan(1)
  })

  it('risque diminue quand le capital augmente', () => {
    const ror1 = riskOfRuin(0.6, 100, 5000)
    const ror2 = riskOfRuin(0.6, 100, 10000)
    expect(ror2).toBeLessThan(ror1)
  })

  it('risque diminue quand le winrate augmente', () => {
    const ror1 = riskOfRuin(0.55, 100, 10000)
    const ror2 = riskOfRuin(0.70, 100, 10000)
    expect(ror2).toBeLessThan(ror1)
  })

  it('risque augmente quand le montant risqué par trade augmente', () => {
    const ror1 = riskOfRuin(0.6, 50,  10000)
    const ror2 = riskOfRuin(0.6, 200, 10000)
    expect(ror2).toBeGreaterThan(ror1)
  })

  it('formule exacte pour des valeurs connues', () => {
    // edge = 0.6 - 0.4 = 0.2, capital/risk = 100/100 = 1
    // résultat = exp(-2 * 0.2 * 1) = exp(-0.4)
    const expected = Math.exp(-0.4)
    expect(riskOfRuin(0.6, 100, 100)).toBeCloseTo(expected, 10)
  })

  it('retourne une valeur proche de 0 pour un grand capital', () => {
    expect(riskOfRuin(0.7, 100, 1_000_000)).toBeCloseTo(0, 5)
  })
})
