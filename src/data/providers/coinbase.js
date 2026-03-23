/**
 * providers/coinbase.js — Provider Coinbase Advanced Trade
 *
 * Focus : flux fiat (BTC-USD, ETH-USD) — indicateur de sentiment retail.
 * Utile pour comparer les prix Coinbase vs Deribit/Binance (basis/premium).
 *
 * API publique, pas d'authentification nécessaire pour les prix.
 * Docs : https://docs.cdp.coinbase.com/advanced-trade/reference/
 */

import { normalizeCoinbaseTicker } from '../normalizers/format_data.js'
import { dataStore, CacheKey } from '../data_store/cache.js'

const BASE_URL = 'https://api.exchange.coinbase.com'
const DEFAULT_TIMEOUT_MS = 10_000

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function apiFetch(path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(`${BASE_URL}${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Produits Coinbase : BTC → BTC-USD
const toProductId = asset => `${asset.toUpperCase()}-USD`

// ── Endpoints ─────────────────────────────────────────────────────────────────

/**
 * Ticker (best bid/ask + prix + volume) d'un produit.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getSpot(asset) {
  const productId = toProductId(asset)
  // api.exchange.coinbase.com (public, no auth) : { price, bid, ask, volume, time, ... }
  const raw = await apiFetch(`/products/${productId}/ticker`)
  const ticker = {
    product_id: productId,
    price:       raw.price     ?? null,
    best_bid:    raw.bid       ?? null,
    best_ask:    raw.ask       ?? null,
    volume_24_h: raw.volume    ?? null,
    time:        raw.time      ?? null,
  }

  const normalized = normalizeCoinbaseTicker(ticker)
  if (normalized) dataStore.set(CacheKey.spot('coinbase', asset), normalized)
  return normalized
}

/**
 * Candles OHLCV (données historiques).
 * @param {'BTC'|'ETH'} asset
 * @param {'ONE_MINUTE'|'FIVE_MINUTE'|'FIFTEEN_MINUTE'|'ONE_HOUR'|'ONE_DAY'} granularity
 * @param {number} limit — nombre de bougies (max 350)
 */
export async function getCandles(asset, granularity = 'ONE_DAY', limit = 30) {
  const productId = toProductId(asset)
  const end = Math.floor(Date.now() / 1000)
  const granularitySeconds = {
    ONE_MINUTE: 60,
    FIVE_MINUTE: 300,
    FIFTEEN_MINUTE: 900,
    ONE_HOUR: 3600,
    ONE_DAY: 86400,
  }[granularity] ?? 86400
  const start = end - limit * granularitySeconds

  const raw = await apiFetch(`/products/${productId}/candles`, {
    start,
    end,
    granularity,
  })

  return (raw.candles ?? []).map(c => ({
    time:   Number(c.start) * 1000,
    open:   Number(c.open),
    high:   Number(c.high),
    low:    Number(c.low),
    close:  Number(c.close),
    volume: Number(c.volume),
  })).reverse() // Coinbase retourne en ordre décroissant
}

/**
 * Snapshot Coinbase : spot BTC + ETH
 * Utile pour détecter les primes/décotes fiat vs crypto-native.
 * @param {'BTC'|'ETH'|'SOL'} asset
 */
export async function getMarketSnapshot(asset) {
  const spot = await getSpot(asset).catch(() => null)
  return { spot }
}

/**
 * Heure serveur Coinbase — synchronisation horloge cross-exchange.
 *
 * ATTENTION : Coinbase retourne des secondes (epoch), pas des ms.
 * epoch × 1000 obligatoire pour comparer avec Deribit et Binance.
 *
 * Timeout réduit à 3s pour ne pas bloquer la sync.
 * @returns {Promise<{ timestamp: number, source: 'coinbase' } | null>}
 */
export async function getCoinbaseTime() {
  try {
    const raw = await apiFetch('/time', {}, 3_000)
    // ATTENTION : Coinbase retourne des secondes, pas des ms
    // epoch × 1000 obligatoire pour comparer avec Deribit et Binance
    const timestampMs = Number(raw.epoch) * 1000
    if (Math.abs(timestampMs - Date.now()) > 5_000_000) {
      console.error('[clock_sync] Probable unit error: Coinbase epoch not converted to ms')
    }
    return { timestamp: timestampMs, source: 'coinbase' }
  } catch {
    return null
  }
}
