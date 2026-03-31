/**
 * backend/data_core/providers/deribit.js
 *
 * Provider Deribit — adapté de src/data/providers/deribit.js.
 * Dépendances navigateur supprimées (dataStore, idb-keyval).
 * Retourne des données normalisées via format_data.js.
 */

'use strict'

const {
  normalizeDeribitSpot,
  normalizeDeribitOrderBook,
  normalizeDeribitOption,
  normalizeDeribitDVOL,
  normalizeDeribitFunding,
  normalizeDeribitOI,
  normalizeDeribitFundingHistory,
  normalizeDeribitDeliveryPrices,
  normalizeDeribitTrades,
} = require('../normalizers/format_data')

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

async function getSpot(asset) {
  const result = await apiFetch('get_index_price', { index_name: `${asset.toLowerCase()}_usd` })
  return normalizeDeribitSpot(asset, result)
}

async function getInstruments(asset, kind = 'option') {
  const result = await apiFetch('get_instruments', {
    currency: asset,
    kind,
    expired: false,
  })
  return result ?? []
}

async function getOrderBook(instrumentName, depth = 1) {
  const result = await apiFetch('get_order_book', {
    instrument_name: instrumentName,
    depth,
  })
  const isOption = instrumentName.endsWith('-C') || instrumentName.endsWith('-P')
  return isOption ? normalizeDeribitOption(result) : normalizeDeribitOrderBook(result)
}

async function getDVOL(asset) {
  const end = Date.now()
  const start = end - 30 * 24 * 3600 * 1000
  const result = await apiFetch('get_volatility_index_data', {
    currency: asset,
    start_timestamp: start,
    end_timestamp: end,
    resolution: 3600,
  })
  return normalizeDeribitDVOL(asset, result)
}

const TIMEFRAME_CONFIG = {
  '4h': { resolution: 14_400, windowMs: 14 * 24 * 3600 * 1000 },
  '1h': { resolution: 3_600, windowMs: 7 * 24 * 3600 * 1000 },
  '5m': { resolution: 300, windowMs: 2 * 24 * 3600 * 1000 },
}

function _pctDelta(from, to) {
  if (!isFinite(from) || !isFinite(to) || from === 0) return null
  return ((to - from) / from) * 100
}

function _computeCandlesMetrics(candles) {
  if (!candles?.length) {
    return {
      trend: { direction: 'NEUTRAL', slopePct: null },
      range: { pct: null },
      spike: { detected: false, strength: 0 },
      price_action: { last: null, changePct: null },
      volume: { last: null, avg: null, ratio: null },
      breakout_flags: { up: false, down: false },
      oi_delta: { value: null, pct: null },
    }
  }

  const closes = candles.map(c => c.close).filter(Number.isFinite)
  const highs = candles.map(c => c.high).filter(Number.isFinite)
  const lows = candles.map(c => c.low).filter(Number.isFinite)
  const volumes = candles.map(c => c.volume).filter(Number.isFinite)
  const oiSeries = candles.map(c => c.openInterest).filter(Number.isFinite)

  const lastClose = closes.at(-1) ?? null
  const firstClose = closes[0] ?? null
  const changePct = _pctDelta(firstClose, lastClose)

  const slopePct = closes.length >= 8
    ? _pctDelta(closes[Math.max(0, closes.length - 8)], lastClose)
    : changePct

  const direction = slopePct == null
    ? 'NEUTRAL'
    : slopePct > 0.75
    ? 'UP'
    : slopePct < -0.75
    ? 'DOWN'
    : 'SIDEWAYS'

  const maxHigh = highs.length ? Math.max(...highs) : null
  const minLow = lows.length ? Math.min(...lows) : null
  const rangePct = (isFinite(maxHigh) && isFinite(minLow) && isFinite(lastClose) && lastClose !== 0)
    ? ((maxHigh - minLow) / lastClose) * 100
    : null

  const recentCandles = candles.slice(-20)
  const recentHigh = Math.max(...recentCandles.map(c => c.high).filter(Number.isFinite))
  const recentLow = Math.min(...recentCandles.map(c => c.low).filter(Number.isFinite))
  const prevClose = closes.length > 1 ? closes[closes.length - 2] : null

  const lastCandle = candles.at(-1)
  const candleRanges = candles
    .map(c => (isFinite(c.high) && isFinite(c.low) && c.low !== 0 ? (c.high - c.low) / c.low : null))
    .filter(Number.isFinite)
  const avgCandleRange = candleRanges.length
    ? candleRanges.reduce((s, x) => s + x, 0) / candleRanges.length
    : null
  const lastCandleRange = isFinite(lastCandle?.high) && isFinite(lastCandle?.low) && lastCandle.low !== 0
    ? (lastCandle.high - lastCandle.low) / lastCandle.low
    : null
  const spikeDetected = isFinite(lastCandleRange) && isFinite(avgCandleRange)
    ? lastCandleRange > avgCandleRange * 1.8
    : false

  const avgVol = volumes.length ? volumes.reduce((s, x) => s + x, 0) / volumes.length : null
  const lastVol = volumes.at(-1) ?? null
  const volRatio = isFinite(avgVol) && avgVol > 0 && isFinite(lastVol) ? lastVol / avgVol : null

  const oiFirst = oiSeries[0] ?? null
  const oiLast = oiSeries.at(-1) ?? null
  const oiPct = _pctDelta(oiFirst, oiLast)

  return {
    trend: { direction, slopePct },
    range: { pct: rangePct },
    spike: { detected: spikeDetected, strength: (lastCandleRange ?? 0) / (avgCandleRange || 1) },
    oi_delta: { value: isFinite(oiFirst) && isFinite(oiLast) ? oiLast - oiFirst : null, pct: oiPct },
    price_action: { last: lastClose, prev: prevClose, changePct },
    volume: { last: lastVol, avg: avgVol, ratio: volRatio },
    breakout_flags: {
      up: isFinite(lastClose) && isFinite(recentHigh) ? lastClose >= recentHigh : false,
      down: isFinite(lastClose) && isFinite(recentLow) ? lastClose <= recentLow : false,
    },
  }
}

async function getDVOLForTimeframe(asset, timeframe) {
  const cfg = TIMEFRAME_CONFIG[timeframe]
  if (!cfg) throw new Error(`Unsupported timeframe "${timeframe}"`)

  const end = Date.now()
  const start = end - cfg.windowMs
  const result = await apiFetch('get_volatility_index_data', {
    currency: asset,
    start_timestamp: start,
    end_timestamp: end,
    resolution: cfg.resolution,
  })
  return normalizeDeribitDVOL(asset, result)
}

async function getPerpChartData(asset, timeframe) {
  const cfg = TIMEFRAME_CONFIG[timeframe]
  if (!cfg) throw new Error(`Unsupported timeframe "${timeframe}"`)

  const end = Date.now()
  const start = end - cfg.windowMs
  const result = await apiFetch('get_tradingview_chart_data', {
    instrument_name: `${asset}-PERPETUAL`,
    start_timestamp: start,
    end_timestamp: end,
    resolution: String(cfg.resolution),
  })

  const ticks = Array.isArray(result?.ticks) ? result.ticks : []
  const open = Array.isArray(result?.open) ? result.open : []
  const high = Array.isArray(result?.high) ? result.high : []
  const low = Array.isArray(result?.low) ? result.low : []
  const close = Array.isArray(result?.close) ? result.close : []
  const volume = Array.isArray(result?.volume) ? result.volume : []
  const openInterest = Array.isArray(result?.open_interest) ? result.open_interest : []

  return ticks.map((ts, i) => ({
    timestamp: ts,
    open: Number(open[i]),
    high: Number(high[i]),
    low: Number(low[i]),
    close: Number(close[i]),
    volume: Number(volume[i]),
    openInterest: Number(openInterest[i]),
  })).filter(c => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low))
}

async function getTimeframeData(asset, timeframe) {
  const [dvolResult, fundingResult, candlesResult] = await Promise.allSettled([
    getDVOLForTimeframe(asset, timeframe),
    getFundingRate(asset),
    getPerpChartData(asset, timeframe),
  ])

  const dvol = dvolResult.status === 'fulfilled' ? dvolResult.value : null
  const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : null
  const candles = candlesResult.status === 'fulfilled' ? candlesResult.value : []
  const metrics = _computeCandlesMetrics(candles)

  return {
    timeframe,
    dvol,
    trend: metrics.trend,
    range: metrics.range,
    spike: metrics.spike,
    oi_delta: metrics.oi_delta,
    funding,
    price_action: metrics.price_action,
    volume: metrics.volume,
    breakout_flags: metrics.breakout_flags,
    candles,
    timestamp: Date.now(),
  }
}

async function getFundingRate(asset) {
  const instrument = `${asset}-PERPETUAL`
  const results = await apiFetch('get_book_summary_by_instrument', {
    instrument_name: instrument,
  })
  const raw = Array.isArray(results) ? results[0] : results
  return normalizeDeribitFunding(asset, raw)
}

async function getOpenInterest(asset) {
  const results = await apiFetch('get_book_summary_by_currency', {
    currency: asset,
    kind: 'option',
  })
  return normalizeDeribitOI(asset, results)
}

async function getRealizedVol(asset) {
  const result = await apiFetch('get_historical_volatility', { currency: asset })
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

async function getMarketSnapshot(asset) {
  const [spot, dvol, funding, oi, rv] = await Promise.allSettled([
    getSpot(asset),
    getDVOL(asset),
    getFundingRate(asset),
    getOpenInterest(asset),
    getRealizedVol(asset),
  ])

  return {
    spot:    spot.status    === 'fulfilled' ? spot.value    : null,
    dvol:    dvol.status    === 'fulfilled' ? dvol.value    : null,
    funding: funding.status === 'fulfilled' ? funding.value : null,
    oi:      oi.status      === 'fulfilled' ? oi.value      : null,
    rv:      rv.status      === 'fulfilled' ? rv.value      : null,
  }
}

async function getTicker(instrumentName) {
  const result = await apiFetch('ticker', { instrument_name: instrumentName })
  const isOption = instrumentName.endsWith('-C') || instrumentName.endsWith('-P')
  return isOption ? normalizeDeribitOption(result) : normalizeDeribitOrderBook(result)
}

async function getFundingRateHistory(asset, count = 90) {
  const end   = Date.now()
  const start = end - count * 8 * 3600 * 1000
  const result = await apiFetch('get_funding_rate_history', {
    instrument_name: `${asset}-PERPETUAL`,
    start_timestamp: start,
    end_timestamp:   end,
    count,
  })
  return normalizeDeribitFundingHistory(asset, result)
}

function _parseSettlementDate(dateStr) {
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
  if (year < 100) year += 2000

  return new Date(Date.UTC(year, month, day, 8, 0, 0)).getTime()
}

async function getDailySettlement(asset) {
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
      asset: currency,
      settlementPrice,
      date:      latest.date,
      timestamp: _parseSettlementDate(latest.date),
      source:    'deribit',
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn(`[deribit] getDailySettlement(${currency}) error:`, err?.message)
    }
    return null
  }
}

async function getDeliveryPrices(asset, count = 20) {
  const result = await apiFetch('get_delivery_prices', {
    index_name: `${asset.toLowerCase()}_usd`,
    count,
  })
  return normalizeDeribitDeliveryPrices(asset, result)
}

async function getLastTrades(asset, kind = 'future', count = 30) {
  const result = await apiFetch('get_last_trades_by_currency', {
    currency: asset,
    kind,
    count,
  })
  const trades = result?.trades ?? []
  return normalizeDeribitTrades(asset, trades)
}

function extractExpiries(instruments) {
  const ts = [...new Set(
    instruments
      .map(i => i.expiration_timestamp)
      .filter(t => Number.isFinite(t))
  )]
  return ts.sort((a, b) => a - b)
}

async function getDeribitTime() {
  try {
    const result = await apiFetch('get_time', {}, 3_000)
    return { timestamp: Number(result), source: 'deribit' }
  } catch {
    return null
  }
}

/**
 * Calcule la base moyenne annualisée sur les contrats futures front.
 * @param {'BTC'|'ETH'} asset
 * @param {number|null} spot
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
        // Skip already-expired contracts
        if (f.expiration_timestamp <= Date.now()) continue
        const book = await getOrderBook(f.instrument_name)
        const price = book?.price ?? null
        if (price) {
          const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
          basisValues.push((price - spot) / spot * 100 / days * 365)
        }
      } catch (err) {
        console.warn(`[deribit] getFuturePrice(${f.instrument_name}) failed:`, err?.message)
      }
    }

    if (!basisValues.length) return null
    return basisValues.reduce((a, b) => a + b, 0) / basisValues.length
  } catch (err) {
    console.warn(`[deribit] getBasisAvg(${asset}) failed:`, err?.message)
    return null
  }
}

module.exports = {
  getSpot,
  getInstruments,
  getOrderBook,
  getDVOL,
  getFundingRate,
  getOpenInterest,
  getRealizedVol,
  getMarketSnapshot,
  getDVOLForTimeframe,
  getPerpChartData,
  getTimeframeData,
  getTicker,
  getFundingRateHistory,
  getDailySettlement,
  getDeliveryPrices,
  getLastTrades,
  extractExpiries,
  getDeribitTime,
  getBasisAvg,
  _parseSettlementDate,
}
