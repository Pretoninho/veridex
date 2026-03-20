import { useState, useEffect, useRef } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getSpot, getFutures, getFuturePrice } from '../utils/api.js'
import { computeSignal, getSignal } from '../data_processing/signals/signal_engine.js'

const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes
const LS_ALERT_KEY = 'signal_alert_threshold'
const LS_HISTORY_KEY = 'signal_history'

export default function SignalPage() {
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

  return (
    <div className="page-wrap">

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
    </div>
  )
}
