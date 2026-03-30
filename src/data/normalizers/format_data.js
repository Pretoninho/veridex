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
 * @property {'deribit'|'onchain'} source
 * @property {string} asset       — ex: 'BTC', 'ETH'
 * @property {'spot'|'future'|'perp'|'option'} type
 * @property {string} instrument  — ex: 'BTC-PERPETUAL', 'BTC_USD'
 * @property {number|null} price
 * @property {number|null} bid
 * @property {number|null} ask
 * @property {number|null} volume24h
 * @property {number} timestamp   — unix ms
 * @property {Object} raw         — données brutes originales
 */

/**
 * @typedef {Object} NormalizedOption
 * @property {'deribit'|'onchain'} source
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
 * @property {'deribit'|'onchain'} source
 * @property {string} asset
 * @property {number|null} rate8h     — taux sur 8h en %
 * @property {number|null} rateAnn    — taux annualisé en %
 * @property {boolean|null} bullish   — true si taux > 0
 * @property {number} timestamp
 * @property {Object} raw
 */

/**
 * @typedef {Object} NormalizedOI
 * @property {'deribit'|'onchain'} source
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
 * @property {'deribit'|'onchain'} source
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

// ── Data Freshness Validation ────────────────────────────────────────────────

const STALE_LAG_MS = 30_000  // 30 secondes

/**
 * Vérifie la cohérence temporelle de données provenant de plusieurs sources.
 *
 * @param {Object.<string, { timestamp?: number }|null>} dataMap
 *   Clés = nom de source ('deribit', 'onchain'),
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
    if (ts != null && ts < 1_000_000_000_000) {
      console.error(
        `[validateDataFreshness] ${source} timestamp probable en secondes.` +
        ` Valeur reçue : ${ts}.`
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

/**
 * Convertit le signal CryptoQuant exchange flow en score 0-100.
 * Utilise le signal pré-calculé par getExchangeFlows().
 * Retourne null si flow absent (clé API manquante) → score calculé sans cette composante.
 */
function _flowToScore(flow) {
  if (!flow) return null
  if (flow.signal === 'bullish') return 70
  if (flow.signal === 'bearish') return 30
  return 50
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
 *   exchangeFlows?:   Object|null,    — résultat de getExchangeFlows() (CryptoQuant)
 *   fearGreed?:       Object|null,    — données alternative.me
 *   hashRateHistory?: Object|null,    — données mempool.space hashrate
 * }} raw
 * @returns {{
 *   mempool:      { txCount, congestion, fastFee, hourFee, timestamp },
 *   exchangeFlow: { netflow, netflow24h, direction, signal, source, timestamp },
 *   mining:       { hashRate, difficulty, trend, timestamp },
 *   composite:    { onChainScore, bias, confidence }
 * }}
 */
export function normalizeOnChain(raw) {
  const {
    blockchain, mempool, exchangeFlows,
    fearGreed, hashRateHistory,
  } = raw ?? {}

  // ── Mempool ────────────────────────────────────────────────────────────────
  const txCount    = mempool?.count      ?? null
  const fastFee    = mempool?.fastestFee ?? null
  const hourFee    = mempool?.hourFee    ?? null
  const congestion = _mempoolCongestion(txCount)

  // ── Exchange flow (CryptoQuant) ────────────────────────────────────────────
  // exchangeFlows est null si clé absente → composante ignorée dans le score
  const netflow    = exchangeFlows?.netflow    ?? null
  const netflow24h = exchangeFlows?.netflow24h ?? null
  const direction  = exchangeFlows?.direction  ?? null
  const flowSignal = exchangeFlows?.signal     ?? 'neutral'

  // ── Mining (blockchain.info) ───────────────────────────────────────────────
  const hashRate    = blockchain?.hash_rate  ?? null
  const difficulty  = blockchain?.difficulty ?? null
  const miningTrend = 'stable'

  // ── Score composite pondéré (min 2 composantes) ───────────────────────────
  const components = {
    mempool:      _mempoolScore(congestion),
    fearGreed:    _fearGreedScore(fearGreed?.value ?? null),
    hashRate:     _hashRateScore(hashRateHistory ?? null),
    exchangeFlow: _flowToScore(exchangeFlows),   // null si clé absente
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
      netflow24h,
      direction,
      signal:    flowSignal,
      source:    exchangeFlows?.source ?? null,
      timestamp: exchangeFlows?.fetchedAt ?? Date.now(),
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
