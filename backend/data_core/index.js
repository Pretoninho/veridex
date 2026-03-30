/**
 * backend/data_core/index.js — Point d'entrée du Data Core serveur
 *
 * v2.0: Deribit + On-Chain only
 * Façade unifiée : agrège Deribit et données on-chain.
 * Retourne une structure compatible avec signalEngine.js.
 *
 * Usage :
 *   const { fetchAllData } = require('./data_core')
 *   const data = await fetchAllData('BTC')
 *   // { spot, dvol, funding, rv, basisAvg, pcRatio, onChainScore, onChain, asset }
 */

'use strict'

const { SmartCache } = require('../utils/cache')
const deribit        = require('./providers/deribit')
const onchain        = require('./providers/onchain')
const { normalizeOnChain } = require('./normalizers/format_data')

// TTL 30 s — synchronisé avec le cycle de polling minimum
const _cache = new SmartCache({ ttlMs: 30_000 })

/**
 * Récupère et normalise toutes les données de marché pour un asset donné.
 *
 * @param {'BTC'|'ETH'} asset
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   pcRatio: number|null,
 *   onChainScore: number|null,
 *   onChain: object|null,
 *   timestamp: number,
 * }>}
 */
async function fetchAllData(asset) {
  const key = `data_core:${asset.toUpperCase()}`

  return _cache.getOrFetch(key, async () => {
    const [
      spotResult,
      dvolResult,
      fundingResult,
      rvResult,
      oiResult,
      onchainResult,
      fearGreedResult,
      hashRateResult,
      fundingHistResult,
    ] = await Promise.allSettled([
      deribit.getSpot(asset),
      deribit.getDVOL(asset),
      deribit.getFundingRate(asset),
      deribit.getRealizedVol(asset),
      deribit.getOpenInterest(asset),
      onchain.getOnChainSnapshot(asset),
      onchain.getFearGreedIndex(),
      onchain.getHashRateHistory(),
      deribit.getFundingRateHistory(asset, 21), // 21 × 8h = 7 days
    ])

    const spot     = spotResult.status     === 'fulfilled' ? spotResult.value?.price ?? null : null
    const dvol     = dvolResult.status     === 'fulfilled' ? dvolResult.value    : null
    const funding  = fundingResult.status  === 'fulfilled' ? fundingResult.value : null
    const rv       = rvResult.status       === 'fulfilled' ? rvResult.value      : null
    const oi       = oiResult.status       === 'fulfilled' ? oiResult.value      : null
    const snapshot = onchainResult.status  === 'fulfilled' ? onchainResult.value : null
    const fearGreed = fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null
    const hashRate  = hashRateResult.status  === 'fulfilled' ? hashRateResult.value  : null
    const fundingHist = fundingHistResult.status === 'fulfilled' ? fundingHistResult.value : null

    // Compute 7-day annualized funding average from history, fall back to current rate
    const fundingHistItems = fundingHist?.history ?? []
    const avg7Items = fundingHistItems.slice(-21)
    const avgAnn7d = avg7Items.length > 0
      ? avg7Items.reduce((s, r) => s + (r.rateAnn ?? 0), 0) / avg7Items.length
      : (funding?.rateAnn ?? null)

    const basisAvg = await deribit.getBasisAvg(asset, spot).catch(() => null)

    // Normaliser les données on-chain en score composite
    const onChainNorm = normalizeOnChain({
      blockchain:    snapshot?.blockchain    ?? null,
      mempool:       snapshot?.mempool       ?? null,
      fearGreed,
      hashRateHistory: hashRate,
      exchangeFlows: null, // optional — requires CRYPTOQUANT_API_KEY env var
    })

    return {
      asset:        asset.toUpperCase(),
      spot,
      dvol,
      funding:      funding ? { ...funding, avgAnn7d } : null,
      rv,
      basisAvg,
      pcRatio:      oi?.putCallRatio ?? null,
      onChainScore: onChainNorm.composite.onChainScore,
      onChain:      onChainNorm,
      timestamp:    Date.now(),
    }
  })
}

module.exports = {
  fetchAllData,
  // Re-export providers for direct use if needed
  deribit,
  onchain,
}
