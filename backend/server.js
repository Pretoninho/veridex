'use strict'

const express = require('express')
const cors    = require('cors')
const path    = require('path')

const signalsRouter = require('./routes/signals')
const marketRouter  = require('./routes/market')

const app  = express()
const PORT = process.env.PORT ?? 3000

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true'

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../dist')))

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(MAINTENANCE_MODE ? 503 : 200).json({
    status:      MAINTENANCE_MODE ? 'maintenance' : 'ok',
    maintenance: MAINTENANCE_MODE,
    timestamp:   Date.now(),
  })
})

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
  app.use('/signals', signalsRouter)
  app.use('/market', marketRouter)
}

// ── SPA Fallback ──────────────────────────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  if (MAINTENANCE_MODE) {
    console.log(`Veridex signals API running on port ${PORT} [MAINTENANCE MODE]`)
  } else {
    console.log(`Veridex signals API running on port ${PORT}`)
  }
})
