import { useEffect, useState } from 'react'
import { version } from '../package.json'
import HomePage from './pages/HomePage.jsx'
import ChainPage from './pages/ChainPage.jsx'
import TrackerPage from './pages/TrackerPage.jsx'
import DualPage from './pages/DualPage.jsx'
import TermPage from './pages/TermPage.jsx'
import SignalPage from './pages/SignalPage.jsx'
import OptionsPage from './pages/OptionsPage.jsx'
import PaperTradingPage from './pages/PaperTradingPage.jsx'
import './App.css'

const DI_TABS = [
  { id:'signal', label:'Signal', icon:(
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  )},
  { id:'dual', label:'Dual', icon:(
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
    </svg>
  )},
  { id:'chain', label:'Chaîne', icon:(
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  )},
  { id:'tracker', label:'IV Live', icon:(
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )},
  { id:'term', label:'Basis', icon:(
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      <line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  )},
]



export default function App() {
  const [view, setView] = useState('home')
  const [diTab, setDiTab] = useState('signal')
  const [paperPrefill, setPaperPrefill] = useState(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const targetView = url.searchParams.get('view')
    if (!targetView) return
    const map = {
      signal: 'signal',
      dual: 'dual',
      chain: 'chain',
      tracker: 'tracker',
      term: 'term',
      basis: 'term',
    }
    const tab = map[targetView]
    if (tab) {
      setView('di-suite')
      setDiTab(tab)
    }
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

  const openPaperTrading = (prefill = null) => {
    setPaperPrefill(prefill)
    setView('paper')
  }

  // HOME
  if (view === 'home') {
    return <HomePage onNavigate={(target) => target === 'paper' ? openPaperTrading() : setView(target)} />
  }

  // OPTION ANALYZER (placeholder)
  if (view === 'options') {
    return <OptionsPage onBack={() => setView('home')} onNavigate={setView} />
  }

  // PAPER TRADING
  if (view === 'paper') {
    return <PaperTradingPage onBack={() => setView('home')} prefillTrade={paperPrefill} />
  }

  // DI SUITE
  return (
    <div className="app-shell">
      <div className="app-content">
        {/* Back button */}
        <div style={{ position:'absolute', top:12, left:12, zIndex:100 }}>
          <button onClick={() => setView('home')} style={{
            background:'rgba(0,0,0,.4)', border:'1px solid var(--border)',
            borderRadius:20, padding:'4px 12px', cursor:'pointer',
            display:'flex', alignItems:'center', gap:5,
            color:'var(--text-muted)', fontSize:11, fontFamily:'var(--sans)', fontWeight:700
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Accueil
          </button>
        </div>

        {diTab === 'signal'  && <SignalPage />}
        {diTab === 'dual'    && <DualPage />}
        {diTab === 'chain'   && <ChainPage onNavigate={setView} onSubscribe={openPaperTrading} />}
        {diTab === 'tracker' && <TrackerPage />}
        {diTab === 'term'    && <TermPage />}
      </div>

      <nav className="bottom-nav">
        <button onClick={() => setView('home')} style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap:2, padding:'6px 8px', background:'none', border:'none', cursor:'pointer',
          color:'var(--text-muted)', fontSize:9, fontFamily:'var(--sans)', fontWeight:700, opacity:.8
        }}>
          <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
            <path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/>
            <polyline points='9 22 9 12 15 12 15 22'/>
          </svg>
          Accueil
        </button>
        {DI_TABS.map(t => (
          <button key={t.id} className={`nav-btn${diTab===t.id?' active':''}`} onClick={() => setDiTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
        <button onClick={forceUpdate} style={{
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap:2, padding:'6px 8px', background:'none', border:'none', cursor:'pointer',
          color:'var(--text-muted)', fontSize:9, fontFamily:'var(--sans)', fontWeight:700, opacity:.7
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
          </svg>
          MAJ
        </button>
      </nav>
      <div style={{ textAlign:'center', fontSize:9, color:'var(--text-muted)', opacity:.4, paddingBottom:4, letterSpacing:'1px' }}>
        v{version}
      </div>
    </div>
  )
}
