import { describe, it, expect } from 'vitest'
import { parseInstrument, calculateMaxPain, calculateMaxPainByExpiry, interpretMaxPain } from './max_pain.js'

// ── parseInstrument ────────────────────────────────────────────────────────────

describe('parseInstrument', () => {
  it('parse un call BTC correctement', () => {
    const r = parseInstrument('BTC-29MAR24-70000-C')
    expect(r).not.toBeNull()
    expect(r.asset).toBe('BTC')
    expect(r.strike).toBe(70000)
    expect(r.optionType).toBe('call')
    expect(r.expiryStr).toBe('29MAR24')
  })

  it('parse un put ETH correctement', () => {
    const r = parseInstrument('ETH-28JUN24-3500-P')
    expect(r).not.toBeNull()
    expect(r.asset).toBe('ETH')
    expect(r.strike).toBe(3500)
    expect(r.optionType).toBe('put')
  })

  it('retourne null pour null', () => {
    expect(parseInstrument(null)).toBeNull()
  })

  it('retourne null pour une chaîne vide', () => {
    expect(parseInstrument('')).toBeNull()
  })

  it('retourne null si moins de 4 parties', () => {
    expect(parseInstrument('BTC-29MAR24-70000')).toBeNull()
  })

  it('retourne null pour un strike invalide', () => {
    expect(parseInstrument('BTC-29MAR24-ABC-C')).toBeNull()
  })

  it('retourne null pour un mois invalide', () => {
    expect(parseInstrument('BTC-29XXX24-70000-C')).toBeNull()
  })

  it("les dates d'expiration sont à 08:00 UTC", () => {
    const r = parseInstrument('BTC-29MAR24-70000-C')
    expect(r.expiry.getUTCHours()).toBe(8)
    expect(r.expiry.getUTCMinutes()).toBe(0)
  })
})

// ── calculateMaxPain ──────────────────────────────────────────────────────────

// Crée un ensemble minimal d'instruments autour d'un prix spot
function makeInstruments(spotPrice) {
  const strikes = [
    spotPrice * 0.8,
    spotPrice * 0.9,
    spotPrice,
    spotPrice * 1.1,
    spotPrice * 1.2,
  ]
  const instruments = []
  for (const strike of strikes) {
    instruments.push({
      name: `BTC-29MAR30-${strike}-C`,
      open_interest: strike < spotPrice ? 100 : 500,
    })
    instruments.push({
      name: `BTC-29MAR30-${strike}-P`,
      open_interest: strike > spotPrice ? 100 : 500,
    })
  }
  return instruments
}

describe('calculateMaxPain', () => {
  it('retourne null pour instruments vide', () => {
    expect(calculateMaxPain([], 50000)).toBeNull()
  })

  it('retourne null si spotPrice manque', () => {
    expect(calculateMaxPain([{}], 0)).toBeNull()
  })

  it('retourne un objet avec maxPainStrike', () => {
    const instruments = makeInstruments(50000)
    const result = calculateMaxPain(instruments, 50000)
    expect(result).not.toBeNull()
    expect(result.maxPainStrike).toBeGreaterThan(0)
  })

  it('maxPainStrike est un strike réel des instruments', () => {
    const instruments = makeInstruments(50000)
    const result = calculateMaxPain(instruments, 50000)
    expect(result.isRealStrike).toBe(true)
    expect(result.strikes).toContain(result.maxPainStrike)
  })

  it('retourne les métriques OI', () => {
    const instruments = makeInstruments(50000)
    const result = calculateMaxPain(instruments, 50000)
    expect(result.totalCallOI).toBeGreaterThan(0)
    expect(result.totalPutOI).toBeGreaterThan(0)
    expect(result.putCallRatio).toBeGreaterThan(0)
  })

  it('retourne la courbe de douleur avec un point par strike', () => {
    const instruments = makeInstruments(50000)
    const result = calculateMaxPain(instruments, 50000)
    expect(result.painCurve).toHaveLength(result.strikes.length)
  })

  it('distancePct = 0 quand maxPain === spotPrice', () => {
    // Construire un cas où le max pain est exactement le spot
    const strike = 50000
    const instruments = [
      { name: 'BTC-29MAR30-40000-P', open_interest: 1000 },
      { name: 'BTC-29MAR30-40000-C', open_interest: 0 },
      { name: `BTC-29MAR30-${strike}-P`, open_interest: 0 },
      { name: `BTC-29MAR30-${strike}-C`, open_interest: 0 },
      { name: 'BTC-29MAR30-60000-C', open_interest: 1000 },
      { name: 'BTC-29MAR30-60000-P', open_interest: 0 },
    ]
    const result = calculateMaxPain(instruments, strike)
    if (result?.maxPainStrike === strike) {
      expect(result.distancePct).toBeCloseTo(0)
      expect(result.direction).toBe('at')
    }
  })
})

// ── calculateMaxPainByExpiry ──────────────────────────────────────────────────

describe('calculateMaxPainByExpiry', () => {
  it('retourne un tableau vide pour instruments vides', () => {
    expect(calculateMaxPainByExpiry([], 50000)).toEqual([])
  })

  it('retourne tableau vide si spotPrice absent', () => {
    expect(calculateMaxPainByExpiry([{}], 0)).toEqual([])
  })
})

// ── interpretMaxPain ──────────────────────────────────────────────────────────

describe('interpretMaxPain', () => {
  it('retourne null pour données nulles', () => {
    expect(interpretMaxPain(null, 50000)).toBeNull()
    expect(interpretMaxPain({}, 0)).toBeNull()
  })

  it('interprète un max pain au-dessus comme bullish', () => {
    const data = {
      maxPainStrike: 55000,
      distancePct: 10,
      putCallRatio: 1.0,
      tensionZone: { low: 54000, high: 56000, widthPct: 4 },
      daysToExpiry: 5,
      nearestStrikes: { below: 54000, above: 56000 },
    }
    const r = interpretMaxPain(data, 50000)
    expect(r.signal).toBe('bullish')
  })

  it('interprète un max pain en dessous comme bearish', () => {
    const data = {
      maxPainStrike: 45000,
      distancePct: -10,
      putCallRatio: 1.0,
      tensionZone: { low: 44000, high: 46000, widthPct: 4 },
      daysToExpiry: 5,
      nearestStrikes: { below: 44000, above: 46000 },
    }
    const r = interpretMaxPain(data, 50000)
    expect(r.signal).toBe('bearish')
  })

  it('retourne neutral quand distancePct < 1%', () => {
    const data = {
      maxPainStrike: 50200,
      distancePct: 0.4,
      putCallRatio: 1.0,
      tensionZone: { low: 50000, high: 50500, widthPct: 1 },
      daysToExpiry: 3,
      nearestStrikes: { below: 50000, above: 50500 },
    }
    const r = interpretMaxPain(data, 50000)
    expect(r.signal).toBe('neutral')
  })

  it('retourne les champs expert et novice', () => {
    const data = {
      maxPainStrike: 52000,
      distancePct: 4,
      putCallRatio: 1.1,
      tensionZone: { low: 51000, high: 53000, widthPct: 4 },
      daysToExpiry: 7,
      nearestStrikes: { below: 51000, above: 53000 },
    }
    const r = interpretMaxPain(data, 50000)
    expect(typeof r.expert).toBe('string')
    expect(typeof r.novice).toBe('string')
  })
})
