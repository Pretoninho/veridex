/**
 * data_processing/signals/signal_engine.js
 *
 * Moteur de score composite pour l'analyse de marché.
 * Extrait de SignalPage.jsx — logique pure, sans React.
 *
 * Score global (0 à 100) pondéré sur 6 composantes :
 *   - Volatilité DVOL       : 30%
 *   - Funding Rate          : 20%
 *   - Basis Futures         : 20%
 *   - IV vs RV              : 15%
 *   - On-Chain              : 10% (15% si s6 absent)
 *   - Positionnement (s6)   : 15% (optionnel)
 *
 * Plus le score est élevé, plus le contexte est favorable (toutes stratégies).
 *
 * Extensions hash :
 *   - Détection d'anomalies de marché (3+ indicateurs changent en 10s)
 *   - Versioning des signaux avec déduplication IndexedDB
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a } from '../data/data_store/cache.js'
import { calculateGainExample } from './signal_interpreter.js'
import { calculateMaxPainByExpiry, interpretMaxPain } from '../core/volatility/max_pain.js'
import { calcPositioningScore, interpretPositioning } from './positioning_score.js'
import { TIMING, STORAGE_LIMITS, getComponentWeights } from '../config/signal_calibration.js'
import { getCalibration } from './signal_calibration.js'
import { hashSector } from '../utils/sector_hasher.js'

// ── Filtre DVOL ───────────────────────────────────────────────────────────────

/**
 * Facteur de pondération contextuel basé sur le niveau DVOL.
 * Réduit la confiance du signal quand le marché est trop calme ou trop agité.
 *
 * @param {number|null} dvolCurrent — valeur courante du DVOL (ex: 55)
 * @returns {number} facteur multiplicateur entre 0.7 et 1.0
 */
export function dvolFilter(dvolCurrent) {
  if (dvolCurrent == null) return 1
  const cal = getCalibration()

  // Marché trop calme → signal faible
  if (dvolCurrent < cal.dvol_calm_max) return 0.7

  // Marché optimal
  if (dvolCurrent < cal.dvol_agitated_min) return 1

  // Marché trop agité → réduire la confiance
  return 0.8
}

// ── Fonctions de score par composante ────────────────────────────────────────

/**
 * Score IV basé sur le ratio DVOL current / moyenne 30j.
 * @param {{ current: number, monthMin: number, monthMax: number }} dvol
 * @returns {number|null} 0 à 100
 */
export function scoreIV(dvol) {
  if (!dvol) return null
  const avg30 = (dvol.monthMin + dvol.monthMax) / 2
  const ratio = dvol.current / avg30
  const cal = getCalibration()
  if (ratio >= cal.iv_ratio_t4) return 100
  if (ratio >= cal.iv_ratio_t3) return 75
  if (ratio >= cal.iv_ratio_t2) return 50
  if (ratio >= cal.iv_ratio_t1) return 25
  return 0
}

/**
 * Score funding rate annualisé.
 * @param {{ rateAnn?: number, avgAnn7d?: number }} funding
 * @returns {number|null} 0 à 100
 */
export function scoreFunding(funding) {
  if (!funding) return null
  const r = funding.rateAnn ?? funding.avgAnn7d
  if (r == null) return null
  const cal = getCalibration()
  if (r >= cal.funding_t4) return 100
  if (r >= cal.funding_t3) return 75
  if (r >= cal.funding_t2) return 50
  if (r >= cal.funding_t1) return 25
  return 0
}

/**
 * Score basis futures annualisé moyen.
 * @param {number|null} basisAvg — basis annualisé moyen en %
 * @returns {number|null} 0 à 100
 */
export function scoreBasis(basisAvg) {
  if (basisAvg == null) return null
  const cal = getCalibration()
  if (basisAvg >= cal.basis_score_t4) return 100
  if (basisAvg >= cal.basis_score_t3) return 75
  if (basisAvg >= cal.basis_score_t2) return 50
  if (basisAvg >= cal.basis_score_t1) return 25
  return 0
}

/**
 * Score premium IV vs RV (volatilité implicite vs réalisée).
 * @param {{ current: number }} dvol
 * @param {{ current: number }} rv
 * @returns {number|null} 0 à 100
 */
export function scoreIVvsRV(dvol, rv) {
  if (!dvol || !rv) return null
  const premium = dvol.current - rv.current
  const cal = getCalibration()
  if (premium >= cal.ivvsrv_t3) return 100
  if (premium >= cal.ivvsrv_t2) return 75
  if (premium >= cal.ivvsrv_t1) return 50
  return 0
}

// ── Score global ──────────────────────────────────────────────────────────────

/**
 * Calcule le score composite pondéré.
 * Les composantes null sont exclues et les poids redistribués.
 *
 * Pondération avec s5 + s6 :
 *   s1 IV            30%
 *   s2 Funding       20%
 *   s3 Basis         20%
 *   s4 IV/RV         15%
 *   s5 OnChain       10% (15% si s6 absent)
 *   s6 Positioning   15% (optionnel — si absent, s5 récupère les 15%)
 *
 * Sans s5 ni s6 (rétro-compat) :
 *   s1 IV       35%
 *   s2 Funding  25%
 *   s3 Basis    25%
 *   s4 IV/RV    15%
 *
 * @param {number|null} s1 — score IV
 * @param {number|null} s2 — score funding
 * @param {number|null} s3 — score basis
 * @param {number|null} s4 — score IV/RV
 * @param {number|null} [s5] — score on-chain (optionnel)
 * @param {number|null} [s6] — score positionnement croisé (optionnel)
 * @returns {number|null}  — 0 à 100
 */
export function calcGlobalScore(s1, s2, s3, s4, s5, s6) {
  const hasS5 = s5 != null
  const hasS6 = s6 != null
  const cal = getCalibration()
  const { w1, w2, w3, w4, w5, w6 } = getComponentWeights(hasS5, hasS6, cal)

  let total = 0, weights = 0
  if (s1 != null) { total += s1 * w1; weights += w1 }
  if (s2 != null) { total += s2 * w2; weights += w2 }
  if (s3 != null) { total += s3 * w3; weights += w3 }
  if (s4 != null) { total += s4 * w4; weights += w4 }
  if (s5 != null) { total += s5 * w5; weights += w5 }
  if (s6 != null) { total += s6 * w6; weights += w6 }
  return weights > 0 ? Math.round(total / weights) : null
}

// ── Interprétation ────────────────────────────────────────────────────────────

/**
 * Interprétation textuelle et visuelle du score global.
 * @param {number|null} score
 * @returns {{ label: string, color: string, bg: string, border: string, action: string } | null}
 */
export function getSignal(score) {
  if (score == null) return null
  const cal = getCalibration()
  if (score >= cal.signal_fav_max) return {
    label:  '🔥 Exceptionnel',
    color:  'var(--call)',
    bg:     'rgba(0,229,160,.08)',
    border: 'rgba(0,229,160,.3)',
    action: 'Conditions exceptionnelles — multiples opportunités actives',
  }
  if (score >= cal.signal_neutr_max) return {
    label:  '✓ Favorable',
    color:  'var(--atm)',
    bg:     'rgba(255,215,0,.06)',
    border: 'rgba(255,215,0,.3)',
    action: 'Conditions favorables — bon moment pour agir',
  }
  if (score >= cal.signal_unfav_max) return {
    label:  '~ Neutre',
    color:  'var(--accent2)',
    bg:     'rgba(255,107,53,.06)',
    border: 'rgba(255,107,53,.3)',
    action: 'Marché neutre — être sélectif sur les positions',
  }
  return {
    label:  '↓ Défavorable',
    color:  'var(--put)',
    bg:     'rgba(255,77,109,.06)',
    border: 'rgba(255,77,109,.3)',
    action: 'Attendre un meilleur contexte de marché',
  }
}

// ── Calcul complet ────────────────────────────────────────────────────────────

/**
 * Calcule le signal complet à partir des données normalisées.
 *
 * @param {{
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null
 * }} inputs
 * @returns {{
 *   scores: { s1, s2, s3, s4 },
 *   global: number|null,
 *   signal: ReturnType<typeof getSignal>
 * }}
 */
/**
 * @param {{
 *   dvol: object|null,
 *   funding: object|null,
 *   rv: object|null,
 *   basisAvg: number|null,
 *   onChainScore?: number|null,
 *   spot?: number|null,
 *   asset?: string
 * }} inputs
 */
export function computeSignal({ dvol, funding, rv, basisAvg, onChainScore, spot, asset, instruments = [],
  lsRatio = null, pcRatio = null }) {
  const s1 = scoreIV(dvol)
  const s2 = scoreFunding(funding)
  const s3 = scoreBasis(basisAvg)
  const s4 = scoreIVvsRV(dvol, rv)
  const s5 = onChainScore ?? null
  const s6 = calcPositioningScore(lsRatio, pcRatio)
  const rawGlobal  = calcGlobalScore(s1, s2, s3, s4, s5, s6)
  const dvolFactor = dvolFilter(dvol?.current ?? null)
  const global     = rawGlobal != null ? Math.round(rawGlobal * dvolFactor) : null
  const positioning = interpretPositioning(lsRatio, pcRatio, s6)

  const fundingAnn = funding?.rateAnn ?? funding?.avgAnn7d ?? null

  // Données contextuelles pour la couche novice (signal_interpreter.js)
  const noviceData = {
    asset:         asset ?? 'BTC',
    spotPrice:     spot ?? null,
    score:         global,
    funding:       fundingAnn,
    estimatedGain: calculateGainExample({ score: global, funding: fundingAnn }),
    strikeCall:    spot != null ? Math.round(spot * 1.08) : null,
    strikePut:     spot != null ? Math.round(spot * 0.92) : null,
  }

  // Max Pain — calculé uniquement si instruments disponibles
  let maxPainResult = null

  if (instruments.length > 0 && spot) {
    try {
      const byExpiry = calculateMaxPainByExpiry(instruments, spot)
      const next = byExpiry[0]   // prochaine échéance uniquement pour le signal
      if (next) {
        maxPainResult = {
          ...next,
          interpretation: interpretMaxPain(next, spot),
        }
      }
    } catch (err) {
      console.warn('[computeSignal] Max Pain error:', err)
      // Ne jamais bloquer le signal principal
    }
  }

  return {
    scores:     { s1, s2, s3, s4, s5, s6 },
    global,
    dvolFactor,
    signal:     getSignal(global),
    noviceData,
    maxPain:    maxPainResult,
    positioning,
  }
}

// ── Sector-specific hashing helpers ────────────────────────────────────────────

/**
 * Compute hashes for all sectors based on current market data
 * Used by SectorSignalTracker to detect changes per sector
 *
 * @param {{dvol, funding, rv, basisAvg, onChainScore, spot}} data
 * @returns {{futures: {hash, sector, size}, options: {hash, sector, size}, onchain: {hash, sector, size}}}
 */
export function hashAllSectors(data) {
  const result = {}

  // Hash Futures sector (Funding, Basis)
  if (data.funding || data.basisAvg) {
    result.futures = hashSector({
      funding: data.funding,
      basis: data.basisAvg
    }, 'futures')
  }

  // Hash Options sector (DVOL, IV/RV premium)
  if (data.dvol || data.rv) {
    result.options = hashSector({
      dvol: data.dvol,
      rv: data.rv
    }, 'options')
  }

  // Hash On-Chain sector
  if (data.onChainScore !== undefined) {
    result.onchain = hashSector({
      onChainScore: data.onChainScore
    }, 'onchain')
  }

  return result
}

// ── Persistance des anomalies ─────────────────────────────────────────────────

// Use centralized configuration
const ANOMALY_LOG_KEY = STORAGE_LIMITS.ANOMALY_LOG_KEY
const MAX_ANOMALIES = STORAGE_LIMITS.MAX_ANOMALIES

/**
 * Persiste une anomalie détectée dans localStorage avec déduplication.
 * @param {{ anomaly: boolean, changedIndicators: string[] }} anomalyResult
 * @param {string} [asset]
 */
function _persistAnomaly(anomalyResult, asset) {
  if (!anomalyResult?.anomaly) return

  const hash = fnv1a(
    `${anomalyResult.changedIndicators.join('|')}|${Math.floor(Date.now() / 10_000)}`
  )

  const entry = {
    hash,
    timestamp:         Date.now(),
    asset:             asset ?? 'BTC',
    anomaly:           true,
    changedIndicators: anomalyResult.changedIndicators,
    count:             anomalyResult.changedIndicators.length,
    severity:          anomalyResult.changedIndicators.length >= 5 ? 'critical' : 'warning',
  }

  try {
    let log = JSON.parse(localStorage.getItem(ANOMALY_LOG_KEY) || '[]')

    // Déduplication : éviter deux fois la même anomalie en < 60s
    const duplicate = log.find(e =>
      e.hash === hash ||
      (JSON.stringify(e.changedIndicators) ===
       JSON.stringify(anomalyResult.changedIndicators) &&
       Date.now() - e.timestamp < TIMING.ANOMALY_DEDUP_MS)
    )
    if (duplicate) return

    log.push(entry)
    if (log.length > MAX_ANOMALIES) log = log.slice(-MAX_ANOMALIES)
    localStorage.setItem(ANOMALY_LOG_KEY, JSON.stringify(log))
  } catch (_) {}
}

/**
 * Retourne le journal des anomalies (du plus récent au plus ancien).
 * @param {number} [limit=100]
 * @returns {Array}
 */
export function getAnomalyLog(limit = 100) {
  try {
    const log = JSON.parse(localStorage.getItem(ANOMALY_LOG_KEY) || '[]')
    return log.slice(-limit).reverse()
  } catch (_) {
    return []
  }
}

/**
 * Efface le journal des anomalies.
 */
export function clearAnomalyLog() {
  localStorage.removeItem(ANOMALY_LOG_KEY)
}

// ── Détection d'anomalies de marché ──────────────────────────────────────────

/**
 * Clés d'indicateurs surveillés et leur accesseur dans un snapshot marché.
 * Un snapshot attendu : { spreadPct, fundingBinance, fundingDeribit, ivRank, lsRatio, oiDelta }
 */
const MONITORED_INDICATORS = ['spreadPct', 'fundingBinance', 'fundingDeribit', 'ivRank', 'lsRatio', 'oiDelta']
const ANOMALY_WINDOW_MS = TIMING.ANOMALY_WINDOW_MS

/** Dernier snapshot + timestamp pour la détection d'anomalies */
let _lastSnapshot = null
let _lastSnapshotTs = 0

/**
 * Compare deux valeurs numériques et détecte un changement significatif.
 * Un changement est significatif si la valeur diffère de > 1% (relatif) ou
 * si l'une des deux est null/undefined et l'autre non.
 */
function _hasIndicatorChanged(prev, next) {
  if (prev == null && next == null) return false
  if (prev == null || next == null) return true
  if (prev === 0 && next === 0) return false
  const ref = Math.abs(prev) || 1
  return Math.abs(next - prev) / ref > 0.01
}

/**
 * Analyse un snapshot marché et détecte les anomalies.
 * Doit être appelé périodiquement (toutes les 10s environ).
 *
 * @param {{ spreadPct?: number, fundingBinance?: number, fundingDeribit?: number,
 *            ivRank?: number, lsRatio?: number, oiDelta?: number }} snapshot
 * @param {string} [asset]
 * @returns {{ anomaly: boolean, changedIndicators: string[], asset: string|undefined } | null}
 *   null si la fenêtre de comparaison n'est pas encore écoulée
 */
export function detectMarketAnomaly(snapshot, asset) {
  const now = Date.now()

  if (!_lastSnapshot || now - _lastSnapshotTs >= ANOMALY_WINDOW_MS) {
    _lastSnapshot = { ...snapshot }
    _lastSnapshotTs = now
    return null
  }

  const changed = MONITORED_INDICATORS.filter(key =>
    _hasIndicatorChanged(_lastSnapshot[key], snapshot[key])
  )

  // Mise à jour du snapshot de référence
  _lastSnapshot = { ...snapshot }
  _lastSnapshotTs = now

  if (changed.length >= getCalibration().anomaly_threshold) {
    const result = { anomaly: true, changedIndicators: changed, asset }
    _persistAnomaly(result, asset)
    return result
  }
  return { anomaly: false, changedIndicators: changed, asset }
}

// ── Versioning des signaux avec IndexedDB ─────────────────────────────────────

const SIGNALS_IDB_KEY = STORAGE_LIMITS.SIGNALS_IDB_KEY
const MAX_SIGNALS_STORED = STORAGE_LIMITS.MAX_SIGNALS_STORED

/**
 * Génère le hash d'un signal à partir de son contexte complet.
 * @param {{ timestamp, asset, score, conditions, recommendation, marketHash }} ctx
 * @returns {string} hash FNV-1a
 */
function _hashSignal(ctx) {
  const str = [
    ctx.asset,
    ctx.score,
    ctx.recommendation,
    ctx.marketHash ?? '',
    JSON.stringify(ctx.conditions ?? {}),
    ctx.strategySignature ?? 'NO_STRATEGY',
    ctx.marketRegime ?? '',
  ].join('|')
  return fnv1a(str)
}

/**
 * Génère le hash représentant l'état du marché à un instant donné.
 * @param {{ dvol?, funding?, rv?, basisAvg? }} marketInputs
 * @returns {string}
 */
export function hashMarketState(marketInputs) {
  const parts = [
    Math.round((marketInputs?.dvol?.current ?? 0) * 10),
    Math.round((marketInputs?.funding?.rateAnn ?? 0) * 100),
    Math.round((marketInputs?.rv?.current ?? 0) * 10),
    Math.round((marketInputs?.basisAvg ?? 0) * 100),
  ].join('|')
  return fnv1a(parts)
}

/**
 * Sauvegarde un signal dans IndexedDB avec déduplication par hash.
 *
 * @param {{
 *   asset: string,
 *   score: number|null,
 *   conditions: Object,
 *   recommendation: string,
 *   marketHash?: string
 * }} signalCtx
 * @returns {Promise<{ hash: string, isDuplicate: boolean }>}
 */
export async function saveSignal(signalCtx) {
  const hash = _hashSignal(signalCtx)
  const entry = {
    hash,
    timestamp: Date.now(),
    asset: signalCtx.asset,
    score: signalCtx.score,
    conditions: signalCtx.conditions,
    recommendation: signalCtx.recommendation,
    marketHash: signalCtx.marketHash ?? null,
  }

  const history = (await idbGet(SIGNALS_IDB_KEY)) ?? []

  // Déduplication par hash
  if (history.some(s => s.hash === hash)) {
    return { hash, isDuplicate: true }
  }

  history.push(entry)
  // Garder seulement les N derniers
  if (history.length > MAX_SIGNALS_STORED) history.splice(0, history.length - MAX_SIGNALS_STORED)

  await idbSet(SIGNALS_IDB_KEY, history)
  return { hash, isDuplicate: false }
}

/**
 * Récupère l'historique des signaux pour un asset.
 * @param {string} asset
 * @param {number} [limit=50]
 * @returns {Promise<Array>}
 */
export async function getSignalHistory(asset, limit = 50) {
  const history = (await idbGet(SIGNALS_IDB_KEY)) ?? []
  const filtered = asset ? history.filter(s => s.asset === asset) : history
  return filtered.slice(-limit)
}
