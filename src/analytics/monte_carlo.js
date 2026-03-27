// analytics/monte_carlo.js
//
// Simulation Monte Carlo pour estimer la distribution des balances finales
// en randomisant le signe des P&L historiques.

/**
 * @param {Array<{ pnl: number }>} trades     Historique des trades
 * @param {number}                 [iterations=1000]
 * @returns {number[]}  Tableau de balances finales simulées
 */
export function monteCarlo(trades = [], iterations = 1000) {
  const results = []

  for (let i = 0; i < iterations; i++) {
    let balance = 10000

    trades.forEach(t => {
      const random = Math.random()
      const pnl    = t.pnl * (random > 0.5 ? 1 : -1)
      balance     += pnl
    })

    results.push(balance)
  }

  return results
}
