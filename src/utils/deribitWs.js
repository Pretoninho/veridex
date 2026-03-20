/**
 * @deprecated Ce fichier est remplacé par src/data_core/streams/websocket.js
 * Les nouvelles pages doivent importer wsStream depuis data_core.
 * Ce fichier est conservé pour la compatibilité des pages existantes.
 */

const DERIBIT_WS_URL = 'wss://www.deribit.com/ws/api/v2'
const HEARTBEAT_INTERVAL_MS = 15000
const STALE_CONNECTION_MS = 45000
const MAX_BACKOFF_MS = 30000

class DeribitWebSocketClient {
  constructor() {
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
    this.subscriptions = new Map()
    this.statusListeners = new Set()
  }

  connect() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }
    if (this.pendingConnect) return this.pendingConnect

    this.closedByUser = false
    this.pendingConnect = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(DERIBIT_WS_URL)
      } catch (error) {
        this.pendingConnect = null
        reject(error)
        return
      }

      this.ws.onopen = () => {
        this.connected = true
        this.reconnectAttempt = 0
        this.lastMessageAt = Date.now()
        this.startHeartbeat()
        this.resubscribeAll()
        this.emitStatus('connected')
        this.pendingConnect = null
        resolve()
      }

      this.ws.onmessage = (evt) => {
        this.lastMessageAt = Date.now()
        let payload = null
        try {
          payload = JSON.parse(evt.data)
        } catch {
          return
        }
        if (payload?.method === 'subscription') {
          const channel = payload?.params?.channel
          if (!channel) return
          const listeners = this.subscriptions.get(channel)
          if (!listeners?.size) return
          listeners.forEach(listener => {
            try { listener(payload.params.data, channel) } catch (_) {}
          })
        }
      }

      this.ws.onerror = () => {
        this.emitStatus('error')
      }

      this.ws.onclose = () => {
        this.connected = false
        this.clearTimers()
        this.pendingConnect = null
        this.emitStatus(this.closedByUser ? 'stopped' : 'reconnecting')
        if (!this.closedByUser) this.scheduleReconnect()
      }
    })

    return this.pendingConnect
  }

  disconnect() {
    this.closedByUser = true
    this.clearTimers()
    this.subscriptions.clear()
    if (this.ws) {
      try { this.ws.close() } catch (_) {}
    }
    this.ws = null
    this.connected = false
    this.pendingConnect = null
    this.emitStatus('stopped')
  }

  subscribe(channels, listener) {
    const channelList = [...new Set((Array.isArray(channels) ? channels : [channels]).filter(Boolean))]
    if (!channelList.length || typeof listener !== 'function') return () => {}

    channelList.forEach(channel => {
      if (!this.subscriptions.has(channel)) this.subscriptions.set(channel, new Set())
      this.subscriptions.get(channel).add(listener)
    })

    this.connect()
      .then(() => this.send('public/subscribe', { channels: channelList }))
      .catch(() => {})

    return () => this.unsubscribe(channelList, listener)
  }

  unsubscribe(channels, listener) {
    const channelList = [...new Set((Array.isArray(channels) ? channels : [channels]).filter(Boolean))]
    const toUnsubscribe = []
    channelList.forEach(channel => {
      const listeners = this.subscriptions.get(channel)
      if (!listeners) return
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.subscriptions.delete(channel)
        toUnsubscribe.push(channel)
      }
    })

    if (toUnsubscribe.length && this.ws?.readyState === WebSocket.OPEN) {
      this.send('public/unsubscribe', { channels: toUnsubscribe })
    }
  }

  onStatus(listener) {
    if (typeof listener !== 'function') return () => {}
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  emitStatus(status) {
    this.statusListeners.forEach(listener => {
      try { listener(status) } catch (_) {}
    })
  }

  send(method, params = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const message = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    }
    this.ws.send(JSON.stringify(message))
  }

  resubscribeAll() {
    if (!this.connected) return
    const channels = [...this.subscriptions.keys()]
    if (!channels.length) return
    this.send('public/subscribe', { channels })
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.closedByUser) return
    const base = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** this.reconnectAttempt))
    const jitter = Math.floor(Math.random() * 300)
    const delay = base + jitter
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(() => {
        this.scheduleReconnect()
      })
    }, delay)
  }

  startHeartbeat() {
    this.clearTimers()
    this.heartbeatTimer = setInterval(() => {
      this.send('public/test', {})
    }, HEARTBEAT_INTERVAL_MS)

    this.watchdogTimer = setInterval(() => {
      if (!this.lastMessageAt) return
      const age = Date.now() - this.lastMessageAt
      if (age < STALE_CONNECTION_MS) return
      try { this.ws?.close() } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS)
  }

  clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeatTimer = null
    this.watchdogTimer = null
    this.reconnectTimer = null
  }
}

export const deribitWs = new DeribitWebSocketClient()

export function createBatchProcessor(onFlush, intervalMs = 150) {
  let queue = []
  let flushTimer = null

  const flush = () => {
    if (!queue.length) return
    const batch = queue
    queue = []
    flushTimer = null
    onFlush(batch)
  }

  const push = (item) => {
    queue.push(item)
    if (flushTimer) return
    flushTimer = setTimeout(flush, intervalMs)
  }

  const dispose = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    queue = []
  }

  return { push, flush, dispose }
}