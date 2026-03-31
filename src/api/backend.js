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
import { computeSignal } from '../signals/signal_engine.js'
import { hashData, smartCache } from '../data/data_store/cache.js'

const SIGNAL_CACHE_VERSION = 1
const buildSignalCacheKey = (assetCode, kind) =>
  `signals:${assetCode}:v${SIGNAL_CACHE_VERSION}:${kind}`

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
  const dvol    = dvolResult.status    === 'fulfilled' ? dvolResult.value    : null
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

  const { scores, global, signal, noviceData, maxPain } = computeSignal(signalInputs)

  const result = {
    asset:     assetCode,
    spot:      market.spot ?? null,
    scores,
    global,
    signal,
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
