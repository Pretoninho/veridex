/**
 * signals/economic_calendar.js
 *
 * Récupère le calendrier des annonces macro "High" importance
 * depuis l'API TradingEconomics.
 *
 * Source : https://api.tradingeconomics.com/calendar
 *
 * Cache localStorage : 1 heure (CACHE_TTL)
 * En cas d'erreur réseau, retourne le cache précédent ou []
 */

const TE_BASE_URL = 'https://api.tradingeconomics.com'
const TE_API_KEY  = 'Y1t0ZJPeDAM9PbUHUUcljxZGELNZ7bra0Hjmf2HGRfrJBsBPUxu5FlJqeoavlmDObDaMB09QLz44Z'
const CACHE_KEY   = '84ab6a198c374ee:j0mgn1w2o9q0mcv'
const CACHE_TTL   = 60 * 60 * 1_000  // 1 heure
const TIMEOUT_MS  = 10_000

// ── Mapping pays → devise ────────────────────────────────────────────────────

const COUNTRY_TO_CURRENCY = {
  'united states':              'USD',
  'euro area':                  'EUR',
  'euro zone':                  'EUR',
  'european monetary union':    'EUR',
  'germany':                    'EUR',
  'france':                     'EUR',
  'italy':                      'EUR',
  'spain':                      'EUR',
  'united kingdom':             'GBP',
  'japan':                      'JPY',
  'canada':                     'CAD',
  'australia':                  'AUD',
  'new zealand':                'NZD',
  'switzerland':                'CHF',
  'china':                      'CNY',
  'hong kong':                  'HKD',
  'singapore':                  'SGD',
  'south korea':                'KRW',
  'mexico':                     'MXN',
  'brazil':                     'BRL',
  'india':                      'INR',
  'russia':                     'RUB',
  'south africa':               'ZAR',
  'norway':                     'NOK',
  'sweden':                     'SEK',
  'denmark':                    'DKK',
}

function _countryToCurrency(country) {
  if (!country) return '?'
  return COUNTRY_TO_CURRENCY[country.toLowerCase()] ?? country.slice(0, 3).toUpperCase()
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Mappe l'importance TradingEconomics (1, 2, 3) → entier 0–3.
 */
function _impactLevel(importance) {
  const n = parseInt(importance, 10)
  if (n >= 1 && n <= 3) return n
  return 0
}

/**
 * Normalise un événement TradingEconomics au format interne.
 *
 * TE format :
 *   { Date, Country, Category, Event, Importance, Actual, Previous, Forecast, TEForecast }
 *
 * - `Date` : ISO-8601 UTC sans 'Z' (ex: "2025-03-07T13:30:00")
 *
 * @param {object} ev
 * @returns {{ ts: number|null, date: string, country: string, currency: string,
 *             event: string, importance: number, actual: string|null,
 *             previous: string|null, forecast: string|null }}
 */
function _normalize(ev) {
  // TradingEconomics renvoie des dates UTC sans le suffixe 'Z'
  const dateStr = ev.Date ?? null
  let ts = null
  if (dateStr) {
    const parsed = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').getTime()
    ts = Number.isFinite(parsed) ? parsed : null
  }

  const country  = ev.Country  ?? ''
  const currency = _countryToCurrency(country)
  const forecast = ev.TEForecast ?? ev.Forecast ?? null
  const actual   = ev.Actual   ?? null
  const previous = ev.Previous ?? null

  return {
    ts,
    date:       dateStr ?? '',
    country,
    currency,
    event:      ev.Event ?? ev.Category ?? '?',
    importance: _impactLevel(ev.Importance),
    actual:     actual   != null && actual   !== '' ? String(actual)   : null,
    previous:   previous != null && previous !== '' ? String(previous) : null,
    forecast:   forecast != null && forecast !== '' ? String(forecast) : null,
  }
}

// ── Cache localStorage ────────────────────────────────────────────────────────

/**
 * Retourne les événements mis en cache + timestamp de mise à jour.
 * @returns {{ events: Array, cachedAt: number|null }}
 */
export function getCachedEconomicEvents() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return { events: [], cachedAt: null }
    const cached = JSON.parse(raw)
    return { events: cached.events ?? [], cachedAt: cached.cachedAt ?? null }
  } catch (_) {
    return { events: [], cachedAt: null }
  }
}

/**
 * Persiste les événements dans localStorage avec timestamp.
 * @param {Array} events
 */
export function cacheEconomicEvents(events) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ events, cachedAt: Date.now() }))
  } catch (_) {}
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Charge le calendrier économique TradingEconomics pour une plage de dates.
 * Retourne [] en cas d'erreur.
 */
async function _fetchFeed(d1, d2) {
  const url = `${TE_BASE_URL}/calendar/country/all/${d1}/${d2}?c=${TE_API_KEY}&f=json`
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.warn('[EconomicCalendar] fetch failed:', url, err.message)
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Formate une date en "YYYY-MM-DD".
 */
function _fmtDate(d) {
  const y  = d.getUTCFullYear()
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Interroge l'API TradingEconomics pour la semaine courante + la semaine suivante.
 * Filtre uniquement les événements High importance (importance >= 3).
 * Déduplique par clé ts|currency|event.
 * Retourne [] silencieusement en cas d'erreur totale.
 *
 * @returns {Promise<Array>}
 */
export async function fetchEconomicCalendar() {
  const now   = new Date()
  const d1    = _fmtDate(now)
  // Fenêtre de 14 jours pour couvrir la semaine courante + suivante
  const end   = new Date(now.getTime() + 14 * 24 * 3600 * 1000)
  const d2    = _fmtDate(end)

  const raw = await _fetchFeed(d1, d2)

  const seen   = new Set()
  const events = []

  for (const item of raw) {
    const ev = _normalize(item)
    if (ev.importance < 3 || ev.ts == null) continue
    const key = `${ev.ts}|${ev.currency}|${ev.event}`
    if (seen.has(key)) continue
    seen.add(key)
    events.push(ev)
  }

  return events.sort((a, b) => a.ts - b.ts)
}

/**
 * Retourne les événements du cache s'ils sont frais (< CACHE_TTL),
 * sinon fetch depuis TradingEconomics et met à jour le cache.
 *
 * @returns {Promise<Array>}
 */
export async function getEconomicEvents() {
  const { events, cachedAt } = getCachedEconomicEvents()
  if (cachedAt != null && Date.now() - cachedAt < CACHE_TTL && events.length > 0) {
    return events
  }
  const fresh = await fetchEconomicCalendar()
  // Conserver l'ancien cache si la requête a retourné [] (erreur réseau)
  if (fresh.length > 0) cacheEconomicEvents(fresh)
  return fresh.length > 0 ? fresh : events
}
