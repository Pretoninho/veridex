// analytics/risk.js
//
// Calcul du risque de ruine (Risk of Ruin) selon la formule Kelly.

/**
 * @param {number} winrate       Taux de gains compris entre 0 et 1 (ex : 0.6 pour 60 %)
 * @param {number} riskPerTrade  Montant risqué par trade en dollars
 * @param {number} capital       Capital courant en dollars
 * @returns {number}             Probabilité de ruine entre 0 et 1
 */
export function riskOfRuin(winrate, riskPerTrade, capital) {
  if (winrate <= 0.5) return 1

  const edge = winrate - (1 - winrate)

  return Math.exp(-2 * edge * capital / riskPerTrade)
}
