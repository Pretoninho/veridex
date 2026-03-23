import { useState } from 'react'
import { getSpot, getFutures, getFuturePrice, getATMIV, getInstruments, getOrderBook, getAllExpiries, getFundingRate } from '../../utils/api.js'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js'
import { calcDIRateSimple, calcTermStructureSignal } from '../../core/market_structure/term_structure.js'
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

function daysUntil(ts) {
  return Math.max(1, Math.round((ts - Date.now()) / 86400000))
}

function fmtTs(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'2-digit' }).toUpperCase()
}

export default function TermPage() {
  const [asset, setAsset] = useState('BTC')
  const [rows, setRows] = useState([])
  const [spot, setSpot] = useState(null)
  const [signal, setSignal] = useState(null)
  const [funding, setFunding] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('basis')

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [sp, futures, fundingData, instruments] = await Promise.all([
        getSpot(asset),
        getFutures(asset),
        getFundingRate(asset).catch(() => null),
        getInstruments(asset),
      ])
      setSpot(sp)
      setFunding(fundingData)

      // Expiries options pour croiser avec futures
      const expiries = getAllExpiries(instruments)

      // Charger basis par futures
      const rowData = []
      for (const f of futures) {
        try {
          const price = await getFuturePrice(f.instrument_name)
          if (!price) continue
          const isPerp = f.instrument_name.includes('PERPETUAL')
          const days = isPerp ? null : daysUntil(f.expiration_timestamp)
          const basisBrut = (price - sp) / sp * 100
          const basisAnn = isPerp ? null : basisBrut / days * 365

          // Trouver l'IV ATM pour cette échéance si elle existe dans options
          let iv = null
          if (!isPerp) {
            const matchingExpiry = expiries.find(ts => {
              const d = new Date(ts)
              const fd = new Date(f.expiration_timestamp)
              return d.getFullYear() === fd.getFullYear() &&
                     d.getMonth() === fd.getMonth() &&
                     d.getDate() === fd.getDate()
            })
            if (matchingExpiry) {
              const forExp = instruments.filter(i => i.expiration_timestamp === matchingExpiry)
              const strikes = [...new Set(forExp.map(i => i.strike))]
              if (strikes.length) {
                const atmS = strikes.reduce((p,c) => Math.abs(c-sp) < Math.abs(p-sp) ? c : p)
                const callInst = forExp.find(x => x.option_type==='call' && x.strike===atmS)
                const putInst  = forExp.find(x => x.option_type==='put'  && x.strike===atmS)
                const [cb, pb] = await Promise.all([
                  callInst ? getOrderBook(callInst.instrument_name).catch(()=>null) : Promise.resolve(null),
                  putInst  ? getOrderBook(putInst.instrument_name).catch(()=>null)  : Promise.resolve(null),
                ])
                const cIV = cb?.mark_iv ?? null
                const pIV = pb?.mark_iv ?? null
                iv = cIV != null && pIV != null ? (cIV+pIV)/2 : cIV ?? pIV
              }
            }
          }

          const diRate = calcDIRateSimple(iv, days)
          rowData.push({
            instrument: f.instrument_name,
            expiry: isPerp ? 'PERP' : fmtTs(f.expiration_timestamp),
            days, price, basisBrut, basisAnn, isPerp, iv, diRate,
          })
        } catch(_) {}
      }
      rowData.sort((a,b) => (a.days||9999) - (b.days||9999))
      setRows(rowData)

      // Signal global
      const dated = rowData.filter(r => !r.isPerp && r.basisAnn != null)
      if (dated.length) {
        const avg = dated.reduce((s,r)=>s+r.basisAnn,0)/dated.length
        const max = Math.max(...dated.map(r=>r.basisAnn))
        const fundingAnn = fundingData?.avgAnn7d ?? 0
        const structure = avg > 0.5 ? 'contango' : avg < -0.5 ? 'backwardation' : 'flat'
        const { signal: diSignal, color: diColor, reason: diReason } =
          calcTermStructureSignal({ avgBasisAnn: avg, structure }, fundingAnn)
        setSignal({ label: structure === 'contango' ? 'Contango' : structure === 'backwardation' ? 'Backwardation' : 'Flat', avg, max, count: dated.length, diSignal, diColor, diReason, fundingAnn })
      }
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  const dated = rows.filter(r => !r.isPerp)
  const chartData = {
    labels: dated.map(r => r.expiry),
    datasets: [{
      data: dated.map(r => r.basisAnn?.toFixed(3)),
      backgroundColor: dated.map(r => r.basisAnn >= 0 ? 'rgba(0,229,160,.8)' : 'rgba(255,77,109,.8)'),
      borderRadius: 4,
    }]
  }
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend:{display:false}, tooltip:{ backgroundColor:'#0d1520', borderColor:'#1e3a5f', borderWidth:1, callbacks:{ label: ctx=>(ctx.parsed.y>0?'+':'')+ctx.parsed.y+'% ann.' } } },
    scales: {
      x: { ticks:{color:'#6a8aaa',font:{size:9}}, grid:{color:'rgba(30,58,95,.3)'} },
      y: { ticks:{color:'#6a8aaa',font:{size:9},callback:v=>(v>0?'+':'')+v+'%'}, grid:{color:'rgba(30,58,95,.3)'} }
    }
  }

  const cls2color = { Contango:'var(--call)', Backwardation:'var(--put)', Flat:'var(--accent2)' }

  // Meilleure échéance DI = max diRate + basis
  const bestDI = dated.filter(r => r.diRate && r.basisAnn).reduce((best, r) => {
    const score = r.diRate + Math.abs(r.basisAnn)
    const bestScore = best ? best.diRate + Math.abs(best.basisAnn) : 0
    return score > bestScore ? r : best
  }, null)

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-title">Term <span>Structure</span></div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {spot && <span style={{ fontSize:12, color:'var(--atm)', fontFamily:'var(--sans)', fontWeight:800 }}>${spot.toLocaleString('en-US',{maximumFractionDigits:0})}</span>}
          <button className={`icon-btn${loading?' loading':''}`} onClick={load}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            Charger
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:12 }}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => { setAsset('BTC'); setRows([]); setSignal(null); setFunding(null) }}>₿ BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => { setAsset('ETH'); setRows([]); setSignal(null); setFunding(null) }}>Ξ ETH</button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['basis','Basis'],['di','Stratégie DI']].map(([id,label]) => (
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

      {/* ── TAB BASIS ── */}
      {activeTab === 'basis' && (
        <>
          {signal && (
            <div className="stats-grid">
              <div className="stat-card" style={{ borderColor: signal.label==='Contango'?'rgba(0,229,160,.3)':signal.label==='Backwardation'?'rgba(255,77,109,.3)':'rgba(255,107,53,.3)' }}>
                <div className="stat-label">Structure</div>
                <div className="stat-value" style={{ color:cls2color[signal.label] }}>{signal.label}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Basis moy. ann.</div>
                <div className="stat-value" style={{ color:signal.avg>0?'var(--call)':signal.avg<0?'var(--put)':'var(--accent2)' }}>
                  {signal.avg>0?'+':''}{signal.avg.toFixed(2)}%
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Funding 7j ann.</div>
                <div className="stat-value" style={{ color:signal.fundingAnn>0?'var(--call)':signal.fundingAnn<0?'var(--put)':'var(--accent2)' }}>
                  {signal.fundingAnn>0?'+':''}{signal.fundingAnn?.toFixed(2)}%
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Futures actifs</div>
                <div className="stat-value">{signal.count}</div>
              </div>
            </div>
          )}

          {dated.length > 0 && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">Basis annualisé par expiration</div>
              <div style={{ padding:'4px 8px 16px', height:200 }}>
                <Bar data={chartData} options={chartOptions} />
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div className="card">
              <div className="card-header">Détail par expiration</div>
              {rows.map(r => (
                <div key={r.instrument} style={{ padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)', display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
                  <div>
                    <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:12, color:'var(--text)' }}>{r.instrument}</div>
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
                      {r.expiry} {r.days ? `· ${r.days}j` : ''}
                      {r.iv ? <span style={{ marginLeft:8, color:'var(--accent)' }}>IV: {r.iv.toFixed(1)}%</span> : ''}
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    {r.basisAnn != null ? (
                      <div style={{ fontFamily:'var(--sans)', fontWeight:700, fontSize:13, color:r.basisAnn>0.5?'var(--call)':r.basisAnn<-0.5?'var(--put)':'var(--accent2)' }}>
                        {r.basisAnn>0?'+':''}{r.basisAnn.toFixed(2)}%
                      </div>
                    ) : <div style={{ fontSize:11, color:'var(--text-muted)' }}>Funding</div>}
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                      {r.basisAnn==null?'':r.basisAnn>0.5?'Contango':r.basisAnn<-0.5?'Backwardation':'Flat'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && rows.length === 0 && !error && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Prêt à charger</h3><p>Appuyez sur Charger</p></div>
          )}
        </>
      )}

      {/* ── TAB STRATÉGIE DI ── */}
      {activeTab === 'di' && (
        <div className="fade-in">
          {!signal && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Charger d'abord</h3><p>Appuyez sur Charger pour analyser la structure</p></div>
          )}

          {signal && (
            <>
              {/* Signal principal */}
              <div className="card" style={{ marginBottom:12, borderColor: signal.diColor==='var(--call)'?'rgba(0,229,160,.3)':'rgba(255,215,0,.3)' }}>
                <div className="card-header" style={{ color: signal.diColor }}>Signal DI — Basis + Funding</div>
                <div style={{ padding:'14px 16px' }}>
                  <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color: signal.diColor, marginBottom:8 }}>
                    {signal.diSignal}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-dim)', lineHeight:1.8 }}>{signal.diReason}</div>
                </div>
              </div>

              {/* Explication de la stratégie */}
              <div className="card" style={{ marginBottom:12 }}>
                <div className="card-header">Comment ça marche</div>
                <div style={{ padding:'14px 16px', fontSize:12, color:'var(--text-dim)', lineHeight:1.9 }}>
                  {signal.label === 'Contango' ? (
                    <>
                      <div style={{ marginBottom:10 }}>
                        <span style={{ color:'var(--call)', fontWeight:700 }}>Leg 1 — Sell High DI</span><br/>
                        Tu engages ton BTC · Tu vises à vendre au strike<br/>
                        Si non exercé → tu récupères ton BTC + prime ✓<br/>
                        Si exercé → tu vends au strike (au-dessus du spot) ✓
                      </div>
                      <div style={{ marginBottom:10 }}>
                        <span style={{ color:'var(--accent)', fontWeight:700 }}>Leg 2 — Short Perp (hedge)</span><br/>
                        Tu shortes le perp pour hedger ton delta<br/>
                        En contango → tu <strong style={{ color:'var(--call)' }}>reçois</strong> le funding ✓<br/>
                        Si BTC baisse → ton short perp compense ✓
                      </div>
                      <div style={{ background:'rgba(0,229,160,.06)', borderRadius:8, padding:'10px 12px', fontSize:11 }}>
                        💡 En contango, Sell High + Short Perp est la combinaison optimale — tu encaisses la prime DI ET le funding simultanément.
                      </div>
                    </>
                  ) : signal.label === 'Backwardation' ? (
                    <>
                      <div style={{ marginBottom:10 }}>
                        <span style={{ color:'var(--call)', fontWeight:700 }}>Leg 1 — Buy Low DI</span><br/>
                        Tu engages tes USDC · Tu vises à acheter au strike<br/>
                        Si non exercé → tu récupères tes USDC + prime ✓<br/>
                        Si exercé → tu achètes BTC sous le spot ✓
                      </div>
                      <div style={{ marginBottom:10 }}>
                        <span style={{ color:'var(--accent)', fontWeight:700 }}>Leg 2 — Long Perp (hedge)</span><br/>
                        Tu longes le perp pour hedger ton delta<br/>
                        En backwardation → tu <strong style={{ color:'var(--call)' }}>reçois</strong> le funding ✓<br/>
                        Si BTC monte → ton long perp compense ✓
                      </div>
                      <div style={{ background:'rgba(0,229,160,.06)', borderRadius:8, padding:'10px 12px', fontSize:11 }}>
                        💡 En backwardation, Buy Low + Long Perp est la combinaison optimale — tu encaisses la prime DI ET le funding simultanément.
                      </div>
                    </>
                  ) : (
                    <div style={{ color:'var(--text-muted)' }}>
                      Le marché est plat — pas de signal fort. Attends un contango ou backwardation plus marqué pour une stratégie combinée optimale.
                    </div>
                  )}
                </div>
              </div>

              {/* Tableau comparatif par échéance */}
              {dated.filter(r => r.iv && r.diRate).length > 0 && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">
                    <span>Comparatif par échéance</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>Prime DI + Basis</span>
                  </div>
                  <div style={{ padding:'8px 14px 4px', fontSize:9, color:'var(--text-muted)', display:'grid', gridTemplateColumns:'1fr 50px 60px 60px 70px', gap:4, textTransform:'uppercase', letterSpacing:'.5px' }}>
                    <span>Échéance</span>
                    <span style={{ textAlign:'center' }}>Jours</span>
                    <span style={{ textAlign:'right' }}>Basis</span>
                    <span style={{ textAlign:'right' }}>Taux DI</span>
                    <span style={{ textAlign:'right' }}>Total</span>
                  </div>
                  {dated.filter(r => r.iv && r.diRate).map(r => {
                    const total = r.diRate + Math.abs(r.basisAnn ?? 0)
                    const isBest = bestDI?.instrument === r.instrument
                    return (
                      <div key={r.instrument} style={{
                        padding:'10px 14px', borderBottom:'1px solid rgba(30,58,95,.3)',
                        display:'grid', gridTemplateColumns:'1fr 50px 60px 60px 70px', gap:4, alignItems:'center',
                        background: isBest ? 'rgba(255,215,0,.04)' : undefined,
                        borderLeft: isBest ? '2px solid var(--atm)' : '2px solid transparent',
                      }}>
                        <div>
                          <div style={{ fontFamily:'var(--sans)', fontWeight: isBest?800:600, fontSize:12, color: isBest?'var(--atm)':'var(--text)' }}>
                            {r.expiry}
                            {isBest && <span style={{ fontSize:9, marginLeft:4 }}>🏆</span>}
                          </div>
                          <div style={{ fontSize:9, color:'var(--text-muted)' }}>IV {r.iv?.toFixed(1)}%</div>
                        </div>
                        <div style={{ textAlign:'center', fontSize:11, color:'var(--text-muted)' }}>{r.days}</div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:11, fontWeight:700, color: r.basisAnn>0?'var(--call)':'var(--put)' }}>
                            {r.basisAnn>0?'+':''}{r.basisAnn?.toFixed(2)}%
                          </div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--accent)' }}>{r.diRate?.toFixed(2)}%</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:12, fontWeight:800, color: isBest?'var(--atm)':'var(--text)' }}>{total.toFixed(2)}%</div>
                          <div style={{ fontSize:9, color:'var(--text-muted)' }}>/an</div>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ padding:'10px 14px', fontSize:10, color:'var(--text-muted)', lineHeight:1.7 }}>
                    🏆 Meilleure échéance = Taux DI + |Basis| · Total = rendement combiné théorique avec hedge perp
                  </div>
                </div>
              )}

              {/* Calcul funding net */}
              {funding && (
                <div className="card">
                  <div className="card-header">Funding Perp — Impact sur la stratégie</div>
                  <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div>
                      <div className="stat-label">Funding actuel ann.</div>
                      <div className="stat-value" style={{ color: funding.current > 0 ? 'var(--call)' : 'var(--put)' }}>
                        {funding.current != null ? (funding.current>0?'+':'') + funding.current.toFixed(2)+'%' : '—'}
                      </div>
                      <div className="stat-sub">
                        {signal.label==='Contango'
                          ? funding.current > 0 ? '✓ Reçu en short perp' : '✗ Payé en short perp'
                          : funding.current < 0 ? '✓ Reçu en long perp' : '✗ Payé en long perp'}
                      </div>
                    </div>
                    <div>
                      <div className="stat-label">Moy. 7j ann.</div>
                      <div className="stat-value" style={{ color: funding.avgAnn7d > 0 ? 'var(--call)' : 'var(--put)' }}>
                        {funding.avgAnn7d != null ? (funding.avgAnn7d>0?'+':'') + funding.avgAnn7d.toFixed(2)+'%' : '—'}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding:'0 16px 12px', fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                    {signal.label==='Contango' && funding.current > 0
                      ? `✓ Contexte idéal — Short perp en contango = tu reçois ${funding.current.toFixed(2)}% ann. de funding en plus de ta prime DI`
                      : signal.label==='Backwardation' && funding.current < 0
                      ? `✓ Contexte idéal — Long perp en backwardation = tu reçois ${Math.abs(funding.current).toFixed(2)}% ann. de funding en plus de ta prime DI`
                      : `⚠ Le funding va dans le sens opposé à ton hedge — réduit le rendement net de la stratégie`}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
