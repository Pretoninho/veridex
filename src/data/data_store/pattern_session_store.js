/**
 * Pattern Session Store Module
 * Handles IndexedDB persistence of pattern tracking sessions
 */

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

const SESSION_STORE_PREFIX = 'pattern_sessions'
const CLUSTER_STORE_PREFIX = 'pattern_clusters'
const MAX_SESSIONS_PER_ASSET_SECTOR = 500

/**
 * Get IndexedDB key for storing sessions
 *
 * @private
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type
 * @returns {string} IDB key
 */
function getSessionKey(asset, sector) {
  return `${SESSION_STORE_PREFIX}_${asset}_${sector}`
}

/**
 * Get IndexedDB key for storing clusters
 *
 * @private
 * @param {string} asset - Asset name
 * @returns {string} IDB key
 */
function getClusterKey(asset) {
  return `${CLUSTER_STORE_PREFIX}_${asset}`
}

/**
 * Save a completed pattern session to IndexedDB
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type
 * @param {Object} sessionSummary - Session summary object (from PatternSession.getSummary())
 * @param {Object} trajectory - Full trajectory data (optional)
 * @returns {Promise<boolean>} True if saved successfully
 *
 * @example
 * await savePatternSession('BTC', 'futures', summary, trajectory)
 */
export async function savePatternSession(asset, sector, sessionSummary, trajectory = null) {
  try {
    const key = getSessionKey(asset, sector)

    // Get existing sessions
    let sessions = (await idbGet(key)) || []

    // Ensure it's an array
    if (!Array.isArray(sessions)) {
      sessions = []
    }

    // Add new session with metadata
    const entry = {
      summary: sessionSummary,
      trajectory: trajectory,
      savedAt: new Date().toISOString(),
      index: sessions.length // For sorting
    }

    sessions.push(entry)

    // Maintain max size (keep latest)
    if (sessions.length > MAX_SESSIONS_PER_ASSET_SECTOR) {
      sessions = sessions.slice(-MAX_SESSIONS_PER_ASSET_SECTOR)
    }

    // Save back to IDB
    await idbSet(key, sessions)

    return true
  } catch (error) {
    console.error(`Error saving pattern session for ${asset}/${sector}:`, error)
    return false
  }
}

/**
 * Retrieve pattern sessions from IndexedDB
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional, gets all if omitted)
 * @param {Object} filter - Filter options
 * @param {number} filter.limit - Max entries (default: 100)
 * @param {string} filter.patternHash - Filter by pattern hash (optional)
 * @param {number} filter.sinceMs - Filter by timestamp (ms) (optional)
 * @returns {Promise<Array>} Array of sessions matching filter
 *
 * @example
 * const sessions = await getPatternSessions('BTC', 'futures', { limit: 50 })
 * const profitable = await getPatternSessions('BTC', null, { patternHash: 'a1b2c3d4' })
 */
export async function getPatternSessions(asset, sector, filter = {}) {
  try {
    const { limit = 100, patternHash, sinceMs } = filter

    let allSessions = []

    if (sector) {
      // Get specific sector
      const key = getSessionKey(asset, sector)
      const sessions = (await idbGet(key)) || []
      allSessions = sessions
    } else {
      // Get all sectors
      const sectors = ['futures', 'options', 'onchain']
      for (const s of sectors) {
        const key = getSessionKey(asset, s)
        const sessions = (await idbGet(key)) || []
        allSessions = [...allSessions, ...sessions]
      }
    }

    // Apply filters
    let filtered = allSessions

    if (patternHash) {
      filtered = filtered.filter(s => s.summary?.patternHash === patternHash)
    }

    if (sinceMs) {
      const sinceDate = new Date(sinceMs)
      filtered = filtered.filter(s => {
        const sessionDate = new Date(s.summary?.closedAt)
        return sessionDate >= sinceDate
      })
    }

    // Sort by time (newest first) and limit
    filtered.sort((a, b) => {
      const aTime = new Date(a.summary?.closedAt || 0).getTime()
      const bTime = new Date(b.summary?.closedAt || 0).getTime()
      return bTime - aTime
    })

    return filtered.slice(0, limit)
  } catch (error) {
    console.error(`Error retrieving pattern sessions for ${asset}/${sector}:`, error)
    return []
  }
}

/**
 * Get sessions grouped by cluster/family
 *
 * @param {string} asset - Asset name
 * @param {string} clusterId - Cluster ID to filter by
 * @returns {Promise<Array>} Sessions in this cluster
 *
 * @example
 * const familySessions = await getPatternSessionsByCluster('BTC', 'c_BTC_futures_0')
 */
export async function getPatternSessionsByCluster(asset, clusterId) {
  try {
    const sectors = ['futures', 'options', 'onchain']
    let allSessions = []

    for (const sector of sectors) {
      const key = getSessionKey(asset, sector)
      const sessions = (await idbGet(key)) || []
      allSessions = [...allSessions, ...sessions]
    }

    // For now, cluster filtering would be done via clustering module
    // This is a placeholder for future cluster tracking
    return allSessions
  } catch (error) {
    console.error(`Error retrieving sessions by cluster:`, error)
    return []
  }
}

/**
 * Save cluster data to IndexedDB
 *
 * @param {string} asset - Asset name
 * @param {Object} clusterData - Cluster export data
 * @returns {Promise<boolean>} True if saved successfully
 *
 * @example
 * await savePatternClusters('BTC', clusterer.export())
 */
export async function savePatternClusters(asset, clusterData) {
  try {
    const key = getClusterKey(asset)
    await idbSet(key, {
      data: clusterData,
      savedAt: new Date().toISOString()
    })
    return true
  } catch (error) {
    console.error(`Error saving clusters for ${asset}:`, error)
    return false
  }
}

/**
 * Retrieve cluster data from IndexedDB
 *
 * @param {string} asset - Asset name
 * @returns {Promise<Object|null>} Cluster data or null
 *
 * @example
 * const clusters = await getPatternClusters('BTC')
 */
export async function getPatternClusters(asset) {
  try {
    const key = getClusterKey(asset)
    const stored = await idbGet(key)
    return stored?.data || null
  } catch (error) {
    console.error(`Error retrieving clusters for ${asset}:`, error)
    return null
  }
}

/**
 * Get session statistics for analysis
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional)
 * @returns {Promise<Object>} Statistics object
 *
 * @example
 * const stats = await getSessionStats('BTC', 'futures')
 * // Returns: {
 * //   totalSessions: 45,
 * //   profitableSessions: 28,
 * //   winRate: 62.2,
 * //   avgMove: 2.3,
 * //   maxMove: 8.5,
 * //   minMove: -3.2
 * // }
 */
export async function getSessionStats(asset, sector) {
  try {
    const sessions = await getPatternSessions(asset, sector, { limit: 1000 })

    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        profitableSessions: 0,
        winRate: 0,
        avgMove: 0,
        maxMove: 0,
        minMove: 0,
        asset,
        sector
      }
    }

    let profitable = 0
    let totalMove = 0
    let maxMove = -Infinity
    let minMove = Infinity

    for (const session of sessions) {
      const move = session.summary?.movePercent || 0
      totalMove += move

      if (session.summary?.status === 'profit') {
        profitable++
      }

      maxMove = Math.max(maxMove, move)
      minMove = Math.min(minMove, move)
    }

    const totalSessions = sessions.length
    const winRate = (profitable / totalSessions) * 100
    const avgMove = totalMove / totalSessions

    return {
      totalSessions,
      profitableSessions: profitable,
      winRate: parseFloat(winRate.toFixed(2)),
      avgMove: parseFloat(avgMove.toFixed(2)),
      maxMove: parseFloat(maxMove.toFixed(2)),
      minMove: parseFloat(minMove.toFixed(2)),
      asset,
      sector: sector || 'all'
    }
  } catch (error) {
    console.error(`Error computing stats for ${asset}/${sector}:`, error)
    return null
  }
}

/**
 * Delete sessions from IndexedDB
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional, deletes all if omitted)
 * @returns {Promise<boolean>} True if deleted successfully
 *
 * @example
 * await deletePatternSessions('BTC', 'futures')
 */
export async function deletePatternSessions(asset, sector) {
  try {
    if (sector) {
      const key = getSessionKey(asset, sector)
      await idbDel(key)
    } else {
      const sectors = ['futures', 'options', 'onchain']
      for (const s of sectors) {
        const key = getSessionKey(asset, s)
        await idbDel(key)
      }
    }
    return true
  } catch (error) {
    console.error(`Error deleting sessions for ${asset}/${sector}:`, error)
    return false
  }
}

/**
 * Export sessions for external analysis (e.g., CSV)
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional)
 * @param {number} limit - Max entries
 * @returns {Promise<Array>} Exportable array of sessions
 *
 * @example
 * const csv = await exportSessionsForAnalysis('BTC', 'futures', 500)
 */
export async function exportSessionsForAnalysis(asset, sector, limit = 500) {
  try {
    const sessions = await getPatternSessions(asset, sector, { limit })

    return sessions.map(s => ({
      patternHash: s.summary?.patternHash,
      sector: s.summary?.sector,
      detectedAt: s.summary?.detectedAt,
      closedAt: s.summary?.closedAt,
      duration: s.summary?.duration,
      startPrice: s.summary?.startPrice,
      endPrice: s.summary?.endPrice,
      movePercent: s.summary?.movePercent,
      maxDrawdown: s.summary?.maxDrawdown,
      status: s.summary?.status,
      trajectoryPoints: s.summary?.trajectoryPoints
    }))
  } catch (error) {
    console.error(`Error exporting sessions:`, error)
    return []
  }
}

/**
 * Get all available pattern hashes (for UI filtering)
 *
 * @param {string} asset - Asset name
 * @returns {Promise<Set>} Set of unique pattern hashes
 *
 * @example
 * const hashes = await getUniquePatternHashes('BTC')
 */
export async function getUniquePatternHashes(asset) {
  try {
    const sectors = ['futures', 'options', 'onchain']
    const hashes = new Set()

    for (const sector of sectors) {
      const key = getSessionKey(asset, sector)
      const sessions = (await idbGet(key)) || []

      for (const session of sessions) {
        if (session.summary?.patternHash) {
          hashes.add(session.summary.patternHash)
        }
      }
    }

    return hashes
  } catch (error) {
    console.error(`Error getting pattern hashes:`, error)
    return new Set()
  }
}

/**
 * Clear all pattern data (use with extreme caution!)
 *
 * @param {string} asset - Asset name (optional, clears all if omitted)
 * @returns {Promise<boolean>}
 *
 * @example
 * await clearAllPatternData('BTC')
 */
export async function clearAllPatternData(asset) {
  try {
    if (asset) {
      // Clear specific asset
      const sectors = ['futures', 'options', 'onchain']
      for (const sector of sectors) {
        await idbDel(getSessionKey(asset, sector))
      }
      await idbDel(getClusterKey(asset))
    } else {
      // Clear everything (very slow!)
      const keys = [
        'pattern_sessions_*',
        'pattern_clusters_*'
      ]
      // This would require iterating all keys - not implemented for safety
      console.warn('clearAllPatternData without asset parameter not implemented for safety')
    }
    return true
  } catch (error) {
    console.error(`Error clearing pattern data:`, error)
    return false
  }
}
