/**
 * usePriceData.js
 *
 * Hook React pour charger les bougies OHLCV depuis l'API publique Binance.
 * Source : https://api.binance.com/api/v3/klines (aucune clé API requise)
 *
 * @param {string} asset    - 'BTC' | 'ETH'
 * @param {string} interval - '15m' | '1h' | '4h' | '1d'
 * @param {number} limit    - nombre de bougies (max 1000)
 */

import { useState, useEffect, useCallback } from 'react'

const BINANCE_BASE  = 'https://api.binance.com/api/v3/klines'
const REFRESH_MS    = 60_000   // rafraîchissement automatique toutes les 60s
const TIMEOUT_MS    = 10_000

// Mapping asset → symbole Binance
const SYMBOL_MAP = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
}

/**
 * Convertit une bougie Binance [openTime, open, high, low, close, volume, ...]
 * au format attendu par lightweight-charts : { time (s), open, high, low, close, volume }
 */
function _normalizeCandle(raw) {
  return {
    time:   Math.floor(raw[0] / 1000),   // ms → secondes
    open:   parseFloat(raw[1]),
    high:   parseFloat(raw[2]),
    low:    parseFloat(raw[3]),
    close:  parseFloat(raw[4]),
    volume: parseFloat(raw[5]),
  }
}

export default function usePriceData(asset = 'BTC', interval = '1h', limit = 100) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const refresh = useCallback(async () => {
    const symbol = SYMBOL_MAP[asset] ?? `${asset}USDT`
    const url    = `${BINANCE_BASE}?symbol=${symbol}&interval=${interval}&limit=${limit}`

    setLoading(true)
    setError(null)

    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('Format de réponse inattendu')
      setCandles(data.map(_normalizeCandle))
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message ?? 'Erreur chargement bougies')
      }
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
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
