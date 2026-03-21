import { useState } from 'react'
import { version } from '../package.json'
import LandingPage    from './pages/LandingPage.jsx'
import MarketPage     from './pages/MarketPage.jsx'
import DerivativesPage from './pages/DerivativesPage.jsx'
import OptionsDataPage from './pages/OptionsDataPage.jsx'
import SignalsPage    from './pages/SignalsPage.jsx'
import TradePage      from './pages/TradePage.jsx'
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
]

export default function App() {
  const [inApp, setInApp] = useState(false)
  const [tab, setTab] = useState('market')
  const [asset, setAsset] = useState('BTC')

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

  if (!inApp) return <LandingPage onEnter={() => setInApp(true)} version={version} />

  return (
    <div className="app-shell">
      <AppHeader asset={asset} setAsset={setAsset} />
      <div className="app-content">
        {tab === 'market'   && <MarketPage     asset={asset} />}
        {tab === 'deriv'    && <DerivativesPage asset={asset} />}
        {tab === 'options'  && <OptionsDataPage asset={asset} />}
        {tab === 'signals'  && <SignalsPage     asset={asset} />}
        {tab === 'trade'    && <TradePage       asset={asset} />}
      </div>
      <BottomNav tab={tab} setTab={setTab} />
      <VersionBar version={version} forceUpdate={forceUpdate} />
    </div>
  )
}

function AppHeader({ asset, setAsset }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', background: 'var(--surface)',
      borderBottom: '1px solid var(--border)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(0,212,255,.15)', border: '1px solid rgba(0,212,255,.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
          Option<span style={{ color: 'var(--accent)' }}>Lab</span>
        </span>
      </div>

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
