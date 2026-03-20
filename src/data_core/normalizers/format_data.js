/**
 * format_data.js — Normalisateur central
 *
 * Chaque plateforme retourne des formats différents.
 * Ce module les transforme en structures canoniques uniformes,
 * indépendantes de la source.
 *
 * Structures canoniques :
 *   - Ticker   : prix spot/future/perp
 *   - Option   : contrat d'option avec greeks + IV
 *   - Funding  : taux de financement perpetuel
 *   - OI       : open interest
 *   - DVOL     : indice de volatilité implicite
 */

// ── Types canoniques ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedTicker
 * @property {'deribit'|'binance'|'coinbase'} source
 * @property {string} asset       — ex: 'BTC', 'ETH'
 * @property {'spot'|'future'|'perp'|'option'} type
 * @property {string} instrument  — ex: 'BTC-PERPETUAL', 'BTCUSDT'
 * @property {number|null} price
 * @property {number|null} bid
 * @property {number|null} ask
 * @property {number|null} volume24h
 * @property {number} timestamp   — unix ms
 * @property {Object} raw         — données brutes originales
 */

/**
 * @typedef {Object} NormalizedOption
 * @property {'deribit'|'binance'|'coinbase'} source
 * @property {string} asset
 * @property {string} instrument
 * @property {'call'|'put'} optionType
 * @property {number} strike
 * @property {number} expiry       — unix ms
 * @property {number} daysToExpiry
 * @property {number|null} bid
 * @property {number|null} ask
 * @property {number|null} markPrice
 * @property {number|null} markIV  — volatilité implicite en %
 * @property {{delta:number, gamma:number, vega:number, theta:number}|null} greeks
 * @property {number|null} openInterest
 * @property {number} timestamp
 * @property {Object} raw
 */

/**
 * @typedef {Object} NormalizedFunding
 * @property {'deribit'|'binance'|'coinbase'} source
 * @property {string} asset
 * @property {number|null} rate8h     — taux sur 8h en %
 * @property {number|null} rateAnn    — taux annualisé en %
 * @property {boolean|null} bullish   — true si taux > 0
 * @property {number} timestamp
 * @property {Object} raw
 */

/**
 * @typedef {Object} NormalizedOI
 * @property {'deribit'|'binance'|'coinbase'} source
 * @property {string} asset
 * @property {number} total
 * @property {number} callOI
 * @property {number} putOI
 * @property {number|null} putCallRatio
 * @property {number} timestamp
 * @property {Object} raw
 */

/**
 * @typedef {Object} NormalizedDVOL
 * @property {'deribit'|'binance'|'coinbase'} source
 * @property {string} asset
 * @property {number} current
 * @property {number|null} weekAgo
 * @property {number} monthMin
 * @property {number} monthMax
 * @property {Array} history    — [[ts, value], ...]
 * @property {number} timestamp
 * @property {Object} raw
 */

// ── Normalisateurs Deribit ────────────────────────────────────────────────────

/**
 * Normalise un index price Deribit → NormalizedTicker spot
 */
export function normalizeDeribitSpot(asset, rawResult) {
  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    type: 'spot',
    instrument: `${asset.toUpperCase()}_USD`,
    price: rawResult?.index_price ?? null,
    bid: null,
    ask: null,
    volume24h: null,
    timestamp: Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise un get_order_book Deribit → NormalizedTicker (future/perp)
 */
export function normalizeDeribitOrderBook(rawResult) {
  if (!rawResult) return null
  const name = rawResult.instrument_name ?? ''
  const isPerp = name.endsWith('-PERPETUAL')
  const asset = name.split('-')[0]
  return {
    source: 'deribit',
    asset,
    type: isPerp ? 'perp' : 'future',
    instrument: name,
    price: rawResult.mark_price ?? null,
    bid: rawResult.best_bid_price ?? null,
    ask: rawResult.best_ask_price ?? null,
    volume24h: rawResult.stats?.volume ?? null,
    timestamp: rawResult.timestamp ?? Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise un get_order_book d'option Deribit → NormalizedOption
 */
export function normalizeDeribitOption(rawResult) {
  if (!rawResult) return null
  const name = rawResult.instrument_name ?? ''
  // Format: BTC-28MAR25-80000-C
  const parts = name.split('-')
  const asset = parts[0]
  const optionType = parts[3] === 'C' ? 'call' : 'put'
  const strike = Number(parts[2]) || 0
  const expiry = rawResult.expiration_timestamp ?? 0
  const daysToExpiry = Math.max(0, (expiry - Date.now()) / 86400000)

  return {
    source: 'deribit',
    asset,
    instrument: name,
    optionType,
    strike,
    expiry,
    daysToExpiry,
    bid: rawResult.best_bid_price ?? null,
    ask: rawResult.best_ask_price ?? null,
    markPrice: rawResult.mark_price ?? null,
    markIV: rawResult.mark_iv ?? null,
    greeks: rawResult.greeks
      ? {
          delta: rawResult.greeks.delta,
          gamma: rawResult.greeks.gamma,
          vega: rawResult.greeks.vega,
          theta: rawResult.greeks.theta,
        }
      : null,
    openInterest: rawResult.open_interest ?? null,
    timestamp: rawResult.timestamp ?? Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise les données DVOL Deribit
 */
export function normalizeDeribitDVOL(asset, rawResult) {
  if (!rawResult?.data?.length) return null
  const data = rawResult.data // [[ts, open, high, low, close], ...]
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
    raw: rawResult,
  }
}

/**
 * Normalise le funding rate Deribit
 */
export function normalizeDeribitFunding(asset, rawResult) {
  if (!rawResult) return null
  const rate8h = rawResult.funding_8h != null
    ? rawResult.funding_8h * 100
    : (rawResult.current_funding != null ? rawResult.current_funding * 100 : null)
  const rateAnn = rate8h != null ? rate8h * 3 * 365 : null

  return {
    source: 'deribit',
    asset: asset.toUpperCase(),
    rate8h,
    rateAnn,
    bullish: rateAnn != null ? rateAnn > 0 : null,
    timestamp: Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise l'open interest Deribit
 */
export function normalizeDeribitOI(asset, rawResults) {
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
    raw: rawResults,
  }
}

// ── Normalisateurs Binance ────────────────────────────────────────────────────

/**
 * Normalise un ticker 24h Binance → NormalizedTicker
 * rawResult : réponse de GET /api/v3/ticker/24hr ou /fapi/v1/ticker/24hr
 */
export function normalizeBinanceTicker(rawResult, type = 'spot') {
  if (!rawResult) return null
  const symbol = rawResult.symbol ?? ''
  // Extraire l'asset de base : BTCUSDT → BTC
  const asset = symbol.replace(/USDT$|BUSD$|USD$/, '')

  return {
    source: 'binance',
    asset,
    type,
    instrument: symbol,
    price: rawResult.lastPrice != null ? Number(rawResult.lastPrice) : null,
    bid: rawResult.bidPrice != null ? Number(rawResult.bidPrice) : null,
    ask: rawResult.askPrice != null ? Number(rawResult.askPrice) : null,
    volume24h: rawResult.quoteVolume != null ? Number(rawResult.quoteVolume) : null,
    timestamp: rawResult.closeTime ?? Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise le funding rate Binance perpetuel
 * rawResult : réponse de GET /fapi/v1/fundingRate
 */
export function normalizeBinanceFunding(asset, rawResult) {
  if (!rawResult) return null
  const rate8h = rawResult.fundingRate != null ? Number(rawResult.fundingRate) * 100 : null
  const rateAnn = rate8h != null ? rate8h * 3 * 365 : null

  return {
    source: 'binance',
    asset: asset.toUpperCase(),
    rate8h,
    rateAnn,
    bullish: rateAnn != null ? rateAnn > 0 : null,
    timestamp: rawResult.fundingTime ?? Date.now(),
    raw: rawResult,
  }
}

/**
 * Normalise l'open interest Binance futures
 * rawResult : réponse de GET /fapi/v1/openInterest
 */
export function normalizeBinanceOI(asset, rawResult) {
  if (!rawResult) return null
  return {
    source: 'binance',
    asset: asset.toUpperCase(),
    total: Number(rawResult.openInterest) || 0,
    callOI: 0,
    putOI: 0,
    putCallRatio: null,
    timestamp: rawResult.time ?? Date.now(),
    raw: rawResult,
  }
}

// ── Normalisateurs Coinbase ───────────────────────────────────────────────────

/**
 * Normalise un ticker Coinbase Advanced → NormalizedTicker
 * rawResult : réponse de GET /api/v3/brokerage/products/{product_id}/ticker
 */
export function normalizeCoinbaseTicker(rawResult) {
  if (!rawResult) return null
  const productId = rawResult.product_id ?? ''
  // BTC-USD → BTC
  const asset = productId.split('-')[0]

  return {
    source: 'coinbase',
    asset,
    type: 'spot',
    instrument: productId,
    price: rawResult.price != null ? Number(rawResult.price) : null,
    bid: rawResult.best_bid != null ? Number(rawResult.best_bid) : null,
    ask: rawResult.best_ask != null ? Number(rawResult.best_ask) : null,
    volume24h: rawResult.volume_24_h != null ? Number(rawResult.volume_24_h) : null,
    timestamp: rawResult.time ? new Date(rawResult.time).getTime() : Date.now(),
    raw: rawResult,
  }
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

/**
 * Fusionne plusieurs tickers de sources différentes pour un même asset.
 * Retourne le prix moyen pondéré par volume (VWAP).
 * @param {NormalizedTicker[]} tickers
 * @returns {{ asset: string, vwap: number, sources: string[], timestamp: number }}
 */
export function mergeSpotTickers(tickers) {
  const valid = tickers.filter(t => t?.price != null)
  if (!valid.length) return null

  const withVol = valid.filter(t => t.volume24h)
  const totalVol = withVol.reduce((s, t) => s + t.volume24h, 0)

  const vwap = totalVol > 0
    ? withVol.reduce((s, t) => s + t.price * t.volume24h, 0) / totalVol
    : valid.reduce((s, t) => s + t.price, 0) / valid.length

  return {
    asset: valid[0].asset,
    vwap,
    sources: valid.map(t => t.source),
    timestamp: Date.now(),
  }
}
