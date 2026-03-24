/**
 * OnChainPage.test.jsx
 *
 * Tests for the On-Chain > Flux & Positions tab data display.
 * Covers three key scenarios for Whale Transactions and Exchange Flows:
 *   1. Loading state (undefined / not yet fetched)
 *   2. Error / unavailable state (null returned from API)
 *   3. Data available state (valid API response)
 *
 * Also verifies that the Exchange Flows "disabled" card renders correctly
 * when no CryptoQuant API key is configured.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import OnChainPage from './OnChainPage.jsx'

// ── Mock: data providers ──────────────────────────────────────────────────────

vi.mock('../../data/providers/onchain.js', () => ({
  getOnChainSnapshot:   vi.fn(async () => ({ blockchain: null, mempool: null })),
  getFearGreedIndex:    vi.fn(async () => null),
  getHashRateHistory:   vi.fn(async () => null),
  // Default: API key absent → null (overridden per test)
  getExchangeFlows:     vi.fn(async () => null),
  getWhaleTransactions: vi.fn(async () => null),
}))

// ── Mock: normalizer ──────────────────────────────────────────────────────────

vi.mock('../../data/normalizers/format_data.js', () => ({
  normalizeOnChain: vi.fn(() => ({
    mempool:      { txCount: null, congestion: 'low', fastFee: null, hourFee: null, timestamp: Date.now() },
    exchangeFlow: { netflow: null, netflow24h: null, direction: null, signal: 'neutral', source: null, timestamp: Date.now() },
    mining:       { hashRate: null, difficulty: null, trend: 'stable', timestamp: Date.now() },
    composite:    { onChainScore: 50, bias: 'neutral', confidence: 'low' },
  })),
}))

// ── Mock: signal engine ───────────────────────────────────────────────────────

vi.mock('../../signals/onchain_signals.js', () => ({
  detectExchangeFlowSignal:    vi.fn(() => ({ signal: 'NEUTRAL', strength: 'weak', description_expert: '', description_novice: {} })),
  detectMempoolSignal:         vi.fn(() => ({ signal: 'CALM', congestionLevel: 'low', description_expert: '', description_novice: {} })),
  detectMinerSignal:           vi.fn(() => ({ signal: 'NEUTRAL', trend: 'stable', description_expert: '', description_novice: {} })),
  compositeOnChainSignal:      vi.fn(() => ({ score: 50, expert: 'Composite', novice: {}, action_expert: 'Action', action_novice: '' })),
  interpretMempoolExpert:      vi.fn(() => ({ action: 'Mempool calme', contextLabel: 'Calme', isAnormal: false })),
  interpretFearGreedExpert:    vi.fn(() => ({ action: 'Sentiment neutre', bias: 'neutral' })),
  interpretHashRateExpert:     vi.fn(() => ({ action: 'Hash rate stable', bias: 'neutral', current: null, variation7d: null })),
  interpretWhalesExpert:       vi.fn(() => ({ action: 'Aucune transaction whale > 100 BTC dans le mempool actuellement.', bias: 'neutral', count: 0, totalBTC: 0 })),
  interpretExchangeFlowsExpert: vi.fn(() => ({ action: 'Exchange flows non disponibles.', bias: 'neutral', available: false })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Re-imports the mocked provider module so individual tests can override
 * specific functions without having to re-mock the whole module.
 */
async function getProviderMocks() {
  const { getExchangeFlows, getWhaleTransactions } = await import('../../data/providers/onchain.js')
  return { getExchangeFlows, getWhaleTransactions }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('OnChainPage — Flux & Positions tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Exchange Flows ──────────────────────────────────────────────────────────

  describe('Exchange Flows', () => {
    it('affiche la carte "désactivée" quand getExchangeFlows renvoie null (clé absente)', async () => {
      // Default mock already returns null
      render(<OnChainPage asset="BTC" />)

      await waitFor(() => {
        // The disabled card shows the .env instruction
        expect(screen.getByText(/VITE_CRYPTOQUANT_API_KEY/)).toBeInTheDocument()
        expect(screen.getByText(/Fonctionnalité désactivée/i)).toBeInTheDocument()
      })
    })

    it('affiche les données Exchange Flows quand l\'API répond avec des données valides', async () => {
      const { getExchangeFlows } = await getProviderMocks()
      getExchangeFlows.mockResolvedValueOnce({
        asset: 'BTC',
        netflow: -500,
        netflow24h: -4500,
        direction: 'outflow',
        signal: 'bullish',
        label: 'Outflow 500 BTC',
        history: [],
        source: 'cryptoquant',
        fetchedAt: Date.now(),
      })

      // Also update interpretExchangeFlowsExpert to return available: true
      const { interpretExchangeFlowsExpert } = await import('../../signals/onchain_signals.js')
      interpretExchangeFlowsExpert.mockReturnValue({
        action: 'Outflow net -4500 BTC sur 24h — accumulation en cours.',
        bias: 'bullish',
        available: true,
        netflow: -500,
        netflow24h: -4500,
        direction: 'outflow',
      })

      render(<OnChainPage asset="BTC" />)

      await waitFor(() => {
        // The data card shows the flow header
        expect(screen.getByText(/Exchange Flows · BTC/)).toBeInTheDocument()
        // Shows the directional label (appears for both hourly and 24h rows)
        expect(screen.getAllByText(/Outflow ↓/)).toHaveLength(2)
        // Shows the expert action
        expect(screen.getByText(/Outflow net -4500 BTC/)).toBeInTheDocument()
      })
    })
  })

  // ── Whale Transactions ──────────────────────────────────────────────────────

  describe('Whale Transactions', () => {
    it('affiche "Chargement..." pendant le chargement initial (undefined)', async () => {
      const { getWhaleTransactions } = await getProviderMocks()
      // Delay resolution so we can catch the loading state
      getWhaleTransactions.mockImplementationOnce(
        () => new Promise(resolve => setTimeout(() => resolve(null), 5000))
      )

      render(<OnChainPage asset="BTC" />)

      // Before the promise resolves, whalesRaw is undefined → loading
      expect(screen.getByText('Chargement...')).toBeInTheDocument()
    })

    it('affiche "Données indisponibles" quand getWhaleTransactions renvoie null (erreur réseau)', async () => {
      const { getWhaleTransactions } = await getProviderMocks()
      getWhaleTransactions.mockResolvedValueOnce(null)

      render(<OnChainPage asset="BTC" />)

      await waitFor(() => {
        expect(screen.getByText('Données indisponibles')).toBeInTheDocument()
      })
    })

    it('affiche "Aucune whale tx détectée" quand le tableau de transactions est vide', async () => {
      const { getWhaleTransactions } = await getProviderMocks()
      getWhaleTransactions.mockResolvedValueOnce({
        transactions: [],
        count: 0,
        totalBTC: 0,
        timestamp: Date.now(),
      })

      render(<OnChainPage asset="BTC" />)

      await waitFor(() => {
        expect(screen.getByText('Aucune whale tx détectée')).toBeInTheDocument()
      })
    })

    it('affiche la liste des transactions whale quand des données sont disponibles', async () => {
      const { getWhaleTransactions } = await getProviderMocks()
      getWhaleTransactions.mockResolvedValueOnce({
        transactions: [
          {
            txid: 'abcdef1234567890',
            totalBTC: 250,
            fee: 5000,
            feeSats: 5000,
            size: 500,
            outputs: 2,
            direction: 'transfer',
            signal: { label: 'Transfert', bias: 'neutral', expert: 'Transfert 250 BTC — direction indéterminée' },
            timestamp: Date.now(),
          },
        ],
        count: 1,
        totalBTC: 250,
        timestamp: Date.now(),
      })

      render(<OnChainPage asset="BTC" />)

      await waitFor(() => {
        // Transaction TXID truncated to 8 chars + ellipsis
        expect(screen.getByText(/abcdef12…/)).toBeInTheDocument()
        // BTC amount displayed (locale formatting may vary in JSDOM)
        expect(screen.getByText(/250.* BTC/)).toBeInTheDocument()
      })
    })
  })
})
