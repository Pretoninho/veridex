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
  normalizeDeribitFundingHistory,
  normalizeDeribitDeliveryPrices,
  normalizeDeribitTrades,
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
 * Ticker détaillé d'un instrument (mark price, IV, greeks, OI).
 * Équivalent de get_order_book mais via /public/ticker.
 * @param {string} instrumentName  — ex: 'BTC-28MAR25-80000-C'
 */
export async function getTicker(instrumentName) {
  const result = await apiFetch('ticker', { instrument_name: instrumentName })
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
 * Historique du funding rate du perpetuel (count derniers points).
 * @param {'BTC'|'ETH'} asset
 * @param {number} [count=90]  — nombre de points (1 par 8h)
 */
export async function getFundingRateHistory(asset, count = 90) {
  const end   = Date.now()
  const start = end - count * 8 * 3600 * 1000  // count périodes de 8h
  const result = await apiFetch('get_funding_rate_history', {
    instrument_name: `${asset}-PERPETUAL`,
    start_timestamp: start,
    end_timestamp:   end,
    count,
  })
  const normalized = normalizeDeribitFundingHistory(asset, result)
  if (normalized) dataStore.set(CacheKey.fundingHistory('deribit', asset), normalized)
  return normalized
}

// ── Parser date settlement ─────────────────────────────────────────────────

/**
 * Parse une date Deribit au format '14 Jan 2025' ou '14 Jan 25'
 * et reconstruit le timestamp 08:00 UTC exact.
 * Gère les années à 2 chiffres (ex: '25' → 2025) et la casse variable du mois.
 * @param {string} dateStr
 * @returns {number} timestamp ms
 */
export function _parseSettlementDate(dateStr) {
  if (!dateStr) return Date.now()

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }

  const parts = dateStr.trim().split(/\s+/)
  const day   = parseInt(parts[0], 10)
  const month = MONTHS[parts[1]?.toLowerCase()?.slice(0, 3)]
  let   year  = parseInt(parts[2], 10)

  if (isNaN(day) || month === undefined || isNaN(year)) return Date.now()

  // Normaliser les années à 2 chiffres : '25' → 2025
  if (year < 100) year += 2000

  // Settlement Deribit = 08:00:00 UTC exact
  return new Date(Date.UTC(year, month, day, 8, 0, 0)).getTime()
}

/**
 * Settlement quotidien Deribit (dernier prix de règlement publié).
 * Retourne le prix le plus récent avec timestamp reconstitué à 08:00 UTC.
 * @param {'BTC'|'ETH'} asset
 * @returns {Promise<{ asset, settlementPrice, date, timestamp, source } | null>}
 */
export async function getDailySettlement(asset) {
  const currency = asset.toUpperCase()
  try {
    const result = await apiFetch('get_delivery_prices', {
      index_name: `${currency.toLowerCase()}_usd`,
      count: 5,
    })
    const data = result?.data
    if (!data?.length) return null

    const latest = data[0]
    const settlementPrice = Number(latest.delivery_price)
    if (!isFinite(settlementPrice) || settlementPrice <= 0) return null

    return {
      asset:           currency,
      settlementPrice,
      date:            latest.date,
      timestamp:       _parseSettlementDate(latest.date),
      source:          'deribit',
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn(`[getDailySettlement] ${currency} error:`, err?.message)
    }
    return null
  }
}

/**
 * Prix de livraison / règlement historiques.
 * @param {'BTC'|'ETH'} asset
 * @param {number} [count=20]
 */
export async function getDeliveryPrices(asset, count = 20) {
  const result = await apiFetch('get_delivery_prices', {
    index_name: `${asset.toLowerCase()}_usd`,
    count,
  })
  const normalized = normalizeDeribitDeliveryPrices(asset, result)
  if (normalized) dataStore.set(CacheKey.deliveryPrices('deribit', asset), normalized)
  return normalized
}

/**
 * Derniers trades par currency (futures + options).
 * @param {'BTC'|'ETH'} asset
 * @param {'option'|'future'|'any'} [kind='future']
 * @param {number} [count=30]
 */
export async function getLastTrades(asset, kind = 'future', count = 30) {
  const result = await apiFetch('get_last_trades_by_currency', {
    currency: asset,
    kind,
    count,
  })
  const trades = result?.trades ?? []
  const normalized = normalizeDeribitTrades(asset, trades)
  if (normalized) dataStore.set(CacheKey.trades('deribit', asset), normalized)
  return normalized
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

/**
 * Calcule la base moyenne annualisée sur les contrats futures front (non-perpétuels).
 * @param {'BTC'|'ETH'} asset
 * @param {number|null} spot
 * @returns {Promise<number|null>}
 */
export async function getBasisAvg(asset, spot) {
  if (!spot) return null
  try {
    const futures = await getInstruments(asset, 'future')
    const nonPerp = futures
      .filter(f => !f.instrument_name.includes('PERPETUAL'))
      .slice(0, 4)

    const basisValues = []
    for (const f of nonPerp) {
      try {
        if (f.expiration_timestamp <= Date.now()) continue
        const book = await getOrderBook(f.instrument_name)
        const price = book?.price ?? null
        if (price) {
          const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
          basisValues.push((price - spot) / spot * 100 / days * 365)
        }
      } catch (err) {
        console.warn(`[deribit] getBasisAvg(${f.instrument_name}) failed:`, err?.message)
      }
    }

    if (!basisValues.length) return null
    return basisValues.reduce((a, b) => a + b, 0) / basisValues.length
  } catch (err) {
    console.warn(`[deribit] getBasisAvg(${asset}) failed:`, err?.message)
    return null
  }
}

/**
 * Heure serveur Deribit — synchronisation horloge cross-exchange.
 * Retourne le timestamp en ms (natif Deribit).
 * Timeout réduit à 3s pour ne pas bloquer la sync.
 * @returns {Promise<{ timestamp: number, source: 'deribit' } | null>}
 */
export async function getDeribitTime() {
  try {
    const result = await apiFetch('get_time', {}, 3_000)
    return { timestamp: Number(result), source: 'deribit' }
  } catch {
    return null
  }
}
