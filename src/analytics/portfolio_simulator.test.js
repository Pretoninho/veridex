import { describe, it, expect, beforeEach } from 'vitest'
import { simulateTrade, getPortfolio, resetPortfolio, INIT_BAL, POSITION_PCT } from './portfolio_simulator.js'

describe('portfolio_simulator', () => {
  beforeEach(() => {
    resetPortfolio()
  })

  describe('resetPortfolio', () => {
    it('remet le balance à INIT_BAL', () => {
      const p = resetPortfolio()
      expect(p.balance).toBe(INIT_BAL)
      expect(p.trades).toEqual([])
    })
  })

  describe('getPortfolio', () => {
    it('retourne le portefeuille sans modification', () => {
      const p = getPortfolio()
      expect(p.balance).toBe(INIT_BAL)
      expect(p.trades).toHaveLength(0)
    })
  })

  describe('simulateTrade', () => {
    it('retourne le portfolio sans modification si trade est null', () => {
      const p = simulateTrade(null, 50000)
      expect(p.balance).toBe(INIT_BAL)
      expect(p.trades).toHaveLength(0)
    })

    it('retourne le portfolio sans modification si prix invalide', () => {
      const p = simulateTrade({ direction: 'LONG', entry: 50000 }, 0)
      expect(p.balance).toBe(INIT_BAL)
    })

    it('applique un trade LONG profitable', () => {
      const trade = { entry: 50_000, direction: 'LONG' }
      const p = simulateTrade(trade, 55_000)
      // pnl ratio = (55000-50000)/50000 = 0.1
      // result = 0.1 * 10000 * 0.01 = 10
      const expectedPnl = 0.1 * INIT_BAL * POSITION_PCT
      expect(p.balance).toBeCloseTo(INIT_BAL + expectedPnl)
      expect(p.trades).toHaveLength(1)
    })

    it('applique un trade LONG perdant', () => {
      const trade = { entry: 50_000, direction: 'LONG' }
      const p = simulateTrade(trade, 45_000)
      // pnl ratio = (45000-50000)/50000 = -0.1
      const expectedPnl = -0.1 * INIT_BAL * POSITION_PCT
      expect(p.balance).toBeCloseTo(INIT_BAL + expectedPnl)
    })

    it('applique un trade SHORT profitable', () => {
      const trade = { entry: 50_000, direction: 'SHORT' }
      const p = simulateTrade(trade, 45_000)
      // pnl ratio = (50000-45000)/50000 = 0.1
      const expectedPnl = 0.1 * INIT_BAL * POSITION_PCT
      expect(p.balance).toBeCloseTo(INIT_BAL + expectedPnl)
    })

    it('enregistre les champs du trade', () => {
      const trade = { entry: 60_000, direction: 'LONG' }
      const p = simulateTrade(trade, 63_000)
      const t = p.trades[0]
      expect(t.direction).toBe('LONG')
      expect(t.entry).toBe(60_000)
      expect(t.exit).toBe(63_000)
      expect(Number.isFinite(t.pnl)).toBe(true)
      expect(Number.isFinite(t.ts)).toBe(true)
    })

    it('accumule plusieurs trades', () => {
      simulateTrade({ entry: 50_000, direction: 'LONG' }, 51_000)
      simulateTrade({ entry: 51_000, direction: 'SHORT' }, 50_000)
      const p = getPortfolio()
      expect(p.trades).toHaveLength(2)
    })
  })
})
