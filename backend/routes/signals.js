'use strict'

const express = require('express')
const router  = express.Router()

const { getUnifiedData } = require('../services/dataCore')
const { computeSignal }  = require('../services/signalEngine')
const { SmartCache }     = require('../utils/cache')

const SUPPORTED_ASSETS = ['BTC', 'ETH']

// Per-asset signal cache with hash-based change detection
const _signalCache = new SmartCache({ ttlMs: 30_000 })

/**
 * GET /signals?asset=BTC
 *
 * Returns the computed market signal for the requested asset.
 * Uses hash-based caching to avoid recomputing identical signals.
 * Defaults to BTC if no asset is specified.
 */
router.get('/', async (req, res) => {
  const asset = (req.query.asset ?? 'BTC').toUpperCase()

  if (!SUPPORTED_ASSETS.includes(asset)) {
    return res.status(400).json({
      error: `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`,
    })
  }

  try {
    const marketData = await getUnifiedData(asset)
    const signal     = computeSignal({ ...marketData, asset })

    const cacheKey = `signal:${asset}`
    const changed  = _signalCache.setIfChanged(cacheKey, signal)

    // Return the cached version (unchanged) to avoid serving duplicate recomputed signals.
    // If the TTL expired and the cache entry is gone, setIfChanged will have stored
    // the fresh value (changed = true) and we serve that directly.
    if (!changed) {
      const cached = _signalCache.get(cacheKey)
      if (cached) return res.json({ ...cached, cached: true })
    }

    res.json(signal)
  } catch (err) {
    console.error(`[signals] Error computing signal for ${asset}:`, err?.message)
    res.status(502).json({ error: 'Failed to fetch market data', detail: err?.message })
  }
})

module.exports = router
