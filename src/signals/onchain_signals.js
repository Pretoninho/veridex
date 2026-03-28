/**
 * data_processing/signals/onchain_signals.js
 *
 * Signaux basés sur les données on-chain Bitcoin.
 * Quatre fonctions indépendantes + un signal composite.
 *
 * Format des descriptions novice :
 *   { metaphor, situation, action, gain, risk }
 */

import { ONCHAIN_SIGNALS } from '../config/signal_calibration.js'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Calcule une moyenne simple d'un tableau de nombres. */
function avg(arr) {
  if (!arr?.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// ── Signal 1 : Exchange Flow ──────────────────────────────────────────────────

/**
 * Détecte un signal directionnel à partir du flux net exchanges.
 *
 * @param {{ netflow: number|null, signal: string, strength: string }} flowData
 * @param {{ price: number|null }} [priceData]
 * @param {number[]} [history7d] — historique des netflows 7j pour calcul moyenne
 * @returns {{
 *   signal: 'ACCUMULATION'|'DISTRIBUTION'|'NEUTRAL',
 *   strength: 'weak'|'moderate'|'strong',
 *   description_expert: string,
 *   description_novice: { metaphor, situation, action, gain, risk }
 * }}
 */
export function detectExchangeFlowSignal(flowData, priceData, history7d) {
  const netflow = flowData?.netflow ?? null
  const avg7d   = avg(history7d)

  // Déterminer si le flux est anormal par rapport à la moyenne 7j
  let signal   = 'NEUTRAL'
  let strength = flowData?.strength ?? 'weak'

  if (netflow != null) {
    const multiplier = avg7d != null && avg7d !== 0
      ? Math.abs(netflow) / Math.abs(avg7d)
      : 1

    const moderateM = ONCHAIN_SIGNALS.flow.moderateMultiplier
    const strongM = ONCHAIN_SIGNALS.flow.strongMultiplier

    if (netflow < 0 && (avg7d == null || multiplier >= moderateM)) {
      // Outflow fort → accumulation haussière
      signal   = 'ACCUMULATION'
      strength = multiplier >= strongM ? 'strong' : multiplier >= moderateM ? 'moderate' : 'weak'
    } else if (netflow > 0 && (avg7d == null || multiplier >= moderateM)) {
      // Inflow fort → distribution baissière
      signal   = 'DISTRIBUTION'
      strength = multiplier >= strongM ? 'strong' : multiplier >= moderateM ? 'moderate' : 'weak'
    } else if (netflow < 0) {
      signal = 'ACCUMULATION'
    } else if (netflow > 0) {
      signal = 'DISTRIBUTION'
    }
  }

  const netflowFmt = netflow != null ? `${netflow > 0 ? '+' : ''}${Math.round(netflow).toLocaleString()} BTC` : 'N/A'

  const descriptionExpert = signal === 'ACCUMULATION'
    ? `Outflow net exchanges : ${netflowFmt}. Les holders retirent du BTC des plateformes, réduisant l'offre disponible à la vente. Contexte haussier structurel${strength === 'strong' ? ' — signal fort au-delà de 1,5× la moyenne 7j' : ''}.`
    : signal === 'DISTRIBUTION'
    ? `Inflow net exchanges : ${netflowFmt}. Mouvement massif vers les exchanges, pression vendeuse potentielle. Contexte baissier${strength === 'strong' ? ' — signal fort au-delà de 1,5× la moyenne 7j' : ''}.`
    : `Flux net exchanges équilibré (${netflowFmt}). Pas de signal directionnel clair.`

  const descriptionNovice = signal === 'ACCUMULATION'
    ? {
        metaphor:  'Comme des gens qui retirent leur argent de la banque pour le mettre sous leur matelas...',
        situation: `Les investisseurs bougent ${Math.abs(netflow ?? 0) > 1000 ? 'beaucoup de' : 'du'} Bitcoin hors des exchanges — ils ne veulent pas vendre.`,
        action:    'Tu peux envisager d\'acheter progressivement sur Binance (DCA) et de conserver en cold wallet.',
        gain:      `Signal ${strength === 'strong' ? 'fort' : 'modéré'} historiquement associé à des hausses dans les semaines suivantes.`,
        risk:      'Ce signal seul ne garantit rien — combine-le avec l\'analyse de prix avant d\'agir.',
      }
    : signal === 'DISTRIBUTION'
    ? {
        metaphor:  'Comme des gens qui apportent leur épargne en banque avant une grosse dépense...',
        situation: `Des investisseurs transfèrent ${Math.abs(netflow ?? 0) > 1000 ? 'beaucoup de' : 'du'} Bitcoin vers les exchanges — signe qu\'ils pourraient vendre.`,
        action:    'Sois prudent(e) : évite d\'acheter une grosse position maintenant. Sur Nexo, tu peux sécuriser en stablecoin temporairement.',
        gain:      'Protéger ton capital en période de distribution peut éviter de perdre 10-30%.',
        risk:      'Certains transferts exchanges sont dus aux institutionnels pour faire du collatéral, pas forcément pour vendre.',
      }
    : {
        metaphor:  'Comme un marché calme un dimanche matin...',
        situation: 'Les mouvements BTC vers/depuis les exchanges sont normaux — pas de signal fort.',
        action:    'Pas d\'action urgente. Continue ton plan d\'investissement habituel sur Binance.',
        gain:      'Économise les frais en n\'agissant pas sur des signaux faibles.',
        risk:      'L\'inaction peut faire manquer des opportunités — reste attentif(ve).',
      }

  return { signal, strength, description_expert: descriptionExpert, description_novice: descriptionNovice }
}

// ── Signal 2 : Mempool ────────────────────────────────────────────────────────

/**
 * Analyse la congestion du mempool Bitcoin.
 *
 * @param {{ txCount: number|null, congestion: string, fastFee: number|null, hourFee: number|null }} mempoolData
 * @returns {{
 *   signal: 'CALM'|'ACTIVE'|'CONGESTED'|'CRITICAL',
 *   congestionLevel: 'low'|'medium'|'high'|'critical',
 *   description_expert: string,
 *   description_novice: { metaphor, situation, action, gain, risk }
 * }}
 */
export function detectMempoolSignal(mempoolData) {
  const txCount    = mempoolData?.txCount    ?? null
  const fastFee    = mempoolData?.fastFee    ?? null
  const congestion = mempoolData?.congestion ?? 'low'

  const criticalFee = ONCHAIN_SIGNALS.mempool.criticalFee
  const congestedFee = ONCHAIN_SIGNALS.mempool.congestedFee

  let signal = 'CALM'
  if (congestion === 'critical' || (fastFee != null && fastFee > criticalFee)) signal = 'CRITICAL'
  else if (congestion === 'high' || (fastFee != null && fastFee > congestedFee))  signal = 'CONGESTED'
  else if (congestion === 'medium')                                       signal = 'ACTIVE'

  const txFmt  = txCount != null ? `${txCount.toLocaleString()} tx` : 'N/A'
  const feeFmt = fastFee != null ? `${fastFee} sats/vbyte` : 'N/A'

  const descriptionExpert = signal === 'CRITICAL'
    ? `Mempool critique : ${txFmt} en attente, fees rapides à ${feeFmt}. Activité réseau anormalement élevée — possibilité de mouvement de prix imminent ou liquidations en chaîne.`
    : signal === 'CONGESTED'
    ? `Mempool congestionné : ${txFmt} en attente, fees à ${feeFmt}. Activité supérieure à la normale — surveiller les bougies courtes pour signaux de momentum.`
    : signal === 'ACTIVE'
    ? `Activité mempool modérée : ${txFmt}, fees à ${feeFmt}. Réseau sous charge normale.`
    : `Mempool calme : ${txFmt}, fees à ${feeFmt}. Faible activité on-chain.`

  const descriptionNovice = signal === 'CRITICAL'
    ? {
        metaphor:  'Comme une autoroute bouchée un vendredi soir — tout le monde veut passer en même temps...',
        situation: `Il y a ${txFmt} de transactions Bitcoin bloquées. Quelque chose de gros se passe sur le réseau.`,
        action:    'Attention : un mouvement de prix fort est possible dans les prochaines heures. Ne place pas d\'ordre important sans stop-loss sur Binance.',
        gain:      'Les traders qui anticipent ces moments peuvent capturer des mouvements de 5-15%.',
        risk:      'Ce n\'est pas toujours un mouvement haussier — ça peut aussi être des liquidations en cascade.',
      }
    : signal === 'CONGESTED'
    ? {
        metaphor:  'Comme une salle de concert qui se remplit — il se passe quelque chose...',
        situation: `Le réseau Bitcoin est occupé (${txFmt} en attente). Activité supérieure à la normale.`,
        action:    'Surveille le marché de près. Sur Binance, active les alertes de prix pour ton asset.',
        gain:      'Repérer l\'activité avant les autres donne souvent quelques minutes d\'avance.',
        risk:      'La congestion peut durer des heures sans mouvement de prix significatif.',
      }
    : {
        metaphor:  'Comme une route déserte à 3h du matin — tout est calme...',
        situation: `Peu d\'activité Bitcoin on-chain (${txFmt}, fees à ${feeFmt}).`,
        action:    'Pas d\'urgence. C\'est un bon moment pour configurer des ordres limite sur Nexo sans se faire déborder.',
        gain:      'Les frais de transaction sont bas — c\'est le bon moment pour des mouvements de fonds.',
        risk:      'Le calme peut précéder une forte volatilité.',
      }

  return {
    signal,
    congestionLevel: congestion,
    description_expert: descriptionExpert,
    description_novice: descriptionNovice,
  }
}

// ── Signal 3 : Mining ─────────────────────────────────────────────────────────

/**
 * Interprète les données de mining.
 *
 * @param {{ hashRate: number|null, difficulty: number|null, trend: string }} miningData
 * @param {number|null} [previousHashRate] — hash rate précédent pour calculer la variation
 * @returns {{
 *   signal: 'BULLISH'|'BEARISH'|'NEUTRAL',
 *   trend: 'up'|'down'|'stable',
 *   description_novice: { metaphor, situation, action, gain, risk }
 * }}
 */
export function detectMinerSignal(miningData, previousHashRate) {
  const hashRate   = miningData?.hashRate   ?? null
  const difficulty = miningData?.difficulty ?? null

  let trend  = miningData?.trend ?? 'stable'
  let signal = 'NEUTRAL'

  // Calculer la variation si on a un hash rate précédent
  const bullishThreshold = ONCHAIN_SIGNALS.hashRate.bullish
  const bearishThreshold = ONCHAIN_SIGNALS.hashRate.bearish

  if (hashRate != null && previousHashRate != null && previousHashRate > 0) {
    const changePct = ((hashRate - previousHashRate) / previousHashRate) * 100
    if (changePct > bullishThreshold) {
      trend  = 'up'
      signal = 'BULLISH'
    } else if (changePct < bearishThreshold) {
      trend  = 'down'
      signal = 'BEARISH'
    }
  }

  const hashFmt = hashRate != null
    ? `${(hashRate / 1e18).toFixed(2)} EH/s`
    : 'N/A'

  const diffFmt = difficulty != null
    ? `${(difficulty / 1e12).toFixed(2)}T`
    : 'N/A'

  const descriptionNovice = signal === 'BULLISH'
    ? {
        metaphor:  'Comme de plus en plus d\'ouvriers qui rejoignent un chantier — le projet prend de l\'ampleur...',
        situation: `Les mineurs Bitcoin investissent plus de puissance (${hashFmt}). C\'est un signe de confiance dans le prix futur.`,
        action:    'Signal positif long terme. Idéal pour accumuler progressivement sur Binance avec un DCA hebdomadaire.',
        gain:      'Historiquement, la hausse du hash rate précède des hausses de prix à 3-6 mois.',
        risk:      'C\'est un signal lent — ça ne dit rien sur ce qui se passe dans la prochaine heure.',
      }
    : signal === 'BEARISH'
    ? {
        metaphor:  'Comme des ouvriers qui quittent le chantier — quelque chose ne va pas...',
        situation: `Les mineurs réduisent leur activité (${hashFmt}). Ils ne sont plus confiants dans la rentabilité du mining.`,
        action:    'Sois prudent(e) sur les positions longues. Sur Nexo, tu peux mettre une partie en stablecoin pour éviter la baisse.',
        gain:      'Réduire son exposition peut éviter des pertes de 15-30% lors de capitulations de mineurs.',
        risk:      'Les mineurs peuvent aussi migrer vers des régions moins chères — ce n\'est pas toujours négatif.',
      }
    : {
        metaphor:  'Comme une usine qui tourne à vitesse normale...',
        situation: `Le réseau de mining est stable (${hashFmt}, difficulté ${diffFmt}).`,
        action:    'Continue ton plan habituel. Pas de signal mining directionnel.',
        gain:      'La stabilité du mining est un signe de santé du réseau.',
        risk:      'La stabilité peut masquer des changements à venir.',
      }

  return { signal, trend, description_novice: descriptionNovice }
}

// ── Interprétation Expert : Exchange Flows CryptoQuant ───────────────────────

/**
 * Interprétation actionnable des exchange flows CryptoQuant pour la couche Expert.
 * Retourne un message explicatif si la clé API est absente (flow === null).
 *
 * @param {{
 *   netflow: number,
 *   netflow24h: number,
 *   direction: string,
 *   signal: 'bullish'|'bearish'|'neutral',
 *   asset: string
 * }|null} flow — résultat de getExchangeFlows()
 * @returns {{ action: string, bias: string, netflow?: number, netflow24h?: number, direction?: string, available: boolean }}
 */
export function interpretExchangeFlowsExpert(flow) {
  if (!flow) {
    return {
      action:    'Exchange flows non disponibles. ' +
                 'Ajouter VITE_CRYPTOQUANT_API_KEY dans .env pour activer.',
      bias:      'neutral',
      available: false,
    }
  }

  const { netflow, netflow24h, direction, signal, asset } = flow
  const absNetflow = Math.abs(netflow24h)
  const sign = netflow24h < 0 ? '-' : '+'
  let action = ''

  if (signal === 'bullish') {
    action =
      `Outflow net ${sign}${absNetflow.toFixed(0)} ` +
      `${asset} sur 24h — actifs quittent les exchanges. ` +
      `Accumulation en cours. ` +
      `Signal haussier structurel — ` +
      `réduire les shorts ou renforcer les longs.`
  } else if (signal === 'bearish') {
    action =
      `Inflow net ${sign}${absNetflow.toFixed(0)} ` +
      `${asset} sur 24h — actifs arrivent sur les exchanges. ` +
      `Pression de vente potentielle. ` +
      `Surveiller pour réduction des longs.`
  } else {
    action =
      `Exchange flows équilibrés ` +
      `(${netflow > 0 ? '+' : ''}${netflow.toFixed(0)} ${asset}/h). ` +
      `Pas de signal directionnel.`
  }

  return {
    action,
    bias:      signal,
    netflow,
    netflow24h,
    direction,
    available: true,
  }
}

// ── Interprétations Expert ────────────────────────────────────────────────────

/**
 * Interprétation actionnable du mempool pour la couche Expert.
 * @param {{ txCount: number|null, congestion: string, fastFee: number|null }} mempool
 * @returns {{ action: string, contextLabel: string, isAnormal: boolean }|null}
 */
export function interpretMempoolExpert(mempool) {
  if (!mempool) return null

  const { txCount, congestion, fastFee } = mempool
  const emptyTxCount = ONCHAIN_SIGNALS.mempool.emptyTxCount
  const criticalTxCount = ONCHAIN_SIGNALS.mempool.criticalTxCount

  let action = null

  if (txCount != null && txCount < emptyTxCount) {
    action =
      `Mempool vide (${txCount.toLocaleString('fr-FR')} tx) ` +
      `— activité anormalement basse. ` +
      `Précède souvent un mouvement de prix. ` +
      `Fees < 2 sat/vB suffisants.`
  } else if (txCount != null && txCount > criticalTxCount) {
    action =
      `Mempool congestionné ` +
      `(${txCount.toLocaleString('fr-FR')} tx · ` +
      `${fastFee} sat/vB urgent). ` +
      `Activité on-chain intense — whale ou retail en mouvement.`
  } else {
    const txFmt  = txCount != null ? txCount.toLocaleString('fr-FR') : '—'
    const feeFmt = fastFee != null ? `${fastFee}` : '—'
    action =
      `Mempool normal ` +
      `(${txFmt} tx · fees ${feeFmt} sat/vB). ` +
      `Réseau sous charge standard.`
  }

  const isAnormal = txCount != null && (txCount < emptyTxCount || txCount > criticalTxCount)

  const contextLabel = txCount == null ? 'Inconnu'
    : txCount < 5_000   ? 'Anormalement vide'
    : txCount > 100_000 ? 'Congestionné'
    : 'Normal'

  return { action, contextLabel, isAnormal, bias: isAnormal && txCount > 100_000 ? 'bullish' : 'neutral' }
}

/**
 * Interprétation actionnable du Fear & Greed Index pour la couche Expert.
 * @param {{ value: number, label: string, delta: number|null, deltaLabel: string|null }} fg
 * @returns {{ action: string, bias: string, value: number, label: string, delta: number|null }|null}
 */
export function interpretFearGreedExpert(fg) {
  if (!fg) return null

  const { value, label, delta } = fg
  const fg_cfg = ONCHAIN_SIGNALS.fearGreed

  let action = null
  let bias   = 'neutral'

  if (value <= fg_cfg.extremeFear) {
    bias   = 'bullish'
    action =
      `Fear & Greed ${value} (${label}). ` +
      `Zone d'accumulation historique. ` +
      `Long spot ou long calls OTM avec stop -8% sous support.`
  } else if (value <= fg_cfg.fear) {
    bias   = 'bullish'
    action =
      `Fear & Greed ${value} (${label}). ` +
      `Sentiment négatif — biais haussier contrarian. ` +
      `Puts OTM bon marché pour protection.`
  } else if (value <= fg_cfg.neutral) {
    bias   = 'neutral'
    action =
      `Fear & Greed ${value} (${label}). ` +
      `Pas d'edge directionnel. ` +
      `Se concentrer sur IV et Funding.`
  } else if (value <= fg_cfg.greed) {
    bias   = 'bearish'
    action =
      `Fear & Greed ${value} (${label}). ` +
      `Zone de prudence — réduire exposition longue. ` +
      `Vendre calls OTM ou short perp léger.`
  } else {
    bias   = 'bearish'
    action =
      `Fear & Greed ${value} (Extreme Greed). ` +
      `Zone de distribution historique. ` +
      `Short perp ou achat puts ATM contre le sentiment euphorique.`
  }

  if (delta != null && Math.abs(delta) >= fg_cfg.significantDelta) {
    action +=
      ` Variation 24h : ${fg.deltaLabel} ` +
      `— momentum ${delta > 0 ? 'haussier' : 'baissier'}.`
  }

  return { action, bias, value, label, delta }
}

/**
 * Interprétation actionnable des transactions whales pour la couche Expert.
 * @param {{ transactions: Array, count: number, totalBTC: number }|null} whales
 * @param {number|null} [spotPrice]
 * @returns {{ action: string, bias: string, count: number, totalBTC: number }}
 */
export function interpretWhalesExpert(whales, spotPrice) {
  if (!whales?.transactions?.length) {
    return {
      action:   'Aucune transaction whale > 100 BTC dans le mempool actuellement.',
      bias:     'neutral',
      count:    0,
      totalBTC: 0,
    }
  }

  const txs      = whales.transactions
  const topTx    = txs[0]
  const totalBTC = whales.totalBTC
  const bearish  = txs.filter(t => t.signal?.bias === 'bearish').length
  const bias     = bearish > txs.length * 0.6 ? 'bearish' : 'neutral'

  const totalUSD = spotPrice
    ? `$${(totalBTC * spotPrice / 1_000_000).toFixed(0)}M`
    : `${totalBTC.toFixed(0)} BTC`

  let action =
    `${txs.length} whale tx en attente · ` +
    `Total : ${totalUSD}. `

  if (topTx) {
    action += `Plus grosse : ${topTx.totalBTC.toFixed(0)} BTC — ${topTx.signal.expert}. `
  }

  if (bias === 'bearish') {
    action +=
      `Pattern de distribution dominant — ` +
      `surveiller pour short ou réduction long.`
  } else {
    action += `Pas de signal directionnel clair.`
  }

  return { action, bias, count: txs.length, totalBTC }
}

/**
 * Interprétation actionnable du hash rate pour la couche Expert.
 * @param {{ currentHashrate: number }|null} hashRate
 * @param {{ hashrates: Array<{ hashrate_ehs: number }> }|null} history
 * @returns {{ action: string, bias: string, current: number|null, variation7d: number|null }}
 */
export function interpretHashRateExpert(hashRate, history) {
  if (!hashRate?.currentHashrate) {
    return { action: 'Hash rate non disponible.', bias: 'neutral', current: null, variation7d: null }
  }

  const current = hashRate.currentHashrate
  let variation7d = null

  if (history?.hashrates?.length >= 7) {
    const week7ago = history.hashrates[history.hashrates.length - 7]?.hashrate_ehs
    if (week7ago && week7ago > 0) {
      variation7d = ((current - week7ago) / week7ago) * 100
    }
  }

  let action = `Hash Rate : ${current.toFixed(0)} EH/s`

  if (variation7d != null) {
    const sign = variation7d > 0 ? '+' : ''
    action += ` (${sign}${variation7d.toFixed(1)}% sur 7j)`
  }

  const bullishThreshold = ONCHAIN_SIGNALS.hashRate.bullish
  const bearishThreshold = ONCHAIN_SIGNALS.hashRate.bearish

  let bias = 'neutral'
  if (variation7d != null && variation7d > bullishThreshold) {
    bias    = 'bullish'
    action +=
      `. Mineurs en expansion — confiance long terme dans le prix. ` +
      `Signal haussier structurel.`
  } else if (variation7d != null && variation7d < bearishThreshold) {
    bias    = 'bearish'
    action +=
      `. Hash rate en baisse — mineurs sous pression. ` +
      `Surveiller capitulation possible.`
  } else {
    action +=
      `. Hash rate stable — réseau sécurisé, pas de signal directionnel.`
  }

  return { action, bias, current, variation7d }
}

// ── Signal composite ──────────────────────────────────────────────────────────

/**
 * Synthétise les 3 signaux on-chain en un signal composite.
 *
 * @param {ReturnType<typeof detectExchangeFlowSignal>}  flowSignal
 * @param {ReturnType<typeof detectMempoolSignal>}       mempoolSignal
 * @param {ReturnType<typeof detectMinerSignal>}         minerSignal
 * @param {number} onChainScore — score 0-100 calculé par normalizeOnChain
 * @returns {{
 *   score: number,
 *   expert: string,
 *   novice: { metaphor, situation, action, gain, risk },
 *   action_expert: string,
 *   action_novice: string
 * }}
 */
export function compositeOnChainSignal(flowSignal, mempoolSignal, minerSignal, onChainScore) {
  const score = onChainScore ?? 50

  // ── Synthèse experte ──────────────────────────────────────────────────────

  const flowPart = flowSignal?.signal === 'ACCUMULATION'
    ? `Outflow exchange ${flowSignal.strength} (accumulateurs actifs)`
    : flowSignal?.signal === 'DISTRIBUTION'
    ? `Inflow exchange ${flowSignal.strength} (pression vendeuse)`
    : 'Flux exchange neutre'

  const mempoolPart = mempoolSignal?.signal === 'CRITICAL'
    ? 'Mempool critique — momentum imminent possible'
    : mempoolSignal?.signal === 'CONGESTED'
    ? 'Réseau congestionné — activité élevée'
    : 'Mempool calme'

  const minerPart = minerSignal?.signal === 'BULLISH'
    ? 'Mineurs en expansion (+HR)'
    : minerSignal?.signal === 'BEARISH'
    ? 'Mineurs en repli (-HR)'
    : 'Mining stable'

  const expert = `[On-Chain Score: ${score}/100] ${flowPart} | ${mempoolPart} | ${minerPart}.`

  const favorable = ONCHAIN_SIGNALS.scoreInterpretation.favorable
  const neutral_score = ONCHAIN_SIGNALS.scoreInterpretation.neutral

  const actionExpert = score >= favorable
    ? 'Contexte on-chain favorable : renforcer positions longues ou vendre des puts OTM. Surveiller le funding rate pour confirmation.'
    : score >= neutral_score
    ? 'Signal on-chain neutre à légèrement positif : maintenir positions actuelles, pas d\'augmentation de levier recommandée.'
    : 'Contexte on-chain dégradé : réduire exposition, envisager des hedges via options puts ou stablecoin partiel.'

  // ── Synthèse novice ───────────────────────────────────────────────────────

  const novice_cfg = ONCHAIN_SIGNALS.scoreInterpretationNovice
  const noviceBias = score >= novice_cfg.positive ? 'positif' : score >= novice_cfg.neutral ? 'neutre' : 'négatif'
  const novice = {
    metaphor:  score >= novice_cfg.positive
      ? 'Comme si les "gros joueurs" préparaient discrètement un grand achat...'
      : score >= novice_cfg.neutral
      ? 'Comme un marché calme où tout le monde attend le prochain signal...'
      : 'Comme si les investisseurs avertis commençaient à sortir discrètement...',
    situation: `Le bilan on-chain est ${noviceBias} (score ${score}/100). ${flowPart.toLowerCase()}, ${mempoolPart.toLowerCase()}.`,
    action:    score >= novice_cfg.positive
      ? 'C\'est un bon moment pour commencer ou renforcer une position sur Binance avec un ordre limite sous le prix actuel.'
      : score >= novice_cfg.neutral
      ? 'Pas d\'urgence — continue ton DCA habituel sur Binance ou Nexo sans changer ta stratégie.'
      : 'Sois prudent(e) : ne mets pas de grosses sommes maintenant. Sur Nexo, convertis une partie en USDC pour sécuriser.',
    gain:      score >= novice_cfg.positive
      ? 'Un bon timing on-chain peut améliorer ton point d\'entrée de 5-15%.'
      : score >= novice_cfg.neutral
      ? 'Rester constant dans un marché neutre évite de mauvais timings émotionnels.'
      : 'Sécuriser pendant un signal négatif peut protéger 10-25% de ton portefeuille.',
    risk:      'Les signaux on-chain sont des indicateurs de tendance, pas des prédictions certaines. Ne mets jamais plus que ce que tu peux te permettre de perdre.',
  }

  const actionNovice = score >= novice_cfg.positive
    ? `Achète progressivement sur Binance (pas tout d\'un coup) et active une alerte de prix.`
    : score >= novice_cfg.neutral
    ? `Continue ton plan habituel sur Nexo ou Binance — pas de décision urgente.`
    : `Sécurise une partie en USDC sur Nexo et attends une amélioration des signaux.`

  return { score, expert, novice, action_expert: actionExpert, action_novice: actionNovice }
}
