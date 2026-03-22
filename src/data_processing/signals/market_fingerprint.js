/**
 * data_processing/signals/market_fingerprint.js
 *
 * Fingerprint de patterns de marché.
 *
 * Arrondit les indicateurs en "buckets" pour identifier des configurations
 * récurrentes, les stocke dans IndexedDB et permet de retrouver
 * les statistiques de performance associées.
 *
 * Persistance : IndexedDB via idb-keyval
 *   clé : 'mf_' + fingerprint_hash
 *   valeur : { config, outcomes: [{ price, ts }], count }
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a } from '../../data_core/data_store/cache.js'

// ── Bucketing ─────────────────────────────────────────────────────────────────

/**
 * Arrondit une valeur au multiple le plus proche.
 * @param {number|null} v
 * @param {number} step
 * @returns {number|null}
 */
function bucket(v, step) {
  if (v == null || !isFinite(v)) return null
  return Math.round(v / step) * step
}

/**
 * Classe le spread en 3 catégories.
 * @param {number|null} spreadPct
 * @returns {'wide'|'normal'|'tight'|null}
 */
function spreadBucket(spreadPct) {
  if (spreadPct == null) return null
  if (spreadPct >= 0.5) return 'wide'
  if (spreadPct >= 0.1) return 'normal'
  return 'tight'
}

/**
 * Classe le ratio long/short.
 * @param {number|null} lsRatio
 * @returns {'long_heavy'|'balanced'|'short_heavy'|null}
 */
function lsBucket(lsRatio) {
  if (lsRatio == null) return null
  if (lsRatio >= 1.2) return 'long_heavy'
  if (lsRatio <= 0.8) return 'short_heavy'
  return 'balanced'
}

/**
 * Classe le basis en catégories.
 * @param {number|null} basisPct
 * @returns {'high_contango'|'contango'|'flat'|'backwardation'|null}
 */
function basisBucket(basisPct) {
  if (basisPct == null) return null
  if (basisPct >= 10) return 'high_contango'
  if (basisPct >= 2)  return 'contango'
  if (basisPct >= -2) return 'flat'
  return 'backwardation'
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

/**
 * Crée le fingerprint arrondi d'une configuration de marché.
 *
 * @param {{
 *   ivRank?: number|null,        — 0-100
 *   fundingPct?: number|null,    — % (ex: 0.01 pour 1%)
 *   spreadPct?: number|null,     — % spread bid/ask
 *   lsRatio?: number|null,       — long/short ratio
 *   basisPct?: number|null,      — basis annualisé en %
 * }} market
 * @returns {{ config: Object, hash: string }}
 */
export function createFingerprint(market) {
  const config = {
    ivRankBucket:  bucket(market.ivRank, 10),           // par tranches de 10
    fundingBucket: bucket((market.fundingPct ?? 0) * 100, 5), // par tranches de 5%
    spreadBucket:  spreadBucket(market.spreadPct),
    lsBucket:      lsBucket(market.lsRatio),
    basisBucket:   basisBucket(market.basisPct),
  }

  const hash = fnv1a(JSON.stringify(config))

  return { config, hash }
}

// ── Persistance IndexedDB ─────────────────────────────────────────────────────

const IDB_PREFIX = 'mf_'

/**
 * Retourne la clé IndexedDB pour un hash.
 * @param {string} hash
 */
const idbKey = (hash) => `${IDB_PREFIX}${hash}`

/**
 * Enregistre ou met à jour un pattern de marché dans IndexedDB.
 * Appelé à chaque snapshot pour accumuler les observations.
 *
 * @param {{ config: Object, hash: string }} fingerprint
 * @param {number} spotPrice — prix spot au moment du snapshot (pour les outcomes)
 * @returns {Promise<void>}
 */
export async function recordPattern(fingerprint, spotPrice) {
  const key = idbKey(fingerprint.hash)
  const existing = (await idbGet(key)) ?? {
    config: fingerprint.config,
    outcomes: [],   // [{ price, ts }]
    count: 0,
  }

  existing.count += 1
  existing.outcomes.push({ price: spotPrice, ts: Date.now() })

  // Garder max 200 outcomes par pattern
  if (existing.outcomes.length > 200) existing.outcomes.shift()

  await idbSet(key, existing)
}

/**
 * Enregistre le résultat prix à +1h, +4h, +24h après un snapshot.
 * À appeler périodiquement avec le prix actuel pour mettre à jour les outcomes.
 *
 * Principe : comparer le prix actuel à celui du snapshot enregistré
 * et calculer le % de variation pour les outcomes passés.
 *
 * @param {string} hash — hash du fingerprint
 * @param {number} currentPrice
 * @returns {Promise<void>}
 */
export async function updateOutcomes(hash, currentPrice) {
  const key = idbKey(hash)
  const record = await idbGet(key)
  if (!record) return

  const now = Date.now()
  const ONE_HOUR = 3_600_000
  const FOUR_HOURS = 4 * ONE_HOUR
  const ONE_DAY = 24 * ONE_HOUR

  record.outcomes = record.outcomes.map(o => {
    const age = now - o.ts
    const ret = o.price > 0 ? ((currentPrice - o.price) / o.price) * 100 : null

    if (!o.result_1h  && age >= ONE_HOUR   && age < ONE_HOUR  + 300_000) o.result_1h  = ret
    if (!o.result_4h  && age >= FOUR_HOURS && age < FOUR_HOURS + 300_000) o.result_4h  = ret
    if (!o.result_24h && age >= ONE_DAY    && age < ONE_DAY   + 300_000) o.result_24h = ret

    return o
  })

  await idbSet(key, record)
}

// ── Statistiques ──────────────────────────────────────────────────────────────

/**
 * Retourne les statistiques de performance d'un pattern.
 *
 * @param {string} hash
 * @returns {Promise<{
 *   occurrences: number,
 *   winRate_1h: number|null,    — % de fois où le prix a monté à 1h
 *   winRate_4h: number|null,
 *   avgMove_24h: number|null,   — variation moyenne % à 24h
 *   config: Object|null
 * }>}
 */
export async function getPatternStats(hash) {
  const record = await idbGet(idbKey(hash))

  if (!record) {
    return { occurrences: 0, winRate_1h: null, winRate_4h: null, avgMove_24h: null, config: null }
  }

  const withResult = (field) => record.outcomes.filter(o => o[field] != null)

  const winRate = (field) => {
    const arr = withResult(field)
    if (!arr.length) return null
    return Math.round((arr.filter(o => o[field] > 0).length / arr.length) * 100)
  }

  const avgMove = (field) => {
    const arr = withResult(field)
    if (!arr.length) return null
    const sum = arr.reduce((s, o) => s + o[field], 0)
    return Math.round((sum / arr.length) * 100) / 100
  }

  return {
    occurrences: record.count,
    winRate_1h:  winRate('result_1h'),
    winRate_4h:  winRate('result_4h'),
    avgMove_24h: avgMove('result_24h'),
    config: record.config,
  }
}
