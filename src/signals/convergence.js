/**
 * data_processing/signals/convergence.js
 *
 * Scoring binaire par critère (0 ou 1) avec seuils dynamiques.
 * Alerte uniquement quand MIN_REQUIRED critères sont simultanément alignés.
 *
 * Principe :
 *   Chaque critère est évalué indépendamment → { met: bool }
 *   Le score global = nombre de critères met = true
 *   Alerte si score >= MIN_CONVERGENCE (défaut 3)
 *
 * Seuils : priorité au percentile historique (dynamique) ;
 *          fallback sur seuil absolu si historique < MIN_HIST_POINTS.
 */

import { calcPercentile, calcThresholdAtPct } from '../core/history/metric_history.js'
import { CONVERGENCE } from '../config/signal_calibration.js'

const MIN_HIST_POINTS  = CONVERGENCE.MIN_HIST_POINTS
const MIN_CONVERGENCE  = CONVERGENCE.MIN_CONVERGENCE

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Choisit le seuil : dynamique si assez de données, sinon absolu.
 * @param {number[]} hist    — valeurs historiques
 * @param {number}   pct     — percentile cible (ex: 70)
 * @param {number}   absVal  — seuil absolu de secours
 * @returns {{ threshold: number, isDynamic: boolean }}
 */
function resolveThreshold(hist, pct, absVal) {
  if (hist?.length >= MIN_HIST_POINTS) {
    const dyn = calcThresholdAtPct(hist, pct)
    if (dyn != null) return { threshold: dyn, isDynamic: true }
  }
  return { threshold: absVal, isDynamic: false }
}

/**
 * Construit un critère.
 * @param {object} opts
 * @returns {{ id, label, value, threshold, isDynamic, met, direction, unit, pct }}
 */
function criterion({ id, label, value, hist, targetPct, absThreshold, direction = 'above', unit = '' }) {
  const { threshold, isDynamic } = resolveThreshold(hist, targetPct, absThreshold)
  const numVal = Number.isFinite(value) ? value : null
  const pct    = (hist?.length >= MIN_HIST_POINTS && numVal != null)
    ? calcPercentile(hist, numVal)
    : null

  let met = false
  if (numVal != null) {
    met = direction === 'above' ? numVal >= threshold : numVal <= threshold
  }

  return { id, label, value: numVal, threshold, isDynamic, met: met ? 1 : 0, direction, unit, pct }
}

// ── Construction des critères ─────────────────────────────────────────────────

/**
 * Évalue l'ensemble des critères à partir des données normalisées + historiques.
 *
 * @param {object} inputs
 * @param {object|null} inputs.dvol        — { current, monthMin, monthMax }
 * @param {object|null} inputs.rv          — { current }
 * @param {object|null} inputs.funding     — { rateAnn }
 * @param {number|null} inputs.basisAnn    — basis futures annualisé moyen
 * @param {number|null} inputs.ivRank      — IV Rank 0..100
 * @param {number|null} inputs.skew25d     — skew put-call 25d en pts
 * @param {object}      inputs.hist        — { dvol, rv, ivPremium, fundingAnn, basisAnn, ivRank, skew25d }
 *                                           chaque clé est un number[] (historique de la métrique)
 * @returns {Array<ReturnType<typeof criterion>>}
 */
export function buildCriteria({ dvol, rv, funding, basisAnn, ivRank, skew25d, hist = {} }) {
  const dvolVal     = dvol?.current       ?? null
  const rvVal       = rv?.current         ?? null
  const fundingVal  = funding?.rateAnn    ?? null
  const ivPremium   = (dvolVal != null && rvVal != null) ? dvolVal - rvVal : null

  const criteria_cfg = CONVERGENCE.criteria

  return [
    // 1 — IV Rank élevé : on est dans le haut de la fourchette historique
    criterion({
      id: 'ivRank',
      label: 'IV Rank',
      value: ivRank,
      hist: hist.ivRank,
      targetPct: criteria_cfg.ivRank.dynamicPercentile,
      absThreshold: criteria_cfg.ivRank.absoluteThreshold,
      direction: 'above',
      unit: '/100',
    }),

    // 2 — DVOL au-dessus de sa moyenne historique
    criterion({
      id: 'dvol',
      label: 'DVOL au-dessus moy.',
      value: dvolVal,
      hist: hist.dvol,
      targetPct: criteria_cfg.dvol.dynamicPercentile,
      absThreshold: criteria_cfg.dvol.absoluteThreshold,
      direction: 'above',
      unit: '%',
    }),

    // 3 — Prime IV/RV positive : les options paient une prime sur la vol réalisée
    criterion({
      id: 'ivPremium',
      label: 'Prime IV/RV',
      value: ivPremium,
      hist: hist.ivPremium,
      targetPct: criteria_cfg.ivPremium.dynamicPercentile,
      absThreshold: criteria_cfg.ivPremium.absoluteThreshold,
      direction: 'above',
      unit: ' pts',
    }),

    // 4 — Funding annualisé élevé : le marché paie pour être long
    criterion({
      id: 'fundingAnn',
      label: 'Funding annualisé',
      value: fundingVal,
      hist: hist.fundingAnn,
      targetPct: criteria_cfg.funding.dynamicPercentile,
      absThreshold: criteria_cfg.funding.absoluteThreshold,
      direction: 'above',
      unit: '%',
    }),

    // 5 — Basis en contango : futures plus chers que le spot
    criterion({
      id: 'basisAnn',
      label: 'Basis contango',
      value: basisAnn,
      hist: hist.basisAnn,
      targetPct: criteria_cfg.basis.dynamicPercentile,
      absThreshold: criteria_cfg.basis.absoluteThreshold,
      direction: 'above',
      unit: '%',
    }),

    // 6 — Skew 25d : asymétrie du smile (puts chers = fear premium)
    criterion({
      id: 'skew25d',
      label: 'Skew 25d',
      value: skew25d != null ? Math.abs(skew25d) : null,
      hist: hist.skew25d?.map(v => Math.abs(v)),
      targetPct: criteria_cfg.skew.dynamicPercentile,
      absThreshold: criteria_cfg.skew.absoluteThreshold,
      direction: 'above',
      unit: ' pts',
    }),
  ]
}

// ── Signal de convergence ─────────────────────────────────────────────────────

/**
 * Calcule le signal de convergence à partir d'une liste de critères.
 *
 * @param {ReturnType<typeof buildCriteria>} criteria
 * @param {number} [minRequired=MIN_CONVERGENCE]
 * @returns {{
 *   criteria: typeof criteria,
 *   metCount: number,
 *   total: number,
 *   score: number,          — 0 à 100 (metCount / total * 100)
 *   alert: boolean,
 *   strength: 'strong'|'moderate'|'weak'|'none',
 *   label: string,
 *   color: string,
 * }}
 */
export function computeConvergence(criteria, minRequired = MIN_CONVERGENCE) {
  const metCount = criteria.filter(c => c.met).length
  const total    = criteria.length
  const score    = total > 0 ? Math.round((metCount / total) * 100) : 0

  let strength, label, color
  if (metCount >= CONVERGENCE.STRONG_CONVERGENCE) {
    strength = 'strong';  label = 'Signal fort';    color = 'var(--call)'
  } else if (metCount >= minRequired) {
    strength = 'moderate'; label = 'Convergence';   color = 'var(--atm)'
  } else if (metCount >= CONVERGENCE.WEAK_CONVERGENCE) {
    strength = 'weak';    label = 'Insuffisant';    color = 'var(--accent2)'
  } else {
    strength = 'none';    label = 'Aucun signal';   color = 'var(--text-muted)'
  }

  return { criteria, metCount, total, score, alert: metCount >= minRequired, strength, label, color }
}
