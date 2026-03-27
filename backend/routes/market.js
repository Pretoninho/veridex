'use strict'

const express = require('express')
const router  = express.Router()

const { getMarketData } = require('../data/providers')

const SUPPORTED_ASSETS = ['BTC', 'ETH']

/**
 * GET /market?asset=BTC
 *
 * Returns raw normalized market data (spot, dvol, funding, rv, basisAvg, lsRatio, pcRatio).
 * Useful for debugging and as a foundation for custom signal computation.
 */
router.get('/', async (req, res) => {
  const asset = (req.query.asset ?? 'BTC').toUpperCase()

  if (!SUPPORTED_ASSETS.includes(asset)) {
    return res.status(400).json({
      error: `Unsupported asset "${asset}". Supported: ${SUPPORTED_ASSETS.join(', ')}`,
    })
  }

  try {
    const data = await getMarketData(asset)
    res.json({ asset, ...data, timestamp: Date.now() })
  } catch (err) {
    console.error(`[market] Error fetching market data for ${asset}:`, err)
    res.status(502).json({ error: 'Failed to fetch market data', detail: err?.message })
  }
})

module.exports = router
