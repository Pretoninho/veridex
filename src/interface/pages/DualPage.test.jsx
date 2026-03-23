import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DualPage from './DualPage.jsx'

vi.mock('../../utils/api.js', () => ({
  getATMIV: vi.fn(async () => ({ iv: 72 })),
  getSpot: vi.fn(async () => 75000),
}))

vi.mock('../../utils/rlDual.js', () => ({
  evaluateDualPolicy: vi.fn(() => ({
    stateKey: 'BTC|SH|D14|A14|M6|IV70|DL20|DCA6|PV1|TRAP0',
    action: 'subscribe',
    confidence: 81,
    highIvCondition: true,
    iv: 72,
    ivFloor: 55,
    expiryTs: Date.UTC(2026, 2, 27, 8, 0, 0),
    delta: 0.24,
    deltaFloorOk: true,
    plusValueLocked: true,
    trappedProtocolActive: false,
    dcaGapPct: 4.1,
    protocol: 'plus-value-lock',
  })),
}))

describe('DualPage', () => {
  beforeEach(() => {
    localStorage.setItem('di_dca_BTC', '73000')
  })

  it('affiche le diagnostic RL enrichi sur le formulaire principal', async () => {
    render(<DualPage />)

    fireEvent.change(screen.getByPlaceholderText(/Ex: 85000/i), { target: { value: '76000' } })
    fireEvent.change(screen.getByPlaceholderText(/Ex: 12\.69/i), { target: { value: '14' } })
    fireEvent.change(screen.getByPlaceholderText(/Ex: 0\.01/i), { target: { value: '0.02' } })

    expect(await screen.findByText(/Diagnostic RL/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Delta:/i)).toBeInTheDocument()
      expect(screen.getByText(/plus-value lock/i)).toBeInTheDocument()
      expect(screen.getByText(/protocole/i)).toBeInTheDocument()
      expect(screen.getByText(/GO/i)).toBeInTheDocument()
    })
  })
})
