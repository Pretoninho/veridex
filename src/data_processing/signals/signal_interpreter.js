/**
 * data_processing/signals/signal_interpreter.js
 *
 * Interprète le résultat de computeSignal en deux couches :
 *
 *   EXPERT  → synthèse technique statique + action Deribit précise
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

// ── Textes expert par niveau de score ─────────────────────────────────────

function _expertContent(score, dvol, funding, rv, basisAvg, spot, asset) {
  const ivRank = dvol
    ? Math.round(((dvol.current - dvol.monthMin) / (dvol.monthMax - dvol.monthMin || 1)) * 100)
    : null

  const ivCurrent   = dvol?.current ?? null
  const fundingAnn  = funding?.rateAnn ?? funding?.avgAnn7d ?? null
  const rvCurrent   = rv?.current ?? null
  const ivPremium   = ivCurrent != null && rvCurrent != null ? ivCurrent - rvCurrent : null

  // ── Contexte situation ─────────────────────────────────────────────────

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
  const situation = parts.length > 0 ? parts.join(' · ') : 'Données partielles disponibles'

  // ── Action et durée selon score ────────────────────────────────────────

  if (score >= 80) {
    return {
      situation,
      action:      `Sell High via options call OTM sur Deribit (strike ~${fmtPrice(spot ? spot * 1.08 : null)}). Parallèlement, short perp pour capter le funding. IV Rank ${ivRank ?? '—'}% → prime d'option historiquement élevée.`,
      duration:    '7 à 14 jours',
      stopLoss:    'Fermer si IV Rank repasse sous 50% ou funding retombe sous 5%/an',
      ivRank,
      fundingAnn,
    }
  }

  if (score >= 60) {
    return {
      situation,
      action:      `DI Sell High recommandé (${asset}, strike ~${fmtPrice(spot ? spot * 1.08 : null)}, durée ~7j). Funding annualisé à ${fmt(fundingAnn)}% justifie l'opération.`,
      duration:    '7 jours',
      stopLoss:    'Surveillance si prix dépasse le strike',
      ivRank,
      fundingAnn,
    }
  }

  if (score >= 40) {
    return {
      situation,
      action:      `Contexte sub-optimal. Attendre IV Rank > 60% ou funding > 15%/an avant d'ouvrir un DI. Surveiller le basis : actuellement ${fmt(basisAvg)}%/an.`,
      duration:    'Pas de trade recommandé maintenant',
      stopLoss:    'N/A — pas d\'exposition recommandée',
      ivRank,
      fundingAnn,
    }
  }

  return {
    situation,
    action:      `Conditions défavorables. IV trop basse et/ou funding négatif. Rester cash ou positions réduites. Envisager un Buy Low (put OTM) si le prix approche un support fort.`,
    duration:    'Aucune action DI recommandée',
    stopLoss:    'N/A',
    ivRank,
    fundingAnn,
  }
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
  const { dvol, funding, rv, basisAvg, spot, asset } = rawData ?? {}

  const expertContent = _expertContent(score, dvol, funding, rv, basisAvg, spot, asset ?? 'BTC')

  const expert = {
    label:       signalMeta?.label ?? '—',
    score,
    color:       signalMeta?.color ?? 'var(--text-muted)',
    border:      signalMeta?.border ?? 'var(--border)',
    bg:          signalMeta?.bg ?? 'transparent',
    situation:   expertContent.situation,
    action:      expertContent.action,
    duration:    expertContent.duration,
    stopLoss:    expertContent.stopLoss,
    ivRank:      expertContent.ivRank,
    fundingAnn:  expertContent.fundingAnn,
  }

  // Données nécessaires au générateur novice
  const noviceData = {
    asset:         asset ?? 'BTC',
    spotPrice:     spot,
    label:         signalMeta?.label ?? '—',
    score,
    ivRank:        expertContent.ivRank,
    funding:       expertContent.fundingAnn,
    situation:     expertContent.situation,
    estimatedGain: calculateGainExample({ score, funding: expertContent.fundingAnn }),
    strikeCall:    spot != null ? Math.round(spot * 1.08) : null,
    strikePut:     spot != null ? Math.round(spot * 0.92) : null,
    expertAction:  expertContent.action,
    duration:      expertContent.duration,
  }

  return { expert, noviceData }
}
