/**
 * ClockStatus.jsx — Indicateur de synchronisation d'horloge cross-exchange
 *
 * Invisible si toutes les horloges sont alignées (driftStatus === 'ok').
 * Affiche un point orange en cas d'avertissement, rouge en cas critique.
 * Tap → panneau de détail avec les 3 sources + countdown funding + bouton Resync.
 */
import { useState } from 'react'
import { syncServerClocks } from '../../data/providers/clock_sync.js'
import { setCachedClockSync } from '../../data/data_store/cache.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDrift(ms) {
  if (ms == null) return '—'
  const abs = Math.abs(ms)
  const sign = ms >= 0 ? '+' : '-'
  if (abs < 1000) return `${sign}${abs}ms`
  return `${sign}${(abs / 1000).toFixed(2)}s`
}

function fmtCountdown(ms) {
  if (!ms) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function statusColor(status) {
  if (status === 'critical') return '#ff4d6d'
  if (status === 'warning')  return '#ffa800'
  return '#00c896'
}

// ── Composant ─────────────────────────────────────────────────────────────────

export default function ClockStatus({ clockSync, onSync }) {
  const [open, setOpen]   = useState(false)
  const [syncing, setSyncing] = useState(false)

  if (!clockSync || clockSync.driftStatus === 'ok') {
    // Invisible si tout va bien
    return null
  }

  const color = statusColor(clockSync.driftStatus)

  const handleResync = async () => {
    setSyncing(true)
    try {
      const result = await syncServerClocks()
      setCachedClockSync(result)
      onSync?.(result)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      {/* Dot indicator */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}
        title={`Drift horloges : ${clockSync.driftStatus}`}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}`,
          display: 'inline-block',
        }} />
      </button>

      {/* Panneau détail */}
      {open && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,.6)', zIndex: 1000,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          paddingTop: 60,
        }} onClick={() => setOpen(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 16, padding: 20, width: 'min(360px, calc(100vw - 32px))',
            }}
          >
            {/* Titre */}
            <div style={{
              fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14,
              color: 'var(--text)', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>Horloge cross-exchange</span>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                background: clockSync.driftStatus === 'critical' ? 'rgba(255,77,109,.15)' : 'rgba(255,168,0,.15)',
                color,
              }}>
                {clockSync.driftStatus.toUpperCase()}
              </span>
            </div>

            {/* Sources */}
            {['deribit', 'binance', 'coinbase'].map(src => {
              const s = clockSync.sources[src]
              const sColor = statusColor(s.status)
              return (
                <div key={src} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: sColor, flexShrink: 0, display: 'inline-block',
                    }} />
                    <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'var(--sans)', fontWeight: 600, textTransform: 'capitalize' }}>
                      {src}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: s.status === 'offline' ? 'var(--text-muted)' : sColor, fontFamily: 'var(--sans)', fontWeight: 700 }}>
                    {s.status === 'offline' ? 'hors ligne' : fmtDrift(s.drift_vs_local)}
                  </span>
                </div>
              )
            })}

            {/* Drift max */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>Drift max</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--sans)', color }}>
                {fmtDrift(clockSync.maxDrift)}
              </span>
            </div>

            {/* Prochain funding */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>Prochain fixing</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--sans)', color: 'var(--text)' }}>
                {fmtCountdown(clockSync.nextFundingIn)}
              </span>
            </div>

            {/* Bouton resync */}
            <button
              onClick={handleResync}
              disabled={syncing}
              style={{
                marginTop: 16, width: '100%', padding: '10px 0',
                background: syncing ? 'rgba(255,255,255,.04)' : 'rgba(0,212,255,.12)',
                border: '1px solid rgba(0,212,255,.3)', borderRadius: 10,
                color: syncing ? 'var(--text-muted)' : 'var(--accent)',
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13,
                cursor: syncing ? 'not-allowed' : 'pointer',
              }}
            >
              {syncing ? 'Synchronisation…' : 'Resynchroniser'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
