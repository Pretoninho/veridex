/**
 * data_processing/signals/signal_interpreter.js
 *
 * Interprète le résultat de computeSignal :
 *
 *   EXPERT  → 3 blocs de recommandations (Spot / Futures / Options)
 */

import { INTERPRETER, OPTIONS_CALC } from '../config/signal_calibration.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n, dec = 1) => (n != null ? n.toFixed(dec) : '—')
const fmtPrice = (n) => (n != null ? `$${Math.round(n).toLocaleString('fr-FR')}` : '—')

/**
 * Calcule un gain estimé en $ sur un montant exemple.
 * Basé sur le funding annualisé et une durée cible de 7 à 30 jours.
 *
 * @param {{ score: number|null, funding: number|null }} signal
 * @param {number} amount — montant exemple en $
 * @returns {number|null}
 */
export function calculateGainExample(signal, amount = OPTIONS_CALC.example_amount_usd) {
  const score = signal?.score ?? 50
  // Durée estimée : entre min_holding_period (signal faible) et max_holding_period (signal fort)
  const minDays = OPTIONS_CALC.min_holding_period_days
  const maxDays = OPTIONS_CALC.max_holding_period_days
  const days = minDays + Math.round((score / 100) * (maxDays - minDays))
  // APR proxy : funding ou default_apr par défaut si pas de funding
  const apr = signal?.funding ?? OPTIONS_CALC.default_apr
  if (!apr || apr <= 0) return null
  const gain = amount * (apr / 100) * (days / 365)
  return Math.round(gain)
}

// ── Calcul IV Rank ──────────────────────────────────────────────────────────

function _ivRank(dvol) {
  if (!dvol) return null
  const range = dvol.monthMax - dvol.monthMin
  if (!range) return null
  return Math.round(((dvol.current - dvol.monthMin) / range) * 100)
}

// ── Détermine le régime de volatilité ───────────────────────────────────────

function _getVolRegime(ivRank) {
  if (ivRank == null) return 'NEUTRAL'
  if (ivRank >= INTERPRETER.ivRank.highVol) return 'HIGH_VOL'
  if (ivRank <= INTERPRETER.ivRank.lowVol) return 'LOW_VOL'
  return 'NEUTRAL'
}

// ── Recommandation Spot ──────────────────────────────────────────────────

function _spotReco(score, dvol) {
  const ivRank = _ivRank(dvol)
  const ivStr = ivRank != null ? ` (IV Rank ${ivRank}%)` : ''
  const spot_cfg = INTERPRETER.spot

  if (score >= spot_cfg.attentif) return {
    signal:    'Attentif',
    action:    `Volatilité élevée${ivStr} — possibilité de points d'entrée attractifs lors des pics de vol. Accumulation progressive sur supports ; ne pas chasser les breakouts. Attendre une compression de la volatilité pour sécuriser l'entrée.`,
    timeframe: '1 à 4 semaines',
    stopLoss:  'Sortir si IV Rank repasse sous 50%',
  }
  if (score >= spot_cfg.neutre) return {
    signal:    'Neutre',
    action:    `Marché actif${ivStr}. Entrée spot modérée envisageable sur support identifié. Pas de signal directionnel fort — dimensionner la position en conséquence.`,
    timeframe: '1 à 2 semaines',
    stopLoss:  'Stop sur cassure du support',
  }
  if (score >= spot_cfg.prudent) return {
    signal:    'Prudent',
    action:    `Contexte mixte${ivStr}. Attendre confirmation directionnelle avant toute entrée spot. Réduire l'exposition si déjà en position.`,
    timeframe: 'Pas de trade spot recommandé',
    stopLoss:  'N/A',
  }
  return {
    signal:    'Cash',
    action:    `Conditions défavorables${ivStr}. Rester cash ou alléger les positions existantes. IV basse = options de protection (puts) bon marché pour couvrir un portefeuille existant.`,
    timeframe: 'Aucune action recommandée',
    stopLoss:  'N/A',
  }
}

// ── Recommandation Futures ────────────────────────────────────────────────

function _futuresReco(score, funding, basisAvg, positioning) {
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const fStr = fundingAnn != null ? ` (${fmt(fundingAnn)}%/an)` : ''
  const bStr = basisAvg != null ? ` — basis ${fmt(basisAvg)}%/an` : ''
  const spot_cfg = INTERPRETER.spot
  const funding_cfg = INTERPRETER.funding
  const basis_cfg = INTERPRETER.basis

  // v2.0: Contexte positionnement Deribit P/C ratio seul
  let posCtx = ''
  if (positioning?.pcRatio != null && positioning?.score != null) {
    const pcLabel = positioning.signalType === 'bullish'
      ? 'Instit. offensif (peu de puts)'
      : positioning.signalType === 'bearish'
      ? 'Instit. défensif (beaucoup de puts)'
      : 'Instit. neutre'
    posCtx = ` · P/C ratio ${fmt(positioning.pcRatio, 2)} — ${pcLabel}`
  }

  if (score >= spot_cfg.attentif) return {
    signal:    'Actif',
    action:    `Funding élevé${fStr}${bStr}. Short perp rémunérateur ou cash-and-carry (long spot + short perp) pour capturer le basis sans risque directionnel. Surveiller le funding quotidiennement.${posCtx}`,
    timeframe: '7 à 14 jours',
    stopLoss:  `Fermer si funding tombe sous ${funding_cfg.moderate}%/an`,
  }
  if (score >= spot_cfg.neutre) return {
    signal:    'Modéré',
    action:    `Funding correct${fStr}. Short perp avec taille réduite envisageable. Cash-and-carry si basis > ${basis_cfg.highContango}%/an${bStr}.${posCtx}`,
    timeframe: '7 jours',
    stopLoss:  'Surveiller le funding',
  }
  if (score >= spot_cfg.prudent) return {
    signal:    'Neutre',
    action:    `Funding insuffisant${fStr} pour justifier un short perp. Positions directionnelles uniquement si conviction forte${bStr}.${posCtx}`,
    timeframe: 'Surveillance uniquement',
    stopLoss:  'N/A',
  }
  return {
    signal:    'Défavorable',
    action:    `Funding faible ou négatif${fStr}${bStr}. Éviter les positions futures non hedgées. Backwardation possible — prudence sur les longs futures datés.${posCtx}`,
    timeframe: 'Aucune action futures',
    stopLoss:  'N/A',
  }
}

// ── Recommandation Options ────────────────────────────────────────────────

function _optionsReco(score, dvol, rv, spot, maxPain, funding, basisAvg) {
  const ivRank = _ivRank(dvol)
  const strikeCall = spot != null ? Math.round(spot * OPTIONS_CALC.call_strike_otm_multiplier) : null
  const strikePut  = spot != null ? Math.round(spot * OPTIONS_CALC.put_strike_otm_multiplier) : null
  const ivStr = ivRank != null ? `IV Rank ${ivRank}%` : 'IV Rank N/A'
  const opt_cfg = INTERPRETER.options

  // Contexte IV vs RV (vol implicite chère ou bon marché)
  const rvCurrent = rv?.current ?? null
  const ivVsRv = (dvol?.current != null && rvCurrent != null)
    ? (dvol.current > rvCurrent
        ? ' · IV > RV — vol implicite chère, privilégier la vente'
        : ' · IV < RV — vol implicite bon marché, privilégier l\'achat')
    : ''

  // Contexte funding rate
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const fundingCtx = fundingAnn != null
    ? (fundingAnn >= 15
        ? ` · funding élevé (${fmt(fundingAnn)}%/an) — surextension haussière, risque de retournement`
        : fundingAnn >= 5
        ? ` · funding modéré (${fmt(fundingAnn)}%/an) — biais haussier`
        : fundingAnn <= -5
        ? ` · funding négatif (${fmt(fundingAnn)}%/an) — pression baissière`
        : ` · funding neutre (${fmt(fundingAnn)}%/an)`)
    : ''

  // Contexte basis (contango / backwardation)
  const basisCtx = basisAvg != null
    ? (basisAvg >= 8
        ? ` · contango fort (basis ${fmt(basisAvg)}%/an) — prime futures élevée`
        : basisAvg <= -2
        ? ` · backwardation (basis ${fmt(basisAvg)}%/an) — stress ou demande de couverture`
        : ` · basis modéré (${fmt(basisAvg)}%/an)`)
    : ''

  // Suffix Max Pain si disponible
  const mpStr = maxPain?.interpretation
    ? ` · ${maxPain.interpretation.expert}`
    : maxPain?.maxPainStrike
    ? ` · Max Pain $${maxPain.maxPainStrike.toLocaleString()} (strike réel Deribit ✓)`
    : ''

  // Contexte marché enrichi (IV/RV + funding + basis)
  const ctxStr = `${ivVsRv}${fundingCtx}${basisCtx}`

  // Régime de volatilité
  const regime = _getVolRegime(ivRank)

  // Logique prioritaire : regime > score
  if (regime === 'HIGH_VOL') {
    return {
      signal:    'Vendre la vol',
      action:    `${ivStr} — volatilité historiquement élevée${ctxStr}. Vendre un straddle/strangle (strikes ~${fmtPrice(strikeCall)} / ~${fmtPrice(strikePut)}) ou un Iron Condor sur Deribit. Durée 7-14j. Delta-hedger si le prix se déplace de > 5%.${mpStr}`,
      timeframe: '7 à 14 jours',
      stopLoss:  'Couper si IV Rank repasse sous 50% ou perte > 1× prime encaissée',
      maxPain,
    }
  }

  if (regime === 'LOW_VOL') {
    return {
      signal:    'Acheter la vol',
      action:    `${ivStr} bas${ctxStr} — options bon marché en achat. Long puts ~${fmtPrice(strikePut)} comme protection ou long calls spéculatifs si le support tient. Durée 14-30j pour laisser le temps à la position.${mpStr}`,
      timeframe: '14 à 30 jours',
      stopLoss:  'Limiter à la prime payée',
      maxPain,
    }
  }

  // NEUTRAL → fallback basé sur score + contexte enrichi
  if (score >= opt_cfg.highVolScore) return {
    signal:    'Vendre la vol',
    action:    `${ivStr} — volatilité historiquement élevée${ctxStr}. Vendre un straddle/strangle (strikes ~${fmtPrice(strikeCall)} / ~${fmtPrice(strikePut)}) ou un Iron Condor sur Deribit. Durée 7-14j. Delta-hedger si le prix se déplace de > 5%.${mpStr}`,
    timeframe: '7 à 14 jours',
    stopLoss:  'Couper si IV Rank repasse sous 50% ou perte > 1× prime encaissée',
    maxPain,
  }
  if (score >= opt_cfg.spreadsScore) return {
    signal:    'Spreads vendeurs',
    action:    `${ivStr}${ctxStr} — bon contexte pour les spreads verticaux et covered calls. Strike call cible ~${fmtPrice(strikeCall)}. Durée 7j recommandée. Risque limité vs vente nue.${mpStr}`,
    timeframe: '7 jours',
    stopLoss:  'Fermer à 50% du profit max ou si prix dépasse le strike court',
    maxPain,
  }
  if (score >= opt_cfg.selectiveScore) return {
    signal:    'Achats sélectifs',
    action:    `${ivStr} neutre${ctxStr} — éviter les ventes nues. Long calls ou puts si catalyseur identifié. Spreads débiteurs préférables pour limiter le coût. Strike put ~${fmtPrice(strikePut)}.${mpStr}`,
    timeframe: 'Sélectif selon catalyseur',
    stopLoss:  'Limiter à la prime payée (options achetées)',
    maxPain,
  }
  return {
    signal:    'Acheter la vol',
    action:    `${ivStr} bas${ctxStr} — options bon marché en achat. Long puts ~${fmtPrice(strikePut)} comme protection ou long calls spéculatifs si le support tient. Durée 14-30j pour laisser le temps à la position.${mpStr}`,
    timeframe: '14 à 30 jours',
    stopLoss:  'Limiter à la prime payée',
    maxPain,
  }
}

// ── Contexte marché ────────────────────────────────────────────────────────

function _buildSituation(dvol, funding, rv, basisAvg) {
  const ivRank = _ivRank(dvol)
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const iv_cfg = INTERPRETER.ivRank
  const funding_cfg = INTERPRETER.funding
  const basis_cfg = INTERPRETER.basis

  const parts = []
  if (ivRank != null) {
    parts.push(ivRank >= iv_cfg.highVol
      ? `IV Rank élevé (${ivRank}%) — volatilité implicite au-dessus de la moyenne`
      : ivRank <= iv_cfg.lowVol
      ? `IV Rank faible (${ivRank}%) — volatilité implicite comprimée`
      : `IV Rank neutre (${ivRank}%)`)
  }
  if (fundingAnn != null) {
    parts.push(fundingAnn >= funding_cfg.high
      ? `Funding perp élevé (${fmt(fundingAnn)}%/an) — longs payent fortement`
      : fundingAnn >= funding_cfg.moderate
      ? `Funding modéré (${fmt(fundingAnn)}%/an)`
      : `Funding faible (${fmt(fundingAnn)}%/an)`)
  }
  if (basisAvg != null) {
    parts.push(basisAvg >= basis_cfg.highContango
      ? `Basis futures contango fort (${fmt(basisAvg)}%/an)`
      : basisAvg <= basis_cfg.backwardation
      ? `Basis en backwardation (${fmt(basisAvg)}%/an)`
      : `Basis modéré (${fmt(basisAvg)}%/an)`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'Données partielles disponibles'
}

// ── buildStrategySignature ─────────────────────────────────────────────────

/**
 * Builds a sorted, pipe-separated string of strategy types for hashing.
 *
 * @param {Array<{ type: string }>} strategies — array returned by strategyEngine
 * @returns {string} e.g. "CASH_AND_CARRY|VOL_CARRY|VOL_EXPANSION" or "NO_STRATEGY"
 */
export function buildStrategySignature(strategies) {
  if (!Array.isArray(strategies) || strategies.length === 0) return 'NO_STRATEGY'
  return strategies.map(s => s.type).sort().join('|')
}

// ── buildMarketRegime ──────────────────────────────────────────────────────

/**
 * Builds a pipe-separated market regime string from key market conditions.
 *
 * @param {number|null} ivRank   — IV Rank (0–100)
 * @param {number|null} funding  — annualised funding rate (%)
 * @param {number|null} basisAvg — average basis annualised (%)
 * @returns {string} e.g. "HIGH_VOL|EXTREME_LONGS|CONTANGO"
 */
export function buildMarketRegime(ivRank, funding, basisAvg) {
  const vol   = ivRank  == null ? 'UNKNOWN_VOL'
              : ivRank  > 70    ? 'HIGH_VOL'
              : ivRank  < 30    ? 'LOW_VOL'
              : 'MID_VOL'
  const fund  = funding == null ? 'UNKNOWN_FUNDING'
              : funding > 15    ? 'EXTREME_LONGS'
              : funding < -10   ? 'EXTREME_SHORTS'
              : 'NEUTRAL_FUNDING'
  const basis = basisAvg == null ? 'UNKNOWN_BASIS'
              : basisAvg > 8    ? 'CONTANGO'
              : basisAvg < -2   ? 'BACKWARDATION'
              : 'FLAT'
  return `${vol}|${fund}|${basis}`
}

// ── Strategy Engine ────────────────────────────────────────────────────────

/**
 * Détecte dynamiquement les stratégies actives selon les conditions de marché.
 *
 * @param {{ ivRank: number|null, funding: number|null, basisAvg: number|null, spot: number|null, maxPain: object|null }} params
 * @returns {Array<{ type: string, strength: string, context: string }>}
 */
export function strategyEngine({ ivRank, funding, basisAvg, spot, maxPain }) {
  const signals = []

  // Retail strategies
  if (ivRank != null && ivRank < 30) {
    signals.push({ type: 'VOL_EXPANSION', strength: 'medium', context: 'IV Rank faible — expansion de volatilité probable' })
  }

  if (funding != null && (funding > 15 || funding < -10)) {
    signals.push({ type: 'FUNDING_REVERSAL', strength: 'high', context: 'Funding extrême — retournement possible' })
  }

  const maxPainStrike = maxPain?.maxPainStrike ?? null
  if (spot != null && maxPainStrike != null) {
    const distPct = (Math.abs(spot - maxPainStrike) / maxPainStrike) * 100
    if (distPct <= 2) {
      signals.push({ type: 'MAX_PAIN_PLAY', strength: 'medium', context: 'Prix dans la zone Max Pain (±2%)' })
    }
  }

  // Institutional strategies
  if (ivRank != null && ivRank > 70) {
    signals.push({ type: 'VOL_CARRY', strength: 'medium', context: 'IV Rank élevé — opportunité de vol carry' })
  }

  if (basisAvg != null && basisAvg > 8) {
    signals.push({ type: 'CASH_AND_CARRY', strength: 'high', context: 'Contango fort — opportunité cash-and-carry' })
  }

  // REGIME_SHIFT : IV Rank en zone neutre (40-60) et funding proche de zéro (±5%) — transition de régime probable
  if (ivRank != null && ivRank >= 40 && ivRank <= 60 && funding != null && Math.abs(funding) <= 5) {
    signals.push({ type: 'REGIME_SHIFT', strength: 'low', context: 'IV Rank neutre et funding en transition — changement de régime possible' })
  }

  return signals
}

// ── Fonction principale ────────────────────────────────────────────────────

/**
 * Interprète le résultat de computeSignal.
 *
 * @param {{
 *   scores: { s1, s2, s3, s4, s5 },
 *   global: number|null,
 *   signal: object|null
 * }} computedSignal
 * @param {{
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   spot: number|null,
 *   asset: string
 * }} rawData
 * @returns {{
 *   expert: object
 * }}
 */
export function interpretSignal(computedSignal, rawData) {
  const score       = computedSignal?.global ?? null
  const signalMeta  = computedSignal?.signal ?? null
  const maxPain     = computedSignal?.maxPain ?? null
  const positioning = computedSignal?.positioning ?? null
  const { dvol, funding, rv, basisAvg, spot } = rawData ?? {}

  const ivRank     = _ivRank(dvol)
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const situation  = _buildSituation(dvol, funding, rv, basisAvg)

  const dynamicStrategies  = strategyEngine({ ivRank, funding: fundingAnn, basisAvg, spot, maxPain })
  const strategySignature  = buildStrategySignature(dynamicStrategies)
  const marketRegime       = buildMarketRegime(ivRank, fundingAnn, basisAvg)

  const spotReco    = _spotReco(score, dvol)
  const futuresReco = _futuresReco(score, funding, basisAvg, positioning)
  const optionsReco = _optionsReco(score, dvol, rv, spot, maxPain, funding, basisAvg)

  if (dynamicStrategies.length > 0) {
    const strategyNames = dynamicStrategies.map(s => s.type).join(', ')
    optionsReco.action = `${optionsReco.action} | Stratégies actives: ${strategyNames}`
  }

  const expert = {
    label:    signalMeta?.label ?? '—',
    score,
    color:    signalMeta?.color ?? 'var(--text-muted)',
    border:   signalMeta?.border ?? 'var(--border)',
    bg:       signalMeta?.bg ?? 'transparent',
    situation,
    recommendations: {
      spot:    spotReco,
      futures: futuresReco,
      options: optionsReco,
    },
    ivRank,
    fundingAnn,
    strategySignature,
    marketRegime,
  }

  return { expert }
}
