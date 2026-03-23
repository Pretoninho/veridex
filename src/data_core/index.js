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
export { dataStore, CacheKey, SmartCache, smartCache, fnv1a, hashData } from './data_store/cache.js'
export { POLL, HASH_CONFIG } from './data_store/hash_config.js'

export {
  getCacheChangeLog,
  clearCacheChangeLog,
} from './data_store/cache.js'

export {
  buildSearchIndex,
  filterByHash,
  filterByDate,
  filterByEvent,
  applyFilters,
} from './data_store/hash_search.js'

// ── Exports : providers ───────────────────────────────────────────────────────
export * as deribit  from './providers/deribit.js'
export * as binance  from './providers/binance.js'
export * as coinbase from './providers/coinbase.js'
export * as onchain  from './providers/onchain.js'

export {
  getOnChainSnapshot,
  getBlockchainStats,
  getMempoolData,
  getGlassnodeExchangeFlow,
  getCryptoQuantFlow,
  getHashRateHistory,
  getFearGreedIndex,
  getWhaleTransactions,
} from './providers/onchain.js'

// ── Exports : clock sync ──────────────────────────────────────────────────────
export {
  syncServerClocks,
  getNextFundingTime,
  getTimeCorrected,
  getDaysUntilCorrected,
  SYNC_INTERVAL_MS,
} from './providers/clock_sync.js'

export { getDeribitTime }  from './providers/deribit.js'
export { getBinanceTime }  from './providers/binance.js'
export { getCoinbaseTime } from './providers/coinbase.js'

export { getCachedClockSync, setCachedClockSync } from './data_store/cache.js'

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
  normalizeDeribitFundingHistory,
  normalizeDeribitDeliveryPrices,
  normalizeDeribitTrades,
  // Binance
  normalizeBinanceTicker,
  normalizeBinanceFunding,
  normalizeBinanceOI,
  normalizeBinancePremiumIndex,
  normalizeBinanceSentiment,
  normalizeBinanceTakerVolume,
  normalizeBinanceLiquidations,
  normalizeBinanceOptions,
  normalizeBinanceOptionsOI,
  // Coinbase
  normalizeCoinbaseTicker,
  // Utilitaires
  mergeSpotTickers,
  validateDataFreshness,
  normalizeOnChain,
  getHistoricalContext,
} from './normalizers/format_data.js'

// ── Exports : Max Pain ────────────────────────────────────────────────────────
export {
  parseInstrument,
  calculateMaxPain,
  calculateMaxPainByExpiry,
  interpretMaxPain,
} from '../data_processing/volatility/max_pain.js'

// ── Exports : Settlement Tracker ──────────────────────────────────────────────
export {
  setupSettlementWatcher,
  captureSettlement,
  getSettlementHistory,
  getSettlementByDate,
  getSettlementByHash,
  clearSettlementHistory,
} from '../data_processing/signals/settlement_tracker.js'

// ── Exports : Publish Trigger ─────────────────────────────────────────────────
export {
  TRIGGER_TYPES,
  TRIGGER_META,
  detectTrigger,
  detectSettlementTrigger,
  markAsPublished,
  isAlreadyPublished,
} from '../data_processing/signals/publish_trigger.js'

// ── Exports : Twitter Generator ───────────────────────────────────────────────
export {
  generateTwitterThread,
} from '../data_processing/signals/twitter_generator.js'

// ── Exports : Notification Engine ─────────────────────────────────────────────
export {
  checkNotifications,
  notifyAnomaly,
} from '../data_processing/signals/notification_engine.js'

// ── Exports : Notification Manager ────────────────────────────────────────────
export {
  DEFAULT_THRESHOLDS,
  requestPermission,
  getPermissionStatus,
  getThresholds,
  updateThreshold,
  resetThresholds,
  sendNotification,
  getNotificationHistory,
  clearNotificationHistory,
} from '../data_processing/signals/notification_manager.js'

// ── Exports : signals & fingerprint ──────────────────────────────────────────
export {
  detectMarketAnomaly,
  hashMarketState,
  saveSignal,
  getSignalHistory,
  getAnomalyLog,
  clearAnomalyLog,
} from '../data_processing/signals/signal_engine.js'

export {
  detectExchangeFlowSignal,
  detectMempoolSignal,
  detectMinerSignal,
  compositeOnChainSignal,
  interpretMempoolExpert,
  interpretFearGreedExpert,
  interpretWhalesExpert,
  interpretHashRateExpert,
} from '../data_processing/signals/onchain_signals.js'

export {
  createFingerprint,
  recordPattern,
  updateOutcomes,
  getPatternStats,
  getAllPatterns,
} from '../data_processing/signals/market_fingerprint.js'

// ── Exports : Snapshot Generator ──────────────────────────────────────────────
export {
  SNAPSHOT_VERSION,
  MIN_OCCURRENCES_TO_EXPORT,
  GENESIS_HASH,
  generateSnapshot,
  verifySnapshot,
  snapshotToJSON,
  snapshotFromJSON,
  getSnapshotHistory,
} from '../data_processing/signals/snapshot_generator.js'

// ── Exports : Snapshot Importer ───────────────────────────────────────────────
export {
  shouldImportSnapshot,
  importSnapshot,
  runInitialImport,
  getImportState,
  resetImportState,
} from '../data_processing/signals/snapshot_importer.js'

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
   * @param {boolean} [opts.coinbase=true]   — activer les polls Coinbase
   */
  async init(assets = ['BTC'], opts = {}) {
    const list = [assets].flat().map(a => a.toUpperCase())
    const {
      websocket = true,
      binance   = true,
      coinbase  = true,
    } = opts

    // 1. Chargement initial (snapshot REST)
    await Promise.allSettled(
      list.map(asset => deribitProvider.getMarketSnapshot(asset))
    )

    if (binance) {
      await Promise.allSettled(
        list.map(asset => binanceProvider.getMarketSnapshot(asset))
      )
      await Promise.allSettled(
        list.flatMap(asset => [
          binanceProvider.getLongShortRatio(asset),
          binanceProvider.getTakerVolume(asset),
          binanceProvider.getLiquidations(asset),
          binanceProvider.getOptionsChain(asset),
        ])
      )
      await Promise.allSettled(
        list.flatMap(asset => [
          deribitProvider.getFundingRateHistory(asset),
          deribitProvider.getDeliveryPrices(asset),
          deribitProvider.getLastTrades(asset),
        ])
      )
    }

    if (coinbase) {
      await Promise.allSettled(
        list.map(asset => coinbaseProvider.getMarketSnapshot(asset))
      )
    }

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

      // ── Binance ────────────────────────────────────────────────────────────
      if (binance) {
        this._stopFns.push(pollToStore(
          CacheKey.spot('binance', asset),
          () => binanceProvider.getSpot(asset),
          PollInterval.REALTIME, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.premiumIndex('binance', asset),
          () => binanceProvider.getPremiumIndex(asset),
          PollInterval.FAST, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.oi('binance', asset),
          () => binanceProvider.getOpenInterest(asset),
          PollInterval.FAST, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.sentiment('binance', asset),
          () => binanceProvider.getLongShortRatio(asset),
          PollInterval.NORMAL, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.takerVolume('binance', asset),
          () => binanceProvider.getTakerVolume(asset),
          PollInterval.NORMAL, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.liquidations('binance', asset),
          () => binanceProvider.getLiquidations(asset),
          PollInterval.FAST, dataStore,
        ))
        this._stopFns.push(pollToStore(
          CacheKey.optionsMark('binance', asset),
          () => binanceProvider.getOptionsChain(asset),
          PollInterval.NORMAL, dataStore,
        ))
      }
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
