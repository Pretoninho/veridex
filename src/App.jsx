import { useState } from 'react'
import HomePage from './pages/HomePage.jsx'
import ChainPage from './pages/ChainPage.jsx'
import TrackerPage from './pages/TrackerPage.jsx'
import DualPage from './pages/DualPage.jsx'
import TermPage from './pages/TermPage.jsx'
import SignalPage from './pages/SignalPage.jsx'
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

function OptionsPlaceholder({ onBack }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'20px 24px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid var(--border)' }}>
        <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:16, color:'var(--text)' }}>
          Option <span style={{ color:'var(--atm)' }}>Analyzer</span>
        </div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32, textAlign:'center' }}>
        <div style={{ width:80, height:80, borderRadius:20, background:'rgba(255,215,0,.1)', border:'1px solid rgba(255,215,0,.2)', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--atm)" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </div>
        <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:22, color:'var(--text)', marginBottom:12 }}>En développement</div>
        <div style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.8, maxWidth:280 }}>
          L'outil d'analyse d'options avancé arrive bientôt.<br/>
          Surface de volatilité · Greeks · Stratégies · Pricing
        </div>
        <div style={{ marginTop:32, display:'flex', flexDirection:'column', gap:10, width:'100%', maxWidth:280 }}>
          {['Surface de volatilité 3D','Dashboard Greeks','Stratégies (Spreads, Straddles)','Pricing multicritères','Backtesting'].map(f => (
            <div key={f} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:10, background:'var(--surface)', border:'1px solid var(--border)' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--atm)', opacity:.5 }}/>
              <span style={{ fontSize:12, color:'var(--text-muted)' }}>{f}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('home')
  const [diTab, setDiTab] = useState('signal')

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

  // HOME
  if (view === 'home') {
    return <HomePage onNavigate={setView} />
  }

  // OPTION ANALYZER (placeholder)
  if (view === 'options') {
    return <OptionsPlaceholder onBack={() => setView('home')} />
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
        {diTab === 'chain'   && <ChainPage />}
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
    </div>
  )
}
