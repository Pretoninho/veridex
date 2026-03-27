/**
 * backend/data_core/providers/binance.js
 *
 * Provider Binance — adapté de src/data/providers/binance.js.
 * Dépendances navigateur supprimées (dataStore, idb-keyval).
 * Couvre : spot, futures USDT-M, options European, sentiment, liquidations.
 */

'use strict'

const {
  normalizeBinanceTicker,
  normalizeBinanceFunding,
  normalizeBinanceOI,
  normalizeBinancePremiumIndex,
  normalizeBinanceSentiment,
  normalizeBinanceTakerVolume,
  normalizeBinanceLiquidations,
  normalizeBinanceOptions,
  normalizeBinanceOptionsOI,
} = require('../normalizers/format_data')

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

const toFutureSymbol = asset => `${asset.toUpperCase()}USDT`
const toSpotSymbol   = asset => `${asset.toUpperCase()}USDT`

// ── Endpoints ─────────────────────────────────────────────────────────────────

async function getSpot(asset) {
  const symbol = toSpotSymbol(asset)
  const raw = await apiFetch(SPOT_BASE, '/api/v3/ticker/24hr', { symbol })
  return normalizeBinanceTicker(raw, 'spot')
}

async function getPerp(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/ticker/24hr', { symbol })
  return normalizeBinanceTicker(raw, 'perp')
}

async function getFundingRate(asset) {
  const symbol = toFutureSymbol(asset)
  const results = await apiFetch(FUTURE_BASE, '/fapi/v1/fundingRate', {
    symbol,
    limit: 1,
  })
  const raw = Array.isArray(results) ? results[0] : results
  return normalizeBinanceFunding(asset, raw)
}

async function getOpenInterest(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/openInterest', { symbol })
  return normalizeBinanceOI(asset, raw)
}

async function getKlines(asset, interval = '1d', limit = 30) {
  const symbol = toSpotSymbol(asset)
  const raw = await apiFetch(SPOT_BASE, '/api/v3/klines', { symbol, interval, limit })
  return raw.map(k => ({
    time:   k[0],
    open:   Number(k[1]),
    high:   Number(k[2]),
    low:    Number(k[3]),
    close:  Number(k[4]),
    volume: Number(k[5]),
  }))
}

async function getPremiumIndex(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/premiumIndex', { symbol })
  return normalizeBinancePremiumIndex(asset, raw)
}

async function getLongShortRatio(asset, period = '1h') {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/futures/data/globalLongShortAccountRatio', {
    symbol, period, limit: 1,
  })
  const last = Array.isArray(raw) ? raw[0] : raw
  return normalizeBinanceSentiment(asset, last)
}

async function getTakerVolume(asset, period = '1h') {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/futures/data/takerbuysellvol', {
    symbol, period, limit: 1,
  })
  const last = Array.isArray(raw) ? raw[0] : raw
  return normalizeBinanceTakerVolume(asset, last)
}

async function getLiquidations(asset) {
  const symbol = toFutureSymbol(asset)
  const raw = await apiFetch(FUTURE_BASE, '/fapi/v1/allForceOrders', { symbol, limit: 20 })
  const orders = Array.isArray(raw) ? raw : []
  return normalizeBinanceLiquidations(asset, orders)
}

async function getFuturesKlines(asset, interval = '1d', limit = 30) {
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

async function getOptionsChain(asset) {
  const underlying = `${asset.toUpperCase()}USDT`
  const raw = await apiFetch(OPTIONS_BASE, '/eapi/v1/mark', { underlying })
  const marks = Array.isArray(raw) ? raw : []
  return normalizeBinanceOptions(asset, marks)
}

async function getOptionsOI(asset) {
  const underlying = `${asset.toUpperCase()}USDT`
  const raw = await apiFetch(OPTIONS_BASE, '/eapi/v1/openInterest', { underlying })
  const oiData = Array.isArray(raw) ? raw : []
  return normalizeBinanceOptionsOI(asset, oiData)
}

async function getCoinMPerp(asset) {
  const symbol = `${asset.toUpperCase()}USD_PERP`
  const raw = await apiFetch(COINM_BASE, '/dapi/v1/ticker/24hr', { symbol })
  const ticker = Array.isArray(raw) ? raw[0] : raw
  return normalizeBinanceTicker(ticker, 'perp')
}

async function getBinanceTime() {
  try {
    const raw = await apiFetch(SPOT_BASE, '/api/v3/time', {}, 3_000)
    return { timestamp: Number(raw.serverTime), source: 'binance' }
  } catch {
    return null
  }
}

async function getMarketSnapshot(asset) {
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

module.exports = {
  getSpot,
  getPerp,
  getFundingRate,
  getOpenInterest,
  getKlines,
  getPremiumIndex,
  getLongShortRatio,
  getTakerVolume,
  getLiquidations,
  getFuturesKlines,
  getOptionsChain,
  getOptionsOI,
  getCoinMPerp,
  getBinanceTime,
  getMarketSnapshot,
}
