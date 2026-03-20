/**
 * data_core/index.js — Point d'entrée unique du Data Core
 *
 * Toute la couche supérieure (data_processing, strategy_engine, UI)
 * importe exclusivement depuis ici. Jamais directement depuis les sous-modules.
 *
 * Architecture :
 *
 *   data_core/
 *   ├── providers/      ← appels REST par plateforme
 *   ├── streams/        ← WebSocket (temps réel) + polling (fallback)
 *   ├── normalizers/    ← transformation en format canonique
 *   └── data_store/     ← cache central + subscriptions
 *
 * Démarrage rapide :
 *
 *   import { dataCore } from './data_core'
 *
 *   // Initialiser pour un asset
 *   await dataCore.init('BTC')
 *
 *   // Lire depuis le cache
 *   const spot = dataCore.store.get(dataCore.keys.spot('deribit', 'BTC'))
 *
 *   // S'abonner aux mises à jour
 *   const unsub = dataCore.store.subscribe(
 *     dataCore.keys.spot('deribit', 'BTC'),
 *     (ticker) => console.log(ticker.price)
 *   )
 *
 *   // Flux WebSocket temps réel
 *   const stop = dataCore.ws.subscribe('deribit', 'ticker.BTC-PERPETUAL.raw', onTicker)
 *
 *   // Nettoyage
 *   dataCore.destroy()
 */

// ── Exports : store ───────────────────────────────────────────────────────────
export { dataStore, CacheKey } from './data_store/cache.js'

// ── Exports : providers ───────────────────────────────────────────────────────
export * as deribit  from './providers/deribit.js'
export * as binance  from './providers/binance.js'
export * as coinbase from './providers/coinbase.js'

// ── Exports : streams ─────────────────────────────────────────────────────────
export { wsStream, DeribitChannels }     from './streams/websocket.js'
export { pollingStream, PollInterval, pollToStore } from './streams/polling.js'

// ── Exports : normalizers ─────────────────────────────────────────────────────
export {
  // Deribit
  normalizeDeribitSpot,
  normalizeDeribitOrderBook,
  normalizeDeribitOption,
  normalizeDeribitDVOL,
  normalizeDeribitFunding,
  normalizeDeribitOI,
  // Binance
  normalizeBinanceTicker,
  normalizeBinanceFunding,
  normalizeBinanceOI,
  // Coinbase
  normalizeCoinbaseTicker,
  // Utilitaires
  mergeSpotTickers,
} from './normalizers/format_data.js'

// ── Facade DataCore ───────────────────────────────────────────────────────────
// Interface de haut niveau pour initialiser et piloter le data core.

import { dataStore, CacheKey }                from './data_store/cache.js'
import * as deribitProvider                   from './providers/deribit.js'
import * as binanceProvider                   from './providers/binance.js'
import * as coinbaseProvider                  from './providers/coinbase.js'
import { wsStream, DeribitChannels }          from './streams/websocket.js'
import { pollingStream, PollInterval, pollToStore } from './streams/polling.js'

class DataCore {
  constructor() {
    this.store   = dataStore
    this.keys    = CacheKey
    this.ws      = wsStream
    this.polling = pollingStream

    this.providers = {
      deribit:  deribitProvider,
      binance:  binanceProvider,
      coinbase: coinbaseProvider,
    }

    this._stopFns = []
    this._initialized = false
  }

  /**
   * Initialise le data core pour un ou plusieurs assets.
   * Lance les polls de fond et démarre les connexions WS.
   *
   * @param {string|string[]} assets  — ex: 'BTC' ou ['BTC', 'ETH']
   * @param {Object} [opts]
   * @param {boolean} [opts.websocket=true]  — activer le WS temps réel
   * @param {boolean} [opts.binance=true]    — activer les polls Binance
   * @param {boolean} [opts.coinbase=false]  — activer les polls Coinbase
   */
  async init(assets = ['BTC'], opts = {}) {
    const list = [assets].flat().map(a => a.toUpperCase())
    const {
      websocket = true,
      binance   = true,
      coinbase  = false,
    } = opts

    // 1. Chargement initial (snapshot REST)
    await Promise.allSettled(
      list.map(asset => deribitProvider.getMarketSnapshot(asset))
    )

    if (binance) {
      await Promise.allSettled(
        list.map(asset => binanceProvider.getMarketSnapshot(asset))
      )
    }

    if (coinbase) {
      await Promise.allSettled(
        list.map(asset => coinbaseProvider.getMarketSnapshot(asset))
      )
    }

    // 2. Polls de fond (données lentes)
    list.forEach(asset => {
      // DVOL toutes les minutes
      this._stopFns.push(
        pollToStore(
          CacheKey.dvol('deribit', asset),
          () => deribitProvider.getDVOL(asset),
          PollInterval.NORMAL,
          dataStore,
        )
      )

      // OI toutes les 15s
      this._stopFns.push(
        pollToStore(
          CacheKey.oi('deribit', asset),
          () => deribitProvider.getOpenInterest(asset),
          PollInterval.FAST,
          dataStore,
        )
      )

      // Funding Deribit toutes les 15s
      this._stopFns.push(
        pollToStore(
          CacheKey.funding('deribit', asset),
          () => deribitProvider.getFundingRate(asset),
          PollInterval.FAST,
          dataStore,
        )
      )

      // Funding Binance toutes les 15s
      if (binance) {
        this._stopFns.push(
          pollToStore(
            CacheKey.funding('binance', asset),
            () => binanceProvider.getFundingRate(asset),
            PollInterval.FAST,
            dataStore,
          )
        )
      }

      // Spot Deribit toutes les 5s
      this._stopFns.push(
        pollToStore(
          CacheKey.spot('deribit', asset),
          () => deribitProvider.getSpot(asset),
          PollInterval.REALTIME,
          dataStore,
        )
      )
    })

    // 3. WebSocket temps réel (Deribit)
    if (websocket) {
      list.forEach(asset => {
        // Index price
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

        // DVOL
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
