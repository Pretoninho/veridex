import { useState, useEffect } from 'react'
import { version } from '../package.json'
import * as coinbase from './data_core/providers/coinbase.js'
import LandingPage    from './pages/LandingPage.jsx'
import MarketPage     from './pages/MarketPage.jsx'
import DerivativesPage from './pages/DerivativesPage.jsx'
import OptionsDataPage from './pages/OptionsDataPage.jsx'
import SignalsPage    from './pages/SignalsPage.jsx'
import TradePage      from './pages/TradePage.jsx'
import OnChainPage    from './pages/OnChainPage.jsx'
import AuditPage      from './pages/AuditPage.jsx'
import ClockStatus    from './components/ClockStatus.jsx'
import AuditBanner    from './components/AuditBanner.jsx'
import { syncServerClocks, SYNC_INTERVAL_MS } from './data_core/providers/clock_sync.js'
import { setCachedClockSync } from './data_core/data_store/cache.js'
import './App.css'

const ASSETS = ['BTC', 'ETH']

const TABS = [
  {
    id: 'market', label: 'Market',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="4" height="13"/><rect x="10" y="3" width="4" height="17"/><rect x="18" y="11" width="4" height="9"/>
    </svg>
  },
  {
    id: 'deriv', label: 'Derivés',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/>
    </svg>
  },
  {
    id: 'options', label: 'Options',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  },
  {
    id: 'signals', label: 'Signaux',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  },
  {
    id: 'trade', label: 'Trade',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  },
  {
    id: 'onchain', label: 'On-Chain',
    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  },
]

export default function App() {
  const [inApp,     setInApp]     = useState(false)
  const [tab,       setTab]       = useState('market')
  const [auditOpen, setAuditOpen] = useState(false)
  const [asset,     setAsset]     = useState('BTC')
  const [clockSync, setClockSync] = useState(null)
  const [btcPrice,  setBtcPrice]  = useState(null)
  const [ethPrice,  setEthPrice]  = useState(null)

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

  useEffect(() => {
    coinbase.getSpot('BTC').then(p => setBtcPrice(p)).catch(() => {})
    coinbase.getSpot('ETH').then(p => setEthPrice(p)).catch(() => {})
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
      btcPrice={btcPrice}
      ethPrice={ethPrice}
    />
  )

  if (auditOpen) return (
    <div className="app-shell">
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button
          onClick={() => setAuditOpen(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-body)', fontSize: 13, padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Retour
        </button>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
          Audit
        </span>
        <div style={{ width: 60 }} />
      </div>
      <div className="app-content">
        <AuditPage />
      </div>
    </div>
  )

  return (
    <div className="app-shell">
      <AppHeader asset={asset} setAsset={setAsset} clockSync={clockSync} onClockSync={setClockSync} onAudit={() => setAuditOpen(true)} />
      <div className="app-content">
        {tab === 'market'   && <MarketPage      asset={asset} />}
        {tab === 'deriv'    && <DerivativesPage  asset={asset} clockSync={clockSync} />}
        {tab === 'options'  && <OptionsDataPage  asset={asset} clockSync={clockSync} />}
        {tab === 'signals'  && <SignalsPage      asset={asset} clockSync={clockSync} />}
        {tab === 'trade'    && <TradePage        asset={asset} />}
        {tab === 'onchain'  && <OnChainPage      asset={asset} />}
      </div>
      <AuditBanner onNavigateToAudit={() => setAuditOpen(true)} />
      <BottomNav tab={tab} setTab={setTab} />
      <VersionBar version={version} forceUpdate={forceUpdate} />
    </div>
  )
}

function AppHeader({ asset, setAsset, clockSync, onClockSync, onAudit }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
          Veri<span style={{ color: 'var(--accent)' }}>dex</span>
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ClockStatus clockSync={clockSync} onSync={onClockSync} />
        <button
          onClick={onAudit}
          title="Audit des données"
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 7,
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text-muted)', transition: 'all 150ms ease', padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
          </svg>
        </button>
        <div style={{ position: 'relative' }}>
        <select
          value={asset}
          onChange={e => setAsset(e.target.value)}
          style={{
            appearance: 'none', background: 'rgba(255,255,255,.06)',
            border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--accent)', fontFamily: 'var(--sans)', fontWeight: 700,
            fontSize: 13, padding: '5px 28px 5px 12px', cursor: 'pointer', outline: 'none',
          }}
        >
          {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        </div>
      </div>
    </header>
  )
}

function BottomNav({ tab, setTab }) {
  return (
    <nav className="bottom-nav">
      {TABS.map(t => (
        <button key={t.id} className={`nav-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

function VersionBar({ version, forceUpdate }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingBottom: 2, flexShrink: 0,
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
