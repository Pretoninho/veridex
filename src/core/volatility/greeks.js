/**
 * data_processing/volatility/greeks.js
 *
 * Calculs Black-Scholes : Greeks + pricing.
 * Source canonique — migré depuis src/utils/greeks.js et src/utils/api.js.
 */

import { getDaysUntilCorrected } from '../../data/providers/clock_sync.js'

// ── Fonctions mathématiques ───────────────────────────────────────────────────

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

function normalCdf(x) {
  const a1 = 0.319381530
  const a2 = -0.356563782
  const a3 = 1.781477937
  const a4 = -1.821255978
  const a5 = 1.330274429
  const p  = 0.2316419

  if (x < 0) return 1 - normalCdf(-x)
  const t = 1 / (1 + p * x)
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t
  return 1 - normalPdf(x) * poly
}

// ── Greeks ────────────────────────────────────────────────────────────────────

/**
 * Calcule les Greeks d'une option via Black-Scholes.
 *
 * @param {{
 *   type: 'call'|'put', S: number, K: number, T: number, sigma: number, r?: number,
 *   expiry?: number|null,    — timestamp ms (optionnel, prioritaire sur T si fourni)
 *   clockSync?: object|null  — résultat de syncServerClocks() pour corriger T
 * }}
 * @returns {{ delta, gamma, theta, vega } | null}
 */
export function calcOptionGreeks({ type, S, K, T: Tparam, sigma, r = 0, expiry = null, clockSync = null }) {
  // Si expiry fourni, recalculer T en années avec correction horloge
  const T = expiry != null
    ? getDaysUntilCorrected(expiry, clockSync) / 365
    : Tparam
  if (!Number.isFinite(S) || !Number.isFinite(K) || !Number.isFinite(T) || !Number.isFinite(sigma)) return null
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return null
  if (type !== 'call' && type !== 'put') return null

  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const nd1 = normalPdf(d1)
  const cdfD1 = normalCdf(d1)
  const cdfD2 = normalCdf(d2)

  const gamma = nd1 / (S * sigma * sqrtT)
  const vega  = (S * nd1 * sqrtT) / 100

  if (type === 'call') {
    const delta = cdfD1
    const theta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * cdfD2) / 365
    return { delta, gamma, theta, vega }
  }

  const delta = cdfD1 - 1
  const theta = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCdf(-d2)) / 365
  return { delta, gamma, theta, vega }
}

// ── Pricing ───────────────────────────────────────────────────────────────────

/**
 * Prix théorique d'une option (Black-Scholes).
 *
 * @param {'call'|'put'} type
 * @param {number} S      — spot
 * @param {number} K      — strike
 * @param {number} T      — durée en années
 * @param {number} r      — taux sans risque (0 par défaut)
 * @param {number} sigma  — volatilité implicite (ex: 0.65 pour 65%)
 * @returns {number}
 */
export function blackScholes(type, S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return 0
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  if (type === 'call') return S * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d2)
  return K * Math.exp(-r * T) * normalCdf(-d2) - S * normalCdf(-d1)
}
