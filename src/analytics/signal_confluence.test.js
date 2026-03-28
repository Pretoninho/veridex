import { describe, it, expect } from 'vitest'
import { computeConfluence } from './signal_confluence.js'

describe('computeConfluence', () => {
  it('retourne 0 pour un tableau vide', () => {
    expect(computeConfluence([])).toBe(0)
  })

  it('retourne 0 sans argument', () => {
    expect(computeConfluence()).toBe(0)
  })

  it('compte les BUY positivement', () => {
    expect(computeConfluence([{ signal: 'BUY' }, { signal: 'BUY' }])).toBe(2)
  })

  it('compte les SELL négativement', () => {
    expect(computeConfluence([{ signal: 'SELL' }, { signal: 'SELL' }])).toBe(-2)
  })

  it('soustrait SELL des BUY', () => {
    expect(computeConfluence([
      { signal: 'BUY' },
      { signal: 'BUY' },
      { signal: 'SELL' },
    ])).toBe(1)
  })

  it('retourne 0 pour signaux équilibrés', () => {
    expect(computeConfluence([
      { signal: 'BUY' },
      { signal: 'SELL' },
    ])).toBe(0)
  })

  it('ignore les signaux inconnus (HOLD, NEUTRAL, etc.)', () => {
    expect(computeConfluence([
      { signal: 'HOLD' },
      { signal: 'NEUTRAL' },
      { signal: 'BUY' },
    ])).toBe(1)
  })

  it('retourne une valeur négative en majorité SELL', () => {
    const score = computeConfluence([
      { signal: 'SELL' },
      { signal: 'SELL' },
      { signal: 'SELL' },
      { signal: 'BUY' },
    ])
    expect(score).toBe(-2)
  })
})
