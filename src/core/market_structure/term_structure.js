/**
 * data_processing/market_structure/term_structure.js
 *
 * Analyse de la structure des termes (term structure) et du basis futures.
 *
 * Concepts :
 *   Basis     : écart entre prix futures et prix spot → (price - spot) / spot * 100
 *   Basis ann. : basis normalisé à 365 jours → basis / days * 365
 *   Contango  : basis annualisé > 0 (futures plus chers que spot)
 *   Backwardation : basis annualisé < 0 (futures moins chers)
 */

// ── Calculs de base ───────────────────────────────────────────────────────────

/**
 * Calcule le basis brut entre un futures et le spot.
 * @param {number} futurePrice
 * @param {number} spotPrice
 * @returns {number} en %
 */
export function calcBasis(futurePrice, spotPrice) {
  if (!spotPrice) return 0
  return (futurePrice - spotPrice) / spotPrice * 100
}

/**
 * Annualise le basis.
 * @param {number} basisPct — basis brut en %
 * @param {number} days     — jours jusqu'à l'échéance
 * @returns {number|null}   — basis annualisé en %
 */
export function annualizeBasis(basisPct, days) {
  if (!Number.isFinite(days) || days <= 0) return null
  return basisPct / days * 365
}

// ── Analyse de la term structure ──────────────────────────────────────────────

/**
 * Construit une ligne de term structure à partir d'une liste de rows futures.
 *
 * @param {Array<{ instrument, days, price, basisAnn, iv, isPerp }>} rows
 * @returns {{
 *   dated: typeof rows,
 *   avgBasisAnn: number|null,
 *   maxBasisAnn: number|null,
 *   minBasisAnn: number|null,
 *   structure: 'contango'|'backwardation'|'flat'
 * }}
 */
export function analyzeTermStructure(rows) {
  const dated = rows.filter(r => !r.isPerp && r.basisAnn != null)
  if (!dated.length) return { dated, avgBasisAnn: null, maxBasisAnn: null, minBasisAnn: null, structure: 'flat' }

  const values = dated.map(r => r.basisAnn)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const max = Math.max(...values)
  const min = Math.min(...values)

  const structure = avg > 0.5 ? 'contango' : avg < -0.5 ? 'backwardation' : 'flat'
  return { dated, avgBasisAnn: avg, maxBasisAnn: max, minBasisAnn: min, structure }
}
