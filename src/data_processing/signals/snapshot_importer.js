/**
 * data_processing/signals/snapshot_importer.js
 *
 * Importe des snapshots de patterns de marché depuis une URL distante.
 * Priorité locale : les patterns déjà présents en IndexedDB ne sont jamais écrasés.
 *
 * Flux au premier lancement :
 *   1. runInitialImport('BTC') → fetch /patterns_snapshot_BTC.json
 *   2. shouldImportSnapshot(snapshot) → vérifie version, âge, intégrité
 *   3. importSnapshot(snapshot) → importe les patterns manquants dans IDB
 *   4. setState({ done: true, importedAt })
 *
 * État persisté dans localStorage :
 *   clé 'veridex_snapshot_import' → { BTC: { done, importedAt, count }, ETH: {...} }
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { verifySnapshot }               from './snapshot_generator.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const STATE_KEY           = 'veridex_snapshot_import'
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000   // 7 jours → avertissement
const MAX_REJECT_AGE_MS   = 30 * 24 * 60 * 60 * 1000  // 30 jours → rejet

// ── Helpers IDB ───────────────────────────────────────────────────────────────

const mfKey = (hash) => `mf_${hash}`

/**
 * Vérifie si un pattern existe déjà dans IDB.
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function _patternExists(hash) {
  const record = await idbGet(mfKey(hash))
  return record != null
}

/**
 * Crée un pattern vierge (sans outcomes) dans IDB depuis une entrée snapshot.
 * @param {{ hash: string, config: Object, occurrences: number }} pattern
 */
async function _createPatternFromSnapshot(pattern) {
  const key = mfKey(pattern.hash)
  await idbSet(key, {
    config:   pattern.config,
    outcomes: [],              // pas d'outcomes importés — local only
    count:    pattern.occurrences,
  })

  // Maintenir l'index
  const index = (await idbGet('mf_index')) ?? []
  if (!index.includes(pattern.hash)) {
    index.push(pattern.hash)
    await idbSet('mf_index', index)
  }
}

// ── État d'import ─────────────────────────────────────────────────────────────

/**
 * Retourne l'état d'import pour tous les assets.
 * @returns {{ BTC?: Object, ETH?: Object }}
 */
export function getImportState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}')
  } catch (_) {
    return {}
  }
}

/**
 * Réinitialise l'état d'import (force un re-import au prochain lancement).
 * @param {string} [asset] — si omis, réinitialise tout
 */
export function resetImportState(asset) {
  try {
    if (asset) {
      const state = getImportState()
      delete state[asset.toUpperCase()]
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } else {
      localStorage.removeItem(STATE_KEY)
    }
  } catch (_) {}
}

function _setImportState(asset, data) {
  try {
    const state = getImportState()
    state[asset.toUpperCase()] = data
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch (_) {}
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Détermine si un snapshot doit être importé.
 *
 * @param {Object} snapshot
 * @returns {{ ok: boolean, reason?: string, warning?: string }}
 */
export function shouldImportSnapshot(snapshot) {
  if (!snapshot?.meta) {
    return { ok: false, reason: 'Structure invalide' }
  }

  const { version, generatedAt } = snapshot.meta
  const age = Date.now() - (generatedAt ?? 0)

  // Version inconnue
  if (version !== 1) {
    return { ok: false, reason: `Version non supportée : ${version}` }
  }

  // Snapshot trop vieux → rejet
  if (age > MAX_REJECT_AGE_MS) {
    return { ok: false, reason: `Snapshot trop ancien (${Math.floor(age / 86_400_000)}j)` }
  }

  // Intégrité hash
  if (!verifySnapshot(snapshot)) {
    return { ok: false, reason: 'Hash invalide — snapshot corrompu' }
  }

  // Avertissement si > 7 jours
  if (age > MAX_SNAPSHOT_AGE_MS) {
    return { ok: true, warning: `Snapshot âgé de ${Math.floor(age / 86_400_000)} jours` }
  }

  return { ok: true }
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Importe les patterns d'un snapshot dans IndexedDB.
 * Ne touche JAMAIS aux patterns qui existent déjà localement.
 *
 * @param {Object} snapshot
 * @returns {Promise<{ imported: number, skipped: number, warning?: string }>}
 */
export async function importSnapshot(snapshot) {
  const check = shouldImportSnapshot(snapshot)
  if (!check.ok) {
    throw new Error(check.reason)
  }

  const patterns = snapshot.patterns ?? []
  let imported = 0
  let skipped  = 0

  await Promise.allSettled(
    patterns.map(async (pattern) => {
      try {
        const exists = await _patternExists(pattern.hash)
        if (exists) {
          skipped++
          return
        }
        await _createPatternFromSnapshot(pattern)
        imported++
      } catch (_) {
        skipped++
      }
    })
  )

  return { imported, skipped, warning: check.warning }
}

// ── Import initial ────────────────────────────────────────────────────────────

/**
 * Lance l'import initial au premier lancement de l'app.
 * Ne fait rien si l'import a déjà été effectué pour cet asset.
 *
 * @param {string} asset — 'BTC' | 'ETH'
 * @returns {Promise<void>}
 */
export async function runInitialImport(asset) {
  const upper = asset.toUpperCase()
  const state = getImportState()

  // Déjà importé → skip
  if (state[upper]?.done) return

  try {
    const url      = `/patterns_snapshot_${upper}.json`
    const response = await fetch(url)
    if (!response.ok) {
      _setImportState(upper, { done: true, importedAt: Date.now(), count: 0, error: `HTTP ${response.status}` })
      return
    }

    const snapshot = await response.json()
    const { imported, skipped, warning } = await importSnapshot(snapshot)

    _setImportState(upper, {
      done:       true,
      importedAt: Date.now(),
      count:      imported,
      skipped,
      hash:       snapshot.meta?.hash ?? null,
      warning:    warning ?? null,
    })
  } catch (err) {
    // Snapshot absent ou invalide → marquer comme tenté pour ne pas boucler
    _setImportState(upper, {
      done:       true,
      importedAt: Date.now(),
      count:      0,
      error:      err?.message ?? 'Erreur inconnue',
    })
  }
}
