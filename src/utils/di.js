import { blackScholes, calcDIRateBS } from './api.js'

export { calcDIRateBS }

// Calcul durée précise en jours (avec heures)
export function calcDays(subscribeDate, settlementDate) {
  if (!subscribeDate || !settlementDate) return null
  const ms = new Date(settlementDate) - new Date(subscribeDate)
  return ms / 86400000 // jours décimaux
}

// Prime en natif (ETH, BTC) et USD
export function calcPremiumNative(rateAnnual, days, quantity) {
  if (!rateAnnual || !days || !quantity) return null
  return quantity * (rateAnnual / 100) * (days / 365)
}

export function calcPremiumUSD(rateAnnual, days, amountUSD) {
  if (!rateAnnual || !days || !amountUSD) return null
  return amountUSD * (rateAnnual / 100) * (days / 365)
}

// Ancien calcul gardé pour compatibilité
export function calcPremium(rateAnnual, days, amount) {
  const periodRate = rateAnnual / 100 * (days / 365)
  return amount > 0 ? amount * periodRate : null
}

export function marketPremiumPct(ivPct, days) {
  if (ivPct == null || days <= 0) return null
  const T = days / 365
  return ivPct / 100 * Math.sqrt(T) * 0.4 * 100
}

export function diScoreBS(nexoRatePct, iv, days, spot, strike, type) {
  if (!iv || !days) return null
  let marketRate
  if (spot && strike && type) {
    marketRate = calcDIRateBS(iv, spot, strike, days, type)
  } else {
    const periodPct = iv / 100 * Math.sqrt(days / 365) * 0.4 * 100
    marketRate = periodPct * (365 / days)
  }
  if (!marketRate) return null
  const nexoPeriod = nexoRatePct / 100 * (days / 365) * 100
  const mktPeriod  = marketRate / 100 * (days / 365) * 100
  return Math.min(nexoPeriod / mktPeriod, 1.5)
}

export function diScore(nexoRatePct, ivPct, days) {
  if (ivPct == null) return null
  const nexoPeriod = nexoRatePct / 100 * (days / 365) * 100
  const mktPeriod  = marketPremiumPct(ivPct, days)
  if (!mktPeriod) return null
  return Math.min(nexoPeriod / mktPeriod, 1.5)
}

export function scoreLabel(ratio) {
  if (ratio == null) return { label: 'N/A', cls: '', bar: 0 }
  if (ratio >= 0.8) return { label: 'Excellent', cls: 'great', bar: ratio }
  if (ratio >= 0.6) return { label: 'Bon',       cls: 'good',  bar: ratio }
  if (ratio >= 0.4) return { label: 'Passable',  cls: 'fair',  bar: ratio }
  return                    { label: 'Faible',    cls: 'poor',  bar: ratio }
}

export function calcPnL(offer, spotNow, dca) {
  const days  = offer.days
  const prime = calcPremiumUSD(offer.rate, days, offer.amount) ?? 0
  const primeNative = calcPremiumNative(offer.rate, days, offer.quantity) ?? 0
  if (!offer.amount) return null

  if (offer.type === 'sell-high') {
    const qty      = offer.quantity || offer.amount / offer.strike
    const refPrice = dca || spotNow
    const pnlIfExercised = refPrice
      ? (offer.strike - refPrice) * qty + prime
      : null
    const pnlPctIfExercised = refPrice && offer.amount
      ? ((offer.strike - refPrice) * qty + prime) / offer.amount * 100
      : null
    const willBeExercised = spotNow ? spotNow >= offer.strike : null
    const scenarios = spotNow ? [
      { label: 'Strike +5%',  price: offer.strike * 1.05 },
      { label: 'Strike +10%', price: offer.strike * 1.10 },
      { label: 'Strike +20%', price: offer.strike * 1.20 },
    ].map(s => ({ label: s.label, price: s.price, manque: (s.price - offer.strike) * qty })) : []
    const distPct = spotNow ? (offer.strike - spotNow) / spotNow * 100 : null
    return { type:'sell-high', qty, prime, primeNative, pnlIfExercised, pnlPctIfExercised, willBeExercised, distPct, scenarios }
  } else {
    const btcIfExercised = offer.amount / offer.strike
    const refPrice = dca || spotNow
    const pnlIfExercised = refPrice
      ? (refPrice - offer.strike) * btcIfExercised + prime
      : null
    const pnlPctIfExercised = offer.amount
      ? ((refPrice ? (refPrice - offer.strike) * btcIfExercised : 0) + prime) / offer.amount * 100
      : null
    const willBeExercised = spotNow ? spotNow <= offer.strike : null
    const distPct = spotNow ? (spotNow - offer.strike) / offer.strike * 100 : null
    const scenarios = spotNow ? [
      { label: 'Strike -5%',  price: offer.strike * 0.95 },
      { label: 'Strike -10%', price: offer.strike * 0.90 },
      { label: 'Strike -20%', price: offer.strike * 0.80 },
    ].map(s => ({ label: s.label, price: s.price, manque: (offer.strike - s.price) * btcIfExercised })) : []
    return { type:'buy-low', btcIfExercised, prime, primeNative, pnlIfExercised, pnlPctIfExercised, willBeExercised, distPct, scenarios }
  }
}

export function countdown(settlementDate) {
  if (!settlementDate) return '—'
  const msLeft = new Date(settlementDate) - Date.now()
  if (msLeft <= 0) return 'Échue'
  const dL = Math.floor(msLeft / 86400000)
  const hL = Math.floor((msLeft % 86400000) / 3600000)
  const mL = Math.floor((msLeft % 3600000) / 60000)
  return dL > 0 ? `${dL}j ${hL}h` : `${hL}h ${mL}min`
}

export function fmtUSD(n) {
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtStrike(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function fmtExpiry(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
    + ' ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) + ' UTC'
}

export function fmtDuration(days) {
  if (!days) return '—'
  const d = Math.floor(days)
  const h = Math.round((days - d) * 24)
  return h > 0 ? `${d}j ${h}h` : `${d}j`
}
