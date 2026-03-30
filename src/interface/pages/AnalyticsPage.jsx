/**
 * AnalyticsPage.jsx
 *
 * Pattern Analytics Dashboard
 * Visualizes pattern performance, sector comparison, trending patterns,
 * and price trajectories after pattern detection
 *
 * Structure:
 * 1. Header (filters + refresh)
 * 2. KPI Dashboard (4 metric cards)
 * 3. Sector Comparison (3-column grid)
 * 4. Patterns Tables (top/bottom 10)
 * 5. Trajectory Chart (price visualization)
 * 6. Export Section
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getPatternPerformanceReport,
  comparePatternPerformanceBySector,
  getTrendingPatterns,
  getSessionTrajectory,
  exportPatternDataAsCSV,
  getSystemHealth
} from '../../api/pattern_analytics.js'
import {
  PatternAnalyticsKPICard,
  PatternAnalyticsSectorMetrics,
  PatternAnalyticsTable,
  PatternAnalyticsTrajectoryChart,
  PatternAnalyticsFilterControls,
  PatternAnalyticsExportButton
} from '../components/index.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 30
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const DEBOUNCE_DELAY_MS = 500

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Debounce callback - prevents rapid API calls
 */
function useDebounce(callback, delay) {
  const timeoutRef = useRef(null)

  return useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args)
    }, delay)
  }, [callback, delay])
}

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num) {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return num.toFixed(0)
}

/**
 * Color for percentage values
 */
function getPercentColor(value) {
  if (value > 60) return 'var(--call)' // Green
  if (value > 40) return 'var(--atm)' // Orange
  return 'var(--put)' // Red
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsPage({ asset = 'BTC', clockSync }) {
  // Data state
  const [data, setData] = useState({
    kpis: null,
    patterns: null,
    sectorComparison: null,
    trending: null,
    selectedPattern: null,
    trajectory: null,
    trajectoryMetadata: null
  })

  // Filter state
  const [filters, setFilters] = useState({
    sector: null, // null = all sectors
    days: DEFAULT_DAYS,
    sortBy: 'winRate'
  })

  // UI state
  const [ui, setUI] = useState({
    loading: false,
    loadingTrajectory: false,
    error: null,
    lastUpdate: null,
    exporting: false
  })

  // ── Data Fetching ─────────────────────────────────────────────────────────

  /**
   * Main data load function - fetches all analytics data
   */
  const loadAnalyticsData = useCallback(async () => {
    setUI(prev => ({ ...prev, loading: true, error: null }))

    try {
      // Fetch data in parallel using Promise.allSettled
      const [kpiResult, sectorResult, trendingResult] = await Promise.allSettled([
        getPatternPerformanceReport(asset, filters.sector, { days: filters.days, limit: 500 }),
        comparePatternPerformanceBySector(asset, { days: filters.days }),
        getTrendingPatterns(asset, filters.sector, { topN: 10, sortBy: filters.sortBy })
      ])

      // Handle results
      const kpis = kpiResult.status === 'fulfilled' ? kpiResult.value : null
      const sectorComp = sectorResult.status === 'fulfilled' ? sectorResult.value : null
      const trending = trendingResult.status === 'fulfilled' ? trendingResult.value : null

      // Set data
      setData(prev => ({
        ...prev,
        kpis,
        patterns: kpis?.patterns || [],
        sectorComparison: sectorComp,
        trending
      }))

      // Set last update
      setUI(prev => ({
        ...prev,
        loading: false,
        lastUpdate: new Date(),
        error: null
      }))
    } catch (error) {
      console.error('[AnalyticsPage] Error loading analytics data:', error)
      setUI(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to load analytics data'
      }))
    }
  }, [asset, filters.sector, filters.days, filters.sortBy])

  /**
   * Load trajectory for selected pattern
   */
  const loadTrajectory = useCallback(async (patternHash) => {
    if (!patternHash) return

    setUI(prev => ({ ...prev, loadingTrajectory: true }))

    try {
      const trajectory = await getSessionTrajectory(asset, filters.sector, patternHash, 0)

      if (trajectory) {
        setData(prev => ({
          ...prev,
          selectedPattern: patternHash,
          trajectory: trajectory.trajectory,
          trajectoryMetadata: trajectory.metadata
        }))
      }

      setUI(prev => ({ ...prev, loadingTrajectory: false }))
    } catch (error) {
      console.error('[AnalyticsPage] Error loading trajectory:', error)
      setUI(prev => ({
        ...prev,
        loadingTrajectory: false,
        error: 'Failed to load trajectory data'
      }))
    }
  }, [asset, filters.sector])

  // ── Effects ───────────────────────────────────────────────────────────────

  /**
   * Load data on component mount or when filters change
   */
  useEffect(() => {
    loadAnalyticsData()
  }, [loadAnalyticsData])

  /**
   * Auto-refresh every 5 minutes
   */
  useEffect(() => {
    const timer = setInterval(() => {
      loadAnalyticsData()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [loadAnalyticsData])

  // ── Event Handlers ────────────────────────────────────────────────────────

  const handleFilterChange = (newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }))
    // Clear selected pattern when filters change
    setData(prev => ({ ...prev, selectedPattern: null, trajectory: null }))
  }

  const handlePatternSelect = (patternHash) => {
    loadTrajectory(patternHash)
  }

  const handleRefresh = () => {
    loadAnalyticsData()
  }

  const handleExport = async () => {
    setUI(prev => ({ ...prev, exporting: true }))
    try {
      const csv = await exportPatternDataAsCSV(asset, filters.sector, filters.days)

      // Create blob and download
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `patterns-${asset}-${filters.sector || 'all'}-${filters.days}d.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      setUI(prev => ({ ...prev, exporting: false }))
    } catch (error) {
      console.error('[AnalyticsPage] Error exporting data:', error)
      setUI(prev => ({ ...prev, exporting: false, error: 'Export failed' }))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrap">
      {/* Header Section */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Analytics</h1>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Pattern performance tracking & trend analysis
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {ui.loading && <div className="dot-live" />}
          <button
            onClick={handleRefresh}
            disabled={ui.loading}
            style={{
              padding: '6px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              cursor: ui.loading ? 'not-allowed' : 'pointer',
              opacity: ui.loading ? 0.5 : 1,
              fontSize: 12,
              fontFamily: 'var(--mono)'
            }}
          >
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <PatternAnalyticsFilterControls
        sector={filters.sector}
        days={filters.days}
        sortBy={filters.sortBy}
        onFilterChange={handleFilterChange}
        asset={asset}
      />

      {/* Error Banner */}
      {ui.error && (
        <div style={{
          background: 'rgba(240, 71, 107, 0.1)',
          border: '1px solid var(--put)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
          color: 'var(--put)',
          fontSize: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>⚠ {ui.error}</span>
          <button
            onClick={() => setUI(prev => ({ ...prev, error: null }))}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--put)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 0
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI Dashboard */}
      <section style={{ marginBottom: 32 }}>
        <div style={{
          fontSize: 10,
          fontFamily: 'var(--sans)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: 'var(--text-muted)',
          marginBottom: 12
        }}>
          Key Metrics
        </div>

        {ui.loading && !data.kpis ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '14px 16px',
                height: 80,
                animation: 'shimmer 1.4s infinite'
              }} />
            ))}
          </div>
        ) : data.kpis ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <PatternAnalyticsKPICard
              label="Total Patterns"
              value={data.kpis.totalPatternsDetected}
              subtext="detected"
              color="var(--accent)"
            />
            <PatternAnalyticsKPICard
              label="Success Rate"
              value={`${(data.kpis.successRate * 100).toFixed(1)}%`}
              subtext={`${data.kpis.totalSessionsAnalyzed} sessions`}
              color={getPercentColor(data.kpis.successRate * 100)}
            />
            <PatternAnalyticsKPICard
              label="Avg Move"
              value={`${data.kpis.avgMovePercent >= 0 ? '+' : ''}${data.kpis.avgMovePercent.toFixed(2)}%`}
              subtext="after pattern"
              color={data.kpis.avgMovePercent > 0 ? 'var(--call)' : 'var(--put)'}
            />
            <PatternAnalyticsKPICard
              label="Trending"
              value={`${Math.max(...data.kpis.patterns.map(p => parseInt(p.winRate) || 0))}%`}
              subtext="top pattern"
              color="var(--atm)"
            />
          </div>
        ) : (
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '32px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            No data available
          </div>
        )}
      </section>

      {/* Sector Comparison */}
      {data.sectorComparison && (
        <section style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--sans)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: 'var(--text-muted)',
            marginBottom: 12
          }}>
            Sector Comparison
          </div>

          <PatternAnalyticsSectorMetrics
            sectorReports={data.sectorComparison.sectors}
            comparison={data.sectorComparison.comparison}
          />
        </section>
      )}

      {/* Patterns Tables */}
      {data.trending && (
        <section style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--sans)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: 'var(--text-muted)',
            marginBottom: 12
          }}>
            Top & Bottom Patterns
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <PatternAnalyticsTable
              title="Top Performers"
              patterns={data.trending.top}
              isBottom={false}
              onPatternSelect={handlePatternSelect}
              selectedPattern={data.selectedPattern}
            />

            <PatternAnalyticsTable
              title="Underperformers"
              patterns={data.trending.bottom}
              isBottom={true}
              onPatternSelect={handlePatternSelect}
              selectedPattern={data.selectedPattern}
            />
          </div>
        </section>
      )}

      {/* Trajectory Chart */}
      {data.trajectory && (
        <section style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 10,
            fontFamily: 'var(--sans)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: 'var(--text-muted)',
            marginBottom: 12
          }}>
            Price Trajectory
          </div>

          <PatternAnalyticsTrajectoryChart
            trajectory={data.trajectory}
            metadata={data.trajectoryMetadata}
            selectedPattern={data.selectedPattern}
            loading={ui.loadingTrajectory}
          />
        </section>
      )}

      {/* Export Section */}
      <section style={{ marginBottom: 24 }}>
        <PatternAnalyticsExportButton
          asset={asset}
          sector={filters.sector}
          days={filters.days}
          onExport={handleExport}
          exporting={ui.exporting}
        />
      </section>

      {/* Last Update */}
      {ui.lastUpdate && (
        <div style={{
          fontSize: 10,
          color: 'var(--text-ghost)',
          textAlign: 'center',
          marginTop: 24,
          paddingTop: 12,
          borderTop: '1px solid var(--border)'
        }}>
          Last updated: {ui.lastUpdate.toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
