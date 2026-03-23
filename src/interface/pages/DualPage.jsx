import { useState, useEffect, useCallback, useMemo } from 'react'
import { getATMIV, getSpot } from '../../utils/api.js'
import { calcPremiumNative, calcPremiumUSD, marketPremiumPct, diScore, scoreLabel, calcPnL, calcDays, countdown, fmtUSD, fmtStrike, fmtExpiry, fmtDuration } from '../../utils/di.js'
import { calcOptionGreeks } from '../../utils/greeks.js'
import { evaluateDualPolicy } from '../../utils/rlDual.js'

const SCORE_COLORS = { great: 'var(--call)', good: 'var(--atm)', fair: 'var(--accent2)', poor: 'var(--put)' }

function defaultSubscribe() {
  return new Date().toISOString().slice(0, 16)
}
function nextWeekFridayIso(fromDate) {
  const d = new Date(fromDate || Date.now())
  const dow = d.getUTCDay()
  const daysToThisFriday = (5 - dow + 7) % 7
  const daysToNextFriday = daysToThisFriday + 7
  d.setUTCDate(d.getUTCDate() + daysToNextFriday)
  d.setUTCHours(8, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}
function defaultSettlement(subscribeDate) {
  return nextWeekFridayIso(subscribeDate ? new Date(subscribeDate) : new Date())
}
function emptyForm() {
  const subscribeDate = defaultSubscribe()
  return { asset: 'BTC', type: 'sell-high', strike: '', subscribeDate, settlementDate: defaultSettlement(subscribeDate), rate: '', quantity: '' }
}

function computeDualDelta({ side, spot, strike, days, iv }) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(days) || !Number.isFinite(iv) || days <= 0 || iv <= 0) return null
  const greeks = calcOptionGreeks({
    type: side === 'sell-high' ? 'call' : 'put',
    S: spot,
    K: strike,
    T: days / 365,
    sigma: iv / 100,
    r: 0,
  })
  return greeks?.delta ?? null
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
  const [editId, setEditId] = useState(null)
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

  // Durée précise en jours décimaux
  const formDays = calcDays(form.subscribeDate, form.settlementDate)

  // Montant USD
  const getAmountUSD = (type, asset, quantity, dca, spotPrice) => {
    const qty = parseFloat(quantity) || 0
    if (!qty) return null
    if (type === 'sell-high') {
      const ref = dca || spotPrice
      return ref ? qty * ref : null
    }
    return qty // USDC direct
  }
  const amountUSD = getAmountUSD(form.type, form.asset, form.quantity, dcaForForm, spots[form.asset])
  const formSpot = spots[form.asset] ?? null

  // Prime prévisualisée
  const previewPrimeNative = formDays && form.rate && form.quantity
    ? calcPremiumNative(parseFloat(form.rate), formDays, parseFloat(form.quantity))
    : null
  const previewPrimeUSD = formDays && form.rate && amountUSD
    ? calcPremiumNative(parseFloat(form.rate), formDays, parseFloat(form.quantity)) * parseFloat(form.strike)
    : null

  const liveRlEval = useMemo(() => {
    const strike = parseFloat(form.strike)
    const apr = parseFloat(form.rate)
    const expiryTs = form.settlementDate ? new Date(form.settlementDate).getTime() : null
    const dca = dcaForForm
    const distPct = formSpot && Number.isFinite(strike) && strike > 0
      ? ((strike - formSpot) / formSpot) * 100
      : null
    const iv = ivCache[form.asset]?.iv ?? null
    const delta = computeDualDelta({ side: form.type, spot: formSpot, strike, days: formDays, iv })
    const plusValueLocked = Number.isFinite(strike) && Number.isFinite(dca)
      ? (form.type === 'sell-high' ? strike >= dca : strike <= dca)
      : null
    const dcaGapPct = Number.isFinite(strike) && Number.isFinite(dca) && dca > 0
      ? ((strike - dca) / dca) * 100
      : null

    return evaluateDualPolicy({
      asset: form.asset,
      side: form.type,
      strike,
      dca,
      delta,
      plusValueLocked,
      dcaGapPct,
      days: formDays,
      expiryTs,
      apr,
      distPct,
      iv,
    })
  }, [dcaForForm, form.asset, form.type, form.strike, form.rate, formDays, formSpot, form.settlementDate, ivCache])

  const offerRlMap = useMemo(() => {
    const entries = offers.map((offer) => {
      const settleTs = offer.settlementDate ? new Date(offer.settlementDate).getTime() : null
      const days = offer.days || calcDays(offer.subscribeDate, offer.settlementDate)
      const spotNow = spots[offer.asset] ?? null
      const distPct = spotNow && Number.isFinite(offer.strike) && offer.strike > 0
        ? ((offer.strike - spotNow) / spotNow) * 100
        : null
      const dca = getDCA(offer.asset)
      const delta = computeDualDelta({ side: offer.type, spot: spotNow, strike: offer.strike, days, iv: offer.deribitIV ?? null })
      const plusValueLocked = Number.isFinite(offer.strike) && Number.isFinite(dca)
        ? (offer.type === 'sell-high' ? offer.strike >= dca : offer.strike <= dca)
        : null
      const dcaGapPct = Number.isFinite(offer.strike) && Number.isFinite(dca) && dca > 0
        ? ((offer.strike - dca) / dca) * 100
        : null
      const rl = evaluateDualPolicy({
        asset: offer.asset,
        side: offer.type,
        strike: offer.strike,
        dca,
        delta,
        plusValueLocked,
        dcaGapPct,
        days,
        expiryTs: settleTs,
        apr: offer.rate,
        distPct,
        iv: offer.deribitIV ?? null,
      })
      return [offer.id, rl]
    })
    return Object.fromEntries(entries)
  }, [offers, spots])

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

  const fetchSpot = useCallback(async (asset) => {
    try {
      const spot = await getSpot(asset)
      setSpots(prev => ({ ...prev, [asset]: spot }))
    } catch(e) { console.warn('Spot fetch error:', e.message) }
  }, [])

  useEffect(() => {
    const cached = ivCache[form.asset]
    if (!cached || Date.now() - cached.fetchedAt > 300000) fetchIV(form.asset)
  }, [fetchIV, form.asset, ivCache])

  useEffect(() => {
    if (!spots[form.asset]) fetchSpot(form.asset)
  }, [fetchSpot, form.asset, spots])

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
      asset:          offer.asset,
      type:           offer.type,
      strike:         String(offer.strike),
      subscribeDate:  offer.subscribeDate || defaultSubscribe(),
      settlementDate: offer.settlementDate || defaultSettlement(),
      rate:           String(offer.rate),
      quantity:       String(offer.quantity || ''),
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
    const { asset, type, strike, subscribeDate, settlementDate, rate, quantity } = form
    if (!strike || !subscribeDate || !settlementDate || !rate || !quantity) {
      setError('Remplissez tous les champs obligatoires'); return
    }
    const dca       = getDCA(asset)
    const spotPrice = spots[asset]
    const days      = calcDays(subscribeDate, settlementDate)
    const usdAmount = getAmountUSD(type, asset, quantity, dca, spotPrice)
    const iv        = ivCache[asset]?.iv ?? null

    const updated = {
      id:             editId || Date.now(),
      asset, type,
      strike:         parseFloat(strike),
      subscribeDate,
      settlementDate,
      days,
      rate:           parseFloat(rate),
      quantity:       parseFloat(quantity),
      amount:         usdAmount || 0,
      deribitIV:      iv,
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

      {/* DCA */}
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
            {editId && <button className="icon-btn" style={{ fontSize:10, padding:'3px 10px' }} onClick={cancelEdit}>Annuler</button>}
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

            {/* Dates avec heures */}
            <div className="di-field">
              <label className="di-label">Date de souscription</label>
              <input className="di-input" type="datetime-local" value={form.subscribeDate}
                onChange={e => setForm(f => ({ ...f, subscribeDate: e.target.value }))} />
            </div>
            <div className="di-field">
              <label className="di-label">Date de règlement (Settlement)</label>
              <input className="di-input" type="datetime-local" value={form.settlementDate}
                onChange={e => setForm(f => ({ ...f, settlementDate: e.target.value }))} />
              {formDays && (
                <span style={{ fontSize:10, color:'var(--accent)', marginTop:3 }}>
                  Durée précise : {fmtDuration(formDays)} ({formDays.toFixed(2)} jours)
                </span>
              )}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div className="di-field">
                <label className="di-label">Strike ($)</label>
                <input className="di-input" type="number" placeholder="Ex: 85000" value={form.strike}
                  onChange={e => setForm(f => ({ ...f, strike: e.target.value }))} />
              </div>
              <div className="di-field">
                <label className="di-label">Taux APY (%)</label>
                <input className="di-input" type="number" step="0.01" placeholder="Ex: 12.69" value={form.rate}
                  onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
              </div>
            </div>

            <div className="di-field">
              <label className="di-label" style={{ color: form.type==='sell-high' ? (form.asset==='BTC'?'#f7931a':'#627eea') : 'var(--accent)' }}>
                {form.type === 'sell-high' ? `Quantité ${form.asset}` : 'Montant USDC'}
              </label>
              <input className="di-input" type="number"
                step={form.type === 'sell-high' ? '0.001' : '1'}
                placeholder={form.type === 'sell-high' ? (form.asset==='BTC'?'Ex: 0.01':'Ex: 0.4') : 'Ex: 1000'}
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              {amountUSD && (
                <span style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>
                  ≈ {fmtUSD(amountUSD)} {form.type==='sell-high' && dcaForForm ? <span style={{ color:'var(--atm)' }}>(DCA)</span> : ''}
                </span>
              )}
            </div>

            {/* Preview prime */}
            {previewPrimeNative != null && previewPrimeUSD != null && (
              <div style={{ background:'rgba(0,229,160,.06)', border:'1px solid rgba(0,229,160,.2)', borderRadius:8, padding:'10px 14px' }}>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:6, letterSpacing:'1px', textTransform:'uppercase' }}>Prime estimée</div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'var(--call)', fontFamily:'var(--sans)', fontWeight:800, fontSize:15 }}>
                    +{previewPrimeNative.toFixed(form.type==='sell-high'?(form.asset==='BTC'?6:5):2)} {form.type==='sell-high'?form.asset:'USDC'}
                  </span>
                  <span style={{ color:'var(--call)', fontSize:12 }}>≈ {fmtUSD(previewPrimeUSD)}</span>
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                  {form.quantity} {form.type==='sell-high'?form.asset:'USDC'} × {form.rate}% × {formDays?.toFixed(2)}j / 365
                </div>
              </div>
            )}

            {/* IV + scoring */}
            {ivCache[form.asset] && formDays && (
              <div style={{ background:'var(--surface2)', borderRadius:8, padding:'10px 12px', fontSize:11, color:'var(--text-dim)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>IV ATM {form.asset}: <strong style={{ color:'var(--accent)' }}>{ivCache[form.asset].iv.toFixed(2)}%</strong></span>
                {form.rate && (() => {
                  const ratio = diScore(parseFloat(form.rate), ivCache[form.asset].iv, formDays)
                  const { label, cls } = scoreLabel(ratio)
                  return ratio != null ? <span style={{ color:SCORE_COLORS[cls], fontWeight:700 }}>{label} ({(ratio*100).toFixed(0)}%)</span> : null
                })()}
              </div>
            )}

            {(formDays || form.rate || form.strike) && (
              <div style={{ background:'rgba(0,212,255,.06)', border:'1px solid rgba(0,212,255,.18)', borderRadius:8, padding:'10px 12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
                  <div style={{ fontSize:10, color:'var(--text-muted)', letterSpacing:'1px', textTransform:'uppercase' }}>Diagnostic RL</div>
                  <div style={{ color:liveRlEval.action==='subscribe' ? 'var(--call)' : 'var(--put)', fontFamily:'var(--sans)', fontWeight:800, fontSize:13 }}>
                    {liveRlEval.action==='subscribe' ? 'GO' : 'WAIT'}
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:11 }}>
                  <div style={{ color:'var(--text-muted)' }}>Confiance: <span style={{ color:'var(--text)' }}>{liveRlEval.confidence}%</span></div>
                  <div style={{ color:'var(--text-muted)' }}>IV utilisee: <span style={{ color:'var(--accent)' }}>{liveRlEval.iv != null ? `${liveRlEval.iv.toFixed(2)}%` : '—'}</span></div>
                  <div style={{ color:'var(--text-muted)' }}>Filtre IV: <span style={{ color:liveRlEval.highIvCondition ? 'var(--call)' : 'var(--put)' }}>{liveRlEval.highIvCondition ? 'OK' : `Mini ${liveRlEval.ivFloor}%`}</span></div>
                  <div style={{ color:'var(--text-muted)' }}>Spot: <span style={{ color:'var(--text)' }}>{formSpot ? fmtUSD(formSpot) : '—'}</span></div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:10, marginTop:4 }}>
                  <div style={{ color:'var(--text-muted)' }}>Delta: <span style={{ color:liveRlEval.deltaFloorOk ? 'var(--call)' : 'var(--put)' }}>{liveRlEval.delta != null ? liveRlEval.delta.toFixed(2) : '—'}</span></div>
                  <div style={{ color:'var(--text-muted)' }}>DCA: <span style={{ color:liveRlEval.plusValueLocked ? 'var(--call)' : liveRlEval.trappedProtocolActive ? 'var(--accent)' : 'var(--put)' }}>{liveRlEval.plusValueLocked ? 'plus-value lock' : liveRlEval.dcaGapPct != null ? `${Math.abs(liveRlEval.dcaGapPct).toFixed(1)}% du DCA` : '—'}</span></div>
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                  Calendrier: {liveRlEval.expiryTs ? new Date(liveRlEval.expiryTs).getUTCDay() === 5 ? 'vendredi' : 'hors vendredi' : 'date manquante'}
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:6 }}>
                  Etat: <span style={{ color:'var(--text)' }}>{liveRlEval.stateKey}</span> · protocole <span style={{ color:'var(--text)' }}>{liveRlEval.protocol}</span>
                </div>
              </div>
            )}

            {/* Vérification DCA */}
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

            <button className="di-add-btn"
              style={{ background: editId ? 'linear-gradient(135deg, var(--atm), #ff9500)' : undefined }}
              onClick={saveOffer}>
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
                <div className="stat-card"><div className="stat-label">Prime totale</div><div className="stat-value green">{(() => { const t=offers.reduce((s,o)=>s+(calcPremiumNative(o.rate, o.days, o.quantity) * o.strike||0),0); return t>0?'+'+fmtUSD(t):'—' })()}</div></div>
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
                      const rl = offerRlMap[o.id]
                      const days   = o.days || calcDays(o.subscribeDate, o.settlementDate)
                      const prime  = calcPremiumNative(o.rate, days, o.quantity) * o.strike
                      const primeN = calcPremiumNative(o.rate, days, o.quantity)
                      const mktPct = marketPremiumPct(o.deribitIV, days)
                      const ratio  = diScore(o.rate, o.deribitIV, days)
                      const { label, cls } = scoreLabel(ratio)
                      const nexoPct = o.rate/100*(days/365)*100
                      const margin  = mktPct ? Math.max(0,(mktPct-nexoPct)/mktPct*100) : null
                      return (
                        <div key={o.id} className="card fade-in" style={{ marginBottom:8 }}>
                          <div className="card-header">
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <span className={`di-badge ${o.type}`}>{o.type==='buy-low'?'Buy Low':'Sell High'}</span>
                              <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:14 }}>{fmtStrike(o.strike)}</span>
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                              <span style={{ fontSize:10, color:'var(--text-muted)' }}>⏳ {countdown(o.settlementDate)}</span>
                              <button onClick={() => startEdit(o)} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-muted)', cursor:'pointer', fontSize:11, padding:'2px 8px', borderRadius:6 }}>✏️</button>
                              <button className="di-del" onClick={() => deleteOffer(o.id)}>✕</button>
                            </div>
                          </div>
                          <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                            <div>
                              <div className="stat-label">Engagé</div>
                              <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:asset==='BTC'?'#f7931a':asset==='ETH'?'#627eea':'var(--accent)' }}>
                                {o.type==='sell-high' ? `${o.quantity} ${o.asset}` : `${o.quantity?.toLocaleString()} USDC`}
                              </div>
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>≈ {fmtUSD(o.amount)}</div>
                            </div>
                            <div>
                              <div className="stat-label">Settlement</div>
                              <div style={{ fontSize:11, color:'var(--accent)' }}>{fmtExpiry(o.settlementDate)}</div>
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>{fmtDuration(days)}</div>
                            </div>
                            <div>
                              <div className="stat-label">APY</div>
                              <div style={{ color:'var(--accent2)', fontWeight:700 }}>{o.rate.toFixed(2)}%</div>
                            </div>
                            <div>
                              <div className="stat-label">Prime</div>
                              <div style={{ color:'var(--call)', fontWeight:700 }}>
                                {primeN ? `+${primeN.toFixed(o.type==='sell-high'?(o.asset==='BTC'?6:5):2)} ${o.type==='sell-high'?o.asset:'USDC'}` : '—'}
                              </div>
                              <div style={{ fontSize:10, color:'var(--call)' }}>{prime ? '≈ +'+fmtUSD(prime) : ''}</div>
                            </div>
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
                            {rl && (
                              <div style={{ gridColumn:'span 2', background:'rgba(0,212,255,.06)', border:'1px solid rgba(0,212,255,.2)', borderRadius:8, padding:'8px 10px' }}>
                                <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:10, marginBottom:4 }}>
                                  <span style={{ color:'var(--text-muted)' }}>Diagnostic RL</span>
                                  <span style={{ color:rl.action==='subscribe' ? 'var(--call)' : 'var(--put)', fontWeight:700 }}>RL {rl.action==='subscribe' ? 'GO' : 'WAIT'} {rl.confidence}%</span>
                                </div>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:10 }}>
                                  <div style={{ color:'var(--text-muted)' }}>Q(sub/skip): <span style={{ color:'var(--text)' }}>{rl.qSubscribe.toFixed(2)} / {rl.qSkip.toFixed(2)}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>Filtre IV: <span style={{ color:rl.highIvCondition ? 'var(--call)' : 'var(--put)' }}>{rl.highIvCondition ? 'OK' : `Mini ${rl.ivFloor}%`}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>Calendrier: <span style={{ color:'var(--text)' }}>{rl.expiryTs ? new Date(rl.expiryTs).getUTCDay() === 5 ? 'vendredi' : 'hors vendredi' : 'date manquante'}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>Etat: <span style={{ color:'var(--text)' }}>{rl.stateKey}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>Delta: <span style={{ color:rl.deltaFloorOk ? 'var(--call)' : 'var(--put)' }}>{rl.delta != null ? rl.delta.toFixed(2) : '—'}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>DCA: <span style={{ color:rl.plusValueLocked ? 'var(--call)' : 'var(--text)' }}>{rl.plusValueLocked ? 'plus-value' : rl.dcaGapPct != null ? `${Math.abs(rl.dcaGapPct).toFixed(1)}% du DCA` : '—'}</span></div>
                                  <div style={{ color:'var(--text-muted)' }}>Protocole: <span style={{ color:'var(--text)' }}>{rl.protocol}</span></div>
                                </div>
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
                    const days    = o.days || calcDays(o.subscribeDate, o.settlementDate)
                    const spot    = spots[o.asset] ?? null
                    const pnlData = calcPnL(o, spot, dca)
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
                            <span style={{ fontSize:10, color:'var(--text-muted)' }}>⏳ {countdown(o.settlementDate)}</span>
                            <button onClick={() => startEdit(o)} style={{ background:'none', border:'1px solid var(--border)', color:'var(--text-muted)', cursor:'pointer', fontSize:11, padding:'2px 8px', borderRadius:6 }}>✏️</button>
                          </div>
                        </div>
                        <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                          <div>
                            <div className="stat-label">Engagé</div>
                            <div style={{ fontWeight:700, color:asset==='BTC'?'#f7931a':asset==='ETH'?'#627eea':'var(--accent)', fontSize:13 }}>
                              {o.type==='sell-high'?`${o.quantity} ${o.asset}`:`${o.quantity?.toLocaleString()} USDC`}
                            </div>
                          </div>
                          <div>
                            <div className="stat-label">Distance strike</div>
                            {distPct != null
                              ? <div style={{ fontWeight:700, color:Math.abs(distPct)<2?'var(--put)':Math.abs(distPct)<8?'var(--accent2)':'var(--call)' }}>
                                  {distPct > 0 ? '▲' : '▼'} {Math.abs(distPct).toFixed(2)}%
                                </div>
                              : <div style={{ color:'var(--text-muted)' }}>—</div>}
                          </div>
                          <div>
                            <div className="stat-label">Prime</div>
                            <div style={{ color:'var(--call)' }}>{pnlData ? '+'+fmtUSD(pnlData.prime) : '—'}</div>
                            {pnlData?.primeNative && (
                              <div style={{ fontSize:10, color:'var(--call)' }}>
                                +{pnlData.primeNative.toFixed(o.type==='sell-high'?(o.asset==='BTC'?6:5):2)} {o.type==='sell-high'?o.asset:'USDC'}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="stat-label">Statut</div>
                            {pnlData?.willBeExercised != null
                              ? <div style={{ fontSize:12, fontWeight:700, color:pnlData.willBeExercised?'var(--put)':'var(--call)' }}>
                                  {pnlData.willBeExercised ? '⚡ Sera exercé' : '✓ Non exercé'}
                                </div>
                              : <div style={{ color:'var(--text-muted)' }}>—</div>}
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
                            {o.type==='sell-high' && dca && (
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                ({fmtUSD(o.strike)} − {fmtUSD(dca)}) × {o.quantity} {o.asset} + prime
                              </div>
                            )}
                            {o.type==='buy-low' && dca && (
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                ({fmtUSD(dca)} − {fmtUSD(o.strike)}) × {pnlData.btcIfExercised?.toFixed(6)} {o.asset} + prime
                              </div>
                            )}
                          </div>
                        )}

                        {pnlData?.scenarios?.length > 0 && (
                          <div style={{ margin:'0 16px 12px' }}>
                            <div className="stat-label" style={{ marginBottom:8 }}>
                              {o.type==='sell-high' ? 'Manque à gagner si prix monte après expiry' : 'Manque à gagner si prix chute après expiry'}
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
