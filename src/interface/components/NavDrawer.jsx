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

function IconPerformance() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18"/>
      <polyline points="7 16 11 12 15 14 21 8"/>
    </svg>
  )
}

// ── Items de navigation ───────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'market',      label: 'Market',      sub: 'Prix · Liquidité · OI',              Icon: IconMarket      },
  { id: 'deriv',       label: 'Dérivés',     sub: 'Funding · Basis · DVOL · Futures',   Icon: IconDeriv       },
  { id: 'signals',     label: 'Signaux',     sub: 'Score 4-composantes · Alertes',      Icon: IconSignals     },
  { id: 'performance', label: 'Performance', sub: 'Edge · Equity · Export · Validation', Icon: IconPerformance },
]

// ── Composant ─────────────────────────────────────────────────────────────────

export default function NavDrawer({
  isOpen, onClose,
  activePage, onNavigate,
  activeAsset, onAssetChange,
  signalScore, nextFunding,
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
