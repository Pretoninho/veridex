import { useState, useEffect } from 'react'
import { getSpot, getInstruments, getOrderBook, getAllExpiries } from '../utils/api.js'

function fmtTs(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
}

function daysUntil(ts) {
  return Math.max(1, Math.round((ts - Date.now()) / 86400000))
}

function calcDIRate(ivPct, days) {
  if (!ivPct || !days) return null
  const T = days / 365
  const periodPct = ivPct / 100 * Math.sqrt(T) * 0.4 * 100
  return (periodPct * 365 / days)
}

function calcMinRate(ivPct, days) {
  const rate = calcDIRate(ivPct, days)
  return rate ? rate * 0.8 : null
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
    const forExp = inst.filter(i => i.expiration_timestamp === expiryTs)
    const strikes = [...new Set(forExp.map(i => i.strike))].sort((x,y) => x - y)
    const spotNow = sp || spot
    const BATCH = 8
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
      callIV: callIVs.length ? (callIVs.reduce((a,b)=>a+b,0)/callIVs.length).toFixed(1) : '—',
      putIV:  putIVs.length  ? (putIVs.reduce((a,b)=>a+b,0)/putIVs.length).toFixed(1)   : '—',
      atmIV:  atmiv?.toFixed(1) || '—',
      atmStrike: atmRow?.strike,
      contracts: allRows.length,
    })
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

  // Données DI pour l'échéance sélectionnée
  const diDays = diExpiry ? daysUntil(diExpiry) : null

  const diRows = rows.map(r => {
    const iv = r.call?.mark_iv ?? r.put?.mark_iv ?? null
    const marketRate = calcDIRate(iv, diDays)
    const minRate    = calcMinRate(iv, diDays)
    const distPct    = spot ? (r.strike - spot) / spot * 100 : null
    const isBuyLow   = distPct != null && distPct < 0
    const isSellHigh = distPct != null && distPct > 0
    return { strike: r.strike, iv, marketRate, minRate, distPct, isBuyLow, isSellHigh }
  })

  const atmRow     = diRows.find(r => stats?.atmStrike === r.strike)
  const marketRateATM = atmRow?.marketRate
  const minRateATM    = atmRow?.minRate

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

      {/* Tabs */}
      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['chain','Chaîne'],['di','Taux DI']].map(([id,label]) => (
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
          <div className="stat-card">
            <div className="stat-label">IV ATM</div>
            <div className="stat-value gold">{stats.atmIV}%</div>
            {stats.atmStrike && <div className="stat-sub">Strike {stats.atmStrike?.toLocaleString()}</div>}
          </div>
          <div className="stat-card">
            <div className="stat-label">Contrats</div>
            <div className="stat-value blue">{stats.contracts}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">IV moy. Calls</div>
            <div className="stat-value green">{stats.callIV}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">IV moy. Puts</div>
            <div className="stat-value orange">{stats.putIV}%</div>
          </div>
        </div>
      )}

      {/* ── TAB CHAÎNE ── */}
      {activeTab === 'chain' && (
        <>
          <div className="expiry-chips">
            {expiries.slice(0,10).map(ts => (
              <button key={ts} className={`expiry-chip${selExpiry===ts?' active':''}`} onClick={() => switchExpiry(ts)}>
                {fmtTs(ts)}
              </button>
            ))}
          </div>

          {loading && rows.length === 0 && (
            <div className="card"><div style={{ padding:20, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Chargement…</div></div>
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
                      <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14, color: isATM?'var(--atm)':'var(--text)' }}>
                        ${strike.toLocaleString()}
                        {isATM && <span style={{ fontSize:9, marginLeft:5, opacity:.7 }}>ATM</span>}
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

      {/* ── TAB TAUX DI ── */}
      {activeTab === 'di' && (
        <div className="fade-in">

          {/* Sélecteur échéance */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:8, letterSpacing:'1px', textTransform:'uppercase' }}>Échéance</div>
            <div className="expiry-chips">
              {expiries.slice(0,12).map(ts => (
                <button key={ts}
                  className={`expiry-chip${diExpiry===ts?' active':''}`}
                  onClick={() => setDiExpiry(ts)}>
                  {fmtTs(ts)}
                  <span style={{ display:'block', fontSize:9, opacity:.7 }}>{daysUntil(ts)}j</span>
                </button>
              ))}
            </div>
          </div>

          {/* Carte ATM résumé */}
          {diExpiry && atmIV && (
            <div className="card" style={{ marginBottom:12, borderColor:'rgba(255,215,0,.3)', background:'rgba(255,215,0,.03)' }}>
              <div className="card-header" style={{ color:'var(--atm)' }}>
                ⚡ Référence ATM — {fmtTs(diExpiry)} · {diDays}j
              </div>
              <div style={{ padding:'14px 16px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
                <div>
                  <div className="stat-label">IV ATM</div>
                  <div className="stat-value gold">{atmIV.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="stat-label">Taux marché</div>
                  <div className="stat-value green">{marketRateATM?.toFixed(2)}% /an</div>
                  <div className="stat-sub">{(marketRateATM/100*(diDays/365)*100)?.toFixed(3)}% / {diDays}j</div>
                </div>
                <div>
                  <div className="stat-label">Min. Nexo</div>
                  <div className="stat-value orange">{minRateATM?.toFixed(2)}% /an</div>
                  <div className="stat-sub">{(minRateATM/100*(diDays/365)*100)?.toFixed(3)}% / {diDays}j</div>
                </div>
              </div>
            </div>
          )}

          {/* Légende */}
          <div style={{ display:'flex', gap:16, marginBottom:10, fontSize:10, color:'var(--text-muted)', flexWrap:'wrap' }}>
            <span><span style={{ color:'var(--call)' }}>■</span> Buy Low</span>
            <span><span style={{ color:'var(--accent2)' }}>■</span> Sell High</span>
            <span><span style={{ color:'var(--atm)' }}>■</span> ATM</span>
          </div>

          {diRows.length === 0 && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Aucune donnée</h3><p>Chargez d'abord la chaîne d'options</p></div>
          )}

          {diRows.length > 0 && (
            <div className="card">
              {diRows.map(r => {
                const isATM   = stats?.atmStrike === r.strike
                const accent  = isATM ? 'var(--atm)' : r.isBuyLow ? 'var(--call)' : r.isSellHigh ? 'var(--accent2)' : 'var(--text-muted)'
                const type    = isATM ? 'ATM' : r.isBuyLow ? 'Buy Low' : r.isSellHigh ? 'Sell High' : ''
                const periodMkt = r.marketRate ? (r.marketRate/100*(diDays/365)*100) : null
                const periodMin = r.minRate    ? (r.minRate/100*(diDays/365)*100)    : null

                return (
                  <div key={r.strike} style={{
                    padding:'11px 14px',
                    borderBottom:'1px solid rgba(30,58,95,.4)',
                    borderLeft:`2px solid ${isATM?'var(--atm)':r.isBuyLow?'var(--call)':r.isSellHigh?'var(--accent2)':'transparent'}`,
                    background: isATM ? 'rgba(255,215,0,.03)' : undefined,
                  }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14, color:isATM?'var(--atm)':'var(--text)' }}>
                          ${r.strike.toLocaleString()}
                        </span>
                        {type && (
                          <span style={{
                            fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:20,
                            background: isATM?'rgba(255,215,0,.15)':r.isBuyLow?'rgba(0,229,160,.12)':'rgba(255,107,53,.12)',
                            color:accent, border:`1px solid ${accent}40`
                          }}>{type}</span>
                        )}
                      </div>
                      <span style={{ fontSize:10, color:'var(--text-muted)' }}>
                        IV: <span style={{ color:'var(--accent)' }}>{r.iv?.toFixed(1) ?? '—'}%</span>
                        {r.distPct != null && (
                          <span style={{ marginLeft:8, color:Math.abs(r.distPct)<3?'var(--put)':Math.abs(r.distPct)<8?'var(--accent2)':'var(--text-muted)' }}>
                            {r.distPct>0?'+':''}{r.distPct.toFixed(1)}%
                          </span>
                        )}
                      </span>
                    </div>

                    {r.marketRate ? (
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, fontSize:11 }}>
                        <div>
                          <div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>TAUX MARCHÉ</div>
                          <div style={{ color:'var(--call)', fontWeight:700 }}>{r.marketRate.toFixed(2)}% /an</div>
                          <div style={{ color:'var(--text-muted)', fontSize:9 }}>{periodMkt?.toFixed(3)}% / {diDays}j</div>
                        </div>
                        <div>
                          <div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>MIN. NEXO</div>
                          <div style={{ color:'var(--accent2)', fontWeight:700 }}>{r.minRate?.toFixed(2)}% /an</div>
                          <div style={{ color:'var(--text-muted)', fontSize:9 }}>{periodMin?.toFixed(3)}% / {diDays}j</div>
                        </div>
                        <div>
                          <div style={{ color:'var(--text-muted)', fontSize:9, marginBottom:2 }}>QUALITÉ IV</div>
                          <div style={{ fontSize:10 }}>
                            {r.iv > 80 ? <span style={{ color:'var(--call)', fontWeight:700 }}>🔥 Élevée</span>
                            : r.iv > 50 ? <span style={{ color:'var(--atm)', fontWeight:700 }}>✓ Bonne</span>
                            : r.iv > 30 ? <span style={{ color:'var(--accent2)' }}>~ Normale</span>
                            : <span style={{ color:'var(--put)' }}>↓ Faible</span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>Données IV indisponibles</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
