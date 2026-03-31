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
 * GET /signals?asset=BTC  or  /signals?assets=BTC,ETH
 *
 * Single asset: Returns the computed market signal for the requested asset.
 * Multi asset: Returns signals for multiple assets in parallel (with caching).
 * Uses hash-based caching to avoid recomputing identical signals.
 * Defaults to BTC if no asset is specified.
 */
router.get('/', async (req, res) => {
  // Support both ?asset=BTC and ?assets=BTC,ETH
  let requestedAssets = []
  if (req.query.assets) {
    requestedAssets = req.query.assets.split(',').map(a => a.trim().toUpperCase())
  } else if (req.query.asset) {
    requestedAssets = [req.query.asset.toUpperCase()]
  } else {
    requestedAssets = ['BTC']
  }

  // Validate all requested assets
  for (const asset of requestedAssets) {
    if (!SUPPORTED_ASSETS.includes(asset)) {
      return res.status(400).json({
        error: `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`,
      })
    }
  }

  // Single asset optimization (backward compatible)
  if (requestedAssets.length === 1) {
    const asset = requestedAssets[0]

    try {
      const marketData = await getUnifiedData(asset)
      const signal     = computeSignal({ ...marketData, asset })

      // [FUTURE] Add multi_timeframe support here with separate data fetches for 4h/1h/5min
      // For now, return a placeholder structure compatible with frontend
      const multiTFPlaceholder = {
        regime_4h: { type: 'NEUTRAL', confidence: 0 },
        setup_1h: { type: 'NEUTRAL', confidence: 0 },
        entry_5min: { signal: 'WAIT', confidence: 0, action: 'WAIT' },
        alignment: { htf_mtf: false, mtf_ltf: false, all_aligned: false },
        interpretation: { action: 'WAIT', reason: 'Multi-timeframe data not yet implemented', confidence: 0 }
      }

      const cacheKey = `signal:${asset}`
      const changed  = _signalCache.setIfChanged(cacheKey, signal)

      // Return the cached version (unchanged) to avoid serving duplicate recomputed signals.
      if (!changed) {
        const cached = _signalCache.get(cacheKey)
        if (cached) return res.json({ ...cached, cached: true, multi_timeframe: multiTFPlaceholder })
      }

      res.json({ ...signal, multi_timeframe: multiTFPlaceholder })
    } catch (err) {
      console.error(`[signals] Error computing signal for ${asset}:`, err?.message)
      res.status(502).json({ error: 'Failed to fetch market data', detail: err?.message })
    }
  } else {
    // Multi-asset path: fetch signals for all assets in parallel
    try {
      const signalPromises = requestedAssets.map(async (asset) => {
        try {
          const marketData = await getUnifiedData(asset)
          const signal     = computeSignal({ ...marketData, asset })

          const multiTFPlaceholder = {
            regime_4h: { type: 'NEUTRAL', confidence: 0 },
            setup_1h: { type: 'NEUTRAL', confidence: 0 },
            entry_5min: { signal: 'WAIT', confidence: 0, action: 'WAIT' },
            alignment: { htf_mtf: false, mtf_ltf: false, all_aligned: false },
            interpretation: { action: 'WAIT', reason: 'Multi-timeframe data not yet implemented', confidence: 0 }
          }

          const cacheKey = `signal:${asset}`
          const changed  = _signalCache.setIfChanged(cacheKey, signal)

          const cached = _signalCache.get(cacheKey)
          return {
            asset,
            ...cached || signal,
            cached: !changed,
            multi_timeframe: multiTFPlaceholder
          }
        } catch (err) {
          console.error(`[signals] Error computing signal for ${asset}:`, err?.message)
          return {
            asset,
            error: 'Failed to fetch market data',
            detail: err?.message
          }
        }
      })

      const signals = await Promise.all(signalPromises)
      res.json({ signals })
    } catch (err) {
      console.error(`[signals] Error in multi-asset request:`, err?.message)
      res.status(502).json({ error: 'Failed to process multi-asset request', detail: err?.message })
    }
  }
})

module.exports = router
