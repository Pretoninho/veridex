/**
 * PerformancePage.jsx
 *
 * Performance dashboard — visualize edge metrics from the backend analytics API.
 *
 * Sections:
 *   - KPI summary (win rate, avg return, Sharpe, max drawdown)
 *   - Equity curve (line chart)
 *   - Drawdown chart (area chart)
 *   - Return distribution histogram
 *   - Confusion matrix by signal type
 *   - Export buttons (CSV / JSON)
 *
 * Data source: GET /analytics/stats and GET /analytics/export
 */

import { useState, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Tooltip, Legend,
)

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL
    : 'http://localhost:3000'
).replace(/\/$/, '')

async function fetchStats(asset, days, horizon) {
  const url = `${API_BASE}/analytics/stats?asset=${asset}&days=${days}&horizon=${horizon}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function exportUrl(asset, type, format, days) {
  return `${API_BASE}/analytics/export?asset=${asset}&type=${type}&format=${format}&days=${days}`
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(v, decimals = 2, suffix = '') {
  if (v == null) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(decimals) + suffix
}

function pctColor(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 'var(--text-muted)'
  if (n > 0) return '#26d97f'
  if (n < 0) return '#ff4d6d'
  return 'var(--text-muted)'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
      fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
      marginBottom: 8, marginTop: 20,
    }}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px', flex: '1 1 0', minWidth: 0,
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}

function HorizonTab({ value, active, onClick }) {
  return (
    <button
      onClick={() => onClick(value)}
      style={{
        padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
        fontFamily: 'var(--font-display)', cursor: 'pointer', border: '1px solid',
        borderColor: active ? 'var(--accent-border)' : 'var(--border)',
        background:  active ? 'var(--accent-dim)'    : 'transparent',
        color:       active ? 'var(--accent)'         : 'var(--text-muted)',
        transition:  'all 0.12s',
      }}
    >
      {value}
    </button>
  )
}

// ── Equity curve chart ────────────────────────────────────────────────────────

function EquityChart({ equityCurve }) {
  if (!equityCurve?.length) {
    return (
      <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
        Pas encore de données settled
      </div>
    )
  }

  const labels = equityCurve.map((_, i) => i + 1)
  const isPositive = equityCurve[equityCurve.length - 1] >= equityCurve[0]

  const data = {
    labels,
    datasets: [{
      label: 'Equity curve',
      data: equityCurve,
      borderColor: isPositive ? '#26d97f' : '#ff4d6d',
      backgroundColor: isPositive ? 'rgba(38,217,127,0.08)' : 'rgba(255,77,109,0.08)',
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.3,
    }],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { display: false },
      y: {
        display: true,
        grid:   { color: 'rgba(255,255,255,0.04)' },
        ticks:  { color: 'rgba(255,255,255,0.35)', font: { size: 9 }, maxTicksLimit: 4 },
        border: { display: false },
      },
    },
  }

  return <div style={{ height: 140 }}><Line data={data} options={options} /></div>
}

// ── Drawdown chart ────────────────────────────────────────────────────────────

function DrawdownChart({ equityCurve }) {
  if (!equityCurve?.length) return null

  // Compute per-point drawdown from equity curve
  let peak = equityCurve[0]
  const drawdowns = equityCurve.map(v => {
    if (v > peak) peak = v
    return peak > 0 ? -((peak - v) / peak * 100) : 0
  })

  const labels = drawdowns.map((_, i) => i + 1)

  const data = {
    labels,
    datasets: [{
      label: 'Drawdown %',
      data: drawdowns,
      borderColor: '#ff4d6d',
      backgroundColor: 'rgba(255,77,109,0.15)',
      borderWidth: 1,
      pointRadius: 0,
      fill: true,
      tension: 0.2,
    }],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { display: false },
      y: {
        display: true,
        grid:   { color: 'rgba(255,255,255,0.04)' },
        ticks:  { color: 'rgba(255,255,255,0.35)', font: { size: 9 }, maxTicksLimit: 4,
          callback: v => v.toFixed(1) + '%' },
        border: { display: false },
        max: 0,
      },
    },
  }

  return <div style={{ height: 100 }}><Line data={data} options={options} /></div>
}

// ── Return histogram ──────────────────────────────────────────────────────────

function ReturnHistogram({ equityCurve }) {
  if (!equityCurve?.length) return null

  // Compute per-trade returns from equity curve
  const returns = []
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push(equityCurve[i] - equityCurve[i - 1])
  }
  if (!returns.length) return null

  // Build histogram bins
  const min = Math.min(...returns)
  const max = Math.max(...returns)
  const BINS = 20
  const binWidth = (max - min) / BINS || 0.1
  const bins = Array.from({ length: BINS }, (_, i) => min + i * binWidth)
  const counts = Array(BINS).fill(0)
  for (const r of returns) {
    const idx = Math.min(Math.floor((r - min) / binWidth), BINS - 1)
    counts[idx]++
  }

  const colors = bins.map(b => b >= 0 ? 'rgba(38,217,127,0.7)' : 'rgba(255,77,109,0.7)')

  const data = {
    labels: bins.map(b => b.toFixed(2) + '%'),
    datasets: [{
      label: 'Returns',
      data: counts,
      backgroundColor: colors,
      borderRadius: 2,
    }],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
    scales: {
      x: { display: true, grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 8 }, maxTicksLimit: 6 } },
      y: { display: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 9 }, maxTicksLimit: 3 }, border: { display: false } },
    },
  }

  return <div style={{ height: 110 }}><Bar data={data} options={options} /></div>
}

// ── Confusion matrix ──────────────────────────────────────────────────────────

const OUTCOME_COLORS = {
  WIN:       '#26d97f',
  LOSS:      '#ff4d6d',
  FLAT:      '#8899aa',
  UNSETTLED: 'rgba(255,255,255,0.2)',
}

function ConfusionMatrix({ matrix }) {
  if (!matrix || !Object.keys(matrix).length) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: '12px 0' }}>
        Aucune donnée
      </div>
    )
  }

  const outcomes = ['WIN', 'LOSS', 'FLAT', 'UNSETTLED']
  const types    = Object.keys(matrix)

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: 'var(--sans)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700 }}>Type</th>
            {outcomes.map(o => (
              <th key={o} style={{ textAlign: 'center', padding: '4px 8px', color: OUTCOME_COLORS[o] ?? 'var(--text-muted)', fontWeight: 700 }}>{o}</th>
            ))}
            <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {types.map(type => {
            const row   = matrix[type]
            const total = outcomes.reduce((s, o) => s + (row[o] ?? 0), 0)
            return (
              <tr key={type} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{type}</td>
                {outcomes.map(o => {
                  const count = row[o] ?? 0
                  const pct   = total ? Math.round(count / total * 100) : 0
                  return (
                    <td key={o} style={{ textAlign: 'center', padding: '6px 8px' }}>
                      <span style={{ color: OUTCOME_COLORS[o] ?? 'var(--text-muted)' }}>{count}</span>
                      {count > 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 3 }}>({pct}%)</span>}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--text-muted)' }}>{total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Horizon breakdown table ───────────────────────────────────────────────────

function HorizonBreakdown({ breakdown }) {
  if (!breakdown) return null
  const horizons = ['1h', '4h', '24h']
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {horizons.map(h => {
        const d = breakdown[h] ?? {}
        return (
          <div key={h} style={{
            background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 12px',
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>+{h}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: d.win_rate != null ? pctColor(d.win_rate - 50) : 'var(--text-muted)' }}>
              {d.win_rate != null ? d.win_rate.toFixed(1) + '%' : '—'}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>win rate</div>
            <div style={{ fontSize: 11, color: pctColor(d.avg_return), marginTop: 4 }}>
              {fmt(d.avg_return, 3, '%')}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>avg return</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
              {d.settled ?? 0} settled
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Export buttons ────────────────────────────────────────────────────────────

function ExportButtons({ asset, days }) {
  const types = ['signals', 'ticks', 'outcomes']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {types.map(type => (
        <div key={type} style={{ display: 'flex', gap: 6 }}>
          <a
            href={exportUrl(asset, type, 'csv', days)}
            download
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 10, fontWeight: 700,
              fontFamily: 'var(--sans)', cursor: 'pointer', textDecoration: 'none',
              border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
              color: 'var(--text-muted)', letterSpacing: '0.5px',
              display: 'inline-block',
            }}
          >
            {type.toUpperCase()} CSV
          </a>
          <a
            href={exportUrl(asset, type, 'json', days)}
            download
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 10, fontWeight: 700,
              fontFamily: 'var(--sans)', cursor: 'pointer', textDecoration: 'none',
              border: '1px solid var(--border)', background: 'var(--bg-surface-2)',
              color: 'var(--text-muted)', letterSpacing: '0.5px',
              display: 'inline-block',
            }}
          >
            {type.toUpperCase()} JSON
          </a>
        </div>
      ))}
    </div>
  )
}

// ── Main PerformancePage ──────────────────────────────────────────────────────

const DAYS_OPTIONS    = [7, 14, 30, 90]
const HORIZON_OPTIONS = ['1h', '4h', '24h']

export default function PerformancePage({ asset }) {
  const [days,    setDays]    = useState(30)
  const [horizon, setHorizon] = useState('4h')
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchStats(asset, days, horizon)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })

    return () => { cancelled = true }
  }, [asset, days, horizon])

  const d = data ?? {}

  return (
    <div style={{ padding: '0 16px 32px', maxWidth: 600, margin: '0 auto' }}>

      {/* Controls */}
      <div style={{ paddingTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Days selector */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {DAYS_OPTIONS.map(numDays => (
            <button key={numDays} onClick={() => setDays(numDays)} style={{
              padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              fontFamily: 'var(--font-display)', cursor: 'pointer',
              border: '1px solid', borderColor: days === numDays ? 'var(--accent-border)' : 'var(--border)',
              background: days === numDays ? 'var(--accent-dim)' : 'transparent',
              color: days === numDays ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              {numDays}j
            </button>
          ))}
        </div>

        {/* Horizon selector */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {HORIZON_OPTIONS.map(h => (
            <HorizonTab key={h} value={h} active={horizon === h} onClick={setHorizon} />
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.2)', color: '#ff4d6d', fontSize: 11 }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 11 }}>
          Chargement…
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {/* KPI Cards */}
          <SectionTitle>Métriques clés — {asset} · +{horizon}</SectionTitle>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <KpiCard
              label="Win rate"
              value={d.win_rate != null ? d.win_rate.toFixed(1) + '%' : '—'}
              color={d.win_rate != null ? pctColor(d.win_rate - 50) : undefined}
              sub={`${d.settled_signals ?? 0} / ${d.total_signals ?? 0} settled`}
            />
            <KpiCard
              label="Avg return"
              value={fmt(d.avg_return, 3, '%')}
              color={pctColor(d.avg_return)}
              sub={d.confidence_interval_95
                ? `CI95 [${d.confidence_interval_95[0].toFixed(2)}%, ${d.confidence_interval_95[1].toFixed(2)}%]`
                : undefined}
            />
            <KpiCard
              label="Sharpe"
              value={fmt(d.sharpe_ratio, 2)}
              color={d.sharpe_ratio != null ? pctColor(d.sharpe_ratio) : undefined}
            />
            <KpiCard
              label="Max DD"
              value={d.max_drawdown != null ? '-' + d.max_drawdown.toFixed(2) + '%' : '—'}
              color={d.max_drawdown != null ? '#ff4d6d' : undefined}
            />
          </div>

          {/* Secondary KPIs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <KpiCard label="Avg gain"     value={fmt(d.avg_gain,  3, '%')} color="#26d97f" />
            <KpiCard label="Avg loss"     value={fmt(d.avg_loss,  3, '%')} color="#ff4d6d" />
            <KpiCard label="Trades"       value={d.trade_count ?? '—'}    />
            <KpiCard
              label="Exposure"
              value={d.exposure_time_pct != null ? d.exposure_time_pct.toFixed(1) + '%' : '—'}
            />
          </div>

          {/* Equity curve */}
          <SectionTitle>Equity curve (notional 100)</SectionTitle>
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <EquityChart equityCurve={d.equity_curve} />
          </div>

          {/* Drawdown */}
          {d.equity_curve?.length > 1 && (
            <>
              <SectionTitle>Drawdown</SectionTitle>
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
                <DrawdownChart equityCurve={d.equity_curve} />
              </div>
            </>
          )}

          {/* Histogram */}
          {d.equity_curve?.length > 2 && (
            <>
              <SectionTitle>Distribution des retours</SectionTitle>
              <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
                <ReturnHistogram equityCurve={d.equity_curve} />
              </div>
            </>
          )}

          {/* Horizon breakdown */}
          <SectionTitle>Breakdown par horizon</SectionTitle>
          <HorizonBreakdown breakdown={d.horizon_breakdown} />

          {/* Confusion matrix */}
          <SectionTitle>Matrice de confusion par type de signal</SectionTitle>
          <div style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <ConfusionMatrix matrix={d.confusion_matrix} />
          </div>

          {/* Export */}
          <SectionTitle>Export données</SectionTitle>
          <ExportButtons asset={asset} days={days} />
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Télécharge les signaux, ticks et outcomes pour analyse offline (Python/Excel).{' '}
            <a
              href="/docs/VALIDATION_GUIDE.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              Guide de validation →
            </a>
          </div>
        </>
      )}
    </div>
  )
}
