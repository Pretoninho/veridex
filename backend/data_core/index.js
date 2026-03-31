/**
 * backend/data_core/index.js — Point d'entrée du Data Core serveur
 *
 * v2.1: Deribit only (refactored)
 * Façade simplifiée : Deribit REST API uniquement.
 * Retourne une structure compatible avec signalEngine.js.
 *
 * Usage :
 *   const { fetchAllData } = require('./data_core')
 *   const data = await fetchAllData('BTC')
 *   // { spot, dvol, funding, rv, basisAvg, asset, timestamp }
 */

'use strict'

const { SmartCache } = require('../utils/cache')
const deribit        = require('./providers/deribit')

// TTL 30 s — synchronisé avec le cycle de polling minimum
const _cache = new SmartCache({ ttlMs: 30_000 })

/**
 * Récupère et normalise toutes les données de marché pour un asset donné.
 * Deribit API uniquement (refactored v2.1).
 *
 * @param {'BTC'|'ETH'} asset
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
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
      fundingHistResult,
    ] = await Promise.allSettled([
      deribit.getSpot(asset),
      deribit.getDVOL(asset),
      deribit.getFundingRate(asset),
      deribit.getRealizedVol(asset),
      deribit.getFundingRateHistory(asset, 21), // 21 × 8h = 7 days
    ])

    const spot     = spotResult.status === 'fulfilled' ? spotResult.value?.price ?? null : null
    const dvol     = dvolResult.status === 'fulfilled' ? dvolResult.value : null
    const funding  = fundingResult.status === 'fulfilled' ? fundingResult.value : null
    const rv       = rvResult.status === 'fulfilled' ? rvResult.value : null
    const fundingHist = fundingHistResult.status === 'fulfilled' ? fundingHistResult.value : null

    // Compute 7-day annualized funding average from history
    const fundingHistItems = fundingHist?.history ?? []
    const avg7Items = fundingHistItems.slice(-21)
    const avgAnn7d = avg7Items.length > 0
      ? avg7Items.reduce((s, r) => s + (r.rateAnn ?? 0), 0) / avg7Items.length
      : (funding?.rateAnn ?? null)

    const basisAvg = await deribit.getBasisAvg(asset, spot).catch(() => null)

    return {
      asset: asset.toUpperCase(),
      spot,
      dvol,
      funding: funding ? { ...funding, avgAnn7d } : null,
      rv,
      basisAvg,
      timestamp: Date.now(),
    }
  })
}

async function fetchMultiTimeframeData(asset) {
  const normalizedAsset = asset.toUpperCase()
  const [data4h, data1h, data5m] = await Promise.all([
    deribit.getTimeframeData(normalizedAsset, '4h'),
    deribit.getTimeframeData(normalizedAsset, '1h'),
    deribit.getTimeframeData(normalizedAsset, '5m'),
  ])

  return {
    asset: normalizedAsset,
    data_4h: data4h,
    data_1h: data1h,
    data_5m: data5m,
    timestamp: Date.now(),
  }
}

module.exports = {
  fetchAllData,
  fetchMultiTimeframeData,
  // Re-export providers for direct use if needed
  deribit,
}
