// analytics/portfolio_simulator.js
//
// Simule un portefeuille de trading en appliquant les trades issus du
// decision_engine. Les données sont persistées dans localStorage pour
// survivre aux rechargements de page.

const LS_KEY      = 'veridex_simulator'
const INIT_BAL    = 10_000
const POSITION    = 0.01   // position size : 1 % du portefeuille
const MAX_TRADES  = 200    // entrées max conservées dans localStorage

export { INIT_BAL, POSITION as POSITION_PCT }

// ── Persistance ───────────────────────────────────────────────────────────────

function loadPortfolio() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { /* ignore */ }
  return { balance: INIT_BAL, trades: [] }
}

function savePortfolio(portfolio) {
  try {
    // Garde les MAX_TRADES derniers trades
    const trimmed = { ...portfolio, trades: portfolio.trades.slice(-MAX_TRADES) }
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed))
  } catch (_) { /* ignore */ }
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Applique un trade au portefeuille simulé et retourne l'état mis à jour.
 * Accepte tous les trades avec données valides (y compris faible confiance).
 *
 * @param {{ entry: number, direction: 'LONG'|'SHORT', confidence?: number } | null} trade
 * @param {number} currentPrice  — prix de clôture simulé
 * @returns {{ balance: number, trades: Array }}
 */
export function simulateTrade(trade, currentPrice) {
  const portfolio = loadPortfolio()

  // Valide le trade object et le prix (accepte toute confiance >= 0)
  if (!trade?.entry || !currentPrice || !Number.isFinite(currentPrice)) {
    return portfolio
  }

  let pnl = 0

  if (trade.direction === 'LONG') {
    pnl = (currentPrice - trade.entry) / trade.entry
  } else if (trade.direction === 'SHORT') {
    pnl = (trade.entry - currentPrice) / trade.entry
  }

  const result = pnl * portfolio.balance * POSITION

  portfolio.balance += result
  portfolio.trades.push({
    pnl:       result,
    balance:   portfolio.balance,
    direction: trade.direction,
    entry:     trade.entry,
    exit:      currentPrice,
    ts:        Date.now(),
  })

  savePortfolio(portfolio)
  return portfolio
}

/**
 * Retourne l'état courant du portefeuille sans modifier les données.
 * @returns {{ balance: number, trades: Array }}
 */
export function getPortfolio() {
  return loadPortfolio()
}

/**
 * Réinitialise le portefeuille simulé.
 * @returns {{ balance: number, trades: Array }}
 */
export function resetPortfolio() {
  const fresh = { balance: INIT_BAL, trades: [] }
  savePortfolio(fresh)
  return fresh
}
