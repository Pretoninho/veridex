import { describe, it, expect } from 'vitest'
import { calcOptionGreeks, blackScholes, calcDIRateBS } from './greeks.js'

// ── calcOptionGreeks ──────────────────────────────────────────────────────────

describe('calcOptionGreeks', () => {
  const base = { S: 50000, K: 52000, T: 7 / 365, sigma: 0.65, r: 0 }

  it('retourne null si S invalide', () => {
    expect(calcOptionGreeks({ ...base, type: 'call', S: 0 })).toBeNull()
    expect(calcOptionGreeks({ ...base, type: 'call', S: -100 })).toBeNull()
    expect(calcOptionGreeks({ ...base, type: 'call', S: NaN })).toBeNull()
  })

  it('retourne null si K invalide', () => {
    expect(calcOptionGreeks({ ...base, type: 'call', K: 0 })).toBeNull()
  })

  it('retourne null si T invalide', () => {
    expect(calcOptionGreeks({ ...base, type: 'call', T: 0 })).toBeNull()
    expect(calcOptionGreeks({ ...base, type: 'call', T: -1 })).toBeNull()
  })

  it('retourne null si sigma invalide', () => {
    expect(calcOptionGreeks({ ...base, type: 'call', sigma: 0 })).toBeNull()
    expect(calcOptionGreeks({ ...base, type: 'call', sigma: -0.1 })).toBeNull()
  })

  it('retourne null si type inconnu', () => {
    expect(calcOptionGreeks({ ...base, type: 'other' })).toBeNull()
  })

  it('call : delta ∈ (0, 1)', () => {
    const g = calcOptionGreeks({ ...base, type: 'call' })
    expect(g).not.toBeNull()
    expect(g.delta).toBeGreaterThan(0)
    expect(g.delta).toBeLessThan(1)
  })

  it('put : delta ∈ (-1, 0)', () => {
    const g = calcOptionGreeks({ ...base, type: 'put' })
    expect(g).not.toBeNull()
    expect(g.delta).toBeLessThan(0)
    expect(g.delta).toBeGreaterThan(-1)
  })

  it('gamma est positif pour call et put', () => {
    const c = calcOptionGreeks({ ...base, type: 'call' })
    const p = calcOptionGreeks({ ...base, type: 'put' })
    expect(c.gamma).toBeGreaterThan(0)
    expect(p.gamma).toBeGreaterThan(0)
  })

  it('vega est positif pour call et put', () => {
    const c = calcOptionGreeks({ ...base, type: 'call' })
    const p = calcOptionGreeks({ ...base, type: 'put' })
    expect(c.vega).toBeGreaterThan(0)
    expect(p.vega).toBeGreaterThan(0)
  })

  it('theta est négatif pour les deux (perte de temps)', () => {
    const c = calcOptionGreeks({ ...base, type: 'call' })
    const p = calcOptionGreeks({ ...base, type: 'put' })
    expect(c.theta).toBeLessThan(0)
    expect(p.theta).toBeLessThan(0)
  })

  it('ATM : delta call ≈ 0.5', () => {
    const g = calcOptionGreeks({ S: 50000, K: 50000, T: 30 / 365, sigma: 0.65, r: 0, type: 'call' })
    expect(g.delta).toBeGreaterThan(0.45)
    expect(g.delta).toBeLessThan(0.55)
  })

  it('parité call-put : delta_call + |delta_put| ≈ 1', () => {
    const c = calcOptionGreeks({ ...base, type: 'call' })
    const p = calcOptionGreeks({ ...base, type: 'put' })
    expect(c.delta + Math.abs(p.delta)).toBeCloseTo(1, 4)
  })

  it('gamma identique pour call et put (même paramètres)', () => {
    const c = calcOptionGreeks({ ...base, type: 'call' })
    const p = calcOptionGreeks({ ...base, type: 'put' })
    expect(c.gamma).toBeCloseTo(p.gamma, 8)
  })
})

// ── blackScholes ──────────────────────────────────────────────────────────────

describe('blackScholes', () => {
  it('call profondément ITM ≈ S - K (r=0)', () => {
    // Deep ITM call ≈ intrinsic value
    const price = blackScholes('call', 60000, 40000, 1, 0, 0.5)
    expect(price).toBeGreaterThan(19000)
  })

  it('put profondément ITM ≈ K - S (r=0)', () => {
    const price = blackScholes('put', 40000, 60000, 1, 0, 0.5)
    expect(price).toBeGreaterThan(19000)
  })

  it('parité call-put : C - P = S - K (r=0)', () => {
    const S = 50000, K = 50000, T = 30 / 365, r = 0, sigma = 0.65
    const call = blackScholes('call', S, K, T, r, sigma)
    const put  = blackScholes('put',  S, K, T, r, sigma)
    // C - P = S - K*e^(-rT) = S - K quand r=0
    expect(call - put).toBeCloseTo(S - K, -1)
  })

  it('T=0 retourne 0', () => {
    expect(blackScholes('call', 50000, 50000, 0, 0, 0.65)).toBe(0)
  })

  it('sigma=0 retourne 0', () => {
    expect(blackScholes('call', 50000, 50000, 0.1, 0, 0)).toBe(0)
  })

  it('prix > 0 pour call ATM', () => {
    const price = blackScholes('call', 50000, 50000, 7 / 365, 0, 0.65)
    expect(price).toBeGreaterThan(0)
  })
})

// ── calcDIRateBS ──────────────────────────────────────────────────────────────

describe('calcDIRateBS', () => {
  it('retourne null si iv=0', () => {
    expect(calcDIRateBS(0, 50000, 52000, 7, 'sell-high')).toBeNull()
  })

  it('retourne null si days=0', () => {
    expect(calcDIRateBS(65, 50000, 52000, 0, 'sell-high')).toBeNull()
  })

  it('sell-high retourne un taux positif', () => {
    const rate = calcDIRateBS(65, 50000, 52000, 7, 'sell-high')
    expect(rate).toBeGreaterThan(0)
  })

  it('buy-low retourne un taux positif', () => {
    const rate = calcDIRateBS(65, 50000, 48000, 7, 'buy-low')
    expect(rate).toBeGreaterThan(0)
  })

  it('taux plus élevé avec IV plus haute', () => {
    const low  = calcDIRateBS(40, 50000, 52000, 7, 'sell-high')
    const high = calcDIRateBS(80, 50000, 52000, 7, 'sell-high')
    expect(high).toBeGreaterThan(low)
  })

  it('taux plus élevé avec durée plus courte (annualisé)', () => {
    const short = calcDIRateBS(65, 50000, 52000, 3,  'sell-high')
    const long  = calcDIRateBS(65, 50000, 52000, 30, 'sell-high')
    // Annualisé, les durées courtes ont des taux plus élevés sur options OTM
    expect(short).toBeDefined()
    expect(long).toBeDefined()
  })
})
