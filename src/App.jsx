import { useState } from 'react'
import ChainPage from './pages/ChainPage.jsx'
import TrackerPage from './pages/TrackerPage.jsx'
import DualPage from './pages/DualPage.jsx'
import TermPage from './pages/TermPage.jsx'
import SignalPage from './pages/SignalPage.jsx'
import './App.css'

const TABS = [
  { id: 'signal', label: 'Signal', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  )},
  { id: 'dual', label: 'Dual', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  )},
  { id: 'chain', label: 'Chaîne', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  )},
  { id: 'tracker', label: 'IV Live', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )},
  { id: 'term', label: 'Basis', icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      <line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  )},
]

export default function App() {
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
  const [active, setActive] = useState('signal')

  return (
    <div className="app-shell">
      <div className="app-content">
        {active === 'signal'  && <SignalPage />}
        {active === 'dual'    && <DualPage />}
        {active === 'chain'   && <ChainPage />}
        {active === 'tracker' && <TrackerPage />}
        {active === 'term'    && <TermPage />}
      </div>
      <nav className="bottom-nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`nav-btn${active === t.id ? ' active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
        <button onClick={forceUpdate} style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      gap:2, padding:'6px 8px', background:'none', border:'none', cursor:'pointer',
      color:'var(--text-muted)', fontSize:9, fontFamily:'var(--sans)', fontWeight:700,
      opacity:0.7
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
      </svg>
      MAJ
    </button>
  </nav>
    </div>
  )
}
