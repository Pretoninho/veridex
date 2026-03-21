/**
 * data_processing/trades/trade_log.js
 *
 * Journal de trades persisté en localStorage.
 * Permet de logguer des entrées, de les clôturer, et de calculer des stats.
 *
 * Structure d'un trade :
 * {
 *   id          : string      — UUID court
 *   asset       : string      — 'BTC' | 'ETH'
 *   strategy    : string      — 'Straddle' | 'Risk Reversal' | 'Calendar' | 'Butterfly' | 'Directionnel' | autre
 *   direction   : string      — 'sell_vol' | 'buy_vol' | 'neutral'
 *   strike      : number|null
 *   expiry      : string|null — 'DDMMM' ex: '27JUN'
 *   entryDate   : number      — timestamp ms
 *   entryIV     : number|null — IV au moment de l'entrée
 *   entryScore  : number|null — score de convergence au moment de l'entrée (0..6)
 *   notes       : string
 *   status      : 'open' | 'closed'
 *   exitDate    : number|null
 *   exitIV      : number|null
 *   pnl         : number|null — P&L en USD ou en pts
 *   pnlUnit     : string      — 'USD' | 'pts'
 * }
 */

const LS_KEY = 'optlab:trades'

// ── Persistence ───────────────────────────────────────────────────────────────

function loadAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(trades) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(trades))
  } catch {
    // localStorage plein — on ignore
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Enregistre un nouveau trade en entrée.
 *
 * @param {object} entry
 * @param {string}      entry.asset
 * @param {string}      entry.strategy
 * @param {string}      [entry.direction='sell_vol']
 * @param {number|null} [entry.strike]
 * @param {string|null} [entry.expiry]
 * @param {number|null} [entry.entryIV]
 * @param {number|null} [entry.entryScore]
 * @param {string}      [entry.notes='']
 * @returns {object} trade créé
 */
export function logTrade(entry) {
  const trade = {
    id:          uid(),
    asset:       entry.asset       ?? 'BTC',
    strategy:    entry.strategy    ?? '',
    direction:   entry.direction   ?? 'sell_vol',
    strike:      entry.strike      ?? null,
    expiry:      entry.expiry      ?? null,
    entryDate:   Date.now(),
    entryIV:     entry.entryIV     ?? null,
    entryScore:  entry.entryScore  ?? null,
    notes:       entry.notes       ?? '',
    status:      'open',
    exitDate:    null,
    exitIV:      null,
    pnl:         null,
    pnlUnit:     entry.pnlUnit     ?? 'USD',
  }
  const trades = loadAll()
  trades.unshift(trade)
  saveAll(trades)
  return trade
}

/**
 * Clôture un trade existant.
 *
 * @param {string} id
 * @param {object} exit
 * @param {number|null} [exit.pnl]
 * @param {string}      [exit.pnlUnit]
 * @param {number|null} [exit.exitIV]
 * @param {string}      [exit.notes]
 * @returns {object|null} trade mis à jour, ou null si id inconnu
 */
export function closeTrade(id, exit = {}) {
  const trades = loadAll()
  const idx    = trades.findIndex(t => t.id === id)
  if (idx === -1) return null

  trades[idx] = {
    ...trades[idx],
    status:   'closed',
    exitDate: Date.now(),
    exitIV:   exit.exitIV   ?? null,
    pnl:      exit.pnl      ?? null,
    pnlUnit:  exit.pnlUnit  ?? trades[idx].pnlUnit,
    notes:    exit.notes != null ? exit.notes : trades[idx].notes,
  }
  saveAll(trades)
  return trades[idx]
}

/**
 * Supprime un trade.
 * @param {string} id
 * @returns {boolean} true si supprimé
 */
export function deleteTrade(id) {
  const trades = loadAll()
  const next   = trades.filter(t => t.id !== id)
  if (next.length === trades.length) return false
  saveAll(next)
  return true
}

/**
 * Retourne tous les trades (du plus récent au plus ancien).
 * @param {{ status?: 'open'|'closed'|'all', asset?: string }} [filter]
 * @returns {object[]}
 */
export function getTrades({ status = 'all', asset = null } = {}) {
  return loadAll().filter(t => {
    if (status !== 'all' && t.status !== status) return false
    if (asset && t.asset !== asset) return false
    return true
  })
}

// ── Stats ──────────────────────────────────────────────────────────────────────

/**
 * Calcule des statistiques agrégées sur les trades clôturés.
 *
 * @param {{ asset?: string }} [filter]
 * @returns {{
 *   total: number,
 *   open: number,
 *   closed: number,
 *   wins: number,
 *   losses: number,
 *   winRate: number|null,
 *   totalPnl: number,
 *   avgPnl: number|null,
 *   bestPnl: number|null,
 *   worstPnl: number|null,
 *   avgEntryScore: number|null,
 *   avgEntryIV: number|null,
 * }}
 */
export function getTradeStats({ asset = null } = {}) {
  const all    = loadAll().filter(t => !asset || t.asset === asset)
  const closed = all.filter(t => t.status === 'closed' && t.pnl != null)
  const pnls   = closed.map(t => t.pnl)

  const wins   = pnls.filter(p => p > 0).length
  const losses = pnls.filter(p => p < 0).length

  const scores = all.filter(t => t.entryScore != null).map(t => t.entryScore)
  const ivs    = all.filter(t => t.entryIV    != null).map(t => t.entryIV)

  return {
    total:         all.length,
    open:          all.filter(t => t.status === 'open').length,
    closed:        closed.length,
    wins,
    losses,
    winRate:       closed.length > 0 ? Math.round((wins / closed.length) * 100) : null,
    totalPnl:      pnls.reduce((a, b) => a + b, 0),
    avgPnl:        closed.length > 0 ? pnls.reduce((a, b) => a + b, 0) / closed.length : null,
    bestPnl:       pnls.length > 0 ? Math.max(...pnls) : null,
    worstPnl:      pnls.length > 0 ? Math.min(...pnls) : null,
    avgEntryScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    avgEntryIV:    ivs.length    > 0 ? ivs.reduce((a, b) => a + b, 0)    / ivs.length    : null,
  }
}
