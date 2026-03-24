/**
 * data_processing/signals/settlement_tracker.js
 *
 * Capture automatique des settlements quotidiens Deribit à 08:00 UTC.
 *
 * Deux cas gérés :
 *   1. App ouverte au moment du settlement → détection via setInterval 30s
 *   2. App ouverte après 08:00 UTC → vérification au démarrage (_checkMissedSettlement)
 *
 * Chaque entrée est hashée (fnv1a) pour audit et déduplication.
 * Persistance dans IndexedDB via idb-keyval.
 * Aucun appel API supplémentaire au-delà de getDailySettlement.
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a } from '../data/data_store/cache.js'
import { getDailySettlement } from '../data/providers/deribit.js'
import { calculateMaxPainByExpiry } from '../core/volatility/max_pain.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const IDB_KEY_BTC         = 'settlement_history_BTC'
const IDB_KEY_ETH         = 'settlement_history_ETH'
const MAX_HISTORY         = 365      // 1 an de settlements
const SETTLEMENT_UTC_HOUR = 8        // 08:00 UTC Deribit

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retourne la clé du jour courant au format 'YYYY-MM-DD' (UTC).
 * @returns {string}
 */
function _todaySettlementKey() {
  const now = new Date()
  return `${now.getUTCFullYear()}-` +
    `${String(now.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getUTCDate()).padStart(2, '0')}`
}

function _idbKey(asset) {
  return asset === 'BTC' ? IDB_KEY_BTC : IDB_KEY_ETH
}

// ── Vérification au démarrage ─────────────────────────────────────────────────

/**
 * Vérifie si le settlement du jour a déjà été capturé.
 * Si non → tente la capture avec flag `late: true`.
 * @private
 */
async function _checkMissedSettlement(getSpot, getIVRank, getInstruments) {
  const today = _todaySettlementKey()
  const now   = new Date()

  // Ne capturer que si on est après 08:00 UTC (le settlement a eu lieu)
  if (now.getUTCHours() < SETTLEMENT_UTC_HOUR) return

  for (const asset of ['BTC', 'ETH']) {
    try {
      const history = await getSettlementHistory(asset, 5)
      const alreadyCaptured = history.some(s => s.dateKey === today)
      if (!alreadyCaptured) {
        await captureSettlement(asset, getSpot, getIVRank, getInstruments, { late: true })
      }
    } catch (_) {}
  }
}

// ── Watcher ───────────────────────────────────────────────────────────────────

/**
 * Démarre la surveillance du settlement quotidien.
 *
 * - Vérifie au démarrage si un settlement du jour a été manqué
 * - Surveille toutes les 30s la fenêtre 08:00:00–08:00:59 UTC
 *
 * @param {(asset: string) => number|null} getSpot           — prix spot actuel
 * @param {(asset: string) => number|null} getIVRank         — IV rank actuel (0–100)
 * @param {(asset: string) => Array}       getInstruments    — liste d'instruments OI bruts
 * @returns {() => void} cleanup — stoppe le watcher
 */
export function setupSettlementWatcher(getSpot, getIVRank, getInstruments) {
  // Vérifier au démarrage si le settlement du jour a été manqué
  _checkMissedSettlement(getSpot, getIVRank, getInstruments)

  // Watcher toutes les 30 secondes pour détecter 08:00 UTC exactement
  const interval = setInterval(() => {
    const now    = new Date()
    const utcH   = now.getUTCHours()
    const utcMin = now.getUTCMinutes()

    // Fenêtre de capture : 08:00:00 → 08:00:59 UTC
    if (utcH === SETTLEMENT_UTC_HOUR && utcMin === 0) {
      captureSettlement('BTC', getSpot, getIVRank, getInstruments)
      captureSettlement('ETH', getSpot, getIVRank, getInstruments)
    }
  }, 30_000)

  return () => clearInterval(interval)
}

// ── Capture ───────────────────────────────────────────────────────────────────

/**
 * Capture le settlement Deribit du jour pour un asset.
 * Enrichit avec le contexte de marché (spot, IV rank, Max Pain).
 * Hashé avec fnv1a pour audit. Dédupliqué par dateKey.
 *
 * @param {'BTC'|'ETH'} asset
 * @param {(asset: string) => number|null} getSpot
 * @param {(asset: string) => number|null} getIVRank
 * @param {(asset: string) => Array}       getInstruments
 * @param {{ late?: boolean }} options
 * @returns {Promise<object|null>}
 */
export async function captureSettlement(
  asset,
  getSpot,
  getIVRank,
  getInstruments,
  options = {}
) {
  try {
    // 1. Récupérer le settlement price Deribit
    const settlement = await getDailySettlement(asset)
    if (!settlement) return null

    // 2. Contexte de marché au même instant
    const spotPrice   = getSpot(asset) ?? null
    const ivRank      = getIVRank(asset) ?? null
    const instruments = getInstruments(asset) ?? []

    // 3. Écart settlement vs spot
    const spotDeltaPct = spotPrice != null
      ? ((settlement.settlementPrice - spotPrice) / spotPrice * 100)
      : null

    // 4. Écart settlement vs Max Pain (prochaine échéance)
    let maxPainDeltaPct = null
    let maxPainStrike   = null

    if (instruments.length > 0 && spotPrice != null) {
      try {
        const mpByExpiry = calculateMaxPainByExpiry(instruments, spotPrice)
        const nextExpiry = mpByExpiry[0]
        if (nextExpiry?.maxPainStrike) {
          maxPainStrike   = nextExpiry.maxPainStrike
          maxPainDeltaPct = (
            (settlement.settlementPrice - maxPainStrike) / maxPainStrike * 100
          )
        }
      } catch (err) {
        console.warn('[captureSettlement] MaxPain error:', err)
      }
    }

    // 5. Construire l'entrée
    const dateKey     = _todaySettlementKey()
    const capturedAt  = Date.now()

    const entry = {
      // ── Identification ──
      asset,
      dateKey,
      capturedAt,
      settlementTimestamp: settlement.timestamp,

      // ── Prix ──
      settlementPrice: settlement.settlementPrice,
      settlementDate:  settlement.date,     // date originale Deribit (ex: '14 Mar 25')

      // ── Vs spot ──
      spotPrice,
      spotDeltaPct,
      spotDeltaLabel: spotDeltaPct != null
        ? `${spotDeltaPct > 0 ? '+' : ''}${spotDeltaPct.toFixed(2)}%`
        : null,

      // ── Vs Max Pain ──
      maxPainStrike,
      maxPainDeltaPct,
      maxPainDeltaLabel: maxPainDeltaPct != null
        ? `${maxPainDeltaPct > 0 ? '+' : ''}${maxPainDeltaPct.toFixed(2)}%`
        : null,

      // ── IV au fixing ──
      ivRank,

      // ── Flags ──
      isLate: options.late ?? false,
      source: 'deribit',

      // ── Hash (calculé ci-dessous) ──
      hash: null,
    }

    // 6. Hash sur toutes les données sauf capturedAt (reproductible)
    const { capturedAt: _ca, hash: _h, ...hashable } = entry
    entry.hash = fnv1a(JSON.stringify(hashable))

    // 7. Persistance avec déduplication par dateKey
    const history = (await idbGet(_idbKey(asset))) ?? []
    const alreadyExists = history.some(s => s.dateKey === dateKey)

    if (alreadyExists) {
      return { ...entry, isDuplicate: true }
    }

    history.push(entry)
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY)
    }

    await idbSet(_idbKey(asset), history)

    console.log(
      `[Settlement] ${asset} capturé` +
      ` $${entry.settlementPrice.toLocaleString('en-US')}` +
      ` · hash: ${entry.hash}` +
      (entry.isLate ? ' (late)' : '')
    )

    return { ...entry, isDuplicate: false }

  } catch (err) {
    console.error(`[captureSettlement] ${asset} error:`, err)
    return null
  }
}

// ── Lecture ───────────────────────────────────────────────────────────────────

/**
 * Retourne l'historique des settlements pour un asset.
 * @param {'BTC'|'ETH'} asset
 * @param {number} [limit=30]
 * @returns {Promise<Array>} plus récent en premier
 */
export async function getSettlementHistory(asset, limit = 30) {
  try {
    const history = (await idbGet(_idbKey(asset))) ?? []
    return history.slice(-limit).reverse()
  } catch (_) {
    return []
  }
}

/**
 * Retourne le settlement d'une date précise.
 * @param {'BTC'|'ETH'} asset
 * @param {string} dateKey format 'YYYY-MM-DD'
 * @returns {Promise<object|null>}
 */
export async function getSettlementByDate(asset, dateKey) {
  try {
    const history = await getSettlementHistory(asset, 365)
    return history.find(s => s.dateKey === dateKey) ?? null
  } catch (_) {
    return null
  }
}

/**
 * Retourne le settlement correspondant à un hash (BTC + ETH).
 * @param {string} hash
 * @returns {Promise<object|null>}
 */
export async function getSettlementByHash(hash) {
  try {
    const [btc, eth] = await Promise.all([
      getSettlementHistory('BTC', 365),
      getSettlementHistory('ETH', 365),
    ])
    return [...btc, ...eth].find(s => s.hash === hash) ?? null
  } catch (_) {
    return null
  }
}

/**
 * Efface l'historique d'un asset.
 * @param {'BTC'|'ETH'} asset
 */
export async function clearSettlementHistory(asset) {
  try {
    await idbSet(_idbKey(asset), [])
  } catch (_) {}
}
