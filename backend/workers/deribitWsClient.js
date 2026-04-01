/**
 * backend/workers/deribitWsClient.js
 *
 * Persistent Deribit WebSocket client.
 * Connects to wss://www.deribit.com/ws/api/v2, subscribes to real-time
 * market data streams, and emits normalized events for downstream consumers.
 *
 * Events emitted:
 *   'connected'            — WebSocket connection established
 *   'disconnected'         — WebSocket connection lost { code, reason }
 *   'error'                — WebSocket error (Error object)
 *   'index'                — Index price update { asset, price, timestamp }
 *   'volatility_index'     — DVOL update { asset, volatility, timestamp }
 *   'ticker'               — Perpetual ticker update { asset, instrument, isUsdc, data, timestamp }
 *
 * Usage:
 *   const wsClient = require('./deribitWsClient')
 *   wsClient.connect()
 *   wsClient.on('index', ({ asset, price }) => { … })
 *   wsClient.disconnect() // graceful shutdown
 */

'use strict'

const { EventEmitter } = require('events')
const WebSocket        = require('ws')

// ── Configuration ─────────────────────────────────────────────────────────────

const WS_URL              = process.env.DERIBIT_WS_URL || 'wss://www.deribit.com/ws/api/v2'
const HEARTBEAT_INTERVAL_S = 30
const RECONNECT_BASE_MS    = 1_000
const RECONNECT_MAX_MS     = 30_000

/** Channels to subscribe to on connect. */
const CHANNELS = [
  // BTC & ETH spot index prices
  'deribit_index.btc_usd',
  'deribit_index.eth_usd',
  // DVOL (implied volatility index)
  'deribit_volatility_index.btc_usd',
  'deribit_volatility_index.eth_usd',
  // Perpetual tickers — funding rate, OI, mark price (100 ms cadence)
  'ticker.BTC-PERPETUAL.100ms',
  'ticker.ETH-PERPETUAL.100ms',
  // USDC perpetuals — used for basis calculation
  'ticker.BTC_USDC-PERPETUAL.100ms',
  'ticker.ETH_USDC-PERPETUAL.100ms',
]

// ── Logging ───────────────────────────────────────────────────────────────────

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase()

function _ts() {
  return new Date().toTimeString().slice(0, 8)
}

function _log(level, msg, ...args) {
  if (level === 'debug' && LOG_LEVEL !== 'debug') return
  const prefix = `[${_ts()}] [${level.toUpperCase()}] [deribitWsClient]`
  if (level === 'error') {
    console.error(prefix, msg, ...args)
  } else {
    console.log(prefix, msg, ...args)
  }
}

// ── Client ────────────────────────────────────────────────────────────────────

class DeribitWsClient extends EventEmitter {
  constructor() {
    super()

    /** @type {WebSocket|null} */
    this._ws               = null
    this._isConnected      = false
    this._isShuttingDown   = false
    this._reconnectAttempt = 0
    this._reconnectTimer   = null
    this._heartbeatTimer   = null
    this._msgId            = 1

    // Status tracking
    this._connectTime    = null
    this._lastMessageAt  = null
    this._reconnectCount = 0
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open the WebSocket connection.
   * Idempotent — safe to call multiple times.
   */
  connect() {
    if (this._isShuttingDown) return
    if (this._isConnected)    return
    this._doConnect()
  }

  /**
   * Close the WebSocket connection and cancel any pending reconnect.
   * Sets _isShuttingDown so no automatic reconnect is attempted afterward.
   */
  disconnect() {
    this._isShuttingDown = true
    this._clearTimers()
    if (this._ws) {
      try { this._ws.terminate() } catch (_) { /* ignore */ }
      this._ws = null
    }
    this._isConnected = false
    _log('info', 'Disconnected (graceful shutdown)')
  }

  /**
   * Return a snapshot of the current connection status.
   * @returns {{ connected: boolean, url: string, subscriptions: string[], connectTime: number|null, lastMessageAt: number|null, reconnectCount: number }}
   */
  getStatus() {
    return {
      connected:      this._isConnected,
      url:            WS_URL,
      subscriptions:  [...CHANNELS],
      connectTime:    this._connectTime,
      lastMessageAt:  this._lastMessageAt,
      reconnectCount: this._reconnectCount,
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _doConnect() {
    _log('info', `Connecting to ${WS_URL}…`)
    let ws
    try {
      ws = new WebSocket(WS_URL)
    } catch (err) {
      _log('error', 'Failed to create WebSocket:', err.message)
      this._scheduleReconnect()
      return
    }

    this._ws = ws

    ws.on('open',    ()              => this._onOpen())
    ws.on('message', (data)          => this._onMessage(data))
    ws.on('close',   (code, reason)  => this._onClose(code, reason))
    ws.on('error',   (err)           => this._onError(err))
    ws.on('pong',    ()              => { this._lastMessageAt = Date.now() })
  }

  _onOpen() {
    _log('info', 'Connected')
    this._isConnected      = true
    this._reconnectAttempt = 0
    this._connectTime      = Date.now()
    this._lastMessageAt    = Date.now()

    this.emit('connected')
    this._setupHeartbeat()
    this._subscribe(CHANNELS)
  }

  _onMessage(raw) {
    this._lastMessageAt = Date.now()

    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch (_) {
      return
    }

    _log('debug', 'Message:', JSON.stringify(msg).slice(0, 160))

    // Server-initiated heartbeat — must respond to test_request
    if (msg.method === 'heartbeat') {
      if (msg.params?.type === 'test_request') {
        this._send({ method: 'public/test', id: this._nextId(), params: {} })
      }
      return
    }

    // Real-time subscription data
    if (msg.method === 'subscription') {
      const { channel, data } = msg.params ?? {}
      if (channel && data) {
        this._handleChannelData(channel, data)
      }
      return
    }

    // Ignore RPC responses (subscribe confirmations, heartbeat setup, etc.)
  }

  /**
   * Route incoming channel data to the correct event.
   * @param {string} channel
   * @param {object} data
   */
  _handleChannelData(channel, data) {
    // deribit_index.btc_usd / deribit_index.eth_usd
    if (channel.startsWith('deribit_index.')) {
      const asset = channel === 'deribit_index.btc_usd' ? 'BTC' : 'ETH'
      this.emit('index', {
        asset,
        price:     data.price,
        timestamp: data.timestamp ?? Date.now(),
      })
      return
    }

    // deribit_volatility_index.btc_usd / deribit_volatility_index.eth_usd
    if (channel.startsWith('deribit_volatility_index.')) {
      const asset = channel.includes('btc') ? 'BTC' : 'ETH'
      this.emit('volatility_index', {
        asset,
        volatility: data.volatility,
        timestamp:  data.timestamp ?? Date.now(),
      })
      return
    }

    // ticker.{INSTRUMENT}.100ms
    if (channel.startsWith('ticker.')) {
      const parts      = channel.split('.')
      const instrument = parts[1] // e.g. "BTC-PERPETUAL" or "BTC_USDC-PERPETUAL"
      const asset      = instrument.startsWith('BTC') ? 'BTC' : 'ETH'
      const isUsdc     = instrument.includes('USDC')
      this.emit('ticker', {
        asset,
        instrument,
        isUsdc,
        data,
        timestamp: data.timestamp ?? Date.now(),
      })
    }
  }

  _onClose(code, reason) {
    this._isConnected = false
    this._clearHeartbeat()
    const reasonStr = reason ? reason.toString() : ''
    _log('warn', `Connection closed (code=${code}${reasonStr ? ', reason=' + reasonStr : ''})`)
    this.emit('disconnected', { code, reason: reasonStr })
    if (!this._isShuttingDown) {
      this._scheduleReconnect()
    }
  }

  _onError(err) {
    _log('error', 'WebSocket error:', err.message)
    this.emit('error', err)
    // 'close' event will follow and trigger reconnect
  }

  _scheduleReconnect() {
    if (this._isShuttingDown || this._reconnectTimer) return
    // Exponential backoff capped at RECONNECT_MAX_MS
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** this._reconnectAttempt), RECONNECT_MAX_MS)
    this._reconnectAttempt++
    this._reconnectCount++
    _log('info', `Reconnecting in ${delay}ms (attempt #${this._reconnectAttempt})…`)
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._doConnect()
    }, delay)
  }

  _subscribe(channels) {
    if (!channels.length) return
    this._send({
      method: 'public/subscribe',
      id:     this._nextId(),
      params: { channels },
    })
    _log('info', `Subscribed to ${channels.length} channels`)
  }

  _setupHeartbeat() {
    this._clearHeartbeat()
    // Ask Deribit to send heartbeat/test_request every N seconds
    this._send({
      method: 'public/set_heartbeat',
      id:     this._nextId(),
      params: { interval: HEARTBEAT_INTERVAL_S },
    })
    // Also ping the WS transport layer periodically as a safety net
    this._heartbeatTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.ping()
      }
    }, HEARTBEAT_INTERVAL_S * 1_000)
  }

  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  _clearTimers() {
    this._clearHeartbeat()
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  /**
   * Send a JSON-RPC 2.0 message to Deribit.
   * @param {object} payload  — must include `method`, `id`, `params`
   */
  _send(payload) {
    if (this._ws?.readyState !== WebSocket.OPEN) return
    const msg = JSON.stringify({ jsonrpc: '2.0', ...payload })
    this._ws.send(msg, err => {
      if (err) _log('error', 'Send error:', err.message)
    })
  }

  _nextId() {
    return this._msgId++
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

/**
 * Shared singleton — all modules in the same process share one WebSocket connection.
 * @type {DeribitWsClient}
 */
const client = new DeribitWsClient()

module.exports = client
