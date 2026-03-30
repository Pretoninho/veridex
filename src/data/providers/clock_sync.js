/**
 * data_core/providers/clock_sync.js
 *
 * v2.0: Deribit-only time synchronization
 *
 * UNITÉS PAR SOURCE :
 *   Deribit  → millisecondes (ms) natif
 *
 * Référence de temps : Deribit
 */

import { getDeribitTime }  from './deribit.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const DRIFT_WARNING_MS       = 500             // alerte si |drift| > 500 ms
const DRIFT_CRITICAL_MS      = 2_000           // critique si |drift| > 2 s
const FUNDING_INTERVALS_UTC  = [0, 8, 16]      // heures UTC fixing Deribit perpetuals
const CLOCK_SYNC_LS_KEY      = 'clock_sync_history'
const MAX_HISTORY             = 10             // syncs conservées dans localStorage

export const SYNC_INTERVAL_MS = 5 * 60 * 1_000 // re-sync toutes les 5 min

// ── Statut d'une source ───────────────────────────────────────────────────────

function sourceStatus(drift) {
  if (drift == null) return 'offline'
  const abs = Math.abs(drift)
  if (abs < DRIFT_WARNING_MS)  return 'ok'
  if (abs < DRIFT_CRITICAL_MS) return 'warning'
  return 'critical'
}

// ── Historique localStorage ───────────────────────────────────────────────────

function saveToHistory(sync) {
  try {
    const raw     = localStorage.getItem(CLOCK_SYNC_LS_KEY)
    const history = raw ? JSON.parse(raw) : []
    history.push({
      syncedAt:    sync.syncedAt,
      maxDrift:    sync.maxDrift,
      driftStatus: sync.driftStatus,
    })
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
    localStorage.setItem(CLOCK_SYNC_LS_KEY, JSON.stringify(history))
  } catch { /* localStorage indisponible (navigation privée, etc.) */ }
}

// ── Utilitaires exportés ──────────────────────────────────────────────────────

/**
 * Calcule le prochain fixing funding Deribit (00:00, 08:00, 16:00 UTC).
 *
 * @returns {{
 *   nextFixing: Date,
 *   msRemaining: number,
 *   hoursRemaining: number,
 *   minutesRemaining: number
 * }}
 */
export function getNextFundingTime() {
  const now    = new Date()
  const hUtc   = now.getUTCHours()
  const mUtc   = now.getUTCMinutes()
  const sUtc   = now.getUTCSeconds()

  // Trouver la prochaine heure de fixing après maintenant
  const nextHour = FUNDING_INTERVALS_UTC.find(h => {
    if (h > hUtc) return true
    if (h === hUtc && (mUtc > 0 || sUtc > 0)) return false
    return false
  })

  const nextFixing = new Date(now)

  if (nextHour !== undefined) {
    nextFixing.setUTCHours(nextHour, 0, 0, 0)
  } else {
    // Toutes les fenêtres sont passées → prochain jour à 00:00 UTC
    nextFixing.setUTCDate(nextFixing.getUTCDate() + 1)
    nextFixing.setUTCHours(0, 0, 0, 0)
  }

  const msRemaining      = Math.max(0, nextFixing.getTime() - now.getTime())
  const hoursRemaining   = Math.floor(msRemaining / 3_600_000)
  const minutesRemaining = Math.floor((msRemaining % 3_600_000) / 60_000)

  return { nextFixing, msRemaining, hoursRemaining, minutesRemaining }
}

/**
 * Retourne le temps actuel corrigé par le drift local vs Deribit.
 * Utilisée dans les calculs de pricing pour corriger T.
 *
 * @param {object|null} clockSync — résultat de syncServerClocks()
 * @returns {number} timestamp ms
 */
export function getTimeCorrected(clockSync) {
  if (clockSync?.localDrift != null) return Date.now() + clockSync.localDrift
  return Date.now()
}

/**
 * Calcule le nombre de jours jusqu'à une expiration, corrigé par l'horloge.
 * Remplace daysUntil() partout pour les calculs de pricing options.
 *
 * @param {number} expiryTimestamp — ms
 * @param {object|null} clockSync
 * @returns {number} jours (minimum 0.001)
 */
export function getDaysUntilCorrected(expiryTimestamp, clockSync) {
  return Math.max(0.001, (expiryTimestamp - getTimeCorrected(clockSync)) / 86_400_000)
}

// ── Fonction principale ───────────────────────────────────────────────────────

/**
 * Synchronise l'horloge Deribit avec l'horloge locale.
 *
 * v2.0: Deribit-only, fallback to Date.now() if Deribit unavailable
 *
 * @returns {Promise<{
 *   syncedAt: number,
 *   sources: {
 *     deribit:  { timestamp: number|null, drift_vs_local: number|null, status: string },
 *   },
 *   maxDrift: number,
 *   driftStatus: 'ok'|'warning'|'critical',
 *   referenceTime: number,
 *   localDrift: number,
 *   staleSources: string[],
 *   nextFundingIn: number,
 *   isReliable: boolean
 * }>}
 */
export async function syncServerClocks() {
  const localNow = Date.now()

  // Appel Deribit seul
  const [deribitRes] = await Promise.allSettled([
    getDeribitTime(),
  ])

  const deribitData  = deribitRes.status  === 'fulfilled' ? deribitRes.value  : null

  // ── Référence temporelle ────────────────────────────────────────────────────
  // Deribit prioritaire → Date.now() local fallback
  const referenceTime = deribitData?.timestamp ?? localNow
  if (!deribitData) {
    console.warn('[clock_sync] Deribit hors ligne — fallback Date.now() local')
  }

  // ── Drift Deribit vs horloge locale ────────────────────────────────────────
  const deribitDrift  = deribitData != null ? deribitData.timestamp - localNow : null

  // ── maxDrift ───────────────────────────────────────────────────────────────
  const maxDrift = deribitDrift != null ? Math.abs(deribitDrift) : 0

  // ── Statut global ───────────────────────────────────────────────────────────
  const driftStatus = maxDrift >= DRIFT_CRITICAL_MS ? 'critical'
    : maxDrift >= DRIFT_WARNING_MS ? 'warning'
    : 'ok'

  // ── Sources dégradées ───────────────────────────────────────────────────────
  const staleSources = [
    deribitDrift != null && Math.abs(deribitDrift) > DRIFT_WARNING_MS ? 'deribit' : null,
  ].filter(Boolean)

  const { msRemaining } = getNextFundingTime()

  const result = {
    syncedAt:      localNow,
    sources: {
      deribit:  deribitData  != null
        ? { timestamp: deribitData.timestamp,  drift_vs_local: deribitDrift,  status: sourceStatus(deribitDrift) }
        : { timestamp: null, drift_vs_local: null, status: 'offline' },
    },
    maxDrift,
    driftStatus,
    referenceTime,
    localDrift:    referenceTime - localNow,
    staleSources,
    nextFundingIn: msRemaining,
    isReliable:    maxDrift < DRIFT_CRITICAL_MS,
  }

  saveToHistory(result)
  return result
}
