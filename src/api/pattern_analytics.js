/**
 * Pattern Analytics API Module
 * Provides analysis and reporting functions for pattern performance
 */

import { getPatternSessions, getSessionStats, getUniquePatternHashes } from '../data/data_store/pattern_session_store.js'

/**
 * Get comprehensive performance report for patterns in a sector
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type ('futures', 'options', 'onchain') or null for all
 * @param {Object} options - Options
 * @param {number} options.days - Time period (default: 30 days)
 * @param {number} options.limit - Max sessions to analyze (default: 500)
 * @returns {Promise<Object>} Performance report
 *
 * @example
 * const report = await getPatternPerformanceReport('BTC', 'futures', { days: 30 })
 * // Returns: {
 * //   asset: 'BTC',
 * //   sector: 'futures',
 * //   period: 'last 30 days',
 * //   totalPatternsDetected: 45,
 * //   successRate: 0.62,
 * //   avgMovePercent: 2.3,
 * //   sessions: [...]
 * // }
 */
export async function getPatternPerformanceReport(asset, sector, options = {}) {
  const { days = 30, limit = 500 } = options

  // Get sessions within time period
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
  const sessions = await getPatternSessions(asset, sector, { limit, sinceMs })

  // Get statistics
  const stats = await getSessionStats(asset, sector)

  // Group by pattern hash
  const byPattern = {}
  for (const session of sessions) {
    const hash = session.summary?.patternHash
    if (!hash) continue

    if (!byPattern[hash]) {
      byPattern[hash] = {
        hash,
        occurrences: 0,
        sessionCount: 0,
        profitableSessions: 0,
        movePercents: [],
        maxMoves: [],
        minMoves: [],
        descriptions: new Set()
      }
    }

    byPattern[hash].occurrences += session.summary?.trajectoryPoints || 0
    byPattern[hash].sessionCount += 1
    byPattern[hash].movePercents.push(session.summary?.movePercent || 0)

    if (session.summary?.status === 'profit') {
      byPattern[hash].profitableSessions += 1
    }

    if (session.summary?.movePercent) {
      byPattern[hash].maxMoves.push(session.summary.maxMove || 0)
      byPattern[hash].minMoves.push(session.summary.minMove || 0)
    }

    if (session.summary?.description) {
      byPattern[hash].descriptions.add(session.summary.description)
    }
  }

  // Compute pattern stats
  const patternStats = Object.values(byPattern).map(p => {
    const movePercentAvg = p.movePercents.length > 0
      ? p.movePercents.reduce((a, b) => a + b, 0) / p.movePercents.length
      : 0

    const maxMoveAvg = p.maxMoves.length > 0
      ? p.maxMoves.reduce((a, b) => a + b, 0) / p.maxMoves.length
      : 0

    const minMoveAvg = p.minMoves.length > 0
      ? p.minMoves.reduce((a, b) => a + b, 0) / p.minMoves.length
      : 0

    return {
      hash: p.hash,
      description: Array.from(p.descriptions)[0] || 'Unknown pattern',
      sessionCount: p.sessionCount,
      profitableSessions: p.profitableSessions,
      winRate: p.sessionCount > 0 ? ((p.profitableSessions / p.sessionCount) * 100).toFixed(2) : 0,
      avgMovePercent: movePercentAvg.toFixed(2),
      maxMoveAvg: maxMoveAvg.toFixed(2),
      minMoveAvg: minMoveAvg.toFixed(2),
      occurrences: p.occurrences
    }
  })

  // Sort by win rate
  patternStats.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))

  return {
    asset,
    sector: sector || 'all',
    period: `last ${days} days`,
    generatedAt: new Date().toISOString(),
    totalSessionsAnalyzed: sessions.length,
    totalPatternsDetected: Object.keys(byPattern).length,
    successRate: stats.winRate / 100,
    avgMovePercent: parseFloat(stats.avgMove),
    maxMovePercent: parseFloat(stats.maxMove),
    minMovePercent: parseFloat(stats.minMove),
    statistics: stats,
    patterns: patternStats
  }
}

/**
 * Get trajectory data for a specific session
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type
 * @param {string} patternHash - Pattern hash to find
 * @param {number} index - Which occurrence (default: 0 = most recent)
 * @returns {Promise<Object|null>} Session data with trajectory or null
 *
 * @example
 * const trajectory = await getSessionTrajectory('BTC', 'futures', 'a1b2c3d4', 0)
 * // Returns: {
 * //   summary: {...},
 * //   trajectory: [{timestamp, price, ...}, ...],
 * //   chart: {...}
 * // }
 */
export async function getSessionTrajectory(asset, sector, patternHash, index = 0) {
  const sessions = await getPatternSessions(asset, sector, {
    limit: 100,
    patternHash
  })

  if (sessions.length === 0 || index >= sessions.length) {
    return null
  }

  const session = sessions[Math.max(0, sessions.length - 1 - index)]

  // Prepare trajectory with price changes
  const trajectory = session.trajectory || []
  const summary = session.summary

  if (!summary) {
    return null
  }

  // Calculate price changes
  const trajectoryWithChanges = trajectory.map((point, i) => {
    let changePercent = 0
    if (summary.startPrice && summary.startPrice > 0) {
      changePercent = ((point.price - summary.startPrice) / summary.startPrice) * 100
    }

    return {
      timestamp: point.timestamp,
      time: new Date(point.timestamp).toLocaleTimeString(),
      price: parseFloat(point.price.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
      iv: point.iv ? parseFloat(point.iv.toFixed(2)) : null,
      funding: point.funding ? parseFloat(point.funding.toFixed(4)) : null
    }
  })

  // Generate simple chart data (compressed for browser rendering)
  const compressionFactor = Math.max(1, Math.floor(trajectoryWithChanges.length / 100))
  const chartData = trajectoryWithChanges.filter((_, i) => i % compressionFactor === 0)

  return {
    summary,
    trajectory: trajectoryWithChanges,
    chartData,
    metadata: {
      asset,
      sector,
      pointCount: trajectory.length,
      startPrice: summary.startPrice,
      endPrice: summary.endPrice,
      maxPrice: summary.maxPrice,
      minPrice: summary.minPrice
    }
  }
}

/**
 * Compare pattern performance across multiple sectors
 *
 * @param {string} asset - Asset name
 * @param {Object} options - Options
 * @param {number} options.days - Time period (default: 30)
 * @param {number} options.limit - Max sessions per sector (default: 200)
 * @returns {Promise<Object>} Comparison report
 *
 * @example
 * const comparison = await comparePatternPerformanceBySector('BTC', { days: 30 })
 */
export async function comparePatternPerformanceBySector(asset, options = {}) {
  const { days = 30, limit = 200 } = options

  const sectors = ['futures', 'options', 'onchain']
  const sectorReports = {}

  for (const sector of sectors) {
    sectorReports[sector] = await getPatternPerformanceReport(asset, sector, {
      days,
      limit
    })
  }

  return {
    asset,
    period: `last ${days} days`,
    generatedAt: new Date().toISOString(),
    sectors: sectorReports,
    comparison: {
      bestPerformer: _getBestPerformer(sectorReports),
      worstPerformer: _getWorstPerformer(sectorReports),
      summary: _getSectorComparison(sectorReports)
    }
  }
}

/**
 * Find best performing sector
 *
 * @private
 * @param {Object} sectorReports - Reports by sector
 * @returns {string} Best sector name
 */
function _getBestPerformer(sectorReports) {
  let best = null
  let bestWinRate = -1

  for (const [sector, report] of Object.entries(sectorReports)) {
    const winRate = report.statistics?.winRate || 0
    if (winRate > bestWinRate) {
      bestWinRate = winRate
      best = sector
    }
  }

  return best
}

/**
 * Find worst performing sector
 *
 * @private
 * @param {Object} sectorReports - Reports by sector
 * @returns {string} Worst sector name
 */
function _getWorstPerformer(sectorReports) {
  let worst = null
  let worstWinRate = 101

  for (const [sector, report] of Object.entries(sectorReports)) {
    const winRate = report.statistics?.winRate || 0
    if (winRate < worstWinRate) {
      worstWinRate = winRate
      worst = sector
    }
  }

  return worst
}

/**
 * Generate sector comparison summary
 *
 * @private
 * @param {Object} sectorReports - Reports by sector
 * @returns {Array} Comparison summary
 */
function _getSectorComparison(sectorReports) {
  return Object.entries(sectorReports).map(([sector, report]) => ({
    sector,
    sessionsAnalyzed: report.totalSessionsAnalyzed,
    patternsDetected: report.totalPatternsDetected,
    winRate: report.successRate * 100,
    avgMove: report.avgMovePercent
  }))
}

/**
 * Get trending patterns (hot/cold)
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional)
 * @param {Object} options - Options
 * @param {number} options.topN - Return top N patterns (default: 10)
 * @param {string} options.sortBy - Sort key: 'winRate', 'avgMove', 'frequency' (default: 'winRate')
 * @returns {Promise<Object>} Trending patterns report
 *
 * @example
 * const trends = await getTrendingPatterns('BTC', 'futures', { topN: 10 })
 */
export async function getTrendingPatterns(asset, sector, options = {}) {
  const { topN = 10, sortBy = 'winRate' } = options

  const report = await getPatternPerformanceReport(asset, sector, { limit: 500 })

  let patterns = [...report.patterns]

  // Sort by specified key
  switch (sortBy) {
    case 'avgMove':
      patterns.sort((a, b) => Math.abs(parseFloat(b.avgMovePercent)) - Math.abs(parseFloat(a.avgMovePercent)))
      break
    case 'frequency':
      patterns.sort((a, b) => b.occurrences - a.occurrences)
      break
    case 'winRate':
    default:
      patterns.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))
  }

  return {
    asset,
    sector: sector || 'all',
    sortedBy: sortBy,
    generatedAt: new Date().toISOString(),
    top: patterns.slice(0, topN),
    bottom: patterns.slice(-topN).reverse()
  }
}

/**
 * Export performance data as CSV-compatible format
 *
 * @param {string} asset - Asset name
 * @param {string} sector - Sector type (optional)
 * @param {number} days - Time period
 * @returns {Promise<string>} CSV-formatted string
 *
 * @example
 * const csv = await exportPatternDataAsCSV('BTC', 'futures', 30)
 */
export async function exportPatternDataAsCSV(asset, sector, days = 30) {
  const report = await getPatternPerformanceReport(asset, sector, { days })

  const headers = [
    'PatternHash',
    'Description',
    'SessionCount',
    'ProfitableSessions',
    'WinRate%',
    'AvgMove%',
    'MaxMove%',
    'MinMove%'
  ]

  const rows = report.patterns.map(p => [
    p.hash,
    `"${p.description}"`,
    p.sessionCount,
    p.profitableSessions,
    p.winRate,
    p.avgMovePercent,
    p.maxMoveAvg,
    p.minMoveAvg
  ])

  const csv = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n')

  return csv
}

/**
 * Get health check for pattern tracking system
 *
 * @param {string} asset - Asset name
 * @returns {Promise<Object>} Health status
 *
 * @example
 * const health = await getSystemHealth('BTC')
 */
export async function getSystemHealth(asset) {
  try {
    const hashes = await getUniquePatternHashes(asset)
    const stats = await getSessionStats(asset)

    return {
      asset,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      metrics: {
        uniquePatterns: hashes.size,
        totalSessions: stats.totalSessions,
        successRate: `${stats.winRate.toFixed(2)}%`
      }
    }
  } catch (error) {
    return {
      asset,
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    }
  }
}
