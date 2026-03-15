import { useState, useEffect } from 'react'
import { getSpot, getDVOL, getFundingRate } from '../utils/api.js'

export default function HomePage({ onNavigate }) {
  const [btc, setBtc] = useState(null)
  const [eth, setEth] = useState(null)
  const [dvol, setDvol] = useState(null)
  const [funding, setFunding] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [b, e, d, f] = await Promise.all([
          getSpot('BTC').catch(() => null),
          getSpot('ETH').catch(() => null),
          getDVOL('BTC').catch(() => null),
          getFundingRate('BTC').catch(() => null),
        ])
        setBtc(b); setEth(e); setDvol(d); setFunding(f)
      } catch(_) {}
      setLoading(false)
    }
    load()
  }, [])

  const ivColor = !dvol ? 'var(--text-muted)'
    : dvol.current > 70 ? 'var(--call)'
    : dvol.current > 50 ? 'var(--atm)'
    : dvol.current > 35 ? 'var(--accent2)'
    : 'var(--put)'

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', padding:'0 0 40px' }}>

      {/* Header */}
      <div style={{ padding:'32px 24px 0', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:'rgba(0,212,255,.15)', border:'1px solid rgba(0,212,255,.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <div>
          <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:'var(--text)', letterSpacing:'-0.5px' }}>
            Option <span style={{ color:'var(--accent)' }}>Analyzer</span>
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', letterSpacing:'1px', textTransform:'uppercase' }}>Crypto Options Suite</div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ padding:'40px 24px 32px', flex:1 }}>

        {/* Tagline */}
        <div style={{ marginBottom:32 }}>
          <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:28, color:'var(--text)', lineHeight:1.2, marginBottom:10 }}>
            Maximise tes<br/>
            <span style={{ color:'var(--accent)' }}>primes de vol.</span>
          </div>
          <div style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7, maxWidth:320 }}>
            Analyse les options crypto en temps réel. Optimise ta stratégie Dual Investment avec les données Deribit.
          </div>
        </div>

        {/* Stats live */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:32 }}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase', marginBottom:6 }}>BTC</div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color:'var(--atm)' }}>
              {btc ? '$'+btc.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}
            </div>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase', marginBottom:6 }}>ETH</div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color:'var(--accent)' }}>
              {eth ? '$'+eth.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}
            </div>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase', marginBottom:6 }}>DVOL BTC</div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color:ivColor }}>
              {dvol ? dvol.current.toFixed(1)+'%' : '—'}
            </div>
            {dvol && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Moy 30j : {((dvol.monthMin+dvol.monthMax)/2).toFixed(1)}%</div>}
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700, letterSpacing:'1px', textTransform:'uppercase', marginBottom:6 }}>Funding</div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color: funding?.current > 0 ? 'var(--call)' : 'var(--put)' }}>
              {funding?.current != null ? (funding.current > 0 ? '+' : '')+funding.current.toFixed(2)+'%' : '—'}
            </div>
            {funding?.current != null && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>/an</div>}
          </div>
        </div>

        {/* 2 modules principaux */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* Dual Investment Suite */}
          <button onClick={() => onNavigate('di-suite')} style={{
            background:'linear-gradient(135deg, rgba(0,212,255,.12) 0%, rgba(0,102,255,.08) 100%)',
            border:'1px solid rgba(0,212,255,.25)',
            borderRadius:16, padding:'20px', cursor:'pointer', textAlign:'left',
            transition:'all .2s', width:'100%'
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:'rgba(0,212,255,.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:16, color:'var(--text)' }}>Dual Investment</div>
                  <div style={{ fontSize:11, color:'var(--accent)', fontWeight:600 }}>Suite complète</div>
                </div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7 }}>
              Signal DI · Contrats · Chaîne d'options · IV Live · Term Structure
            </div>
            <div style={{ marginTop:12, display:'flex', gap:6 }}>
              {['Signal','Dual','Chaîne','IV','Basis'].map(t => (
                <span key={t} style={{ fontSize:10, padding:'2px 8px', borderRadius:20, background:'rgba(0,212,255,.1)', color:'var(--accent)', border:'1px solid rgba(0,212,255,.2)' }}>{t}</span>
              ))}
            </div>
          </button>

          {/* Option Analyzer */}
          <button onClick={() => onNavigate('options')} style={{
            background:'linear-gradient(135deg, rgba(255,215,0,.08) 0%, rgba(255,107,53,.05) 100%)',
            border:'1px solid rgba(255,215,0,.2)',
            borderRadius:16, padding:'20px', cursor:'pointer', textAlign:'left',
            transition:'all .2s', width:'100%', position:'relative', overflow:'hidden'
          }}>
            <div style={{ position:'absolute', top:10, right:14, fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'rgba(255,215,0,.15)', color:'var(--atm)', border:'1px solid rgba(255,215,0,.3)', letterSpacing:'1px' }}>BIENTÔT</div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <div style={{ width:40, height:40, borderRadius:10, background:'rgba(255,215,0,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--atm)" strokeWidth="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
              </div>
              <div>
                <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:16, color:'var(--text)' }}>Option Analyzer</div>
                <div style={{ fontSize:11, color:'var(--atm)', fontWeight:600 }}>Analyse avancée</div>
              </div>
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.7 }}>
              Surface de vol · Greeks · Stratégies · Pricing · Backtesting
            </div>
            <div style={{ marginTop:12, display:'flex', gap:6 }}>
              {['Vol Surface','Greeks','Spreads','Pricing'].map(t => (
                <span key={t} style={{ fontSize:10, padding:'2px 8px', borderRadius:20, background:'rgba(255,215,0,.08)', color:'var(--atm)', border:'1px solid rgba(255,215,0,.15)', opacity:.7 }}>{t}</span>
              ))}
            </div>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding:'0 24px', textAlign:'center' }}>
        <div style={{ fontSize:10, color:'var(--text-muted)', opacity:.5 }}>
          Données Deribit · Mis à jour en temps réel
        </div>
      </div>
    </div>
  )
}
