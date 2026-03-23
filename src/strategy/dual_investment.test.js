import { describe, it, expect } from 'vitest'
import {
  calcDays,
  calcPremiumNative,
  calcPremiumUSD,
  calcPremium,
  marketPremiumPct,
  diScoreBS,
  diScore,
  scoreLabel,
  calcPnL,
  countdown,
  fmtUSD,
  fmtStrike,
  fmtDuration,
} from './dual_investment.js'

// ── calcDays ──────────────────────────────────────────────────────────────────

describe('calcDays', () => {
  it('retourne null si une des dates est manquante', () => {
    expect(calcDays(null, '2026-03-30')).toBeNull()
    expect(calcDays('2026-03-20', null)).toBeNull()
  })

  it('retourne exactement 10 jours pour 10 jours d\'écart', () => {
    const sub = '2026-03-20T00:00:00.000Z'
    const set = '2026-03-30T00:00:00.000Z'
    expect(calcDays(sub, set)).toBeCloseTo(10, 5)
  })

  it('retourne une fraction pour un écart d\'heures', () => {
    const sub = '2026-03-20T00:00:00.000Z'
    const set = '2026-03-20T12:00:00.000Z'
    expect(calcDays(sub, set)).toBeCloseTo(0.5, 5)
  })
})

// ── calcPremiumNative ─────────────────────────────────────────────────────────

describe('calcPremiumNative', () => {
  it('retourne null si un paramètre est manquant', () => {
    expect(calcPremiumNative(0, 7, 1)).toBeNull()
    expect(calcPremiumNative(15, 0, 1)).toBeNull()
    expect(calcPremiumNative(15, 7, 0)).toBeNull()
  })

  it('calcule correctement la prime native', () => {
    // 15% annuel, 7 jours, 1 BTC → 1 * 0.15 * (7/365) ≈ 0.002877
    const prime = calcPremiumNative(15, 7, 1)
    expect(prime).toBeCloseTo(0.002877, 4)
  })

  it('prime proportionnelle à la quantité', () => {
    const x1 = calcPremiumNative(15, 7, 1)
    const x2 = calcPremiumNative(15, 7, 2)
    expect(x2).toBeCloseTo(x1 * 2, 8)
  })
})

// ── calcPremiumUSD ────────────────────────────────────────────────────────────

describe('calcPremiumUSD', () => {
  it('retourne null si un paramètre est nul', () => {
    expect(calcPremiumUSD(15, 0, 1000)).toBeNull()
  })

  it('calcule correctement la prime USD', () => {
    // 15% annuel, 7 jours, $10000 → 10000 * 0.15 * (7/365) ≈ $28.77
    const prime = calcPremiumUSD(15, 7, 10000)
    expect(prime).toBeCloseTo(28.77, 1)
  })
})

// ── calcPremium (legacy) ──────────────────────────────────────────────────────

describe('calcPremium', () => {
  it('retourne null si amount <= 0', () => {
    expect(calcPremium(15, 7, 0)).toBeNull()
    expect(calcPremium(15, 7, -100)).toBeNull()
  })

  it('cohérent avec calcPremiumUSD', () => {
    const legacy = calcPremium(15, 7, 10000)
    const modern = calcPremiumUSD(15, 7, 10000)
    expect(legacy).toBeCloseTo(modern, 8)
  })
})

// ── marketPremiumPct ──────────────────────────────────────────────────────────

describe('marketPremiumPct', () => {
  it('retourne null si ivPct null ou days <= 0', () => {
    expect(marketPremiumPct(null, 7)).toBeNull()
    expect(marketPremiumPct(65, 0)).toBeNull()
  })

  it('retourne une valeur positive pour des entrées normales', () => {
    expect(marketPremiumPct(65, 7)).toBeGreaterThan(0)
  })

  it('premium plus élevé avec IV plus haute', () => {
    expect(marketPremiumPct(80, 7)).toBeGreaterThan(marketPremiumPct(40, 7))
  })
})

// ── diScore ───────────────────────────────────────────────────────────────────

describe('diScore', () => {
  it('retourne null si ivPct null', () => {
    expect(diScore(15, null, 7)).toBeNull()
  })

  it('ratio > 1 si taux DI bien supérieur au marché', () => {
    // nexoRatePct=200 >> marché théorique (~13% ann. avec IV=30 sur 7j)
    const score = diScore(200, 30, 7)
    expect(score).toBeGreaterThan(1)
  })

  it('ratio est plafonné à 1.5', () => {
    const score = diScore(200, 30, 7)
    expect(score).toBeLessThanOrEqual(1.5)
  })
})

// ── diScoreBS ─────────────────────────────────────────────────────────────────

describe('diScoreBS', () => {
  it('retourne null si iv ou days manquant', () => {
    expect(diScoreBS(15, 0, 7, 50000, 52000, 'sell-high')).toBeNull()
    expect(diScoreBS(15, 65, 0, 50000, 52000, 'sell-high')).toBeNull()
  })

  it('retourne un score positif pour des paramètres valides', () => {
    const score = diScoreBS(15, 65, 7, 50000, 52000, 'sell-high')
    expect(score).toBeGreaterThan(0)
  })

  it('score plafonné à 1.5', () => {
    const score = diScoreBS(500, 65, 7, 50000, 52000, 'sell-high')
    expect(score).toBeLessThanOrEqual(1.5)
  })
})

// ── scoreLabel ────────────────────────────────────────────────────────────────

describe('scoreLabel', () => {
  it('retourne N/A si null', () => {
    expect(scoreLabel(null).label).toBe('N/A')
  })

  it('≥ 0.8 → Excellent', () => { expect(scoreLabel(0.9).label).toBe('Excellent') })
  it('≥ 0.6 → Bon',       () => { expect(scoreLabel(0.7).label).toBe('Bon') })
  it('≥ 0.4 → Passable',  () => { expect(scoreLabel(0.5).label).toBe('Passable') })
  it('< 0.4 → Faible',    () => { expect(scoreLabel(0.3).label).toBe('Faible') })

  it('bar = ratio', () => {
    expect(scoreLabel(0.75).bar).toBe(0.75)
  })
})

// ── calcPnL ───────────────────────────────────────────────────────────────────

describe('calcPnL', () => {
  const sellHighOffer = {
    type: 'sell-high',
    amount: 10000,
    quantity: 0.2,
    strike: 52000,
    rate: 15,
    days: 7,
  }

  const buyLowOffer = {
    type: 'buy-low',
    amount: 10000,
    quantity: 0.2,
    strike: 48000,
    rate: 12,
    days: 7,
  }

  it('retourne null si amount manquant', () => {
    expect(calcPnL({ ...sellHighOffer, amount: null }, 50000, null)).toBeNull()
  })

  it('sell-high : retourne la structure correcte', () => {
    const pnl = calcPnL(sellHighOffer, 50000, null)
    expect(pnl.type).toBe('sell-high')
    expect(pnl).toHaveProperty('qty')
    expect(pnl).toHaveProperty('prime')
    expect(pnl).toHaveProperty('primeNative')
    expect(pnl).toHaveProperty('pnlIfExercised')
    expect(pnl).toHaveProperty('willBeExercised')
    expect(pnl).toHaveProperty('distPct')
    expect(pnl.scenarios).toHaveLength(3)
  })

  it('sell-high : willBeExercised = false si spot < strike', () => {
    const pnl = calcPnL(sellHighOffer, 50000, null)
    expect(pnl.willBeExercised).toBe(false)
  })

  it('sell-high : willBeExercised = true si spot >= strike', () => {
    const pnl = calcPnL(sellHighOffer, 55000, null)
    expect(pnl.willBeExercised).toBe(true)
  })

  it('buy-low : retourne la structure correcte', () => {
    const pnl = calcPnL(buyLowOffer, 50000, null)
    expect(pnl.type).toBe('buy-low')
    expect(pnl).toHaveProperty('btcIfExercised')
    expect(pnl).toHaveProperty('willBeExercised')
    expect(pnl.scenarios).toHaveLength(3)
  })

  it('buy-low : willBeExercised = false si spot > strike', () => {
    const pnl = calcPnL(buyLowOffer, 50000, null)
    expect(pnl.willBeExercised).toBe(false)
  })

  it('buy-low : utilise DCA comme prix de référence si fourni', () => {
    const pnlDca  = calcPnL(buyLowOffer, 50000, 45000)
    const pnlNoDca = calcPnL(buyLowOffer, 50000, null)
    expect(pnlDca.pnlIfExercised).not.toBe(pnlNoDca.pnlIfExercised)
  })
})

// ── countdown ─────────────────────────────────────────────────────────────────

describe('countdown', () => {
  it('retourne — si date null', () => {
    expect(countdown(null)).toBe('—')
  })

  it('retourne Échue si date dans le passé', () => {
    expect(countdown('2020-01-01')).toBe('Échue')
  })

  it('retourne format jours + heures pour > 1 jour', () => {
    const future = new Date(Date.now() + 3 * 86400000 + 4 * 3600000).toISOString()
    const result = countdown(future)
    expect(result).toMatch(/\d+j \d+h/)
  })

  it('retourne format heures + minutes pour < 1 jour', () => {
    const future = new Date(Date.now() + 5 * 3600000 + 30 * 60000).toISOString()
    const result = countdown(future)
    expect(result).toMatch(/\d+h \d+min/)
  })
})

// ── fmtUSD ────────────────────────────────────────────────────────────────────

describe('fmtUSD', () => {
  it('retourne — si null', () => { expect(fmtUSD(null)).toBe('—') })
  it('formate avec 2 décimales', () => { expect(fmtUSD(1234.5)).toBe('$1,234.50') })
  it('formate les grands nombres', () => { expect(fmtUSD(1000000)).toBe('$1,000,000.00') })
})

// ── fmtStrike ─────────────────────────────────────────────────────────────────

describe('fmtStrike', () => {
  it('formate sans décimales', () => { expect(fmtStrike(52000)).toBe('$52,000') })
})

// ── fmtDuration ──────────────────────────────────────────────────────────────

describe('fmtDuration', () => {
  it('retourne — si null', () => { expect(fmtDuration(null)).toBe('—') })
  it('affiche jours + heures si fraction', () => {
    expect(fmtDuration(3.5)).toBe('3j 12h')
  })
  it('affiche jours seulement si pas de fraction', () => {
    expect(fmtDuration(7)).toBe('7j')
  })
})
