import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PaperTradingPage from './PaperTradingPage.jsx'

const rlMocks = vi.hoisted(() => ({
  evaluateDualPolicy: vi.fn(() => ({
    stateKey: 'BTC|BL|D14|A14|M3|IV70|DL20|DCA3|PV1|TRAP0',
    action: 'subscribe',
    confidence: 84,
    highIvCondition: true,
    ivFloor: 55,
    delta: 0.23,
    deltaTarget: 0.2,
    deltaFloorOk: true,
    plusValueLocked: true,
    trappedProtocolActive: false,
    dcaGapPct: -2.5,
    protocol: 'plus-value-lock',
  })),
  getDualRlMetrics: vi.fn(() => ({ states: 3, experiences: 8, avgReward: 2.1, avgBaseReward: 1.4, lastTs: Date.UTC(2026, 2, 17, 8, 0, 0) })),
  getDualRlSnapshot: vi.fn(() => ({
    metrics: {},
    rewardConfig: {},
    calendarStats: { samples: 8, fridayRate: 0.75, avgCycleDistance: 2.1 },
    protocolStats: { plusValueRate: 0.62, deltaFloorRate: 0.88, trappedRate: 0.25, avgDcaGapPct: 3.4, avgDeltaAbs: 0.24 },
    topStates: [],
    recentExperiences: [],
  })),
  learnFromSettlement: vi.fn(),
  resetDualRl: vi.fn(),
  getDualRewardConfig: vi.fn(() => ({
    pnlWeight: 1,
    calendarWeight: 1,
    fridayWeight: 2.5,
    cycleWeight: 2,
    cycleTargetDays: 14,
    cycleToleranceDays: 7,
    exercisedPenalty: -0.75,
    dcaWeight: 1.1,
    plusValueWeight: 2.4,
    trappedWeight: 1.5,
    deltaWeight: 0.9,
    deltaTarget: 0.2,
    deltaTolerance: 0.12,
  })),
  updateDualRewardConfig: vi.fn((cfg) => cfg),
  resetDualRewardConfig: vi.fn(() => ({
    pnlWeight: 1,
    calendarWeight: 1,
    fridayWeight: 2.5,
    cycleWeight: 2,
    cycleTargetDays: 14,
    cycleToleranceDays: 7,
    exercisedPenalty: -0.75,
    dcaWeight: 1.1,
    plusValueWeight: 2.4,
    trappedWeight: 1.5,
    deltaWeight: 0.9,
    deltaTarget: 0.2,
    deltaTolerance: 0.12,
  })),
}))

vi.mock('../../utils/api.js', () => ({
  getATMIV: vi.fn(async () => ({ iv: 71 })),
  getSpot: vi.fn(async (asset) => asset === 'BTC' ? 74000 : 2800),
}))

vi.mock('../../utils/rlDual.js', () => ({
  evaluateDualPolicy: rlMocks.evaluateDualPolicy,
  getDualRlMetrics: rlMocks.getDualRlMetrics,
  getDualRlSnapshot: rlMocks.getDualRlSnapshot,
  learnFromSettlement: rlMocks.learnFromSettlement,
  resetDualRl: rlMocks.resetDualRl,
  getDualRewardConfig: rlMocks.getDualRewardConfig,
  updateDualRewardConfig: rlMocks.updateDualRewardConfig,
  resetDualRewardConfig: rlMocks.resetDualRewardConfig,
}))

describe('PaperTradingPage', () => {
  beforeEach(() => {
    localStorage.setItem('di_dca_BTC', '73000')
    localStorage.setItem('paper_di_balances', JSON.stringify({ USDC: 100000, BTC: 0.4, ETH: 6 }))
    localStorage.setItem('paper_di_positions', JSON.stringify([]))
    localStorage.setItem('paper_di_history', JSON.stringify([]))
    window.confirm = vi.fn(() => true)
    rlMocks.learnFromSettlement.mockClear()
    rlMocks.resetDualRl.mockClear()
    rlMocks.getDualRlMetrics.mockClear()
    rlMocks.getDualRlSnapshot.mockClear()
  })

  it('affiche les stats dataset DCA/delta et le diagnostic dans la modale de trade', async () => {
    render(<PaperTradingPage onBack={() => {}} />)

    expect(await screen.findByText(/Protocole DCA \/ Delta/i)).toBeInTheDocument()
    expect(screen.getByText(/Tx plus-value:/i)).toBeInTheDocument()
    expect(screen.getByText(/Delta ≥ cible:/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Nouvelle/i }))

    await waitFor(() => {
      expect(screen.getByText(/Transaction DI/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('Strike'), { target: { value: '72000' } })
    fireEvent.change(screen.getByPlaceholderText('APR %'), { target: { value: '15' } })

    await waitFor(() => {
      expect(screen.getByText(/protocole plus-value-lock/i)).toBeInTheDocument()
      expect(screen.getByText(/objectif >= 0\.20/i)).toBeInTheDocument()
      expect(screen.getByText(/transaction en plus-value selon le DCA/i)).toBeInTheDocument()
    })
  })

  it('declenche le reset du dataset RL via le bouton Reset RL', async () => {
    render(<PaperTradingPage onBack={() => {}} />)

    await screen.findByText(/RL Dataset/i)
    fireEvent.click(screen.getByRole('button', { name: /Reset RL/i }))

    expect(window.confirm).toHaveBeenCalled()
    expect(rlMocks.resetDualRl).toHaveBeenCalledTimes(1)
  })

  it('declenche l apprentissage RL au settlement d une position ouverte', async () => {
    localStorage.setItem('paper_di_positions', JSON.stringify([
      {
        id: 1,
        asset: 'BTC',
        side: 'sell-high',
        strike: 72000,
        apr: 15,
        days: 7,
        expiryTs: Date.UTC(2026, 2, 27, 8, 0, 0),
        quantityAsset: 0.01,
        collateralAsset: 0.01,
        collateralUsdc: 0,
        premiumAsset: 0.00003,
        premiumUsdc: 0,
        periodRate: 0.003,
        entrySpot: 70000,
        entryTs: Date.UTC(2026, 2, 20, 8, 0, 0),
        entryIv: 71,
        dca: 73000,
        delta: 0.23,
        plusValueLocked: false,
        trappedTrend: true,
        dcaGapPct: -1.37,
        rlStateKey: 'BTC|SH|D14|A14|M3|IV70|DL20|DCA3|PV0|TRAP1',
        rlAction: 'subscribe',
        rlConfidence: 84,
      },
    ]))

    render(<PaperTradingPage onBack={() => {}} />)

    await screen.findByText(/Sell High BTC @ \$72,000/i)
    fireEvent.click(screen.getByRole('button', { name: /Regler au spot actuel/i }))

    await waitFor(() => {
      expect(rlMocks.learnFromSettlement).toHaveBeenCalledTimes(1)
    })

    expect(rlMocks.learnFromSettlement).toHaveBeenCalledWith(expect.objectContaining({
      stateKey: 'BTC|SH|D14|A14|M3|IV70|DL20|DCA3|PV0|TRAP1',
      meta: expect.objectContaining({
        asset: 'BTC',
        side: 'sell-high',
        dca: 73000,
        delta: 0.23,
        trappedTrend: true,
      }),
    }))
  })
})
