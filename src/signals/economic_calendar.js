/**
 * signals/economic_calendar.js
 *
 * Récupère le calendrier des annonces macro "High" importance
 * depuis le flux public Forex Factory (aucune clé API requise).
 *
 * Sources :
 *   https://nfs.faireconomy.media/ff_calendar_thisweek.json
 *   https://nfs.faireconomy.media/ff_calendar_nextweek.json
 *
 * Cache localStorage : 1 heure (CACHE_TTL)
 * En cas d'erreur réseau, retourne le cache précédent ou []
 */

const FF_BASE_URL  = 'https://nfs.faireconomy.media'
const CACHE_KEY    = 'veridex_eco_calendar'
const CACHE_TTL    = 60 * 60 * 1_000  // 1 heure
const TIMEOUT_MS   = 10_000

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Détecte si une date UTC (en ms) est en heure d'été US (EDT = UTC-4).
 * EDT : 2e dimanche de mars → 1er dimanche de novembre.
 */
function _isUSEDT(dateMs) {
  const d = new Date(dateMs)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() // 0-based

  if (m < 2 || m > 10) return false   // jan, fév, nov, déc → EST
  if (m > 2 && m < 10) return true    // avr-oct → EDT

  if (m === 2) {
    // Début EDT : 2e dimanche de mars
    const dow = new Date(Date.UTC(y, 2, 1)).getUTCDay()
    const secondSun = (dow === 0 ? 1 : 8 - dow) + 7
    return d.getUTCDate() >= secondSun
  }
  // m === 10 : fin EDT → 1er dimanche de novembre
  const dow = new Date(Date.UTC(y, 10, 1)).getUTCDay()
  const firstSun = dow === 0 ? 1 : 8 - dow
  return d.getUTCDate() < firstSun
}

/**
 * Convertit une chaîne heure ET (ex: "8:30am", "2:00pm", "All Day") en ms depuis minuit.
 * Retourne null si l'heure ne peut pas être parsée (ex: "All Day", "Tentative").
 */
function _parseTimeMs(timeStr) {
  if (!timeStr) return null
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(timeStr.trim())
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ampm = m[3].toLowerCase()
  if (ampm === 'pm' && h !== 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return (h * 60 + min) * 60 * 1_000
}

/**
 * Mappe l'impact FF ("High", "Medium", "Low", "Holiday") sur un entier 0–3.
 */
function _impactLevel(impact) {
  switch ((impact ?? '').toLowerCase()) {
    case 'high':    return 3
    case 'medium':  return 2
    case 'low':     return 1
    default:        return 0
  }
}

/**
 * Normalise un événement Forex Factory au format interne.
 *
 * FF format :
 *   { title, country, date, time, impact, forecast, previous, actual }
 *
 * - `date` : ISO-8601 UTC minuit (ex: "2025-03-07T00:00:00.000Z")
 * - `time` : heure US Eastern (ex: "8:30am") — peut être "All Day" ou absent
 *
 * @param {object} ev
 * @returns {{ ts: number|null, date: string, country: string, currency: string,
 *             event: string, importance: number, actual: string|null,
 *             previous: string|null, forecast: string|null }}
 */
function _normalize(ev) {
  const dateStr  = ev.date  ?? null
  const timeStr  = ev.time  ?? null
  const dateMs   = dateStr  ? new Date(dateStr).getTime() : null
  const timeMs   = _parseTimeMs(timeStr)

  let ts = null
  if (dateMs != null && timeMs != null) {
    const offsetMs = (_isUSEDT(dateMs) ? 4 : 5) * 3_600_000
    ts = dateMs + timeMs + offsetMs
  } else if (dateMs != null) {
    // Événements "All Day" : utiliser minuit UTC de la date
    ts = dateMs
  }

  return {
    ts,
    date:       dateStr ?? '',
    country:    ev.country   ?? '?',
    currency:   ev.country   ?? '?',   // FF utilise "country" = code devise (USD, EUR…)
    event:      ev.title     ?? '?',
    importance: _impactLevel(ev.impact),
    actual:     ev.actual    != null && ev.actual    !== '' ? String(ev.actual)   : null,
    previous:   ev.previous  != null && ev.previous  !== '' ? String(ev.previous) : null,
    forecast:   ev.forecast  != null && ev.forecast  !== '' ? String(ev.forecast) : null,
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
 * Charge un flux FF (thisweek ou nextweek) avec timeout.
 * Retourne [] en cas d'erreur.
 */
async function _fetchFeed(url) {
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
 * Interroge les flux publics Forex Factory pour obtenir le calendrier
 * de la semaine courante et de la semaine suivante.
 * Filtre uniquement les événements High importance (importance >= 3).
 * Déduplique par clé ts|currency|event.
 * Retourne [] silencieusement en cas d'erreur totale.
 *
 * @returns {Promise<Array>}
 */
export async function fetchEconomicCalendar() {
  const [thisWeek, nextWeek] = await Promise.all([
    _fetchFeed(`${FF_BASE_URL}/ff_calendar_thisweek.json`),
    _fetchFeed(`${FF_BASE_URL}/ff_calendar_nextweek.json`),
  ])

  const seen = new Set()
  const events = []

  for (const raw of [...thisWeek, ...nextWeek]) {
    const ev = _normalize(raw)
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
 * sinon fetch depuis Forex Factory et met à jour le cache.
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
