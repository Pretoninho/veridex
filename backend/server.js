'use strict'

// Load environment variables from .env file if present
try { require('dotenv').config() } catch (_) { /* dotenv is optional */ }

const express = require('express')
const cors    = require('cors')
const path    = require('path')

const signalsRouter   = require('./routes/signals')
const marketRouter    = require('./routes/market')
const analyticsRouter = require('./routes/analytics')

const store                              = require('./workers/dataStore')
const { startDataCollector, getCollectorStatus } = require('./workers/dataCollector')
const wsClient                           = require('./workers/deribitWsClient')

const app  = express()
const PORT = process.env.PORT ?? 3000

const MAINTENANCE_MODE    = process.env.MAINTENANCE_MODE === 'true'
const ENABLE_COLLECTOR    = process.env.ENABLE_COLLECTOR === 'true'

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../dist')))

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  const includeCollector = req.query.include_collector === 'true'
  const includeWs        = req.query.include_ws === 'true'
  const body = {
    status:      MAINTENANCE_MODE ? 'maintenance' : 'ok',
    maintenance: MAINTENANCE_MODE,
    timestamp:   Date.now(),
  }
  if (includeCollector) {
    body.collector = getCollectorStatus()
  }
  // include_ws=true surfaces WebSocket connection status (superset of include_collector)
  if (includeWs) {
    body.ws        = wsClient.getStatus()
    body.collector = body.collector ?? getCollectorStatus()
  }
  res.status(MAINTENANCE_MODE ? 503 : 200).json(body)
})

// ── Debug routes (development only) ─────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.get('/debug/ws/subscriptions', (_req, res) => {
    res.json(wsClient.getStatus())
  })
}

// Bloc toutes les routes API pendant la maintenance
if (MAINTENANCE_MODE) {
  app.use((_req, res) => {
    res.status(503).json({
      error:       'Service temporarily unavailable',
      maintenance: true,
      timestamp:   Date.now(),
    })
  })
} else {
  app.use('/signals',   signalsRouter)
  app.use('/market',    marketRouter)
  app.use('/analytics', analyticsRouter)
}

// ── SPA Fallback ──────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  // Initialize database first, then start the server
  try {
    await store.initDatabase()
  } catch (err) {
    console.error('[server] Database initialization failed:', err?.message)
    // Non-fatal — server still starts without persistence
  }

  app.listen(PORT, '0.0.0.0', () => {
    if (MAINTENANCE_MODE) {
      console.log(`Veridex signals API running on port ${PORT} [MAINTENANCE MODE]`)
    } else {
      console.log(`Veridex signals API running on port ${PORT}`)
    }

    if (!MAINTENANCE_MODE && ENABLE_COLLECTOR && store.isReady()) {
      startDataCollector()
    }
  })
}

start().catch(err => {
  console.error('[server] Fatal startup error:', err)
  process.exit(1)
})
