/**
 * data_processing/signals/snapshot_generator.js
 *
 * Génère des snapshots exportables de patterns de marché.
 * Chaque snapshot est lié au précédent via un hash (chaîne Bitcoin-inspired).
 *
 * Format snapshot :
 * {
 *   meta: {
 *     version: 1,
 *     asset: 'BTC',
 *     generatedAt: 1711234567890,
 *     patternCount: 12,
 *     hash: 'a1b2c3d4',      ← FNV-1a du payload (sans hash/prevHash)
 *     prevHash: '00000000',  ← hash du snapshot précédent
 *     chainLength: 1,
 *   },
 *   patterns: [
 *     {
 *       hash: 'fingerprint_hash',
 *       config: { ivRankBucket, fundingBucket, spreadBucket, lsBucket, basisBucket },
 *       occurrences: 5,
 *       winRate_1h: 60,
 *       winRate_4h: 55,
 *       avgMove_24h: 1.2,
 *     },
 *     ...
 *   ]
 * }
 *
 * La chaîne est stockée dans IndexedDB :
 *   clé 'snapshot_chain_BTC' → { hashes: [...], chainLength: N }
 *   clé 'snapshot_chain_ETH' → { hashes: [...], chainLength: N }
 * Max 365 hashes par chaîne.
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a }                        from '../data/data_store/cache.js'
import { getAllPatterns }               from './market_fingerprint.js'
import { STORAGE_LIMITS }               from '../config/signal_calibration.js'

// ── Constantes ────────────────────────────────────────────────────────────────

export const SNAPSHOT_VERSION          = 1
export const MIN_OCCURRENCES_TO_EXPORT = STORAGE_LIMITS.MIN_OCCURRENCES_TO_EXPORT
export const MAX_CHAIN_LENGTH          = STORAGE_LIMITS.MAX_CHAIN_LENGTH
export const GENESIS_HASH             = '00000000'

const CHAIN_KEY = {
  BTC: 'snapshot_chain_BTC',
  ETH: 'snapshot_chain_ETH',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calcule le hash d'un snapshot (sans inclure les champs hash/prevHash
 * pour éviter la circularité).
 * @param {{ meta: Object, patterns: Array }} snapshot
 * @returns {string}
 */
function _computeSnapshotHash(snapshot) {
  const payload = {
    version:      snapshot.meta.version,
    asset:        snapshot.meta.asset,
    generatedAt:  snapshot.meta.generatedAt,
    patternCount: snapshot.meta.patternCount,
    prevHash:     snapshot.meta.prevHash,
    patterns:     snapshot.patterns,
  }
  return fnv1a(JSON.stringify(payload))
}

/**
 * Lit la chaîne de hashes depuis IndexedDB.
 * @param {string} asset
 * @returns {Promise<{ hashes: string[], chainLength: number }>}
 */
async function _getChain(asset) {
  const key = CHAIN_KEY[asset]
  if (!key) return { hashes: [], chainLength: 0 }
  return (await idbGet(key)) ?? { hashes: [], chainLength: 0 }
}

/**
 * Enregistre un hash dans la chaîne (max MAX_CHAIN_LENGTH).
 * @param {string} asset
 * @param {string} hash
 * @param {number} chainLength
 */
async function _appendToChain(asset, hash, chainLength) {
  const key   = CHAIN_KEY[asset]
  if (!key) return
  const chain = await _getChain(asset)
  chain.hashes.push(hash)
  if (chain.hashes.length > MAX_CHAIN_LENGTH) {
    chain.hashes = chain.hashes.slice(-MAX_CHAIN_LENGTH)
  }
  chain.chainLength = chainLength
  await idbSet(key, chain)
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Génère un snapshot des patterns enregistrés pour un asset donné.
 * Filtre les patterns avec moins de MIN_OCCURRENCES_TO_EXPORT occurrences.
 * Chaîne le hash au snapshot précédent.
 *
 * @param {string} asset — 'BTC' | 'ETH'
 * @returns {Promise<Object>} snapshot complet
 */
export async function generateSnapshot(asset) {
  const upper = asset.toUpperCase()

  // 1. Charger les patterns filtrés
  const allPatterns = await getAllPatterns()
  const patterns = allPatterns
    .filter(p => p.occurrences >= MIN_OCCURRENCES_TO_EXPORT)
    .map(p => ({
      hash:        p.hash,
      config:      p.config,
      occurrences: p.occurrences,
      winRate_1h:  p.winRate_1h,
      winRate_4h:  p.winRate_4h,
      avgMove_24h: p.avgMove_24h,
    }))

  // 2. Récupérer le hash précédent
  const chain   = await _getChain(upper)
  const prevHash = chain.hashes.length > 0
    ? chain.hashes[chain.hashes.length - 1]
    : GENESIS_HASH

  const chainLength = chain.chainLength + 1

  // 3. Construire le snapshot (sans hash — calculé ensuite)
  const snapshot = {
    meta: {
      version:      SNAPSHOT_VERSION,
      asset:        upper,
      generatedAt:  Date.now(),
      patternCount: patterns.length,
      prevHash,
      chainLength,
      hash: '',   // placeholder
    },
    patterns,
  }

  // 4. Calculer le hash
  snapshot.meta.hash = _computeSnapshotHash(snapshot)

  // 5. Enregistrer dans la chaîne
  await _appendToChain(upper, snapshot.meta.hash, chainLength)

  return snapshot
}

/**
 * Vérifie l'intégrité d'un snapshot en recalculant son hash.
 * @param {Object} snapshot
 * @returns {boolean}
 */
export function verifySnapshot(snapshot) {
  try {
    if (!snapshot?.meta || !Array.isArray(snapshot.patterns)) return false
    const expected = _computeSnapshotHash(snapshot)
    return expected === snapshot.meta.hash
  } catch (_) {
    return false
  }
}

/**
 * Sérialise un snapshot en JSON formaté.
 * @param {Object} snapshot
 * @returns {string}
 */
export function snapshotToJSON(snapshot) {
  return JSON.stringify(snapshot, null, 2)
}

/**
 * Désérialise un snapshot depuis une chaîne JSON.
 * Retourne null si le JSON est invalide.
 * @param {string} json
 * @returns {Object|null}
 */
export function snapshotFromJSON(json) {
  try {
    return JSON.parse(json)
  } catch (_) {
    return null
  }
}

/**
 * Retourne l'historique des hashes de la chaîne locale pour un asset.
 * @param {string} asset
 * @returns {Promise<{ hashes: string[], chainLength: number }>}
 */
export async function getSnapshotHistory(asset) {
  return _getChain(asset.toUpperCase())
}
