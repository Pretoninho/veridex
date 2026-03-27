// analytics/market_regime.js
//
// Détecte le régime de marché en combinant la tendance prix/MA et le niveau
// de volatilité DVOL.

/**
 * Retourne une chaîne décrivant le régime courant, par exemple :
 *   'bull_low', 'bear_high', 'neutral_medium', 'sideways_high'
 *
 * @param {{ price?: number|null, ma50?: number|null, ma200?: number|null, dvol?: number|null }} params
 * @returns {string}
 */
export function detectMarketRegime({ price, ma50, ma200, dvol } = {}) {
  const volatility =
    dvol == null ? 'unknown' :
    dvol < 40    ? 'low'    :
    dvol < 70    ? 'medium' :
                   'high'

  if (!price || !ma50 || !ma200) return `neutral_${volatility}`

  const trend =
    price > ma200 ? 'bull'     :
    price < ma200 ? 'bear'     :
                    'sideways'

  return `${trend}_${volatility}`
}
