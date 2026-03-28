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
const ERROR_MSG_DEFAULT = 'Erreur lors du chargement des patterns'

/**
 * Calcule les statistiques avancées par timeframe pour un pattern.
 * Exemple de timeframes supportés : '1h', '24h', '7d'.
 * @param {Object|null} patternStats - Les stats brutes du pattern indexées par timeframe
 * @returns {Record<string, any>} Stats avancées par timeframe
 */
function calculateAdvancedStats(patternStats) {
  const advanced = {}
  for (const tf of TIMEFRAMES) {
    const tfStat = patternStats?.[tf] ?? null
    advanced[tf] = computeAdvancedStats(tfStat)
  }
  return advanced
}

export default function useFingerprintDebug() {
  const [patterns,   setPatterns]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [idbOk,      setIdbOk]      = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const raw = await getAllPatterns()

      // Valide que le résultat est bien un tableau avant traitement
      if (!Array.isArray(raw)) {
        throw new Error('Format inattendu : getAllPatterns() doit retourner un tableau')
      }

      // Enrichit chaque pattern avec ses statistiques avancées par timeframe (ex. 1h, 24h, 7d)
      const enriched = raw.map(p => ({
        ...p,
        advanced: calculateAdvancedStats(p.patternStats),
      }))

      setPatterns(enriched)
      setIdbOk(true)
      setError(null)
      setLastUpdate(Date.now())
    } catch (err) {
      console.error('[useFingerprintDebug] Échec du chargement des patterns :', err)
      setError(err?.message ?? ERROR_MSG_DEFAULT)
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
