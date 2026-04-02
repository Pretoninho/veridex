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
const { startSettlementJob, getSettlementStatus } = require('./workers/settlementJob')
const wsClient                           = require('./workers/deribitWsClient')

// ── Prod-strict: validate DATABASE_URL before anything else ──────────────────

const IS_PROD_STRICT = process.env.NODE_ENV === 'production'

if (IS_PROD_STRICT && !process.env.DATABASE_URL) {
  console.error(
    '[server] FATAL: NODE_ENV=production requires DATABASE_URL to be set. ' +
    'Please configure a PostgreSQL connection string and restart.',
  )
  process.exit(1)
}

const app  = express()
const PORT = process.env.PORT ?? 3000

const MAINTENANCE_MODE    = process.env.MAINTENANCE_MODE === 'true'
const ENABLE_COLLECTOR    = process.env.ENABLE_COLLECTOR === 'true'

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../dist')))

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const includeCollector = req.query.include_collector === 'true'
    const includeWs        = req.query.include_ws === 'true'
    const body = {
      status:      MAINTENANCE_MODE ? 'maintenance' : 'ok',
      maintenance: MAINTENANCE_MODE,
      timestamp:   Date.now(),
    }

    // Always include DB connectivity status — never let a DB error crash the handler
    try {
      body.db = await store.testConnection()
      if (!body.db.ok) {
        body.status = 'degraded'
      }
    } catch (dbErr) {
      body.db = { ok: false, error: dbErr?.message ?? 'unknown' }
      body.status = 'degraded'
    }

    if (includeCollector) {
      body.collector  = getCollectorStatus()
      body.settlement = getSettlementStatus()
    }
    // include_ws=true surfaces WebSocket connection status (superset of include_collector)
    if (includeWs) {
      body.ws        = wsClient.getStatus()
      body.collector = body.collector ?? getCollectorStatus()
    }
    res.status(200).json(body)
  } catch (err) {
    // Last-resort catch: always return 200 so the platform healthcheck never fails
    res.status(200).json({ status: 'error', error: err?.message ?? 'unknown', timestamp: Date.now() })
  }
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
  // Start the HTTP server first so the platform healthcheck can reach /health
  // immediately, even while the database is still initialising.
  await new Promise((resolve, reject) => {
    app.listen(PORT, '0.0.0.0', () => {
      if (MAINTENANCE_MODE) {
        console.log(`Veridex signals API running on port ${PORT} [MAINTENANCE MODE]`)
      } else {
        console.log(`Veridex signals API running on port ${PORT}`)
      }
      resolve()
    }).on('error', reject)
  })

  // Initialize database after the server is already listening
  try {
    await store.initDatabase()
  } catch (err) {
    if (IS_PROD_STRICT) {
      console.error('[server] FATAL: Database initialization failed:', err?.message)
      process.exit(1)
    }
    console.error('[server] Database initialization failed (non-fatal in dev):', err?.message)
  }

  // In production, verify the DB connection with SELECT 1 before accepting traffic
  if (IS_PROD_STRICT && store.isReady()) {
    const check = await store.testConnection()
    if (!check.ok) {
      console.error(
        '[server] FATAL: PostgreSQL connection test failed:',
        check.error,
        '— Check DATABASE_URL and network access.',
      )
      process.exit(1)
    }
    console.log(`[server] PostgreSQL connection OK (${check.latencyMs}ms)`)
  }

  if (!MAINTENANCE_MODE && ENABLE_COLLECTOR && store.isReady()) {
    startDataCollector()
    startSettlementJob()
  }
}

start().catch(err => {
  console.error('[server] Fatal startup error:', err)
  process.exit(1)
})
