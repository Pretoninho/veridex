/**
 * providers/okx.js — Provider OKX
 *
 * Couvre les options (European + American), spot, et futures.
 * OKX est le 2ème marché d'options crypto après Deribit.
 *
 * Docs API : https://www.okx.com/docs-v5/en/
 *
 * Endpoints utilisés :
 *   - /api/v5/public/opt-summary       — IV + greeks de toutes les options
 *   - /api/v5/market/open-interest      — OI par instrument
 *   - /api/v5/market/ticker             — Prix spot
 *
 * Convention de nommage OKX options : {BASE}-{QUOTE}-{YYMMDD}-{STRIKE}-{C|P}
 * Exemple : BTC-USD-251226-80000-C
 */

import {
  normalizeOKXOptions,
  normalizeOKXSpot,
  normalizeOKXOptionsOI,
  normalizeOKXFunding,
} from '../normalizers/format_data.js'
import { dataStore, CacheKey } from '../data_store/cache.js'

const BASE_URL = 'https://www.okx.com'
const DEFAULT_TIMEOUT_MS = 12_000

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiFetch(path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
    const json = await res.json()
    if (json.code !== '0') throw new Error(`OKX error ${json.code}: ${json.msg}`)
    return json.data
  } finally {
    clearTimeout(timer)
  }
}

// Underlying OKX : BTC → BTC-USD
const toUnderlying = asset => `${asset.toUpperCase()}-USDT`
const toSpotInstId = asset => `${asset.toUpperCase()}-USDT`

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Prix spot via ticker OKX (BTC-USDT).
 * @param {'BTC'|'ETH'} asset
 */
export async function getSpot(asset) {
  const instId = toSpotInstId(asset)
  const data = await apiFetch('/api/v5/market/ticker', { instId })
  const raw = Array.isArray(data) ? data[0] : data
  const normalized = normalizeOKXSpot(asset, raw)
  if (normalized) dataStore.set(CacheKey.spot('okx', asset), normalized)
  return normalized
}

/**
 * Funding rate du perpetuel USDT-margined (SWAP).
 * @param {'BTC'|'ETH'} asset
 */
export async function getFundingRate(asset) {
  const instId = `${asset.toUpperCase()}-USDT-SWAP`
  const data = await apiFetch('/api/v5/public/funding-rate', { instId })
  const raw = Array.isArray(data) ? data[0] : data
  const normalized = normalizeOKXFunding(asset, raw)
  if (normalized) dataStore.set(CacheKey.funding('okx', asset), normalized)
  return normalized
}

/**
 * Résumé de toutes les options (IV + greeks) pour un sous-jacent.
 * Endpoint : GET /api/v5/public/opt-summary?uly=BTC-USD
 *
 * Retourne mark IV (markVol), greeks (delta, gamma, vega, theta),
 * bid/ask IV, et forward price pour chaque option listée.
 *
 * @param {'BTC'|'ETH'} asset
 */
export async function getOptionsChain(asset) {
  const uly = toUnderlying(asset)
  const data = await apiFetch('/api/v5/public/opt-summary', { uly })
  const marks = Array.isArray(data) ? data : []
  const normalized = normalizeOKXOptions(asset, marks)
  if (normalized) dataStore.set(CacheKey.optionsMark('okx', asset), normalized)
  return normalized
}

/**
 * Open Interest des options OKX par instrument.
 * @param {'BTC'|'ETH'} asset
 */
export async function getOptionsOI(asset) {
  const uly = toUnderlying(asset)
  const data = await apiFetch('/api/v5/market/open-interest', {
    instType: 'OPTION',
    uly,
  })
  const oiData = Array.isArray(data) ? data : []
  const normalized = normalizeOKXOptionsOI(asset, oiData)
  if (normalized) {
    dataStore.set(CacheKey.optionsOI('okx', asset), normalized)
    dataStore.set(CacheKey.oi('okx', asset), normalized)
  }
  return normalized
}

/**
 * Snapshot OKX : spot + options chain
 * @param {'BTC'|'ETH'} asset
 */
export async function getMarketSnapshot(asset) {
  const [spot, opts] = await Promise.allSettled([
    getSpot(asset),
    getOptionsChain(asset),
  ])
  return {
    spot: spot.status === 'fulfilled' ? spot.value : null,
    options: opts.status === 'fulfilled' ? opts.value : null,
  }
}
