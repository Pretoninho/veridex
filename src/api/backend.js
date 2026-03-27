/**
 * src/api/backend.js
 *
 * Thin client for the Veridex backend API (backend/server.js).
 *
 * Base URL defaults to http://localhost:3000 and can be overridden via the
 * VITE_API_URL environment variable.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

/**
 * Fetch the computed market signal for the given asset from the backend.
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   scores: { s1, s2, s3, s4, s5, s6 },
 *   global: number|null,
 *   signal: { label: string, action: string }|null,
 *   positioning: object|null,
 *   timestamp: number,
 * }>}
 */
export async function fetchSignals(asset) {
  const res = await fetch(`${BASE_URL}/signals?asset=${encodeURIComponent(asset)}`)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail?.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch raw normalized market data for the given asset from the backend.
 *
 * @param {string} asset  e.g. 'BTC' or 'ETH'
 * @returns {Promise<{
 *   asset: string,
 *   spot: number|null,
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   lsRatio: number|null,
 *   pcRatio: number|null,
 *   timestamp: number,
 * }>}
 */
export async function fetchMarket(asset) {
  const res = await fetch(`${BASE_URL}/market?asset=${encodeURIComponent(asset)}`)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail?.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}
