// analytics/decision_engine.js
//
// Construit un plan de trade structuré (entry / SL / TP / R:R) avec métadonnées complètes
// à partir d'un signal de pattern et du prix spot actuel.

const RISK_PCT = 1   // % du capital risqué par trade
const RR_RATIO = 2   // risk/reward 1:RR_RATIO
const VALIDITY_DURATION = '14 jours'  // Validité standard du signal
const DEFAULT_LOT = 1  // Taille de position par défaut

/**
 * Détermine intelligemment le type de trade basé sur le score du signal
 * @param {number} score — Score de signal (0-100)
 * @param {string} direction — 'LONG' ou 'SHORT'
 * @returns {'CALL'|'PUT'|'FUTURE'}
 */
function getTradeType(score, direction) {
  // Haute volatilité/IV extrême → options
  if (score >= 75) {
    return direction === 'LONG' ? 'CALL' : 'PUT'
  }
  // Zone intermédiaire/basse volatilité → futures
  return 'FUTURE'
}

/**
 * Construit un objet trade structuré et complet à partir d'un signal
 * @param {{ signal: 'LONG'|'SHORT'|'NEUTRAL'|'NO_DATA'|'NO_STATS', score: number, confidence: number }} signal
 * @param {number} price  — prix spot actuel
 * @returns {{ entry: number, direction: string, type: string, strike: number, lot: number, stopLoss: number, takeProfit: number, confidence: number, validity: string, sl: number, tp: number, rr: number } | null}
 */
export function buildTrade(signal, price) {
  if (!signal || signal.signal === 'NEUTRAL' || signal.signal === 'NO_DATA' || signal.signal === 'NO_STATS') {
    return null
  }
  if (!price || !Number.isFinite(price) || price <= 0) return null

  const entry = price
  let sl, tp

  if (signal.signal === 'LONG') {
    sl = entry * (1 - RISK_PCT / 100)
    tp = entry * (1 + (RISK_PCT * RR_RATIO) / 100)
  } else if (signal.signal === 'SHORT') {
    sl = entry * (1 + RISK_PCT / 100)
    tp = entry * (1 - (RISK_PCT * RR_RATIO) / 100)
  } else {
    return null
  }

  // Détermine le type de trade basé sur le score
  const tradeType = getTradeType(signal.score ?? 50, signal.signal)

  // Extrait la confiance du signal (0-100)
  const confidence = Math.max(0, Math.min(100, signal.confidence ?? 0))

  // Structure complète du trade avec métadonnées
  return {
    // Champs structurés (spécification métier)
    type: tradeType,
    direction: signal.signal,
    strike: entry,
    lot: DEFAULT_LOT,
    stopLoss: sl,
    takeProfit: tp,
    confidence: Math.round(confidence),
    validity: VALIDITY_DURATION,

    // Champs historiques (rétro-compatibilité)
    entry,
    sl,
    tp,
    rr: RR_RATIO,
  }
}
