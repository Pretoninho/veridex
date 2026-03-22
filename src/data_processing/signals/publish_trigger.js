/**
 * data_processing/signals/publish_trigger.js
 *
 * Détection des événements déclencheurs de publication Twitter.
 *
 * Triggers surveillés :
 *   1. SIGNAL_STRONG      — score ≥ 80
 *   2. SIGNAL_MODERATE    — score ≥ 60
 *   3. ANOMALY            — anomalie de marché (≥3 indicateurs)
 *   4. SETTLEMENT         — settlement quotidien capturé récemment
 *   5. VOLATILITY_SPIKE   — IV Rank ≥ 80
 *
 * Anti-spam : cooldown 30 min entre publications.
 * Déduplication : les 100 derniers hashes publiés sont mémorisés.
 */

import { getSettlementHistory } from './settlement_tracker.js'
import { fnv1a } from '../../data_core/data_store/cache.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const LS_STATE_KEY     = 'publish_trigger_state'
const COOLDOWN_MS      = 30 * 60 * 1000   // 30 minutes
const MAX_HASH_HISTORY = 100

export const TRIGGER_TYPES = {
  SIGNAL_STRONG:    'SIGNAL_STRONG',
  SIGNAL_MODERATE:  'SIGNAL_MODERATE',
  ANOMALY:          'ANOMALY',
  SETTLEMENT:       'SETTLEMENT',
  VOLATILITY_SPIKE: 'VOLATILITY_SPIKE',
}

export const TRIGGER_META = {
  SIGNAL_STRONG:    { label: 'Signal Exceptionnel', color: '#00E5A0' },
  SIGNAL_MODERATE:  { label: 'Signal Favorable',    color: '#FFD700' },
  ANOMALY:          { label: 'Anomalie Marché',      color: '#FF6B35' },
  SETTLEMENT:       { label: 'Settlement',           color: '#A78BFA' },
  VOLATILITY_SPIKE: { label: 'Pic de Volatilité',   color: '#FF4D6D' },
}

// ── Persistance ───────────────────────────────────────────────────────────────

function _loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_STATE_KEY) || '{}')
  } catch (_) { return {} }
}

function _saveState(state) {
  try {
    localStorage.setItem(LS_STATE_KEY, JSON.stringify(state))
  } catch (_) {}
}

// ── Cooldown ──────────────────────────────────────────────────────────────────

function _isOnCooldown() {
  const state = _loadState()
  if (!state.lastPublishedAt) return false
  return Date.now() - state.lastPublishedAt < COOLDOWN_MS
}

// ── Déduplication ─────────────────────────────────────────────────────────────

/**
 * Vérifie si un hash a déjà été publié.
 * @param {string} hash
 * @returns {boolean}
 */
export function isAlreadyPublished(hash) {
  const state = _loadState()
  return (state.publishedHashes ?? []).includes(hash)
}

/**
 * Marque un hash comme publié et démarre le cooldown.
 * @param {string} hash
 */
export function markAsPublished(hash) {
  const state = _loadState()
  const hashes = state.publishedHashes ?? []
  if (!hashes.includes(hash)) {
    hashes.push(hash)
    if (hashes.length > MAX_HASH_HISTORY) hashes.splice(0, hashes.length - MAX_HASH_HISTORY)
  }
  _saveState({ ...state, publishedHashes: hashes, lastPublishedAt: Date.now() })
}

// ── Détection des triggers ─────────────────────────────────────────────────────

/**
 * Détecte un trigger de publication à partir du signal courant.
 * Retourne null si aucun trigger ou si cooldown actif.
 *
 * @param {{ global: number|null, scores: object }} result
 * @param {{ expert: object, noviceData: object }} interpreted
 * @param {{ dvol?: object, basisAvg?: number|null }} rawData
 * @param {string} asset
 * @returns {object|null}
 */
export function detectTrigger(result, interpreted, rawData, asset) {
  if (!result || result.global == null) return null
  if (_isOnCooldown()) return null

  const score    = result.global
  const ivRank   = interpreted?.expert?.ivRank ?? null
  const situation = interpreted?.expert?.situation ?? ''

  // Hash stable sur fenêtre de 5 minutes — évite de re-déclencher à chaque refresh
  const triggerHash = fnv1a(`${asset}|${score}|${ivRank ?? ''}|${Math.floor(Date.now() / (5 * 60 * 1000))}`)

  if (isAlreadyPublished(triggerHash)) return null

  let type = null
  if (score >= 80) {
    type = TRIGGER_TYPES.SIGNAL_STRONG
  } else if (ivRank != null && ivRank >= 80) {
    type = TRIGGER_TYPES.VOLATILITY_SPIKE
  } else if (score >= 60) {
    type = TRIGGER_TYPES.SIGNAL_MODERATE
  }

  if (!type) return null

  return {
    type,
    hash:      triggerHash,
    asset,
    score,
    ivRank,
    situation,
    label:     TRIGGER_META[type].label,
    color:     TRIGGER_META[type].color,
    ts:        Date.now(),
    marketContext: {
      asset,
      score,
      ivRank,
      funding:    interpreted?.expert?.fundingAnn ?? null,
      situation,
      recos:      interpreted?.expert?.recommendations ?? {},
      spotPrice:  interpreted?.noviceData?.spotPrice ?? null,
      strikeCall: interpreted?.noviceData?.strikeCall ?? null,
      strikePut:  interpreted?.noviceData?.strikePut ?? null,
      dvol:       rawData?.dvol ?? null,
      basisAvg:   rawData?.basisAvg ?? null,
    },
  }
}

/**
 * Détecte un trigger de publication pour le settlement le plus récent.
 * Ne déclenche que si le settlement a été capturé dans les 10 dernières minutes.
 *
 * @param {string} asset
 * @returns {Promise<object|null>}
 */
export async function detectSettlementTrigger(asset) {
  if (_isOnCooldown()) return null
  try {
    const history = await getSettlementHistory(asset, 1)
    if (!history.length) return null

    const settlement = history[0]
    const triggerHash = `settlement_${settlement.hash}`

    if (isAlreadyPublished(triggerHash)) return null

    // Déclencher uniquement si capturé il y a moins de 10 minutes
    if (Date.now() - settlement.capturedAt > 10 * 60 * 1000) return null

    return {
      type:   TRIGGER_TYPES.SETTLEMENT,
      hash:   triggerHash,
      asset,
      score:  null,
      ivRank: settlement.ivRank,
      label:  TRIGGER_META.SETTLEMENT.label,
      color:  TRIGGER_META.SETTLEMENT.color,
      ts:     settlement.capturedAt,
      marketContext: {
        asset,
        settlementPrice:   settlement.settlementPrice,
        spotDeltaPct:      settlement.spotDeltaPct,
        spotDeltaLabel:    settlement.spotDeltaLabel,
        maxPainDeltaPct:   settlement.maxPainDeltaPct,
        maxPainDeltaLabel: settlement.maxPainDeltaLabel,
        maxPainStrike:     settlement.maxPainStrike,
        ivRank:            settlement.ivRank,
        isLate:            settlement.isLate,
        dateKey:           settlement.dateKey,
      },
    }
  } catch (_) {
    return null
  }
}
