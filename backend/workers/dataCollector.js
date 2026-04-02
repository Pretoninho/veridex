/**
 * backend/workers/dataCollector.js
 *
 * Continuous data collection worker.
 *
 * Strategy:
 *   1. Opens a persistent Deribit WebSocket connection (via deribitWsClient).
 *   2. Listens to real-time market events (index prices, DVOL, perpetual tickers).
 *   3. Maintains an in-memory state per asset, updated on every incoming message.
 *   4. Every TICK_INTERVAL_MS (default 60 s), builds a data snapshot, feeds it
 *      to the signal engine, and persists the ticker + signal to the database.
 *   5. Falls back to REST polling if the WebSocket has not delivered data for an
 *      asset within the last FALLBACK_STALE_MS (default 90 s).
 *
 * Exports: startDataCollector, stopDataCollector, getCollectorStatus
 */

'use strict'

const { fetchAllData }  = require('../data_core/index')
const { computeSignal } = require('../services/signalEngine')
const store             = require('./dataStore')
const wsClient          = require('./deribitWsClient')
const { extractDirection, selectVolSource, DEFAULT_K } = require('../utils/volThreshold')

const ASSETS              = ['BTC', 'ETH']
const TICK_INTERVAL_MS    = 60_000  // emit aggregated tick every 60 s
const FALLBACK_STALE_MS   = 90_000  // fall back to REST if WS data is >90 s old
// Refresh 30-day DVOL history from REST every 12 hours (needed for IV rank)
const DVOL_REFRESH_MS     = 12 * 60 * 60_000

// ── Per-asset real-time state ─────────────────────────────────────────────────

/**
 * @typedef {Object} AssetState
 * @property {number|null}  spot               Index spot price
 * @property {number|null}  dvol_current       Current DVOL value
 * @property {number|null}  dvol_month_min     30-day min DVOL (from REST)
 * @property {number|null}  dvol_month_max     30-day max DVOL (from REST)
 * @property {number|null}  funding_8h         8h funding rate (decimal, e.g. 0.0001)
 * @property {number|null}  oi                 Open interest (USD notional)
 * @property {number|null}  perp_mark          BTC/ETH-PERPETUAL mark price
 * @property {number|null}  usdc_mark          BTC/ETH_USDC-PERPETUAL mark price
 * @property {number|null}  updatedAt          Last WS update (ms epoch)
 * @property {number|null}  dvolRefreshedAt    Last REST DVOL refresh (ms epoch)
 */

/** @type {Record<string, AssetState>} */
const _state = {}
for (const asset of ASSETS) {
  _state[asset] = {
    spot:            null,
    dvol_current:    null,
    dvol_month_min:  null,
    dvol_month_max:  null,
    funding_8h:      null,
    oi:              null,
    perp_mark:       null,
    usdc_mark:       null,
    updatedAt:       null,
    dvolRefreshedAt: null,
  }
}

// ── Collector state ───────────────────────────────────────────────────────────

let _intervalId  = null
let _isRunning   = false
let _lastTickAt  = null
let _errorCount  = 0
let _tickCount   = 0

// ── Logging ───────────────────────────────────────────────────────────────────

function _ts() { return new Date().toISOString() }

// ── WebSocket event handlers ──────────────────────────────────────────────────

/** Update spot price from `deribit_index` events. */
function _onIndex({ asset, price }) {
  if (!_state[asset]) return
  _state[asset].spot      = price
  _state[asset].updatedAt = Date.now()
}

/** Update current DVOL from `deribit_volatility_index` events. */
function _onVolatilityIndex({ asset, volatility }) {
  if (!_state[asset]) return
  _state[asset].dvol_current = volatility
  _state[asset].updatedAt    = Date.now()
}

/**
 * Update funding rate, OI, and mark prices from perpetual `ticker` events.
 * Deribit `funding_8h` and `current_funding` are in decimal form (e.g. 0.0001).
 */
function _onTicker({ asset, isUsdc, data }) {
  if (!_state[asset]) return
  if (isUsdc) {
    _state[asset].usdc_mark  = data.mark_price ?? data.last_price ?? null
  } else {
    const rate8h = data.funding_8h ?? data.current_funding ?? null
    if (rate8h != null)             _state[asset].funding_8h = rate8h
    if (data.open_interest != null) _state[asset].oi         = data.open_interest
    if (data.mark_price    != null) _state[asset].perp_mark  = data.mark_price
  }
  _state[asset].updatedAt = Date.now()
}

// ── REST fallback & DVOL history refresh ─────────────────────────────────────

/**
 * Refresh 30-day DVOL range from REST API for an asset.
 * Called periodically so IV rank stays accurate even when WS only gives current DVOL.
 */
async function _refreshDvolHistory(asset) {
  try {
    const { deribit } = require('../data_core/index')
    const dvol = await deribit.getDVOL(asset)
    if (dvol) {
      _state[asset].dvol_month_min  = dvol.monthMin ?? null
      _state[asset].dvol_month_max  = dvol.monthMax ?? null
      _state[asset].dvolRefreshedAt = Date.now()
    }
  } catch (err) {
    console.error(`[dataCollector] ${_ts()} — DVOL history refresh failed for ${asset}:`, err?.message)
  }
}

/**
 * Collect data for an asset using REST API (fallback when WS state is stale).
 */
async function _collectAssetRest(asset) {
  const data = await fetchAllData(asset)
  // Merge REST result into live state so the tick processor can use it
  if (data.spot != null)  _state[asset].spot = data.spot
  if (data.dvol) {
    _state[asset].dvol_current   = data.dvol.current   ?? _state[asset].dvol_current
    _state[asset].dvol_month_min = data.dvol.monthMin  ?? _state[asset].dvol_month_min
    _state[asset].dvol_month_max = data.dvol.monthMax  ?? _state[asset].dvol_month_max
    _state[asset].dvolRefreshedAt = Date.now()
  }
  if (data.funding) {
    // data.funding.rate8h is in percentage (e.g. 0.01 for 0.01%) from the REST normalizer.
    // _state.funding_8h stores the raw decimal form (e.g. 0.0001) to match WS values.
    const rate8hDecimal = data.funding.rate8h != null
      ? data.funding.rate8h / 100
      : null
    if (rate8hDecimal != null) _state[asset].funding_8h = rate8hDecimal
  }
  _state[asset].updatedAt = Date.now()
  return data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map signal global score to a label bucket.
 * @param {number|null} score
 * @returns {string}
 */
function _signalType(score) {
  if (score == null) return 'NEUTRAL'
  if (score >= 80)   return 'HIGH'
  if (score >= 60)   return 'MEDIUM'
  if (score >= 40)   return 'LOW'
  return 'NEUTRAL'
}

/**
 * Build a normalized data object from the current asset state.
 * Shape is compatible with signalEngine.computeSignal().
 */
function _buildDataFromState(asset) {
  const s = _state[asset]

  // Convert 8h funding rate (decimal) to normalized object expected by signal engine
  const funding = s.funding_8h != null
    ? {
        rate8h:  s.funding_8h * 100,         // convert decimal → percent
        rateAnn: s.funding_8h * 100 * 3 * 365,
      }
    : null

  // Reconstruct dvol object if we have at least a current value
  const dvol = s.dvol_current != null
    ? {
        current:  s.dvol_current,
        monthMin: s.dvol_month_min ?? s.dvol_current * 0.7,  // rough estimate if no history yet
        monthMax: s.dvol_month_max ?? s.dvol_current * 1.3,
      }
    : null

  // Basis: percentage difference between perp mark price and spot
  const basisAvg = (s.perp_mark != null && s.spot != null && s.spot > 0)
    ? ((s.perp_mark - s.spot) / s.spot) * 100
    : null

  return { asset, spot: s.spot, dvol, funding, rv: null, basisAvg }
}

// ── Tick processor ────────────────────────────────────────────────────────────

/**
 * Process one 60-second tick for a single asset.
 * Uses WS state if fresh enough, otherwise falls back to REST API.
 */
async function _processTick(asset) {
  const s   = _state[asset]
  const now = Date.now()

  // Periodically refresh 30-day DVOL history from REST
  if (!s.dvolRefreshedAt || (now - s.dvolRefreshedAt) > DVOL_REFRESH_MS) {
    await _refreshDvolHistory(asset)
  }

  // Decide whether WS state is fresh enough
  const wsStale = !s.updatedAt || (now - s.updatedAt) > FALLBACK_STALE_MS

  let data
  if (wsStale || s.spot == null) {
    // Fall back to REST for this tick
    console.log(`[dataCollector] ${_ts()} — ${asset}: WS data stale, using REST fallback`)
    data = await _collectAssetRest(asset)
  } else {
    data = _buildDataFromState(asset)
  }

  if (data.spot == null) {
    console.warn(`[dataCollector] ${_ts()} — ${asset}: no spot price available, skipping tick`)
    return
  }

  const signal = computeSignal({ ...data, asset })

  // ── Compute IV rank from DVOL state ──────────────────────────────────────

  const dvol   = data.dvol
  const ivRank = (() => {
    if (!dvol) return null
    const { current, monthMin, monthMax } = dvol
    if (monthMax <= monthMin) return null
    return Math.round(((current - monthMin) / (monthMax - monthMin)) * 10000) / 100
  })()

  // ── Compute basis for storage ─────────────────────────────────────────────

  const basis = (s.perp_mark != null && s.spot != null && s.spot > 0)
    ? Math.round(((s.perp_mark - s.spot) / s.spot) * 1_000_000) / 10_000  // bps → %
    : null

  // ── Persist ticker ────────────────────────────────────────────────────────

  await store.insert('tickers', {
    asset,
    timestamp: now,
    spot:      data.spot,
    iv_rank:   ivRank,
    funding:   data.funding?.rateAnn ?? null,
    oi:        s.oi ?? null,
    skew:      null,
    basis,
  })

  // ── Persist signal ────────────────────────────────────────────────────────

  const direction = extractDirection(signal.positioning)
  const { volAnn, source: volSource } = selectVolSource(data.dvol, data.rv)

  await store.insert('signals', {
    asset,
    timestamp:     now,
    signal_type:   _signalType(signal.global),
    trigger_price: data.spot,
    signal_score:  signal.global,
    components:    JSON.stringify({
      s1: signal.scores?.s1,
      s2: signal.scores?.s2,
      s3: signal.scores?.s3,
      s4: signal.scores?.s4,
      s5: signal.scores?.s5,
      s6: signal.scores?.s6,
    }),
    direction:  direction,
    vol_source: volSource,
    vol_ann:    volAnn,
    k:          DEFAULT_K,
  })
}

/**
 * Run one 60-second tick cycle for all assets.
 */
async function _tick() {
  const start = Date.now()
  const wsConnected = wsClient.getStatus().connected
  console.log(
    `[dataCollector] ${_ts()} — Tick #${_tickCount + 1} ` +
    `(WS: ${wsConnected ? 'connected' : 'disconnected'})`,
  )

  const results = await Promise.allSettled(ASSETS.map(_processTick))

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      _errorCount++
      console.error(
        `[dataCollector] ${_ts()} — Error processing tick for ${ASSETS[i]}:`,
        r.reason?.message,
      )
    }
  })

  _lastTickAt = Date.now()
  _tickCount++
  console.log(`[dataCollector] ${_ts()} — Tick done in ${Date.now() - start}ms`)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the data collector.
 * Opens the Deribit WebSocket connection and starts the 60-second tick timer.
 */
function startDataCollector() {
  if (_isRunning) {
    console.warn('[dataCollector] Already running — ignoring duplicate start')
    return
  }

  if (!store.isReady()) {
    console.error('[dataCollector] Database not initialized — call initDatabase() first')
    return
  }

  _isRunning = true
  console.log(`[dataCollector] Starting — tick every ${TICK_INTERVAL_MS / 1_000}s`)

  // ── Attach WebSocket event listeners ─────────────────────────────────────
  wsClient.on('index',            _onIndex)
  wsClient.on('volatility_index', _onVolatilityIndex)
  wsClient.on('ticker',           _onTicker)

  wsClient.on('connected', () => {
    console.log('[dataCollector] WebSocket connected — real-time data active')
  })
  wsClient.on('disconnected', ({ code, reason }) => {
    console.warn(`[dataCollector] WebSocket disconnected (code=${code}${reason ? ', ' + reason : ''}) — will use REST fallback`)
  })
  wsClient.on('error', (err) => {
    console.error('[dataCollector] WebSocket error:', err?.message)
  })

  // Open WebSocket connection
  wsClient.connect()

  // Run first tick immediately (REST data available even before WS connects)
  _tick().catch(err => console.error('[dataCollector] Initial tick error:', err?.message))

  // Schedule recurring ticks
  _intervalId = setInterval(() => {
    _tick().catch(err => console.error('[dataCollector] Tick error:', err?.message))
  }, TICK_INTERVAL_MS)
}

/**
 * Stop the data collector and disconnect WebSocket gracefully.
 */
function stopDataCollector() {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
  }

  // Remove listeners before disconnecting to avoid spurious events
  wsClient.off('index',            _onIndex)
  wsClient.off('volatility_index', _onVolatilityIndex)
  wsClient.off('ticker',           _onTicker)

  wsClient.disconnect()

  _isRunning = false
  console.log('[dataCollector] Stopped')
}

/**
 * Return current collector status (for health and debug endpoints).
 */
function getCollectorStatus() {
  return {
    running:    _isRunning,
    lastTickAt: _lastTickAt,
    tickCount:  _tickCount,
    errorCount: _errorCount,
    intervalMs: TICK_INTERVAL_MS,
    ws:         wsClient.getStatus(),
  }
}

module.exports = { startDataCollector, stopDataCollector, getCollectorStatus }
