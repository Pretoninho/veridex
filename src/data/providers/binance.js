/**
 * providers/binance.js — Provider Binance
 *
 * Couvre : spot, futures (USDT-M), open interest, funding rate.
 * Binance n'a pas d'options listées accessibles publiquement via REST simple,
 * donc ce provider se concentre sur le contexte marché sous-jacent.
 *
 * Docs API :
 *   Spot     : https://binance-docs.github.io/apidocs/spot/en/
 *   Futures  : https://binance-docs.github.io/apidocs/futures/en/
 */

import {
  normalizeBinanceTicker,
  normalizeBinanceFunding,
  normalizeBinanceOI,
  normalizeBinancePremiumIndex,
  normalizeBinanceSentiment,
  normalizeBinanceTakerVolume,
  normalizeBinanceLiquidations,
  normalizeBinanceOptions,
  normalizeBinanceOptionsOI,
} from '../normalizers/format_data.js'
import { dataStore, CacheKey } from '../data_store/cache.js'

const SPOT_BASE    = 'https://api.binance.com'
const FUTURE_BASE  = 'https://fapi.binance.com'
const COINM_BASE   = 'https://dapi.binance.com'
const OPTIONS_BASE = 'https://eapi.binance.com'
const DEFAULT_TIMEOUT_MS = 10_000

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiFetch(baseUrl, path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${baseUrl}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Symboles Binance : BTC → BTCUSDT (futures), BTC-USD (spot)
const toFutureSymbol = asset => `${asset.toUpperCase()}USDT`
const toSpotSymbol   = asset => `${asset.toUpperCase()}USDT`

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Prix spot via ticker 24h (Binance Spot).
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getSpot(asset) {
  const symbol = toSpotSymbol(asset)
  const raw = await apiFetch(SPOT_BASE, '/api/v3/ticker/24hr', { symbol })
  const normalized = normalizeBinanceTicker(raw, 'spot')
  if (normalized) dataStore.set(CacheKey.spot('binance', asset), normalized)
  return normalized
}

/**
 * Prix du perpetuel futures.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getPerp(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/ticker/24hr', { symbol })
  const normalized = normalizeBinanceTicker(raw, 'perp')
  if (normalized) dataStore.set(CacheKey.perp('binance', asset), normalized)
  return normalized
}

/**
 * Funding rate actuel du perpetuel.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getFundingRate(asset) {
  const symbol = toFutureSymbol(asset)
  // Retourne un tableau, on prend le dernier
  const results = await apiFetch(FUTURE_BASE, '/fapi/v1/fundingRate', {
    symbol,
    limit: 1,
  })
  const raw = Array.isArray(results) ? results[0] : results
  const normalized = normalizeBinanceFunding(asset, raw)
  if (normalized) dataStore.set(CacheKey.funding('binance', asset), normalized)
  return normalized
}

/**
 * Open interest futures USDT-M.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getOpenInterest(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/openInterest', { symbol })
  const normalized = normalizeBinanceOI(asset, raw)
  if (normalized) dataStore.set(CacheKey.oi('binance', asset), normalized)
  return normalized
}

/**
 * Klines (OHLCV) — utile pour la volatilité réalisée.
 * @param {'BTC'|'ETH'} asset
 * @param {'1h'|'4h'|'1d'} interval
 * @param {number} limit — nombre de bougies (max 1000)
 * @returns {Array<{ time, open, high, low, close, volume }>}
 */
export async function getKlines(asset, interval = '1d', limit = 30) {
  const symbol = toSpotSymbol(asset)
  const raw = await apiFetch(SPOT_BASE, '/api/v3/klines', { symbol, interval, limit })
  // Binance: [[openTime, open, high, low, close, volume, ...], ...]
  return raw.map(k => ({
    time:   k[0],
    open:   Number(k[1]),
    high:   Number(k[2]),
    low:    Number(k[3]),
    close:  Number(k[4]),
    volume: Number(k[5]),
  }))
}

/**
 * Premium index : mark price + taux funding actuel + prochain funding.
 * Plus complet que getFundingRate (inclut mark price et next funding time).
 * @param {'BTC'|'ETH'} asset
 */
export async function getPremiumIndex(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/premiumIndex', { symbol })
  const normalized = normalizeBinancePremiumIndex(asset, raw)
  if (normalized) {
    dataStore.set(CacheKey.funding('binance', asset), normalized)
    dataStore.set(CacheKey.premiumIndex('binance', asset), normalized)
  }
  return normalized
}

/**
 * Ratio long/short global des comptes futures (sentiment).
 * @param {'BTC'|'ETH'} asset
 * @param {'5m'|'15m'|'30m'|'1h'|'2h'|'4h'|'6h'|'12h'|'1d'} [period='1h']
 */
export async function getLongShortRatio(asset, period = '1h') {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/futures/data/globalLongShortAccountRatio', {
    symbol, period, limit: 1,
  })
  const last = Array.isArray(raw) ? raw[0] : raw
  const normalized = normalizeBinanceSentiment(asset, last)
  if (normalized) dataStore.set(CacheKey.sentiment('binance', asset), normalized)
  return normalized
}

/**
 * Volume buy/sell des takers (pression directionnelle).
 * @param {'BTC'|'ETH'} asset
 * @param {'5m'|'15m'|'30m'|'1h'|'2h'|'4h'|'6h'|'12h'|'1d'} [period='1h']
 */
export async function getTakerVolume(asset, period = '1h') {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/futures/data/takerbuysellvol', {
    symbol, period, limit: 1,
  })
  const last = Array.isArray(raw) ? raw[0] : raw
  const normalized = normalizeBinanceTakerVolume(asset, last)
  if (normalized) dataStore.set(CacheKey.takerVolume('binance', asset), normalized)
  return normalized
}

/**
 * Dernières liquidations forcées (force orders).
 * @param {'BTC'|'ETH'} asset
 */
export async function getLiquidations(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/allForceOrders', { symbol, limit: 20 })
  const orders = Array.isArray(raw) ? raw : []
  const normalized = normalizeBinanceLiquidations(asset, orders)
  if (normalized) dataStore.set(CacheKey.liquidations('binance', asset), normalized)
  return normalized
}

/**
 * Klines (OHLCV) du perpetuel futures USDT-M.
 * @param {'BTC'|'ETH'} asset
 * @param {'1h'|'4h'|'1d'} interval
 * @param {number} limit
 */
export async function getFuturesKlines(asset, interval = '1d', limit = 30) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/klines', { symbol, interval, limit })
  return raw.map(k => ({
    time:   k[0],
    open:   Number(k[1]),
    high:   Number(k[2]),
    low:    Number(k[3]),
    close:  Number(k[4]),
    volume: Number(k[5]),
  }))
}

/**
 * Mark prices + greeks de toutes les options Binance European (eapi).
 * @param {'BTC'|'ETH'} asset
 */
export async function getOptionsChain(asset) {
  const underlying = `${asset.toUpperCase()}USDT`
  const raw = await apiFetch(OPTIONS_BASE, '/eapi/v1/mark', { underlying })
  const marks = Array.isArray(raw) ? raw : []
  const normalized = normalizeBinanceOptions(asset, marks)
  if (normalized) dataStore.set(CacheKey.optionsMark('binance', asset), normalized)
  return normalized
}

/**
 * Open Interest des options Binance European par échéance.
 * @param {'BTC'|'ETH'} asset
 */
export async function getOptionsOI(asset) {
  const underlying = `${asset.toUpperCase()}USDT`
  const raw = await apiFetch(OPTIONS_BASE, '/eapi/v1/openInterest', { underlying })
  const oiData = Array.isArray(raw) ? raw : []
  const normalized = normalizeBinanceOptionsOI(asset, oiData)
  if (normalized) {
    dataStore.set(CacheKey.optionsOI('binance', asset), normalized)
    // Mettre à jour aussi l'OI global
    dataStore.set(CacheKey.oi('binance', asset), normalized)
  }
  return normalized
}

/**
 * Perpetuel Coin-M (BTCUSD_PERP) — exposé en BTC, pas USD.
 * @param {'BTC'|'ETH'} asset
 */
export async function getCoinMPerp(asset) {
  const symbol = `${asset.toUpperCase()}USD_PERP`
  const raw = await apiFetch(COINM_BASE, '/dapi/v1/ticker/24hr', { symbol })
  const ticker = Array.isArray(raw) ? raw[0] : raw
  const normalized = normalizeBinanceTicker(ticker, 'perp')
  if (normalized) dataStore.set(CacheKey.perp('binance-coinm', asset), normalized)
  return normalized
}

/**
 * Heure serveur Binance — synchronisation horloge cross-exchange.
 * Retourne le timestamp en ms (natif Binance : champ serverTime).
 * Timeout réduit à 3s pour ne pas bloquer la sync.
 * @returns {Promise<{ timestamp: number, source: 'binance' } | null>}
 */
export async function getBinanceTime() {
  try {
    const raw = await apiFetch(SPOT_BASE, '/api/v3/time', {}, 3_000)
    return { timestamp: Number(raw.serverTime), source: 'binance' }
  } catch {
    return null
  }
}

/**
 * Snapshot marché Binance : spot + perp + funding + OI
 * @param {'BTC'|'ETH'} asset
 */
export async function getMarketSnapshot(asset) {
  const [spot, perp, funding, oi] = await Promise.allSettled([
    getSpot(asset),
    getPerp(asset),
    getPremiumIndex(asset),
    getOpenInterest(asset),
  ])

  return {
    spot:    spot.status    === 'fulfilled' ? spot.value    : null,
    perp:    perp.status    === 'fulfilled' ? perp.value    : null,
    funding: funding.status === 'fulfilled' ? funding.value : null,
    oi:      oi.status      === 'fulfilled' ? oi.value      : null,
  }
}
