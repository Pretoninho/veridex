import { useState, useEffect } from 'react'
import { getSpot, getInstruments, getOrderBook, getAllExpiries, getBestDIOpportunities } from '../../utils/api.js'
import { calcOptionGreeks } from '../../utils/greeks.js'
import { evaluateDualPolicy, getDualRlMetrics } from '../../utils/rlDual.js'

function fmtTs(ts) {
  return new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'2-digit'}).toUpperCase()
}
function daysUntil(ts) { return Math.max(0.01,(ts-Date.now())/86400000) }
const RL_CYCLE_TARGET_DAYS = 14

function isUtcFriday(ts) {
  return new Date(ts).getUTCDay() === 5
}

function pickRlCycleExpiry(expiries, nowMs = Date.now()) {
  if (!expiries?.length) return null

  const future = expiries.filter((ts) => Number.isFinite(ts) && ts > nowMs)
  if (!future.length) return expiries[0] ?? null

  const fridayFuture = future.filter((ts) => isUtcFriday(ts))
  const fridayWindow = fridayFuture.filter((ts) => {
    const d = (ts - nowMs) / 86400000
    return d >= 7 && d <= RL_CYCLE_TARGET_DAYS
  })

  if (fridayWindow.length) {
    return fridayWindow.sort((a, b) => {
      const da = Math.abs(((a - nowMs) / 86400000) - RL_CYCLE_TARGET_DAYS)
      const db = Math.abs(((b - nowMs) / 86400000) - RL_CYCLE_TARGET_DAYS)
      if (da !== db) return da - db
      return a - b
    })[0]
  }

  if (fridayFuture.length) return fridayFuture[0]
  return future[0]
}

function settlesIn(ts) {
  const ms = Math.max(0, ts - Date.now())
  const hours = Math.max(1, Math.round(ms / 3600000))
  const days = Math.max(1, Math.round(ms / 86400000))
  const date = new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})
  const display = hours < 24 ? `${hours}h` : `${days}j`
  return { display, hours, date }
}
function calcDualInterestPct(row, side, spotNow, days) {
  if (!spotNow || !days || days <= 0) return null
  const book = side === 'buy-low' ? row.put : row.call
  const markPrice = book?.mark_price
  if (!Number.isFinite(markPrice) || markPrice <= 0) return null
  const premiumUSD = markPrice * spotNow
  const notional = side === 'buy-low' ? row.strike : spotNow
  if (!Number.isFinite(notional) || notional <= 0) return null
  return (premiumUSD / notional) * 100 * (365 / days)
}
function scoreNexoRate(nexoRate,iv,days) {
  if(!nexoRate||!iv||!days) return null
  const T=days/365
  const fairRate=iv/100*Math.sqrt(T)*0.4*100*(365/days)
  return {ratio:nexoRate/fairRate,fairRate}
}
function getRating(ratio) {
  if(ratio==null) return null
  if(ratio>=0.85) return {label:'Excellent',color:'var(--call)',detail:'Tres proche du marche'}
  if(ratio>=0.65) return {label:'Bon',color:'var(--atm)',detail:'Taux correct'}
  if(ratio>=0.45) return {label:'Passable',color:'var(--accent2)',detail:'Marge importante'}
  return {label:'Faible',color:'var(--put)',detail:'Sous-paie significativement'}
}

const NEXO_DISTANCE_RULES = {
  BTC: [
    { maxDays: 2, distance: 3000 },
    { maxDays: 3, distance: 4000 },
    { maxDays: 4, distance: 5000 },
    { maxDays: 14, distance: 7000 },
    { maxDays: 21, distance: 7000 },
    { maxDays: 90, distance: 15000 },
    { maxDays: 180, distance: 17000 },
    { maxDays: 270, distance: 22000 },
    { maxDays: 365, distance: 25000 },
  ],
  ETH: [
    { maxDays: 2, distance: 200 },
    { maxDays: 3, distance: 300 },
    { maxDays: 4, distance: 300 },
    { maxDays: 14, distance: 500 },
    { maxDays: 21, distance: 600 },
    { maxDays: 90, distance: 1000 },
    { maxDays: 180, distance: 1000 },
    { maxDays: 270, distance: 1200 },
    { maxDays: 365, distance: 1300 },
  ],
}

function getNexoStrikeDistance(asset, days) {
  const rules = NEXO_DISTANCE_RULES[asset]
  if (!rules?.length || !days) return null
  const found = rules.find((r) => days <= r.maxDays)
  return (found || rules[rules.length - 1]).distance
}

function getStoredDca(asset) {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`di_dca_${asset}`)
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

function isPlusValueStrike(side, strike, dca) {
  if (!Number.isFinite(strike) || !Number.isFinite(dca) || dca <= 0) return null
  return side === 'sell-high' ? strike >= dca : strike <= dca
}

function getDcaGapPct(strike, dca) {
  if (!Number.isFinite(strike) || !Number.isFinite(dca) || dca <= 0) return null
  return ((strike - dca) / dca) * 100
}

export default function ChainPage({ onNavigate, onSubscribe }) {
  const [asset,setAsset]=useState('BTC')
  const [instruments,setInstruments]=useState([])
  const [expiries,setExpiries]=useState([])
  const [selExpiry,setSelExpiry]=useState(null)
  const [rows,setRows]=useState([])
  const [spot,setSpot]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState(null)
  const [stats,setStats]=useState(null)
  const [activeTab,setActiveTab]=useState('chain')
  const [diExpiry,setDiExpiry]=useState(null)
  const [atmIV,setAtmIV]=useState(null)
  const [nexoRates,setNexoRates]=useState({})
  const [opps,setOpps]=useState([])
  const [oppsLoading,setOppsLoading]=useState(false)
  const [atmGreeks,setAtmGreeks]=useState(null)
  const [chainSide,setChainSide]=useState('buy-low')
  const [rlMetrics,setRlMetrics]=useState(()=>getDualRlMetrics())

  const loadExpiries=async(a)=>{
    setLoading(true);setError(null)
    try {
      const [sp,inst]=await Promise.all([getSpot(a),getInstruments(a)])
      setSpot(sp);setInstruments(inst)
      const exps=getAllExpiries(inst)
      setExpiries(exps)
      if(exps.length){
        const preferred = pickRlCycleExpiry(exps) ?? exps[0]
        setSelExpiry(preferred)
        setDiExpiry(preferred)
        await loadChain(a,preferred,inst,sp)
      }
    } catch(e){setError(e.message)}
    setLoading(false)
  }

  const loadChain=async(a,expiryTs,inst,sp)=>{
    const forExp=inst.filter(i=>i.expiration_timestamp===expiryTs)
    const strikes=[...new Set(forExp.map(i=>i.strike))].sort((x,y)=>x-y)
    const spotNow=sp||spot
    const allRows=[]
    for(let i=0;i<strikes.length;i+=20){
      const batch=strikes.slice(i,i+20)
      const batchRows=await Promise.all(batch.map(async strike=>{
        const callInst=forExp.find(x=>x.option_type==='call'&&x.strike===strike)
        const putInst=forExp.find(x=>x.option_type==='put'&&x.strike===strike)
        const [cb,pb]=await Promise.all([
          callInst?getOrderBook(callInst.instrument_name).catch(()=>null):Promise.resolve(null),
          putInst?getOrderBook(putInst.instrument_name).catch(()=>null):Promise.resolve(null),
        ])
        return {strike,call:cb,put:pb}
      }))
      allRows.push(...batchRows)
    }
    setRows(allRows)
    const atmRow=spotNow?allRows.reduce((p,c)=>Math.abs(c.strike-spotNow)<Math.abs(p.strike-spotNow)?c:p,allRows[0]):null
    const atmiv=atmRow?.call?.mark_iv??atmRow?.put?.mark_iv??null
    const daysToExpiry=Math.max(0.01,daysUntil(expiryTs))
    const sigma=atmiv!=null?atmiv/100:null
    const callGreeks=(spotNow&&atmRow?.strike&&sigma)?calcOptionGreeks({
      type:'call',
      S:spotNow,
      K:atmRow.strike,
      T:daysToExpiry/365,
      sigma,
      r:0,
    }):null
    const putGreeks=(spotNow&&atmRow?.strike&&sigma)?calcOptionGreeks({
      type:'put',
      S:spotNow,
      K:atmRow.strike,
      T:daysToExpiry/365,
      sigma,
      r:0,
    }):null

    setAtmGreeks(callGreeks&&putGreeks?{
      strike:atmRow?.strike,
      iv:atmiv,
      days:daysToExpiry,
      call:callGreeks,
      put:putGreeks,
    }:null)
    setAtmIV(atmiv)
    const callIVs=allRows.map(r=>r.call?.mark_iv).filter(Boolean)
    const putIVs=allRows.map(r=>r.put?.mark_iv).filter(Boolean)
    setStats({
      callIV:callIVs.length?(callIVs.reduce((a,b)=>a+b,0)/callIVs.length).toFixed(1):'—',
      putIV:putIVs.length?(putIVs.reduce((a,b)=>a+b,0)/putIVs.length).toFixed(1):'—',
      atmIV:atmiv?.toFixed(1)||'—',atmStrike:atmRow?.strike,contracts:allRows.length
    })
    setNexoRates({})
  }

  useEffect(()=>{loadExpiries(asset)},[asset])
  useEffect(()=>{ setRlMetrics(getDualRlMetrics()) },[asset, chainSide, selExpiry])

  const switchExpiry=async(ts)=>{
    setSelExpiry(ts);setLoading(true)
    try{await loadChain(asset,ts,instruments,spot)}catch(e){setError(e.message)}
    setLoading(false)
  }

  const fmt=n=>n!=null?n.toFixed(2):'—'
  const fmtK=n=>n!=null?(n>=1000?(n/1000).toFixed(1)+'K':n.toFixed(0)):'—'
  const diDays=diExpiry?daysUntil(diExpiry):null

  const diRows=rows.map(r=>{
    const iv=r.put?.mark_iv??r.call?.mark_iv??null
    const distPct=spot?(r.strike-spot)/spot*100:null
    const isBuyLow=distPct!=null&&distPct<0
    const isSellHigh=distPct!=null&&distPct>0
    const nexoRate=nexoRates[r.strike]??null
    const scored=nexoRate&&iv&&diDays?scoreNexoRate(nexoRate,iv,diDays):null
    const rating=scored?getRating(scored.ratio):null
    return {strike:r.strike,iv,distPct,isBuyLow,isSellHigh,nexoRate,scored,rating}
  })

  const smileRows=rows.map(r=>({strike:r.strike,iv:r.call?.mark_iv??r.put?.mark_iv??null,distPct:spot?(r.strike-spot)/spot*100:null})).filter(r=>r.iv!=null)
  const maxIV=smileRows.length?Math.max(...smileRows.map(r=>r.iv)):1
  const chainDays=selExpiry?daysUntil(selExpiry):null
  const isFridaySelection = selExpiry ? isUtcFriday(selExpiry) : false
  const nexoDistance = getNexoStrikeDistance(asset, chainDays)
  const dcaRef = getStoredDca(asset)
  const baseChainRows = rows
    .map(r=>{
      const distPct=spot?((r.strike-spot)/spot)*100:null
      const strikeDistance = spot != null ? Math.abs(r.strike - spot) : null
      const interest=calcDualInterestPct(r,chainSide,spot,chainDays)
      const sideBook=chainSide==='buy-low'?r.put:r.call
      const settle=selExpiry?settlesIn(selExpiry):null
      const delta = sideBook?.greeks?.delta ?? null
      return {
        strike:r.strike,
        strikeDistance,
        distPct,
        interest,
        settle,
        iv:sideBook?.mark_iv??null,
        oi:sideBook?.open_interest??null,
        delta,
      }
    })
    .filter(r=>{
      if(!spot||r.interest==null||r.distPct==null||r.strikeDistance==null) return false
      if(nexoDistance!=null && r.strikeDistance > nexoDistance) return false
      if(chainSide==='buy-low') return r.distPct < -0.2
      return r.distPct > 0.2
    })
    .sort((a,b)=>a.strike-b.strike)

  const hasPlusValueCandidate = dcaRef == null
    ? true
    : baseChainRows.some((row) => isPlusValueStrike(chainSide, row.strike, dcaRef) === true)
  const trappedTrend = dcaRef != null && !hasPlusValueCandidate
  const chainRows=baseChainRows
    .map((r)=>{
      const plusValueLocked = isPlusValueStrike(chainSide, r.strike, dcaRef)
      const dcaGapPct = getDcaGapPct(r.strike, dcaRef)
      const rl = evaluateDualPolicy({
        asset,
        side: chainSide,
        strike: r.strike,
        dca: dcaRef,
        dcaGapPct,
        plusValueLocked,
        trappedTrend,
        delta: r.delta,
        days: chainDays,
        expiryTs: selExpiry,
        apr: r.interest,
        distPct: r.distPct,
        iv: r.iv,
      })
      return {
        ...r,
        plusValueLocked,
        dcaGapPct,
        rl,
      }
    })
    .slice(0,14)

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Chaine <span>Options</span></div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          {spot&&<div className="price-pill"><span className="price-label">{asset}</span><span className="price-value">${spot.toLocaleString('en-US',{maximumFractionDigits:0})}</span></div>}
          <button className={`icon-btn${loading?' loading':''}`} onClick={()=>loadExpiries(asset)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{marginBottom:12}}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={()=>setAsset('BTC')}>BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={()=>setAsset('ETH')}>ETH</button>
      </div>

      <div style={{display:'flex',marginBottom:14,borderBottom:'1px solid var(--border)'}}>
        {[['chain','Chaine'],['di','Evaluer DI'],['opps','Top DI']].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{
            padding:'8px 16px',background:'none',border:'none',cursor:'pointer',
            fontFamily:'var(--sans)',fontSize:12,fontWeight:700,
            color:activeTab===id?'var(--accent)':'var(--text-muted)',
            borderBottom:activeTab===id?'2px solid var(--accent)':'2px solid transparent',
            marginBottom:-1,transition:'all .2s'
          }}>{label}</button>
        ))}
      </div>

      {error&&<div className="error-box">{error}</div>}

      {stats&&activeTab!=='chain'&&(
        <div className="stats-grid" style={{marginBottom:12}}>
          <div className="stat-card"><div className="stat-label">IV ATM</div><div className="stat-value gold">{stats.atmIV}%</div>{stats.atmStrike&&<div className="stat-sub">Strike {stats.atmStrike?.toLocaleString()}</div>}</div>
          <div className="stat-card"><div className="stat-label">Contrats</div><div className="stat-value blue">{stats.contracts}</div></div>
          <div className="stat-card"><div className="stat-label">IV Calls</div><div className="stat-value green">{stats.callIV}%</div></div>
          <div className="stat-card"><div className="stat-label">IV Puts</div><div className="stat-value orange">{stats.putIV}%</div></div>
        </div>
      )}

      {activeTab==='di'&&atmGreeks&&(
        <div className="card" style={{marginBottom:12}}>
          <div className="card-header">
            <span>Grecs ATM (calcul client)</span>
            <span style={{fontSize:10,color:'var(--text-muted)'}}>IV {atmGreeks.iv.toFixed(1)}% · {atmGreeks.days.toFixed(1)}j</span>
          </div>
          <div style={{padding:'10px 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div style={{background:'rgba(0,229,160,.06)',border:'1px solid rgba(0,229,160,.2)',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:'var(--call)',fontWeight:700,marginBottom:6}}>CALL</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:4,fontSize:11}}>
                <span style={{color:'var(--text-muted)'}}>Delta</span><span style={{color:'var(--text)'}}>{atmGreeks.call.delta.toFixed(3)}</span>
                <span style={{color:'var(--text-muted)'}}>Gamma</span><span style={{color:'var(--text)'}}>{atmGreeks.call.gamma.toFixed(5)}</span>
                <span style={{color:'var(--text-muted)'}}>Theta/j</span><span style={{color:'var(--text)'}}>{atmGreeks.call.theta.toFixed(3)}</span>
                <span style={{color:'var(--text-muted)'}}>Vega/1%</span><span style={{color:'var(--text)'}}>{atmGreeks.call.vega.toFixed(3)}</span>
              </div>
            </div>
            <div style={{background:'rgba(255,77,109,.06)',border:'1px solid rgba(255,77,109,.2)',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:'var(--put)',fontWeight:700,marginBottom:6}}>PUT</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:4,fontSize:11}}>
                <span style={{color:'var(--text-muted)'}}>Delta</span><span style={{color:'var(--text)'}}>{atmGreeks.put.delta.toFixed(3)}</span>
                <span style={{color:'var(--text-muted)'}}>Gamma</span><span style={{color:'var(--text)'}}>{atmGreeks.put.gamma.toFixed(5)}</span>
                <span style={{color:'var(--text-muted)'}}>Theta/j</span><span style={{color:'var(--text)'}}>{atmGreeks.put.theta.toFixed(3)}</span>
                <span style={{color:'var(--text-muted)'}}>Vega/1%</span><span style={{color:'var(--text)'}}>{atmGreeks.put.vega.toFixed(3)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHAINE */}
      {activeTab==='chain'&&(
        <>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontFamily:'var(--sans)', fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:4 }}>
              Earn high <span style={{ color:'var(--accent)' }}>yield</span>
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>
              {chainSide==='buy-low'
                ? `Pick a target price and date to buy ${asset} while earning interest.`
                : `Pick a target price and date to sell ${asset} while earning interest.`}
            </div>
          </div>

          <div className="expiry-chips" style={{ marginBottom:8 }}>
            {expiries.map(ts=>(
              <button key={ts} className={`expiry-chip${selExpiry===ts?' active':''}`} onClick={()=>switchExpiry(ts)}>{fmtTs(ts)}</button>
            ))}
          </div>

          <div style={{ display:'flex', marginBottom:10, borderBottom:'1px solid var(--border)' }}>
            {[['buy-low','Buy low'],['sell-high','Sell high']].map(([id,label])=>(
              <button key={id} onClick={()=>setChainSide(id)} style={{
                padding:'8px 0', marginRight:16, background:'none', border:'none', cursor:'pointer',
                fontFamily:'var(--sans)', fontSize:15, fontWeight:700,
                color: chainSide===id?'var(--text)':'var(--text-muted)',
                borderBottom: chainSide===id?'2px solid var(--accent)':'2px solid transparent',
                marginBottom:-1,
              }}>{label}</button>
            ))}
          </div>

          {loading&&rows.length===0&&<div className="card"><div style={{padding:20,textAlign:'center',color:'var(--text-muted)',fontSize:12}}>Chargement...</div></div>}

          <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:12 }}>
            <div style={{ fontSize:11, color:'var(--text)' }}>
              Current price is: <span style={{ color:'var(--accent)', fontWeight:700 }}>${spot?.toLocaleString('en-US',{maximumFractionDigits:2}) ?? '—'}</span>
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
              Filtre Nexo: distance max ±{nexoDistance?.toLocaleString('en-US') ?? '—'} USD ({chainDays ? `${chainDays.toFixed(1)}j` : '—'})
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
              Cycle RL: vendredi hebdo, cible {RL_CYCLE_TARGET_DAYS}j ({isFridaySelection ? 'vendredi OK' : 'hors vendredi'})
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
              DCA {asset}: {dcaRef ? `$${dcaRef.toLocaleString('en-US',{maximumFractionDigits:2})}` : 'non renseigne'}{dcaRef ? ` · protocole ${trappedTrend ? 'piege tendance actif' : 'plus-value disponible'}` : ''}
            </div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
              RL dataset: {rlMetrics.experiences} experiences · {rlMetrics.states} etats
            </div>
          </div>

          {chainRows.length>0&&(
            <div className="card">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 76px 96px',padding:'8px 10px',borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--text-muted)'}}>
                <span style={{fontWeight:700,color:'var(--text)'}}>{chainSide==='buy-low'?'Buy low':'Sell high'}</span>
                <span style={{fontWeight:700,color:'var(--text)'}}>Settles in</span>
                <span style={{fontWeight:700,color:'var(--text)'}}>Interest</span>
                <span></span>
              </div>
              {chainRows.map((r)=>{
                return(
                  <div key={r.strike} style={{padding:'8px 10px',borderBottom:'1px solid rgba(30,58,95,.35)'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 76px 96px',alignItems:'center',gap:6}}>
                      <div>
                        <div style={{fontFamily:'var(--sans)',fontWeight:700,fontSize:22,color:'var(--text)',lineHeight:1}}>${r.strike.toLocaleString()}</div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>{r.distPct>0?'+':''}{r.distPct?.toFixed(1)}% du spot</div>
                      </div>
                      <div>
                        <div style={{fontSize:18,color:'var(--text)',lineHeight:1}}>{r.settle?.display}</div>
                        <div style={{display:'inline-block',marginTop:4,fontSize:9,color:'var(--text-muted)',background:'rgba(255,255,255,.06)',padding:'1px 6px',borderRadius:6}}>{r.settle?.date}</div>
                      </div>
                      <div>
                        <span style={{display:'inline-block',fontSize:12,fontWeight:700,color:'var(--accent)',background:'rgba(0,212,255,.14)',border:'1px solid rgba(0,212,255,.28)',padding:'2px 8px',borderRadius:7}}>{r.interest.toFixed(2)}%</span>
                        <div style={{fontSize:9,color:'var(--text-muted)',marginTop:3}}>IV {r.iv?.toFixed(1) ?? '—'}%</div>
                        <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>Delta {r.delta != null ? Math.abs(r.delta).toFixed(2) : '—'}</div>
                        <div style={{fontSize:9,color:r.rl.action==='subscribe'?'var(--call)':'var(--text-muted)',marginTop:2,fontWeight:700}}>
                          RL {r.rl.action==='subscribe'?'GO':'WAIT'} {r.rl.confidence}%
                        </div>
                        {!r.rl.highIvCondition&&(
                          <div style={{fontSize:8,color:'var(--put)',marginTop:1}}>IV trop basse (&lt; {r.rl.ivFloor}%)</div>
                        )}
                        <div style={{fontSize:8,color:r.rl.plusValueLocked ? 'var(--call)' : r.rl.trappedProtocolActive ? 'var(--accent)' : 'var(--put)',marginTop:1}}>
                          {r.rl.plusValueLocked ? 'Plus-value si exerce' : r.rl.trappedProtocolActive ? `Piege: viser DCA (${r.dcaGapPct != null ? `${Math.abs(r.dcaGapPct).toFixed(1)}%` : '—'})` : 'Sous DCA si exerce'}
                        </div>
                        <div style={{fontSize:8,color:r.rl.deltaFloorOk ? 'var(--call)' : 'var(--put)',marginTop:1}}>
                          Delta {r.rl.delta != null ? r.rl.delta.toFixed(2) : '—'} {r.rl.deltaFloorOk ? '>= 0.20' : '< 0.20'}
                        </div>
                      </div>
                      <button
                        onClick={()=>{
                          const payload = {
                            asset,
                            side: chainSide,
                            strike: r.strike,
                            dca: dcaRef,
                            delta: r.delta,
                            plusValueLocked: r.plusValueLocked,
                            trappedTrend,
                            dcaGapPct: r.dcaGapPct,
                            expiryTs: selExpiry,
                            expiryLabel: r.settle?.date,
                            settleIn: r.settle?.display,
                            apr: r.interest,
                            days: chainDays,
                            spotEntry: spot,
                            iv: r.iv,
                            distanceUsd: r.strikeDistance,
                            distPct: r.distPct,
                            rlStateKey: r.rl.stateKey,
                            rlAction: r.rl.action,
                            rlConfidence: r.rl.confidence,
                            expiryPolicy: 'weekly-friday',
                            cycleTargetDays: RL_CYCLE_TARGET_DAYS,
                            isFridayExpiry: isUtcFriday(selExpiry),
                          }
                          if(onSubscribe) onSubscribe(payload)
                          else if(onNavigate) onNavigate('paper')
                          else { setActiveTab('di'); setDiExpiry(selExpiry) }
                        }}
                        style={{
                          background:'var(--accent)',color:'#001016',border:'none',borderRadius:8,
                          fontFamily:'var(--sans)',fontWeight:700,fontSize:12,padding:'10px 12px',cursor:'pointer'
                        }}
                      >
                        Subscribe
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!loading&&chainRows.length===0&&(
            <div className="empty-state">
              <div className="empty-icon">◇</div>
              <h3>Aucune ligne disponible</h3>
              <p>Essaie une autre échéance ou bascule vers {chainSide==='buy-low'?'Sell high':'Buy low'}</p>
            </div>
          )}
        </>
      )}

      {/* EVALUER DI */}
      {activeTab==='di'&&(
        <div className="fade-in">
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>Echeance</div>
            <div className="expiry-chips">
              {expiries.map(ts=>(
                <button key={ts} className={`expiry-chip${diExpiry===ts?' active':''}`} onClick={()=>{setDiExpiry(ts);setNexoRates({})}}>
                  {fmtTs(ts)}<span style={{display:'block',fontSize:9,opacity:.7}}>{daysUntil(ts).toFixed(1)}j</span>
                </button>
              ))}
            </div>
          </div>
          {diExpiry&&atmIV&&(
            <div style={{background:'rgba(255,215,0,.06)',border:'1px solid rgba(255,215,0,.2)',borderRadius:8,padding:'10px 14px',marginBottom:14,display:'flex',justifyContent:'space-between'}}>
              <span style={{fontSize:11,color:'var(--text-dim)'}}>IV ATM : <strong style={{color:'var(--atm)'}}>{atmIV.toFixed(1)}%</strong></span>
              <span style={{fontSize:10,color:'var(--text-muted)'}}>{daysUntil(diExpiry).toFixed(1)} jours</span>
            </div>
          )}
          <div style={{background:'rgba(0,212,255,.05)',border:'1px solid rgba(0,212,255,.1)',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:11,color:'var(--text-muted)'}}>
            Saisis le taux APR Nexo pour chaque strike — scoring instantane
          </div>
          {diRows.length>0&&(
            <div className="card">
              {diRows.map(r=>{
                const isATM=stats?.atmStrike===r.strike
                const accent=isATM?'var(--atm)':r.isBuyLow?'var(--call)':r.isSellHigh?'var(--accent2)':'var(--text-muted)'
                const type=isATM?'ATM':r.isBuyLow?'Buy Low':r.isSellHigh?'Sell High':''
                return(
                  <div key={r.strike} style={{padding:'12px 14px',borderBottom:'1px solid rgba(30,58,95,.4)',borderLeft:`2px solid ${isATM?'var(--atm)':r.isBuyLow?'var(--call)':r.isSellHigh?'var(--accent2)':'transparent'}`}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontFamily:'var(--sans)',fontWeight:800,fontSize:14,color:isATM?'var(--atm)':'var(--text)'}}>${r.strike.toLocaleString()}</span>
                        {type&&<span style={{fontSize:9,fontWeight:700,padding:'1px 7px',borderRadius:20,background:isATM?'rgba(255,215,0,.15)':r.isBuyLow?'rgba(0,229,160,.12)':'rgba(255,107,53,.12)',color:accent,border:`1px solid ${accent}40`}}>{type}</span>}
                      </div>
                      <div style={{fontSize:10,color:'var(--text-muted)',textAlign:'right'}}>
                        <div>IV: <span style={{color:'var(--accent)'}}>{r.iv?.toFixed(1)??'—'}%</span></div>
                        {r.distPct!=null&&<div>{r.distPct>0?'+':''}{r.distPct.toFixed(1)}%</div>}
                      </div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{flex:1,position:'relative'}}>
                        <input type="number" step="0.01" min="0" placeholder="APR Nexo %"
                          value={nexoRates[r.strike]??''}
                          onChange={e=>setNexoRates(prev=>({...prev,[r.strike]:parseFloat(e.target.value)||null}))}
                          style={{width:'100%',background:'var(--surface2)',border:`1px solid ${r.nexoRate?accent+'60':'var(--border)'}`,color:'var(--text)',padding:'8px 36px 8px 12px',borderRadius:8,fontFamily:'var(--mono)',fontSize:12,outline:'none'}}
                        />
                        <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',fontSize:10,color:'var(--text-muted)',pointerEvents:'none'}}>%</span>
                      </div>
                      {r.rating&&<div style={{fontFamily:'var(--sans)',fontWeight:800,fontSize:12,color:r.rating.color,flexShrink:0}}>{r.rating.label}</div>}
                    </div>
                    {r.scored&&r.rating&&(
                      <div style={{marginTop:8,background:'var(--surface2)',borderRadius:6,padding:'8px 10px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:4}}>
                          <span style={{color:'var(--text-muted)'}}>Taux Nexo</span>
                          <span style={{color:accent,fontWeight:700}}>{r.nexoRate.toFixed(2)}% /an</span>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:6}}>
                          <span style={{color:'var(--text-muted)'}}>Reference theorique</span>
                          <span style={{color:'var(--text-dim)'}}>{r.scored.fairRate.toFixed(2)}% /an</span>
                        </div>
                        <div style={{height:5,background:'rgba(255,255,255,.06)',borderRadius:3,overflow:'hidden',marginBottom:4}}>
                          <div style={{height:'100%',width:`${Math.min(r.scored.ratio,1)*100}%`,background:r.rating.color,borderRadius:3}}/>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--text-muted)'}}>
                          <span>{r.rating.detail}</span>
                          <span>{(r.scored.ratio*100).toFixed(0)}% du marche</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* TOP DI */}
      {activeTab==='opps'&&(
        <div className="fade-in">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
            <div>
              <div style={{fontFamily:'var(--sans)',fontWeight:700,fontSize:13,color:'var(--text-dim)'}}>Meilleures opportunites</div>
              <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>Score = APR (40%) + IV (35%) + Distance (25%)</div>
            </div>
            <button
              onClick={async()=>{
                setOppsLoading(true)
                try{const r=await getBestDIOpportunities(asset);setOpps(r)}catch(e){console.warn(e)}
                setOppsLoading(false)
              }}
              style={{
                background:'var(--accent)',color:'#000',border:'none',borderRadius:8,
                padding:'8px 16px',fontFamily:'var(--sans)',fontWeight:800,fontSize:12,
                cursor:'pointer',flexShrink:0
              }}
            >
              {oppsLoading?'...':'Analyser'}
            </button>
          </div>

          {oppsLoading&&<div className="card"><div style={{padding:24,textAlign:'center',color:'var(--text-muted)',fontSize:12}}>Analyse en cours...</div></div>}

          {!oppsLoading&&opps.length===0&&(
            <div className="empty-state">
              <div className="empty-icon">o</div>
              <h3>Prêt a analyser</h3>
              <p>Appuyez sur Analyser pour scanner toutes les echeances</p>
            </div>
          )}

          {opps.map(({ts,days,spot:sp,bestBL,bestSH})=>(
            <div key={ts} className="card" style={{marginBottom:12}}>
              <div className="card-header">
                <span style={{fontFamily:'var(--sans)',fontWeight:800}}>{fmtTs(ts)} · {days.toFixed(1)}j</span>
                <span style={{fontSize:10,color:'var(--text-muted)'}}>Spot ${sp?.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:0}}>
                <div style={{padding:'12px 14px',borderRight:'1px solid var(--border)'}}>
                  <div style={{fontSize:10,color:'var(--call)',fontWeight:700,marginBottom:8,letterSpacing:'1px'}}>BUY LOW</div>
                  {bestBL?(
                    <div>
                      <div style={{fontFamily:'var(--sans)',fontWeight:800,fontSize:18,color:'var(--text)'}}>${bestBL.strike.toLocaleString()}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:4}}>{bestBL.distPct.toFixed(1)}% du spot</div>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--call)',marginBottom:4}}>{bestBL.aprMarket.toFixed(1)}% APR</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:8}}>IV {bestBL.iv.toFixed(1)}%{bestBL.delta!=null?' · delta '+Math.abs(bestBL.delta).toFixed(2):''}</div>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <div style={{flex:1,height:5,background:'rgba(255,255,255,.06)',borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:bestBL.score+'%',background:'var(--call)',borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,color:'var(--call)',fontWeight:800}}>{bestBL.score}</span>
                      </div>
                    </div>
                  ):<div style={{fontSize:11,color:'var(--text-muted)'}}>N/A</div>}
                </div>
                <div style={{padding:'12px 14px'}}>
                  <div style={{fontSize:10,color:'var(--accent2)',fontWeight:700,marginBottom:8,letterSpacing:'1px'}}>SELL HIGH</div>
                  {bestSH?(
                    <div>
                      <div style={{fontFamily:'var(--sans)',fontWeight:800,fontSize:18,color:'var(--text)'}}>${bestSH.strike.toLocaleString()}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:4}}>+{bestSH.distPct.toFixed(1)}% du spot</div>
                      <div style={{fontSize:13,fontWeight:700,color:'var(--accent2)',marginBottom:4}}>{bestSH.aprMarket.toFixed(1)}% APR</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:8}}>IV {bestSH.iv.toFixed(1)}%{bestSH.delta!=null?' · delta '+bestSH.delta.toFixed(2):''}</div>
                      <div style={{display:'flex',alignItems:'center',gap:6}}>
                        <div style={{flex:1,height:5,background:'rgba(255,255,255,.06)',borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:bestSH.score+'%',background:'var(--accent2)',borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,color:'var(--accent2)',fontWeight:800}}>{bestSH.score}</span>
                      </div>
                    </div>
                  ):<div style={{fontSize:11,color:'var(--text-muted)'}}>N/A</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
