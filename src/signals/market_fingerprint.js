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
 *   valeur : { config, outcomes: [{ price, ts }], count, patternStats }
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a } from '../data/data_store/cache.js'
import { FINGERPRINT_BUCKETING, TIMING, STORAGE_LIMITS } from '../config/signal_calibration.js'

// ── Multi-timeframe configuration ────────────────────────────────────────────

/** Supported tracking timeframes. */
export const TIMEFRAMES = ['1h', '24h', '7d']

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
  const spread_cfg = FINGERPRINT_BUCKETING.spread
  if (spreadPct == null) return null
  if (spreadPct >= spread_cfg.wide) return 'wide'
  if (spreadPct >= spread_cfg.normal) return 'normal'
  return 'tight'
}

/**
 * Deprecated: lsBucket no longer used in v2.0 (Binance L/S removed)
 * @param {number|null} lsRatio
 * @returns {null}
 */
function lsBucket(lsRatio) {
  // v2.0: Binance L/S ratio removed
  return null
}

/**
 * Classe le basis en catégories.
 * @param {number|null} basisPct
 * @returns {'high_contango'|'contango'|'flat'|'backwardation'|null}
 */
function basisBucket(basisPct) {
  const basis_cfg = FINGERPRINT_BUCKETING.basis
  if (basisPct == null) return null
  if (basisPct >= basis_cfg.highContango) return 'high_contango'
  if (basisPct >= basis_cfg.contango)     return 'contango'
  if (basisPct >= basis_cfg.flat)         return 'flat'
  return 'backwardation'
}

// ── Move classification ───────────────────────────────────────────────────────

/**
 * Classifie un mouvement de prix en % dans l'une des 5 catégories.
 *
 * Seuils (en %) :
 *   bigDown  : move < -3
 *   down     : -3 ≤ move < -0.1
 *   flat     : -0.1 ≤ move ≤ 0.1
 *   up       :  0.1 < move ≤ 3
 *   bigUp    : move > 3
 *
 * @param {number} move — variation en %
 * @returns {'bigDown'|'down'|'flat'|'up'|'bigUp'}
 */
export function classifyMove(move) {
  if (move < -3)   return 'bigDown'
  if (move < -0.1) return 'down'
  if (move <= 0.1) return 'flat'
  if (move <= 3)   return 'up'
  return 'bigUp'
}

// ── Per-timeframe stat helpers ────────────────────────────────────────────────

/**
 * Retourne une structure de statistiques vide pour un timeframe.
 * @returns {{ occurrences: number, upMoves: number, downMoves: number, flatMoves: number, avgUpMove: number, avgDownMove: number, distribution: Object }}
 */
function emptyTimeframeStat() {
  return {
    occurrences: 0,
    upMoves:     0,
    downMoves:   0,
    flatMoves:   0,
    avgUpMove:   0,
    avgDownMove: 0,
    distribution: { bigDown: 0, down: 0, flat: 0, up: 0, bigUp: 0 },
  }
}

/**
 * Intègre un mouvement dans une statistique de timeframe (mise à jour in-place).
 * Met à jour les compteurs directionnels, les moyennes courantes et la distribution.
 *
 * @param {{ occurrences: number, upMoves: number, downMoves: number, flatMoves: number, avgUpMove: number, avgDownMove: number, distribution: Object }} stat
 * @param {number} move — variation en %
 */
function _applyMove(stat, move) {
  stat.occurrences += 1
  stat.distribution[classifyMove(move)] += 1

  if (move > 0.1) {
    stat.upMoves += 1
    stat.avgUpMove = ((stat.avgUpMove * (stat.upMoves - 1)) + move) / stat.upMoves
  } else if (move < -0.1) {
    stat.downMoves += 1
    stat.avgDownMove = ((stat.avgDownMove * (stat.downMoves - 1)) + move) / stat.downMoves
  } else {
    stat.flatMoves += 1
  }
}

/**
 * Calcule les métriques avancées (probabilités, espérance, risk/reward)
 * à partir d'une statistique de timeframe.
 *
 * @param {{ occurrences: number, upMoves: number, downMoves: number, avgUpMove: number, avgDownMove: number, distribution: Object }} stat
 * @returns {{ probUp: number, probDown: number, expectedValue: number, riskReward: number|null, distribution: Object }|null}
 */
export function computeAdvancedStats(stat) {
  if (!stat || !stat.occurrences) return null

  const probUp   = stat.upMoves   / stat.occurrences
  const probDown = stat.downMoves / stat.occurrences
  const expectedValue = (probUp * stat.avgUpMove) + (probDown * stat.avgDownMove)
  const riskReward = stat.avgDownMove !== 0
    ? Math.abs(stat.avgUpMove / stat.avgDownMove)
    : null

  return {
    probUp:        Math.round(probUp   * 1000) / 1000,
    probDown:      Math.round(probDown * 1000) / 1000,
    expectedValue: Math.round(expectedValue * 100) / 100,
    riskReward:    riskReward != null ? Math.round(riskReward * 100) / 100 : null,
    distribution:  stat.distribution,
  }
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

/**
 * Crée le fingerprint arrondi d'une configuration de marché.
 *
 * @param {{
 *   ivRank?: number|null,        — 0-100
 *   fundingPct?: number|null,    — % (ex: 0.01 pour 1%)
 *   spreadPct?: number|null,     — % spread bid/ask
 *   lsRatio?: number|null,       — (v2.0: ignored, Binance removed)
 *   basisPct?: number|null,      — basis annualisé en %
 * }} market
 * @returns {{ config: Object, hash: string }}
 */
export function createFingerprint(market) {
  const fb_cfg = FINGERPRINT_BUCKETING
  const config = {
    ivRankBucket:  bucket(market.ivRank, fb_cfg.ivRank),           // par tranches configurées
    fundingBucket: bucket((market.fundingPct ?? 0) * 100, fb_cfg.funding), // par tranches configurées
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

  // Garder max outcomes configurés par pattern
  if (existing.outcomes.length > STORAGE_LIMITS.MAX_OUTCOMES_PER_PATTERN) existing.outcomes.shift()

  await idbSet(key, existing)

  // Maintenir l'index des hashes connus
  const index = (await idbGet('mf_index')) ?? []
  if (!index.includes(fingerprint.hash)) {
    index.push(fingerprint.hash)
    await idbSet('mf_index', index)
  }
}

/**
 * Enregistre le résultat prix à +1h, +4h, +24h, +7d après un snapshot.
 * À appeler périodiquement avec le prix actuel pour mettre à jour les outcomes.
 * Met également à jour les statistiques multi-timeframes agrégées (patternStats).
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

  // Initialise patternStats si absent (migration des données existantes)
  if (!record.patternStats) {
    record.patternStats = {}
    for (const tf of TIMEFRAMES) {
      record.patternStats[tf] = emptyTimeframeStat()
    }
  }

  const now = Date.now()
  const ONE_HOUR  = 3_600_000
  const FOUR_HOURS = 4 * ONE_HOUR
  const ONE_DAY = 24 * ONE_HOUR
  const ONE_WEEK = 7 * ONE_DAY
  const ow = TIMING.outcomeWindows

  record.outcomes = record.outcomes.map(o => {
    const age = now - o.ts
    const ret = o.price > 0 ? ((currentPrice - o.price) / o.price) * 100 : null

    if (!o.result_1h  && age >= ONE_HOUR   && age < ONE_HOUR  + ow.oneHour) {
      o.result_1h  = ret
      if (ret != null) _applyMove(record.patternStats['1h'], ret)
    }
    if (!o.result_4h  && age >= FOUR_HOURS && age < FOUR_HOURS + ow.fourHours) o.result_4h  = ret
    if (!o.result_24h && age >= ONE_DAY    && age < ONE_DAY   + ow.twentyFourHours) {
      o.result_24h = ret
      if (ret != null) _applyMove(record.patternStats['24h'], ret)
    }
    if (!o.result_7d  && age >= ONE_WEEK   && age < ONE_WEEK  + ow.sevenDays) {
      o.result_7d  = ret
      if (ret != null) _applyMove(record.patternStats['7d'], ret)
    }

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
 *   config: Object|null,
 *   patternStats: Object|null   — statistiques multi-timeframes agrégées
 * }>}
 */
/**
 * Retourne tous les patterns enregistrés avec leurs statistiques.
 * Utilise l'index 'mf_index' pour lister les hashes connus.
 * @returns {Promise<Array<{ hash: string, occurrences: number, winRate_1h: number|null, winRate_4h: number|null, avgMove_24h: number|null, config: Object|null }>>}
 */
export async function getAllPatterns() {
  const index = (await idbGet('mf_index')) ?? []
  const patterns = await Promise.all(
    index.map(async hash => {
      const stats = await getPatternStats(hash)
      return { hash, ...stats }
    })
  )
  return patterns.filter(p => p.occurrences > 0)
}

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
    patternStats: record.patternStats ?? null,
    outcomes: record.outcomes ?? [],
  }
}
