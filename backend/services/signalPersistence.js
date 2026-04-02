/**
 * backend/services/signalPersistence.js
 *
 * Signal capture service.
 *
 * Persists directional (LONG / SHORT) signals to the `signals` table.
 * Neutral signals are silently skipped (returns null).
 *
 * Vol-source priority:
 *   DVOL (dvol.current) → RV (rv.current or rv.avg30)
 *
 * Uses the shared extractDirection / selectVolSource helpers from volThreshold
 * so that persistence logic stays in sync with the settlement job.
 */

'use strict'

const store = require('../workers/dataStore')
const { extractDirection, selectVolSource, DEFAULT_K } = require('../utils/volThreshold')

/**
 * Persist a directional signal to the database.
 *
 * Only signals where the positioning maps to LONG or SHORT are written;
 * neutral / unknown positioning is silently ignored and null is returned.
 *
 * @param {string}  asset        - e.g. 'BTC' or 'ETH'
 * @param {{ signal: string }|null} positioning - output of computeSignal().positioning
 * @param {{ current?: number }|null}             dvol         - DVOL data object
 * @param {{ current?: number, avg30?: number }|null} rv       - RV data object
 * @param {number}  [k]          - vol threshold multiplier (default DEFAULT_K)
 * @param {number}  triggerPrice - entry price (spot at signal time)
 * @param {number}  spot         - current spot price (same as triggerPrice when called inline)
 * @param {number}  [timestamp]  - epoch ms (defaults to Date.now())
 * @returns {Promise<number|null>} inserted signal id, or null if skipped
 */
async function persistSignal(asset, positioning, dvol, rv, k, triggerPrice, spot, timestamp) {
  // ── Direction check ───────────────────────────────────────────────────────
  const direction = extractDirection(positioning)
  if (!direction) return null   // Only persist LONG / SHORT

  // ── Volatility source + annualised vol ────────────────────────────────────
  const { volAnn, source: volSource } = selectVolSource(dvol, rv)

  // ── Insert ────────────────────────────────────────────────────────────────
  const ts = timestamp ?? Date.now()
  const kValue = (k != null && Number.isFinite(Number(k))) ? Number(k) : DEFAULT_K

  try {
    const id = await store.insert('signals', {
      asset,
      timestamp:     ts,
      trigger_price: triggerPrice ?? spot,
      direction,
      vol_source:    volSource,
      vol_ann:       volAnn,
      k:             kValue,
    })
    return id
  } catch (err) {
    console.error(`[signalPersistence] Failed to persist signal for ${asset} (direction=${direction}, ts=${ts}):`, err?.message)
    return null
  }
}

module.exports = { persistSignal }
