// analytics/signal_confluence.js
//
// Calcule un score de confluence à partir d'un tableau de signaux individuels.
// Score positif  → majorité haussière
// Score négatif  → majorité baissière
// Score nul      → neutralité

/**
 * @param {Array<{ signal: 'BUY'|'SELL'|string }>} signals
 * @returns {number}
 */
export function computeConfluence(signals = []) {
  let score = 0

  signals.forEach(s => {
    if (s.signal === 'BUY')  score += 1
    if (s.signal === 'SELL') score -= 1
  })

  return score
}
