/**
 * hash_search.js — Moteur de recherche unifié sur les hashes Veridex
 *
 * Sources indexées :
 *   1. Signaux     → IndexedDB 'signal_history'
 *   2. Cache log   → IndexedDB 'cache_changelog'
 *   3. Anomalies   → localStorage 'veridex_anomaly_log'
 *   4. Settlements → IndexedDB 'settlement_history_BTC' / 'settlement_history_ETH'
 *
 * Lecture seule. Aucun appel API. Aucun signal généré.
 */

import { get as idbGet } from 'idb-keyval'

// ── Chargement des sources ────────────────────────────────────────────────────

async function _loadSignals() {
  try {
    return (await idbGet('signal_history')) ?? []
  } catch (_) { return [] }
}

async function _loadCacheLog() {
  try {
    return (await idbGet('cache_changelog')) ?? []
  } catch (_) { return [] }
}

function _loadAnomalyLog() {
  try {
    return JSON.parse(localStorage.getItem('veridex_anomaly_log') || '[]')
  } catch (_) { return [] }
}

async function _loadSettlements() {
  try {
    const [btc, eth] = await Promise.all([
      idbGet('settlement_history_BTC').catch(() => []),
      idbGet('settlement_history_ETH').catch(() => []),
    ])
    return [...(btc ?? []), ...(eth ?? [])]
      .sort((a, b) => b.capturedAt - a.capturedAt)
  } catch (_) { return [] }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function _normalizeSignal(s) {
  return {
    id:       s.hash,
    type:     'signal',
    hash:     s.hash,
    ts:       s.timestamp,
    date:     new Date(s.timestamp).toISOString().slice(0, 10),
    hour:     new Date(s.timestamp).getHours(),
    asset:    s.asset ?? null,
    label:    [
      s.recommendation ?? '',
      s.asset ?? '',
      `score:${s.score}`,
      JSON.stringify(s.conditions ?? {}),
    ].join(' ').toLowerCase(),
    score:    s.score ?? null,
    severity: null,
    raw:      s,
  }
}

function _normalizeCacheEntry(c) {
  return {
    id:       `${c.hash}_${c.ts}`,
    type:     'cache',
    hash:     c.hash,
    ts:       c.ts,
    date:     new Date(c.ts).toISOString().slice(0, 10),
    hour:     new Date(c.ts).getHours(),
    asset:    null,
    label:    (c.key ?? '').toLowerCase(),
    score:    null,
    severity: null,
    raw:      c,
  }
}

function _normalizeAnomaly(a) {
  return {
    id:       a.hash,
    type:     'anomaly',
    hash:     a.hash,
    ts:       a.timestamp,
    date:     new Date(a.timestamp).toISOString().slice(0, 10),
    hour:     new Date(a.timestamp).getHours(),
    asset:    a.asset ?? null,
    label:    [
      a.severity ?? '',
      ...(a.changedIndicators ?? []),
    ].join(' ').toLowerCase(),
    score:    null,
    severity: a.severity ?? null,
    raw:      a,
  }
}

function _normalizeSettlement(s) {
  return {
    id:       s.hash,
    type:     'settlement',
    hash:     s.hash,
    ts:       s.capturedAt,
    date:     s.dateKey,
    hour:     8,   // toujours 08:00 UTC
    asset:    s.asset,
    label:    [
      'settlement',
      s.asset?.toLowerCase() ?? '',
      `price:${s.settlementPrice}`,
      s.settlementDate ? s.settlementDate.toLowerCase() : '',
      s.isLate ? 'late' : 'ontime',
    ].join(' '),
    score:    null,
    severity: null,
    raw:      s,
  }
}

// ── Index ─────────────────────────────────────────────────────────────────────

/**
 * Construit l'index de recherche unifié depuis les 3 sources.
 * @returns {Promise<Array>}
 */
export async function buildSearchIndex() {
  const [signals, cacheLog, anomalyLog, settlements] = await Promise.all([
    _loadSignals(),
    _loadCacheLog(),
    Promise.resolve(_loadAnomalyLog()),
    _loadSettlements(),
  ])

  const entries = [
    ...signals.map(_normalizeSignal),
    ...cacheLog.map(_normalizeCacheEntry),
    ...anomalyLog.map(_normalizeAnomaly),
    ...settlements.map(_normalizeSettlement),
  ]

  entries.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  return entries
}

// ── Filtres ───────────────────────────────────────────────────────────────────

/**
 * Filtre par hash (partiel ou complet).
 * @param {Array} entries
 * @param {string} query
 * @returns {Array}
 */
export function filterByHash(entries, query) {
  if (!query?.trim()) return entries
  const q = query.trim().toLowerCase()
  return entries.filter(e => e.hash?.toLowerCase().includes(q))
}

/**
 * Filtre par plage de dates au format 'YYYY-MM-DD'.
 * @param {Array} entries
 * @param {string} dateFrom
 * @param {string} dateTo
 * @returns {Array}
 */
export function filterByDate(entries, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return entries
  return entries.filter(e => {
    if (dateFrom && e.date < dateFrom) return false
    if (dateTo   && e.date > dateTo)   return false
    return true
  })
}

/**
 * Filtre par événement (texte libre sur label, type, asset, severity).
 * @param {Array} entries
 * @param {string} query
 * @returns {Array}
 */
export function filterByEvent(entries, query) {
  if (!query?.trim()) return entries
  const q = query.trim().toLowerCase()
  return entries.filter(e =>
    e.label?.includes(q) ||
    e.type?.includes(q) ||
    e.asset?.toLowerCase().includes(q) ||
    e.severity?.toLowerCase().includes(q)
  )
}

/**
 * Applique tous les filtres en combinaison.
 * @param {Array} entries
 * @param {{
 *   hashQuery?:  string,
 *   dateFrom?:   string,
 *   dateTo?:     string,
 *   eventQuery?: string,
 *   types?:      string[],
 *   asset?:      string,
 * }} filters
 * @returns {Array}
 */
export function applyFilters(entries, {
  hashQuery  = '',
  dateFrom   = '',
  dateTo     = '',
  eventQuery = '',
  types      = [],
  asset      = '',
} = {}) {
  let result = entries

  if (types.length > 0) {
    result = result.filter(e => types.includes(e.type))
  }

  if (asset) {
    result = result.filter(e => !e.asset || e.asset === asset.toUpperCase())
  }

  if (hashQuery)           result = filterByHash(result, hashQuery)
  if (dateFrom || dateTo)  result = filterByDate(result, dateFrom, dateTo)
  if (eventQuery)          result = filterByEvent(result, eventQuery)

  return result
}
