/**
 * EconomicCalendarPanel.jsx
 *
 * Affiche les prochaines annonces macro "High" importance (±12h de maintenant).
 *
 * Source : Forex Factory (flux public, sans clé API) via useEconomicCalendar (cache 1h).
 *
 * Met en évidence :
 *  - Fenêtre active (T±30min) : fond rouge, badge pulsant "FENÊTRE NEWS"
 *  - Annonce imminente (<60min) : point jaune
 *  - Annonce passée (hors fenêtre) : opacité réduite
 */

import { useState } from 'react'
import useEconomicCalendar from '../hooks/useEconomicCalendar.js'
import { isInNewsWindow }  from '../../signals/inNewsWindow.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC'
}

function fmtDelta(ts, now) {
  if (ts == null) return null
  const diff = ts - now
  const abs  = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  if (mins < 60) return `${diff > 0 ? '+' : '-'}${mins}min`
  const hrs = Math.round(mins / 60)
  return `${diff > 0 ? '+' : '-'}${hrs}h`
}

// ── EconomicCalendarPanel ─────────────────────────────────────────────────────

export default function EconomicCalendarPanel() {
  const { events, loading, error, lastUpdated, refresh } = useEconomicCalendar()
  const [open, setOpen] = useState(true)

  const now = Date.now()

  // Annonces dans ±12h
  const window12h = 12 * 60 * 60 * 1_000
  const nearEvents = events.filter(ev => ev.ts != null && Math.abs(ev.ts - now) < window12h)

  // Sommes-nous actuellement dans une fenêtre news ?
  const { inWindow: nowInWindow, nearestEvent: activeEvent } = isInNewsWindow(now, events)

  return (
    <div className="card" style={{
      borderColor: nowInWindow ? 'rgba(240,71,107,.45)' : undefined,
    }}>
      {/* Header */}
      <div
        className="card-header"
        style={{
          cursor: 'pointer', userSelect: 'none',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: nowInWindow ? 'rgba(240,71,107,.06)' : undefined,
        }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Calendrier économique · Annonces High
          {nowInWindow && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
              color: 'var(--put)',
              padding: '1px 8px', borderRadius: 4,
              background: 'rgba(240,71,107,.12)', border: '1px solid rgba(240,71,107,.4)',
            }}>
              FENÊTRE NEWS · {activeEvent?.currency} {activeEvent?.event?.slice(0, 20)}
            </span>
          )}
          <span className="fp-badge">{nearEvents.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={e => { e.stopPropagation(); refresh() }}
            disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 5,
              color: 'var(--text-muted)', fontSize: 12, padding: '2px 8px',
              cursor: loading ? 'default' : 'pointer', fontFamily: 'var(--font-body)',
              opacity: loading ? 0.4 : 1,
            }}
          >
            {loading ? '…' : '↺'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Body */}
      {open && (
        error ? (
          <div style={{ padding: '10px 14px' }}>
            <div className="fp-error-banner">
              ⚠ {error} — erreur de chargement (attendez le prochain refresh)
            </div>
          </div>
        ) : nearEvents.length === 0 && !loading ? (
          <div style={{
            padding: '20px 16px', textAlign: 'center',
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--text-ghost)', fontStyle: 'italic',
          }}>
            Aucune annonce High importance dans les ±12h
            {!lastUpdated && ' — chargement en cours'}
          </div>
        ) : (
          <div>
            {/* Lignes d'événements */}
            {nearEvents.map((ev, i) => {
              const { inWindow, minutesAway, isPre } = isInNewsWindow(now, [ev])
              const isPast   = ev.ts < now && !inWindow
              const isClose  = !inWindow && minutesAway != null && minutesAway < 60 && !isPast

              const dotColor = inWindow  ? 'var(--put)'
                : isClose  ? 'var(--neutral)'
                : isPast   ? 'var(--text-ghost)'
                : 'var(--call)'

              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 16px',
                  borderBottom: '1px solid rgba(46,51,64,.4)',
                  background: inWindow ? 'rgba(240,71,107,.05)' : undefined,
                  opacity: isPast ? 0.45 : 1,
                  transition: 'opacity 300ms',
                }}>
                  {/* Status dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: dotColor,
                    boxShadow: inWindow ? `0 0 6px ${dotColor}` : undefined,
                  }} />

                  {/* Time */}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--text-muted)', flexShrink: 0, minWidth: 68,
                  }}>
                    {fmtTime(ev.ts)}
                  </span>

                  {/* Currency badge */}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    color: 'var(--accent)', minWidth: 32, flexShrink: 0,
                  }}>
                    {ev.currency}
                  </span>

                  {/* Event name */}
                  <span style={{
                    fontFamily: 'var(--font-body)', fontSize: 11,
                    color: inWindow ? 'var(--text)' : 'var(--text-dim)',
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ev.event}
                  </span>

                  {/* Actual / delta */}
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0,
                    color: inWindow  ? 'var(--put)'
                      : isClose  ? 'var(--neutral)'
                      : 'var(--text-ghost)',
                    minWidth: 52, textAlign: 'right',
                  }}>
                    {ev.actual != null
                      ? ev.actual
                      : fmtDelta(ev.ts, now) ?? '—'
                    }
                  </span>

                  {/* Prev/Forecast mini-info */}
                  {(ev.forecast != null || ev.previous != null) && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9,
                      color: 'var(--text-ghost)', flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}>
                      {ev.forecast != null && `f:${ev.forecast}`}
                      {ev.forecast != null && ev.previous != null && ' '}
                      {ev.previous != null && `p:${ev.previous}`}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Footer */}
            <div style={{
              padding: '5px 16px',
              fontFamily: 'var(--font-body)', fontSize: 9,
              color: 'var(--text-ghost)', textAlign: 'right',
            }}>
              {lastUpdated
                ? `Mis à jour : ${new Date(lastUpdated).toLocaleTimeString('fr-FR')} · refresh/h`
                : 'Chargement…'
              }
              {' · Source : Forex Factory (public)'}
            </div>
          </div>
        )
      )}
    </div>
  )
}
