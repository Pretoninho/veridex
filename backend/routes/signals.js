'use strict'

const express = require('express')
const router  = express.Router()

const { getUnifiedData, getUnifiedDataMultiTimeframe } = require('../services/dataCore')
const { computeSignal }  = require('../services/signalEngine')
const { computeMultiTimeframeRules } = require('../services/multiTimeframeRules')
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

      const multiTFData = await getUnifiedDataMultiTimeframe(asset)
      const multiTFRules = computeMultiTimeframeRules(multiTFData)

      const cacheKey = `signal:${asset}`
      const changed  = _signalCache.setIfChanged(cacheKey, signal)

      // Return the cached version (unchanged) to avoid serving duplicate recomputed signals.
      if (!changed) {
        const cached = _signalCache.get(cacheKey)
        if (cached) {
          return res.json({
            ...cached,
            cached: true,
            multi_timeframe: {
              ...multiTFData,
              ...multiTFRules,
            },
          })
        }
      }

      res.json({
        ...signal,
        multi_timeframe: {
          ...multiTFData,
          ...multiTFRules,
        },
      })
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

          const multiTFData = await getUnifiedDataMultiTimeframe(asset)
          const multiTFRules = computeMultiTimeframeRules(multiTFData)

          const cacheKey = `signal:${asset}`
          const changed  = _signalCache.setIfChanged(cacheKey, signal)

          const cached = _signalCache.get(cacheKey)
          return {
            asset,
            ...cached || signal,
            cached: !changed,
            multi_timeframe: {
              ...multiTFData,
              ...multiTFRules,
            },
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
