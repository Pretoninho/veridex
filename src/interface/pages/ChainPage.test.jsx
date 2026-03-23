import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import ChainPage from './ChainPage.jsx'

vi.mock('../../utils/api.js', () => ({
  getSpot: vi.fn(async () => 62000),
  getInstruments: vi.fn(async () => [
    { expiration_timestamp: Date.UTC(2026, 2, 27, 8, 0, 0), strike: 60000, option_type: 'put', instrument_name: 'BTC-PUT-60000' },
    { expiration_timestamp: Date.UTC(2026, 2, 27, 8, 0, 0), strike: 60000, option_type: 'call', instrument_name: 'BTC-CALL-60000' },
  ]),
  getOrderBook: vi.fn(async (name) => ({
    mark_price: name.includes('PUT') ? 0.03 : 0.025,
    mark_iv: 68,
    open_interest: 120,
    greeks: { delta: name.includes('PUT') ? -0.22 : 0.18 },
  })),
  getAllExpiries: vi.fn(() => [Date.UTC(2026, 2, 27, 8, 0, 0)]),
  getBestDIOpportunities: vi.fn(async () => []),
}))

vi.mock('../../utils/rlDual.js', () => ({
  getDualRlMetrics: vi.fn(() => ({ states: 4, experiences: 12 })),
  evaluateDualPolicy: vi.fn((ctx) => ({
    stateKey: 'BTC|BL|D14|A14|M3|IV70|DL20|DCA10|PV0|TRAP1',
    action: 'subscribe',
    confidence: 77,
    highIvCondition: true,
    ivFloor: 55,
    delta: Math.abs(ctx.delta ?? 0.18),
    deltaFloorOk: true,
    plusValueLocked: false,
    trappedProtocolActive: true,
    protocol: 'trapped-trend-near-dca',
  })),
}))

describe('ChainPage', () => {
  beforeEach(() => {
    localStorage.setItem('di_dca_BTC', '50000')
  })

  it('affiche le protocole DCA/delta sur la chaine', async () => {
    render(<ChainPage />)

    expect(await screen.findByText(/DCA BTC:/)).toBeInTheDocument()
    expect(screen.getByText(/piege tendance actif/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Delta 0\.22 >= 0\.20/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/Piege: viser DCA/i)).toBeInTheDocument()
    expect(screen.getByText(/RL GO 77%/i)).toBeInTheDocument()
  })

  it('declenche Subscribe avec un payload enrichi DCA/delta/protocole', async () => {
    const onSubscribe = vi.fn()
    render(<ChainPage onSubscribe={onSubscribe} />)

    await screen.findByText(/RL GO 77%/i)

    fireEvent.click(screen.getByRole('button', { name: /Subscribe/i }))

    expect(onSubscribe).toHaveBeenCalledTimes(1)
    expect(onSubscribe).toHaveBeenCalledWith(expect.objectContaining({
      asset: 'BTC',
      delta: -0.22,
      dca: 50000,
      trappedTrend: true,
      plusValueLocked: false,
      rlAction: 'subscribe',
      rlConfidence: 77,
    }))
  })
})
