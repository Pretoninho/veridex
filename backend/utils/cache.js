/**
 * backend/utils/cache.js — SmartCache (server-side)
 *
 * In-memory TTL cache with per-key customizable TTL.
 * Includes FNV-1a hash-based change detection to avoid redundant recomputation.
 * No browser dependencies (no IndexedDB, no localStorage).
 *
 * Usage:
 *   const cache = new SmartCache({ ttlMs: 30_000 })
 *   cache.set('BTC:spot', data)
 *   cache.get('BTC:spot')  // null if stale
 *
 *   const changed = cache.setIfChanged('BTC:signal', signal)
 *   if (!changed) return cache.get('BTC:signal')
 */

'use strict'

// ── FNV-1a 32-bit hash ────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — fast, dependency-free.
 * Excludes timestamp fields to avoid false positives when only time changes.
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
function fnv1aHash(str) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash
}

const _HASH_EXCLUDED = ['timestamp', 'ts', 'time', 'serverTime', 'syncedAt', 'fetchedAt', 'updatedAt']

/**
 * Serialize data deterministically, excluding volatile timestamp fields, then hash it.
 * @param {any} data
 * @returns {number}
 */
function hashData(data) {
  function clean(obj) {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(clean)
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
      if (_HASH_EXCLUDED.includes(k)) continue
      result[k] = clean(v)
    }
    return result
  }
  try {
    return fnv1aHash(JSON.stringify(clean(data)))
  } catch {
    return fnv1aHash(String(data))
  }
}

const CHANGE_LOG_MAX = 500

class SmartCache {
  /**
   * @param {{ ttlMs?: number }} [opts]
   */
  constructor({ ttlMs = 30_000 } = {}) {
    this._defaultTtl = ttlMs
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._store = new Map()
    /** @type {Map<string, number>} Hash per key for change detection */
    this._hashes = new Map()
    /** @type {Array<{ key: string, hash: number, ts: number }>} */
    this.changeLog = []
  }

  /**
   * Store a value under `key`.
   * @param {string} key
   * @param {any} value
   * @param {{ ttlMs?: number }} [opts] - Override default TTL for this entry.
   */
  set(key, value, { ttlMs } = {}) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this._defaultTtl),
    })
  }

  /**
   * Retrieve a cached value.  Returns `null` if missing or stale.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key)
      return null
    }
    return entry.value
  }

  /**
   * Return the cached value if fresh, or call `fetchFn`, store, and return its result.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fetchFn
   * @param {{ ttlMs?: number }} [opts]
   * @returns {Promise<T>}
   */
  async getOrFetch(key, fetchFn, opts = {}) {
    const cached = this.get(key)
    if (cached !== null) return cached
    const fresh = await fetchFn()
    if (fresh != null) this.set(key, fresh, opts)
    return fresh
  }

  /**
   * Invalidate a specific key.
   * @param {string} key
   */
  invalidate(key) {
    this._store.delete(key)
  }

  /** Remove all stale entries. */
  prune() {
    const now = Date.now()
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key)
    }
  }

  /** Clear the entire cache. */
  clear() {
    this._store.clear()
    this._hashes.clear()
    this.changeLog = []
  }

  /**
   * Store a value only if its content has changed (FNV-1a hash comparison).
   * Updates the changeLog when a real change is detected.
   * Also applies the default TTL so that stale entries are evicted normally.
   *
   * @param {string} key
   * @param {any} data
   * @returns {boolean} true if the data changed and was stored, false if identical
   */
  setIfChanged(key, data) {
    const hash = hashData(data)
    const prev = this._hashes.get(key)

    if (prev === hash) return false

    this._hashes.set(key, hash)
    this._store.set(key, {
      value:     data,
      expiresAt: Date.now() + this._defaultTtl,
    })

    this.changeLog.push({ key, hash, ts: Date.now() })
    if (this.changeLog.length > CHANGE_LOG_MAX) {
      this.changeLog.shift()
    }

    return true
  }

  /**
   * Returns a copy of the change log (most recent entries first).
   * @param {number} [limit] — max entries to return
   * @returns {Array<{ key: string, hash: number, ts: number }>}
   */
  getChangeLog(limit) {
    const log = [...this.changeLog].reverse()
    return limit != null ? log.slice(0, limit) : log
  }
}

module.exports = { SmartCache, fnv1aHash, hashData }
