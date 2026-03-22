/**
 * AuditPage.jsx
 *
 * Volet d'audit des données Veridex.
 * Onglets : Vue générale | Journal de hashage
 *
 * Lecture seule. Aucun appel API.
 */

import { useState, useEffect, useCallback } from 'react'
import { getSignalHistory, getAnomalyLog }  from '../data_processing/signals/signal_engine.js'
import { getAllPatterns }                    from '../data_processing/signals/market_fingerprint.js'
import { smartCache }                        from '../data_core/data_store/cache.js'
import HashJournal                           from '../components/HashJournal.jsx'
import SnapshotManager                       from '../components/SnapshotManager.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

// ── Vue générale ──────────────────────────────────────────────────────────────

function OverviewTab({ signalCount, anomalyCount, patternCount, cacheCount, lastAnomaly }) {
  const stats = [
    { label: 'Signaux enregistrés', value: signalCount, color: 'var(--call)' },
    { label: 'Anomalies détectées', value: anomalyCount, color: 'var(--neutral)' },
    { label: 'Patterns fingerprint', value: patternCount, color: 'var(--accent)' },
    { label: 'Changements cache', value: cacheCount, color: 'var(--border-bright)' },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {stats.map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color, fontSize: 26 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">Dernière anomalie détectée</div>
        <div style={{ padding: '14px 18px' }}>
          {lastAnomaly ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                  {lastAnomaly.hash}
                </span>
                <span style={{
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 4,
                  background: lastAnomaly.severity === 'critical' ? 'rgba(240,71,107,.12)' : 'rgba(245,166,35,.12)',
                  color: lastAnomaly.severity === 'critical' ? 'var(--put)' : 'var(--neutral)',
                  textTransform: 'uppercase',
                }}>
                  {lastAnomaly.severity}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
                {fmtTs(lastAnomaly.timestamp)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(lastAnomaly.changedIndicators ?? []).map(ind => (
                  <span key={ind} style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    padding: '2px 7px', borderRadius: 4,
                    background: 'var(--bg-surface-2)', border: '1px solid var(--border)',
                    color: 'var(--text-dim)',
                  }}>
                    {ind}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-muted)' }}>
              Aucune anomalie enregistrée
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">À propos du journal de hashage</div>
        <div style={{ padding: '14px 18px' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 10 }}>
            Le journal agrège 4 sources de données en lecture seule :
          </p>
          {[
            { icon: '🟢', label: 'Signaux',   desc: 'IndexedDB via getSignalHistory() — signaux versionnés avec hash FNV-1a' },
            { icon: '⚠',  label: 'Anomalies', desc: 'localStorage veridex_anomaly_log — 3+ indicateurs simultanément changés' },
            { icon: '◈',  label: 'Patterns',  desc: 'IndexedDB clés mf_* — fingerprints de configurations récurrentes' },
            { icon: '⚡', label: 'Cache',     desc: 'SmartCache.changeLog en mémoire — changements hash FNV-1a détectés' },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex', gap: 10, padding: '8px 0',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0, width: 20, textAlign: 'center' }}>{item.icon}</span>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
                  {item.label}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── AuditPage ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',  label: 'Vue générale' },
  { id: 'journal',   label: 'Journal de hashage' },
  { id: 'snapshot',  label: 'Snapshot' },
]

export default function AuditPage() {
  const [activeTab,      setActiveTab]      = useState('overview')
  const [signalHistory,  setSignalHistory]  = useState([])
  const [anomalyLog,     setAnomalyLog]     = useState([])
  const [patterns,       setPatterns]       = useState([])
  const [cacheChanges,   setCacheChanges]   = useState([])
  const [loading,        setLoading]        = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sigs, anomalies, pats] = await Promise.all([
        getSignalHistory(null, 200).catch(() => []),
        Promise.resolve(getAnomalyLog(200)),
        getAllPatterns().catch(() => []),
      ])
      setSignalHistory(sigs.slice().reverse())   // plus récent en premier
      setAnomalyLog(anomalies)
      setPatterns(pats)
      setCacheChanges([...smartCache.changeLog].reverse())
    } catch (_) {}
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const lastAnomaly = anomalyLog[0] ?? null

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Audit <span>Données</span></div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)' }}>
          Lecture seule
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'var(--font-body)',
              fontSize: 13, fontWeight: 600,
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: `2px solid ${activeTab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, transition: 'all 150ms ease',
            }}
          >
            {t.label}
            {t.id === 'journal' && !loading && (
              <span style={{
                marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--text-ghost)',
              }}>
                {signalHistory.length + anomalyLog.length + patterns.length + cacheChanges.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {activeTab === 'overview' && (
        <OverviewTab
          signalCount={signalHistory.length}
          anomalyCount={anomalyLog.length}
          patternCount={patterns.length}
          cacheCount={cacheChanges.length}
          lastAnomaly={lastAnomaly}
        />
      )}

      {activeTab === 'journal' && (
        <HashJournal
          signalHistory={signalHistory}
          anomalyLog={anomalyLog}
          patterns={patterns}
          cacheChanges={cacheChanges}
          loading={loading}
          onRefresh={loadData}
        />
      )}

      {activeTab === 'snapshot' && <SnapshotManager />}
    </div>
  )
}
