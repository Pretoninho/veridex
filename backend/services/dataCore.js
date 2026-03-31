/**
 * backend/services/dataCore.js — Façade Data Core
 *
 * Couche de service entre les routes et le data_core.
 * Permet d'ajouter de la logique de transformation ou de filtrage
 * sans toucher aux providers directement.
 *
 * Usage :
 *   const { getUnifiedData } = require('./dataCore')
 *   const data = await getUnifiedData('BTC')
 */

'use strict'

const { fetchAllData, fetchMultiTimeframeData } = require('../data_core/index')

/**
 * Retourne les données de marché unifiées pour un asset.
 * Structure compatible avec computeSignal() de signalEngine.js.
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
async function getUnifiedData(asset) {
  const data = await fetchAllData(asset)
  return data
}

async function getUnifiedDataMultiTimeframe(asset) {
  return fetchMultiTimeframeData(asset)
}

module.exports = { getUnifiedData, getUnifiedDataMultiTimeframe }
