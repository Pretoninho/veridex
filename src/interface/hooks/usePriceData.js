/**
 * usePriceData.js
 *
 * Hook React pour charger les bougies OHLCV.
 * v2.0: Deribit-only architecture
 *
 * TODO: Implement Deribit candle/OHLCV data source or alternative charting strategy
 * Current limitation: Deribit API does not expose historical OHLCV candles
 * Workaround: Return empty candles with placeholder
 *
 * @param {string} asset    - 'BTC' | 'ETH'
 * @param {string} interval - '1h' | '4h' | '1d'
 * @param {number} limit    - nombre de bougies
 */

import { useState, useEffect, useCallback } from 'react'

const REFRESH_MS = 60_000  // rafraîchissement automatique toutes les 60s

export default function usePriceData(asset = 'BTC', interval = '1h', limit = 100) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('OHLCV data not available in v2.0 (Deribit-only)')

  const refresh = useCallback(async () => {
    // v2.0: Placeholder - Deribit does not expose OHLCV data
    // This feature requires alternative implementation
    setCandles([])
    setLoading(false)
  }, [asset, interval, limit])

  // Chargement initial
  useEffect(() => { refresh() }, [refresh])

  // Rafraîchissement automatique
  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  return { candles, loading, error, refresh }
}
