/**
 * providers/deribit.js — Provider Deribit
 *
 * Encapsule tous les appels REST à l'API publique Deribit.
 * Retourne toujours des données normalisées via format_data.js.
 * Met à jour le dataStore automatiquement.
 *
 * Docs API : https://docs.deribit.com/
 */

import {
  normalizeDeribitSpot,
  normalizeDeribitOrderBook,
  normalizeDeribitOption,
  normalizeDeribitDVOL,
  normalizeDeribitFunding,
  normalizeDeribitOI,
} from '../normalizers/format_data.js'
import { dataStore, CacheKey } from '../data_store/cache.js'

const BASE_URL = 'https://www.deribit.com/api/v2/public'
const DEFAULT_TIMEOUT_MS = 15_000

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiFetch(endpoint, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${BASE_URL}/${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${endpoint}`)
    const json = await res.json()
    if (json.error) throw new Error(`Deribit error ${json.error.code}: ${json.error.message}`)
    return json.result
  } finally {
    clearTimeout(timer)
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Prix spot (index) d'un asset.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getSpot(asset) {
  const result = await apiFetch('get_index_price', { index_name: `${asset.toLowerCase()}_usd` })
  const normalized = normalizeDeribitSpot(asset, result)
  dataStore.set(CacheKey.spot('deribit', asset), normalized)
  return normalized
}

/**
 * Liste des instruments (options ou futures actifs).
 * @param {'BTC'|'ETH'|'SOL'} asset
 * @param {'option'|'future'|'spot'} kind
 */
export async function getInstruments(asset, kind = 'option') {
  const result = await apiFetch('get_instruments', {
    currency: asset,
    kind,
    expired: false,
  })
  const instruments = result ?? []
  dataStore.set(CacheKey.instruments('deribit', asset), {
    source: 'deribit',
    asset,
    kind,
    instruments,
    timestamp: Date.now(),
  })
  return instruments
}

/**
 * Carnet d'ordres d'un instrument.
 * Retourne un NormalizedOption pour les options, NormalizedTicker pour les autres.
 * @param {string} instrumentName  — ex: 'BTC-28MAR25-80000-C'
 * @param {number} [depth=1]
 */
export async function getOrderBook(instrumentName, depth = 1) {
  const result = await apiFetch('get_order_book', {
    instrument_name: instrumentName,
    depth,
  })

  const isOption = instrumentName.endsWith('-C') || instrumentName.endsWith('-P')
  const normalized = isOption
    ? normalizeDeribitOption(result)
    : normalizeDeribitOrderBook(result)

  if (normalized) {
    const asset = instrumentName.split('-')[0]
    const key = isOption
      ? CacheKey.option('deribit', asset, instrumentName)
      : CacheKey.future('deribit', asset, instrumentName)
    dataStore.set(key, normalized)
  }

  return normalized
}

/**
 * Données DVOL (indice de volatilité implicite, équivalent VIX) — 30j.
 * @param {'BTC'|'ETH'} asset
 */
export async function getDVOL(asset) {
  const end = Date.now()
  const start = end - 30 * 24 * 3600 * 1000
  const result = await apiFetch('get_volatility_index_data', {
    currency: asset,
    start_timestamp: start,
    end_timestamp: end,
    resolution: 3600,
  })
  const normalized = normalizeDeribitDVOL(asset, result)
  if (normalized) dataStore.set(CacheKey.dvol('deribit', asset), normalized)
  return normalized
}

/**
 * Funding rate du perpetuel.
 * @param {'BTC'|'ETH'} asset
 */
export async function getFundingRate(asset) {
  const instrument = `${asset}-PERPETUAL`
  const results = await apiFetch('get_book_summary_by_instrument', {
    instrument_name: instrument,
  })
  const raw = Array.isArray(results) ? results[0] : results
  const normalized = normalizeDeribitFunding(asset, raw)
  if (normalized) dataStore.set(CacheKey.funding('deribit', asset), normalized)
  return normalized
}

/**
 * Open Interest total sur les options.
 * @param {'BTC'|'ETH'} asset
 */
export async function getOpenInterest(asset) {
  const results = await apiFetch('get_book_summary_by_currency', {
    currency: asset,
    kind: 'option',
  })
  const normalized = normalizeDeribitOI(asset, results)
  if (normalized) dataStore.set(CacheKey.oi('deribit', asset), normalized)
  return normalized
}

/**
 * Volatilité réalisée historique (30j).
 * @param {'BTC'|'ETH'} asset
 * @returns {{ source, asset, current, avg30, history, timestamp }}
 */
export async function getRealizedVol(asset) {
  const result = await apiFetch('get_historical_volatility', { currency: asset })
  if (!result?.length) return null
  const latest = result[result.length - 1][1]
  const avg30 = result.slice(-30).reduce((s, r) => s + r[1], 0) / Math.min(30, result.length)

  const normalized = {
    source: 'deribit',
    asset: asset.toUpperCase(),
    current: latest,
    avg30,
    history: result.slice(-30),
    timestamp: Date.now(),
  }
  dataStore.set(CacheKey.rv('deribit', asset), normalized)
  return normalized
}

/**
 * Snapshot complet d'un asset : spot + DVOL + funding + OI + RV
 * Utile pour un chargement initial groupé.
 * @param {'BTC'|'ETH'} asset
 */
export async function getMarketSnapshot(asset) {
  const [spot, dvol, funding, oi, rv] = await Promise.allSettled([
    getSpot(asset),
    getDVOL(asset),
    getFundingRate(asset),
    getOpenInterest(asset),
    getRealizedVol(asset),
  ])

  return {
    spot: spot.status === 'fulfilled' ? spot.value : null,
    dvol: dvol.status === 'fulfilled' ? dvol.value : null,
    funding: funding.status === 'fulfilled' ? funding.value : null,
    oi: oi.status === 'fulfilled' ? oi.value : null,
    rv: rv.status === 'fulfilled' ? rv.value : null,
  }
}

/**
 * Toutes les échéances disponibles pour un asset, triées chronologiquement.
 * @param {Object[]} instruments — liste brute de get_instruments
 */
export function extractExpiries(instruments) {
  const ts = [...new Set(
    instruments
      .map(i => i.expiration_timestamp)
      .filter(t => Number.isFinite(t))
  )]
  return ts.sort((a, b) => a - b)
}
