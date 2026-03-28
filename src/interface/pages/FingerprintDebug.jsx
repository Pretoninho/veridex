/**
 * FingerprintDebug.jsx
 *
 * Page de debug/monitoring pour le système de Market Fingerprinting.
 * Affiche en temps réel :
 *   - Statistiques globales (health status)
 *   - Tableau de tous les patterns enregistrés
 *   - Détail du pattern sélectionné (config, stats avancées par timeframe, timeline outcomes)
 *   - Distribution des mouvements (histogramme)
 */

import { useState } from 'react'
import useFingerprintDebug from '../hooks/useFingerprintDebug.js'
import { TIMEFRAMES } from '../../signals/market_fingerprint.js'
import './FingerprintDebug.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtRate(v) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function winRateColor(rate) {
  if (rate == null) return 'var(--text-ghost)'
  if (rate >= 60)   return 'var(--call)'
  if (rate <= 40)   return 'var(--put)'
  return 'var(--neutral)'
}

// ── Health Status ─────────────────────────────────────────────────────────────

function HealthStatus({ patterns, idbOk, lastUpdate, loading, onRefresh }) {
  const total      = patterns.length
  const totalObs   = patterns.reduce((s, p) => s + (p.occurrences ?? 0), 0)
  const withOutcomes = patterns.filter(p =>
    TIMEFRAMES.some(tf => p.patternStats?.[tf]?.occurrences > 0)
  ).length
  const pending    = patterns.filter(p =>
    (p.occurrences ?? 0) > 0 && !TIMEFRAMES.some(tf => p.patternStats?.[tf]?.occurrences > 0)
  ).length

  return (
    <div className="fp-health-bar">
      <div className="fp-health-indicator">
        <span className={`fp-idb-dot ${idbOk === true ? 'ok' : idbOk === false ? 'err' : 'unknown'}`} />
        <span className="fp-health-label">IndexedDB</span>
        <span className="fp-health-value">
          {idbOk === true ? 'OK' : idbOk === false ? 'Erreur' : '…'}
        </span>
      </div>

      <div className="fp-health-indicator">
        <span className="fp-health-label">Patterns</span>
        <span className="fp-health-value">{total}</span>
      </div>

      <div className="fp-health-indicator">
        <span className="fp-health-label">Observations</span>
        <span className="fp-health-value">{totalObs}</span>
      </div>

      <div className="fp-health-indicator">
        <span className="fp-health-label">Avec outcomes</span>
        <span className="fp-health-value">{withOutcomes}</span>
      </div>

      <div className="fp-health-indicator">
        <span className="fp-health-label">Dernière MAJ</span>
        <span className="fp-health-value">{lastUpdate ? fmtTs(lastUpdate) : '—'}</span>
      </div>

      <button
        className="fp-refresh-btn"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Rafraîchir"
      >
        {loading ? '…' : '↺'}
      </button>
    </div>
  )
}

// ── Pattern Table ─────────────────────────────────────────────────────────────

function PatternTable({ patterns, selected, onSelect }) {
  const [sortKey, setSortKey] = useState('occurrences')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...patterns].sort((a, b) => {
    let va, vb
    switch (sortKey) {
      case 'occurrences': va = a.occurrences ?? 0; vb = b.occurrences ?? 0; break
      case 'winRate_1h':  va = a.winRate_1h  ?? -1; vb = b.winRate_1h  ?? -1; break
      case 'avgMove_24h': va = a.avgMove_24h ?? -999; vb = b.avgMove_24h ?? -999; break
      default:            va = 0; vb = 0
    }
    return sortDir === 'desc' ? vb - va : va - vb
  })

  const SortIcon = ({ k }) => (
    <span className="fp-sort-icon">
      {sortKey === k ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
    </span>
  )

  return (
    <div className="fp-table-wrap">
      <table className="fp-table">
        <thead>
          <tr>
            <th>Hash</th>
            <th onClick={() => handleSort('occurrences')} className="fp-th-sort">
              Obs <SortIcon k="occurrences" />
            </th>
            <th onClick={() => handleSort('winRate_1h')} className="fp-th-sort">
              WR 1h <SortIcon k="winRate_1h" />
            </th>
            <th>WR 24h</th>
            <th onClick={() => handleSort('avgMove_24h')} className="fp-th-sort">
              Δ moy 24h <SortIcon k="avgMove_24h" />
            </th>
            <th>Config</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={6} className="fp-empty-row">Aucun pattern enregistré</td>
            </tr>
          ) : sorted.map(p => (
            <tr
              key={p.hash}
              className={`fp-tr ${selected?.hash === p.hash ? 'selected' : ''}`}
              onClick={() => onSelect(p)}
            >
              <td className="fp-td-mono">{p.hash.slice(0, 8)}…</td>
              <td>{p.occurrences ?? 0}</td>
              <td style={{ color: winRateColor(p.winRate_1h) }}>
                {p.winRate_1h != null ? `${p.winRate_1h}%` : '—'}
              </td>
              <td style={{ color: winRateColor(p.winRate_4h) }}>
                {p.winRate_4h != null ? `${p.winRate_4h}%` : '—'}
              </td>
              <td style={{ color: p.avgMove_24h > 0 ? 'var(--call)' : p.avgMove_24h < 0 ? 'var(--put)' : 'var(--text-muted)' }}>
                {fmtPct(p.avgMove_24h)}
              </td>
              <td className="fp-td-config">
                {p.config
                  ? `IV:${p.config.ivRankBucket ?? '?'} F:${p.config.fundingBucket ?? '?'} ${p.config.spreadBucket ?? '?'}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Config Badge ──────────────────────────────────────────────────────────────

function ConfigBadge({ label, value }) {
  return (
    <div className="fp-config-badge">
      <span className="fp-config-badge-label">{label}</span>
      <span className="fp-config-badge-value">{value ?? '—'}</span>
    </div>
  )
}

// ── Distribution Histogram ────────────────────────────────────────────────────

function DistributionBar({ distribution }) {
  if (!distribution) return <span className="fp-empty-text">Pas de données</span>

  const CATEGORIES = [
    { key: 'bigDown', label: '≪ -3%',      color: '#c0392b' },
    { key: 'down',    label: '-3% à -0.1%', color: 'var(--put)' },
    { key: 'flat',    label: '±0.1%',       color: 'var(--text-ghost)' },
    { key: 'up',      label: '+0.1% à +3%', color: 'var(--call)' },
    { key: 'bigUp',   label: '≫ +3%',       color: '#00e676' },
  ]

  const total = Object.values(distribution).reduce((s, v) => s + (v ?? 0), 0)

  return (
    <div className="fp-dist">
      {CATEGORIES.map(({ key, label, color }) => {
        const count = distribution[key] ?? 0
        const pct   = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={key} className="fp-dist-row">
            <span className="fp-dist-label">{label}</span>
            <div className="fp-dist-bar-wrap">
              <div
                className="fp-dist-bar"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
            <span className="fp-dist-count" style={{ color }}>
              {count} <span className="fp-dist-pct">({pct.toFixed(0)}%)</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Timeframe Stats ───────────────────────────────────────────────────────────

function TimeframeStat({ tf, stats, advanced }) {
  if (!stats || !stats.occurrences) {
    return (
      <div className="fp-tf-card fp-tf-empty">
        <div className="fp-tf-label">{tf}</div>
        <div className="fp-empty-text">Pas encore de données</div>
      </div>
    )
  }

  return (
    <div className="fp-tf-card">
      <div className="fp-tf-label">{tf}</div>
      <div className="fp-tf-stats">
        <div className="fp-tf-stat">
          <span className="fp-tf-stat-label">Occurrences</span>
          <span className="fp-tf-stat-value">{stats.occurrences}</span>
        </div>
        {advanced && (
          <>
            <div className="fp-tf-stat">
              <span className="fp-tf-stat-label">Prob. hausse</span>
              <span className="fp-tf-stat-value" style={{ color: 'var(--call)' }}>
                {fmtRate(advanced.probUp)}
              </span>
            </div>
            <div className="fp-tf-stat">
              <span className="fp-tf-stat-label">Prob. baisse</span>
              <span className="fp-tf-stat-value" style={{ color: 'var(--put)' }}>
                {fmtRate(advanced.probDown)}
              </span>
            </div>
            <div className="fp-tf-stat">
              <span className="fp-tf-stat-label">Espérance</span>
              <span
                className="fp-tf-stat-value"
                style={{ color: advanced.expectedValue > 0 ? 'var(--call)' : advanced.expectedValue < 0 ? 'var(--put)' : 'var(--text-muted)' }}
              >
                {fmtPct(advanced.expectedValue)}
              </span>
            </div>
            {advanced.riskReward != null && (
              <div className="fp-tf-stat">
                <span className="fp-tf-stat-label">Risk/Reward</span>
                <span className="fp-tf-stat-value">{advanced.riskReward.toFixed(2)}</span>
              </div>
            )}
          </>
        )}
      </div>
      <DistributionBar distribution={advanced?.distribution} />
    </div>
  )
}

// ── Outcome Timeline ──────────────────────────────────────────────────────────

function OutcomeTimeline({ outcomes }) {
  if (!outcomes?.length) {
    return <div className="fp-empty-text">Aucun outcome enregistré</div>
  }

  const recent = [...outcomes].reverse().slice(0, 20)

  return (
    <div className="fp-timeline">
      {recent.map((o, i) => (
        <div key={i} className="fp-timeline-row">
          <div className="fp-timeline-ts">{fmtTs(o.ts)}</div>
          <div className="fp-timeline-price">
            {o.price != null ? `$${o.price.toLocaleString('en-US')}` : '—'}
          </div>
          <div className="fp-timeline-results">
            <OutcomeResult label="1h"  value={o.result_1h} />
            <OutcomeResult label="4h"  value={o.result_4h} />
            <OutcomeResult label="24h" value={o.result_24h} />
            <OutcomeResult label="7d"  value={o.result_7d} />
          </div>
        </div>
      ))}
    </div>
  )
}

function OutcomeResult({ label, value }) {
  const isPending = value == null
  return (
    <span className={`fp-outcome-chip ${isPending ? 'pending' : value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`}>
      {label}: {isPending ? '⏳' : fmtPct(value)}
    </span>
  )
}

// ── Pattern Detail ────────────────────────────────────────────────────────────

function PatternDetail({ pattern }) {
  const [activeTab, setActiveTab] = useState('stats')

  if (!pattern) {
    return (
      <div className="fp-detail-empty">
        Sélectionnez un pattern dans le tableau pour voir ses détails
      </div>
    )
  }

  const cfg = pattern.config ?? {}

  return (
    <div className="fp-detail">
      {/* Header */}
      <div className="fp-detail-header">
        <div className="fp-detail-hash">{pattern.hash}</div>
        <div className="fp-detail-count">{pattern.occurrences} observation{pattern.occurrences !== 1 ? 's' : ''}</div>
      </div>

      {/* Config */}
      <div className="fp-config-row">
        <ConfigBadge label="IV Rank"  value={cfg.ivRankBucket  != null ? `${cfg.ivRankBucket}` : null} />
        <ConfigBadge label="Funding"  value={cfg.fundingBucket != null ? `${cfg.fundingBucket}%` : null} />
        <ConfigBadge label="Spread"   value={cfg.spreadBucket} />
        <ConfigBadge label="L/S"      value={cfg.lsBucket} />
        <ConfigBadge label="Basis"    value={cfg.basisBucket} />
      </div>

      {/* Onglets */}
      <div className="fp-detail-tabs">
        {[
          { id: 'stats',    label: 'Statistiques' },
          { id: 'outcomes', label: 'Timeline outcomes' },
        ].map(t => (
          <button
            key={t.id}
            className={`fp-detail-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {activeTab === 'stats' && (
        <div className="fp-tf-grid">
          {TIMEFRAMES.map(tf => (
            <TimeframeStat
              key={tf}
              tf={tf}
              stats={pattern.patternStats?.[tf] ?? null}
              advanced={pattern.advanced?.[tf] ?? null}
            />
          ))}
        </div>
      )}

      {activeTab === 'outcomes' && (
        <OutcomeTimeline outcomes={pattern.outcomes} />
      )}
    </div>
  )
}

// ── FingerprintDebug ──────────────────────────────────────────────────────────

export default function FingerprintDebug() {
  const { patterns, loading, error, idbOk, lastUpdate, refresh } = useFingerprintDebug()
  const [selected, setSelected] = useState(null)

  // Quand les patterns sont mis à jour, re-sync l'objet sélectionné
  const selectedFresh = selected
    ? patterns.find(p => p.hash === selected.hash) ?? selected
    : null

  return (
    <div className="page-wrap fp-page">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Fingerprint <span>Debug</span></div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)' }}>
          Monitoring · Lecture seule
        </div>
      </div>

      {/* Health bar */}
      <HealthStatus
        patterns={patterns}
        idbOk={idbOk}
        lastUpdate={lastUpdate}
        loading={loading}
        onRefresh={refresh}
      />

      {/* Erreur */}
      {error && (
        <div className="fp-error-banner">⚠ {error}</div>
      )}

      {/* Chargement initial */}
      {loading && patterns.length === 0 ? (
        <div className="fp-loading">Chargement des patterns…</div>
      ) : (
        <div className="fp-layout">
          {/* Colonne gauche : tableau */}
          <div className="fp-col-left">
            <div className="card">
              <div className="card-header">
                Patterns enregistrés
                <span className="fp-badge">{patterns.length}</span>
              </div>
              <PatternTable
                patterns={patterns}
                selected={selectedFresh}
                onSelect={setSelected}
              />
            </div>
          </div>

          {/* Colonne droite : détail */}
          <div className="fp-col-right">
            <div className="card fp-detail-card">
              <div className="card-header">Détail du pattern</div>
              <PatternDetail pattern={selectedFresh} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
