'use strict'

const express = require('express')
const cors    = require('cors')

const signalsRouter = require('./routes/signals')
const marketRouter  = require('./routes/market')

const app  = express()
const PORT = process.env.PORT ?? 3000

app.use(cors())
app.use(express.json())

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.use('/signals', signalsRouter)
app.use('/market', marketRouter)

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Veridex signals API running on port ${PORT}`)
})
