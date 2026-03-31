/**
 * src/api/backend.js
 *
 * Frontend-only aggregator — computes market data and signals directly in the
 * browser using Deribit providers and signal-engine.
 *
 * Simplified version for Veridex refactor (no on-chain, patterns, or advanced analytics).
 */

import {
  getSpot,
  getDVOL,
  getFundingRate,
  getRealizedVol,
  getOpenInterest,
  getFundingRateHistory,
  getBasisAvg,
} from '../data/providers/deribit.js'
import { computeSignal, detectRegime4h, detectSetup1h, detectEntry5min } from '../signals/signal_engine.js'
import { hashData, smartCache } from '../data/data_store/cache.js'

const SIGNAL_CACHE_VERSION = 1
const buildSignalCacheKey = (assetCode, kind) =>
  `signals:${assetCode}:v${SIGNAL_CACHE_VERSION}:${kind}`

function pickDvolCurrentTimeframe(dvolPayload) {
  if (!dvolPayload) return null
  if (dvolPayload.current != null) return dvolPayload
  return dvolPayload.dvol_4h ?? dvolPayload.dvol_1h ?? dvolPayload.dvol_1d ?? null
}

/**
 * Compute multi-timeframe signals from the current signal scores.
 * This creates synthetic 4h/1h/5min signals by applying variations to the current scores
 * to simulate multi-timeframe hierarchy: 4h (HTF) → 1h (MTF) → 5min (LTF)
 *
 * @param {Object} signalResult — result from computeSignal()
 * @returns {Object} — {regime_4h, setup_1h, entry_5min, alignment}
 */
function computeMultiTimeframeFromSignal(signalResult, dvolCurrent4h = null) {
  const { scores: {s1, s2, s3, s4}, global } = signalResult

  // Create synthetic timeframe signals by applying decreasing confidence factors
  // 4h: base signal (HTF - Higher TimeFrame)
  const signal4h = {
    ...signalResult,
    global: global != null ? Math.max(0, Math.min(100, global - 5)) : null,
    dvolFactor: signalResult.dvolFactor ?? 1,
  }

  // 1h: slightly more bullish/volatile (MTF - Middle TimeFrame)
  const signal1h = {
    ...signalResult,
    global: global != null ? Math.max(0, Math.min(100, global + 8)) : null,
    dvolFactor: signalResult.dvolFactor != null ? signalResult.dvolFactor * 1.05 : 1.05,
  }

  // 5min: most volatile/reactive (LTF - Lower TimeFrame)
  const signal5min = {
    ...signalResult,
    global: global != null ? Math.max(0, Math.min(100, global + 12)) : null,
    dvolFactor: signalResult.dvolFactor != null ? signalResult.dvolFactor * 1.15 : 1.15,
  }

  // Detect multi-timeframe patterns
  const regime4h = detectRegime4h(signal4h, dvolCurrent4h)
  const setup1h = detectSetup1h(signal1h)
  const entry5min = detectEntry5min(signal5min)

  // Check alignment between timeframes
  const htf_mtf = regime4h.isCompatible(setup1h)
  const mtf_ltf = setup1h.isCompatible(entry5min)
  const all_aligned = htf_mtf && mtf_ltf

  return {
    regime_4h: regime4h,
    setup_1h: setup1h,
    entry_5min: entry5min,
    alignment: {
      htf_mtf,
      mtf_ltf,
      all_aligned,
    },
  }
}

/**
 * Fetch raw normalized market data for the given asset directly from Deribit provider.
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: number|null,
 *   basisAvg: number|null,
 *   pcRatio: number|null,
 *   timestamp: number,
 * }>}
 */
export async function fetchMarket(asset) {
  const a = asset.toUpperCase()

  const [
    spotResult,
    dvolResult,
    fundingResult,
    rvResult,
    oiResult,
    fundingHistResult,
  ] = await Promise.allSettled([
    getSpot(a),
    getDVOL(a),
    getFundingRate(a),
    getRealizedVol(a),
    getOpenInterest(a),
    getFundingRateHistory(a, 21),
  ])

  const spot    = spotResult.status    === 'fulfilled' ? spotResult.value?.price ?? null : null
  const dvolRaw = dvolResult.status    === 'fulfilled' ? dvolResult.value    : null
  const dvol    = pickDvolCurrentTimeframe(dvolRaw)
  const dvol4hCurrent = dvolRaw?.dvol_4h?.current ?? null
  const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : null
  const rv      = rvResult.status      === 'fulfilled' ? rvResult.value      : null
  const oi      = oiResult.status      === 'fulfilled' ? oiResult.value      : null

  const fundingHistItems = fundingHistResult.status === 'fulfilled'
    ? (fundingHistResult.value?.history ?? [])
    : []
  const avg7Items = fundingHistItems.slice(-21)
  const avgAnn7d = avg7Items.length > 0
    ? avg7Items.reduce((s, r) => s + (r.rateAnn ?? 0), 0) / avg7Items.length
    : (funding?.rateAnn ?? null)

  const basisAvg = await getBasisAvg(a, spot).catch(() => null)

  return {
    asset:     a,
    spot,
    dvol,
    dvol4hCurrent,
    funding:   funding ? { ...funding, avgAnn7d } : null,
    rv,
    basisAvg,
    pcRatio:   oi?.putCallRatio ?? null,
    timestamp: Date.now(),
  }
}

/**
 * Fetch the computed market signal for the given asset, built entirely in the
 * browser from live Deribit provider data.
 *
 * Simplified version: 4-component signal (IV, Funding, Basis, IV/RV)
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   scores: { s1, s2, s3, s4 },
 *   global: number|null,
 *   signal: { label: string, action: string }|null,
 *   timestamp: number,
 * }>}
 */
export async function fetchSignals(asset) {
  const assetCode = asset.toUpperCase()

  const marketResult = await Promise.allSettled([
    fetchMarket(assetCode),
  ]).then(r => r[0])

  const market = marketResult.status === 'fulfilled' ? marketResult.value : {}

  const signalInputs = {
    dvol:      market.dvol      ?? null,
    funding:   market.funding   ?? null,
    rv:        market.rv        ?? null,
    basisAvg:  market.basisAvg  ?? null,
    spot:      market.spot      ?? null,
    asset:     assetCode,
  }

  const inputKey  = buildSignalCacheKey(assetCode, 'inputs')
  const resultKey = buildSignalCacheKey(assetCode, 'result')
  const prevEntry = smartCache.get(inputKey)
  const cached = smartCache.get(resultKey)
  let nextHash = null
  if (prevEntry && cached) {
    nextHash = hashData(signalInputs)
    if (prevEntry.hash === nextHash) {
      const refreshed = { ...cached, timestamp: Date.now() }
      smartCache.set(resultKey, refreshed)
      return refreshed
    }
  }
  if (!nextHash) nextHash = hashData(signalInputs)

  let scores, global, signal, noviceData, maxPain
  try {
    const result = computeSignal(signalInputs)
    scores = result.scores
    global = result.global
    signal = result.signal
    noviceData = result.noviceData
    maxPain = result.maxPain
  } catch (err) {
    console.error('[fetchSignals] computeSignal error:', err)
    // Retourner un signal par défaut sûr
    scores = { s1: null, s2: null, s3: null, s4: null }
    global = null
    signal = null
    noviceData = { asset: assetCode, spotPrice: market.spot ?? null, score: null, funding: null, estimatedGain: null }
    maxPain = null
  }

  // Compute multi-timeframe signals for hierarchical analysis
  const signalResult = { scores, global, signal, noviceData, maxPain, dvolFactor: signalInputs.dvol?.current ? 1 : 0.85 }
  let multi_timeframe = null
  try {
    multi_timeframe = computeMultiTimeframeFromSignal(signalResult, market.dvol4hCurrent ?? null)
  } catch (err) {
    console.error('[fetchSignals] Multi-timeframe computation error:', err)
    // Ne jamais bloquer le signal principal — retourner une structure vide
    multi_timeframe = {
      regime_4h: null,
      setup_1h: null,
      entry_5min: null,
      alignment: { htf_mtf: false, mtf_ltf: false, all_aligned: false },
    }
  }

  const result = {
    asset:     assetCode,
    spot:      market.spot ?? null,
    scores,
    global,
    signal,
    multi_timeframe,
    noviceData,
    maxPain,
    timestamp: Date.now(),
  }

  smartCache.set(inputKey, { hash: nextHash, inputs: signalInputs })
  smartCache.set(resultKey, result)

  return result
}

/**
 * Save a computed signal to history (simple localStorage-based)
 */
export function saveSignal(signal) {
  try {
    const history = JSON.parse(localStorage.getItem('veridex_signal_history') || '[]')
    history.push(signal)
    // Keep only last 100 signals
    if (history.length > 100) history.shift()
    localStorage.setItem('veridex_signal_history', JSON.stringify(history))
  } catch (err) {
    console.warn('[saveSignal] Error:', err)
  }
}

/**
 * Load signal history from localStorage
 */
export function loadSignalHistory() {
  try {
    return JSON.parse(localStorage.getItem('veridex_signal_history') || '[]')
  } catch (err) {
    console.warn('[loadSignalHistory] Error:', err)
    return []
  }
}
