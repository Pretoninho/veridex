/**
 * useFingerprintDebug.js
 *
 * Hook React qui récupère et enrichit les données de Market Fingerprinting
 * depuis IndexedDB pour la page de debug/monitoring.
 *
 * Retourne :
 *   - patterns  : liste enrichie de tous les patterns avec stats avancées
 *   - loading   : booléen chargement initial
 *   - error     : message d'erreur ou null
 *   - idbOk     : état de santé IndexedDB
 *   - lastUpdate: timestamp du dernier refresh
 *   - refresh   : fonction de rechargement manuel
 */

import { useState, useEffect, useCallback } from 'react'
import { getAllPatterns, computeAdvancedStats, TIMEFRAMES } from '../../signals/market_fingerprint.js'

const REFRESH_INTERVAL_MS = 30_000

export default function useFingerprintDebug() {
  const [patterns,   setPatterns]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [idbOk,      setIdbOk]      = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const raw = await getAllPatterns()

      // Enrichit chaque pattern avec ses statistiques avancées par timeframe
      const enriched = raw.map(p => {
        const advanced = {}
        for (const tf of TIMEFRAMES) {
          const tfStat = p.patternStats?.[tf] ?? null
          advanced[tf] = computeAdvancedStats(tfStat)
        }
        return { ...p, advanced }
      })

      setPatterns(enriched)
      setIdbOk(true)
      setError(null)
      setLastUpdate(Date.now())
    } catch (err) {
      setError(err?.message ?? 'Erreur lors du chargement des patterns')
      setIdbOk(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Chargement initial
  useEffect(() => {
    refresh()
  }, [refresh])

  // Refresh automatique
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return { patterns, loading, error, idbOk, lastUpdate, refresh }
}
