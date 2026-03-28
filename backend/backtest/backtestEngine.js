/**
 * backend/backtest/backtestEngine.js
 *
 * Moteur de backtest basé sur les signaux Veridex.
 *
 * Teste : "Quand score = X → que se passe-t-il après ?"
 * Calcule winrate, expectancy et statistiques par bucket de score.
 *
 * Usage :
 *   node backend/backtest/backtestEngine.js
 *
 * Ou depuis un autre module :
 *   const { runBacktest } = require('./backtestEngine')
 *   const stats = runBacktest(dataset, { scoreThreshold: 60 })
 */

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Chargement des données ────────────────────────────────────────────────────

/**
 * Charge le dataset depuis un fichier JSON ou utilise le dataset interne.
 * @param {string} [filePath] — chemin absolu ou relatif vers le JSON
 * @returns {Array<{ score: number, futureReturn: number }>}
 */
function loadDataset(filePath) {
  const resolved = filePath
    ? path.resolve(filePath)
    : path.join(__dirname, 'dataset.json')
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

// ── Moteur de backtest ────────────────────────────────────────────────────────

/**
 * Exécute un backtest sur un dataset de signaux.
 *
 * @param {Array<{ score: number, futureReturn: number }>} data
 * @param {{
 *   scoreThreshold?: number,   — minimum score to enter a trade (default: 60)
 *   returnThreshold?: number,  — minimum future return to classify as a win (default: 0,
 *                                meaning any positive return counts as a win)
 * }} [opts]
 * @returns {{
 *   trades:      number,
 *   wins:        number,
 *   losses:      number,
 *   winrate:     string,
 *   avgReturn:   string,
 *   expectancy:  string,
 *   avgWin:      string,
 *   avgLoss:     string,
 *   byBucket:    Array<{ range: string, trades: number, winrate: string, avgReturn: string }>,
 * }}
 */
function runBacktest(data, opts = {}) {
  const scoreThreshold  = opts.scoreThreshold  ?? 60
  const returnThreshold = opts.returnThreshold ?? 0

  // ── Filtre : on n'entre que si score >= seuil ─────────────────────────────
  const trades = data.filter(entry => entry.score >= scoreThreshold)
  const total  = trades.length

  if (total === 0) {
    return {
      trades:     0,
      wins:       0,
      losses:     0,
      winrate:    '0.00%',
      avgReturn:  '0.00%',
      expectancy: '0.00%',
      avgWin:     '0.00%',
      avgLoss:    '0.00%',
      byBucket:   [],
    }
  }

  const wins   = trades.filter(e => e.futureReturn > returnThreshold)
  const losses = trades.filter(e => e.futureReturn <= returnThreshold)

  const winCount  = wins.length
  const lossCount = losses.length

  const avgReturn  = trades.reduce((s, e) => s + e.futureReturn, 0) / total
  const avgWin     = winCount  > 0 ? wins.reduce((s, e)   => s + e.futureReturn, 0) / winCount  : 0
  const avgLoss    = lossCount > 0 ? losses.reduce((s, e) => s + e.futureReturn, 0) / lossCount : 0
  const winratePct = winCount / total

  // Expectancy : (winrate × avgWin) + (lossRate × avgLoss)
  const expectancy = winratePct * avgWin + (1 - winratePct) * avgLoss

  // ── Stats par bucket de score ─────────────────────────────────────────────
  const BUCKETS = [
    { min: 0,  max: 40,  range: '0-40'   },
    { min: 40, max: 60,  range: '40-60'  },
    { min: 60, max: 75,  range: '60-75'  },
    { min: 75, max: 90,  range: '75-90'  },
    { min: 90, max: 101, range: '90-100' },
  ]

  const byBucket = BUCKETS.map(bucket => {
    const entries = data.filter(e => e.score >= bucket.min && e.score < bucket.max)
    if (!entries.length) return { range: bucket.range, trades: 0, winrate: 'N/A', avgReturn: 'N/A' }

    const bWins  = entries.filter(e => e.futureReturn > returnThreshold).length
    const bAvgR  = entries.reduce((s, e) => s + e.futureReturn, 0) / entries.length

    return {
      range:     bucket.range,
      trades:    entries.length,
      winrate:   `${((bWins / entries.length) * 100).toFixed(1)}%`,
      avgReturn: `${(bAvgR * 100).toFixed(2)}%`,
    }
  })

  return {
    trades:     total,
    wins:       winCount,
    losses:     lossCount,
    winrate:    `${(winratePct * 100).toFixed(2)}%`,
    avgReturn:  `${(avgReturn * 100).toFixed(2)}%`,
    expectancy: `${(expectancy * 100).toFixed(2)}%`,
    avgWin:     `${(avgWin * 100).toFixed(2)}%`,
    avgLoss:    `${(avgLoss * 100).toFixed(2)}%`,
    byBucket,
  }
}

// ── Point d'entrée CLI ────────────────────────────────────────────────────────

if (require.main === module) {
  const datasetPath = process.argv[2] ?? null
  const threshold   = process.argv[3] ? Number(process.argv[3]) : 60

  try {
    const data   = loadDataset(datasetPath)
    const result = runBacktest(data, { scoreThreshold: threshold })

    console.log('\n=== Veridex Backtest Results ===')
    console.log(`Score threshold : >= ${threshold}`)
    console.log(`Trades          : ${result.trades}`)
    console.log(`Wins            : ${result.wins}`)
    console.log(`Losses          : ${result.losses}`)
    console.log(`Winrate         : ${result.winrate}`)
    console.log(`Avg return      : ${result.avgReturn}`)
    console.log(`Expectancy      : ${result.expectancy}`)
    console.log(`Avg win         : ${result.avgWin}`)
    console.log(`Avg loss        : ${result.avgLoss}`)

    console.log('\n--- By Score Bucket ---')
    result.byBucket.forEach(b => {
      console.log(`  ${b.range.padEnd(8)} | trades: ${String(b.trades).padEnd(4)} | winrate: ${String(b.winrate).padEnd(7)} | avgReturn: ${b.avgReturn}`)
    })
    console.log()
  } catch (err) {
    console.error('[backtest] Error:', err.message)
    process.exit(1)
  }
}

module.exports = { runBacktest, loadDataset }
