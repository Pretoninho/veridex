import { useState } from 'react'
import { getDVOL, getFundingRate, getOpenInterest, getRealizedVol } from '../utils/api.js'
import { getSpot, getFutures, getFuturePrice } from '../utils/api.js'

function scoreIV(dvol) {
  if (!dvol) return null
  const { current, weekAgo, monthMin, monthMax } = dvol
  const avg30 = (monthMin + monthMax) / 2
  const ratio = current / avg30
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
  if (s1 == null || s2 == null || s3 == null || s4 == null) return null
  return Math.round(s1 * 0.35 + s2 * 0.25 + s3 * 0.25 + s4 * 0.15)
}

function getSignal(score) {
  if (score == null) return null
  if (score >= 80) return { label: '🔥 Exceptionnel', color: 'var(--call)', bg: 'rgba(0,229,160,.08)', border: 'rgba(0,229,160,.3)', action: 'Sell High + Short Perp — conditions idéales' }
  if (score >= 60) return { label: '✓ Favorable',    color: 'var(--atm)',  bg: 'rgba(255,215,0,.06)', border: 'rgba(255,215,0,.3)',  action: 'DI recommandé — bon moment pour placer' }
  if (score >= 40) return { label: '~ Neutre',        color: 'var(--accent2)', bg: 'rgba(255,107,53,.06)', border: 'rgba(255,107,53,.3)', action: 'DI possible mais pas optimal — surveiller' }
  return               { label: '↓ Défavorable',   color: 'var(--put)',  bg: 'rgba(255,77,109,.06)', border: 'rgba(255,77,109,.3)',  action: 'Attendre un meilleur contexte' }
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ marginTop:6 }}>
      <div style={{ height:8, background:'rgba(255,255,255,.06)', borderRadius:4, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${score ?? 0}%`, background:color, borderRadius:4, transition:'width .6s ease' }} />
      </div>
    </div>
  )
}

function IndicatorCard({ label, score, value, detail, weight, color }) {
  const scoreColor = score >= 75 ? 'var(--call)' : score >= 50 ? 'var(--atm)' : score >= 25 ? 'var(--accent2)' : 'var(--put)'
  return (
    <div className="card" style={{ marginBottom:10 }}>
      <div style={{ padding:'14px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
          <div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:'var(--text-dim)' }}>{label}</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Poids : {weight}%</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color:scoreColor }}>{score ?? '—'}</div>
            <div style={{ fontSize:9, color:'var(--text-muted)' }}>/100</div>
          </div>
        </div>
        <ScoreBar score={score} color={scoreColor} />
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:11 }}>
          <span style={{ color:'var(--text-dim)', fontWeight:700 }}>{value}</span>
          <span style={{ color:'var(--text-muted)' }}>{detail}</span>
        </div>
      </div>
    </div>
  )
}

export default function SignalPage() {
  const [asset, setAsset] = useState('BTC')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [dvol, funding, rv, spot, futures] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getFundingRate(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
        getSpot(asset).catch(() => null),
        getFutures(asset).catch(() => []),
      ])

      // Calcul basis moyen
      let basisAvg = null
      if (spot && futures.length) {
        const basisValues = []
        for (const f of futures.filter(f => !f.instrument_name.includes('PERPETUAL')).slice(0, 5)) {
          try {
            const price = await getFuturePrice(f.instrument_name)
            if (price) {
              const days = Math.max(1, (f.expiration_timestamp - Date.now()) / 86400000)
              const basis = (price - spot) / spot * 100 / days * 365
              basisValues.push(basis)
            }
          } catch(_) {}
        }
        basisAvg = basisValues.length ? basisValues.reduce((a,b)=>a+b,0)/basisValues.length : null
      }

      // Scores
      const s1 = scoreIV(dvol)
      const s2 = scoreFunding(funding)
      const s3 = scoreBasis(basisAvg)
      const s4 = scoreIVvsRV(dvol, rv)
      const global = calcGlobalScore(s1, s2, s3, s4)

      setData({ dvol, funding, rv, spot, basisAvg, s1, s2, s3, s4, global })
      setLastUpdate(new Date())
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  const signal = data ? getSignal(data.global) : null

  const globalColor = data?.global >= 80 ? 'var(--call)'
    : data?.global >= 60 ? 'var(--atm)'
    : data?.global >= 40 ? 'var(--accent2)'
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

      {error && <div className="error-box">⚠ {error}</div>}

      {!data && !loading && (
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <h3>Prêt à analyser</h3>
          <p>Appuyez sur Analyser pour calculer le score DI optimal</p>
        </div>
      )}

      {loading && !data && (
        <div className="card">
          <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
            Chargement des indicateurs…
          </div>
        </div>
      )}

      {data && signal && (
        <div className="fade-in">

          {/* Score global */}
          <div style={{ background:signal.bg, border:`1px solid ${signal.border}`, borderRadius:14, padding:'20px 20px', marginBottom:16, textAlign:'center' }}>
            <div style={{ fontFamily:'var(--sans)', fontSize:11, color:'var(--text-muted)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:8 }}>Score DI Global</div>
            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:64, color:globalColor, lineHeight:1, marginBottom:4 }}>
              {data.global}
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:12 }}>/100</div>

            {/* Barre globale */}
            <div style={{ height:10, background:'rgba(255,255,255,.06)', borderRadius:5, overflow:'hidden', marginBottom:14, maxWidth:280, margin:'0 auto 14px' }}>
              <div style={{ height:'100%', width:`${data.global}%`, background:globalColor, borderRadius:5, transition:'width .8s ease' }} />
            </div>

            <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:signal.color, marginBottom:6 }}>
              {signal.label}
            </div>
            <div style={{ fontSize:12, color:'var(--text-dim)', lineHeight:1.6 }}>
              {signal.action}
            </div>
          </div>

          {/* Jauge visuelle des 4 scores */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:16 }}>
            {[
              { label:'IV', score:data.s1, weight:35 },
              { label:'Funding', score:data.s2, weight:25 },
              { label:'Basis', score:data.s3, weight:25 },
              { label:'IV/RV', score:data.s4, weight:15 },
            ].map(({ label, score, weight }) => {
              const c = score >= 75 ? 'var(--call)' : score >= 50 ? 'var(--atm)' : score >= 25 ? 'var(--accent2)' : 'var(--put)'
              return (
                <div key={label} className="stat-card" style={{ textAlign:'center' }}>
                  <div className="stat-label">{label}</div>
                  <div className="stat-value" style={{ color:c, fontSize:20 }}>{score ?? '—'}</div>
                  <div className="stat-sub">{weight}%</div>
                  <div style={{ height:4, background:'rgba(255,255,255,.06)', borderRadius:2, overflow:'hidden', marginTop:6 }}>
                    <div style={{ height:'100%', width:`${score ?? 0}%`, background:c, borderRadius:2 }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Détail indicateurs */}
          <IndicatorCard
            label="Volatilité Implicite (DVOL)"
            score={data.s1}
            weight={35}
            value={data.dvol ? `DVOL ${data.dvol.current.toFixed(1)}` : '—'}
            detail={data.dvol ? `Range 30j : ${data.dvol.monthMin.toFixed(0)}-${data.dvol.monthMax.toFixed(0)}` : '—'}
          />

          <IndicatorCard
            label="Funding Rate Perpétuel"
            score={data.s2}
            weight={25}
            value={data.funding?.avgAnn7d != null ? `${data.funding.avgAnn7d > 0 ? '+' : ''}${data.funding.avgAnn7d.toFixed(2)}% /an` : '—'}
            detail={data.funding?.current != null ? `Actuel : ${data.funding.current > 0 ? '+' : ''}${data.funding.current.toFixed(2)}% /an` : '—'}
          />

          <IndicatorCard
            label="Basis Futures (Term Structure)"
            score={data.s3}
            weight={25}
            value={data.basisAvg != null ? `${data.basisAvg > 0 ? '+' : ''}${data.basisAvg.toFixed(2)}% /an` : '—'}
            detail={data.basisAvg > 0 ? 'Contango' : data.basisAvg < 0 ? 'Backwardation' : 'Flat'}
          />

          <IndicatorCard
            label="IV vs Volatilité Réalisée"
            score={data.s4}
            weight={15}
            value={data.dvol && data.rv ? `Premium : ${(data.dvol.current - data.rv.current) > 0 ? '+' : ''}${(data.dvol.current - data.rv.current).toFixed(1)} pts` : '—'}
            detail={data.dvol && data.rv ? `IV ${data.dvol.current.toFixed(1)} vs RV ${data.rv.current.toFixed(1)}` : '—'}
          />

          {/* Recommandation stratégique détaillée */}
          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header">Recommandation stratégique</div>
            <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:10, fontSize:12, color:'var(--text-dim)', lineHeight:1.8 }}>
              {data.global >= 80 && (
                <>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Sell High</strong> — Conditions idéales pour vendre de la vol</div>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Short Perp</strong> — Funding positif, tu reçois le carry</div>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Strike</strong> — Viser delta 0.20-0.30 (OTM modéré)</div>
                  <div style={{ color:'var(--call)' }}>✓ <strong>Durée</strong> — Courte (1-3j) pour profiter du gamma decay</div>
                </>
              )}
              {data.global >= 60 && data.global < 80 && (
                <>
                  <div style={{ color:'var(--atm)' }}>✓ <strong>DI recommandé</strong> — Contexte favorable</div>
                  <div style={{ color:'var(--atm)' }}>✓ <strong>Strike</strong> — Rester conservateur, delta 0.15-0.20</div>
                  <div style={{ color:'var(--text-muted)' }}>~ <strong>Perp</strong> — Optionnel selon le funding actuel</div>
                </>
              )}
              {data.global >= 40 && data.global < 60 && (
                <>
                  <div style={{ color:'var(--accent2)' }}>~ <strong>DI possible</strong> — Pas le moment optimal</div>
                  <div style={{ color:'var(--accent2)' }}>~ <strong>Strike</strong> — Être très conservateur, delta &lt; 0.15</div>
                  <div style={{ color:'var(--text-muted)' }}>↓ <strong>Perp</strong> — Ne pas ouvrir de position</div>
                </>
              )}
              {data.global < 40 && (
                <>
                  <div style={{ color:'var(--put)' }}>↓ <strong>Attendre</strong> — Contexte défavorable</div>
                  <div style={{ color:'var(--put)' }}>↓ <strong>Vol basse</strong> — Les primes ne compensent pas le risque</div>
                  <div style={{ color:'var(--text-muted)' }}>💡 Surveiller le DVOL — attendre un spike &gt;10%</div>
                </>
              )}
            </div>
          </div>

          {/* Spot */}
          {data.spot && (
            <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>
              {asset} Spot : <strong style={{ color:'var(--atm)' }}>${data.spot.toLocaleString('en-US',{maximumFractionDigits:0})}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
