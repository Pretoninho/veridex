import { useState, useEffect } from 'react'
import { getSpot, getInstruments, getOrderBook, getAllExpiries, getBestDIOpportunities } from '../utils/api.js'

function fmtTs(ts) {
  return new Date(ts).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'2-digit'}).toUpperCase()
}
function daysUntil(ts) { return Math.max(0.01,(ts-Date.now())/86400000) }
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

export default function ChainPage() {
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

  const loadExpiries=async(a)=>{
    setLoading(true);setError(null)
    try {
      const [sp,inst]=await Promise.all([getSpot(a),getInstruments(a)])
      setSpot(sp);setInstruments(inst)
      const exps=getAllExpiries(inst)
      setExpiries(exps)
      if(exps.length){setSelExpiry(exps[0]);setDiExpiry(exps[0]);await loadChain(a,exps[0],inst,sp)}
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

      {stats&&(
        <div className="stats-grid" style={{marginBottom:12}}>
          <div className="stat-card"><div className="stat-label">IV ATM</div><div className="stat-value gold">{stats.atmIV}%</div>{stats.atmStrike&&<div className="stat-sub">Strike {stats.atmStrike?.toLocaleString()}</div>}</div>
          <div className="stat-card"><div className="stat-label">Contrats</div><div className="stat-value blue">{stats.contracts}</div></div>
          <div className="stat-card"><div className="stat-label">IV Calls</div><div className="stat-value green">{stats.callIV}%</div></div>
          <div className="stat-card"><div className="stat-label">IV Puts</div><div className="stat-value orange">{stats.putIV}%</div></div>
        </div>
      )}

      {/* CHAINE */}
      {activeTab==='chain'&&(
        <>
          <div className="expiry-chips">
            {expiries.map(ts=>(
              <button key={ts} className={`expiry-chip${selExpiry===ts?' active':''}`} onClick={()=>switchExpiry(ts)}>{fmtTs(ts)}</button>
            ))}
          </div>
          {loading&&rows.length===0&&<div className="card"><div style={{padding:20,textAlign:'center',color:'var(--text-muted)',fontSize:12}}>Chargement...</div></div>}
          {smileRows.length>0&&(
            <div className="card" style={{marginBottom:12}}>
              <div className="card-header"><span>Smile de volatilite</span></div>
              <div style={{padding:'12px 14px'}}>
                {smileRows.map(r=>{
                  const isATM=stats?.atmStrike===r.strike
                  const color=isATM?'var(--atm)':r.distPct<0?'var(--call)':'var(--accent2)'
                  return(
                    <div key={r.strike} style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
                      <span style={{width:72,fontSize:10,fontWeight:isATM?800:400,color:isATM?'var(--atm)':'var(--text-dim)',textAlign:'right',flexShrink:0}}>{r.strike>=1000?(r.strike/1000).toFixed(0)+'K':r.strike}</span>
                      <div style={{flex:1,height:6,background:'rgba(255,255,255,.05)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${(r.iv/maxIV)*100}%`,background:color,borderRadius:3}}/>
                      </div>
                      <span style={{width:44,fontSize:10,color,textAlign:'right',flexShrink:0}}>{r.iv.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {rows.length>0&&(
            <div className="card">
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',padding:'6px 14px',borderBottom:'1px solid var(--border)',fontSize:10}}>
                <span style={{color:'var(--call)',fontWeight:700}}>CALLS</span>
                <span style={{color:'var(--atm)',fontWeight:700,textAlign:'center'}}>STRIKE</span>
                <span style={{color:'var(--put)',fontWeight:700,textAlign:'right'}}>PUTS</span>
              </div>
              {rows.map(({strike,call,put})=>{
                const isATM=stats?.atmStrike===strike
                return(
                  <div key={strike} style={{padding:'10px 14px',borderBottom:'1px solid rgba(30,58,95,.4)',background:isATM?'rgba(255,215,0,.04)':undefined,borderLeft:isATM?'2px solid var(--atm)':'2px solid transparent'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                      <span style={{fontFamily:'var(--sans)',fontWeight:800,fontSize:14,color:isATM?'var(--atm)':'var(--text)'}}>${strike.toLocaleString()}{isATM&&<span style={{fontSize:9,marginLeft:5,opacity:.7}}>ATM</span>}</span>
                      <div style={{display:'flex',gap:14,fontSize:11}}>
                        <span style={{color:'var(--call)'}}>C: {fmt(call?.mark_iv)}%</span>
                        <span style={{color:'var(--put)'}}>P: {fmt(put?.mark_iv)}%</span>
                      </div>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)'}}>
                      <span>OI: <span style={{color:'var(--call)'}}>{fmtK(call?.open_interest)}</span> / <span style={{color:'var(--put)'}}>{fmtK(put?.open_interest)}</span></span>
                      <span>delta: <span style={{color:'var(--call)'}}>{fmt(call?.greeks?.delta)}</span> / <span style={{color:'var(--put)'}}>{fmt(put?.greeks?.delta)}</span></span>
                    </div>
                  </div>
                )
              })}
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
