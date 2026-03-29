/**
 * MonitorPage.jsx
 *
 * Page de monitoring temps réel : graphique de prix avec superposition
 * des patterns détectés et des fenêtres d'annonces macro.
 *
 * Composants :
 *   - Sélecteur asset / intervalle / nombre de bougies
 *   - PriceChartWithPatterns (bougies + markers patterns + éco events)
 *   - Résumé patterns : total, en fenêtre news, dernier détecté
 */

import { useState, useEffect, useCallback } from 'react'
import PriceChartWithPatterns from '../components/PriceChartWithPatterns.jsx'
import usePriceData           from '../hooks/usePriceData.js'
import { getPatternAuditLog } from '../../signals/pattern_audit.js'
import { getCachedEconomicEvents } from '../../signals/economic_calendar.js'

// ── Constantes ────────────────────────────────────────────────────────────────

const INTERVALS = [
  { value: '15m', label: '15 min' },
  { value: '1h',  label: '1 h'   },
  { value: '4h',  label: '4 h'   },
  { value: '1d',  label: '1 j'   },
]

const LIMITS = [
  { value: 50,  label: '50 bougies'  },
  { value: 100, label: '100 bougies' },
  { value: 200, label: '200 bougies' },
]

const AUDIT_REFRESH_MS = 15_000

// ── Styles inline partagés ────────────────────────────────────────────────────

const S = {
  page: {
    padding: '12px 12px 32px',
    fontFamily: 'var(--font-body, sans-serif)',
    color: 'var(--text-primary, #e2e8f0)',
    maxWidth: 900,
    margin: '0 auto',
  },
  row: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
  },
  label: {
    fontSize: 10, color: 'var(--text-muted, #8892a4)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  select: {
    background: 'var(--surface-2, #1a1f2e)',
    border: '1px solid var(--border, #2a2f3d)',
    borderRadius: 4, color: 'var(--text-primary, #e2e8f0)',
    padding: '4px 8px', fontSize: 11, cursor: 'pointer',
  },
  card: {
    background: 'var(--surface-1, #12151f)',
    border: '1px solid var(--border, #2a2f3d)',
    borderRadius: 8, padding: '10px 14px',
  },
  statValue: {
    fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em',
    fontFamily: 'var(--font-mono, monospace)',
  },
  statLabel: {
    fontSize: 9, color: 'var(--text-muted, #8892a4)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    marginTop: 2,
  },
  errorBanner: {
    background: 'rgba(239,83,80,.08)',
    border: '1px solid rgba(239,83,80,.25)',
    borderRadius: 6, padding: '8px 12px',
    fontSize: 11, color: '#ef5350',
  },
}

// ── Sous-composant : barre de contrôles ───────────────────────────────────────

function ControlBar({ asset, onAsset, interval, onInterval, limit, onLimit }) {
  return (
    <div style={{ ...S.row, marginBottom: 12 }}>
      <span style={S.label}>Asset</span>
      {['BTC', 'ETH'].map(a => (
        <button
          key={a}
          onClick={() => onAsset(a)}
          style={{
            ...S.select,
            background: asset === a ? 'var(--accent-blue, #3b82f6)' : undefined,
            color:      asset === a ? '#fff' : undefined,
            fontWeight: asset === a ? 700 : 400,
          }}
        >
          {a}
        </button>
      ))}

      <span style={{ ...S.label, marginLeft: 8 }}>Intervalle</span>
      <select style={S.select} value={interval} onChange={e => onInterval(e.target.value)}>
        {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>

      <span style={{ ...S.label, marginLeft: 8 }}>Bougies</span>
      <select style={S.select} value={limit} onChange={e => onLimit(Number(e.target.value))}>
        {LIMITS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
    </div>
  )
}

// ── Sous-composant : stats résumé ─────────────────────────────────────────────

function StatsRow({ auditLog, asset }) {
  const filtered = auditLog.filter(e => !e.asset || e.asset === asset)
  const inWindow = filtered.filter(e => e.newsWindow?.inWindow).length
  const last     = filtered[filtered.length - 1]
  const lastTime = last
    ? new Date(last.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '—'
  const lastPrice = last?.spot != null
    ? last.spot.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
    : '—'

  const stats = [
    { value: filtered.length, label: 'Patterns détectés', color: '#4fc3f7' },
    { value: inWindow,         label: 'En fenêtre news',   color: '#f0476b' },
    { value: lastTime,         label: 'Dernier à',         color: '#a0aec0' },
    { value: lastPrice,        label: 'Prix (dernier)',    color: '#26a69a' },
  ]

  return (
    <div style={{ ...S.row, gap: 12, marginBottom: 12 }}>
      {stats.map(s => (
        <div key={s.label} style={{ ...S.card, minWidth: 100, flex: '1 1 100px' }}>
          <div style={{ ...S.statValue, color: s.color }}>{s.value}</div>
          <div style={S.statLabel}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Sous-composant : mini table audit ─────────────────────────────────────────

function RecentDetections({ auditLog, asset }) {
  const entries = auditLog
    .filter(e => !e.asset || e.asset === asset)
    .slice(-10)
    .reverse()

  if (entries.length === 0) return (
    <div style={{ ...S.card, fontSize: 11, color: 'var(--text-ghost, #4a5260)', textAlign: 'center', padding: 20 }}>
      Aucun pattern enregistré — lancez une analyse de signaux pour commencer.
    </div>
  )

  return (
    <div style={S.card}>
      <div style={{ fontSize: 10, color: 'var(--text-muted, #8892a4)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        10 dernières détections
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted, #8892a4)', borderBottom: '1px solid var(--border, #2a2f3d)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 400 }}>Heure</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>Prix</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>Occur.</th>
              <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 400 }}>News</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 400 }}>Hash</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const nw      = e.newsWindow ?? {}
              const inWin   = nw.inWindow
              const close   = nw.minutesAway != null && Math.abs(nw.minutesAway) <= 60
              const newsCell = inWin
                ? <span style={{ color: '#f0476b' }}>⚡ {nw.event?.currency ?? ''}</span>
                : close
                  ? <span style={{ color: '#ffb74d' }}>~{Math.round(Math.abs(nw.minutesAway))}m</span>
                  : <span style={{ color: '#4a5260' }}>—</span>

              return (
                <tr
                  key={i}
                  style={{
                    background: inWin ? 'rgba(240,71,107,.04)' : 'transparent',
                    borderBottom: '1px solid rgba(42,47,61,.4)',
                  }}
                >
                  <td style={{ padding: '4px 6px', color: 'var(--text-secondary, #a0aec0)' }}>
                    {new Date(e.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px' }}>
                    {e.spot != null ? e.spot.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '4px 6px', color: '#4fc3f7' }}>
                    {e.occurrences ?? '?'}
                  </td>
                  <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                    {newsCell}
                  </td>
                  <td style={{ padding: '4px 6px', color: '#4a5260', fontSize: 9 }}>
                    {e.hash?.slice(0, 8) ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function MonitorPage({ asset: initialAsset = 'BTC' }) {
  const [asset,    setAsset]    = useState(initialAsset)
  const [interval, setInterval] = useState('1h')
  const [limit,    setLimit]    = useState(100)
  const [auditLog, setAuditLog] = useState([])
  const [econEvents, setEconEvents] = useState([])

  const { candles, loading, error } = usePriceData(asset, interval, limit)

  // Charger audit log + éco events
  const loadAudit = useCallback(() => {
    try {
      setAuditLog(getPatternAuditLog(200))
    } catch (_) {}
    try {
      setEconEvents(getCachedEconomicEvents().events ?? [])
    } catch (_) {}
  }, [])

  useEffect(() => {
    loadAudit()
    const t = setInterval(loadAudit, AUDIT_REFRESH_MS)
    return () => clearInterval(t)
  }, [loadAudit])

  // Sync asset depuis le prop parent (header)
  useEffect(() => { setAsset(initialAsset) }, [initialAsset])

  return (
    <div style={S.page}>

      {/* Titre */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Monitoring · Patterns sur graphique
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted, #8892a4)' }}>
          Détections superposées sur les bougies · fenêtres news ⚡ · événements macro —
        </p>
      </div>

      {/* Contrôles */}
      <ControlBar
        asset={asset}   onAsset={setAsset}
        interval={interval} onInterval={setInterval}
        limit={limit}   onLimit={setLimit}
      />

      {/* Stats résumé */}
      <StatsRow auditLog={auditLog} asset={asset} />

      {/* Graphique */}
      <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        {error && (
          <div style={{ ...S.errorBanner, margin: 10 }}>
            ⚠ Erreur de chargement des prix : {error}
          </div>
        )}
        {loading && candles.length === 0 ? (
          <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-ghost, #4a5260)', fontSize: 12 }}>
            Chargement des bougies…
          </div>
        ) : (
          <PriceChartWithPatterns
            candles={candles}
            auditLog={auditLog}
            econEvents={econEvents}
            asset={asset}
            height={320}
          />
        )}
      </div>

      {/* Dernières détections */}
      <RecentDetections auditLog={auditLog} asset={asset} />

    </div>
  )
}
