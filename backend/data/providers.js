/**
 * backend/data/providers.js
 *
 * Fetches market data from Deribit and Binance REST APIs.
 * Returns normalized structures compatible with signalEngine.js.
 *
 * Requires Node.js >= 18 (native fetch).
 */

'use strict'

const { SmartCache } = require('../utils/cache')

// 30-second TTL — market data refreshes quickly but not faster than one poll cycle
const _cache = new SmartCache({ ttlMs: 30_000 })

const DERIBIT_BASE = 'https://www.deribit.com/api/v2/public'
const BINANCE_FUTURE_BASE = 'https://fapi.binance.com'
const DEFAULT_TIMEOUT_MS = 15_000

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function deribitFetch(endpoint, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${DERIBIT_BASE}/${endpoint}`)
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

async function binanceFetch(path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${BINANCE_FUTURE_BASE}${path}`)
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

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeDeribitSpot(asset, raw) {
  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    price: raw?.index_price ?? null,
    timestamp: Date.now(),
  }
}

function normalizeDeribitDVOL(asset, raw) {
  if (!raw?.data?.length) return null
  const data = raw.data // [[ts, open, high, low, close], ...]
  const latest = data[data.length - 1][4]
  const weekAgo = data[Math.max(0, data.length - 168)]?.[4] ?? null
  const monthMin = Math.min(...data.map(r => r[3]))
  const monthMax = Math.max(...data.map(r => r[2]))
  const history = data.slice(-72).map(r => [r[0], r[4]])

  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    current: latest,
    weekAgo,
    monthMin,
    monthMax,
    history,
    timestamp: Date.now(),
  }
}

function normalizeDeribitFunding(asset, raw) {
  if (!raw) return null
  const rate8h = raw.funding_8h != null
    ? raw.funding_8h * 100
    : (raw.current_funding != null ? raw.current_funding * 100 : null)
  const rateAnn = rate8h != null ? rate8h * 3 * 365 : null

  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    rate8h,
    rateAnn,
    bullish: rateAnn != null ? rateAnn > 0 : null,
    timestamp: Date.now(),
  }
}

function normalizeDeribitOI(asset, rawResults) {
  if (!rawResults?.length) return null
  const total = rawResults.reduce((s, r) => s + (r.open_interest ?? 0), 0)
  const callOI = rawResults
    .filter(r => r.instrument_name?.endsWith('-C'))
    .reduce((s, r) => s + (r.open_interest ?? 0), 0)
  const putOI = rawResults
    .filter(r => r.instrument_name?.endsWith('-P'))
    .reduce((s, r) => s + (r.open_interest ?? 0), 0)

  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    total,
    callOI,
    putOI,
    putCallRatio: callOI > 0 ? putOI / callOI : null,
    timestamp: Date.now(),
  }
}

function normalizeBinanceSentiment(asset, raw) {
  if (!raw) return null
  const lsRatio = raw.longShortRatio != null ? Number(raw.longShortRatio) : null

  return {
    source: 'binance',
    asset: asset.toUpperCase(),
    lsRatio,
    timestamp: raw.timestamp ?? Date.now(),
  }
}

// ── Deribit providers ─────────────────────────────────────────────────────────

/**
 * Spot price (index) for an asset.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
async function getSpot(asset) {
  const result = await deribitFetch('get_index_price', { index_name: `${asset.toLowerCase()}_usd` })
  return normalizeDeribitSpot(asset, result)
}

/**
 * DVOL (implied volatility index, 30-day window).
 * @param {'BTC'|'ETH'} asset
 */
async function getDVOL(asset) {
  const end = Date.now()
  const start = end - 30 * 24 * 3600 * 1000
  const result = await deribitFetch('get_volatility_index_data', {
    currency: asset,
    start_timestamp: start,
    end_timestamp: end,
    resolution: 3600,
  })
  return normalizeDeribitDVOL(asset, result)
}

/**
 * Funding rate of the perpetual contract.
 * @param {'BTC'|'ETH'} asset
 */
async function getFundingRate(asset) {
  const results = await deribitFetch('get_book_summary_by_instrument', {
    instrument_name: `${asset}-PERPETUAL`,
  })
  const raw = Array.isArray(results) ? results[0] : results
  return normalizeDeribitFunding(asset, raw)
}

/**
 * Realized volatility (30-day historical).
 * @param {'BTC'|'ETH'} asset
 */
async function getRealizedVol(asset) {
  const result = await deribitFetch('get_historical_volatility', { currency: asset })
  if (!result?.length) return null
  const latest = result[result.length - 1][1]
  const avg30 = result.slice(-30).reduce((s, r) => s + r[1], 0) / Math.min(30, result.length)

  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    current: latest,
    avg30,
    history: result.slice(-30),
    timestamp: Date.now(),
  }
}

/**
 * List of active instruments (futures or options).
 * @param {'BTC'|'ETH'} asset
 * @param {'option'|'future'} kind
 */
async function getInstruments(asset, kind = 'future') {
  const result = await deribitFetch('get_instruments', {
    currency: asset,
    kind,
    expired: false,
  })
  return result ?? []
}

/**
 * Mark price of a single futures instrument.
 * @param {string} instrumentName
 */
async function getFuturePrice(instrumentName) {
  const result = await deribitFetch('get_order_book', {
    instrument_name: instrumentName,
    depth: 1,
  })
  return result?.mark_price ?? null
}

/**
 * Open Interest breakdown (calls vs puts) — for P/C ratio.
 * @param {'BTC'|'ETH'} asset
 */
async function getOpenInterest(asset) {
  const results = await deribitFetch('get_book_summary_by_currency', {
    currency: asset,
    kind: 'option',
  })
  return normalizeDeribitOI(asset, results)
}

/**
 * Compute average annualized basis from front futures contracts.
 * @param {'BTC'|'ETH'} asset
 * @param {number} spot — current spot price
 * @returns {Promise<number|null>}
 */
async function getBasisAvg(asset, spot) {
  if (!spot) return null
  try {
    const futures = await getInstruments(asset, 'future')
    const nonPerp = futures
      .filter(f => !f.instrument_name.includes('PERPETUAL'))
      .slice(0, 4)

    const basisValues = []
    for (const f of nonPerp) {
      try {
        const price = await getFuturePrice(f.instrument_name)
        if (price) {
          const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
          basisValues.push((price - spot) / spot * 100 / days * 365)
        }
      } catch (err) {
        console.warn(`[providers] getFuturePrice(${f.instrument_name}) failed:`, err?.message)
      }
    }

    if (!basisValues.length) return null
    return basisValues.reduce((a, b) => a + b, 0) / basisValues.length
  } catch (err) {
    console.warn(`[providers] getBasisAvg(${asset}) failed:`, err?.message)
    return null
  }
}

// ── Binance providers ─────────────────────────────────────────────────────────

/**
 * Global long/short account ratio for futures.
 * @param {'BTC'|'ETH'} asset
 * @param {'5m'|'15m'|'1h'|'4h'|'1d'} [period='1h']
 */
async function getLongShortRatio(asset, period = '1h') {
  const symbol = `${asset.toUpperCase()}USDT`
  const raw = await binanceFetch('/futures/data/globalLongShortAccountRatio', {
    symbol,
    period,
    limit: 1,
  })
  const last = Array.isArray(raw) ? raw[0] : raw
  return normalizeBinanceSentiment(asset, last)
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * Fetch all market data needed for signal computation.
 * @param {'BTC'|'ETH'} asset
 * @returns {Promise<{spot, dvol, funding, rv, basisAvg, lsRatio, pcRatio}>}
 */
async function getMarketData(asset) {
  const cacheKey = `market:${asset.toUpperCase()}`

  return _cache.getOrFetch(cacheKey, async () => {
    const [spotResult, dvolResult, fundingResult, rvResult, oiResult, lsResult] =
      await Promise.allSettled([
        getSpot(asset),
        getDVOL(asset),
        getFundingRate(asset),
        getRealizedVol(asset),
        getOpenInterest(asset),
        getLongShortRatio(asset),
      ])

    const spot = spotResult.status === 'fulfilled' ? spotResult.value?.price ?? null : null
    const dvol = dvolResult.status === 'fulfilled' ? dvolResult.value : null
    const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : null
    const rv = rvResult.status === 'fulfilled' ? rvResult.value : null
    const oi = oiResult.status === 'fulfilled' ? oiResult.value : null
    const ls = lsResult.status === 'fulfilled' ? lsResult.value : null

    const basisAvg = await getBasisAvg(asset, spot).catch(() => null)

    return {
      spot,
      dvol,
      funding,
      rv,
      basisAvg,
      lsRatio: ls?.lsRatio ?? null,
      pcRatio: oi?.putCallRatio ?? null,
    }
  })
}

module.exports = { getMarketData }
