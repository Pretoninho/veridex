import { useState } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getSpot, getFutures, getFuturePrice } from '../utils/api.js'

function scoreIV(dvol) {
  if (!dvol) return null
  const avg30 = (dvol.monthMin + dvol.monthMax) / 2
  const ratio = dvol.current / avg30
  if (ratio >= 1.20) return 100
  if (ratio >= 1.10) return 75
  if (ratio >= 0.95) return 50
  if (ratio >= 0.85) return 25
  return 0
}

function scoreFunding(funding) {
  if (!funding || funding.avgAnn7d == null) return null
  const r = funding.avgAnn7d
  if (r >= 30) return 100
  if (r >= 15) return 75
  if (r >= 5)  return 50
  if (r >= 0)  return 25
  return 0
}

function scoreBasis(basisAvg) {
  if (basisAvg == null) return null
  if (basisAvg >= 15) return 100
  if (basisAvg >= 8)  return 75
  if (basisAvg >= 3)  return 50
  if (basisAvg >= 0)  return 25
  return 0
}

function scoreIVvsRV(dvol, rv) {
  if (!dvol || !rv) return null
  const premium = dvol.current - rv.current
  if (premium >= 20) return 100
  if (premium >= 10) return 75
  if (premium >= 0)  return 50
  return 0
}

function calcGlobalScore(s1, s2, s3, s4) {
  const scores = [s1, s2, s3, s4].filter(s => s != null)
  if (!scores.length) return null
  // Calcul pondéré avec les scores disponibles
  let total = 0, weights = 0
  if (s1 != null) { total += s1 * 35; weights += 35 }
  if (s2 != null) { total += s2 * 25; weights += 25 }
  if (s3 != null) { total += s3 * 25; weights += 25 }
  if (s4 != null) { total += s4 * 15; weights += 15 }
  return weights > 0 ? Math.round(total / weights) : null
}

function getSignal(score) {
  if (score == null) return null
  if (score >= 80) return { label: '🔥 Exceptionnel', color: 'var(--call)', bg: 'rgba(0,229,160,.08)', border: 'rgba(0,229,160,.3)', action: 'Sell High + Short Perp — conditions idéales' }
  if (score >= 60) return { label: '✓ Favorable',    color: 'var(--atm)',  bg: 'rgba(255,215,0,.06)', border: 'rgba(255,215,0,.3)',  action: 'DI recommandé — bon moment pour placer' }
  if (score >= 40) return { label: '~ Neutre',        color: 'var(--accent2)', bg: 'rgba(255,107,53,.06)', border: 'rgba(255,107,53,.3)', action: 'DI possible mais pas optimal — surveiller' }
  return               { label: '↓ Défavorable',   color: 'var(--put)',  bg: 'rgba(255,77,109,.06)', border: 'rgba(255,77,109,.3)',  action: 'Attendre un meilleur contexte' }
}

export default function SignalPage() {
  const [asset, setAsset] = useState('BTC')
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})
  const [data, setData] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = async () => {
    setLoading(true)
    setErrors({})
    setData(null)

    const errs = {}

    // Fetch chaque indicateur indépendamment
    const dvol = await getDVOL(asset).catch(e => { errs.dvol = e.message; return null })
    const funding = await getFundingRate(asset).catch(e => { errs.funding = e.message; return null })
    const rv = await getRealizedVol(asset).catch(e => { errs.rv = e.message; return null })
    const spot = await getSpot(asset).catch(e => { errs.spot = e.message; return null })

    // Basis
    let basisAvg = null
    try {
      const futures = await getFutures(asset)
      const dated = futures.filter(f => !f.instrument_name.includes('PERPETUAL')).slice(0, 4)
      const basisValues = []
      for (const f of dated) {
        try {
          const price = await getFuturePrice(f.instrument_name)
          if (price && spot) {
            const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
            basisValues.push((price - spot) / spot * 100 / days * 365)
          }
        } catch(_) {}
      }
      if (basisValues.length) basisAvg = basisValues.reduce((a,b)=>a+b,0)/basisValues.length
    } catch(e) { errs.basis = e.message }

    const s1 = scoreIV(dvol)
    const s2 = scoreFunding(funding)
    const s3 = scoreBasis(basisAvg)
    const s4 = scoreIVvsRV(dvol, rv)
    const global = calcGlobalScore(s1, s2, s3, s4)

    setErrors(errs)
    setData({ dvol, funding, rv, spot, basisAvg, s1, s2, s3, s4, global })
    setLastUpdate(new Date())
    setLoading(false)
  }

  const signal = data?.global != null ? getSignal(data.global) : null
  const globalColor = !data?.global ? 'var(--text-muted)'
    : data.global >= 80 ? 'var(--call)'
    : data.global >= 60 ? 'var(--atm)'
    : data.global >= 40 ? 'var(--accent2)'
    : 'var(--put)'

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Signal <span>DI</span></div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {lastUpdate && <span style={{ fontSize:10, color:'var(--text-muted)' }}>{lastUpdate.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</span>}
          <button className={`icon-btn${loading?' loading':''}`} onClick={load}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            Analyser
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:16 }}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => { setAsset('BTC'); setData(null) }}>₿ BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => { setAsset('ETH'); setData(null) }}>Ξ ETH</button>
      </div>

      {/* Erreurs de chargement */}
      {Object.keys(errors).length > 0 && (
        <div className="card" style={{ marginBottom:12, borderColor:'rgba(255,107,53,.3)' }}>
          <div className="card-header" style={{ color:'var(--accent2)' }}>⚠ Données partielles</div>
          <div style={{ padding:'10px 16px', fontSize:11, color:'var(--text-muted)' }}>
            {Object.entries(errors).map(([k,v]) => (
              <div key={k}>• {k}: {v}</div>
            ))}
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="empty-state">
          <div className="empty-icon">⚡</div>
          <h3>Signal DI</h3>
          <p>Appuyez sur Analyser pour calculer le score optimal</p>
        </div>
      )}

      {loading && (
        <div className="card">
          <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
            Chargement des indicateurs…
          </div>
        </div>
      )}

      {data && (
        <div className="fade-in">

          {/* Score global */}
          {signal ? (
            <div style={{ background:signal.bg, border:`1px solid ${signal.border}`, borderRadius:14, padding:'20px', marginBottom:16, textAlign:'center' }}>
              <div style={{ fontFamily:'var(--sans)', fontSize:11, color:'var(--text-muted)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:8 }}>Score DI Global</div>
              <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:64, color:globalColor, lineHeight:1, marginBottom:8 }}>
                {data.global}
              </div>
              <div style={{ height:10, background:'rgba(255,255,255,.06)', borderRadius:5, overflow:'hidden', marginBottom:14, maxWidth:240, margin:'0 auto 14px' }}>
                <div style={{ height:'100%', width:`${data.global}%`, background:globalColor, borderRadius:5 }} />
              </div>
              <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:signal.color, marginBottom:6 }}>
                {signal.label}
              </div>
              <div style={{ fontSize:12, color:'var(--text-dim)' }}>{signal.action}</div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom:16 }}>
              <div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
                Score non calculable — données insuffisantes
              </div>
            </div>
          )}

          {/* 4 scores */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:12 }}>
            {[
              { label:'Volatilité (DVOL)', score:data.s1, weight:35, value: data.dvol ? `${data.dvol.current.toFixed(1)}` : 'N/A', sub: data.dvol ? `Moy. 30j: ${((data.dvol.monthMin+data.dvol.monthMax)/2).toFixed(1)}` : '—' },
              { label:'Funding Rate', score:data.s2, weight:25, value: data.funding?.avgAnn7d != null ? `${data.funding.avgAnn7d>0?'+':''}${data.funding.avgAnn7d.toFixed(1)}% /an` : 'N/A', sub: data.funding?.current != null ? `Actuel: ${data.funding.current>0?'+':''}${data.funding.current.toFixed(1)}%` : '—' },
              { label:'Basis Futures', score:data.s3, weight:25, value: data.basisAvg != null ? `${data.basisAvg>0?'+':''}${data.basisAvg.toFixed(1)}% /an` : 'N/A', sub: data.basisAvg > 0 ? 'Contango' : data.basisAvg < 0 ? 'Backwardation' : 'Flat' },
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
              {asset} : <strong style={{ color:'var(--atm)' }}>${data.spot.toLocaleString('en-US',{maximumFractionDigits:0})}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
