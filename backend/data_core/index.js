/**
 * backend/data_core/index.js — Point d'entrée du Data Core serveur
 *
 * Façade unifiée : agrège Deribit, Binance et données on-chain.
 * Retourne une structure compatible avec signalEngine.js.
 *
 * Usage :
 *   const { fetchAllData } = require('./data_core')
 *   const data = await fetchAllData('BTC')
 *   // { spot, dvol, funding, rv, basisAvg, lsRatio, pcRatio, onChainScore, onChain, asset }
 */

'use strict'

const { SmartCache } = require('../utils/cache')
const deribit        = require('./providers/deribit')
const binance        = require('./providers/binance')
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
 *   lsRatio: number|null,
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
      lsResult,
      onchainResult,
      fearGreedResult,
      hashRateResult,
    ] = await Promise.allSettled([
      deribit.getSpot(asset),
      deribit.getDVOL(asset),
      deribit.getFundingRate(asset),
      deribit.getRealizedVol(asset),
      deribit.getOpenInterest(asset),
      binance.getLongShortRatio(asset),
      onchain.getOnChainSnapshot(asset),
      onchain.getFearGreedIndex(),
      onchain.getHashRateHistory(),
    ])

    const spot     = spotResult.status     === 'fulfilled' ? spotResult.value?.price ?? null : null
    const dvol     = dvolResult.status     === 'fulfilled' ? dvolResult.value    : null
    const funding  = fundingResult.status  === 'fulfilled' ? fundingResult.value : null
    const rv       = rvResult.status       === 'fulfilled' ? rvResult.value      : null
    const oi       = oiResult.status       === 'fulfilled' ? oiResult.value      : null
    const ls       = lsResult.status       === 'fulfilled' ? lsResult.value      : null
    const snapshot = onchainResult.status  === 'fulfilled' ? onchainResult.value : null
    const fearGreed = fearGreedResult.status === 'fulfilled' ? fearGreedResult.value : null
    const hashRate  = hashRateResult.status  === 'fulfilled' ? hashRateResult.value  : null

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
      funding,
      rv,
      basisAvg,
      lsRatio:      ls?.ratio      ?? null,
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
  binance,
  onchain,
}
