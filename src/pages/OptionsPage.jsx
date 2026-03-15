import { useState, useEffect } from 'react'
import { getSpot, getInstruments, getOrderBook, getAllExpiries, getDVOL, getRealizedVol } from '../utils/api.js'

// ── MOTEUR D'ANALYSE ──

function daysUntil(ts) { return Math.max(0.01, (ts - Date.now()) / 86400000) }

// Score Straddle/Strangle — vendre quand IV >> RV
function scoreStraddle(dvol, rv) {
  if (!dvol || !rv) return null
  const premium = dvol.current - rv.current
  const ratio   = dvol.current / ((dvol.monthMin + dvol.monthMax) / 2)
  let score = 0
  if (premium > 20) score += 50
  else if (premium > 10) score += 35
  else if (premium > 0)  score += 15
  if (ratio > 1.2)  score += 50
  else if (ratio > 1.1) score += 35
  else if (ratio > 0.95) score += 20
  else score += 5
  return Math.min(100, score)
}

// Score Risk Reversal — vendre le côté le plus cher
function scoreRiskReversal(skewData) {
  if (!skewData) return null
  const absSkew = Math.abs(skewData.skew25d)
  if (absSkew > 10) return 90
  if (absSkew > 7)  return 70
  if (absSkew > 4)  return 50
  if (absSkew > 2)  return 30
  return 15
}

// Score Calendar Spread — contango de vol
function scoreCalendar(termData) {
  if (!termData || termData.length < 2) return null
  const shortIV = termData[0]?.iv ?? 0
  const longIV  = termData[termData.length - 1]?.iv ?? 0
  const diff = shortIV - longIV
  if (diff > 10) return 90   // fort contango de vol → vendre court, acheter long
  if (diff > 5)  return 70
  if (diff > 0)  return 50
  if (diff > -5) return 30
  return 15                   // backwardation → inverse
}

// Score Butterfly — ATM surévaluée vs wings
function scoreButterfly(smileData) {
  if (!smileData || smileData.length < 3) return null
  const atm   = smileData.find(s => s.isATM)?.iv ?? null
  const wings = smileData.filter(s => !s.isATM && Math.abs(s.distPct) > 3 && Math.abs(s.distPct) < 10)
  if (!atm || wings.length < 2) return null
  const wingAvg = wings.reduce((s, w) => s + w.iv, 0) / wings.length
  const butterfly = atm - wingAvg
  if (butterfly > 8)  return 85
  if (butterfly > 5)  return 65
  if (butterfly > 2)  return 45
  return 25
}

// Score Directionnel — momentum + skew
function scoreDirectional(dvol, skewData, spot) {
  if (!dvol || !skewData) return null
  // Skew négatif → marché craint baisse → put chers → momentum baissier
  // Skew positif → calls chers → momentum haussier
  const skew = skewData.skew25d
  const ivLevel = dvol.current
  // Pour achat directionnel, on veut IV basse (options pas chères)
  const ivScore = ivLevel < 40 ? 70 : ivLevel < 55 ? 50 : ivLevel < 70 ? 30 : 15
  const skewScore = Math.abs(skew) > 5 ? 60 : Math.abs(skew) > 2 ? 40 : 20
  return Math.min(100, Math.round((ivScore * 0.6 + skewScore * 0.4)))
}

function getLabel(score) {
  if (score >= 75) return { text: 'Excellent', color: 'var(--call)' }
  if (score >= 55) return { text: 'Bon',       color: 'var(--atm)' }
  if (score >= 35) return { text: 'Neutre',    color: 'var(--accent2)' }
  return               { text: 'Faible',    color: 'var(--put)' }
}

function getStraddleReco(dvol, rv, spot, termData) {
  if (!dvol || !spot || !termData?.length) return null
  const bestExp = termData.slice(0, 3).find(t => t.days >= 3 && t.days <= 14)
  if (!bestExp) return null
  return {
    strategy: 'Vendre ATM Straddle',
    strike: bestExp.atmStrike,
    expiry: new Date(bestExp.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}).toUpperCase(),
    detail: `IV ${dvol.current.toFixed(0)}% vs RV ${rv?.current.toFixed(0) ?? '?'}% — prime de ${(dvol.current-(rv?.current??0)).toFixed(0)} pts`,
    action: `Vendre 1 call + 1 put strike $${bestExp.atmStrike?.toLocaleString()} · encaisser la prime des deux côtés`
  }
}

function getRRReco(skewData, spot, termData) {
  if (!skewData || !spot || !termData?.length) return null
  const side = skewData.skew25d < 0 ? 'put' : 'call'
  const bestExp = termData[0]
  return {
    strategy: skewData.skew25d < 0 ? 'Vendre Put OTM (skew élevé)' : 'Vendre Call OTM (skew élevé)',
    strike: skewData.skew25d < 0 ? skewData.put25dStrike : skewData.call25dStrike,
    expiry: bestExp ? new Date(bestExp.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}).toUpperCase() : '—',
    detail: `Skew 25d : ${skewData.skew25d.toFixed(1)} pts — le côté ${side} est structurellement sur-pricé`,
    action: `Vendre ${side === 'put' ? 'put' : 'call'} OTM 25-delta · la prime excède le risque réel`
  }
}

function getCalendarReco(termData) {
  if (!termData || termData.length < 2) return null
  const short = termData[0]
  const long  = termData.find(t => t.days > 20) ?? termData[termData.length - 1]
  const diff  = (short?.iv ?? 0) - (long?.iv ?? 0)
  return {
    strategy: diff > 0 ? 'Calendar Spread (contango vol)' : 'Calendar Spread inversé',
    strike: short?.atmStrike,
    expiry: `${new Date(short?.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}).toUpperCase()} / ${new Date(long?.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}).toUpperCase()}`,
    detail: `IV courte ${short?.iv?.toFixed(0)}% vs longue ${long?.iv?.toFixed(0)}% — écart ${Math.abs(diff).toFixed(1)} pts`,
    action: diff > 0
      ? `Vendre l'option courte + acheter la longue · encaisser la différence de vol`
      : `Acheter la courte + vendre la longue · jouer le retour au contango`
  }
}

function getButterflyReco(smileData, spot) {
  if (!smileData?.length || !spot) return null
  const atm = smileData.find(s => s.isATM)
  if (!atm) return null
  const wingDown = smileData.find(s => s.distPct < -4 && s.distPct > -8)
  const wingUp   = smileData.find(s => s.distPct > 4  && s.distPct < 8)
  if (!wingDown || !wingUp) return null
  return {
    strategy: 'Short Butterfly ATM',
    strike: `${wingDown.strike} / ${atm.strike} / ${wingUp.strike}`,
    expiry: '—',
    detail: `ATM IV ${atm.iv.toFixed(0)}% vs wings avg ${((wingDown.iv+wingUp.iv)/2).toFixed(0)}% — ATM sur-pricée de ${(atm.iv-(wingDown.iv+wingUp.iv)/2).toFixed(1)} pts`,
    action: `Vendre 2 ATM + acheter 1 wing bas + 1 wing haut · profiter si prix reste proche du spot`
  }
}

export default function OptionsPage({ onBack }) {
  const [asset, setAsset] = useState('BTC')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('radar')
  const [scores, setScores] = useState(null)
  const [recos, setRecos] = useState(null)
  const [termData, setTermData] = useState([])
  const [smileData, setSmileData] = useState([])
  const [skewData, setSkewData] = useState(null)
  const [spot, setSpot] = useState(null)
  const [dvol, setDvol] = useState(null)
  const [rv, setRv] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const analyze = async (a) => {
    setLoading(true)
    const asset = a || 'BTC'
    try {
      const [sp, instruments, dv, rvData] = await Promise.all([
        getSpot(asset),
        getInstruments(asset),
        getDVOL(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
      ])
      setSpot(sp); setDvol(dv); setRv(rvData)

      const expiries = getAllExpiries(instruments)

      // Term structure
      const term = []
      for (const ts of expiries.slice(0, 6)) {
        const days = daysUntil(ts)
        const forExp = instruments.filter(i => i.expiration_timestamp === ts)
        const strikes = [...new Set(forExp.map(i => i.strike))].sort((a,b) => a-b)
        const atmS = strikes.reduce((p,c) => Math.abs(c-sp) < Math.abs(p-sp) ? c : p)
        const callInst = forExp.find(x => x.option_type==='call' && x.strike===atmS)
        const putInst  = forExp.find(x => x.option_type==='put'  && x.strike===atmS)
        const [cb, pb] = await Promise.all([
          callInst ? getOrderBook(callInst.instrument_name).catch(()=>null) : Promise.resolve(null),
          putInst  ? getOrderBook(putInst.instrument_name).catch(()=>null)  : Promise.resolve(null),
        ])
        const iv = cb?.mark_iv != null && pb?.mark_iv != null
          ? (cb.mark_iv + pb.mark_iv) / 2
          : cb?.mark_iv ?? pb?.mark_iv ?? null
        term.push({ ts, days, iv, atmStrike: atmS })
      }
      setTermData(term)

      // Smile + Skew (première échéance)
      const firstExp = expiries[0]
      const forFirst = instruments.filter(i => i.expiration_timestamp === firstExp)
      const firstStrikes = [...new Set(forFirst.map(i => i.strike))].sort((a,b) => a-b)
      const atmIdx = firstStrikes.reduce((bi,s,i) => Math.abs(s-sp) < Math.abs(firstStrikes[bi]-sp) ? i : bi, 0)
      const smileStrikes = firstStrikes.slice(Math.max(0,atmIdx-6), atmIdx+7)
      const smile = []
      let put25d = null, call25d = null, put25dStrike = null, call25dStrike = null

      for (const strike of smileStrikes) {
        const callInst = forFirst.find(x => x.option_type==='call' && x.strike===strike)
        const putInst  = forFirst.find(x => x.option_type==='put'  && x.strike===strike)
        const [cb, pb] = await Promise.all([
          callInst ? getOrderBook(callInst.instrument_name).catch(()=>null) : Promise.resolve(null),
          putInst  ? getOrderBook(putInst.instrument_name).catch(()=>null)  : Promise.resolve(null),
        ])
        const distPct = (strike - sp) / sp * 100
        const iv = cb?.mark_iv ?? pb?.mark_iv ?? null
        const delta = cb?.greeks?.delta ?? null
        smile.push({ strike, iv, distPct, isATM: Math.abs(distPct) < 1.5 })

        // Skew 25-delta
        if (delta != null) {
          if (Math.abs(delta - 0.25) < 0.05 && !call25d) { call25d = cb?.mark_iv; call25dStrike = strike }
          if (Math.abs(delta - 0.75) < 0.05 && !put25d)  { put25d  = cb?.mark_iv; put25dStrike  = strike }
        }
      }
      setSmileData(smile)

      const skew = put25d != null && call25d != null
        ? { skew25d: put25d - call25d, put25dStrike, call25dStrike, put25dIV: put25d, call25dIV: call25d }
        : { skew25d: 0, put25dStrike: null, call25dStrike: null }
      setSkewData(skew)

      // Scores
      const s1 = scoreStraddle(dv, rvData)
      const s2 = scoreRiskReversal(skew)
      const s3 = scoreCalendar(term)
      const s4 = scoreButterfly(smile)
      const s5 = scoreDirectional(dv, skew, sp)
      setScores({ s1, s2, s3, s4, s5 })

      // Recommandations
      setRecos({
        straddle:   getStraddleReco(dv, rvData, sp, term),
        rr:         getRRReco(skew, sp, term),
        calendar:   getCalendarReco(term),
        butterfly:  getButterflyReco(smile, sp),
      })

      setLastUpdate(new Date())
    } catch(e) { console.warn('Options analyze error:', e) }
    setLoading(false)
  }

  useEffect(() => { analyze(asset) }, [asset])

  const maxIV = smileData.length ? Math.max(...smileData.map(r => r.iv ?? 0)) : 1

  return (
    <div className="app-shell">
      <div className="app-content">
        <div className="page-wrap">

          {/* Header */}
          <div className="page-header">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <button onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="page-title">Option <span>Analyzer</span></div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {spot && <div className="price-pill"><span className="price-label">{asset}</span><span className="price-value">${spot.toLocaleString('en-US',{maximumFractionDigits:0})}</span></div>}
              <button className={`icon-btn${loading?' loading':''}`} onClick={() => analyze(asset)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Asset toggle */}
          <div className="asset-toggle" style={{ marginBottom:12 }}>
            <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => setAsset('BTC')}>BTC</button>
            <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => setAsset('ETH')}>ETH</button>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
            {[['radar','Radar'],['surface','Surface'],['skew','Skew']].map(([id,label]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                padding:'8px 18px', background:'none', border:'none', cursor:'pointer',
                fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
                color: activeTab===id ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab===id ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom:-1
              }}>{label}</button>
            ))}
          </div>

          {loading && !scores && (
            <div className="card"><div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Analyse en cours...</div></div>
          )}

          {/* ── RADAR ── */}
          {activeTab === 'radar' && scores && (
            <div className="fade-in">
              {lastUpdate && <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:12, textAlign:'right' }}>{lastUpdate.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>}

              {/* Context rapide */}
              {dvol && rv && (
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', marginBottom:14, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, fontSize:11 }}>
                  <div><div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>IV (DVOL)</div><div style={{ fontWeight:700, color:'var(--accent)' }}>{dvol.current.toFixed(1)}%</div></div>
                  <div><div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>RV</div><div style={{ fontWeight:700, color:'var(--accent2)' }}>{rv.current.toFixed(1)}%</div></div>
                  <div><div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>Prime de vol</div><div style={{ fontWeight:700, color: dvol.current > rv.current ? 'var(--call)' : 'var(--put)' }}>{(dvol.current-rv.current).toFixed(1)} pts</div></div>
                </div>
              )}

              {/* Scores 5 stratégies */}
              {[
                { id:'s1', label:'Straddle / Strangle', score:scores.s1, icon:'◈', reco:recos?.straddle,
                  desc:'Vendre call + put ATM · profiter si prix reste stable' },
                { id:'s2', label:'Risk Reversal', score:scores.s2, icon:'⇄', reco:recos?.rr,
                  desc:'Vendre le côté le plus cher du smile' },
                { id:'s3', label:'Calendar Spread', score:scores.s3, icon:'◫', reco:recos?.calendar,
                  desc:'Jouer la différence de vol entre échéances' },
                { id:'s4', label:'Butterfly', score:scores.s4, icon:'⌖', reco:recos?.butterfly,
                  desc:'ATM surévaluée vs les wings' },
                { id:'s5', label:'Directionnel Call/Put', score:scores.s5, icon:'↗', reco:null,
                  desc:'Acheter call ou put quand IV est basse' },
              ].sort((a,b) => (b.score??0)-(a.score??0)).map(({ id, label, score, icon, reco, desc }) => {
                const lbl = getLabel(score ?? 0)
                return (
                  <div key={id} className="card" style={{ marginBottom:10 }}>
                    <div style={{ padding:'14px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:16, color:'var(--accent)' }}>{icon}</span>
                          <div>
                            <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:'var(--text)' }}>{label}</div>
                            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{desc}</div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:20, color:lbl.color }}>{score ?? '—'}</div>
                          <div style={{ fontSize:10, color:lbl.color, fontWeight:700 }}>{lbl.text}</div>
                        </div>
                      </div>
                      {/* Barre score */}
                      <div style={{ height:4, background:'rgba(255,255,255,.06)', borderRadius:2, overflow:'hidden', marginBottom: reco ? 10 : 0 }}>
                        <div style={{ height:'100%', width:`${score??0}%`, background:lbl.color, borderRadius:2, transition:'width .6s' }}/>
                      </div>
                      {/* Recommandation détaillée */}
                      {reco && (
                        <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', marginTop:8 }}>
                          <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:11, color:lbl.color, marginBottom:4 }}>{reco.strategy}</div>
                          <div style={{ fontSize:10, color:'var(--text-dim)', marginBottom:4 }}>
                            Strike : <strong>${reco.strike?.toLocaleString()}</strong> · Expiry : <strong>{reco.expiry}</strong>
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:6 }}>{reco.detail}</div>
                          <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.6, borderTop:'1px solid rgba(255,255,255,.05)', paddingTop:6 }}>
                            {reco.action}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── SURFACE ── */}
          {activeTab === 'surface' && (
            <div className="fade-in">
              <div style={{ marginBottom:12 }}>
                <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:'var(--text-dim)', marginBottom:4 }}>Term Structure de vol</div>
                <div style={{ fontSize:10, color:'var(--text-muted)' }}>IV ATM par échéance</div>
              </div>
              {termData.length > 0 && (
                <div className="card" style={{ marginBottom:14 }}>
                  {(() => {
                    const maxTIV = Math.max(...termData.map(t => t.iv ?? 0))
                    return termData.map((t, i) => {
                      const barPct = t.iv ? (t.iv / maxTIV) * 100 : 0
                      const color = i === 0 ? 'var(--accent)' : i === 1 ? 'var(--atm)' : 'var(--accent2)'
                      return (
                        <div key={t.ts} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)' }}>
                          <div style={{ width:70, flexShrink:0 }}>
                            <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:11, color:'var(--text)' }}>
                              {new Date(t.ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'}).toUpperCase()}
                            </div>
                            <div style={{ fontSize:9, color:'var(--text-muted)' }}>{t.days.toFixed(0)}j</div>
                          </div>
                          <div style={{ flex:1, height:8, background:'rgba(255,255,255,.05)', borderRadius:4, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${barPct}%`, background:color, borderRadius:4 }}/>
                          </div>
                          <div style={{ width:50, textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:13, fontWeight:700, color }}>{t.iv?.toFixed(1) ?? '—'}%</div>
                          </div>
                        </div>
                      )
                    })
                  })()}
                  <div style={{ padding:'10px 14px', fontSize:10, color:'var(--text-muted)' }}>
                    {termData[0]?.iv > (termData[termData.length-1]?.iv ?? 0)
                      ? '⚠ Contango de vol — court terme plus cher que long terme'
                      : '↗ Backwardation — long terme plus cher que court terme'}
                  </div>
                </div>
              )}

              {/* Smile */}
              <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:'var(--text-dim)', marginBottom:4 }}>Smile de volatilité</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:10 }}>IV par strike — prochaine échéance</div>
              {smileData.length > 0 && (
                <div className="card">
                  {smileData.filter(r => r.iv != null).map(r => {
                    const color = r.isATM ? 'var(--atm)' : r.distPct < 0 ? 'var(--call)' : 'var(--accent2)'
                    return (
                      <div key={r.strike} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', borderBottom:'1px solid rgba(30,58,95,.2)' }}>
                        <span style={{ width:72, fontSize:10, fontWeight:r.isATM?800:400, color:r.isATM?'var(--atm)':'var(--text-dim)', textAlign:'right', flexShrink:0 }}>
                          ${r.strike >= 1000 ? (r.strike/1000).toFixed(0)+'K' : r.strike}
                          {r.isATM && <span style={{ fontSize:8, marginLeft:3 }}>ATM</span>}
                        </span>
                        <div style={{ flex:1, height:6, background:'rgba(255,255,255,.05)', borderRadius:3, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${(r.iv/maxIV)*100}%`, background:color, borderRadius:3 }}/>
                        </div>
                        <span style={{ width:44, fontSize:10, color, fontWeight:r.isATM?700:400, textAlign:'right', flexShrink:0 }}>{r.iv.toFixed(1)}%</span>
                        <span style={{ width:36, fontSize:9, color:'var(--text-muted)', textAlign:'right', flexShrink:0 }}>{r.distPct > 0 ? '+' : ''}{r.distPct.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── SKEW ── */}
          {activeTab === 'skew' && skewData && (
            <div className="fade-in">
              <div style={{ marginBottom:14 }}>
                <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:'var(--text-dim)', marginBottom:4 }}>Skew 25-Delta</div>
                <div style={{ fontSize:10, color:'var(--text-muted)' }}>Asymétrie du smile de volatilité</div>
              </div>

              {/* Skew principal */}
              <div className="card" style={{ marginBottom:12 }}>
                <div style={{ padding:'20px 16px', textAlign:'center' }}>
                  <div style={{ fontSize:10, color:'var(--text-muted)', letterSpacing:'1px', textTransform:'uppercase', marginBottom:8 }}>Risk Reversal 25d</div>
                  <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:48, color: skewData.skew25d > 3 ? 'var(--put)' : skewData.skew25d < -3 ? 'var(--call)' : 'var(--atm)' }}>
                    {skewData.skew25d > 0 ? '+' : ''}{skewData.skew25d.toFixed(1)}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>
                    {skewData.skew25d > 5 ? 'Puts très chers — marché craint une baisse forte'
                    : skewData.skew25d > 2 ? 'Légère prime sur les puts — biais baissier modéré'
                    : skewData.skew25d < -5 ? 'Calls très chers — euphorie haussière'
                    : skewData.skew25d < -2 ? 'Légère prime sur les calls — biais haussier modéré'
                    : 'Smile symétrique — pas de biais directionnel marqué'}
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', borderTop:'1px solid var(--border)' }}>
                  <div style={{ padding:'14px 16px', borderRight:'1px solid var(--border)' }}>
                    <div style={{ fontSize:9, color:'var(--text-muted)', marginBottom:4, textTransform:'uppercase' }}>Put 25d</div>
                    <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:'var(--call)' }}>{skewData.put25dIV?.toFixed(1) ?? '—'}%</div>
                    {skewData.put25dStrike && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Strike ${skewData.put25dStrike?.toLocaleString()}</div>}
                  </div>
                  <div style={{ padding:'14px 16px' }}>
                    <div style={{ fontSize:9, color:'var(--text-muted)', marginBottom:4, textTransform:'uppercase' }}>Call 25d</div>
                    <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color:'var(--accent2)' }}>{skewData.call25dIV?.toFixed(1) ?? '—'}%</div>
                    {skewData.call25dStrike && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Strike ${skewData.call25dStrike?.toLocaleString()}</div>}
                  </div>
                </div>
              </div>

              {/* Interprétation trading */}
              <div className="card">
                <div className="card-header">Interprétation trading</div>
                <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:10, fontSize:12, color:'var(--text-dim)', lineHeight:1.8 }}>
                  {skewData.skew25d > 5 && <>
                    <div style={{ color:'var(--call)' }}>✓ <strong>Vendre des puts OTM</strong> — prime excessive vs risque réel</div>
                    <div style={{ color:'var(--call)' }}>✓ <strong>Risk Reversal</strong> — vendre put / acheter call à coût réduit</div>
                    <div style={{ color:'var(--text-muted)' }}>~ Éviter d'acheter des puts — trop chers</div>
                  </>}
                  {skewData.skew25d < -5 && <>
                    <div style={{ color:'var(--accent2)' }}>✓ <strong>Vendre des calls OTM</strong> — prime excessive</div>
                    <div style={{ color:'var(--accent2)' }}>✓ <strong>Risk Reversal inverse</strong> — vendre call / acheter put</div>
                    <div style={{ color:'var(--text-muted)' }}>~ Éviter d'acheter des calls — trop chers</div>
                  </>}
                  {Math.abs(skewData.skew25d) <= 5 && <>
                    <div style={{ color:'var(--atm)' }}>~ <strong>Skew neutre</strong> — pas d'opportunité de Risk Reversal évidente</div>
                    <div style={{ color:'var(--text-muted)' }}>Favoriser Straddle ou Butterfly selon le niveau d'IV</div>
                  </>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
