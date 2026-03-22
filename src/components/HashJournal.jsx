/**
 * HashJournal.jsx
 *
 * Journal unifié de hashage — 4 types d'entrées :
 *   Signal | Anomalie | Pattern | Cache
 *
 * Utilise buildSearchIndex() + applyFilters() de hash_search.js.
 * Lecture seule. Aucun appel API. Aucun signal généré.
 */

import { useState, useEffect, useCallback } from 'react'
import { buildSearchIndex, applyFilters } from '../data_core/data_store/hash_search.js'

const PAGE_SIZE = 30

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtTimeMs(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

// ── JSON highlight minimal ────────────────────────────────────────────────────

function JsonValue({ value }) {
  if (value === null)             return <span style={{ color: 'var(--text-ghost)' }}>null</span>
  if (typeof value === 'boolean') return <span style={{ color: value ? 'var(--call)' : 'var(--put)' }}>{String(value)}</span>
  if (typeof value === 'number')  return <span style={{ color: 'var(--neutral)' }}>{value}</span>
  if (typeof value === 'string')  return <span style={{ color: 'var(--accent)' }}>"{value}"</span>
  return <span style={{ color: 'var(--text-muted)' }}>{String(value)}</span>
}

function JsonNode({ data, indent = 0 }) {
  const pad = '  '.repeat(indent)
  if (Array.isArray(data)) {
    if (!data.length) return <span style={{ color: 'var(--text-muted)' }}>[]</span>
    return (
      <span>
        {'['}<br />
        {data.map((v, i) => (
          <span key={i}>
            {pad + '  '}
            <JsonNode data={v} indent={indent + 1} />
            {i < data.length - 1 ? ',' : ''}<br />
          </span>
        ))}
        {pad}{']'}
      </span>
    )
  }
  if (typeof data === 'object' && data !== null) {
    const keys = Object.keys(data)
    if (!keys.length) return <span style={{ color: 'var(--text-muted)' }}>{'{}'}</span>
    return (
      <span>
        {'{'}<br />
        {keys.map((k, i) => (
          <span key={k}>
            {pad + '  '}
            <span style={{ color: 'var(--text-muted)' }}>"{k}"</span>
            {': '}
            <JsonNode data={data[k]} indent={indent + 1} />
            {i < keys.length - 1 ? ',' : ''}<br />
          </span>
        ))}
        {pad}{'}'}
      </span>
    )
  }
  return <JsonValue value={data} />
}

// ── CopyHash ──────────────────────────────────────────────────────────────────

function CopyHash({ hash }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(hash).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  return (
    <button
      onClick={copy}
      style={{
        background: 'none', border: '1px solid var(--border)',
        borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
        color: copied ? 'var(--call)' : 'var(--text-muted)',
        transition: 'all 150ms ease',
      }}
    >
      {copied ? 'Copié ✓' : 'Copier hash'}
    </button>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function JournalSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 16px', borderLeft: '3px solid var(--border)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="skeleton" style={{ width: 80, height: 12 }} />
            <div className="skeleton" style={{ width: 60, height: 12 }} />
          </div>
          <div className="skeleton" style={{ width: '60%', height: 12, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: '40%', height: 12 }} />
        </div>
      ))}
    </div>
  )
}

// ── Entrée Signal ─────────────────────────────────────────────────────────────

function SignalEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const raw = entry.raw ?? entry
  const c   = raw.conditions ?? {}

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: '3px solid var(--call)', borderRadius: 10,
      padding: '14px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--call)' }}>
          🟢 Signal
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {fmtTime(entry.ts ?? raw.timestamp)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          ['Hash',     entry.hash,                                      'var(--font-mono)'],
          ['Asset',    raw.asset,                                       null],
          ['Score',    raw.score != null ? `${raw.score}/100` : '—',   null],
          ['Signal',   raw.recommendation,                              null],
          ['Market ⟠', raw.marketHash,                                 'var(--font-mono)'],
        ].map(([label, val, font]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontFamily: font ?? 'var(--font-body)', fontSize: 12, color: 'var(--text)', marginTop: 2 }}>
              {val ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(c).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            CONDITIONS
          </div>
          {Object.entries(c).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{v ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <CopyHash hash={entry.hash} />
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            color: 'var(--text-muted)', transition: 'all 150ms ease',
          }}
        >
          {expanded ? 'Masquer ▲' : 'Voir détails ▼'}
        </button>
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, background: 'var(--bg-base)', borderRadius: 6,
          padding: '10px 12px', overflowX: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
        }}>
          <JsonNode data={raw} />
        </div>
      )}
    </div>
  )
}

// ── Entrée Anomalie ───────────────────────────────────────────────────────────

function AnomalyEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const raw         = entry.raw ?? entry
  const isCritical  = (entry.severity ?? raw.severity) === 'critical'
  const borderColor = isCritical ? 'var(--put)' : 'var(--neutral)'
  const labelColor  = isCritical ? 'var(--put)' : 'var(--neutral)'

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${borderColor}`, borderRadius: 10,
      padding: '14px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: labelColor }}>
          {isCritical ? '🔴 Anomalie critique' : '⚠ Anomalie'}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {fmtTime(entry.ts ?? raw.timestamp)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          ['Hash',        entry.hash],
          ['Asset',       raw.asset],
          ['Sévérité',    (entry.severity ?? raw.severity)?.toUpperCase() ?? '—'],
          ['Indicateurs', raw.count ?? (raw.changedIndicators?.length ?? 0)],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontFamily: label === 'Hash' ? 'var(--font-mono)' : 'var(--font-body)', fontSize: 12, color: label === 'Sévérité' ? labelColor : 'var(--text)', marginTop: 2 }}>
              {val ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {raw.changedIndicators?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            DÉTAIL
          </div>
          {raw.changedIndicators.map(ind => (
            <div key={ind} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>
              → {ind} <span style={{ color: labelColor }}>(changé)</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CopyHash hash={entry.hash} />
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            color: 'var(--text-muted)', transition: 'all 150ms ease',
          }}
        >
          {expanded ? 'Masquer ▲' : 'Voir détails ▼'}
        </button>
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, background: 'var(--bg-base)', borderRadius: 6,
          padding: '10px 12px', overflowX: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
        }}>
          <JsonNode data={raw} />
        </div>
      )}
    </div>
  )
}

// ── Entrée Pattern ────────────────────────────────────────────────────────────

function PatternEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const raw = entry.raw ?? entry
  const cfg = raw.config ?? {}

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: '3px solid var(--accent)', borderRadius: 10,
      padding: '14px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          ◈ Pattern
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>—</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          ['Hash',        entry.hash],
          ['Occurrences', raw.occurrences],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontFamily: label === 'Hash' ? 'var(--font-mono)' : 'var(--font-display)', fontSize: 12, color: 'var(--text)', marginTop: 2 }}>
              {val ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(cfg).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            CONFIGURATION
          </div>
          {Object.entries(cfg).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{v ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          PERFORMANCE
        </div>
        {[
          ['Win Rate 1h',  raw.winRate_1h  != null ? `${raw.winRate_1h}%`                                    : '—'],
          ['Win Rate 4h',  raw.winRate_4h  != null ? `${raw.winRate_4h}%`                                    : '—'],
          ['Avg Move 24h', raw.avgMove_24h != null ? `${raw.avgMove_24h > 0 ? '+' : ''}${raw.avgMove_24h}%` : '—'],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CopyHash hash={entry.hash} />
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            color: 'var(--text-muted)', transition: 'all 150ms ease',
          }}
        >
          {expanded ? 'Masquer ▲' : 'Voir détails ▼'}
        </button>
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, background: 'var(--bg-base)', borderRadius: 6,
          padding: '10px 12px', overflowX: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
        }}>
          <JsonNode data={raw} />
        </div>
      )}
    </div>
  )
}

// ── Entrée Settlement ─────────────────────────────────────────────────────────

function SettlementEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const raw = entry.raw ?? entry

  const fmtPrice = (n, asset) => {
    if (n == null) return '—'
    return '$' + Number(n).toLocaleString('en-US', {
      maximumFractionDigits: asset === 'ETH' ? 2 : 0,
    })
  }
  const fmtDelta = (label) => {
    if (!label) return '—'
    const n = parseFloat(label)
    return (
      <span style={{ color: n > 0 ? 'var(--call)' : n < 0 ? 'var(--put)' : 'var(--text-muted)' }}>
        {label}
      </span>
    )
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: '3px solid #A78BFA', borderRadius: 10,
      padding: '14px 16px', marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>
          🏛 Settlement
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {raw.dateKey ?? '—'} · 08:00 UTC
        </span>
      </div>

      {/* Données principales */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          ['Hash',  entry.hash,                              'var(--font-mono)'],
          ['Asset', raw.asset,                              null],
          ['Prix',  fmtPrice(raw.settlementPrice, raw.asset), null],
          ['Source', raw.source ?? 'deribit',               null],
        ].map(([label, val, font]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontFamily: font ?? 'var(--font-body)', fontSize: 12, color: 'var(--text)', marginTop: 2 }}>
              {val ?? '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Contexte au fixing */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          CONTEXTE AU FIXING
        </div>
        {[
          ['vs Spot',     raw.spotDeltaLabel],
          ['vs Max Pain', raw.maxPainDeltaLabel
            ? `${raw.maxPainDeltaLabel} (${fmtPrice(raw.maxPainStrike, raw.asset)})`
            : null],
          ['IV Rank',     raw.ivRank != null ? `${raw.ivRank}` : null],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {val != null ? fmtDelta(val) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Flags */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          FLAGS
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>Capture</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: raw.isLate ? 'var(--neutral)' : 'var(--call)' }}>
            {raw.isLate ? 'Différée ⚠' : 'À l\'heure ✓'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <CopyHash hash={entry.hash} />
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '4px 10px', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            color: 'var(--text-muted)', transition: 'all 150ms ease',
          }}
        >
          {expanded ? 'Masquer ▲' : 'Voir détails ▼'}
        </button>
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, background: 'var(--bg-base)', borderRadius: 6,
          padding: '10px 12px', overflowX: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
        }}>
          <JsonNode data={raw} />
        </div>
      )}
    </div>
  )
}

// ── Entrée Cache ──────────────────────────────────────────────────────────────

function CacheEntry({ entry }) {
  const [copied, setCopied] = useState(false)
  const raw = entry.raw ?? entry
  const copy = () => {
    navigator.clipboard?.writeText(entry.hash).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderLeft: '3px solid var(--border-bright)', borderRadius: 10,
      padding: '12px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          ⚡ Cache
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          {fmtTimeMs(entry.ts ?? raw.ts)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 10 }}>
        {[
          ['Clé',  raw.key],
          ['Hash', entry.hash],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', marginTop: 2, wordBreak: 'break-all' }}>
              {val ?? '—'}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={copy}
        style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer',
          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
          color: copied ? 'var(--call)' : 'var(--text-muted)', transition: 'all 150ms ease',
        }}
      >
        {copied ? 'Copié ✓' : 'Copier hash'}
      </button>
    </div>
  )
}

// ── SearchBar ─────────────────────────────────────────────────────────────────

const EMPTY_FILTERS = {
  hashQuery:  '',
  dateFrom:   '',
  dateTo:     '',
  eventQuery: '',
  types:      [],
  asset:      '',
}

const TYPE_OPTS = [
  { id: 'signal',     label: 'Signaux' },
  { id: 'anomaly',    label: 'Anomalies' },
  { id: 'pattern',    label: 'Patterns' },
  { id: 'cache',      label: 'Cache' },
  { id: 'settlement', label: 'Settlements' },
]

const DEFAULT_FILTERS = { ...EMPTY_FILTERS, types: ['signal', 'anomaly', 'pattern', 'settlement'] }

const ASSET_OPTS = ['', 'BTC', 'ETH']

function SearchBar({ filters, onChange, totalResults, isLoading }) {
  const { hashQuery, dateFrom, dateTo, eventQuery, types, asset } = filters

  const set = (key, val) => onChange({ ...filters, [key]: val })

  const toggleType = (id) => {
    const next = types.includes(id)
      ? types.filter(t => t !== id)
      : [...types, id]
    onChange({ ...filters, types: next })
  }

  const clearAll = () => onChange(DEFAULT_FILTERS)

  const hasActiveFilters =
    hashQuery || dateFrom || dateTo || eventQuery || asset ||
    JSON.stringify([...types].sort()) !== JSON.stringify([...DEFAULT_FILTERS.types].sort())

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '14px 16px', marginBottom: 16,
    }}>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 12,
      }}>
        RECHERCHER
      </div>

      {/* Champ Hash */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input
          type="text"
          value={hashQuery}
          onChange={e => set('hashQuery', e.target.value)}
          placeholder="Rechercher un hash..."
          style={{
            width: '100%', padding: '8px 32px 8px 12px',
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: 8, color: 'var(--text)', fontSize: 12,
            fontFamily: 'var(--font-mono)', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {hashQuery && (
          <button onClick={() => set('hashQuery', '')} style={CLEAR_BTN_STYLE}>×</button>
        )}
      </div>

      {/* Dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {[['Du', 'dateFrom', dateFrom], ['Au', 'dateTo', dateTo]].map(([lbl, key, val]) => (
          <div key={key}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 4 }}>
              {lbl}
            </div>
            <input
              type="date"
              value={val}
              onChange={e => set(key, e.target.value)}
              style={{
                width: '100%', padding: '7px 10px',
                background: 'var(--bg-base)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text)', fontSize: 12,
                fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box',
                colorScheme: 'dark',
              }}
            />
          </div>
        ))}
      </div>

      {/* Champ événement */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input
          type="text"
          value={eventQuery}
          onChange={e => set('eventQuery', e.target.value)}
          placeholder="Type, asset, indicateur... (ex: BTC, warning, score:91)"
          style={{
            width: '100%', padding: '8px 32px 8px 12px',
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: 8, color: 'var(--text)', fontSize: 12,
            fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box',
          }}
        />
        {eventQuery && (
          <button onClick={() => set('eventQuery', '')} style={CLEAR_BTN_STYLE}>×</button>
        )}
      </div>

      {/* Filtres par type */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
          FILTRES
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => onChange({ ...filters, types: [] })}
            style={filterBtnStyle(types.length === 0)}
          >
            Tous
          </button>
          {TYPE_OPTS.map(t => (
            <button
              key={t.id}
              onClick={() => toggleType(t.id)}
              style={filterBtnStyle(types.includes(t.id))}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Asset */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
          ASSET
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {ASSET_OPTS.map(opt => (
            <button
              key={opt || 'all'}
              onClick={() => set('asset', opt)}
              style={filterBtnStyle(asset === opt)}
            >
              {opt || 'Tous'}
            </button>
          ))}
        </div>
      </div>

      {/* Résultats + clear */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>
          {isLoading ? 'Chargement…' : `${totalResults} résultat${totalResults !== 1 ? 's' : ''} trouvé${totalResults !== 1 ? 's' : ''}`}
        </span>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 10px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
              color: 'var(--text-muted)', transition: 'all 150ms ease',
            }}
          >
            Effacer les filtres
          </button>
        )}
      </div>
    </div>
  )
}

const CLEAR_BTN_STYLE = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0,
}

function filterBtnStyle(active) {
  return {
    padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
    border: '1px solid',
    borderColor: active ? 'var(--accent-border, var(--accent))' : 'var(--border)',
    background:  active ? 'var(--accent-dim)'                   : 'transparent',
    color:       active ? 'var(--accent)'                       : 'var(--text-muted)',
    transition: 'all 150ms ease',
  }
}

// ── État vide ─────────────────────────────────────────────────────────────────

function EmptyState({ filters, onClear }) {
  const q = filters.hashQuery || filters.eventQuery || ''
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>◻</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
        Aucun résultat
      </div>
      {q && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          "{q}" introuvable
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Vérifier le hash ou élargir la plage de dates
      </div>
      <button
        onClick={onClear}
        style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 16px', cursor: 'pointer',
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
          color: 'var(--text-muted)', transition: 'all 150ms ease',
        }}
      >
        Effacer les filtres
      </button>
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

/**
 * HashJournal — journal de hashage avec moteur de recherche.
 *
 * Props (rétro-compat avec AuditPage — ignorées si présentes,
 * les données viennent maintenant de buildSearchIndex()) :
 *   onRefresh? : () => void   — bouton Actualiser
 */
export default function HashJournal({ onRefresh }) {
  const [searchIndex, setSearchIndex] = useState([])
  const [isLoading,   setIsLoading]   = useState(true)
  const [filters,     setFilters]     = useState(DEFAULT_FILTERS)
  const [results,     setResults]     = useState([])
  const [page,        setPage]        = useState(1)

  // Charger l'index au montage et au refresh
  const loadIndex = useCallback(async () => {
    setIsLoading(true)
    try {
      const index = await buildSearchIndex()
      setSearchIndex(index)
      setResults(applyFilters(index, filters))
    } catch (_) {}
    setIsLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadIndex() }, [loadIndex])

  // Recalculer les résultats à chaque changement de filtre
  useEffect(() => {
    setResults(applyFilters(searchIndex, filters))
    setPage(1)
  }, [searchIndex, filters])

  const handleFiltersChange = (next) => {
    setFilters(next)
  }

  const handleRefresh = async () => {
    await loadIndex()
    if (onRefresh) onRefresh()
  }

  const paginated = results.slice(0, page * PAGE_SIZE)
  const hasMore   = paginated.length < results.length

  // Compteurs par source pour le header
  const counts = {
    signal:     searchIndex.filter(e => e.type === 'signal').length,
    anomaly:    searchIndex.filter(e => e.type === 'anomaly').length,
    cache:      searchIndex.filter(e => e.type === 'cache').length,
    settlement: searchIndex.filter(e => e.type === 'settlement').length,
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            JOURNAL DE HASHAGE
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'Signaux',     count: counts.signal,     color: 'var(--call)' },
              { label: 'Anomalies',   count: counts.anomaly,    color: 'var(--neutral)' },
              { label: 'Cache',       count: counts.cache,      color: 'var(--border-bright)' },
              { label: 'Settlements', count: counts.settlement, color: '#A78BFA' },
            ].map(({ label, count, color }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
                borderRadius: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)' }}>
                  {label}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            padding: '7px 12px', cursor: isLoading ? 'default' : 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all 150ms ease', flexShrink: 0, opacity: isLoading ? 0.5 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Actualiser
        </button>
      </div>

      {/* Moteur de recherche */}
      <SearchBar
        filters={filters}
        onChange={handleFiltersChange}
        totalResults={results.length}
        isLoading={isLoading}
      />

      {/* Liste */}
      {isLoading ? (
        <JournalSkeleton />
      ) : paginated.length === 0 ? (
        <EmptyState filters={filters} onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : (
        <>
          {paginated.map((entry, i) => {
            const key = `${entry.type}-${entry.id ?? entry.hash ?? i}-${i}`
            if (entry.type === 'signal')     return <SignalEntry     key={key} entry={entry} />
            if (entry.type === 'anomaly')    return <AnomalyEntry    key={key} entry={entry} />
            if (entry.type === 'pattern')    return <PatternEntry    key={key} entry={entry} />
            if (entry.type === 'cache')      return <CacheEntry      key={key} entry={entry} />
            if (entry.type === 'settlement') return <SettlementEntry key={key} entry={entry} />
            return null
          })}

          {hasMore && (
            <button
              onClick={() => setPage(p => p + 1)}
              style={{
                width: '100%', padding: '10px', marginTop: 4,
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 10, cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                color: 'var(--text-muted)', transition: 'all 150ms ease',
              }}
            >
              Charger 30 de plus ({results.length - paginated.length} restants)
            </button>
          )}
        </>
      )}
    </div>
  )
}
