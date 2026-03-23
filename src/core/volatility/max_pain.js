/**
 * data_processing/volatility/max_pain.js
 *
 * Calcul du Max Pain par échéance à partir des données OI Deribit.
 *
 * PRINCIPE FONDAMENTAL — STRIKES RÉELS UNIQUEMENT :
 * Le Max Pain retourné est TOUJOURS un strike présent dans les
 * instruments Deribit passés en paramètre.
 * Jamais interpolé, jamais arrondi. Assertion explicite.
 *
 * Source des données : get_book_summary_by_currency (déjà en cache via dOI.raw)
 * Aucun appel API supplémentaire.
 */

// ── Parsing ───────────────────────────────────────────────────────────────────

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}

/**
 * Parse un nom d'instrument Deribit.
 * Format attendu : BTC-29MAR24-70000-C ou ETH-28JUN24-3500-P
 *
 * @param {string} name
 * @returns {{ asset, expiry, expiryStr, strike, optionType, daysToExpiry } | null}
 */
export function parseInstrument(name) {
  if (!name || typeof name !== 'string') return null

  const parts = name.split('-')
  if (parts.length < 4) return null

  const asset      = parts[0]
  const expiryStr  = parts[1]
  const strike     = Number(parts[2])
  const optionType = parts[3] === 'C' ? 'call' : 'put'

  if (isNaN(strike) || strike <= 0) return null

  const day   = parseInt(expiryStr.slice(0, 2))
  const month = MONTHS[expiryStr.slice(2, 5)]
  const year  = 2000 + parseInt(expiryStr.slice(5, 7))

  if (isNaN(day) || month === undefined || isNaN(year)) return null

  // Deribit expire à 08:00 UTC exactement
  const expiry = new Date(Date.UTC(year, month, day, 8, 0, 0))

  return {
    asset,
    expiry,
    expiryStr,
    strike,
    optionType,
    daysToExpiry: Math.max(0, (expiry.getTime() - Date.now()) / 86400000),
  }
}

// ── Calcul Max Pain ───────────────────────────────────────────────────────────

/**
 * Calcule le Max Pain pour un ensemble d'instruments d'une même échéance.
 *
 * RÈGLE CRITIQUE : le résultat est TOUJOURS l'un des strikes extraits
 * des instruments réels passés en paramètre. Aucune interpolation.
 *
 * @param {Array<{ name?: string, instrument_name?: string, open_interest?: number, oi?: number }>} instruments
 * @param {number} spotPrice
 * @returns {object|null}
 */
export function calculateMaxPain(instruments, spotPrice) {
  if (!instruments?.length || !spotPrice) return null

  // ── Étape 1 : Grouper OI par strike réel ──────────────────────────────────
  const byStrike = {}

  for (const inst of instruments) {
    // Accepte inst.name (format normalisé) ou inst.instrument_name (format Deribit brut)
    const name = inst.name ?? inst.instrument_name
    const parsed = parseInstrument(name)
    if (!parsed) continue

    const s  = parsed.strike
    const oi = Number(
      inst.openInterest ??
      inst.open_interest ??
      inst.oi ?? 0
    )

    if (!byStrike[s]) byStrike[s] = { callOI: 0, putOI: 0 }

    if (parsed.optionType === 'call') {
      byStrike[s].callOI += oi
    } else {
      byStrike[s].putOI += oi
    }
  }

  // Strikes réels triés — le Max Pain sera obligatoirement l'un d'eux
  const strikes = Object.keys(byStrike)
    .map(Number)
    .filter(s => s > 0)
    .sort((a, b) => a - b)

  if (strikes.length === 0) return null

  // ── Étape 2 : Calculer la douleur par strike ──────────────────────────────
  // Pour chaque strike candidat S :
  // Douleur = Σ OI_call_k × max(0, S-k) + Σ OI_put_k × max(0, k-S)

  const painByStrike = strikes.map(candidate => {
    let pain = 0

    for (const strike of strikes) {
      const { callOI, putOI } = byStrike[strike]

      if (candidate > strike && callOI > 0) {
        pain += (candidate - strike) * callOI
      }

      if (candidate < strike && putOI > 0) {
        pain += (strike - candidate) * putOI
      }
    }

    return { strike: candidate, pain }
  })

  // ── Étape 3 : Identifier le Max Pain ──────────────────────────────────────
  const minPain = Math.min(...painByStrike.map(p => p.pain))

  // En cas d'égalité → strike le plus proche du spot (comportement Deribit)
  const candidates = painByStrike.filter(p => p.pain === minPain)
  const maxPainStrike = candidates.reduce((best, cur) =>
    Math.abs(cur.strike - spotPrice) < Math.abs(best.strike - spotPrice)
      ? cur : best
  ).strike

  // ── Étape 4 : Assertion de fiabilité ──────────────────────────────────────
  const validStrikes = new Set(strikes)

  if (!validStrikes.has(maxPainStrike)) {
    console.error(
      `[MaxPain] ERREUR : strike ${maxPainStrike} absent des instruments réels. ` +
      `Strikes disponibles : ${strikes.join(', ')}`
    )
    return null
  }

  // ── Étape 5 : Métriques complémentaires ───────────────────────────────────
  const maxPainIndex = strikes.indexOf(maxPainStrike)

  const nearestStrikes = {
    below: maxPainIndex > 0 ? strikes[maxPainIndex - 1] : null,
    above: maxPainIndex < strikes.length - 1 ? strikes[maxPainIndex + 1] : null,
  }

  const tensionZone = {
    low:      nearestStrikes.below ?? maxPainStrike,
    high:     nearestStrikes.above ?? maxPainStrike,
    widthPct: nearestStrikes.below && nearestStrikes.above
      ? ((nearestStrikes.above - nearestStrikes.below) / spotPrice * 100)
      : 0,
  }

  const distancePct   = ((maxPainStrike - spotPrice) / spotPrice) * 100

  const totalCallOI   = strikes.reduce((s, k) => s + byStrike[k].callOI, 0)
  const totalPutOI    = strikes.reduce((s, k) => s + byStrike[k].putOI, 0)

  const maxCallStrike = strikes.reduce((best, k) =>
    byStrike[k].callOI > (byStrike[best]?.callOI ?? 0) ? k : best
  , strikes[0])

  const maxPutStrike  = strikes.reduce((best, k) =>
    byStrike[k].putOI > (byStrike[best]?.putOI ?? 0) ? k : best
  , strikes[0])

  return {
    // ── Résultat principal ──
    maxPainStrike,
    isRealStrike:  true,   // confirmation explicite : strike Deribit réel ✓
    distancePct,
    direction: distancePct > 0 ? 'above' : distancePct < 0 ? 'below' : 'at',

    // ── Zone de tension ──
    nearestStrikes,
    tensionZone,

    // ── Données OI ──
    byStrike,
    strikes,
    totalCallOI,
    totalPutOI,
    putCallRatio:  totalCallOI > 0 ? totalPutOI / totalCallOI : null,
    maxCallStrike,
    maxPutStrike,

    // ── Courbe de douleur ──
    painCurve: painByStrike,

    // ── Contexte ──
    spotPrice,
    calculatedAt: Date.now(),
  }
}

// ── Calcul par échéance ───────────────────────────────────────────────────────

/**
 * Calcule le Max Pain pour toutes les échéances disponibles.
 *
 * @param {Array} allInstruments — tableau brut de get_book_summary_by_currency
 * @param {number} spotPrice
 * @returns {Array} trié par date d'expiration croissante
 */
export function calculateMaxPainByExpiry(allInstruments, spotPrice) {
  if (!allInstruments?.length || !spotPrice) return []

  const byExpiry = {}

  for (const inst of allInstruments) {
    const name   = inst.name ?? inst.instrument_name
    const parsed = parseInstrument(name)
    if (!parsed) continue

    // Exclure les échéances déjà expirées
    if (parsed.daysToExpiry < 0) continue

    const key = parsed.expiryStr
    if (!byExpiry[key]) {
      byExpiry[key] = {
        expiryStr:    key,
        expiry:       parsed.expiry,
        daysToExpiry: parsed.daysToExpiry,
        instruments:  [],
      }
    }
    byExpiry[key].instruments.push(inst)
  }

  const results = []

  for (const group of Object.values(byExpiry)) {
    // Ignorer les échéances avec moins de 5 strikes (données insuffisantes)
    const uniqueStrikes = new Set(
      group.instruments
        .map(i => parseInstrument(i.name ?? i.instrument_name)?.strike)
        .filter(Boolean)
    )

    if (uniqueStrikes.size < 5) continue

    const mp = calculateMaxPain(group.instruments, spotPrice)

    if (mp) {
      results.push({
        ...mp,
        expiryStr:    group.expiryStr,
        expiry:       group.expiry,
        daysToExpiry: group.daysToExpiry,
      })
    }
  }

  return results.sort((a, b) => a.expiry - b.expiry)
}

// ── Interprétation ────────────────────────────────────────────────────────────

/**
 * Interprète un résultat Max Pain en signal directionnel et sentiment.
 *
 * @param {object} maxPainData — résultat de calculateMaxPain
 * @param {number} spotPrice
 * @returns {object|null}
 */
export function interpretMaxPain(maxPainData, spotPrice) {
  if (!maxPainData || !spotPrice) return null

  const {
    maxPainStrike,
    distancePct,
    putCallRatio,
    tensionZone,
    daysToExpiry,
    nearestStrikes,
  } = maxPainData

  const expiryWeight = daysToExpiry
    ? Math.max(0, Math.min(1, 1 - daysToExpiry / 30))
    : 0.5

  let signal   = 'neutral'
  let strength = 'weak'

  if (Math.abs(distancePct) < 1) {
    signal   = 'neutral'
    strength = 'strong'
  } else if (distancePct > 0) {
    signal   = 'bullish'
    strength = Math.abs(distancePct) > 5 ? 'strong' : 'moderate'
  } else {
    signal   = 'bearish'
    strength = Math.abs(distancePct) > 5 ? 'strong' : 'moderate'
  }

  if (daysToExpiry > 14 && strength === 'strong') strength = 'moderate'
  if (daysToExpiry > 30) strength = 'weak'

  let sentiment = 'neutral'
  if      (putCallRatio > 1.5) sentiment = 'fearful'
  else if (putCallRatio > 1.2) sentiment = 'cautious'
  else if (putCallRatio < 0.6) sentiment = 'greedy'
  else if (putCallRatio < 0.9) sentiment = 'optimistic'

  const tensionStr = tensionZone.low && tensionZone.high && tensionZone.low !== tensionZone.high
    ? `Zone $${tensionZone.low.toLocaleString()} — $${tensionZone.high.toLocaleString()}`
    : `Strike $${maxPainStrike.toLocaleString()}`

  return {
    signal,
    strength,
    sentiment,
    expiryWeight,

    expert:
      `Max Pain $${maxPainStrike.toLocaleString()} · ` +
      `${distancePct > 0 ? '+' : ''}${distancePct?.toFixed(1)}% vs spot · ` +
      `P/C ${putCallRatio?.toFixed(2)} · ` +
      `Strike réel Deribit ✓ · ` +
      `${tensionStr} · ` +
      `${daysToExpiry?.toFixed(0)}j avant expiry`,

    novice: signal === 'bullish'
      ? `Le marché des options attire le prix vers $${maxPainStrike.toLocaleString()} ` +
        `(${Math.abs(distancePct).toFixed(1)}% au-dessus). Légère pression haussière avant l'expiration.`
      : signal === 'bearish'
      ? `Le marché des options attire le prix vers $${maxPainStrike.toLocaleString()} ` +
        `(${Math.abs(distancePct).toFixed(1)}% en dessous). Légère pression baissière avant l'expiration.`
      : `Le prix est très proche du Max Pain $${maxPainStrike.toLocaleString()}. ` +
        `Faible mouvement directif attendu avant l'expiration.`,
  }
}
