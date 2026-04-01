import { useState, useEffect, Component } from 'react'
import { version } from '../../package.json'
import LandingPage    from './pages/LandingPage.jsx'
import MarketPage     from './pages/MarketPage.jsx'
import DerivativesPage from './pages/DerivativesPage.jsx'
import SignalsPage    from './pages/SignalsPage.jsx'
import ClockStatus    from './components/ClockStatus.jsx'
import NavDrawer      from './components/NavDrawer.jsx'
import VLogo          from './components/VLogo.jsx'
import { getSignalHistory } from '../signals/signal_engine.js'
import { syncServerClocks, SYNC_INTERVAL_MS } from '../data/providers/clock_sync.js'
import { setCachedClockSync } from '../data/data_store/cache.js'
import MaintenancePage          from './pages/MaintenancePage.jsx'
import './App.css'

// ── ErrorBoundary ─────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#ff4d6d', background: '#060a0f', minHeight: '100vh' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Une erreur est survenue</div>
          <div style={{ opacity: 0.7, marginBottom: 16, wordBreak: 'break-all' }}>{String(this.state.error)}</div>
          <button
            onClick={() => { window.location.reload() }}
            style={{ padding: '8px 16px', background: 'rgba(255,77,109,.15)', border: '1px solid rgba(255,77,109,.4)', borderRadius: 6, color: '#ff4d6d', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
          >
            Recharger l'application
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Mode maintenance ──────────────────────────────────────────────────────────

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === 'true'

// ── Constantes ────────────────────────────────────────────────────────────────

const PAGE_NAMES = {
  market:  'Market',
  deriv:   'Dérivés',
  signals: 'Signaux',
}

function getNextFundingCountdown() {
  const now  = new Date()
  const h    = now.getUTCHours()
  const m    = now.getUTCMinutes()
  // Binance / Deribit : fixings à 00h, 08h, 16h UTC
  const next = [0, 8, 16, 24].find(i => i > h) ?? 24
  const diff = next * 60 - (h * 60 + m)
  return diff >= 60 ? `${Math.floor(diff / 60)}h` : `${diff}m`
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Maintenance mode — court-circuit total avant tout autre rendu
  if (MAINTENANCE_MODE) return <MaintenancePage />

  const [inApp,       setInApp]       = useState(false)
  const [tab,         setTab]         = useState('market')
  const [asset,       setAsset]       = useState('BTC')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [clockSync,   setClockSync]   = useState(null)
  const [signalScore, setSignalScore] = useState(null)
  const [nextFunding, setNextFunding] = useState(() => getNextFundingCountdown())

  // Synchronisation horloges
  useEffect(() => {
    const doSync = async () => {
      const result = await syncServerClocks()
      setCachedClockSync(result)
      setClockSync(result)
    }
    doSync()
    const timer = setInterval(doSync, SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  // Dernier score signal (badge drawer)
  useEffect(() => {
    getSignalHistory(null, 10).then(h => {
      if (h.length > 0) setSignalScore(h[h.length - 1].score)
    }).catch(() => {})
  }, [tab]) // recharge quand on change de page (ex: après refresh Signaux)

  // Countdown funding (badge Dérivés)
  useEffect(() => {
    const timer = setInterval(() => setNextFunding(getNextFundingCountdown()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const forceUpdate = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister())
        window.location.reload(true)
      })
    } else {
      window.location.reload(true)
    }
  }

  if (!inApp) return (
    <LandingPage
      onEnter={() => setInApp(true)}
      asset={asset}
      onAssetChange={setAsset}
    />
  )

  return (
    <div className="app-shell">

      {/* Header global fixé */}
      <GlobalHeader
        tab={tab}
        asset={asset}
        clockSync={clockSync}
        onClockSync={setClockSync}
        onOpenDrawer={() => setDrawerOpen(true)}
        onLanding={() => setInApp(false)}
      />

      {/* Contenu des pages */}
      <div className="app-content">
        {tab === 'market'  && <MarketPage      asset={asset} />}
        {tab === 'deriv'   && <DerivativesPage asset={asset} />}
        {tab === 'signals' && <SignalsPage     asset={asset} />}
        <VersionBar version={version} forceUpdate={forceUpdate} />
      </div>

      {/* Drawer de navigation */}
      {drawerOpen && (
        <NavDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          activePage={tab}
          onNavigate={(page) => setTab(page)}
          activeAsset={asset}
          onAssetChange={(a) => setAsset(a)}
          signalScore={signalScore}
          nextFunding={nextFunding}
        />
      )}
    </div>
  )
}

// ── Header global ─────────────────────────────────────────────────────────────

function GlobalHeader({ tab, asset, clockSync, onClockSync, onOpenDrawer, onLanding }) {
  return (
    <header className="app-header-global">
      <div className="header-inner">

        {/* Gauche : logo (→ landing) + hamburger (→ drawer) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onLanding}
            aria-label="Accueil Veridex"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <VLogo size={28} />
          </button>
          <button className="hamburger-btn" onClick={onOpenDrawer} aria-label="Menu">
            <div className="hamburger-line" style={{ width: 14 }} />
            <div className="hamburger-line" style={{ width: 10 }} />
            <div className="hamburger-line" style={{ width: 14 }} />
          </button>
        </div>

        {/* Centre : titre page active + ClockStatus */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClockStatus clockSync={clockSync} onSync={onClockSync} />
          <span className="header-title">{PAGE_NAMES[tab] ?? tab}</span>
        </div>

        {/* Droite : asset pill (tap → drawer) */}
        <button className="asset-pill-header" onClick={onOpenDrawer}>
          {asset}
        </button>

      </div>
    </header>
  )
}

// ── Version bar ───────────────────────────────────────────────────────────────

function VersionBar({ version, forceUpdate }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '8px 0 4px', flexShrink: 0,
    }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: .35, letterSpacing: '1px' }}>v{version}</span>
      <button onClick={forceUpdate} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-muted)', opacity: .35, padding: '0 4px', fontSize: 9,
        fontFamily: 'var(--sans)', fontWeight: 700,
      }}>MAJ</button>
    </div>
  )
}
