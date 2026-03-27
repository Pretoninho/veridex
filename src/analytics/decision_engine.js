// analytics/decision_engine.js
//
// Construit un plan de trade (entry / SL / TP / R:R) à partir
// d'un signal de pattern et du prix spot actuel.

const RISK_PCT = 1   // % du capital risqué par trade
const RR_RATIO = 2   // risk/reward 1:RR_RATIO

/**
 * @param {{ signal: 'LONG'|'SHORT'|'NEUTRAL'|'NO_DATA'|'NO_STATS', score: number, confidence: number }} signal
 * @param {number} price  — prix spot actuel
 * @returns {{ entry: number, sl: number, tp: number, rr: number, direction: string } | null}
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

  return {
    entry,
    sl,
    tp,
    rr: RR_RATIO,
    direction: signal.signal,
  }
}
