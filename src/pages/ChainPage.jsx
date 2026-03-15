import { useState, useEffect } from 'react'
import { getSpot, getInstruments, getOrderBook, getAllExpiries, blackScholes, getBestDIOpportunities } from '../utils/api.js'

function fmtTs(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
}

function daysUntil(ts) {
  return Math.max(0.01, (ts - Date.now()) / 86400000)
}

// Score un taux Nexo vs la volatilité du moment
// Plus l'IV est élevée, plus le taux est justifié
function scoreNexoRate(nexoRate, iv, days) {
  if (!nexoRate || !iv || !days) return null
  // Taux "juste" estimé via BS ATM simplifié
  const T = days / 365
  const fairRate = iv / 100 * Math.sqrt(T) * 0.4 * 100 * (365 / days)
  const ratio = nexoRate / fairRate
  return { ratio, fairRate }
}

function getRating(ratio) {
  if (ratio == null) return null
  if (ratio >= 0.85) return { label: '🔥 Excellent', color: 'var(--call)', detail: 'Taux très proche du marché' }
  if (ratio >= 0.65) return { label: '✓ Bon', color: 'var(--atm)', detail: 'Taux correct' }
  if (ratio >= 0.45) return { label: '~ Passable', color: 'var(--accent2)', detail: 'Nexo garde une marge importante' }
  return { label: '↓ Faible', color: 'var(--put)', detail: 'Nexo sous-paie significativement' }
}

export default function ChainPage() {
  const [asset, setAsset] = useState('BTC')
  const [instruments, setInstruments] = useState([])
  const [expiries, setExpiries] = useState([])
  const [selExpiry, setSelExpiry] = useState(null)
  const [rows, setRows] = useState([])
  const [spot, setSpot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState(null)
  const [activeTab, setActiveTab] = useState('chain')
  const [diExpiry, setDiExpiry] = useState(null)
  const [atmIV, setAtmIV] = useState(null)
  const [diView, setDiView] = useState('strike')
  const [multiData, setMultiData] = useState([])
  const [multiLoading, setMultiLoading] = useState(false)
  const [opps, setOpps] = useState([])
  const [oppsLoading, setOppsLoading] = useState(false)
  // Taux Nexo saisis par strike
  const [nexoRates, setNexoRates] = useState({}) // { strike: rate }

  const loadExpiries = async (a) => {
    setLoading(true); setError(null)
    try {
      const [sp, inst] = await Promise.all([getSpot(a), getInstruments(a)])
      setSpot(sp)
      setInstruments(inst)
      const exps = getAllExpiries(inst)
      setExpiries(exps)
      if (exps.length) {
        setSelExpiry(exps[0])
        setDiExpiry(exps[0])
        await loadChain(a, exps[0], inst, sp)
      }
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  const loadChain = async (a, expiryTs, inst, sp) => {
    const forExp  = inst.filter(i => i.expiration_timestamp === expiryTs)
    const strikes = [...new Set(forExp.map(i => i.strike))].sort((x,y) => x - y)
    const spotNow = sp || spot
    const BATCH   = 20
    const allRows = []
    for (let i = 0; i < strikes.length; i += BATCH) {
      const batch = strikes.slice(i, i + BATCH)
      const batchRows = await Promise.all(batch.map(async strike => {
        const callInst = forExp.find(x => x.option_type==='call' && x.strike===strike)
        const putInst  = forExp.find(x => x.option_type==='put'  && x.strike===strike)
        const [cb, pb] = await Promise.all([
          callInst ? getOrderBook(callInst.instrument_name).catch(()=>null) : Promise.resolve(null),
          putInst  ? getOrderBook(putInst.instrument_name).catch(()=>null)  : Promise.resolve(null),
        ])
        return { strike, call: cb, put: pb }
      }))
      allRows.push(...batchRows)
    }
    setRows(allRows)
    const callIVs = allRows.map(r => r.call?.mark_iv).filter(Boolean)
    const putIVs  = allRows.map(r => r.put?.mark_iv).filter(Boolean)
    const atmRow  = spotNow ? allRows.reduce((p,c) => Math.abs(c.strike-spotNow) < Math.abs(p.strike-spotNow) ? c : p, allRows[0]) : null
    const atmiv   = atmRow?.call?.mark_iv ?? atmRow?.put?.mark_iv ?? null
    setAtmIV(atmiv)
    setStats({
      callIV:    callIVs.length ? (callIVs.reduce((a,b)=>a+b,0)/callIVs.length).toFixed(1) : '—',
      putIV:     putIVs.length  ? (putIVs.reduce((a,b)=>a+b,0)/putIVs.length).toFixed(1)   : '—',
      atmIV:     atmiv?.toFixed(1) || '—',
      atmStrike: atmRow?.strike,
      contracts: allRows.length,
    })
    setNexoRates({}) // reset taux à chaque changement d'échéance
  }

  const loadMulti = async () => {
    if (!instruments.length || !spot) return
    setMultiLoading(true)
    const results = []
    for (const ts of expiries) {
      try {
        const days    = daysUntil(ts)
        const forExp  = instruments.filter(i => i.expiration_timestamp === ts)
        const strikes = [...new Set(forExp.map(i => i.strike))]
        const atmS    = strikes.reduce((p,c) => Math.abs(c-spot) < Math.abs(p-spot) ? c : p)
        const callInst = forExp.find(x => x.option_type==='call' && x.strike===atmS)
        const putInst  = forExp.find(x => x.option_type==='put'  && x.strike===atmS)
        const [cb, pb] = await Promise.all([
          callInst ? getOrderBook(callInst.instrument_name).catch(()=>null) : Promise.resolve(null),
          putInst  ? getOrderBook(putInst.instrument_name).catch(()=>null)  : Promise.resolve(null),
        ])
        const iv = cb?.mark_iv != null && pb?.mark_iv != null
          ? (cb.mark_iv + pb.mark_iv) / 2
          : cb?.mark_iv ?? pb?.mark_iv ?? null
        const T = days / 365
        const fairRate = iv ? iv / 100 * Math.sqrt(T) * 0.4 * 100 * (365 / days) : null
        results.push({ ts, days, atmStrike: atmS, iv, fairRate })
      } catch(_) {}
    }
    setMultiData(results)
    setMultiLoading(false)
  }

  useEffect(() => { loadExpiries(asset) }, [asset])

  const switchExpiry = async (ts) => {
    setSelExpiry(ts); setLoading(true)
    try { await loadChain(asset, ts, instruments, spot) }
    catch(e) { setError(e.message) }
    setLoading(false)
  }

  const fmt  = n => n != null ? n.toFixed(2) : '—'
  const fmtK = n => n != null ? (n >= 1000 ? (n/1000).toFixed(1)+'K' : n.toFixed(0)) : '—'

  const diDays = diExpiry ? daysUntil(diExpiry) : null

  const diRows = rows.map(r => {
    const iv      = r.put?.mark_iv ?? r.call?.mark_iv ?? null
    const distPct = spot ? (r.strike - spot) / spot * 100 : null
    const isBuyLow   = distPct != null && distPct < 0
    const isSellHigh = distPct != null && distPct > 0
    const nexoRate = nexoRates[r.strike] ?? null
    const scored   = nexoRate && iv && diDays ? scoreNexoRate(nexoRate, iv, diDays) : null
    const rating   = scored ? getRating(scored.ratio) : null
    return { strike: r.strike, iv, distPct, isBuyLow, isSellHigh, nexoRate, scored, rating }
  })

  const atmRowDI = diRows.find(r => stats?.atmStrike === r.strike)
  const smileRows = rows
    .map(r => ({ strike: r.strike, iv: r.call?.mark_iv ?? r.put?.mark_iv ?? null, distPct: spot ? (r.strike-spot)/spot*100 : null }))
    .filter(r => r.iv != null)
  const maxIV = smileRows.length ? Math.max(...smileRows.map(r => r.iv)) : 1

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Chaîne <span>Options</span></div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {spot && (
            <div className="price-pill">
              <span className="price-label">{asset}</span>
              <span className="price-value">${spot.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
            </div>
          )}
          <button className={`icon-btn${loading?' loading':''}`} onClick={() => loadExpiries(asset)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:12 }}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => setAsset('BTC')}>₿ BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => setAsset('ETH')}>Ξ ETH</button>
      </div>

      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['chain','Chaîne'],['di','Évaluer DI'],['opps','Top DI']].map(([id,label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding:'8px 18px', background:'none', border:'none', cursor:'pointer',
            fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
            color: activeTab===id ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab===id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom:-1, transition:'all .2s'
          }}>{label}</button>
        ))}
      </div>

      {error && <div className="error-box">⚠ {error}</div>}

      {stats && (
        <div className="stats-grid" style={{ marginBottom:12 }}>
          <div className="stat-card"><div className="stat-label">IV ATM</div><div className="stat-value gold">{stats.atmIV}%</div>{stats.atmStrike&&<div className="stat-sub">Strike {stats.atmStrike?.toLocaleString()}</div>}</div>
          <div className="stat-card"><div className="stat-label">Contrats</div><div className="stat-value blue">{stats.contracts}</div></div>
          <div className="stat-card"><div className="stat-label">IV moy. Calls</div><div className="stat-value green">{stats.callIV}%</div></div>
          <div className="stat-card"><div className="stat-label">IV moy. Puts</div><div className="stat-value orange">{stats.putIV}%</div></div>
        </div>
      )}

      {/* ── CHAÎNE ── */}
      {activeTab === 'chain' && (
        <>
          <div className="expiry-chips">
            {expiries.map(ts => (
              <button key={ts} className={`expiry-chip${selExpiry===ts?' active':''}`} onClick={() => switchExpiry(ts)}>
                {fmtTs(ts)}
              </button>
            ))}
          </div>
          {loading && rows.length === 0 && (
            <div className="card"><div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Chargement…</div></div>
          )}
          {smileRows.length > 0 && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header"><span>Smile de volatilité</span><span style={{ fontSize:10, color:'var(--text-muted)' }}>IV par strike</span></div>
              <div style={{ padding:'12px 14px' }}>
                {smileRows.map(r => {
                  const isATM  = stats?.atmStrike === r.strike
                  const barPct = (r.iv / maxIV) * 100
                  const isPeak = r.iv === maxIV
                  const color  = isATM ? 'var(--atm)' : r.distPct < 0 ? 'var(--call)' : 'var(--accent2)'
                  return (
                    <div key={r.strike} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                      <span style={{ width:72, fontSize:10, fontFamily:'var(--sans)', fontWeight:isATM?800:400, color:isATM?'var(--atm)':'var(--text-dim)', textAlign:'right', flexShrink:0 }}>
                        {r.strike >= 1000 ? (r.strike/1000).toFixed(0)+'K' : r.strike}
                      </span>
                      <div style={{ flex:1, height:6, background:'rgba(255,255,255,.05)', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${barPct}%`, background:color, borderRadius:3 }} />
                      </div>
                      <span style={{ width:44, fontSize:10, color:isPeak?'var(--atm)':color, fontWeight:isPeak?700:400, textAlign:'right', flexShrink:0 }}>
                        {r.iv.toFixed(1)}%{isPeak&&<span style={{ fontSize:8 }}> ▲</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {rows.length > 0 && (
            <div className="card">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', padding:'6px 14px', borderBottom:'1px solid var(--border)', fontSize:10 }}>
                <span style={{ color:'var(--call)', fontWeight:700 }}>CALLS</span>
                <span style={{ color:'var(--atm)', fontWeight:700, textAlign:'center' }}>STRIKE</span>
                <span style={{ color:'var(--put)', fontWeight:700, textAlign:'right' }}>PUTS</span>
              </div>
              {rows.map(({ strike, call, put }) => {
                const isATM = stats?.atmStrike === strike
                return (
                  <div key={strike} style={{
                    padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.4)',
                    background: isATM ? 'rgba(255,215,0,.04)' : undefined,
                    borderLeft: isATM ? '2px solid var(--atm)' : '2px solid transparent',
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                      <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14, color:isATM?'var(--atm)':'var(--text)' }}>
                        ${strike.toLocaleString()}{isATM&&<span style={{ fontSize:9, marginLeft:5, opacity:.7 }}>ATM</span>}
                      </span>
                      <div style={{ display:'flex', gap:14, fontSize:11 }}>
                        <span style={{ color:'var(--call)' }}>C: {fmt(call?.mark_iv)}%</span>
                        <span style={{ color:'var(--put)' }}>P: {fmt(put?.mark_iv)}%</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)' }}>
                      <span>OI: <span style={{ color:'var(--call)' }}>{fmtK(call?.open_interest)}</span> / <span style={{ color:'var(--put)' }}>{fmtK(put?.open_interest)}</span></span>
                      <span>Δ: <span style={{ color:'var(--call)' }}>{fmt(call?.greeks?.delta)}</span> / <span style={{ color:'var(--put)' }}>{fmt(put?.greeks?.delta)}</span></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!loading && rows.length === 0 && !error && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Prêt à charger</h3><p>Appuyez sur actualiser</p></div>
          )}
        </>
      )}

      {/* ── ÉVALUER DI ── */}
      {activeTab === 'di' && (
        <div className="fade-in">

          {/* Sélecteur échéance */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:8, letterSpacing:'1px', textTransform:'uppercase' }}>Échéance Nexo</div>
            <div className="expiry-chips">
              {expiries.map(ts => (
                <button key={ts} className={`expiry-chip${diExpiry===ts?' active':''}`} onClick={() => { setDiExpiry(ts); setNexoRates({}) }}>
                  {fmtTs(ts)}
                  <span style={{ display:'block', fontSize:9, opacity:.7 }}>{daysUntil(ts).toFixed(1)}j</span>
                </button>
              ))}
            </div>
          </div>

          {/* Info IV ATM */}
          {diExpiry && atmIV && (
            <div style={{ background:'rgba(255,215,0,.06)', border:'1px solid rgba(255,215,0,.2)', borderRadius:8, padding:'10px 14px', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:11, color:'var(--text-dim)' }}>IV ATM actuelle : <strong style={{ color:'var(--atm)' }}>{atmIV.toFixed(1)}%</strong></span>
              <span style={{ fontSize:10, color:'var(--text-muted)' }}>{daysUntil(diExpiry).toFixed(1)} jours</span>
            </div>
          )}

          {/* Instructions */}
          <div style={{ background:'rgba(0,212,255,.05)', border:'1px solid rgba(0,212,255,.1)', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
            💡 Saisis le taux APR proposé par Nexo pour chaque strike qui t'intéresse — l'app te donne un avis instantané.
          </div>

          {/* Liste des strikes avec saisie */}
          {diRows.length > 0 && (
            <div className="card">
              {diRows.map(r => {
                const isATM  = stats?.atmStrike === r.strike
                const accent = isATM ? 'var(--atm)' : r.isBuyLow ? 'var(--call)' : r.isSellHigh ? 'var(--accent2)' : 'var(--text-muted)'
                const type   = isATM ? 'ATM' : r.isBuyLow ? 'Buy Low' : r.isSellHigh ? 'Sell High' : ''
                return (
                  <div key={r.strike} style={{
                    padding:'12px 14px', borderBottom:'1px solid rgba(30,58,95,.4)',
                    borderLeft:`2px solid ${isATM?'var(--atm)':r.isBuyLow?'var(--call)':r.isSellHigh?'var(--accent2)':'transparent'}`,
                    background: isATM ? 'rgba(255,215,0,.02)' : undefined,
                  }}>
                    {/* Strike + type + IV */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14, color:isATM?'var(--atm)':'var(--text)' }}>
                          ${r.strike.toLocaleString()}
                        </span>
                        {type && (
                          <span style={{ fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:20,
                            background:isATM?'rgba(255,215,0,.15)':r.isBuyLow?'rgba(0,229,160,.12)':'rgba(255,107,53,.12)',
                            color:accent, border:`1px solid ${accent}40` }}>{type}</span>
                        )}
                      </div>
                      <div style={{ fontSize:10, color:'var(--text-muted)', textAlign:'right' }}>
                        <div>IV: <span style={{ color:'var(--accent)' }}>{r.iv?.toFixed(1) ?? '—'}%</span></div>
                        {r.distPct != null && (
                          <div style={{ color:Math.abs(r.distPct)<3?'var(--put)':Math.abs(r.distPct)<8?'var(--accent2)':'var(--text-muted)' }}>
                            {r.distPct>0?'+':''}{r.distPct.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Saisie taux Nexo */}
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ flex:1, position:'relative' }}>
                        <input
                          type="number" step="0.01" min="0" placeholder="APR Nexo %"
                          value={nexoRates[r.strike] ?? ''}
                          onChange={e => setNexoRates(prev => ({ ...prev, [r.strike]: parseFloat(e.target.value) || null }))}
                          style={{ width:'100%', background:'var(--surface2)', border:`1px solid ${r.nexoRate ? accent+'60' : 'var(--border)'}`, color:'var(--text)', padding:'8px 36px 8px 12px', borderRadius:8, fontFamily:'var(--mono)', fontSize:12, outline:'none', transition:'border-color .2s' }}
                        />
                        <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:10, color:'var(--text-muted)', pointerEvents:'none' }}>%</span>
                      </div>

                      {/* Avis instantané */}
                      {r.rating && (
                        <div style={{ flexShrink:0, textAlign:'right' }}>
                          <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:12, color:r.rating.color }}>
                            {r.rating.label}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Détail scoring */}
                    {r.scored && r.rating && (
                      <div style={{ marginTop:8, background:'var(--surface2)', borderRadius:6, padding:'8px 10px' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:4 }}>
                          <span style={{ color:'var(--text-muted)' }}>Taux Nexo</span>
                          <span style={{ color:accent, fontWeight:700 }}>{r.nexoRate.toFixed(2)}% /an</span>
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:6 }}>
                          <span style={{ color:'var(--text-muted)' }}>Référence théorique</span>
                          <span style={{ color:'var(--text-dim)' }}>{r.scored.fairRate.toFixed(2)}% /an</span>
                        </div>
                        {/* Barre ratio */}
                        <div style={{ height:5, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden', marginBottom:4 }}>
                          <div style={{ height:'100%', width:`${Math.min(r.scored.ratio,1)*100}%`, background:r.rating.color, borderRadius:3, transition:'width .4s' }} />
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--text-muted)' }}>
                          <span>{r.rating.detail}</span>
                          <span>{(r.scored.ratio*100).toFixed(0)}% du marché théorique</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {diRows.length === 0 && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Charger la chaîne d'abord</h3><p>Va dans l'onglet Chaîne et actualise</p></div>
          )}

          {/* Vue multi-échéances */}
          <div style={{ marginTop:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700 }}>Référence théorique ATM par échéance</span>
              <button className={`icon-btn${multiLoading?' loading':''}`} onClick={loadMulti}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
                Charger
              </button>
            </div>
            {multiData.length > 0 && (
              <div className="card">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 40px 60px 80px', gap:6, padding:'8px 14px', borderBottom:'1px solid var(--border)', fontSize:9, color:'var(--text-muted)', textTransform:'uppercase' }}>
                  <span>Échéance</span>
                  <span style={{ textAlign:'center' }}>Jours</span>
                  <span style={{ textAlign:'right' }}>IV ATM</span>
                  <span style={{ textAlign:'right' }}>Réf. théo.</span>
                </div>
                {multiData.map(r => {
                  const ivColor = r.iv > 80 ? 'var(--call)' : r.iv > 50 ? 'var(--atm)' : r.iv > 30 ? 'var(--accent2)' : 'var(--put)'
                  const maxIV2  = Math.max(...multiData.map(x => x.iv ?? 0))
                  const isPeak  = r.iv === maxIV2
                  return (
                    <div key={r.ts} style={{
                      display:'grid', gridTemplateColumns:'1fr 40px 60px 80px', gap:6,
                      padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)',
                      background: isPeak ? 'rgba(255,215,0,.04)' : undefined,
                      borderLeft: isPeak ? '2px solid var(--atm)' : '2px solid transparent',
                    }}>
                      <div>
                        <div style={{ fontFamily:'var(--sans)', fontWeight:isPeak?800:600, fontSize:12, color:isPeak?'var(--atm)':'var(--text)' }}>
                          {fmtTs(r.ts)}{isPeak&&<span style={{ fontSize:9, marginLeft:4 }}>🔥</span>}
                        </div>
                        <div style={{ fontSize:9, color:'var(--text-muted)' }}>ATM {r.atmStrike?.toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)', alignSelf:'center' }}>{r.days.toFixed(1)}</div>
                      <div style={{ textAlign:'right', alignSelf:'center' }}>
                        <div style={{ fontSize:12, fontWeight:700, color:ivColor }}>{r.iv?.toFixed(1) ?? '—'}%</div>
                      </div>
                      <div style={{ textAlign:'right', alignSelf:'center' }}>
                        <div style={{ fontSize:11, color:'var(--accent2)', fontWeight:700 }}>{r.fairRate?.toFixed(1) ?? '—'}%</div>
                        <div style={{ fontSize:9, color:'var(--text-muted)' }}>/an</div>
                      </div>
                    </div>
                  )
                })}
                <div style={{ padding:'10px 14px', fontSize:10, color:'var(--text-muted)', lineHeight:1.7 }}>
                  Réf. théo. = taux ATM estimé · compare avec ce que Nexo te propose
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
// ── INJECTION OPPORTUNITÉS ──
// Ajoute cet import en haut du fichier via patch
