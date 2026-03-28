/**
 * src/api/backend.js
 *
 * Frontend-only aggregator — computes market data and signals directly in the
 * browser using the existing provider / signal-engine layer.
 *
 * Exports the same function signatures as the former backend client so that
 * all call-sites (SignalsPage, etc.) require zero changes.
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
import { getLongShortRatio } from '../data/providers/binance.js'
import {
  getOnChainSnapshot,
  getFearGreedIndex,
  getHashRateHistory,
} from '../data/providers/onchain.js'
import { normalizeOnChain } from '../data/normalizers/format_data.js'
import { computeSignal } from '../signals/signal_engine.js'
import { hashData, smartCache } from '../data/data_store/cache.js'

const SIGNAL_CACHE_VERSION = 'v1'

/**
 * Fetch raw normalized market data for the given asset directly from providers.
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   lsRatio: number|null,
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
    lsResult,
    fundingHistResult,
  ] = await Promise.allSettled([
    getSpot(a),
    getDVOL(a),
    getFundingRate(a),
    getRealizedVol(a),
    getOpenInterest(a),
    getLongShortRatio(a),
    getFundingRateHistory(a, 21),
  ])

  const spot    = spotResult.status    === 'fulfilled' ? spotResult.value?.price ?? null : null
  const dvol    = dvolResult.status    === 'fulfilled' ? dvolResult.value    : null
  const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : null
  const rv      = rvResult.status      === 'fulfilled' ? rvResult.value      : null
  const oi      = oiResult.status      === 'fulfilled' ? oiResult.value      : null
  const ls      = lsResult.status      === 'fulfilled' ? lsResult.value      : null

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
    lsRatio:   ls?.ratio           ?? null,
    pcRatio:   oi?.putCallRatio    ?? null,
    timestamp: Date.now(),
  }
}

/**
 * Fetch the computed market signal for the given asset, built entirely in the
 * browser from live provider data.
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   scores: { s1, s2, s3, s4, s5, s6 },
 *   global: number|null,
 *   signal: { label: string, action: string }|null,
 *   positioning: object|null,
 *   timestamp: number,
 * }>}
 */
export async function fetchSignals(asset) {
  const a = asset.toUpperCase()

  const [marketResult, onchainResult, fearGreedResult, hashRateResult] =
    await Promise.allSettled([
      fetchMarket(a),
      getOnChainSnapshot(a),
      getFearGreedIndex(),
      getHashRateHistory(),
    ])

  const market    = marketResult.status    === 'fulfilled' ? marketResult.value    : {}
  const snapshot  = onchainResult.status   === 'fulfilled' ? onchainResult.value   : null
  const fearGreed = fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null
  const hashRate  = hashRateResult.status  === 'fulfilled' ? hashRateResult.value  : null

  const onChainNorm = normalizeOnChain({
    blockchain:      snapshot?.blockchain ?? null,
    mempool:         snapshot?.mempool    ?? null,
    fearGreed,
    hashRateHistory: hashRate,
    exchangeFlows:   null,
  })

  const signalInputs = {
    dvol:         market.dvol         ?? null,
    funding:      market.funding      ?? null,
    rv:           market.rv           ?? null,
    basisAvg:     market.basisAvg     ?? null,
    onChainScore: onChainNorm.composite.onChainScore,
    spot:         market.spot         ?? null,
    asset:        a,
    lsRatio:      market.lsRatio      ?? null,
    pcRatio:      market.pcRatio      ?? null,
  }

  const inputKey  = `signals:${a}:${SIGNAL_CACHE_VERSION}:inputs`
  const resultKey = `signals:${a}:${SIGNAL_CACHE_VERSION}:result`
  const prevInputs = smartCache.get(inputKey)
  const prevHash = prevInputs ? hashData(prevInputs) : null
  const cached = smartCache.get(resultKey)
  const nextHash = hashData(signalInputs)
  const inputsChanged = prevHash === null || nextHash !== prevHash

  if (!inputsChanged) {
    if (cached) return cached
  }

  smartCache.set(inputKey, signalInputs)

  const { scores, global, signal, noviceData, maxPain, positioning } = computeSignal(signalInputs)

  const result = {
    asset:      a,
    spot:       market.spot ?? null,
    scores,
    global,
    signal,
    noviceData,
    maxPain,
    positioning,
    timestamp:  Date.now(),
  }

  smartCache.set(resultKey, result)
  return result
}
