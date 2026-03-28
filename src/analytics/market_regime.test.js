import { describe, it, expect } from 'vitest'
import { detectMarketRegime } from './market_regime.js'

describe('detectMarketRegime', () => {
  it('retourne neutral_unknown sans données', () => {
    expect(detectMarketRegime()).toBe('neutral_unknown')
    expect(detectMarketRegime({})).toBe('neutral_unknown')
  })

  it('retourne neutral_medium si price manquant mais dvol fourni', () => {
    expect(detectMarketRegime({ ma50: 50000, ma200: 48000, dvol: 45 })).toBe('neutral_medium')
  })

  it('retourne neutral_low avec dvol bas mais sans trend', () => {
    expect(detectMarketRegime({ dvol: 30 })).toBe('neutral_low')
  })

  it('détecte bull + low vol', () => {
    expect(detectMarketRegime({ price: 60_000, ma50: 58_000, ma200: 50_000, dvol: 35 }))
      .toBe('bull_low')
  })

  it('détecte bull + medium vol', () => {
    expect(detectMarketRegime({ price: 60_000, ma50: 58_000, ma200: 50_000, dvol: 55 }))
      .toBe('bull_medium')
  })

  it('détecte bull + high vol', () => {
    expect(detectMarketRegime({ price: 60_000, ma50: 58_000, ma200: 50_000, dvol: 80 }))
      .toBe('bull_high')
  })

  it('détecte bear + low vol', () => {
    expect(detectMarketRegime({ price: 30_000, ma50: 32_000, ma200: 45_000, dvol: 25 }))
      .toBe('bear_low')
  })

  it('détecte bear + high vol', () => {
    expect(detectMarketRegime({ price: 30_000, ma50: 32_000, ma200: 45_000, dvol: 75 }))
      .toBe('bear_high')
  })

  it('retourne bull_unknown quand dvol est null mais price > ma200', () => {
    expect(detectMarketRegime({ price: 60_000, ma50: 58_000, ma200: 50_000, dvol: null }))
      .toBe('bull_unknown')
  })

  it('retourne sideways quand price === ma200', () => {
    const regime = detectMarketRegime({ price: 50_000, ma50: 50_000, ma200: 50_000, dvol: 55 })
    expect(regime).toBe('sideways_medium')
  })
})
