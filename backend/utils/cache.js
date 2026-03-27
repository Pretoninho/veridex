/**
 * backend/utils/cache.js — SmartCache (server-side)
 *
 * In-memory TTL cache with per-key customizable TTL.
 * No browser dependencies (no IndexedDB, no localStorage).
 *
 * Usage:
 *   const cache = new SmartCache({ ttlMs: 30_000 })
 *   cache.set('BTC:spot', data)
 *   cache.get('BTC:spot')  // null if stale
 */

'use strict'

class SmartCache {
  /**
   * @param {{ ttlMs?: number }} [opts]
   */
  constructor({ ttlMs = 30_000 } = {}) {
    this._defaultTtl = ttlMs
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this._store = new Map()
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
  }
}

module.exports = { SmartCache }
