/**
 * deribit.test.js
 *
 * Tests unitaires pour les fonctions du provider Deribit,
 * notamment _parseSettlementDate.
 */

import { describe, it, expect } from 'vitest'
import { _parseSettlementDate } from './deribit.js'

describe('_parseSettlementDate', () => {
  it('parse une date avec année à 4 chiffres (format classique)', () => {
    const ts = _parseSettlementDate('14 Jan 2025')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(0)   // janvier
    expect(d.getUTCDate()).toBe(14)
    expect(d.getUTCHours()).toBe(8)
    expect(d.getUTCMinutes()).toBe(0)
    expect(d.getUTCSeconds()).toBe(0)
  })

  it('parse une date avec année à 2 chiffres — normalise vers 2000+', () => {
    const ts = _parseSettlementDate('14 Mar 25')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(2)   // mars
    expect(d.getUTCDate()).toBe(14)
    expect(d.getUTCHours()).toBe(8)
  })

  it('fixe le timestamp à 08:00:00 UTC exact', () => {
    const ts = _parseSettlementDate('1 Jun 25')
    const d  = new Date(ts)
    expect(d.getUTCHours()).toBe(8)
    expect(d.getUTCMinutes()).toBe(0)
    expect(d.getUTCSeconds()).toBe(0)
    expect(d.getUTCMilliseconds()).toBe(0)
  })

  it('tolère les noms de mois en minuscules', () => {
    const ts = _parseSettlementDate('1 jan 25')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(0)
  })

  it('tolère les noms de mois en majuscules', () => {
    const ts = _parseSettlementDate('1 JAN 25')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(0)
  })

  it('tolère les noms de mois en casse mixte', () => {
    const ts = _parseSettlementDate('15 Dec 2024')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2024)
    expect(d.getUTCMonth()).toBe(11)  // décembre
    expect(d.getUTCDate()).toBe(15)
  })

  it('tolère les espaces multiples entre les tokens', () => {
    const ts = _parseSettlementDate('  14  Jan  2025  ')
    const d  = new Date(ts)
    expect(d.getUTCFullYear()).toBe(2025)
    expect(d.getUTCMonth()).toBe(0)
    expect(d.getUTCDate()).toBe(14)
  })

  it('retourne Date.now() approximativement si la date est vide', () => {
    const before = Date.now()
    const ts     = _parseSettlementDate('')
    const after  = Date.now()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('retourne Date.now() approximativement si la date est null', () => {
    const before = Date.now()
    const ts     = _parseSettlementDate(null)
    const after  = Date.now()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('retourne Date.now() approximativement si le format est invalide', () => {
    const before = Date.now()
    const ts     = _parseSettlementDate('not-a-date')
    const after  = Date.now()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('parse correctement tous les mois de l\'année', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    months.forEach((mon, idx) => {
      const ts = _parseSettlementDate(`1 ${mon} 25`)
      const d  = new Date(ts)
      expect(d.getUTCMonth()).toBe(idx)
      expect(d.getUTCFullYear()).toBe(2025)
    })
  })

  it('le timestamp est reproductible pour la même entrée', () => {
    const ts1 = _parseSettlementDate('14 Jan 25')
    const ts2 = _parseSettlementDate('14 Jan 25')
    expect(ts1).toBe(ts2)
  })

  it('produit un timestamp cohérent avec la date 2025-01-14T08:00:00Z', () => {
    const expected = Date.UTC(2025, 0, 14, 8, 0, 0)
    expect(_parseSettlementDate('14 Jan 25')).toBe(expected)
    expect(_parseSettlementDate('14 Jan 2025')).toBe(expected)
  })
})
