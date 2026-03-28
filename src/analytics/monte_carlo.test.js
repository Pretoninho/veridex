import { describe, it, expect } from 'vitest'
import { monteCarlo } from './monte_carlo.js'

describe('monteCarlo', () => {
  it('retourne un tableau de la taille demandée', () => {
    const results = monteCarlo([{ pnl: 100 }, { pnl: -50 }], 500)
    expect(results).toHaveLength(500)
  })

  it('utilise 1000 itérations par défaut', () => {
    const results = monteCarlo([{ pnl: 100 }])
    expect(results).toHaveLength(1000)
  })

  it('retourne 1000 × 10000 pour zéro trades', () => {
    const results = monteCarlo([], 1000)
    expect(results).toHaveLength(1000)
    results.forEach(r => expect(r).toBe(10000))
  })

  it('accepte un tableau de trades vide', () => {
    expect(monteCarlo([], 10)).toHaveLength(10)
  })

  it('les balances finales sont des nombres finis', () => {
    const results = monteCarlo([{ pnl: 200 }, { pnl: -100 }, { pnl: 150 }], 200)
    results.forEach(r => expect(Number.isFinite(r)).toBe(true))
  })

  it('la distribution est non-constante avec des P&L non nuls', () => {
    const results = monteCarlo([{ pnl: 1000 }, { pnl: -1000 }], 500)
    const unique = new Set(results.map(v => Math.round(v)))
    // Avec 500 simulations et des P&L aléatoires, on doit avoir plusieurs valeurs distinctes
    expect(unique.size).toBeGreaterThan(1)
  })

  it('balance de départ est 10000', () => {
    // Avec 1 trade pnl=0, toutes les balances = 10000
    const results = monteCarlo([{ pnl: 0 }], 100)
    results.forEach(r => expect(r).toBe(10000))
  })
})
