/**
 * cache.js — Store central de données
 *
 * Stocke la dernière valeur connue + un historique court pour chaque clé.
 * Interface unifiée : get / set / subscribe / invalidate
 *
 * Clé de cache = `{source}:{asset}:{type}`
 * Exemples :
 *   - 'deribit:BTC:spot'
 *   - 'binance:ETH:funding'
 *   - 'deribit:BTC:dvol'
 *   - 'deribit:BTC:option:BTC-28MAR25-80000-C'
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'

const DEFAULT_MAX_HISTORY = 100  // entrées par clé
const DEFAULT_TTL_MS = 60_000   // 1 min — après ça, la donnée est "stale"

// ── Hash FNV-1a 32 bits ───────────────────────────────────────────────────────

/**
 * Hash FNV-1a 32 bits — rapide, sans dépendance.
 * @param {string} str
 * @returns {string} hash hexadécimal 8 chars
 */
export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Sérialise une valeur de façon déterministe et la hashe (FNV-1a).
 * Exclut les champs temporels pour éviter les faux positifs de changement
 * (les timestamps varient à chaque poll même si les données de marché sont identiques).
 * @param {any} data
 * @returns {string} hash FNV-1a
 */
export function hashData(data) {
  const EXCLUDED = [
    'timestamp', 'ts', 'time', 'serverTime',
    'syncedAt', 'fetchedAt', 'updatedAt', 'raw',
  ]

  function clean(obj) {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(clean)
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
      if (EXCLUDED.includes(k)) continue
      result[k] = clean(v)
    }
    return result
  }

  try {
    return fnv1a(JSON.stringify(clean(data)))
  } catch {
    return fnv1a(String(data))
  }
}

// ── SmartCache changeLog persistence ─────────────────────────────────────────

const CACHE_LOG_IDB_KEY = 'cache_changelog'
const CACHE_LOG_MAX     = 2000

/**
 * Persiste une entrée du changeLog dans IndexedDB (fire-and-forget).
 * @param {{ key: string, hash: string, ts: number, type: string }} entry
 */
async function _persistChangeLogEntry(entry) {
  try {
    const log = (await idbGet(CACHE_LOG_IDB_KEY)) ?? []
    log.push(entry)
    if (log.length > CACHE_LOG_MAX) log.splice(0, log.length - CACHE_LOG_MAX)
    await idbSet(CACHE_LOG_IDB_KEY, log)
  } catch (_) {}
}

/**
 * Retourne le journal persisté des changements du SmartCache.
 * @param {number} [limit=500]
 * @returns {Promise<Array<{ key: string, hash: string, ts: number }>>}
 */
export async function getCacheChangeLog(limit = 500) {
  try {
    const log = (await idbGet(CACHE_LOG_IDB_KEY)) ?? []
    return log.slice(-limit).reverse()
  } catch (_) {
    return []
  }
}

/**
 * Efface le journal persisté des changements du SmartCache.
 */
export async function clearCacheChangeLog() {
  try {
    await idbSet(CACHE_LOG_IDB_KEY, [])
  } catch (_) {}
}

// ── SmartCache ────────────────────────────────────────────────────────────────

/**
 * SmartCache — cache avec détection de changement par hash FNV-1a.
 * Permet d'éviter les re-renders React inutiles en ne signalant
 * que les données réellement modifiées.
 */
export class SmartCache {
  constructor() {
    /** @type {Map<string, { hash: string, data: any, timestamp: number }>} */
    this._entries = new Map()
    /** @type {Map<string, number>} — timestamp de la dernière modification par clé */
    this._changedAt = new Map()
    /**
     * Journal circulaire des changements détectés (max 500 entrées en mémoire).
     * Chaque entrée : { key: string, hash: string, ts: number }
     * @type {Array<{ key: string, hash: string, ts: number }>}
     */
    this.changeLog = []

    // Hydrater le changeLog depuis IndexedDB au démarrage (async, non-bloquant)
    this._hydrateFromIDB()
  }

  /** Recharge les 500 dernières entrées persistées en mémoire. */
  async _hydrateFromIDB() {
    try {
      const persisted = (await idbGet(CACHE_LOG_IDB_KEY)) ?? []
      this.changeLog = persisted.slice(-500)
    } catch (_) {}
  }

  /**
   * Stocke une valeur et retourne true si elle a changé.
   * @param {string} key
   * @param {any} data
   * @returns {boolean} true si les données sont différentes du dernier set
   */
  set(key, data) {
    const newHash = hashData(data)
    const existing = this._entries.get(key)
    const changed = !existing || existing.hash !== newHash

    const now = Date.now()
    this._entries.set(key, { hash: newHash, data, timestamp: now })
    if (changed) {
      this._changedAt.set(key, now)
      const entry = { key, hash: newHash, ts: now, type: 'cache_change' }
      this.changeLog.push(entry)
      if (this.changeLog.length > 500) this.changeLog.shift()
      // Persistance async fire-and-forget — ne bloque pas set()
      _persistChangeLogEntry(entry)
    }

    return changed
  }

  /**
   * Retourne la valeur stockée, ou null si absente.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    return this._entries.get(key)?.data ?? null
  }

  /**
   * Retourne true si la clé a changé depuis le dernier set.
   * @param {string} key
   * @param {string} [previousHash] — hash précédent à comparer
   * @returns {boolean}
   */
  hasChanged(key, previousHash) {
    const entry = this._entries.get(key)
    if (!entry) return false
    if (previousHash !== undefined) return entry.hash !== previousHash
    return this._changedAt.get(key) === entry.timestamp
  }

  /**
   * Retourne le hash actuel d'une clé.
   * @param {string} key
   * @returns {string|null}
   */
  getHash(key) {
    return this._entries.get(key)?.hash ?? null
  }

  /**
   * Retourne les clés modifiées depuis un timestamp donné.
   * @param {number} sinceMs — timestamp unix ms
   * @returns {string[]}
   */
  getChangedKeys(sinceMs) {
    const result = []
    for (const [key, ts] of this._changedAt) {
      if (ts >= sinceMs) result.push(key)
    }
    return result
  }

  /** Supprime une clé. */
  delete(key) {
    this._entries.delete(key)
    this._changedAt.delete(key)
  }

  /** Vide le cache. */
  clear() {
    this._entries.clear()
    this._changedAt.clear()
  }
}

// Instance partagée pour les composants React
export const smartCache = new SmartCache()

class DataStore {
  constructor() {
    /** @type {Map<string, { value: any, timestamp: number }>} */
    this._latest = new Map()

    /** @type {Map<string, Array<{ value: any, timestamp: number }>>} */
    this._history = new Map()

    /** @type {Map<string, Set<Function>>} */
    this._subscribers = new Map()

    this._maxHistory = DEFAULT_MAX_HISTORY
    this._ttlMs = DEFAULT_TTL_MS
  }

  // ── Écriture ───────────────────────────────────────────────────────────────

  /**
   * Stocke une valeur normalisée dans le cache.
   * @param {string} key
   * @param {any} value — objet normalisé (NormalizedTicker, NormalizedOption…)
   */
  set(key, value) {
    const entry = { value, timestamp: Date.now() }

    this._latest.set(key, entry)

    if (!this._history.has(key)) this._history.set(key, [])
    const hist = this._history.get(key)
    hist.push(entry)
    if (hist.length > this._maxHistory) hist.shift()

    this._notify(key, value)
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  /**
   * Retourne la dernière valeur, ou null si absente/expirée.
   * @param {string} key
   * @param {boolean} [allowStale=false] — retourner même si TTL dépassé
   */
  get(key, allowStale = false) {
    const entry = this._latest.get(key)
    if (!entry) return null
    if (!allowStale && Date.now() - entry.timestamp > this._ttlMs) return null
    return entry.value
  }

  /**
   * Retourne la dernière valeur avec métadonnées.
   * @param {string} key
   */
  getMeta(key) {
    const entry = this._latest.get(key)
    if (!entry) return null
    return {
      value: entry.value,
      timestamp: entry.timestamp,
      age: Date.now() - entry.timestamp,
      stale: Date.now() - entry.timestamp > this._ttlMs,
    }
  }

  /**
   * Retourne l'historique d'une clé.
   * @param {string} key
   * @param {number} [limit] — nombre max d'entrées
   */
  getHistory(key, limit) {
    const hist = this._history.get(key) ?? []
    return limit ? hist.slice(-limit) : [...hist]
  }

  /**
   * Retourne toutes les clés dont le préfixe correspond.
   * ex: getKeysBy('deribit:BTC') → toutes les données BTC Deribit
   */
  getKeysBy(prefix) {
    return [...this._latest.keys()].filter(k => k.startsWith(prefix))
  }

  /**
   * Retourne toutes les valeurs dont la clé commence par prefix.
   */
  getAllBy(prefix, allowStale = false) {
    return this.getKeysBy(prefix)
      .map(k => this.get(k, allowStale))
      .filter(Boolean)
  }

  // ── Invalidation ───────────────────────────────────────────────────────────

  /** Supprime une clé du cache. */
  invalidate(key) {
    this._latest.delete(key)
    this._history.delete(key)
    this._subscribers.delete(key)
  }

  /** Supprime toutes les clés d'un préfixe. */
  invalidateBy(prefix) {
    this.getKeysBy(prefix).forEach(k => this.invalidate(k))
  }

  /** Supprime toutes les entrées expirées. */
  purgeStale() {
    const now = Date.now()
    for (const [key, entry] of this._latest) {
      if (now - entry.timestamp > this._ttlMs) {
        this._latest.delete(key)
      }
    }
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * S'abonne aux mises à jour d'une clé.
   * @param {string} key
   * @param {Function} listener  — appelé avec (value, key)
   * @returns {Function} unsubscribe
   */
  subscribe(key, listener) {
    if (!this._subscribers.has(key)) this._subscribers.set(key, new Set())
    this._subscribers.get(key).add(listener)
    return () => {
      const subs = this._subscribers.get(key)
      if (subs) {
        subs.delete(listener)
        if (!subs.size) this._subscribers.delete(key)
      }
    }
  }

  /**
   * S'abonne à toutes les clés dont le préfixe correspond.
   * Pratique pour écouter tous les tickers d'un asset.
   * @param {string} prefix
   * @param {Function} listener  — appelé avec (value, key)
   * @returns {Function} unsubscribe
   */
  subscribeBy(prefix, listener) {
    // Abonnement "pattern" : on stocke séparément
    const wildcardKey = `__wildcard__${prefix}`
    if (!this._subscribers.has(wildcardKey)) this._subscribers.set(wildcardKey, new Set())
    this._subscribers.get(wildcardKey).add(listener)
    return () => {
      const subs = this._subscribers.get(wildcardKey)
      if (subs) {
        subs.delete(listener)
        if (!subs.size) this._subscribers.delete(wildcardKey)
      }
    }
  }

  _notify(key, value) {
    // Abonnés directs
    this._subscribers.get(key)?.forEach(fn => {
      try { fn(value, key) } catch (_) {}
    })

    // Abonnés wildcard
    for (const [subKey, listeners] of this._subscribers) {
      if (!subKey.startsWith('__wildcard__')) continue
      const prefix = subKey.replace('__wildcard__', '')
      if (key.startsWith(prefix)) {
        listeners.forEach(fn => {
          try { fn(value, key) } catch (_) {}
        })
      }
    }
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  /** Modifie le TTL global en ms. */
  setTTL(ms) { this._ttlMs = ms }

  /** Modifie la taille max de l'historique par clé. */
  setMaxHistory(n) { this._maxHistory = n }

  // ── Diagnostic ────────────────────────────────────────────────────────────

  /** Retourne un snapshot de l'état du cache pour debug. */
  snapshot() {
    const result = {}
    for (const [key, entry] of this._latest) {
      result[key] = {
        timestamp: entry.timestamp,
        age: Date.now() - entry.timestamp,
        stale: Date.now() - entry.timestamp > this._ttlMs,
        historyLength: this._history.get(key)?.length ?? 0,
        subscribers: (this._subscribers.get(key)?.size ?? 0),
      }
    }
    return result
  }
}

// Singleton partagé dans toute l'application
export const dataStore = new DataStore()

// ── Clés canoniques ───────────────────────────────────────────────────────────
// Helpers pour construire des clés cohérentes

// ── Clock sync helpers ────────────────────────────────────────────────────────

const CLOCK_SYNC_CACHE_KEY = 'system:clock_sync'

/**
 * Retourne la dernière synchronisation d'horloge depuis le SmartCache.
 * @returns {object|null}
 */
export function getCachedClockSync() {
  return smartCache.get(CLOCK_SYNC_CACHE_KEY) ?? null
}

/**
 * Enregistre le résultat de syncServerClocks() dans le SmartCache.
 * @param {object} sync
 */
export function setCachedClockSync(sync) {
  smartCache.set(CLOCK_SYNC_CACHE_KEY, sync)
}

export const CacheKey = {
  spot:            (source, asset) => `${source}:${asset}:spot`,
  future:          (source, asset, instrument) => `${source}:${asset}:future:${instrument}`,
  perp:            (source, asset) => `${source}:${asset}:perp`,
  option:          (source, asset, instrument) => `${source}:${asset}:option:${instrument}`,
  funding:         (source, asset) => `${source}:${asset}:funding`,
  fundingHistory:  (source, asset) => `${source}:${asset}:fundingHistory`,
  oi:              (source, asset) => `${source}:${asset}:oi`,
  optionsOI:       (source, asset) => `${source}:${asset}:optionsOI`,
  optionsMark:     (source, asset) => `${source}:${asset}:optionsMark`,
  dvol:            (source, asset) => `${source}:${asset}:dvol`,
  instruments:     (source, asset) => `${source}:${asset}:instruments`,
  rv:              (source, asset) => `${source}:${asset}:rv`,
  trades:          (source, asset) => `${source}:${asset}:trades`,
  liquidations:    (source, asset) => `${source}:${asset}:liquidations`,
  sentiment:       (source, asset) => `${source}:${asset}:sentiment`,
  takerVolume:     (source, asset) => `${source}:${asset}:takerVolume`,
  deliveryPrices:  (source, asset) => `${source}:${asset}:deliveryPrices`,
  premiumIndex:    (source, asset) => `${source}:${asset}:premiumIndex`,
}
