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

  // ── Étape 2 : Calculer la douleur par strike (O(N) via prefix/suffix sums) ──
  // Pour chaque strike candidat S :
  // Douleur = Σ OI_call_k × max(0, S−k) + Σ OI_put_k × max(0, k−S)
  //
  // Reformulation :
  //   callPain(S) = S × Σ_{k<S} callOI_k  −  Σ_{k<S} callOI_k × k
  //   putPain(S)  = Σ_{k>S} putOI_k × k   −  S × Σ_{k>S} putOI_k
  //
  // Les sommes sont calculées en O(N) avec des tableaux préfixe/suffixe,
  // ce qui remplace la boucle imbriquée O(N²) précédente.

  const n = strikes.length

  // Tableaux de prefix sums (exclusif) pour les calls
  const prefCallOI  = new Array(n).fill(0)
  const prefCallOIK = new Array(n).fill(0)
  for (let i = 1; i < n; i++) {
    const { callOI } = byStrike[strikes[i - 1]]
    prefCallOI[i]  = prefCallOI[i - 1]  + callOI
    prefCallOIK[i] = prefCallOIK[i - 1] + callOI * strikes[i - 1]
  }

  // Tableaux de suffix sums (exclusif) pour les puts
  const sufPutOI  = new Array(n).fill(0)
  const sufPutOIK = new Array(n).fill(0)
  for (let i = n - 2; i >= 0; i--) {
    const { putOI } = byStrike[strikes[i + 1]]
    sufPutOI[i]  = sufPutOI[i + 1]  + putOI
    sufPutOIK[i] = sufPutOIK[i + 1] + putOI * strikes[i + 1]
  }

  const painByStrike = strikes.map((candidate, i) => {
    const callPain = candidate * prefCallOI[i] - prefCallOIK[i]
    const putPain  = sufPutOIK[i] - candidate * sufPutOI[i]
    return { strike: candidate, pain: callPain + putPain }
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

// Cache d'un seul résultat pour éviter les recalculs redondants lorsque les
// données n'ont pas changé entre deux appels successifs (intervalles 15-30 s).
let _cacheKey    = null
let _cacheResult = null

/**
 * Calcule une empreinte légère d'un tableau d'instruments.
 * Combine la longueur, les noms et l'open interest pour détecter tout changement.
 * @param {Array} instruments
 * @param {number} spotPrice
 * @returns {string}
 */
function _instrumentsKey(instruments, spotPrice) {
  // Mix in length and a truncated integer representation of spot price
  const spotInt = spotPrice * 100 | 0
  let h = instruments.length ^ spotInt
  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i]
    const name = inst.name ?? inst.instrument_name ?? ''
    const oi   = Number(inst.openInterest ?? inst.open_interest ?? inst.oi ?? 0)
    // polynomial rolling hash (multiplier 33, as in djb2)
    for (let j = 0; j < name.length; j++) {
      h = (Math.imul(h, 33) + name.charCodeAt(j)) | 0
    }
    h = (Math.imul(h, 33) + (oi | 0)) | 0
  }
  return String(h)
}

/**
 * Calcule le Max Pain pour toutes les échéances disponibles.
 *
 * Les résultats sont mémoïsés : si les instruments et le spot n'ont pas changé
 * depuis le dernier appel, la valeur en cache est retournée immédiatement.
 *
 * @param {Array} allInstruments — tableau brut de get_book_summary_by_currency
 * @param {number} spotPrice
 * @returns {Array} trié par date d'expiration croissante
 */
export function calculateMaxPainByExpiry(allInstruments, spotPrice) {
  if (!allInstruments?.length || !spotPrice) return []

  const key = _instrumentsKey(allInstruments, spotPrice)
  if (key === _cacheKey) return _cacheResult

  const byExpiry = {}

  for (const inst of allInstruments) {
    const name   = inst.name ?? inst.instrument_name
    const parsed = parseInstrument(name)
    if (!parsed) continue

    // Exclure les échéances déjà expirées
    if (parsed.daysToExpiry < 0) continue

    const expiryKey = parsed.expiryStr
    if (!byExpiry[expiryKey]) {
      byExpiry[expiryKey] = {
        expiryStr:    expiryKey,
        expiry:       parsed.expiry,
        daysToExpiry: parsed.daysToExpiry,
        instruments:  [],
      }
    }
    byExpiry[expiryKey].instruments.push(inst)
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

  const sorted = results.sort((a, b) => a.expiry - b.expiry)
  _cacheKey    = key
  _cacheResult = sorted
  return sorted
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
