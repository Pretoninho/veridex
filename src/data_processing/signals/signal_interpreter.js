/**
 * data_processing/signals/signal_interpreter.js
 *
 * Interprète le résultat de computeSignal en deux couches :
 *
 *   EXPERT  → 3 blocs de recommandations (Spot / Futures / Options)
 *   noviceData → contexte structuré pour la génération Claude
 *
 * La couche novice finale est générée séparément par novice_generator.js.
 */

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
export function calculateGainExample(signal, amount = 1000) {
  const score = signal?.score ?? 50
  // Durée estimée : entre 7j (signal faible) et 30j (signal fort)
  const days = 7 + Math.round((score / 100) * 23)
  // APR proxy : funding ou 10% par défaut si pas de funding
  const apr = signal?.funding ?? 10
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

// ── Recommandation Spot ──────────────────────────────────────────────────

function _spotReco(score, dvol) {
  const ivRank = _ivRank(dvol)
  const ivStr = ivRank != null ? ` (IV Rank ${ivRank}%)` : ''

  if (score >= 80) return {
    signal:    'Attentif',
    action:    `Volatilité élevée${ivStr} — possibilité de points d'entrée attractifs lors des pics de vol. Accumulation progressive sur supports ; ne pas chasser les breakouts. Attendre une compression de la volatilité pour sécuriser l'entrée.`,
    timeframe: '1 à 4 semaines',
    stopLoss:  'Sortir si IV Rank repasse sous 50%',
  }
  if (score >= 60) return {
    signal:    'Neutre',
    action:    `Marché actif${ivStr}. Entrée spot modérée envisageable sur support identifié. Pas de signal directionnel fort — dimensionner la position en conséquence.`,
    timeframe: '1 à 2 semaines',
    stopLoss:  'Stop sur cassure du support',
  }
  if (score >= 40) return {
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

function _futuresReco(score, funding, basisAvg) {
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const fStr = fundingAnn != null ? ` (${fmt(fundingAnn)}%/an)` : ''
  const bStr = basisAvg != null ? ` — basis ${fmt(basisAvg)}%/an` : ''

  if (score >= 80) return {
    signal:    'Actif',
    action:    `Funding élevé${fStr}${bStr}. Short perp rémunérateur ou cash-and-carry (long spot + short perp) pour capturer le basis sans risque directionnel. Surveiller le funding quotidiennement.`,
    timeframe: '7 à 14 jours',
    stopLoss:  'Fermer si funding tombe sous 5%/an',
  }
  if (score >= 60) return {
    signal:    'Modéré',
    action:    `Funding correct${fStr}. Short perp avec taille réduite envisageable. Cash-and-carry si basis > 8%/an${bStr}.`,
    timeframe: '7 jours',
    stopLoss:  'Surveiller le funding',
  }
  if (score >= 40) return {
    signal:    'Neutre',
    action:    `Funding insuffisant${fStr} pour justifier un short perp. Positions directionnelles uniquement si conviction forte${bStr}.`,
    timeframe: 'Surveillance uniquement',
    stopLoss:  'N/A',
  }
  return {
    signal:    'Défavorable',
    action:    `Funding faible ou négatif${fStr}${bStr}. Éviter les positions futures non hedgées. Backwardation possible — prudence sur les longs futures datés.`,
    timeframe: 'Aucune action futures',
    stopLoss:  'N/A',
  }
}

// ── Recommandation Options ────────────────────────────────────────────────

function _optionsReco(score, dvol, rv, spot, maxPain) {
  const ivRank = _ivRank(dvol)
  const strikeCall = spot != null ? Math.round(spot * 1.08) : null
  const strikePut  = spot != null ? Math.round(spot * 0.92) : null
  const ivStr = ivRank != null ? `IV Rank ${ivRank}%` : 'IV Rank N/A'

  // Suffix Max Pain si disponible
  const mpStr = maxPain?.interpretation
    ? ` · ${maxPain.interpretation.expert}`
    : maxPain?.maxPainStrike
    ? ` · Max Pain $${maxPain.maxPainStrike.toLocaleString()} (strike réel Deribit ✓)`
    : ''

  if (score >= 80) return {
    signal:    'Vendre la vol',
    action:    `${ivStr} — volatilité historiquement élevée. Vendre un straddle/strangle (strikes ~${fmtPrice(strikeCall)} / ~${fmtPrice(strikePut)}) ou un Iron Condor sur Deribit. Durée 7-14j. Delta-hedger si le prix se déplace de > 5%.${mpStr}`,
    timeframe: '7 à 14 jours',
    stopLoss:  'Couper si IV Rank repasse sous 50% ou perte > 1× prime encaissée',
    maxPain,
  }
  if (score >= 60) return {
    signal:    'Spreads vendeurs',
    action:    `${ivStr} — bon contexte pour les spreads verticaux et covered calls. Strike call cible ~${fmtPrice(strikeCall)}. Durée 7j recommandée. Risque limité vs vente nue.${mpStr}`,
    timeframe: '7 jours',
    stopLoss:  'Fermer à 50% du profit max ou si prix dépasse le strike court',
    maxPain,
  }
  if (score >= 40) return {
    signal:    'Achats sélectifs',
    action:    `${ivStr} neutre — éviter les ventes nues. Long calls ou puts si catalyseur identifié. Spreads débiteurs préférables pour limiter le coût. Strike put ~${fmtPrice(strikePut)}.${mpStr}`,
    timeframe: 'Sélectif selon catalyseur',
    stopLoss:  'Limiter à la prime payée (options achetées)',
    maxPain,
  }
  return {
    signal:    'Acheter la vol',
    action:    `${ivStr} bas — options bon marché en achat. Long puts ~${fmtPrice(strikePut)} comme protection ou long calls spéculatifs si le support tient. Durée 14-30j pour laisser le temps à la position.${mpStr}`,
    timeframe: '14 à 30 jours',
    stopLoss:  'Limiter à la prime payée',
    maxPain,
  }
}

// ── Contexte marché ────────────────────────────────────────────────────────

function _buildSituation(dvol, funding, rv, basisAvg) {
  const ivRank = _ivRank(dvol)
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null

  const parts = []
  if (ivRank != null) {
    parts.push(ivRank >= 70
      ? `IV Rank élevé (${ivRank}%) — volatilité implicite au-dessus de la moyenne`
      : ivRank <= 30
      ? `IV Rank faible (${ivRank}%) — volatilité implicite comprimée`
      : `IV Rank neutre (${ivRank}%)`)
  }
  if (fundingAnn != null) {
    parts.push(fundingAnn >= 15
      ? `Funding perp élevé (${fmt(fundingAnn)}%/an) — longs payent fortement`
      : fundingAnn >= 5
      ? `Funding modéré (${fmt(fundingAnn)}%/an)`
      : `Funding faible (${fmt(fundingAnn)}%/an)`)
  }
  if (basisAvg != null) {
    parts.push(basisAvg >= 8
      ? `Basis futures contango fort (${fmt(basisAvg)}%/an)`
      : basisAvg <= -2
      ? `Basis en backwardation (${fmt(basisAvg)}%/an)`
      : `Basis modéré (${fmt(basisAvg)}%/an)`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'Données partielles disponibles'
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
 *   expert: object,
 *   noviceData: object
 * }}
 */
export function interpretSignal(computedSignal, rawData) {
  const score       = computedSignal?.global ?? null
  const signalMeta  = computedSignal?.signal ?? null
  const maxPain     = computedSignal?.maxPain ?? null
  const { dvol, funding, rv, basisAvg, spot, asset } = rawData ?? {}

  const ivRank     = _ivRank(dvol)
  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const situation  = _buildSituation(dvol, funding, rv, basisAvg)

  const spotReco    = _spotReco(score, dvol)
  const futuresReco = _futuresReco(score, funding, basisAvg)
  const optionsReco = _optionsReco(score, dvol, rv, spot, maxPain)

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
  }

  // Données nécessaires au générateur novice
  const noviceData = {
    asset:         asset ?? 'BTC',
    spotPrice:     spot,
    label:         signalMeta?.label ?? '—',
    score,
    ivRank,
    funding:       fundingAnn,
    situation,
    estimatedGain: calculateGainExample({ score, funding: fundingAnn }),
    strikeCall:    spot != null ? Math.round(spot * 1.08) : null,
    strikePut:     spot != null ? Math.round(spot * 0.92) : null,
    spotSignal:    spotReco.signal,
    spotAction:    spotReco.action,
    futuresSignal: futuresReco.signal,
    futuresAction: futuresReco.action,
    optionsSignal: optionsReco.signal,
    optionsAction: optionsReco.action,
    duration:      optionsReco.timeframe,
    maxPain,
    maxPainNovice: maxPain?.interpretation?.novice ?? null,
  }

  return { expert, noviceData }
}
