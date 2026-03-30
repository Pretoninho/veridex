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
import {
  getOnChainSnapshot,
  getFearGreedIndex,
  getHashRateHistory,
} from '../data/providers/onchain.js'
import { normalizeOnChain } from '../data/normalizers/format_data.js'
import { computeSignal } from '../signals/signal_engine.js'
import { hashData, smartCache } from '../data/data_store/cache.js'
import { createFingerprint, recordPattern, updateOutcomes, getAllPatterns, getPatternStats } from '../signals/market_fingerprint.js'
import { savePatternAuditEntry } from '../signals/pattern_audit.js'
import { getCachedEconomicEvents } from '../signals/economic_calendar.js'
import { isInNewsWindow } from '../signals/inNewsWindow.js'

const SIGNAL_CACHE_VERSION = 1
const buildSignalCacheKey = (assetCode, kind) =>
  `signals:${assetCode}:v${SIGNAL_CACHE_VERSION}:${kind}`

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
  const assetCode = asset.toUpperCase()

  const [marketResult, onchainResult, fearGreedResult, hashRateResult] =
    await Promise.allSettled([
      fetchMarket(assetCode),
      getOnChainSnapshot(assetCode),
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
    asset:        assetCode,
    pcRatio:      market.pcRatio      ?? null,
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

  const { scores, global, signal, noviceData, maxPain, positioning } = computeSignal(signalInputs)

  const result = {
    asset:      assetCode,
    spot:       market.spot ?? null,
    scores,
    global,
    signal,
    noviceData,
    maxPain,
    positioning,
    timestamp:  Date.now(),
  }

  smartCache.set(inputKey, { hash: nextHash, inputs: signalInputs })
  smartCache.set(resultKey, result)

  // Enregistre le fingerprint du marché actuel dans IndexedDB (fire-and-forget)
  if (market.spot != null) {
    const dvol = market.dvol
    const ivRank = (dvol != null && dvol.monthMax > dvol.monthMin)
      ? ((dvol.current - dvol.monthMin) / (dvol.monthMax - dvol.monthMin)) * 100
      : null
    const fingerprint = createFingerprint({
      ivRank,
      fundingPct: market.funding != null ? (market.funding.rateAnn ?? 0) / 100 : null,
      spreadPct:  null,
      basisPct:   market.basisAvg ?? null,
    })
    // Vérifie la fenêtre news (T±30min autour d'une annonce macro High)
    const { events: ecoEvents }    = getCachedEconomicEvents()
    const newsWindowResult         = isInNewsWindow(Date.now(), ecoEvents)

    // recordPattern écrit en premier, puis updateOutcomes lit le record mis à jour —
    // les deux chaînes sont séquentielles pour éviter un conflit d'écriture sur la même clé IndexedDB.
    recordPattern(fingerprint, market.spot)
      .then(() => Promise.all([
        getPatternStats(fingerprint.hash),
        // Met à jour les outcomes de tous les patterns connus avec le prix actuel
        getAllPatterns().then(patterns =>
          Promise.all(patterns.map(p => updateOutcomes(p.hash, market.spot).catch(() => {})))
        ),
      ]))
      .then(([stats]) => {
        savePatternAuditEntry({
          asset:       assetCode,
          hash:        fingerprint.hash,
          config:      fingerprint.config,
          inputs: {
            ivRank:     ivRank,
            fundingAnn: market.funding?.rateAnn ?? null,
            basisPct:   market.basisAvg ?? null,
          },
          spot:        market.spot,
          occurrences: stats?.occurrences ?? 1,
          newsWindow: {
            inWindow:    newsWindowResult.inWindow,
            minutesAway: newsWindowResult.minutesAway,
            isPre:       newsWindowResult.isPre,
            isPost:      newsWindowResult.isPost,
            event:       newsWindowResult.nearestEvent
              ? { ts: newsWindowResult.nearestEvent.ts, event: newsWindowResult.nearestEvent.event, currency: newsWindowResult.nearestEvent.currency }
              : null,
          },
        })

        // Démarre une session de suivi PatternSession si aucune session active n'existe déjà pour ce hash
        const sessionManager = window.__veridexTrackers?.[assetCode]?.sessionManager
        if (sessionManager) {
          const hasActive = sessionManager.activeSessions.some(
            s => s.patternHash === fingerprint.hash
          )
          if (!hasActive) {
            sessionManager.onPatternDetected(
              fingerprint.hash,
              'composite',
              Date.now(),
              { durationMs: 3_600_000 }
            )
          }
        }
      })
      .catch(() => {})
  }

  return result
}
