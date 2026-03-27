/**
 * @deprecated Ce fichier est remplacé par src/data_core/providers/deribit.js
 * Les nouvelles pages doivent importer depuis data_core ou data_processing.
 * Ce fichier est conservé pour la compatibilité des pages existantes.
 */

const API = 'https://www.deribit.com/api/v2/public'

async function apiFetch(url, timeoutMs = 15000) {
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('Timeout: ' + url.split('/').pop().split('?')[0])), timeoutMs)
  )
  const request = fetch(url).then(async r => {
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  })
  return Promise.race([request, timeout])
}

export async function getSpot(asset) {
  const d = await apiFetch(`${API}/get_index_price?index_name=${asset.toLowerCase()}_usd`)
  return d.result?.index_price ?? null
}

export async function getInstruments(asset) {
  const d = await apiFetch(`${API}/get_instruments?currency=${asset}&kind=option&expired=false`)
  return d.result ?? []
}

export async function getOrderBook(instrument, depth = 1) {
  const d = await apiFetch(`${API}/get_order_book?instrument_name=${instrument}&depth=${depth}`)
  return d.result ?? null
}

export async function getFutures(asset) {
  const d = await apiFetch(`${API}/get_instruments?currency=${asset}&kind=future&expired=false`)
  return d.result ?? []
}

export async function getFuturePrice(instrument) {
  const d = await apiFetch(`${API}/get_order_book?instrument_name=${instrument}&depth=1`)
  return d.result?.mark_price ?? null
}

export async function getATMIV(asset) {
  const spotNow = await getSpot(asset)
  if (!spotNow) throw new Error('No spot for ' + asset)
  const instruments = await getInstruments(asset)
  const timestamps = instruments.map(i => i.expiration_timestamp).filter(t => Number.isFinite(t))
  if (!timestamps.length) throw new Error('No expiry timestamps')
  const minTs = Math.min(...timestamps)
  const front = instruments.filter(i => i.expiration_timestamp === minTs)
  const callStrikes = [...new Set(front.filter(i => i.option_type === 'call').map(i => i.strike))]
  const atmS = callStrikes.reduce((p, c) => Math.abs(c - spotNow) < Math.abs(p - spotNow) ? c : p)
  const callInst = front.find(i => i.option_type === 'call' && i.strike === atmS)
  const putInst  = front.find(i => i.option_type === 'put'  && i.strike === atmS)
  const [cb, pb] = await Promise.all([
    callInst ? getOrderBook(callInst.instrument_name).catch(() => null) : Promise.resolve(null),
    putInst  ? getOrderBook(putInst.instrument_name).catch(() => null)  : Promise.resolve(null),
  ])
  const cIV = cb?.mark_iv ?? null
  const pIV = pb?.mark_iv ?? null
  if (cIV == null && pIV == null) throw new Error('No IV data')
  const iv = (cIV != null && pIV != null) ? (cIV + pIV) / 2 : (cIV ?? pIV)
  return { iv, spot: spotNow, atmStrike: atmS, expiry: new Date(minTs).toISOString() }
}

export function getAllExpiries(instruments) {
  const ts = [...new Set(instruments.map(i => i.expiration_timestamp).filter(t => Number.isFinite(t)))]
  return ts.sort((a, b) => a - b)
}

// ── Nouveaux endpoints contexte marché ──────────────────

// DVOL index (équivalent VIX pour BTC/ETH) — 30 derniers jours
export async function getDVOL(asset) {
  const end = Date.now()
  const start = end - 30 * 24 * 3600 * 1000
  const d = await apiFetch(`${API}/get_volatility_index_data?currency=${asset}&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`)
  if (!d.result?.data?.length) return null
  const data = d.result.data // [[ts, open, high, low, close], ...]
  const latest = data[data.length - 1][4] // close
  const weekAgo = data[Math.max(0, data.length - 168)]?.[4] // ~7j
  const monthMin = Math.min(...data.map(r => r[3]))
  const monthMax = Math.max(...data.map(r => r[2]))
  return { current: latest, weekAgo, monthMin, monthMax, history: data.slice(-72) } // 72h d'historique
}

// Funding rate perpetuel actuel + historique 7j
export async function getFundingRate(asset) {
  const instrument = `${asset}-PERPETUAL`
  try {
    const d = await apiFetch(`${API}/get_book_summary_by_instrument?instrument_name=${instrument}`)
    const r = d.result?.[0]
    if (!r) return null
    const currentAnn = r.funding_8h != null ? r.funding_8h * 100 * 3 * 365 : (r.current_funding != null ? r.current_funding * 100 * 3 * 365 : null)
    return { current: currentAnn, avgAnn7d: currentAnn, bullish: currentAnn != null ? currentAnn > 0 : null }
  } catch(e) { return null }
}
// Open Interest total options
export async function getOpenInterest(asset) {
  const d = await apiFetch(`${API}/get_book_summary_by_currency?currency=${asset}&kind=option`)
  if (!d.result?.length) return null
  const total = d.result.reduce((s, r) => s + (r.open_interest ?? 0), 0)
  const callOI = d.result.filter(r => r.instrument_name.endsWith('-C')).reduce((s, r) => s + (r.open_interest ?? 0), 0)
  const putOI  = d.result.filter(r => r.instrument_name.endsWith('-P')).reduce((s, r) => s + (r.open_interest ?? 0), 0)
  return { total, callOI, putOI, putCallRatio: putOI > 0 ? putOI / callOI : null }
}

// Volatilité réalisée historique (30j)
export async function getRealizedVol(asset) {
  const d = await apiFetch(`${API}/get_historical_volatility?currency=${asset}`)
  if (!d.result?.length) return null
  const data = d.result // [[ts, rv], ...]
  const latest = data[data.length - 1][1]
  const avg30 = data.slice(-30).reduce((s, r) => s + r[1], 0) / Math.min(30, data.length)
  return { current: latest, avg30 }
}

// Black-Scholes complet pour pricing précis OTM
// d1 = (ln(S/K) + (r + σ²/2)T) / (σ√T)
function normCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x)
  return 0.5 * (1 + sign * y)
}

export function blackScholes(type, S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return 0
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  if (type === 'call') return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
}
