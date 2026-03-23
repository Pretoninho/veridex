/**
 * data_processing/market_structure/term_structure.js
 *
 * Analyse de la structure des termes (term structure) et du basis futures.
 * Extrait de TermPage.jsx.
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

/**
 * Calcule le taux DI simplifié (sans Black-Scholes) à partir de l'IV ATM.
 * @param {number|null} iv    — IV ATM en %
 * @param {number|null} days  — durée en jours
 * @returns {number|null}     — APY en %
 */
export function calcDIRateSimple(iv, days) {
  if (!iv || !days) return null
  const T = days / 365
  return (iv / 100 * Math.sqrt(T) * 0.4 * 100) * (365 / days)
}

// ── Analyse de la term structure ──────────────────────────────────────────────

/**
 * Construit une ligne de term structure à partir d'une liste de rows futures.
 *
 * @param {Array<{ instrument, days, price, basisAnn, iv, diRate, isPerp }>} rows
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

// ── Signal DI basé sur la term structure ──────────────────────────────────────

/**
 * Génère un signal DI en croisant la structure des termes et le funding rate.
 *
 * @param {{ avgBasisAnn: number, structure: string }} termAnalysis
 * @param {number} fundingAnn — funding rate annualisé en %
 * @returns {{ signal: string, color: string, reason: string, strength: 'strong'|'moderate'|'neutral' }}
 */
export function calcTermStructureSignal(termAnalysis, fundingAnn = 0) {
  const { avgBasisAnn, structure } = termAnalysis
  if (avgBasisAnn == null) {
    return { signal: '— Données insuffisantes', color: 'var(--text-muted)', reason: 'Pas de futures datés', strength: 'neutral' }
  }

  const isContango      = structure === 'contango'
  const isBackwardation = structure === 'backwardation'
  const avg = avgBasisAnn

  if (isContango && fundingAnn > 10) {
    return {
      signal: '🔥 Sell High + Short Perp',
      color: 'var(--call)',
      reason: `Contango ${avg.toFixed(1)}% ann. + Funding +${fundingAnn.toFixed(1)}% ann. → Tu reçois prime DI + funding`,
      strength: 'strong',
    }
  }
  if (isContango && fundingAnn > 0) {
    return {
      signal: '✓ Sell High favorable',
      color: 'var(--atm)',
      reason: `Contango ${avg.toFixed(1)}% ann. — hedge perp optionnel`,
      strength: 'moderate',
    }
  }
  if (isBackwardation && fundingAnn < 0) {
    return {
      signal: '🔥 Buy Low + Long Perp',
      color: 'var(--call)',
      reason: `Backwardation ${avg.toFixed(1)}% ann. + Funding ${fundingAnn.toFixed(1)}% ann. → Tu reçois prime DI + funding`,
      strength: 'strong',
    }
  }
  if (isBackwardation) {
    return {
      signal: '✓ Buy Low favorable',
      color: 'var(--atm)',
      reason: `Backwardation ${avg.toFixed(1)}% ann. — contexte favorable accumulation`,
      strength: 'moderate',
    }
  }
  return {
    signal: '~ Marché neutre',
    color: 'var(--accent2)',
    reason: 'Basis plat — pas de signal directionnel fort',
    strength: 'neutral',
  }
}

/**
 * Identifie la meilleure échéance pour un DI en combinant taux DI et basis absolu.
 *
 * @param {Array<{ instrument, days, diRate, basisAnn, iv }>} rows
 * @returns {typeof rows[0] | null}
 */
export function findBestDIExpiry(rows) {
  const dated = rows.filter(r => !r.isPerp && r.diRate != null && r.basisAnn != null)
  if (!dated.length) return null
  return dated.reduce((best, r) => {
    const score = (r.diRate ?? 0) + Math.abs(r.basisAnn ?? 0)
    const bestScore = (best.diRate ?? 0) + Math.abs(best.basisAnn ?? 0)
    return score > bestScore ? r : best
  })
}
