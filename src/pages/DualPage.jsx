import { useState, useEffect, useCallback } from 'react'
import { getATMIV, getSpot } from '../utils/api.js'
import { calcPremium, marketPremiumPct, diScore, scoreLabel, calcPnL, countdown, fmtUSD, fmtStrike, fmtExpiry } from '../utils/di.js'

const SCORE_COLORS = { great: 'var(--call)', good: 'var(--atm)', fair: 'var(--accent2)', poor: 'var(--put)' }

function defaultExpiry() {
  const d = new Date(); d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

function emptyForm() {
  return { asset: 'BTC', type: 'sell-high', strike: '', expiry: defaultExpiry(), rate: '', days: '7', amount: '' }
}

export default function DualPage() {
  const [offers, setOffers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('di_offers') || '[]') } catch { return [] }
  })
  const [ivCache, setIvCache] = useState({})
  const [spots, setSpots] = useState({})
  const [dcaBTC, setDcaBTC] = useState(() => localStorage.getItem('di_dca_BTC') || '')
  const [dcaETH, setDcaETH] = useState(() => localStorage.getItem('di_dca_ETH') || '')
  const [form, setForm] = useState(emptyForm())
  const [editId, setEditId] = useState(null) // ID du contrat en cours d'édition
  const [loading, setLoading] = useState(false)
  const [spotLoading, setSpotLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('add')

  useEffect(() => { localStorage.setItem('di_offers', JSON.stringify(offers)) }, [offers])
  useEffect(() => { localStorage.setItem('di_dca_BTC', dcaBTC) }, [dcaBTC])
  useEffect(() => { localStorage.setItem('di_dca_ETH', dcaETH) }, [dcaETH])

  const getDCA = (asset) => {
    if (asset === 'BTC') return parseFloat(dcaBTC) || null
    if (asset === 'ETH') return parseFloat(dcaETH) || null
    return null
  }
  const dcaForForm = getDCA(form.asset)

  useEffect(() => {
    const assets = [...new Set(offers.map(o => o.asset))]
    assets.forEach(a => {
      const cached = ivCache[a]
      if (!cached || Date.now() - cached.fetchedAt > 300000) fetchIV(a)
    })
  }, [offers.length])

  const fetchIV = useCallback(async (asset) => {
    try {
      const data = await getATMIV(asset)
      setIvCache(prev => {
        const next = { ...prev, [asset]: { ...data, fetchedAt: Date.now() } }
        setOffers(ofs => ofs.map(o => o.asset === asset ? { ...o, deribitIV: data.iv } : o))
        return next
      })
    } catch(e) { console.warn('IV fetch error:', e.message) }
  }, [])

  const fetchAllIV = async () => {
    setLoading(true)
    const assets = [...new Set(offers.map(o => o.asset))]
    if (!assets.length) { setLoading(false); return }
    for (const a of assets) await fetchIV(a)
    setLoading(false)
  }

  const refreshSpots = async () => {
    setSpotLoading(true)
    const assets = [...new Set(offers.map(o => o.asset))]
    const results = await Promise.all(assets.map(async a => {
      const s = await getSpot(a).catch(() => null)
      return [a, s]
    }))
    setSpots(Object.fromEntries(results.filter(([, s]) => s)))
    setSpotLoading(false)
  }

  const startEdit = (offer) => {
    setEditId(offer.id)
    setForm({
      asset:  offer.asset,
      type:   offer.type,
      strike: String(offer.strike),
      expiry: offer.expiry,
      rate:   String(offer.rate),
      days:   String(offer.days),
      amount: String(offer.amount),
    })
    setActiveTab('add')
    setError(null)
    window.scrollTo(0, 0)
  }

  const cancelEdit = () => {
    setEditId(null)
    setForm(emptyForm())
    setError(null)
  }

  const saveOffer = () => {
    const { asset, type, strike, expiry, rate, days, amount } = form
    if (!strike || !expiry || !rate || !days) { setError('Remplissez tous les champs obligatoires'); return }
    const iv = ivCache[asset]?.iv ?? null
    const updated = {
      id: editId || Date.now(),
      asset, type,
      strike: parseFloat(strike), expiry,
      rate: parseFloat(rate), days: parseInt(days),
      amount: parseFloat(amount) || 0,
      deribitIV: iv,
    }
    if (editId) {
      setOffers(prev => prev.map(o => o.id === editId ? updated : o))
      setEditId(null)
    } else {
      setOffers(prev => [updated, ...prev])
    }
    setForm(emptyForm())
    setError(null)
    setActiveTab('positions')
  }

  const deleteOffer = id => setOffers(prev => prev.filter(o => o.id !== id))
  const clearAll = () => { if (offers.length && confirm('Effacer toutes les offres ?')) setOffers([]) }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Dual <span>Investment</span></div>
        <button className={`icon-btn${loading ? ' loading' : ''}`} onClick={fetchAllIV}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          IV
        </button>
      </div>

      {/* DCA par actif */}
      <div className="card" style={{ marginBottom:12 }}>
        <div className="card-header">Mon DCA</div>
        <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div className="di-field">
            <label className="di-label" style={{ color:'#f7931a' }}>₿ BTC</label>
            <input className="di-input" type="number" placeholder="Ex: 73200" value={dcaBTC} onChange={e => setDcaBTC(e.target.value)} />
            {dcaBTC && <span style={{ fontSize:10, color:'var(--atm)', marginTop:3 }}>{fmtUSD(parseFloat(dcaBTC))}</span>}
          </div>
          <div className="di-field">
            <label className="di-label" style={{ color:'#627eea' }}>Ξ ETH</label>
            <input className="di-input" type="number" placeholder="Ex: 2800" value={dcaETH} onChange={e => setDcaETH(e.target.value)} />
            {dcaETH && <span style={{ fontSize:10, color:'var(--atm)', marginTop:3 }}>{fmtUSD(parseFloat(dcaETH))}</span>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['add', editId ? '✏️ Modifier' : '+ Ajouter'],['positions','Contrats'],['analysis','P&L']].map(([id, label]) => (
          <button key={id}
            style={{ flex:1, padding:'8px 4px', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
              color: activeTab===id ? (editId && id==='add' ? 'var(--atm)' : 'var(--accent)') : 'var(--text-muted)',
              borderBottom: activeTab===id ? `2px solid ${editId && id==='add' ? 'var(--atm)' : 'var(--accent)'}` : '2px solid transparent',
              transition:'all .2s' }}
            onClick={() => { setActiveTab(id); if (id==='analysis') refreshSpots() }}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="error-box">⚠ {error}</div>}

      {/* ── ADD / EDIT ── */}
      {activeTab === 'add' && (
        <div className="card fade-in">
          <div className="card-header">
            <span>{editId ? 'Modifier le contrat' : 'Nouveau contrat'}</span>
            {editId && (
              <button className="icon-btn" style={{ fontSize:10, padding:'3px 10px', color:'var(--text-muted)', borderColor:'var(--border)' }} onClick={cancelEdit}>
                Annuler
              </button>
            )}
          </div>
          <div style={{ padding:'16px', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="di-field">
                <label className="di-label">Actif</label>
                <select className="di-input di-select" value={form.asset} onChange={e => setForm(f => ({ ...f, asset: e.target.value }))}>
                  <option value="BTC">₿ BTC</option>
                  <option value="ETH">Ξ ETH</option>
                </select>
              </div>
              <div className="di-field">
                <label className="di-label">Type</label>
                <select className="di-input di-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="sell-high">Sell High</option>
                  <option value="buy-low">Buy Low</option>
                </select>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="di-field">
                <label className="di-label">Strike ($)</label>
                <input className="di-input" type="number" placeholder="Ex: 85000" value={form.strike} onChange={e => setForm(f => ({ ...f, strike: e.target.value }))} />
              </div>
              <div className="di-field">
                <label className="di-label">Durée (jours)</label>
                <input className="di-input" type="number" min="1" placeholder="7" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} />
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="di-field">
                <label className="di-label">Taux APY (%)</label>
                <input className="di-input" type="number" step="0.01" placeholder="Ex: 2.5" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
              <div className="di-field">
                <label className="di-label">Montant ($)</label>
                <input className="di-input" type="number" placeholder="Ex: 1000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>
            <div className="di-field">
              <label className="di-label">Date d'expiry</label>
              <input className="di-input" type="date" value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} />
            </div>

            {ivCache[form.asset] && (
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', fontSize:11, color:'var(--text-dim)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>IV ATM {form.asset}: <strong style={{ color:'var(--accent)' }}>{ivCache[form.asset].iv.toFixed(2)}%</strong></span>
                {form.rate && form.days && (() => {
                  const ratio = diScore(parseFloat(form.rate), ivCache[form.asset].iv, parseInt(form.days))
                  const { label, cls } = scoreLabel(ratio)
                  return ratio != null ? <span style={{ color:SCORE_COLORS[cls], fontWeight:700 }}>{label} ({(ratio*100).toFixed(0)}%)</span> : null
                })()}
              </div>
            )}

            {dcaForForm && form.strike && form.type === 'sell-high' && (
              <div style={{ background: parseFloat(form.strike) > dcaForForm ? 'rgba(0,229,160,.08)' : 'rgba(255,77,109,.08)', borderRadius:8, padding:'8px 12px', fontSize:11 }}>
                {parseFloat(form.strike) > dcaForForm
                  ? <span style={{ color:'var(--call)' }}>✓ Strike {fmtUSD(parseFloat(form.strike))} &gt; DCA {fmtUSD(dcaForForm)} — plus-value garantie si exercé</span>
                  : <span style={{ color:'var(--put)' }}>⚠ Strike sous le DCA — vente à perte si exercé</span>}
              </div>
            )}
            {dcaForForm && form.strike && form.type === 'buy-low' && (
              <div style={{ background: parseFloat(form.strike) < dcaForForm ? 'rgba(0,229,160,.08)' : 'rgba(255,77,109,.08)', borderRadius:8, padding:'8px 12px', fontSize:11 }}>
                {parseFloat(form.strike) < dcaForForm
                  ? <span style={{ color:'var(--call)' }}>✓ Strike {fmtUSD(parseFloat(form.strike))} &lt; DCA {fmtUSD(dcaForForm)} — achat sous ta moyenne</span>
                  : <span style={{ color:'var(--put)' }}>⚠ Strike au-dessus du DCA — achat plus cher que ta moyenne</span>}
              </div>
            )}

            <button className="di-add-btn" style={{ background: editId ? 'linear-gradient(135deg, var(--atm), #ff9500)' : undefined }} onClick={saveOffer}>
              {editId ? 'Enregistrer les modifications' : 'Ajouter le contrat'}
            </button>
          </div>
        </div>
      )}

      {/* ── CONTRATS ── */}
      {activeTab === 'positions' && (
        <div className="fade-in">
          {offers.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Aucun contrat</h3><p>Ajoutez vos contrats dans + Ajouter</p></div>
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-card"><div className="stat-label">Contrats</div><div className="stat-value blue">{offers.length}</div></div>
                <div className="stat-card"><div className="stat-label">APY moyen</div><div className="stat-value orange">{(offers.reduce((a,o)=>a+o.rate,0)/offers.length).toFixed(2)}%</div></div>
                <div className="stat-card"><div className="stat-label">Prime totale</div><div className="stat-value green">{(() => { const t=offers.reduce((s,o)=>s+(calcPremium(o.rate,o.days,o.amount)||0),0); return t>0?'+'+fmtUSD(t):'—' })()}</div></div>
                <div className="stat-card"><div className="stat-label">IV moy.</div><div className="stat-value">{(() => { const ivs=offers.map(o=>o.deribitIV).filter(v=>v!=null); return ivs.length?(ivs.reduce((a,b)=>a+b,0)/ivs.length).toFixed(2)+'%':'—' })()}</div></div>
              </div>

              {['BTC','ETH','USDC'].map(asset => {
                const assetOffers = offers.filter(o => o.asset === asset)
                if (!assetOffers.length) return null
                const dca = getDCA(asset)
                return (
                  <div key={asset}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, marginTop:4 }}>
                      <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:13, color:asset==='BTC'?'#f7931a':asset==='ETH'?'#627eea':'var(--accent)' }}>
                        {asset==='BTC'?'₿':asset==='ETH'?'Ξ':'$'} {asset}
                      </span>
                      {dca && <span style={{ fontSize:10, color:'var(--text-muted)' }}>DCA {fmtUSD(dca)}</span>}
                      <span style={{ fontSize:10, color:'var(--text-muted)' }}>· {assetOffers.length} contrat{assetOffers.length>1?'s':''}</span>
                    </div>
                    {assetOffers.map(o => {
                      const prime  = calcPremium(o.rate, o.days, o.amount)
                      const mktPct = marketPremiumPct(o.deribitIV, o.days)
                      const ratio  = diScore(o.rate, o.deribitIV, o.days)
                      const { label, cls } = scoreLabel(ratio)
                      const nexoPct = o.rate/100*(o.days/365)*100
                      const margin  = mktPct ? Math.max(0,(mktPct-nexoPct)/mktPct*100) : null
                      return (
                        <div key={o.id} className="card fade-in" style={{ marginBottom:8 }}>
                          <div className="card-header">
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <span className={`di-badge ${o.type}`}>{o.type==='buy-low'?'Buy Low':'Sell High'}</span>
                              <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14 }}>{fmtStrike(o.strike)}</span>
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:10, color:'var(--text-muted)' }}>⏳ {countdown(o.expiry)}</span>
                              {/* Bouton éditer */}
                              <button onClick={() => startEdit(o)} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-muted)', cursor:'pointer', fontSize:11, padding:'2px 8px', borderRadius:6, transition:'all .2s' }}
                                onMouseEnter={e => e.target.style.color='var(--atm)'}
                                onMouseLeave={e => e.target.style.color='var(--text-muted)'}>
                                ✏️
                              </button>
                              <button className="di-del" onClick={() => deleteOffer(o.id)}>✕</button>
                            </div>
                          </div>
                          <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                            <div><div className="stat-label">Expiry</div><div style={{ fontSize:12, color:'var(--accent)', fontWeight:700 }}>{fmtExpiry(o.expiry)}</div></div>
                            <div><div className="stat-label">APY / Prime</div><div style={{ color:'var(--accent2)', fontWeight:700 }}>{o.rate.toFixed(2)}%</div><div style={{ fontSize:10, color:'var(--call)' }}>{prime?'+'+fmtUSD(prime):'—'}</div></div>
                            <div><div className="stat-label">IV Deribit</div><div style={{ color:o.deribitIV?'var(--accent)':'var(--text-muted)' }}>{o.deribitIV?o.deribitIV.toFixed(2)+'%':'...'}</div></div>
                            <div><div className="stat-label">Marché</div><div style={{ color:'var(--text-dim)', fontSize:11 }}>{mktPct?mktPct.toFixed(3)+'%':'—'}</div></div>
                            {ratio!=null && (
                              <div style={{ gridColumn:'span 2' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                  <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:13, color:SCORE_COLORS[cls] }}>{label}</span>
                                  <div style={{ flex:1, height:5, background:'rgba(255,255,255,.06)', borderRadius:3, overflow:'hidden' }}>
                                    <div style={{ height:'100%', width:`${Math.min(ratio,1)*100}%`, background:SCORE_COLORS[cls], borderRadius:3 }} />
                                  </div>
                                  <span style={{ fontSize:10, color:'var(--text-muted)' }}>{(ratio*100).toFixed(0)}%</span>
                                </div>
                                {margin!=null && <div style={{ fontSize:10, color:margin>40?'var(--put)':'var(--text-muted)', marginTop:3 }}>Marge: {margin.toFixed(1)}% sous marché</div>}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              <button className="icon-btn" style={{ width:'100%', justifyContent:'center', borderColor:'rgba(255,77,109,.3)', color:'var(--put)', marginTop:4 }} onClick={clearAll}>Effacer tout</button>
            </>
          )}
        </div>
      )}

      {/* ── P&L ── */}
      {activeTab === 'analysis' && (
        <div className="fade-in">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{Object.entries(spots).map(([a,p])=>`${a}: ${fmtUSD(p)}`).join(' | ')||'Appuyez Spot'}</span>
            <button className={`icon-btn${spotLoading?' loading':''}`} onClick={refreshSpots}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
              Spot
            </button>
          </div>

          {offers.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Aucun contrat</h3></div>
          ) : (
            ['BTC','ETH','USDC'].map(asset => {
              const assetOffers = offers.filter(o => o.asset === asset)
              if (!assetOffers.length) return null
              const dca = getDCA(asset)
              return (
                <div key={asset}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, marginTop:4 }}>
                    <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:13, color:asset==='BTC'?'#f7931a':asset==='ETH'?'#627eea':'var(--accent)' }}>
                      {asset==='BTC'?'₿':asset==='ETH'?'Ξ':'$'} {asset}
                    </span>
                    {dca && <span style={{ fontSize:10, color:'var(--atm)' }}>DCA {fmtUSD(dca)}</span>}
                  </div>
                  {assetOffers.map(o => {
                    const spot    = spots[o.asset] ?? null
                    const pnlData = calcPnL(o, spot, dca)
                    const cd      = countdown(o.expiry)
                    const distPct = pnlData?.distPct
                    const isNear  = distPct != null && Math.abs(distPct) < 3
                    return (
                      <div key={o.id} className="card fade-in" style={{ marginBottom:8, ...(isNear?{borderColor:'rgba(255,77,109,.4)'}:{}) }}>
                        <div className="card-header">
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span className={`di-badge ${o.type}`}>{o.type==='buy-low'?'Buy Low':'Sell High'}</span>
                            <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14 }}>{fmtStrike(o.strike)}</span>
                            {isNear && <span style={{ fontSize:9, background:'rgba(255,77,109,.2)', color:'var(--put)', padding:'1px 5px', borderRadius:3, fontWeight:800 }}>! PROCHE</span>}
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ fontSize:10, color:'var(--text-muted)' }}>⏳ {cd}</span>
                            <button onClick={() => startEdit(o)} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-muted)', cursor:'pointer', fontSize:11, padding:'2px 8px', borderRadius:6 }}>✏️</button>
                          </div>
                        </div>
                        <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                          <div>
                            <div className="stat-label">Distance strike</div>
                            {distPct != null
                              ? <div style={{ fontWeight:700, color:Math.abs(distPct)<2?'var(--put)':Math.abs(distPct)<8?'var(--accent2)':'var(--call)' }}>
                                  {distPct > 0 ? '▲' : '▼'} {Math.abs(distPct).toFixed(2)}%
                                </div>
                              : <div style={{ color:'var(--text-muted)' }}>—</div>}
                          </div>
                          <div>
                            <div className="stat-label">Statut</div>
                            {pnlData?.willBeExercised != null
                              ? <div style={{ fontSize:12, fontWeight:700, color:pnlData.willBeExercised?'var(--put)':'var(--call)' }}>
                                  {pnlData.willBeExercised ? '⚡ Sera exercé' : '✓ Non exercé'}
                                </div>
                              : <div style={{ color:'var(--text-muted)' }}>—</div>}
                          </div>
                          <div><div className="stat-label">Prime</div><div style={{ color:'var(--call)' }}>{pnlData?'+'+fmtUSD(pnlData.prime):'—'}</div></div>
                          <div>
                            <div className="stat-label">Réf. DCA</div>
                            <div style={{ color:'var(--atm)', fontSize:12 }}>{dca ? fmtUSD(dca) : <span style={{ color:'var(--text-muted)' }}>Non défini</span>}</div>
                          </div>
                        </div>

                        {pnlData?.pnlIfExercised != null && (
                          <div style={{ margin:'0 16px 12px', background:'var(--surface2)', borderRadius:8, padding:'12px' }}>
                            <div className="stat-label" style={{ marginBottom:8 }}>
                              PnL si exercé {dca ? `vs DCA ${fmtUSD(dca)}` : 'vs spot'}
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                              <span style={{ color:pnlData.pnlIfExercised>=0?'var(--call)':'var(--put)', fontFamily:'var(--sans)', fontWeight:800, fontSize:16 }}>
                                {pnlData.pnlIfExercised>=0?'+':''}{fmtUSD(pnlData.pnlIfExercised)}
                              </span>
                              <span style={{ color:pnlData.pnlPctIfExercised>=0?'var(--call)':'var(--put)', fontSize:12 }}>
                                {pnlData.pnlPctIfExercised>=0?'+':''}{pnlData.pnlPctIfExercised?.toFixed(2)}%
                              </span>
                            </div>
                            {o.type === 'sell-high' && dca && (
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                ({fmtUSD(o.strike)} − {fmtUSD(dca)}) × {pnlData.btcAmount?.toFixed(6)} {o.asset} + prime
                              </div>
                            )}
                            {o.type === 'buy-low' && dca && (
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                ({fmtUSD(dca)} − {fmtUSD(o.strike)}) × {pnlData.btcIfExercised?.toFixed(6)} {o.asset} + prime
                              </div>
                            )}
                          </div>
                        )}

                        {pnlData?.scenarios?.length > 0 && (
                          <div style={{ margin:'0 16px 12px' }}>
                            <div className="stat-label" style={{ marginBottom:8 }}>
                              {o.type === 'sell-high' ? 'Manque à gagner si prix monte après expiry' : 'Manque à gagner si prix chute après expiry'}
                            </div>
                            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                              {pnlData.scenarios.map(s => (
                                <div key={s.label} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'6px 10px', background:'rgba(255,255,255,.03)', borderRadius:6 }}>
                                  <span style={{ color:'var(--text-muted)' }}>{s.label} ({fmtUSD(s.price)})</span>
                                  <span style={{ color:'var(--accent2)', fontWeight:700 }}>−{fmtUSD(s.manque)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      )}

      <style>{`
        .di-input{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:8px;font-family:var(--mono);font-size:12px;outline:none;transition:border-color .2s;width:100%}
        .di-input:focus{border-color:var(--accent)}
        .di-select{appearance:none;cursor:pointer}
        .di-label{font-size:10px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;display:block}
        .di-field{display:flex;flex-direction:column}
        .di-add-btn{width:100%;padding:12px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),#0080ff);color:#000;font-family:var(--sans);font-weight:800;font-size:14px;cursor:pointer}
        .di-add-btn:active{opacity:.85;transform:scale(.98)}
        .di-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700}
        .di-badge.buy-low{background:rgba(0,229,160,.12);color:var(--call);border:1px solid rgba(0,229,160,.25)}
        .di-badge.sell-high{background:rgba(255,107,53,.12);color:var(--accent2);border:1px solid rgba(255,107,53,.25)}
        .di-del{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px}
        .di-del:hover{color:var(--put)}
      `}</style>
    </div>
  )
}
