/**
 * data_processing/signals/signal_engine.js
 *
 * Moteur de score composite pour le signal DI.
 * Extrait de SignalPage.jsx — logique pure, sans React.
 *
 * Score global (0 à 100) pondéré sur 4 composantes :
 *   - Volatilité DVOL  : 35%
 *   - Funding Rate     : 25%
 *   - Basis Futures    : 25%
 *   - IV vs RV         : 15%
 *
 * Plus le score est élevé, meilleur est le contexte pour vendre de la vol (Sell High).
 */

// ── Fonctions de score par composante ────────────────────────────────────────

/**
 * Score IV basé sur le ratio DVOL current / moyenne 30j.
 * @param {{ current: number, monthMin: number, monthMax: number }} dvol
 * @returns {number|null} 0 à 100
 */
export function scoreIV(dvol) {
  if (!dvol) return null
  const avg30 = (dvol.monthMin + dvol.monthMax) / 2
  const ratio = dvol.current / avg30
  if (ratio >= 1.20) return 100
  if (ratio >= 1.10) return 75
  if (ratio >= 0.95) return 50
  if (ratio >= 0.85) return 25
  return 0
}

/**
 * Score funding rate annualisé.
 * @param {{ rateAnn?: number, avgAnn7d?: number }} funding
 * @returns {number|null} 0 à 100
 */
export function scoreFunding(funding) {
  if (!funding) return null
  const r = funding.rateAnn ?? funding.avgAnn7d
  if (r == null) return null
  if (r >= 30) return 100
  if (r >= 15) return 75
  if (r >= 5)  return 50
  if (r >= 0)  return 25
  return 0
}

/**
 * Score basis futures annualisé moyen.
 * @param {number|null} basisAvg — basis annualisé moyen en %
 * @returns {number|null} 0 à 100
 */
export function scoreBasis(basisAvg) {
  if (basisAvg == null) return null
  if (basisAvg >= 15) return 100
  if (basisAvg >= 8)  return 75
  if (basisAvg >= 3)  return 50
  if (basisAvg >= 0)  return 25
  return 0
}

/**
 * Score premium IV vs RV (volatilité implicite vs réalisée).
 * @param {{ current: number }} dvol
 * @param {{ current: number }} rv
 * @returns {number|null} 0 à 100
 */
export function scoreIVvsRV(dvol, rv) {
  if (!dvol || !rv) return null
  const premium = dvol.current - rv.current
  if (premium >= 20) return 100
  if (premium >= 10) return 75
  if (premium >= 0)  return 50
  return 0
}

// ── Score global ──────────────────────────────────────────────────────────────

/**
 * Calcule le score composite pondéré.
 * Les composantes null sont exclues et les poids redistribués.
 *
 * @param {number|null} s1 — score IV (poids 35)
 * @param {number|null} s2 — score funding (poids 25)
 * @param {number|null} s3 — score basis (poids 25)
 * @param {number|null} s4 — score IV/RV (poids 15)
 * @returns {number|null}  — 0 à 100
 */
export function calcGlobalScore(s1, s2, s3, s4) {
  let total = 0, weights = 0
  if (s1 != null) { total += s1 * 35; weights += 35 }
  if (s2 != null) { total += s2 * 25; weights += 25 }
  if (s3 != null) { total += s3 * 25; weights += 25 }
  if (s4 != null) { total += s4 * 15; weights += 15 }
  return weights > 0 ? Math.round(total / weights) : null
}

// ── Interprétation ────────────────────────────────────────────────────────────

/**
 * Interprétation textuelle et visuelle du score global.
 * @param {number|null} score
 * @returns {{ label: string, color: string, bg: string, border: string, action: string } | null}
 */
export function getSignal(score) {
  if (score == null) return null
  if (score >= 80) return {
    label:  '🔥 Exceptionnel',
    color:  'var(--call)',
    bg:     'rgba(0,229,160,.08)',
    border: 'rgba(0,229,160,.3)',
    action: 'Sell High + Short Perp — conditions idéales',
  }
  if (score >= 60) return {
    label:  '✓ Favorable',
    color:  'var(--atm)',
    bg:     'rgba(255,215,0,.06)',
    border: 'rgba(255,215,0,.3)',
    action: 'DI recommandé — bon moment pour placer',
  }
  if (score >= 40) return {
    label:  '~ Neutre',
    color:  'var(--accent2)',
    bg:     'rgba(255,107,53,.06)',
    border: 'rgba(255,107,53,.3)',
    action: 'DI possible mais pas optimal',
  }
  return {
    label:  '↓ Défavorable',
    color:  'var(--put)',
    bg:     'rgba(255,77,109,.06)',
    border: 'rgba(255,77,109,.3)',
    action: 'Attendre un meilleur contexte',
  }
}

// ── Calcul complet ────────────────────────────────────────────────────────────

/**
 * Calcule le signal complet à partir des données normalisées.
 *
 * @param {{
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null
 * }} inputs
 * @returns {{
 *   scores: { s1, s2, s3, s4 },
 *   global: number|null,
 *   signal: ReturnType<typeof getSignal>
 * }}
 */
export function computeSignal({ dvol, funding, rv, basisAvg }) {
  const s1 = scoreIV(dvol)
  const s2 = scoreFunding(funding)
  const s3 = scoreBasis(basisAvg)
  const s4 = scoreIVvsRV(dvol, rv)
  const global = calcGlobalScore(s1, s2, s3, s4)
  return { scores: { s1, s2, s3, s4 }, global, signal: getSignal(global) }
}
