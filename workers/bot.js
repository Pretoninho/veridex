// bot.js - Deribit RL Bot for Cloudflare Workers

import TelegramBot from './telegram.js'
import { evaluateDualPolicy, encodeDualState, DEFAULT_REWARD_CONFIG } from './rlDual.js'

// State persistence in KV
class RlBotState {
  constructor(kv) {
    this.kv = kv
    this.qTable = {}
    this.config = { ...DEFAULT_REWARD_CONFIG }
    this.lastAlerts = {} // track last alert per asset to avoid spam
    this.lastUpdate = 0
  }

  async loadState() {
    try {
      const stored = await this.kv.get('rl_state_v1')
      if (stored) {
        const data = JSON.parse(stored)
        this.qTable = data.qTable || {}
        this.config = { ...DEFAULT_REWARD_CONFIG, ...(data.config || {}) }
        this.lastAlerts = data.lastAlerts || {}
      }
    } catch (err) {
      console.error('Failed to load RL state:', err)
    }
  }

  async saveState() {
    try {
      const data = {
        qTable: this.qTable,
        config: this.config,
        lastAlerts: this.lastAlerts,
        timestamp: Date.now(),
      }
      await this.kv.put('rl_state_v1', JSON.stringify(data), { expirationTtl: 2592000 }) // 30 days
    } catch (err) {
      console.error('Failed to save RL state:', err)
    }
  }
}

// Minimal Deribit API client
class DeribitClient {
  constructor() {
    this.wsUrl = 'wss://www.deribit.com/ws/api/v2'
    this.ws = null
    this.subscriptions = new Set()
    this.callbacks = {}
    this.requestId = 1
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl)

        this.ws.onopen = () => {
          console.log('Deribit WebSocket connected')
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            this.handleMessage(message)
          } catch (err) {
            console.error('Failed to parse WS message:', err)
          }
        }

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err)
          reject(err)
        }

        this.ws.onclose = () => {
          console.log('Deribit WebSocket closed')
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  handleMessage(message) {
    if (message.id && this.callbacks[message.id]) {
      const cb = this.callbacks[message.id]
      delete this.callbacks[message.id]
      cb(message)
    }

    if (message.method === 'subscription') {
      const channel = message.params?.channel
      if (channel && this.callbacks[channel]) {
        this.callbacks[channel](message.params?.data)
      }
    }
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.requestId++
      const timeout = setTimeout(() => {
        delete this.callbacks[id]
        reject(new Error(`Request ${method} timeout`))
      }, 5000)

      this.callbacks[id] = (response) => {
        clearTimeout(timeout)
        if (response.error) {
          reject(new Error(response.error.message))
        } else {
          resolve(response.result)
        }
      }

      this.send({ jsonrpc: '2.0', method, params, id })
    })
  }

  subscribe(channel, callback) {
    this.callbacks[channel] = callback
    this.send({
      jsonrpc: '2.0',
      method: 'public/subscribe',
      params: { channels: [channel] },
    })
  }

  async getIndex(asset) {
    return this.request('public/get_index', { index_name: asset === 'BTC' ? 'btc_usd' : 'eth_usd' })
  }

  async getBook(instrumentName) {
    return this.request('public/get_book_summary_by_instrument', { instrument_name: instrumentName })
  }
}

// Process live data and trigger alerts
function evaluateMarketData(asset, spotPrice, options, state, botState, telegram) {
  const dca = botState.config[`dca_${asset}`] // TODO: load from storage or config
  if (!dca) return null

  const alerts = []

  for (const opt of options) {
    const ctx = {
      asset,
      strike: opt.strike || opt.instrumentPrice,
      dca,
      delta: opt.greeks?.delta || 0,
      iv: opt.impliedVolatility || 50,
      days: (opt.expiryTimestamp - Date.now()) / 86400000,
      distPct: ((opt.instrumentPrice - spotPrice) / spotPrice) * 100,
      side: opt.optionType === 'call' ? 'sell-high' : 'buy-low',
    }

    const evaluation = evaluateDualPolicy(ctx, botState.config, botState.qTable)

    // Check triggers
    shouldAlert(asset, evaluation, botState, alerts)
  }

  // Send alerts
  for (const alert of alerts) {
    try {
      telegram.sendAlert(
        alert.asset,
        alert.protocol,
        alert.confidence / 100,
        alert.metadata
      )
    } catch (err) {
      console.error('Failed to send alert:', err)
    }
  }

  return alerts
}

function shouldAlert(asset, evaluation, botState, alerts) {
  const lastAlert = botState.lastAlerts[`${asset}_${evaluation.protocol}`]
  const timeSinceLastAlert = lastAlert ? Date.now() - lastAlert : Infinity
  const minAlertInterval = 3600000 // 1 hour

  // Trigger 1: Protocol change
  if (lastAlert === undefined || evaluation.protocol !== botState.lastAlerts[`${asset}_lastProtocol`]) {
    alerts.push({
      asset,
      protocol: evaluation.protocol,
      confidence: evaluation.confidence,
      reason: 'protocol_change',
      metadata: {
        delta: evaluation.delta,
        dca: evaluation.dca,
        spot: null,
        prevProtocol: botState.lastAlerts[`${asset}_lastProtocol`],
      },
    })
    botState.lastAlerts[`${asset}_lastProtocol`] = evaluation.protocol
  }

  // Trigger 2: High confidence
  if (evaluation.confidence >= 80 && timeSinceLastAlert > minAlertInterval) {
    alerts.push({
      asset,
      protocol: evaluation.protocol,
      confidence: evaluation.confidence,
      reason: 'high_confidence',
      metadata: {
        delta: evaluation.delta,
        dca: evaluation.dca,
      },
    })
    botState.lastAlerts[`${asset}_highConf`] = Date.now()
  }

  // Trigger 3: Delta floor
  if (evaluation.deltaFloorOk === true && timeSinceLastAlert > minAlertInterval) {
    alerts.push({
      asset,
      protocol: evaluation.protocol,
      confidence: evaluation.confidence,
      reason: 'delta_floor_ok',
      metadata: {
        delta: evaluation.delta,
        target: evaluation.deltaTarget,
      },
    })
    botState.lastAlerts[`${asset}_deltaFloor`] = Date.now()
  }
}

// Main handler
export default {
  async fetch(request, env, ctx) {
    // POST trigger from GitHub Actions or scheduled
    if (request.method === 'POST') {
      const botState = new RlBotState(env.RL_STATE)
      await botState.loadState()

      const telegram = new TelegramBot(env.TELEGRAM_TOKEN, env.TELEGRAM_CHAT_ID)
      const deribit = new DeribitClient()

      try {
        await deribit.connect()

        // Fetch live data for each asset
        const assets = (env.ASSETS || 'BTC,ETH').split(',')
        for (const asset of assets) {
          try {
            const indexData = await deribit.getIndex(asset)
            const spotPrice = indexData?.index_price || 0

            // TODO: fetch options list and evaluate
            // const optionsBook = await deribit.getBook(`${asset}-...`)
            // evaluateMarketData(asset, spotPrice, optionsBook, botState, botState, telegram)
          } catch (err) {
            console.error(`Failed to fetch data for ${asset}:`, err)
          }
        }

        await botState.saveState()
        return new Response('OK', { status: 200 })
      } catch (err) {
        console.error('Bot error:', err)
        return new Response('Error: ' + err.message, { status: 500 })
      }
    }

    return new Response('Method not allowed', { status: 405 })
  },

  async scheduled(event, env, ctx) {
    // Scheduled trigger - same as fetch POST
    return this.fetch(new Request('http://localhost', { method: 'POST' }), env, ctx)
  },
}
