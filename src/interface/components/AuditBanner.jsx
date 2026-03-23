/**
 * AuditBanner.jsx
 *
 * Bandeau d'alerte affiché sur toutes les pages si anomalie récente détectée.
 *
 * - Vérifie localStorage 'veridex_anomaly_log' au montage et toutes les 30s
 * - Anomalie "récente" = timestamp < 10 minutes
 * - critical (5+ indicateurs) → rouge
 * - warning  (3-4 indicateurs) → ambre
 * - Dismissable via [×] pour 10 minutes (sessionStorage)
 *
 * Props : { onNavigateToAudit: () => void }
 */

import { useState, useEffect, useCallback } from 'react'

const ANOMALY_LOG_KEY     = 'veridex_anomaly_log'
const DISMISSED_KEY       = 'audit_banner_dismissed_until'
const RECENT_WINDOW_MS    = 10 * 60 * 1000   // 10 minutes
const DISMISS_DURATION_MS = 10 * 60 * 1000   // 10 minutes
const POLL_INTERVAL_MS    = 30_000

function getRecentAnomaly() {
  try {
    const log = JSON.parse(localStorage.getItem(ANOMALY_LOG_KEY) || '[]')
    const now = Date.now()
    return log
      .filter(e => now - e.timestamp < RECENT_WINDOW_MS)
      .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null
  } catch (_) {
    return null
  }
}

function isDismissed() {
  try {
    const until = Number(sessionStorage.getItem(DISMISSED_KEY) || '0')
    return Date.now() < until
  } catch (_) {
    return false
  }
}

function fmtAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)  return `il y a ${diff}s`
  return `il y a ${Math.floor(diff / 60)}min`
}

export default function AuditBanner({ onNavigateToAudit }) {
  const [anomaly,    setAnomaly]    = useState(null)
  const [dismissed,  setDismissed]  = useState(false)

  const refresh = useCallback(() => {
    if (isDismissed()) {
      setAnomaly(null)
      return
    }
    setAnomaly(getRecentAnomaly())
    setDismissed(false)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, String(Date.now() + DISMISS_DURATION_MS))
    } catch (_) {}
    setAnomaly(null)
    setDismissed(true)
  }

  if (!anomaly || dismissed) return null

  const isCritical = anomaly.severity === 'critical'
  const count      = anomaly.count ?? anomaly.changedIndicators?.length ?? 0

  const bg         = isCritical ? 'rgba(240,71,107,0.10)' : 'rgba(245,166,35,0.12)'
  const borderTop  = isCritical ? '1px solid rgba(240,71,107,0.3)' : '1px solid rgba(245,166,35,0.3)'
  const textColor  = isCritical ? 'var(--put)' : 'var(--neutral)'
  const icon       = isCritical ? '🔴' : '⚠'

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 150,
      background: bg,
      borderTop: borderTop,
      padding: '9px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          fontWeight: 600,
          color: textColor,
          lineHeight: 1.3,
        }}>
          Anomalie {isCritical ? 'critique' : 'détectée'} · {fmtAgo(anomaly.timestamp)}
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          color: textColor,
          opacity: 0.75,
        }}>
          {count} indicateur{count > 1 ? 's' : ''} simultané{count > 1 ? 's' : ''}
        </div>
      </div>

      <button
        onClick={onNavigateToAudit}
        style={{
          background: 'none',
          border: `1px solid ${textColor}`,
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          fontWeight: 600,
          color: textColor,
          flexShrink: 0,
          transition: 'all 150ms ease',
          opacity: 0.85,
        }}
      >
        Voir →
      </button>

      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: textColor,
          fontSize: 16,
          lineHeight: 1,
          padding: '0 2px',
          opacity: 0.6,
          flexShrink: 0,
        }}
        aria-label="Fermer"
      >
        ×
      </button>
    </div>
  )
}
