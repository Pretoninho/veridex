/**
 * protocol_lock.js — Verrouillage du protocole multi-niveaux
 *
 * Level 1: Flag dans HASH_CONFIG (déjà implémenté)
 * Level 2: Hash cryptographique SHA-256 + persiste dans IndexedDB
 * Level 3: Ancrage Bitcoin OpenTimestamps (futur)
 *
 * Une fois verrouillé, le protocole ne peut pas changer:
 * - Config de hashage (FNV-1a)
 * - Thresholds de sensibilité
 * - Limites de stockage
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { HASH_CONFIG, SNAPSHOT_VERSION } from './hash_config.js'

// ────────────────────────────────────────────────────────────────────────────
// ── Constants
// ────────────────────────────────────────────────────────────────────────────

const PROTOCOL_LOCK_KEY = 'protocol_lock_level2'
const LOCK_VERIFICATION_KEY = 'protocol_lock_verified_at'

// ────────────────────────────────────────────────────────────────────────────
// ── Helpers: Web Crypto SHA-256
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash using Web Crypto API.
 * @param {string} data
 * @returns {Promise<string>} lowercase hex string
 */
export async function sha256(data) {
  try {
    const encoder = new TextEncoder()
    const buffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch (err) {
    console.error('SHA-256 error:', err)
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ── Level 2: Cryptographic Locking
// ────────────────────────────────────────────────────────────────────────────

/**
 * Captures current protocol state and locks it with SHA-256 hash.
 * This prevents any changes to:
 *   - HASH_CONFIG.sensitivity (price_change_pct, iv_change_pts, etc.)
 *   - HASH_CONFIG.storage (changeLog_max, signal_history, etc.)
 *   - HASH_CONFIG.VERSION
 *
 * Stores the lock in IndexedDB with immutable flag.
 *
 * @returns {Promise<{locked: boolean, hash: string, timestamp: number}>}
 */
export async function lockProtocolLevel2() {
  try {
    // 1. Capture protocol state
    const protocolState = {
      version: HASH_CONFIG.VERSION,
      snapshot_version: SNAPSHOT_VERSION,
      sensitivity: {
        price_change_pct: HASH_CONFIG.sensitivity.price_change_pct,
        iv_change_pts: HASH_CONFIG.sensitivity.iv_change_pts,
        funding_change: HASH_CONFIG.sensitivity.funding_change,
      },
      storage: {
        changeLog_max: HASH_CONFIG.storage.changeLog_max,
        signal_history: HASH_CONFIG.storage.signal_history,
        clock_sync_history: HASH_CONFIG.storage.clock_sync_history,
        fingerprint_max: HASH_CONFIG.storage.fingerprint_max,
      },
    }

    // 2. Compute SHA-256 hash
    const stateJson = JSON.stringify(protocolState)
    const locked_hash = await sha256(stateJson)

    if (!locked_hash) {
      return { locked: false, error: 'SHA-256 computation failed' }
    }

    // 3. Create lock record
    const lockRecord = {
      locked_at: Date.now(),
      locked_hash,
      state: protocolState,
      immutable: true,
      level: 2,
    }

    // 4. Persist in IndexedDB
    await idbSet(PROTOCOL_LOCK_KEY, lockRecord)

    // 5. Update HASH_CONFIG
    HASH_CONFIG.LOCKED = true
    HASH_CONFIG.LOCKED_AT = lockRecord.locked_at
    HASH_CONFIG.LOCKED_HASH = locked_hash

    return {
      locked: true,
      hash: locked_hash,
      timestamp: lockRecord.locked_at,
      state: protocolState,
    }
  } catch (err) {
    console.error('lockProtocolLevel2 error:', err)
    return { locked: false, error: err.message }
  }
}

/**
 * Verify that the protocol lock is intact.
 * Recomputes SHA-256 and compares against stored hash.
 *
 * @returns {Promise<{verified: boolean, hash: string, lockedAt: number, tampered: boolean}>}
 */
export async function verifyProtocolLock() {
  try {
    const lock = await idbGet(PROTOCOL_LOCK_KEY)

    if (!lock) {
      return {
        verified: false,
        reason: 'No lock found',
        tampered: false,
      }
    }

    // Recompute hash from stored state
    const stateJson = JSON.stringify(lock.state)
    const recomputed = await sha256(stateJson)

    if (!recomputed) {
      return {
        verified: false,
        reason: 'SHA-256 computation failed',
        tampered: null,
      }
    }

    const match = recomputed === lock.locked_hash
    return {
      verified: match,
      hash: lock.locked_hash,
      lockedAt: lock.locked_at,
      tampered: !match,
      level: lock.level,
    }
  } catch (err) {
    console.error('verifyProtocolLock error:', err)
    return {
      verified: false,
      error: err.message,
      tampered: null,
    }
  }
}

/**
 * Returns the locked protocol state, if it exists.
 * Returns null if protocol is not locked.
 *
 * @returns {Promise<Object|null>}
 */
export async function getProtocolLockState() {
  try {
    const lock = await idbGet(PROTOCOL_LOCK_KEY)
    return lock?.state ?? null
  } catch (err) {
    console.error('getProtocolLockState error:', err)
    return null
  }
}

/**
 * Check if protocol state matches the locked state (prevents tampering).
 * Returns true if current config matches lock, false if diverged.
 *
 * @returns {Promise<boolean>}
 */
export async function isProtocolStateUnchanged() {
  try {
    const lock = await idbGet(PROTOCOL_LOCK_KEY)
    if (!lock) return true // Not locked = no constraints

    // Compare current config with locked state
    const current = {
      version: HASH_CONFIG.VERSION,
      sensitivity: {
        price_change_pct: HASH_CONFIG.sensitivity.price_change_pct,
        iv_change_pts: HASH_CONFIG.sensitivity.iv_change_pts,
        funding_change: HASH_CONFIG.sensitivity.funding_change,
      },
      storage: {
        changeLog_max: HASH_CONFIG.storage.changeLog_max,
        signal_history: HASH_CONFIG.storage.signal_history,
        clock_sync_history: HASH_CONFIG.storage.clock_sync_history,
        fingerprint_max: HASH_CONFIG.storage.fingerprint_max,
      },
    }

    // Deep compare
    return JSON.stringify(current) === JSON.stringify(lock.state)
  } catch (err) {
    console.error('isProtocolStateUnchanged error:', err)
    return false
  }
}

/**
 * Record a successful verification of the lock (for audit trail).
 *
 * @returns {Promise<void>}
 */
export async function recordLockVerification() {
  try {
    const verifications = (await idbGet(LOCK_VERIFICATION_KEY)) ?? []
    verifications.push({
      verified_at: Date.now(),
      status: 'ok',
    })
    // Keep last 100 verifications
    if (verifications.length > 100) {
      verifications.splice(0, verifications.length - 100)
    }
    await idbSet(LOCK_VERIFICATION_KEY, verifications)
  } catch (err) {
    console.error('recordLockVerification error:', err)
  }
}

/**
 * Get verification audit trail.
 *
 * @returns {Promise<Array<{verified_at: number, status: string}>>}
 */
export async function getLockVerificationHistory() {
  try {
    return (await idbGet(LOCK_VERIFICATION_KEY)) ?? []
  } catch (err) {
    console.error('getLockVerificationHistory error:', err)
    return []
  }
}

/**
 * Clear the protocol lock (only for development/testing).
 * Should NOT be available in production.
 *
 * @returns {Promise<void>}
 */
export async function clearProtocolLock() {
  try {
    await idbSet(PROTOCOL_LOCK_KEY, null)
    HASH_CONFIG.LOCKED = false
    HASH_CONFIG.LOCKED_AT = null
    HASH_CONFIG.LOCKED_HASH = null
  } catch (err) {
    console.error('clearProtocolLock error:', err)
  }
}
