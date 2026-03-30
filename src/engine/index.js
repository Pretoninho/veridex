/**
 * engine/index.js — DataCore orchestration facade
 *
 * Orchestrates data providers, streams, and stores for a unified
 * data fetching and caching pipeline across exchanges.
 */
import { dataStore, CacheKey }                from '../data/data_store/cache.js'
import * as deribitProvider                   from '../data/providers/deribit.js'
import { wsStream, DeribitChannels }          from '../data/streams/websocket.js'
import { pollingStream, PollInterval, pollToStore } from '../data/streams/polling.js'

class DataCore {
  constructor() {
    this.store   = dataStore
    this.keys    = CacheKey
    this.ws      = wsStream
    this.polling = pollingStream

    this.providers = {
      deribit:  deribitProvider,
    }

    this._stopFns = []
    this._initialized = false
  }

  /**
   * Initialise le data core pour un ou plusieurs assets.
   * Lance les polls de fond et démarre les connexions WS.
   * v2.0: Deribit-only architecture
   *
   * @param {string|string[]} assets  — ex: 'BTC' ou ['BTC', 'ETH']
   * @param {Object} [opts]
   * @param {boolean} [opts.websocket=true]  — activer le WS temps réel
   */
  async init(assets = ['BTC'], opts = {}) {
    const list = [assets].flat().map(a => a.toUpperCase())
    const {
      websocket = true,
    } = opts

    // 1. Chargement initial (snapshot REST) - Deribit only
    const initialRequests = [
      ...list.map(asset => deribitProvider.getMarketSnapshot(asset)),
      ...list.flatMap(asset => [
        deribitProvider.getFundingRateHistory(asset),
        deribitProvider.getDeliveryPrices(asset),
        deribitProvider.getLastTrades(asset),
      ])
    ]

    // Un seul appel Promise.allSettled pour tous les snapshots et historiques
    await Promise.allSettled(initialRequests)

    // 2. Polls de fond
    list.forEach(asset => {
      // ── Deribit ────────────────────────────────────────────────────────────
      this._stopFns.push(pollToStore(
        CacheKey.spot('deribit', asset),
        () => deribitProvider.getSpot(asset),
        PollInterval.REALTIME, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.dvol('deribit', asset),
        () => deribitProvider.getDVOL(asset),
        PollInterval.NORMAL, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.oi('deribit', asset),
        () => deribitProvider.getOpenInterest(asset),
        PollInterval.FAST, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.funding('deribit', asset),
        () => deribitProvider.getFundingRate(asset),
        PollInterval.FAST, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.fundingHistory('deribit', asset),
        () => deribitProvider.getFundingRateHistory(asset),
        PollInterval.SLOW, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.trades('deribit', asset),
        () => deribitProvider.getLastTrades(asset),
        PollInterval.FAST, dataStore,
      ))
      this._stopFns.push(pollToStore(
        CacheKey.deliveryPrices('deribit', asset),
        () => deribitProvider.getDeliveryPrices(asset),
        PollInterval.SLOW, dataStore,
      ))
    })

    // 3. WebSocket temps réel (Deribit)
    if (websocket) {
      list.forEach(asset => {
        const stop = wsStream.subscribe(
          'deribit',
          DeribitChannels.indexPrice(asset),
          (data) => {
            if (data?.index_price != null) {
              dataStore.set(CacheKey.spot('deribit', asset), {
                source: 'deribit',
                asset,
                type: 'spot',
                instrument: `${asset}_USD`,
                price: data.index_price,
                bid: null, ask: null, volume24h: null,
                timestamp: Date.now(),
                raw: data,
              })
            }
          }
        )
        this._stopFns.push(stop)

        const stopDvol = wsStream.subscribe(
          'deribit',
          DeribitChannels.dvol(asset),
          (data) => {
            const cached = dataStore.get(CacheKey.dvol('deribit', asset), true)
            if (cached && data?.volatility != null) {
              dataStore.set(CacheKey.dvol('deribit', asset), {
                ...cached,
                current: data.volatility,
                timestamp: Date.now(),
              })
            }
          }
        )
        this._stopFns.push(stopDvol)
      })
    }

    this._initialized = true
  }

  /**
   * Arrête tous les flux et déconnecte les WebSockets.
   */
  destroy() {
    this._stopFns.forEach(stop => { try { stop() } catch (_) {} })
    this._stopFns = []
    wsStream.disconnectAll()
    pollingStream.stopAll()
    this._initialized = false
  }

  /** Retourne un diagnostic de l'état du data core. */
  status() {
    return {
      initialized: this._initialized,
      cacheSnapshot: dataStore.snapshot(),
      wsStatus: wsStream.status(),
      activePolls: pollingStream.activeJobs(),
    }
  }
}

export const dataCore = new DataCore()
