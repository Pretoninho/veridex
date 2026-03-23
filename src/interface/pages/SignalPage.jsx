import { useState, useEffect, useRef } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getSpot, getFutures, getFuturePrice, getInstruments, getOrderBook, getAllExpiries } from '../../utils/api.js'
import { computeSignal, getSignal } from '../../signals/signal_engine.js'
import { calcDIRateSimple, calcTermStructureSignal } from '../../core/market_structure/term_structure.js'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

// ── Helpers TermPage ──
function daysUntil(ts) { return Math.max(1, Math.round((ts - Date.now()) / 86400000)) }
function fmtTs(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
}

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes
const LS_ALERT_KEY = 'signal_alert_threshold'
const LS_HISTORY_KEY = 'signal_history'

export default function SignalPage() {
  const [activeTab, setActiveTab] = useState('signal')
  const [asset, setAsset] = useState('BTC')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000)
  const [alertThreshold, setAlertThreshold] = useState(() => parseInt(localStorage.getItem(LS_ALERT_KEY) || '60'))
  const [alertFired, setAlertFired] = useState(false)
  const [showAlertConfig, setShowAlertConfig] = useState(false)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || '[]') } catch { return [] }
  })
  // ── Term/Basis state ──
  const [basisRows, setBasisRows] = useState([])
  const [basisSignal, setBasisSignal] = useState(null)
  const [basisFunding, setBasisFunding] = useState(null)
  const [basisSpot, setBasisSpot] = useState(null)
  const [basisLoading, setBasisLoading] = useState(false)
  const [basisError, setBasisError] = useState(null)
  const [basisSubTab, setBasisSubTab] = useState('basis')

  const timerRef = useRef(null)
  const countRef = useRef(null)
  const assetRef = useRef(asset)

  useEffect(() => { assetRef.current = asset }, [asset])

  const analyze = async (a) => {
    setLoading(true)
    const asset = a || assetRef.current
    try {
      const [dvol, funding, rv, spot, futures] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getFundingRate(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
        getSpot(asset).catch(() => null),
        getFutures(asset).catch(() => []),
      ])

      let basisAvg = null
      if (spot && futures.length) {
        const basisValues = []
        for (const f of futures.filter(f => !f.instrument_name.includes('PERPETUAL')).slice(0, 4)) {
          try {
            const price = await getFuturePrice(f.instrument_name)
            if (price) {
              const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
              basisValues.push((price - spot) / spot * 100 / days * 365)
            }
          } catch(_) {}
        }
        if (basisValues.length) basisAvg = basisValues.reduce((a,b)=>a+b,0)/basisValues.length
      }

      const { scores: { s1, s2, s3, s4 }, global } = computeSignal({ dvol, funding, rv, basisAvg })
      const now = new Date()

      const newData = { dvol, funding, rv, spot, basisAvg, s1, s2, s3, s4, global, asset }
      setData(newData)
      setLastUpdate(now)

      // Historique des scores (garde 48 points = 4h à 5min d'intervalle)
      setHistory(prev => {
        const next = [...prev, { ts: now.toISOString(), score: global, asset }].slice(-48)
        localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(next))
        return next
      })

      // Alerte si seuil dépassé
      const threshold = parseInt(localStorage.getItem(LS_ALERT_KEY) || '60')
      if (global != null && global >= threshold && !alertFired) {
        setAlertFired(true)
        // Notification navigateur si autorisée
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`🔥 Signal DI ${asset} : ${global}/100`, {
            body: getSignal(global)?.action || '',
            icon: '/icon-192.png'
          })
        }
      } else if (global != null && global < threshold) {
        setAlertFired(false)
      }

    } catch(e) { console.warn('Signal error:', e.message) }
    setLoading(false)
  }

  const startMonitoring = () => {
    analyze(asset)
    setCountdown(REFRESH_INTERVAL / 1000)
    timerRef.current = setInterval(() => analyze(), REFRESH_INTERVAL)
    countRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) return REFRESH_INTERVAL / 1000
        return c - 1
      })
    }, 1000)
  }

  const stopMonitoring = () => {
    clearInterval(timerRef.current)
    clearInterval(countRef.current)
    timerRef.current = null
  }

  useEffect(() => {
    startMonitoring()
    return () => stopMonitoring()
  }, [asset])

  // ── Basis loader (TermPage logic) ──
  const loadBasis = async () => {
    setBasisLoading(true)
    setBasisError(null)
    const a = assetRef.current
    try {
      const [sp, futures, fundingData, instruments] = await Promise.all([
        getSpot(a),
        getFutures(a),
        getFundingRate(a).catch(() => null),
        getInstruments(a),
      ])
      setBasisSpot(sp)
      setBasisFunding(fundingData)

      const expiries = getAllExpiries(instruments)
      const rowData = []
      for (const f of futures) {
        try {
          const price = await getFuturePrice(f.instrument_name)
          if (!price) continue
          const isPerp = f.instrument_name.includes('PERPETUAL')
          const days = isPerp ? null : daysUntil(f.expiration_timestamp)
          const basisBrut = (price - sp) / sp * 100
          const basisAnn = isPerp ? null : basisBrut / days * 365

          let iv = null
          if (!isPerp) {
            const matchingExpiry = expiries.find(ts => {
              const d = new Date(ts), fd = new Date(f.expiration_timestamp)
              return d.getFullYear() === fd.getFullYear() && d.getMonth() === fd.getMonth() && d.getDate() === fd.getDate()
            })
            if (matchingExpiry) {
              const forExp = instruments.filter(i => i.expiration_timestamp === matchingExpiry)
              const strikes = [...new Set(forExp.map(i => i.strike))]
              if (strikes.length) {
                const atmS = strikes.reduce((p, c) => Math.abs(c - sp) < Math.abs(p - sp) ? c : p)
                const callInst = forExp.find(x => x.option_type === 'call' && x.strike === atmS)
                const putInst  = forExp.find(x => x.option_type === 'put'  && x.strike === atmS)
                const [cb, pb] = await Promise.all([
                  callInst ? getOrderBook(callInst.instrument_name).catch(() => null) : Promise.resolve(null),
                  putInst  ? getOrderBook(putInst.instrument_name).catch(() => null)  : Promise.resolve(null),
                ])
                const cIV = cb?.mark_iv ?? null, pIV = pb?.mark_iv ?? null
                iv = cIV != null && pIV != null ? (cIV + pIV) / 2 : cIV ?? pIV
              }
            }
          }

          const diRate = calcDIRateSimple(iv, days)
          rowData.push({
            instrument: f.instrument_name,
            expiry: isPerp ? 'PERP' : fmtTs(f.expiration_timestamp),
            days, price, basisBrut, basisAnn, isPerp, iv, diRate,
          })
        } catch (_) {}
      }
      rowData.sort((a, b) => (a.days || 9999) - (b.days || 9999))
      setBasisRows(rowData)

      const dated = rowData.filter(r => !r.isPerp && r.basisAnn != null)
      if (dated.length) {
        const avg = dated.reduce((s, r) => s + r.basisAnn, 0) / dated.length
        const fundingAnn = fundingData?.avgAnn7d ?? 0
        const structure = avg > 0.5 ? 'contango' : avg < -0.5 ? 'backwardation' : 'flat'
        const { signal: diSignal, color: diColor, reason: diReason } =
          calcTermStructureSignal({ avgBasisAnn: avg, structure }, fundingAnn)
        setBasisSignal({
          label: structure === 'contango' ? 'Contango' : structure === 'backwardation' ? 'Backwardation' : 'Flat',
          avg, max: Math.max(...dated.map(r => r.basisAnn)), count: dated.length,
          diSignal, diColor, diReason, fundingAnn,
        })
      }
    } catch (e) { setBasisError(e.message) }
    setBasisLoading(false)
  }

  const requestNotifPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') alert('✓ Notifications activées !')
      else alert('Notifications refusées par le navigateur')
    }
  }

  const saveAlert = (val) => {
    setAlertThreshold(val)
    localStorage.setItem(LS_ALERT_KEY, String(val))
    setAlertFired(false)
  }

  const signal = data?.global != null ? getSignal(data.global) : null
  const globalColor = !data?.global ? 'var(--text-muted)'
    : data.global >= 80 ? 'var(--call)'
    : data.global >= 60 ? 'var(--atm)'
    : data.global >= 40 ? 'var(--accent2)'
    : 'var(--put)'

  // Mini sparkline historique
  const maxScore = 100
  const sparkW = 200, sparkH = 40
  const sparkPoints = history.filter(h => h.asset === asset).slice(-24)

  // ── Basis chart data ──
  const basisDated = basisRows.filter(r => !r.isPerp)
  const basisChartData = {
    labels: basisDated.map(r => r.expiry),
    datasets: [{ data: basisDated.map(r => r.basisAnn?.toFixed(3)), backgroundColor: basisDated.map(r => r.basisAnn >= 0 ? 'rgba(0,229,160,.8)' : 'rgba(255,77,109,.8)'), borderRadius:4 }]
  }
  const basisChartOptions = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#0d1520', borderColor:'#1e3a5f', borderWidth:1, callbacks:{ label: ctx=>(ctx.parsed.y>0?'+':'')+ctx.parsed.y+'% ann.' } } },
    scales:{
      x:{ ticks:{color:'#6a8aaa',font:{size:9}}, grid:{color:'rgba(30,58,95,.3)'} },
      y:{ ticks:{color:'#6a8aaa',font:{size:9},callback:v=>(v>0?'+':'')+v+'%'}, grid:{color:'rgba(30,58,95,.3)'} },
    },
  }
  const cls2color = { Contango:'var(--call)', Backwardation:'var(--put)', Flat:'var(--accent2)' }
  const bestDI = basisDated.filter(r => r.diRate && r.basisAnn).reduce((best, r) => {
    const score = r.diRate + Math.abs(r.basisAnn)
    return !best || score > best.diRate + Math.abs(best.basisAnn) ? r : best
  }, null)

  return (
    <div className="page-wrap">

      {/* ── Tabs ── */}
      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['signal','Signal DI'],['basis','Basis']].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding:'8px 18px', background:'none', border:'none', cursor:'pointer',
            fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
            color: activeTab === id ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom:-1, transition:'all .2s',
          }}>{label}</button>
        ))}
      </div>

      {/* ── TAB SIGNAL ── */}
      {activeTab === 'signal' && (<>

      {/* Bannière alerte */}
      {alertFired && signal && (
        <div style={{ background:signal.bg, border:`1px solid ${signal.border}`, borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:signal.color, fontFamily:'var(--sans)', fontWeight:800, fontSize:14 }}>
              🚨 Signal {data.asset} : {data.global}/100
            </div>
            <div style={{ fontSize:11, color:'var(--text-dim)', marginTop:2 }}>{signal.action}</div>
          </div>
          <button onClick={() => setAlertFired(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">Signal <span>DI</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {/* Indicateur monitoring actif */}
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--call)', boxShadow:'0 0 6px var(--call)', animation:'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize:10, color:'var(--text-muted)' }}>{countdown}s</span>
          </div>
          <button className={`icon-btn${loading?' loading':''}`} onClick={() => analyze(asset)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:16 }}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => setAsset('BTC')}>₿ BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => setAsset('ETH')}>Ξ ETH</button>
      </div>

      {!data && loading && (
        <div className="card"><div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Chargement…</div></div>
      )}

      {data && (
        <div className="fade-in">

          {/* Score global */}
          {signal ? (
            <div style={{ background:signal.bg, border:`1px solid ${signal.border}`, borderRadius:14, padding:'20px', marginBottom:16, textAlign:'center' }}>
              <div style={{ fontFamily:'var(--sans)', fontSize:11, color:'var(--text-muted)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:8 }}>Score DI Global — {data.asset}</div>
              <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:64, color:globalColor, lineHeight:1, marginBottom:8 }}>
                {data.global}
              </div>
              <div style={{ height:10, background:'rgba(255,255,255,.06)', borderRadius:5, overflow:'hidden', marginBottom:14, maxWidth:240, margin:'0 auto 14px' }}>
                <div style={{ height:'100%', width:`${data.global}%`, background:globalColor, borderRadius:5, transition:'width .8s ease' }} />
              </div>
              <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:signal.color, marginBottom:4 }}>{signal.label}</div>
              <div style={{ fontSize:12, color:'var(--text-dim)' }}>{signal.action}</div>

              {/* Sparkline historique */}
              {sparkPoints.length > 2 && (
                <div style={{ marginTop:14, display:'flex', justifyContent:'center' }}>
                  <svg width={sparkW} height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`}>
                    <polyline
                      points={sparkPoints.map((p, i) =>
                        `${(i / (sparkPoints.length - 1)) * sparkW},${sparkH - (p.score / maxScore) * sparkH}`
                      ).join(' ')}
                      fill="none"
                      stroke={globalColor}
                      strokeWidth="1.5"
                      opacity="0.6"
                    />
                    {/* Ligne seuil alerte */}
                    <line
                      x1="0" y1={sparkH - (alertThreshold / maxScore) * sparkH}
                      x2={sparkW} y2={sparkH - (alertThreshold / maxScore) * sparkH}
                      stroke="rgba(255,77,109,.4)" strokeWidth="1" strokeDasharray="3,3"
                    />
                  </svg>
                </div>
              )}
              {sparkPoints.length > 2 && (
                <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:4 }}>
                  Historique {sparkPoints.length} pts · Seuil alerte : {alertThreshold}
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ marginBottom:16 }}>
              <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Données insuffisantes</div>
            </div>
          )}

          {/* 4 scores */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:12 }}>
            {[
              { label:'Volatilité DVOL', score:data.s1, weight:35, value: data.dvol ? `${data.dvol.current.toFixed(1)}` : 'N/A', sub: data.dvol ? `Moy.30j: ${((data.dvol.monthMin+data.dvol.monthMax)/2).toFixed(1)}` : '—' },
              { label:'Funding Rate', score:data.s2, weight:25, value: data.funding?.avgAnn7d != null ? `${data.funding.avgAnn7d>0?'+':''}${data.funding.avgAnn7d.toFixed(2)}% /an` : 'N/A', sub: '—' },
              { label:'Basis Futures', score:data.s3, weight:25, value: data.basisAvg != null ? `${data.basisAvg>0?'+':''}${data.basisAvg.toFixed(2)}% /an` : 'N/A', sub: data.basisAvg > 0 ? 'Contango' : data.basisAvg < 0 ? 'Backwardation' : 'Flat' },
              { label:'IV vs RV', score:data.s4, weight:15, value: data.dvol && data.rv ? `${(data.dvol.current-data.rv.current)>0?'+':''}${(data.dvol.current-data.rv.current).toFixed(1)} pts` : 'N/A', sub: data.dvol && data.rv ? `IV ${data.dvol.current.toFixed(0)} / RV ${data.rv.current.toFixed(0)}` : '—' },
            ].map(({ label, score, weight, value, sub }) => {
              const c = score == null ? 'var(--text-muted)' : score >= 75 ? 'var(--call)' : score >= 50 ? 'var(--atm)' : score >= 25 ? 'var(--accent2)' : 'var(--put)'
              return (
                <div key={label} className="stat-card">
                  <div className="stat-label">{label} <span style={{ opacity:.6 }}>({weight}%)</span></div>
                  <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:22, color:c }}>{score ?? '—'}</div>
                  <div style={{ height:4, background:'rgba(255,255,255,.06)', borderRadius:2, overflow:'hidden', margin:'6px 0' }}>
                    <div style={{ height:'100%', width:`${score ?? 0}%`, background:c, borderRadius:2 }} />
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-dim)', fontWeight:700 }}>{value}</div>
                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>{sub}</div>
                </div>
              )
            })}
          </div>

          {/* Config alerte */}
          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header" style={{ cursor:'pointer' }} onClick={() => setShowAlertConfig(v => !v)}>
              <span>🔔 Alerte Signal</span>
              <span style={{ fontSize:11, color: alertThreshold > 0 ? 'var(--call)' : 'var(--text-muted)' }}>
                Seuil : {alertThreshold}/100 {showAlertConfig ? '▲' : '▼'}
              </span>
            </div>
            {showAlertConfig && (
              <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                  Une alerte s'affiche (et une notification push si autorisée) quand le score dépasse ce seuil.
                </div>
                {/* Seuils rapides */}
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {[40, 50, 60, 70, 80].map(v => (
                    <button key={v} onClick={() => saveAlert(v)} style={{
                      padding:'5px 14px', borderRadius:20, fontSize:11, cursor:'pointer', fontFamily:'var(--sans)', fontWeight:700,
                      border: alertThreshold===v ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: alertThreshold===v ? 'rgba(0,212,255,.1)' : 'transparent',
                      color: alertThreshold===v ? 'var(--accent)' : 'var(--text-muted)',
                    }}>{v}</button>
                  ))}
                </div>
                <button className="icon-btn" style={{ alignSelf:'flex-start' }} onClick={requestNotifPermission}>
                  🔔 Activer les notifications push
                </button>
                <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                  💡 Score 60 = bon contexte · Score 80 = exceptionnel · Monitoring toutes les 5 min
                </div>
              </div>
            )}
          </div>

          {/* Recommandation */}
          {signal && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">Recommandation</div>
              <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:8, fontSize:12, color:'var(--text-dim)', lineHeight:1.8 }}>
                {data.global >= 80 && (<>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Sell High</strong> — Vendre de la vol maintenant</div>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Short Perp</strong> — Funding positif, tu reçois le carry</div>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Strike</strong> — Delta 0.20-0.30, durée 1-3j</div>
                </>)}
                {data.global >= 60 && data.global < 80 && (<>
                  <div style={{ color:'var(--atm)' }}>✓ <strong>DI recommandé</strong> — Contexte favorable</div>
                  <div style={{ color:'var(--atm)' }}>✓ <strong>Strike conservateur</strong> — Delta 0.15-0.20</div>
                  <div style={{ color:'var(--text-muted)' }}>~ <strong>Perp</strong> — Selon funding actuel</div>
                </>)}
                {data.global >= 40 && data.global < 60 && (<>
                  <div style={{ color:'var(--accent2)' }}>~ <strong>DI possible</strong> — Pas optimal</div>
                  <div style={{ color:'var(--accent2)' }}>~ <strong>Strike très OTM</strong> — Delta &lt; 0.15</div>
                  <div style={{ color:'var(--text-muted)' }}>↓ <strong>Perp</strong> — Éviter</div>
                </>)}
                {data.global < 40 && (<>
                  <div style={{ color:'var(--put)' }}>↓ <strong>Attendre</strong> — Vol trop basse</div>
                  <div style={{ color:'var(--text-muted)' }}>💡 Surveiller DVOL — attendre spike &gt;10%</div>
                </>)}
              </div>
            </div>
          )}

          {data.spot && (
            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)', marginBottom:8 }}>
              {data.asset} : <strong style={{ color:'var(--atm)' }}>${data.spot.toLocaleString('en-US',{maximumFractionDigits:0})}</strong>
              {lastUpdate && <span style={{ marginLeft:8 }}>· {lastUpdate.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>}
            </div>
          )}
        </div>
      )}
      </>)}

      {/* ── TAB BASIS ── */}
      {activeTab === 'basis' && (
        <div className="fade-in">

          {/* Header Basis */}
          <div className="page-header" style={{ marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div className="asset-toggle">
                <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => { setAsset('BTC'); setBasisRows([]); setBasisSignal(null); setBasisFunding(null) }}>₿ BTC</button>
                <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => { setAsset('ETH'); setBasisRows([]); setBasisSignal(null); setBasisFunding(null) }}>Ξ ETH</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              {basisSpot && <span style={{ fontSize:12, color:'var(--atm)', fontFamily:'var(--sans)', fontWeight:800 }}>${basisSpot.toLocaleString('en-US',{maximumFractionDigits:0})}</span>}
              <button className={`icon-btn${basisLoading?' loading':''}`} onClick={loadBasis}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
                Charger
              </button>
            </div>
          </div>

          {/* Sub-tabs Basis / Stratégie DI */}
          <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
            {[['basis','Basis'],['di','Stratégie DI']].map(([id,label]) => (
              <button key={id} onClick={() => setBasisSubTab(id)} style={{
                padding:'8px 18px', background:'none', border:'none', cursor:'pointer',
                fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
                color: basisSubTab===id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: basisSubTab===id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom:-1, transition:'all .2s',
              }}>{label}</button>
            ))}
          </div>

          {basisError && <div className="error-box">⚠ {basisError}</div>}

          {/* ── Sub-tab BASIS ── */}
          {basisSubTab === 'basis' && (
            <>
              {basisSignal && (
                <div className="stats-grid" style={{ marginBottom:12 }}>
                  <div className="stat-card" style={{ borderColor: basisSignal.label==='Contango'?'rgba(0,229,160,.3)':basisSignal.label==='Backwardation'?'rgba(255,77,109,.3)':'rgba(255,107,53,.3)' }}>
                    <div className="stat-label">Structure</div>
                    <div className="stat-value" style={{ color:cls2color[basisSignal.label] }}>{basisSignal.label}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Basis moy. ann.</div>
                    <div className="stat-value" style={{ color:basisSignal.avg>0?'var(--call)':basisSignal.avg<0?'var(--put)':'var(--accent2)' }}>
                      {basisSignal.avg>0?'+':''}{basisSignal.avg.toFixed(2)}%
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Funding 7j ann.</div>
                    <div className="stat-value" style={{ color:basisSignal.fundingAnn>0?'var(--call)':basisSignal.fundingAnn<0?'var(--put)':'var(--accent2)' }}>
                      {basisSignal.fundingAnn>0?'+':''}{basisSignal.fundingAnn?.toFixed(2)}%
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Futures actifs</div>
                    <div className="stat-value">{basisSignal.count}</div>
                  </div>
                </div>
              )}

              {basisDated.length > 0 && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">Basis annualisé par expiration</div>
                  <div style={{ padding:'4px 8px 16px', height:200 }}>
                    <Bar data={basisChartData} options={basisChartOptions} />
                  </div>
                </div>
              )}

              {basisRows.length > 0 && (
                <div className="card">
                  <div className="card-header">Détail par expiration</div>
                  {basisRows.map(r => (
                    <div key={r.instrument} style={{ padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)', display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                      <div>
                        <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:12, color:'var(--text)' }}>{r.instrument}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                          {r.expiry} {r.days ? `· ${r.days}j` : ''}
                          {r.iv ? <span style={{ marginLeft:8, color:'var(--accent)' }}>IV: {r.iv.toFixed(1)}%</span> : ''}
                        </div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        {r.basisAnn != null ? (
                          <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:r.basisAnn>0.5?'var(--call)':r.basisAnn<-0.5?'var(--put)':'var(--accent2)' }}>
                            {r.basisAnn>0?'+':''}{r.basisAnn.toFixed(2)}%
                          </div>
                        ) : <div style={{ fontSize:11, color:'var(--text-muted)' }}>Funding</div>}
                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                          {r.basisAnn==null?'':r.basisAnn>0.5?'Contango':r.basisAnn<-0.5?'Backwardation':'Flat'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!basisLoading && basisRows.length === 0 && !basisError && (
                <div className="empty-state"><div className="empty-icon">◇</div><h3>Prêt à charger</h3><p>Appuyez sur Charger</p></div>
              )}
            </>
          )}

          {/* ── Sub-tab STRATÉGIE DI ── */}
          {basisSubTab === 'di' && (
            <div className="fade-in">
              {!basisSignal && (
                <div className="empty-state"><div className="empty-icon">◇</div><h3>Charger d'abord</h3><p>Appuyez sur Charger pour analyser la structure</p></div>
              )}
              {basisSignal && (
                <>
                  <div className="card" style={{ marginBottom:12, borderColor: basisSignal.diColor==='var(--call)'?'rgba(0,229,160,.3)':'rgba(255,215,0,.3)' }}>
                    <div className="card-header" style={{ color: basisSignal.diColor }}>Signal DI — Basis + Funding</div>
                    <div style={{ padding:'14px 16px' }}>
                      <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color: basisSignal.diColor, marginBottom:8 }}>{basisSignal.diSignal}</div>
                      <div style={{ fontSize:12, color:'var(--text-dim)', lineHeight:1.8 }}>{basisSignal.diReason}</div>
                    </div>
                  </div>

                  {basisDated.filter(r => r.iv && r.diRate).length > 0 && (
                    <div className="card" style={{ marginBottom:12 }}>
                      <div className="card-header">
                        <span>Comparatif par échéance</span>
                        <span style={{ fontSize:10, color:'var(--text-muted)' }}>Prime DI + Basis</span>
                      </div>
                      <div style={{ padding:'8px 14px 4px', fontSize:9, color:'var(--text-muted)', display:'grid', gridTemplateColumns:'1fr 50px 60px 60px 70px', gap:4, textTransform:'uppercase', letterSpacing:'.5px' }}>
                        <span>Échéance</span><span style={{ textAlign:'center' }}>Jours</span>
                        <span style={{ textAlign:'right' }}>Basis</span><span style={{ textAlign:'right' }}>Taux DI</span><span style={{ textAlign:'right' }}>Total</span>
                      </div>
                      {basisDated.filter(r => r.iv && r.diRate).map(r => {
                        const total = r.diRate + Math.abs(r.basisAnn ?? 0)
                        const isBest = bestDI?.instrument === r.instrument
                        return (
                          <div key={r.instrument} style={{
                            padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)',
                            display:'grid', gridTemplateColumns:'1fr 50px 60px 60px 70px', gap:4, alignItems:'center',
                            background: isBest ? 'rgba(255,215,0,.04)' : undefined,
                            borderLeft: isBest ? '2px solid var(--atm)' : '2px solid transparent',
                          }}>
                            <div>
                              <div style={{ fontFamily:'var(--sans)', fontWeight: isBest?800:600, fontSize:12, color: isBest?'var(--atm)':'var(--text)' }}>
                                {r.expiry}{isBest && <span style={{ fontSize:9, marginLeft:4 }}>🏆</span>}
                              </div>
                              <div style={{ fontSize:9, color:'var(--text-muted)' }}>IV {r.iv?.toFixed(1)}%</div>
                            </div>
                            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)' }}>{r.days}</div>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11, fontWeight:700, color: r.basisAnn>0?'var(--call)':'var(--put)' }}>
                                {r.basisAnn>0?'+':''}{r.basisAnn?.toFixed(2)}%
                              </div>
                            </div>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11, fontWeight:700, color:'var(--accent)' }}>{r.diRate?.toFixed(2)}%</div>
                            </div>
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:12, fontWeight:800, color: isBest?'var(--atm)':'var(--text)' }}>{total.toFixed(2)}%</div>
                              <div style={{ fontSize:9, color:'var(--text-muted)' }}>/an</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {basisFunding && (
                    <div className="card">
                      <div className="card-header">Funding Perp — Impact stratégie</div>
                      <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                        <div>
                          <div className="stat-label">Funding actuel ann.</div>
                          <div className="stat-value" style={{ color: basisFunding.current > 0 ? 'var(--call)' : 'var(--put)' }}>
                            {basisFunding.current != null ? (basisFunding.current>0?'+':'') + basisFunding.current.toFixed(2)+'%' : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="stat-label">Moy. 7j ann.</div>
                          <div className="stat-value" style={{ color: basisFunding.avgAnn7d > 0 ? 'var(--call)' : 'var(--put)' }}>
                            {basisFunding.avgAnn7d != null ? (basisFunding.avgAnn7d>0?'+':'') + basisFunding.avgAnn7d.toFixed(2)+'%' : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
