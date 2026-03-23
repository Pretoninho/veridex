/**
 * collision_detector.js — FNV-1a collision detection and analytics
 *
 * Monitors for hash collisions in the FNV-1a 32-bit hash function.
 * Collisions are extremely rare with good input distribution, but we
 * track them for debugging and threat detection.
 *
 * Storage:
 *   - collision_log (IndexedDB): array of detected collisions
 *   - collision_stats (localStorage): aggregate statistics
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { HASH_CONFIG } from './hash_config.js'

// ────────────────────────────────────────────────────────────────────────────
// ── Constants
// ────────────────────────────────────────────────────────────────────────────

const COLLISION_LOG_IDB_KEY = 'collision_log'
const COLLISION_STATS_LS_KEY = 'collision_stats'
const MAX_COLLISIONS_LOG = 1000
const STATS_RESET_DAYS = 30

// ────────────────────────────────────────────────────────────────────────────
// ── Collision Recording
// ────────────────────────────────────────────────────────────────────────────

/**
 * Records a detected collision.
 * Should be called when two different data inputs produce the same hash.
 *
 * @param {{ key: string, data1: any, data2: any, hash: string, ts: number }}
 * @returns {Promise<void>}
 */
export async function recordCollision({ key, data1, data2, hash, ts }) {
  try {
    const collision = {
      key,
      hash,
      ts,
      data1_preview: _preview(data1),
      data2_preview: _preview(data2),
      data1_json: JSON.stringify(data1),
      data2_json: JSON.stringify(data2),
      severity: _computeSeverity(data1, data2),
    }

    // Add to IndexedDB log
    const log = (await idbGet(COLLISION_LOG_IDB_KEY)) ?? []
    log.push(collision)
    if (log.length > MAX_COLLISIONS_LOG) {
      log.splice(0, log.length - MAX_COLLISIONS_LOG)
    }
    await idbSet(COLLISION_LOG_IDB_KEY, log)

    // Update stats
    _updateStats('collision_detected', ts)

    // Log warning
    console.warn(
      `⚠️ HASH COLLISION: key="${key}", hash="${hash}", severity="${collision.severity}"`
    )
  } catch (err) {
    console.error('recordCollision error:', err)
  }
}

/**
 * Returns all recorded collisions with optional filtering.
 *
 * @param {{ limit?: number, since?: number, key?: string }}
 * @returns {Promise<Array>}
 */
export async function getCollisionLog({ limit = 100, since, key } = {}) {
  try {
    let log = (await idbGet(COLLISION_LOG_IDB_KEY)) ?? []

    if (since) {
      log = log.filter((c) => c.ts >= since)
    }
    if (key) {
      log = log.filter((c) => c.key === key)
    }

    return log.slice(-limit).reverse()
  } catch (err) {
    console.error('getCollisionLog error:', err)
    return []
  }
}

/**
 * Returns collision statistics.
 * @returns {{ total_collisions: number, by_severity: object, last_24h: number }}
 */
export function getCollisionStats() {
  try {
    const statsJson = localStorage.getItem(COLLISION_STATS_LS_KEY)
    if (!statsJson) {
      return {
        total_collisions: 0,
        by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
        last_24h: 0,
        last_updated: null,
      }
    }

    const stats = JSON.parse(statsJson)
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000

    // Count collisions in last 24h
    const last_24h =
      (stats.collision_timestamps ?? []).filter((ts) => now - ts < oneDay)
        .length

    return {
      total_collisions: stats.collision_count ?? 0,
      by_severity: stats.by_severity ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      last_24h,
      last_updated: stats.last_updated,
    }
  } catch (err) {
    console.error('getCollisionStats error:', err)
    return {
      total_collisions: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      last_24h: 0,
      last_updated: null,
    }
  }
}

/**
 * Resets collision statistics (for testing or maintenance).
 * @returns {void}
 */
export function resetCollisionStats() {
  try {
    localStorage.removeItem(COLLISION_STATS_LS_KEY)
  } catch (err) {
    console.error('resetCollisionStats error:', err)
  }
}

/**
 * Clears the collision log (for testing or maintenance).
 * @returns {Promise<void>}
 */
export async function clearCollisionLog() {
  try {
    await idbSet(COLLISION_LOG_IDB_KEY, [])
  } catch (err) {
    console.error('clearCollisionLog error:', err)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ── Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Creates a preview of data for logging (max 100 chars).
 */
function _preview(data) {
  try {
    const str = JSON.stringify(data)
    return str.length > 100 ? str.slice(0, 100) + '...' : str
  } catch {
    return String(data).slice(0, 100)
  }
}

/**
 * Computes collision severity based on data difference.
 * critical: identical except for timestamp → likely data replay/tampering
 * high: same keys but different values → data substitution
 * medium: partial overlap → incomplete data match
 * low: minimal overlap → random collision
 */
function _computeSeverity(data1, data2) {
  try {
    const s1 = JSON.stringify(data1)
    const s2 = JSON.stringify(data2)

    if (s1 === s2) return 'critical'

    const obj1 = typeof data1 === 'object' ? data1 : null
    const obj2 = typeof data2 === 'object' ? data2 : null

    if (!obj1 || !obj2) return 'low'

    const keys1 = new Set(Object.keys(obj1))
    const keys2 = new Set(Object.keys(obj2))
    const intersection = new Set([...keys1].filter((k) => keys2.has(k)))
    const union = new Set([...keys1, ...keys2])

    const similarity = intersection.size / union.size
    if (similarity > 0.8) return 'high'
    if (similarity > 0.5) return 'medium'
    return 'low'
  } catch {
    return 'low'
  }
}

/**
 * Updates collision statistics in localStorage.
 */
function _updateStats(event, ts) {
  try {
    let stats = {}
    const statsJson = localStorage.getItem(COLLISION_STATS_LS_KEY)
    if (statsJson) {
      stats = JSON.parse(statsJson)
    }

    if (event === 'collision_detected') {
      stats.collision_count = (stats.collision_count ?? 0) + 1
      stats.collision_timestamps = stats.collision_timestamps ?? []
      stats.collision_timestamps.push(ts)
      // Keep last 1000 timestamps
      if (stats.collision_timestamps.length > 1000) {
        stats.collision_timestamps = stats.collision_timestamps.slice(-1000)
      }
    }

    stats.last_updated = Date.now()
    localStorage.setItem(COLLISION_STATS_LS_KEY, JSON.stringify(stats))
  } catch (err) {
    console.error('_updateStats error:', err)
  }
}

/**
 * Analyze collision risk based on current system state.
 * Returns risk assessment for operators.
 *
 * @returns {Promise<{risk_level: string, indicators: string[], recommendation: string}>}
 */
export async function assessCollisionRisk() {
  try {
    const log = await getCollisionLog({ limit: 100 })
    const stats = getCollisionStats()

    const indicators = []
    let riskLevel = 'low'

    // Check for recent collisions (last 24h)
    if (stats.last_24h > 0) {
      indicators.push(`${stats.last_24h} collisions in last 24h`)
      riskLevel = 'medium'
    }

    // Check for high-severity collisions
    if (stats.by_severity.critical > 0) {
      indicators.push('Critical-severity collisions detected')
      riskLevel = 'high'
    }

    if (stats.by_severity.high > 0) {
      indicators.push(`${stats.by_severity.high} high-severity collisions`)
      if (riskLevel === 'low') riskLevel = 'medium'
    }

    // Check collision rate
    if (stats.total_collisions > 100) {
      indicators.push('High total collision count (>100)')
      riskLevel = 'high'
    }

    let recommendation = 'System operating normally'
    if (riskLevel === 'medium') {
      recommendation = 'Monitor closely; investigate recent collisions'
    } else if (riskLevel === 'high') {
      recommendation = 'URGENT: Investigate collisions; consider migrating to SHA-256'
    }

    return {
      risk_level: riskLevel,
      indicators,
      total_collisions: stats.total_collisions,
      last_24h: stats.last_24h,
      recommendation,
    }
  } catch (err) {
    console.error('assessCollisionRisk error:', err)
    return {
      risk_level: 'unknown',
      indicators: [err.message],
      recommendation: 'Error during risk assessment',
    }
  }
}

/**
 * Hook to integrate with SmartCache.set() for collision detection.
 * Call this with data when the hash hasn't changed but data differs.
 *
 * @param {{ key: string, hash: string, newData: any, existingData: any }}
 * @returns {void}
 */
export function checkForCollision({ key, hash, newData, existingData }) {
  try {
    // Check if data is actually different
    const newJson = JSON.stringify(newData)
    const existingJson = JSON.stringify(existingData)

    if (newJson !== existingJson) {
      // Different data, same hash = collision
      recordCollision({
        key,
        data1: existingData,
        data2: newData,
        hash,
        ts: Date.now(),
      })
    }
  } catch (err) {
    console.error('checkForCollision error:', err)
  }
}
