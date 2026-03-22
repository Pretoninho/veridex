/**
 * data_processing/signals/signal_engine.js
 *
 * Moteur de score composite pour le signal DI.
 * Extrait de SignalPage.jsx — logique pure, sans React.
 *
 * Score global (0 à 100) pondéré sur 4 composantes :
 *   - Volatilité DVOL  : 35%
 *   - Funding Rate     : 25%
 *   - Basis Futures    : 25%
 *   - IV vs RV         : 15%
 *
 * Plus le score est élevé, meilleur est le contexte pour vendre de la vol (Sell High).
 *
 * Extensions hash :
 *   - Détection d'anomalies de marché (3+ indicateurs changent en 10s)
 *   - Versioning des signaux avec déduplication IndexedDB
 */

import { get as idbGet, set as idbSet } from 'idb-keyval'
import { fnv1a } from '../../data_core/data_store/cache.js'

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
  if (ratio >= 1.20) return 100
  if (ratio >= 1.10) return 75
  if (ratio >= 0.95) return 50
  if (ratio >= 0.85) return 25
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
  if (r >= 30) return 100
  if (r >= 15) return 75
  if (r >= 5)  return 50
  if (r >= 0)  return 25
  return 0
}

/**
 * Score basis futures annualisé moyen.
 * @param {number|null} basisAvg — basis annualisé moyen en %
 * @returns {number|null} 0 à 100
 */
export function scoreBasis(basisAvg) {
  if (basisAvg == null) return null
  if (basisAvg >= 15) return 100
  if (basisAvg >= 8)  return 75
  if (basisAvg >= 3)  return 50
  if (basisAvg >= 0)  return 25
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
  if (premium >= 20) return 100
  if (premium >= 10) return 75
  if (premium >= 0)  return 50
  return 0
}

// ── Score global ──────────────────────────────────────────────────────────────

/**
 * Calcule le score composite pondéré.
 * Les composantes null sont exclues et les poids redistribués.
 *
 * @param {number|null} s1 — score IV (poids 35)
 * @param {number|null} s2 — score funding (poids 25)
 * @param {number|null} s3 — score basis (poids 25)
 * @param {number|null} s4 — score IV/RV (poids 15)
 * @returns {number|null}  — 0 à 100
 */
export function calcGlobalScore(s1, s2, s3, s4) {
  let total = 0, weights = 0
  if (s1 != null) { total += s1 * 35; weights += 35 }
  if (s2 != null) { total += s2 * 25; weights += 25 }
  if (s3 != null) { total += s3 * 25; weights += 25 }
  if (s4 != null) { total += s4 * 15; weights += 15 }
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
  if (score >= 80) return {
    label:  '🔥 Exceptionnel',
    color:  'var(--call)',
    bg:     'rgba(0,229,160,.08)',
    border: 'rgba(0,229,160,.3)',
    action: 'Sell High + Short Perp — conditions idéales',
  }
  if (score >= 60) return {
    label:  '✓ Favorable',
    color:  'var(--atm)',
    bg:     'rgba(255,215,0,.06)',
    border: 'rgba(255,215,0,.3)',
    action: 'DI recommandé — bon moment pour placer',
  }
  if (score >= 40) return {
    label:  '~ Neutre',
    color:  'var(--accent2)',
    bg:     'rgba(255,107,53,.06)',
    border: 'rgba(255,107,53,.3)',
    action: 'DI possible mais pas optimal',
  }
  return {
    label:  '↓ Défavorable',
    color:  'var(--put)',
    bg:     'rgba(255,77,109,.06)',
    border: 'rgba(255,77,109,.3)',
    action: 'Attendre un meilleur contexte',
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
export function computeSignal({ dvol, funding, rv, basisAvg }) {
  const s1 = scoreIV(dvol)
  const s2 = scoreFunding(funding)
  const s3 = scoreBasis(basisAvg)
  const s4 = scoreIVvsRV(dvol, rv)
  const global = calcGlobalScore(s1, s2, s3, s4)
  return { scores: { s1, s2, s3, s4 }, global, signal: getSignal(global) }
}

// ── Détection d'anomalies de marché ──────────────────────────────────────────

/**
 * Clés d'indicateurs surveillés et leur accesseur dans un snapshot marché.
 * Un snapshot attendu : { spreadPct, fundingBinance, fundingOKX, ivRank, lsRatio, oiDelta }
 */
const MONITORED_INDICATORS = ['spreadPct', 'fundingBinance', 'fundingOKX', 'ivRank', 'lsRatio', 'oiDelta']
const ANOMALY_THRESHOLD = 3       // nb d'indicateurs simultanés pour déclencher l'alerte
const ANOMALY_WINDOW_MS = 10_000  // fenêtre de comparaison : 10 secondes

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
 * @param {{ spreadPct?: number, fundingBinance?: number, fundingOKX?: number,
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

  if (changed.length >= ANOMALY_THRESHOLD) {
    return { anomaly: true, changedIndicators: changed, asset }
  }
  return { anomaly: false, changedIndicators: changed, asset }
}

// ── Versioning des signaux avec IndexedDB ─────────────────────────────────────

const SIGNALS_IDB_KEY = 'signal_history'
const MAX_SIGNALS_STORED = 500

/**
 * Génère le hash d'un signal à partir de son contexte complet.
 * @param {{ timestamp, asset, score, conditions, recommendation, marketHash }} ctx
 * @returns {string} hash FNV-1a
 */
function _hashSignal(ctx) {
  const str = `${ctx.asset}|${ctx.score}|${ctx.recommendation}|${ctx.marketHash ?? ''}|${JSON.stringify(ctx.conditions ?? {})}`
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
