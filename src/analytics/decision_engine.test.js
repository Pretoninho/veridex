import { describe, it, expect } from 'vitest'
import { buildTrade } from './decision_engine.js'

describe('buildTrade', () => {
  it('retourne null pour un signal NEUTRAL', () => {
    expect(buildTrade({ signal: 'NEUTRAL', score: 50, confidence: 0.5 }, 50000)).toBeNull()
  })

  it('retourne null pour NO_DATA', () => {
    expect(buildTrade({ signal: 'NO_DATA' }, 50000)).toBeNull()
  })

  it('retourne null pour NO_STATS', () => {
    expect(buildTrade({ signal: 'NO_STATS' }, 50000)).toBeNull()
  })

  it('retourne null pour signal null', () => {
    expect(buildTrade(null, 50000)).toBeNull()
  })

  it('retourne null pour prix invalide (0)', () => {
    expect(buildTrade({ signal: 'LONG' }, 0)).toBeNull()
  })

  it('retourne null pour prix négatif', () => {
    expect(buildTrade({ signal: 'LONG' }, -100)).toBeNull()
  })

  it('retourne null pour prix NaN', () => {
    expect(buildTrade({ signal: 'LONG' }, NaN)).toBeNull()
  })

  it('construit un trade LONG correctement', () => {
    const trade = buildTrade({ signal: 'LONG', score: 80, confidence: 0.9 }, 100_000)
    expect(trade).not.toBeNull()
    expect(trade.direction).toBe('LONG')
    expect(trade.entry).toBe(100_000)
    // SL = entry * (1 - 1/100) = 99000
    expect(trade.sl).toBeCloseTo(99_000)
    // TP = entry * (1 + 2/100) = 102000
    expect(trade.tp).toBeCloseTo(102_000)
    expect(trade.rr).toBe(2)
  })

  it('construit un trade SHORT correctement', () => {
    const trade = buildTrade({ signal: 'SHORT', score: 20, confidence: 0.8 }, 50_000)
    expect(trade).not.toBeNull()
    expect(trade.direction).toBe('SHORT')
    expect(trade.entry).toBe(50_000)
    // SL = entry * (1 + 1/100) = 50500
    expect(trade.sl).toBeCloseTo(50_500)
    // TP = entry * (1 - 2/100) = 49000
    expect(trade.tp).toBeCloseTo(49_000)
    expect(trade.rr).toBe(2)
  })

  it('SL est en dessous du entry pour LONG', () => {
    const trade = buildTrade({ signal: 'LONG' }, 30_000)
    expect(trade.sl).toBeLessThan(trade.entry)
  })

  it('TP est au-dessus du entry pour LONG', () => {
    const trade = buildTrade({ signal: 'LONG' }, 30_000)
    expect(trade.tp).toBeGreaterThan(trade.entry)
  })

  it('SL est au-dessus du entry pour SHORT', () => {
    const trade = buildTrade({ signal: 'SHORT' }, 30_000)
    expect(trade.sl).toBeGreaterThan(trade.entry)
  })

  it('TP est en dessous du entry pour SHORT', () => {
    const trade = buildTrade({ signal: 'SHORT' }, 30_000)
    expect(trade.tp).toBeLessThan(trade.entry)
  })
})
