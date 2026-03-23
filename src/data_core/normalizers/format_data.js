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

// ── Normalisateurs Deribit supplémentaires ────────────────────────────────────

/**
 * Normalise l'historique du funding rate Deribit perp
 * rawResult : tableau [{timestamp, interest}, ...]
 */
export function normalizeDeribitFundingHistory(asset, rawResult) {
  if (!rawResult?.length) return null
  const history = rawResult.map(r => ({
    timestamp: r.timestamp,
    rate8h:    r.interest * 100,
    rateAnn:   r.interest * 100 * 3 * 365,
  }))
  const latest = history[history.length - 1]
  const avg30 = history.slice(-30).reduce((s, r) => s + r.rate8h, 0) / Math.min(30, history.length)
  return {
    source:     'deribit',
    asset:      asset.toUpperCase(),
    current:    latest?.rate8h ?? null,
    currentAnn: latest?.rateAnn ?? null,
    avg30:      avg30,
    history,
    timestamp:  Date.now(),
    raw:        rawResult,
  }
}

/**
 * Normalise les prix de livraison Deribit (règlement des options)
 * rawResult : { data: [{ date: string, delivery_price: number }, ...] }
 */
export function normalizeDeribitDeliveryPrices(asset, rawResult) {
  if (!rawResult?.data?.length) return null
  const deliveries = rawResult.data.map(r => ({
    price: r.delivery_price,
    date:  r.date,
  }))
  return {
    source:    'deribit',
    asset:     asset.toUpperCase(),
    deliveries,
    latest:    deliveries[deliveries.length - 1] ?? null,
    timestamp: Date.now(),
    raw:       rawResult,
  }
}

/**
 * Normalise les trades récents Deribit par currency
 * trades : tableau de trades bruts
 */
export function normalizeDeribitTrades(asset, trades) {
  if (!trades?.length) return null
  const normalized = trades.slice(-30).map(t => ({
    instrument: t.instrument_name,
    direction:  t.direction,
    price:      t.price,
    amount:     t.amount,
    timestamp:  t.timestamp,
    iv:         t.iv ?? null,
    indexPrice: t.index_price ?? null,
  }))
  const buyVol  = normalized.filter(t => t.direction === 'buy').reduce((s, t) => s + t.amount, 0)
  const sellVol = normalized.filter(t => t.direction === 'sell').reduce((s, t) => s + t.amount, 0)
  return {
    source:    'deribit',
    asset:     asset.toUpperCase(),
    trades:    normalized,
    buyVol,
    sellVol,
    ratio:     sellVol > 0 ? buyVol / sellVol : null,
    timestamp: Date.now(),
    raw:       trades,
  }
}

// ── Normalisateurs Binance supplémentaires ────────────────────────────────────

/**
 * Normalise le premium index Binance (mark price + funding)
 * rawResult : réponse de GET /fapi/v1/premiumIndex
 */
export function normalizeBinancePremiumIndex(asset, rawResult) {
  if (!rawResult) return null
  const rate8h = rawResult.lastFundingRate != null ? Number(rawResult.lastFundingRate) * 100 : null
  const rateAnn = rate8h != null ? rate8h * 3 * 365 : null
  return {
    source:          'binance',
    asset:           asset.toUpperCase(),
    rate8h,
    rateAnn,
    markPrice:       rawResult.markPrice != null ? Number(rawResult.markPrice) : null,
    indexPrice:      rawResult.indexPrice != null ? Number(rawResult.indexPrice) : null,
    nextFundingTime: rawResult.nextFundingTime ?? null,
    bullish:         rateAnn != null ? rateAnn > 0 : null,
    timestamp:       rawResult.time ?? Date.now(),
    raw:             rawResult,
  }
}

/**
 * Normalise le ratio long/short global Binance futures
 * rawResult : { longShortRatio, longAccount, shortAccount, timestamp }
 */
export function normalizeBinanceSentiment(asset, rawResult) {
  if (!rawResult) return null
  const longPct  = rawResult.longAccount  != null ? Number(rawResult.longAccount)  * 100 : null
  const shortPct = rawResult.shortAccount != null ? Number(rawResult.shortAccount) * 100 : null
  const ratio    = rawResult.longShortRatio != null ? Number(rawResult.longShortRatio) : (longPct && shortPct ? longPct / shortPct : null)
  return {
    source:    'binance',
    asset:     asset.toUpperCase(),
    longPct,
    shortPct,
    ratio,
    bullish:   ratio != null ? ratio > 1 : null,
    timestamp: rawResult.timestamp ?? Date.now(),
    raw:       rawResult,
  }
}

/**
 * Normalise le volume buy/sell des takers Binance
 * rawResult : { buySellRatio, buyVol, sellVol, timestamp }
 */
export function normalizeBinanceTakerVolume(asset, rawResult) {
  if (!rawResult) return null
  const buyVol  = rawResult.buyVol  != null ? Number(rawResult.buyVol)  : null
  const sellVol = rawResult.sellVol != null ? Number(rawResult.sellVol) : null
  const ratio   = rawResult.buySellRatio != null ? Number(rawResult.buySellRatio) : (buyVol && sellVol ? buyVol / sellVol : null)
  return {
    source:    'binance',
    asset:     asset.toUpperCase(),
    buyVol,
    sellVol,
    ratio,
    bullish:   ratio != null ? ratio > 1 : null,
    timestamp: rawResult.timestamp ?? Date.now(),
    raw:       rawResult,
  }
}

/**
 * Normalise les liquidations forcées Binance
 * orders : tableau de orders forcés
 */
export function normalizeBinanceLiquidations(asset, orders) {
  if (!orders?.length) return null
  const liqList = orders.slice(-20).map(o => ({
    side:      o.side,
    price:     Number(o.averagePrice) || Number(o.price) || 0,
    amount:    Number(o.origQty) || 0,
    value:     (Number(o.averagePrice) || 0) * (Number(o.origQty) || 0),
    timestamp: o.time ?? Date.now(),
  }))
  const longLiq  = liqList.filter(l => l.side === 'SELL').reduce((s, l) => s + l.value, 0)
  const shortLiq = liqList.filter(l => l.side === 'BUY').reduce((s, l)  => s + l.value, 0)
  return {
    source:      'binance',
    asset:       asset.toUpperCase(),
    recent:      liqList,
    longLiqUSD:  longLiq,
    shortLiqUSD: shortLiq,
    total:       longLiq + shortLiq,
    timestamp:   Date.now(),
    raw:         orders,
  }
}

/**
 * Normalise les mark prices des options Binance European (eapi)
 * marks : tableau de { symbol, markPrice, markIV, delta, theta, gamma, vega }
 */
export function normalizeBinanceOptions(asset, marks) {
  if (!marks?.length) return null
  const options = marks.map(m => {
    // symbol: BTC-240329-70000-C
    const parts       = (m.symbol ?? '').split('-')
    const strike      = Number(parts[2]) || 0
    const optionType  = parts[3] === 'C' ? 'call' : 'put'
    const expiryStr   = parts[1] ?? '' // YYMMDD
    let expiry = 0
    if (expiryStr.length === 6) {
      expiry = new Date(`20${expiryStr.slice(0,2)}-${expiryStr.slice(2,4)}-${expiryStr.slice(4,6)}T08:00:00Z`).getTime()
    }
    const daysToExpiry = expiry ? Math.max(0, (expiry - Date.now()) / 86400000) : 0
    return {
      source:       'binance',
      asset:        asset.toUpperCase(),
      instrument:   m.symbol,
      optionType,
      strike,
      expiry,
      daysToExpiry,
      markPrice:    m.markPrice  != null ? Number(m.markPrice)  : null,
      markIV:       m.markIV     != null ? Number(m.markIV) * 100 : null,
      bidIV:        m.bidIV      != null ? Number(m.bidIV)  * 100 : null,
      askIV:        m.askIV      != null ? Number(m.askIV)  * 100 : null,
      greeks: {
        delta: m.delta != null ? Number(m.delta) : null,
        gamma: m.gamma != null ? Number(m.gamma) : null,
        vega:  m.vega  != null ? Number(m.vega)  : null,
        theta: m.theta != null ? Number(m.theta) : null,
      },
      timestamp: Date.now(),
      raw:       m,
    }
  })
  return {
    source:    'binance',
    asset:     asset.toUpperCase(),
    options,
    timestamp: Date.now(),
    raw:       marks,
  }
}

/**
 * Normalise l'open interest des options Binance European par échéance
 * oiData : tableau de { symbol, sumOpenInterest, sumOpenInterestUsd, expiryDate, callOpenInterest, putOpenInterest }
 */
export function normalizeBinanceOptionsOI(asset, oiData) {
  if (!oiData?.length) return null
  const total  = oiData.reduce((s, r) => s + Number(r.sumOpenInterest || 0), 0)
  const callOI = oiData.reduce((s, r) => s + Number(r.callOpenInterest || 0), 0)
  const putOI  = oiData.reduce((s, r) => s + Number(r.putOpenInterest  || 0), 0)
  return {
    source:       'binance',
    asset:        asset.toUpperCase(),
    total,
    callOI,
    putOI,
    putCallRatio: callOI > 0 ? putOI / callOI : null,
    byExpiry:     oiData.map(r => ({
      expiry:       r.expiryDate,
      callOI:       Number(r.callOpenInterest || 0),
      putOI:        Number(r.putOpenInterest  || 0),
      totalUSD:     Number(r.sumOpenInterestUsd || 0),
    })),
    timestamp: Date.now(),
    raw:       oiData,
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

// ── Intégrité cross-exchange ──────────────────────────────────────────────────

const STALE_LAG_MS = 30_000  // 30 secondes

/**
 * Vérifie la cohérence temporelle de données provenant de plusieurs sources.
 *
 * @param {Object.<string, { timestamp?: number }|null>} dataMap
 *   Clés = nom de source ('deribit', 'binance', 'coinbase'),
 *   valeurs = objets normalisés avec un champ `timestamp` (unix ms).
 *
 * @returns {{
 *   isValid: boolean,
 *   staleSource: string|null,
 *   maxLagMs: number,
 *   details: Object.<string, { timestamp: number|null, lagMs: number|null }>
 * }}
 */
export function validateDataFreshness(dataMap) {
  const now = Date.now()
  const details = {}
  const timestamps = []

  for (const [source, data] of Object.entries(dataMap)) {
    const ts = data?.timestamp ?? null
    // Vérification de cohérence d'unités — les timestamps doivent être en ms
    // Coinbase retourne des secondes (epoch) → doit être × 1000 dans coinbase.js
    if (ts != null && ts < 1_000_000_000_000) {
      console.error(
        `[validateDataFreshness] ${source} timestamp probable en secondes.` +
        ` Valeur reçue : ${ts}.` +
        ` Coinbase retourne epoch en secondes → appliquer × 1000 dans coinbase.js`
      )
    }
    details[source] = { timestamp: ts, lagMs: ts != null ? now - ts : null }
    if (ts != null) timestamps.push(ts)
  }

  if (timestamps.length === 0) {
    return { isValid: false, staleSource: null, maxLagMs: 0, details }
  }

  // Source de référence = la plus récente
  const maxTs = Math.max(...timestamps)
  let staleSource = null
  let maxLagMs = 0

  for (const [source, info] of Object.entries(details)) {
    if (info.timestamp == null) {
      staleSource = staleSource ?? source
      continue
    }
    const lag = maxTs - info.timestamp
    if (lag > maxLagMs) maxLagMs = lag
    if (lag > STALE_LAG_MS) staleSource = staleSource ?? source
  }

  return {
    isValid: staleSource === null,
    staleSource,
    maxLagMs,
    details,
  }
}

// ── Normalisateur On-Chain ────────────────────────────────────────────────────

/**
 * Seuils de congestion mempool (transactions en attente).
 */
const MEMPOOL_LOW      = 5_000
const MEMPOOL_MEDIUM   = 20_000
const MEMPOOL_HIGH     = 50_000

/**
 * Calcule le niveau de congestion mempool.
 * @param {number|null} txCount
 * @returns {'low'|'medium'|'high'|'critical'}
 */
function _mempoolCongestion(txCount) {
  if (txCount == null) return 'low'
  if (txCount >= MEMPOOL_HIGH)   return 'critical'
  if (txCount >= MEMPOOL_MEDIUM) return 'high'
  if (txCount >= MEMPOOL_LOW)    return 'medium'
  return 'low'
}

/**
 * Interprète le netflow exchange en signal directionnel.
 * netflow positif = entrée exchanges (distribution → baissier)
 * netflow négatif = sortie exchanges (accumulation → haussier)
 */
function _exchangeFlowSignal(netflow) {
  if (netflow == null) return { signal: 'neutral', strength: 'weak' }
  const abs = Math.abs(netflow)
  const dir = netflow > 0 ? 'distribution' : netflow < 0 ? 'accumulation' : 'neutral'
  const strength = abs > 10_000 ? 'strong' : abs > 2_000 ? 'moderate' : 'weak'
  return { signal: dir, strength }
}

// ── Score composite pondéré (min 2 composantes) ───────────────────────────────

/** Convertit la congestion mempool en score 0-100. */
function _mempoolScore(congestion) {
  const map = { low: 40, medium: 50, high: 60, critical: 70 }
  return map[congestion] ?? null
}

/**
 * Convertit le Fear & Greed en score 0-100 contrarian.
 * FG 0 (extreme fear) → 80 (bullish), FG 100 (extreme greed) → 20 (bearish).
 */
function _fearGreedScore(fgValue) {
  if (fgValue == null) return null
  return Math.round(80 - (fgValue / 100) * 60)
}

/** Calcule le score 0-100 du hash rate à partir de la variation 7j. */
function _hashRateScore(history) {
  if (!history?.hashrates?.length) return null
  const rates   = history.hashrates
  const current = history.currentHashrate ?? rates[rates.length - 1]?.hashrate_ehs
  if (!current) return null
  if (rates.length >= 7) {
    const week7ago = rates[rates.length - 7]?.hashrate_ehs
    if (week7ago && week7ago > 0) {
      const var7d = ((current - week7ago) / week7ago) * 100
      if (var7d >  5) return 75
      if (var7d < -5) return 30
    }
  }
  return 50    // données présentes mais pas assez d'historique → neutre
}

/** Convertit le signal exchange flow en score 0-100. */
function _exchangeFlowScore(flowSignal, flowStrength) {
  if (flowSignal === 'accumulation') {
    return flowStrength === 'strong' ? 80 : flowStrength === 'moderate' ? 70 : 60
  }
  if (flowSignal === 'distribution') {
    return flowStrength === 'strong' ? 20 : flowStrength === 'moderate' ? 30 : 40
  }
  return null   // neutre = pas de signal
}

/** Score minier : simple présence de données = 55 (légèrement positif). */
function _miningScore(hashRate) {
  return (hashRate != null && hashRate > 0) ? 55 : null
}

/**
 * Calcule le score composite pondéré.
 * Retourne null si moins de 2 composantes disponibles.
 */
function _calcOnChainScore(components) {
  const weights = {
    mempool:      0.25,
    fearGreed:    0.30,
    hashRate:     0.20,
    exchangeFlow: 0.15,
    mining:       0.10,
  }

  let totalWeight = 0
  let totalScore  = 0
  let available   = 0

  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key]
    if (value != null) {
      totalScore  += value * weight
      totalWeight += weight
      available++
    }
  }

  if (available < 2) return null
  return Math.round(totalScore / totalWeight)
}

/**
 * Compare une valeur à un historique pour déterminer son contexte percentile.
 * @param {number|null} value
 * @param {number[]} history
 * @returns {{ context: string, percentile: number|null }}
 */
export function getHistoricalContext(value, history) {
  if (!history?.length || value == null) return { context: 'unknown', percentile: null }
  const sorted = [...history].sort((a, b) => a - b)
  const rank   = sorted.filter(v => v <= value).length
  const pct    = Math.round((rank / sorted.length) * 100)

  let context = 'normal'
  if      (pct >= 90) context = 'historically_high'
  else if (pct <= 10) context = 'historically_low'
  else if (pct >= 75) context = 'above_average'
  else if (pct <= 25) context = 'below_average'

  return { context, percentile: pct }
}

/**
 * Normalise toutes les données on-chain en une structure canonique.
 *
 * @param {{
 *   blockchain:       Object|null,
 *   mempool:          Object|null,
 *   glassnodeFlow:    Object|null,
 *   cryptoQuantFlow:  Object|null,
 *   fearGreed?:       Object|null,    — données alternative.me
 *   hashRateHistory?: Object|null,    — données mempool.space hashrate
 * }} raw
 * @returns {{
 *   mempool:      { txCount, congestion, fastFee, hourFee, timestamp },
 *   exchangeFlow: { netflow, signal, strength, timestamp },
 *   mining:       { hashRate, difficulty, trend, timestamp },
 *   composite:    { onChainScore, bias, confidence }
 * }}
 */
export function normalizeOnChain(raw) {
  const {
    blockchain, mempool, glassnodeFlow, cryptoQuantFlow,
    fearGreed, hashRateHistory,
  } = raw ?? {}

  // ── Mempool ────────────────────────────────────────────────────────────────
  const txCount    = mempool?.count      ?? null
  const fastFee    = mempool?.fastestFee ?? null
  const hourFee    = mempool?.hourFee    ?? null
  const congestion = _mempoolCongestion(txCount)

  // ── Exchange flow ──────────────────────────────────────────────────────────
  const netflow = cryptoQuantFlow?.netflow ?? glassnodeFlow?.netflow ?? null
  const { signal: flowSignal, strength: flowStrength } = _exchangeFlowSignal(netflow)

  // ── Mining (blockchain.info) ───────────────────────────────────────────────
  const hashRate    = blockchain?.hash_rate  ?? null
  const difficulty  = blockchain?.difficulty ?? null
  const miningTrend = 'stable'

  // ── Score composite pondéré (min 2 composantes) ───────────────────────────
  const components = {
    mempool:      _mempoolScore(congestion),
    fearGreed:    _fearGreedScore(fearGreed?.value ?? null),
    hashRate:     _hashRateScore(hashRateHistory ?? null),
    exchangeFlow: _exchangeFlowScore(flowSignal, flowStrength),
    mining:       _miningScore(hashRate),
  }

  const onChainScore = _calcOnChainScore(components)

  const bias = onChainScore == null
    ? 'neutral'
    : onChainScore >= 60 ? 'bullish'
    : onChainScore >= 40 ? 'neutral'
    : 'bearish'

  // Nombre de sources fiables disponibles
  const availableCount = Object.values(components).filter(v => v != null).length
  const confidence = availableCount >= 4 ? 'high'
    : availableCount >= 2 ? 'medium'
    : 'low'

  return {
    mempool: {
      txCount,
      congestion,
      fastFee,
      hourFee,
      timestamp: mempool?.timestamp ?? Date.now(),
    },
    exchangeFlow: {
      netflow,
      signal:    flowSignal,
      strength:  flowStrength,
      timestamp: cryptoQuantFlow?.timestamp ?? glassnodeFlow?.timestamp ?? Date.now(),
    },
    mining: {
      hashRate,
      difficulty,
      trend:     miningTrend,
      timestamp: blockchain?.timestamp ?? Date.now(),
    },
    composite: {
      onChainScore,   // null si < 2 composantes disponibles
      bias,
      confidence,
    },
  }
}
