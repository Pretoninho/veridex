/**
 * usePriceData.js
 *
 * Hook React pour charger les bougies OHLCV depuis Binance Spot.
 * Retourne les données au format attendu par lightweight-charts
 * (time en secondes, trié par ordre croissant).
 *
 * @param {string} asset    - 'BTC' | 'ETH'
 * @param {string} interval - '1h' | '4h' | '1d' (intervalles Binance)
 * @param {number} limit    - nombre de bougies (max 500)
 */

import { useState, useEffect, useCallback } from 'react'
import { getKlines } from '../../data/providers/binance.js'

const REFRESH_MS = 60_000  // rafraîchissement automatique toutes les 60s

export default function usePriceData(asset = 'BTC', interval = '1h', limit = 100) {
  const [candles, setCandles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const refresh = useCallback(async () => {
    try {
      const raw = await getKlines(asset, interval, limit)
      // LW-charts attend time en secondes, trié ASC
      const data = raw
        .map(c => ({ ...c, time: Math.floor(c.time / 1000) }))
        .sort((a, b) => a.time - b.time)
      setCandles(data)
      setError(null)
    } catch (err) {
      setError(err?.message ?? 'Erreur chargement prix')
    } finally {
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
