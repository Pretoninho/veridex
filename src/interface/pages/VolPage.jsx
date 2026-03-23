import { useState } from 'react'
import { getDVOL, getSpot, getInstruments, getOrderBook } from '../../utils/api.js'
import { analyzeIV } from '../../core/volatility/iv_rank.js'
import { calcSkew25d, interpretSkew, calcSmile } from '../../core/volatility/skew.js'
import { calcOptionGreeks } from '../utils/greeks.js'

export default function VolPage() {
  const [asset, setAsset] = useState('BTC')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ivData, setIvData] = useState(null)
  const [skewData, setSkewData] = useState(null)
  const [greeksData, setGreeksData] = useState(null)
  const [spot, setSpot] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [dvol, sp, instruments] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getSpot(asset).catch(() => null),
        getInstruments(asset).catch(() => []),
      ])

      setSpot(sp)

      // ── IV Analysis ──
      const iv = analyzeIV(dvol)
      setIvData({ dvol, ...iv })

      // ── Skew 25-delta ──
      const now = Date.now()
      const expiries = [...new Set(
        instruments.map(i => i.expiration_timestamp).filter(ts => ts > now)
      )].sort((a, b) => a - b)

      let skewResult = null
      let greeksResult = null

      if (expiries.length && sp) {
        // Prefer expiry > 3 days (enough time for meaningful skew)
        const frontTs = expiries.find(ts => (ts - now) > 3 * 86400000) ?? expiries[0]
        const frontInstr = instruments.filter(i => i.expiration_timestamp === frontTs)
        const strikes = [...new Set(frontInstr.map(i => i.strike))].sort((a, b) => a - b)

        if (strikes.length) {
          const atmStrike = strikes.reduce((p, c) => Math.abs(c - sp) < Math.abs(p - sp) ? c : p)
          const days = Math.max(0.5, (frontTs - now) / 86400000)
          const expLabel = new Date(frontTs).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).toUpperCase()

          // ATM options
          const callAtm = frontInstr.find(i => i.option_type === 'call' && i.strike === atmStrike)
          const putAtm  = frontInstr.find(i => i.option_type === 'put'  && i.strike === atmStrike)

          // OTM candidates for 25-delta (6 each side closest to ATM)
          const otmCallInstr = strikes.filter(k => k > atmStrike).slice(0, 6)
            .map(k => frontInstr.find(i => i.option_type === 'call' && i.strike === k)).filter(Boolean)
          const otmPutInstr  = strikes.filter(k => k < atmStrike).reverse().slice(0, 6)
            .map(k => frontInstr.find(i => i.option_type === 'put'  && i.strike === k)).filter(Boolean)

          // Fetch in parallel
          const [atmBooks, callBooks, putBooks] = await Promise.all([
            Promise.all([
              callAtm ? getOrderBook(callAtm.instrument_name).catch(() => null) : Promise.resolve(null),
              putAtm  ? getOrderBook(putAtm.instrument_name).catch(() => null)  : Promise.resolve(null),
            ]),
            Promise.all(otmCallInstr.map(i => getOrderBook(i.instrument_name).catch(() => null))),
            Promise.all(otmPutInstr.map(i => getOrderBook(i.instrument_name).catch(() => null))),
          ])

          const [atmCallBook, atmPutBook] = atmBooks
          const atmIV = (atmCallBook?.mark_iv != null && atmPutBook?.mark_iv != null)
            ? (atmCallBook.mark_iv + atmPutBook.mark_iv) / 2
            : atmCallBook?.mark_iv ?? atmPutBook?.mark_iv ?? null

          // Find closest to delta ±0.25
          const callsWithDelta = otmCallInstr.map((instr, i) => ({
            strike: instr.strike,
            delta: callBooks[i]?.greeks?.delta ?? null,
            iv: callBooks[i]?.mark_iv ?? null,
          })).filter(c => c.delta != null && c.iv != null)

          const putsWithDelta = otmPutInstr.map((instr, i) => ({
            strike: instr.strike,
            delta: putBooks[i]?.greeks?.delta ?? null,
            iv: putBooks[i]?.mark_iv ?? null,
          })).filter(p => p.delta != null && p.iv != null)

          const call25d = callsWithDelta.length
            ? callsWithDelta.reduce((best, c) => Math.abs(c.delta - 0.25) < Math.abs(best.delta - 0.25) ? c : best)
            : null
          const put25d = putsWithDelta.length
            ? putsWithDelta.reduce((best, p) => Math.abs(p.delta - (-0.25)) < Math.abs(best.delta - (-0.25)) ? p : best)
            : null

          const skewCalc  = call25d && put25d ? calcSkew25d(call25d.iv, put25d.iv) : null
          const skewInterp = skewCalc ? interpretSkew(skewCalc.skew) : null

          // Smile: furthest OTM call vs ATM
          const furthestCall = callsWithDelta[callsWithDelta.length - 1]
          const smileVal = furthestCall && atmIV != null ? calcSmile(atmIV, furthestCall.iv) : null

          skewResult = {
            call25d, put25d, skew: skewCalc, interpretation: skewInterp,
            atmIV, smile: smileVal, expiry: expLabel, days: Math.round(days),
          }

          // Greeks ATM (call synthétique)
          if (atmIV && sp) {
            const T = days / 365
            const sigma = atmIV / 100
            const greeks = calcOptionGreeks({ type: 'call', S: sp, K: atmStrike, T, sigma, r: 0 })
            greeksResult = {
              strike: atmStrike, days: Math.round(days), expiry: expLabel,
              atmIV, ...greeks,
            }
          }
        }
      }

      setSkewData(skewResult)
      setGreeksData(greeksResult)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const switchAsset = (a) => {
    setAsset(a)
    setIvData(null)
    setSkewData(null)
    setGreeksData(null)
    setSpot(null)
    setError(null)
  }

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-title">Volatilité <span>IV</span></div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {spot && (
            <span style={{ fontSize:12, color:'var(--atm)', fontFamily:'var(--sans)', fontWeight:800 }}>
              ${spot.toLocaleString('en-US', { maximumFractionDigits:0 })}
            </span>
          )}
          <button className={`icon-btn${loading ? ' loading' : ''}`} onClick={load}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            Charger
          </button>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:16 }}>
        <button className={`asset-btn${asset === 'BTC' ? ' active-btc' : ''}`} onClick={() => switchAsset('BTC')}>₿ BTC</button>
        <button className={`asset-btn${asset === 'ETH' ? ' active-eth' : ''}`} onClick={() => switchAsset('ETH')}>Ξ ETH</button>
      </div>

      {error && <div className="error-box">⚠ {error}</div>}

      {!loading && !ivData && !error && (
        <div className="empty-state">
          <div className="empty-icon">◇</div>
          <h3>Prêt à analyser</h3>
          <p>Appuyez sur Charger pour obtenir l'analyse complète</p>
        </div>
      )}

      {loading && !ivData && (
        <div className="card">
          <div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Chargement…</div>
        </div>
      )}

      {ivData && (
        <div className="fade-in">

          {/* ── Section 1 : IV Analysis ── */}
          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header">
              <span>Analyse IV — DVOL {asset}</span>
              {ivData.spike?.isSpike && (
                <span style={{ fontSize:10, fontWeight:700, color:'var(--call)', background:'rgba(0,229,160,.1)', padding:'2px 8px', borderRadius:20, border:'1px solid rgba(0,229,160,.3)' }}>
                  ⚡ SPIKE
                </span>
              )}
            </div>
            <div style={{ padding:'14px 16px' }}>

              {/* IVR gauge */}
              {ivData.ivRank != null && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--sans)', fontWeight:700 }}>
                      IV Rank (30j)
                    </span>
                    <span style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:15, color:ivData.interpretation?.color }}>
                      {ivData.ivRank}/100 — {ivData.interpretation?.label}
                    </span>
                  </div>
                  <div style={{ height:8, background:'rgba(255,255,255,.06)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${ivData.ivRank}%`, background:ivData.interpretation?.color, borderRadius:4, transition:'width .8s ease' }} />
                  </div>
                </div>
              )}

              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">DVOL actuel</div>
                  <div className="stat-value" style={{ color:ivData.interpretation?.color }}>
                    {ivData.dvol?.current?.toFixed(1) ?? '—'}%
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">IVP (percentile)</div>
                  <div className="stat-value" style={{ color: ivData.ivPercentile > 70 ? 'var(--call)' : ivData.ivPercentile > 40 ? 'var(--atm)' : 'var(--put)' }}>
                    {ivData.ivPercentile != null ? ivData.ivPercentile + '%' : '—'}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Min 30j</div>
                  <div className="stat-value">{ivData.dvol?.monthMin?.toFixed(1) ?? '—'}%</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Max 30j</div>
                  <div className="stat-value">{ivData.dvol?.monthMax?.toFixed(1) ?? '—'}%</div>
                </div>
              </div>

              {/* Spike info */}
              {ivData.spike && (
                <div style={{
                  marginTop:12, padding:'10px 12px', borderRadius:8,
                  background: ivData.spike.isSpike ? 'rgba(0,229,160,.06)' : 'rgba(255,255,255,.03)',
                  border: `1px solid ${ivData.spike.isSpike ? 'rgba(0,229,160,.2)' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize:11, color:'var(--text-dim)', lineHeight:1.8 }}>
                    {ivData.spike.isSpike ? (
                      <>⚡ <strong style={{ color:'var(--call)' }}>Spike détecté</strong> — IV {ivData.dvol?.current?.toFixed(1)}% vs moy {ivData.spike.avg?.toFixed(1)}% (+{ivData.spike.deviation?.toFixed(1)} pts · +{ivData.spike.deviationPct?.toFixed(0)}%)</>
                    ) : (
                      <>Pas de spike — IV {ivData.dvol?.current?.toFixed(1)}% vs moy {ivData.spike.avg?.toFixed(1)}% ({ivData.spike.deviation > 0 ? '+' : ''}{ivData.spike.deviation?.toFixed(1)} pts)</>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 2 : Skew 25-delta ── */}
          {skewData ? (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">
                <span>Skew 25-delta</span>
                <span style={{ fontSize:10, color:'var(--text-muted)' }}>{skewData.expiry} · {skewData.days}j</span>
              </div>
              <div style={{ padding:'14px 16px' }}>
                {skewData.skew ? (
                  <>
                    <div style={{ textAlign:'center', marginBottom:16, padding:'16px 0' }}>
                      <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:40, color:skewData.interpretation?.color, lineHeight:1 }}>
                        {skewData.skew.skew > 0 ? '+' : ''}{skewData.skew.skew.toFixed(2)}%
                      </div>
                      <div style={{ fontSize:13, color:skewData.interpretation?.color, marginTop:8, fontWeight:700 }}>
                        {skewData.interpretation?.sentiment}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                        {skewData.skew.label}
                      </div>
                    </div>

                    <div className="stats-grid">
                      {skewData.call25d && (
                        <div className="stat-card" style={{ borderColor:'rgba(0,229,160,.2)' }}>
                          <div className="stat-label">Call 25D · Δ{skewData.call25d.delta?.toFixed(2)}</div>
                          <div className="stat-value" style={{ color:'var(--call)' }}>{skewData.call25d.iv?.toFixed(1)}%</div>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>K: {skewData.call25d.strike?.toLocaleString()}</div>
                        </div>
                      )}
                      {skewData.put25d && (
                        <div className="stat-card" style={{ borderColor:'rgba(255,77,109,.2)' }}>
                          <div className="stat-label">Put 25D · Δ{skewData.put25d.delta?.toFixed(2)}</div>
                          <div className="stat-value" style={{ color:'var(--put)' }}>{skewData.put25d.iv?.toFixed(1)}%</div>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>K: {skewData.put25d.strike?.toLocaleString()}</div>
                        </div>
                      )}
                      {skewData.atmIV != null && (
                        <div className="stat-card">
                          <div className="stat-label">IV ATM</div>
                          <div className="stat-value" style={{ color:'var(--atm)' }}>{skewData.atmIV?.toFixed(1)}%</div>
                        </div>
                      )}
                      {skewData.smile != null && (
                        <div className="stat-card">
                          <div className="stat-label">Smile (wing−ATM)</div>
                          <div className="stat-value" style={{ color: skewData.smile > 2 ? 'var(--accent)' : 'var(--text-dim)' }}>
                            {skewData.smile > 0 ? '+' : ''}{skewData.smile?.toFixed(1)}%
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(255,255,255,.03)', borderRadius:8, fontSize:11, color:'var(--text-muted)', lineHeight:1.8 }}>
                      💡 Skew &gt; 0 = calls plus chers que puts (FOMO) · Skew &lt; 0 = puts plus chers (protection)
                    </div>
                  </>
                ) : (
                  <div style={{ padding:'12px 0', color:'var(--text-muted)', fontSize:12 }}>
                    Données 25-delta insuffisantes pour cet actif
                  </div>
                )}
              </div>
            </div>
          ) : loading ? null : (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">Skew 25-delta</div>
              <div style={{ padding:'12px 16px', color:'var(--text-muted)', fontSize:12 }}>Non disponible</div>
            </div>
          )}

          {/* ── Section 3 : Greeks ATM ── */}
          {greeksData && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">
                <span>Greeks ATM — Call</span>
                <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                  {greeksData.expiry} · K {greeksData.strike?.toLocaleString()}
                </span>
              </div>
              <div style={{ padding:'14px 16px' }}>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-label">Delta (Δ)</div>
                    <div className="stat-value" style={{ color:'var(--accent)' }}>
                      {greeksData.delta?.toFixed(3) ?? '—'}
                    </div>
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>Sensibilité prix</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Gamma (Γ)</div>
                    <div className="stat-value" style={{ color:'var(--atm)' }}>
                      {greeksData.gamma?.toFixed(5) ?? '—'}
                    </div>
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>Accél. delta</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Theta (Θ)</div>
                    <div className="stat-value" style={{ color:'var(--put)' }}>
                      {greeksData.theta?.toFixed(2) ?? '—'}
                    </div>
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>Décroissance/j</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Vega (ν)</div>
                    <div className="stat-value" style={{ color:'var(--call)' }}>
                      {greeksData.vega?.toFixed(3) ?? '—'}
                    </div>
                    <div style={{ fontSize:10, color:'var(--text-muted)' }}>Sensibilité IV</div>
                  </div>
                </div>
                <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>
                  IV ATM : <strong style={{ color:'var(--atm)' }}>{greeksData.atmIV?.toFixed(1)}%</strong> · {greeksData.days}j à expiration
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
