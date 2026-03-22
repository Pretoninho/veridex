/**
 * NavDrawer.jsx
 *
 * Drawer plein panneau latéral gauche — navigation principale Veridex.
 * Remplace la bottom bar. Ouverture via hamburger dans le header global.
 *
 * Props :
 *   isOpen        : boolean
 *   onClose       : () => void
 *   activePage    : string
 *   onNavigate    : (page: string) => void
 *   activeAsset   : string
 *   onAssetChange : (asset: string) => void
 *   signalScore   : number | null
 *   auditAlerts   : number
 *   nextFunding   : string | null
 */

import { useState, useRef } from 'react'
import VLogo from './VLogo.jsx'

// ── Icônes SVG ────────────────────────────────────────────────────────────────

function IconMarket() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="4" height="13"/>
      <rect x="10" y="3" width="4" height="17"/>
      <rect x="18" y="11" width="4" height="9"/>
    </svg>
  )
}

function IconDeriv() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  )
}

function IconOptions() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  )
}

function IconSignals() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="3"/>
      <line x1="12" y1="2" x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="6" y2="12"/>
      <line x1="18" y1="12" x2="22" y2="12"/>
    </svg>
  )
}

function IconOnChain() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  )
}

function IconAudit() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}

function IconNotifications() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

// ── Items de navigation ───────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'market',        label: 'Market',        sub: 'Prix · VWAP · Spread',          Icon: IconMarket         },
  { id: 'deriv',         label: 'Dérivés',        sub: 'Funding · OI · Term Structure', Icon: IconDeriv          },
  { id: 'options',       label: 'Options',        sub: 'IV · Greeks · DVOL',            Icon: IconOptions        },
  { id: 'signals',       label: 'Signaux',        sub: 'Score · Expert · Simple',       Icon: IconSignals        },
  { id: 'onchain',       label: 'On-Chain',       sub: 'Mempool · Exchange Flows',      Icon: IconOnChain        },
  { id: 'audit',         label: 'Audit',          sub: 'Journal · Anomalies · Hashes',  Icon: IconAudit          },
  { id: 'notifications', label: 'Notifications',  sub: 'Alertes push · Seuils',         Icon: IconNotifications  },
]

// ── Composant ─────────────────────────────────────────────────────────────────

export default function NavDrawer({
  isOpen, onClose,
  activePage, onNavigate,
  activeAsset, onAssetChange,
  signalScore, auditAlerts, nextFunding,
}) {
  const [isClosing, setIsClosing] = useState(false)
  const touchStartX   = useRef(0)
  const touchCurrentX = useRef(0)

  // ── Fermeture avec animation ──────────────────────────────────────────────

  const handleClose = () => {
    if (isClosing) return
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onClose()
    }, 120)
  }

  // ── Navigation avec animation ─────────────────────────────────────────────

  const handleNavigate = (page) => {
    if (isClosing) return
    if (page === activePage) {
      handleClose()
      return
    }
    setIsClosing(true)
    setTimeout(() => {
      setIsClosing(false)
      onNavigate(page)
      onClose()
    }, 120)
  }

  // ── Changement d'asset ────────────────────────────────────────────────────

  const handleAssetChange = (a) => {
    if (isClosing) return
    if (a !== activeAsset) onAssetChange(a)
    handleClose()
  }

  // ── Swipe gauche pour fermer ──────────────────────────────────────────────

  const handleTouchStart = (e) => {
    touchStartX.current   = e.touches[0].clientX
    touchCurrentX.current = e.touches[0].clientX
  }

  const handleTouchMove = (e) => {
    touchCurrentX.current = e.touches[0].clientX
  }

  const handleTouchEnd = () => {
    const delta = touchCurrentX.current - touchStartX.current
    if (delta < -50) handleClose()
  }

  // ── Badges dynamiques ─────────────────────────────────────────────────────

  const getBadge = (id) => {
    if (id === 'market')                        return { label: 'Live',              variant: 'live'   }
    if (id === 'deriv'   && nextFunding)         return { label: nextFunding,         variant: 'timing' }
    if (id === 'signals' && signalScore != null) return { label: String(signalScore), variant: 'score'  }
    if (id === 'audit'   && auditAlerts > 0)     return { label: String(auditAlerts), variant: 'alert'  }
    return null
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className={`drawer-overlay${isClosing ? ' drawer-closing' : ''}`}
        onClick={handleClose}
      />

      {/* Drawer */}
      <div
        className={`nav-drawer${isClosing ? ' drawer-closing' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-logo">
            <VLogo size={36} />
            <span className="drawer-logo-text">VERIDEX</span>
          </div>
          <div className="drawer-tagline">Market intelligence. Verified.</div>
        </div>

        {/* Nav items */}
        <nav className="drawer-nav">
          {NAV_ITEMS.map(({ id, label, sub, Icon }) => {
            const isActive = activePage === id
            const badge    = getBadge(id)
            return (
              <div
                key={id}
                className={`nav-item${isActive ? ' active' : ''}`}
                onClick={() => handleNavigate(id)}
              >
                {isActive && <div className="nav-active-bar" />}
                <div className={`nav-icon-wrap${isActive ? ' active' : ''}`}>
                  <Icon />
                </div>
                <div className="nav-item-text">
                  <span className={`nav-item-label${isActive ? ' active' : ''}`}>{label}</span>
                  <span className="nav-item-sub">{sub}</span>
                </div>
                {badge && (
                  <span className={`nav-badge ${badge.variant}`}>{badge.label}</span>
                )}
              </div>
            )
          })}
        </nav>

        {/* Footer — Asset Selector */}
        <div className="drawer-footer">
          <div className="drawer-footer-label">ACTIF</div>
          <div className="drawer-asset-pills">
            {['BTC', 'ETH'].map(a => (
              <button
                key={a}
                className={`asset-pill${activeAsset === a ? ' active' : ''}`}
                onClick={() => handleAssetChange(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
