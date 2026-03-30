/**
 * streams/websocket.js — Couche WebSocket abstraite
 *
 * Interface unifiée : "je m'abonne à un flux" sans me soucier de la source.
 * Gère : connexion, reconnexion, heartbeat, routage des messages, normalisation.
 *
 * Usage :
 *   const unsub = wsStream.subscribe('deribit', 'ticker:BTC-PERPETUAL', (data) => { ... })
 *   wsStream.unsubscribe(unsub)
 *
 * Les données reçues sont automatiquement normalisées et poussées dans le dataStore.
 */

import {
  normalizeDeribitOrderBook,
  normalizeDeribitOption,
} from '../normalizers/format_data.js'
import { dataStore, CacheKey } from '../data_store/cache.js'

// ── Configuration par plateforme ──────────────────────────────────────────────

const WS_CONFIG = {
  deribit: {
    url: 'wss://www.deribit.com/ws/api/v2',
    heartbeatMethod: 'public/test',
    heartbeatInterval: 15_000,
    staleThreshold: 45_000,
    maxBackoff: 30_000,
    protocol: 'jsonrpc',   // Deribit utilise JSON-RPC 2.0
  },
  // Binance WS sera ajouté ici (streams.binance.com)
  // Coinbase WS sera ajouté ici (advanced-trade-ws.coinbase.com)
}

// ── Classe de connexion par source ────────────────────────────────────────────

class SourceWebSocket {
  constructor(source, config) {
    this.source = source
    this.config = config
    this.ws = null
    this.connected = false
    this.closedByUser = false
    this.reconnectAttempt = 0
    this.heartbeatTimer = null
    this.watchdogTimer = null
    this.reconnectTimer = null
    this.lastMessageAt = 0
    this.nextId = 1
    this.pendingConnect = null

    /** Map<channel, Set<listener>> */
    this.subscriptions = new Map()
    /** Set<listener> pour les événements de statut */
    this.statusListeners = new Set()
  }

  // ── Connexion ──────────────────────────────────────────────────────────────

  connect() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }
    if (this.pendingConnect) return this.pendingConnect

    this.closedByUser = false
    this.pendingConnect = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url)
      } catch (err) {
        this.pendingConnect = null
        reject(err)
        return
      }

      this.ws.onopen = () => {
        this.connected = true
        this.reconnectAttempt = 0
        this.lastMessageAt = Date.now()
        this._startHeartbeat()
        this._resubscribeAll()
        this._emitStatus('connected')
        this.pendingConnect = null
        resolve()
      }

      this.ws.onmessage = evt => {
        this.lastMessageAt = Date.now()
        let payload
        try { payload = JSON.parse(evt.data) } catch { return }
        this._route(payload)
      }

      this.ws.onerror = () => this._emitStatus('error')

      this.ws.onclose = () => {
        this.connected = false
        this._clearTimers()
        this.pendingConnect = null
        this._emitStatus(this.closedByUser ? 'stopped' : 'reconnecting')
        if (!this.closedByUser) this._scheduleReconnect()
      }
    })

    return this.pendingConnect
  }

  disconnect() {
    this.closedByUser = true
    this._clearTimers()
    this.subscriptions.clear()
    try { this.ws?.close() } catch (_) {}
    this.ws = null
    this.connected = false
    this.pendingConnect = null
    this._emitStatus('stopped')
  }

  // ── Abonnements ────────────────────────────────────────────────────────────

  /**
   * S'abonne à un ou plusieurs canaux.
   * @param {string|string[]} channels
   * @param {Function} listener  — appelé avec (normalizedData, channel)
   * @returns {Function} unsubscribe
   */
  subscribe(channels, listener) {
    const list = [...new Set([channels].flat().filter(Boolean))]
    if (!list.length || typeof listener !== 'function') return () => {}

    list.forEach(ch => {
      if (!this.subscriptions.has(ch)) this.subscriptions.set(ch, new Set())
      this.subscriptions.get(ch).add(listener)
    })

    this.connect()
      .then(() => this._send('public/subscribe', { channels: list }))
      .catch(() => {})

    return () => this.unsubscribe(list, listener)
  }

  unsubscribe(channels, listener) {
    const list = [...new Set([channels].flat().filter(Boolean))]
    const toUnsub = []

    list.forEach(ch => {
      const listeners = this.subscriptions.get(ch)
      if (!listeners) return
      listeners.delete(listener)
      if (!listeners.size) {
        this.subscriptions.delete(ch)
        toUnsub.push(ch)
      }
    })

    if (toUnsub.length && this.ws?.readyState === WebSocket.OPEN) {
      this._send('public/unsubscribe', { channels: toUnsub })
    }
  }

  onStatus(listener) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  // ── Routage des messages ───────────────────────────────────────────────────

  _route(payload) {
    if (this.source === 'deribit') {
      this._routeDeribit(payload)
    }
    // TODO: _routeBinance, _routeCoinbase
  }

  _routeDeribit(payload) {
    if (payload?.method !== 'subscription') return
    const channel = payload?.params?.channel
    const raw = payload?.params?.data
    if (!channel || !raw) return

    // Normaliser selon le type de canal
    let normalized = null

    if (channel.startsWith('ticker.')) {
      const name = channel.split('.')[1]
      const isOption = name.endsWith('-C') || name.endsWith('-P')
      normalized = isOption
        ? normalizeDeribitOption(raw)
        : normalizeDeribitOrderBook(raw)

      if (normalized) {
        const asset = name.split('-')[0]
        const key = isOption
          ? CacheKey.option('deribit', asset, name)
          : name.endsWith('-PERPETUAL')
            ? CacheKey.perp('deribit', asset)
            : CacheKey.future('deribit', asset, name)
        dataStore.set(key, normalized)
      }
    }

    // Notifier les listeners du canal
    const listeners = this.subscriptions.get(channel)
    listeners?.forEach(fn => {
      try { fn(normalized ?? raw, channel) } catch (_) {}
    })
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _send(method, params = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    }))
  }

  _resubscribeAll() {
    const channels = [...this.subscriptions.keys()]
    if (channels.length) this._send('public/subscribe', { channels })
  }

  _emitStatus(status) {
    this.statusListeners.forEach(fn => { try { fn(status) } catch (_) {} })
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.closedByUser) return
    const delay = Math.min(this.config.maxBackoff, 1000 * (2 ** this.reconnectAttempt))
      + Math.floor(Math.random() * 300)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => this._scheduleReconnect())
    }, delay)
  }

  _startHeartbeat() {
    this._clearTimers()
    // OPTIMISATION: Un seul setInterval pour les deux responsabilités (heartbeat + watchdog)
    // au lieu de deux setInterval concurrents sur le même interval
    this.heartbeatTimer = setInterval(() => {
      // 1. Send heartbeat
      this._send(this.config.heartbeatMethod, {})

      // 2. Check watchdog (même interval)
      if (this.lastMessageAt && Date.now() - this.lastMessageAt > this.config.staleThreshold) {
        try { this.ws?.close() } catch (_) {}
      }
    }, this.config.heartbeatInterval)
  }

  _clearTimers() {
    clearInterval(this.heartbeatTimer)
    clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = null
    this.reconnectTimer = null
  }
}

// ── Gestionnaire multi-sources ────────────────────────────────────────────────

class WebSocketStream {
  constructor() {
    /** @type {Map<string, SourceWebSocket>} */
    this._connections = new Map()
  }

  _getOrCreate(source) {
    if (!this._connections.has(source)) {
      const config = WS_CONFIG[source]
      if (!config) throw new Error(`Unknown WS source: ${source}`)
      this._connections.set(source, new SourceWebSocket(source, config))
    }
    return this._connections.get(source)
  }

  /**
   * S'abonne à un flux d'une source donnée.
   * @param {'deribit'} source
   * @param {string|string[]} channels  — canaux spécifiques à la plateforme
   * @param {Function} listener         — (normalizedData, channel) => void
   * @returns {Function} unsubscribe
   *
   * @example
   * // Ticker temps-réel du perpetuel BTC sur Deribit
   * const unsub = wsStream.subscribe('deribit', 'ticker.BTC-PERPETUAL.raw', data => {
   *   console.log(data.price, data.markIV)
   * })
   */
  subscribe(source, channels, listener) {
    return this._getOrCreate(source).subscribe(channels, listener)
  }

  /** Écoute les changements de statut d'une connexion. */
  onStatus(source, listener) {
    return this._getOrCreate(source).onStatus(listener)
  }

  /** Déconnecte une source. */
  disconnect(source) {
    this._connections.get(source)?.disconnect()
  }

  /** Déconnecte toutes les sources. */
  disconnectAll() {
    this._connections.forEach(conn => conn.disconnect())
  }

  /** Statut de toutes les connexions actives. */
  status() {
    const result = {}
    this._connections.forEach((conn, source) => {
      result[source] = conn.connected ? 'connected' : 'disconnected'
    })
    return result
  }
}

// Singleton partagé
export const wsStream = new WebSocketStream()

// ── Helpers Deribit ───────────────────────────────────────────────────────────
// Canaux préconstruits pour les cas d'usage les plus fréquents

export const DeribitChannels = {
  /** Ticker d'un instrument (raw = toutes les données) */
  ticker: name => `ticker.${name}.raw`,
  /** Carnet d'ordres d'un instrument */
  orderBook: (name, depth = 1) => `book.${name}.${depth}`,
  /** Index price (spot) */
  indexPrice: asset => `deribit_price_index.${asset.toLowerCase()}_usd`,
  /** DVOL (index de vol implicite) */
  dvol: asset => `deribit_volatility_index.${asset.toLowerCase()}_usd`,
}
