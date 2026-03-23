import { useState, useEffect, useRef } from 'react'
import { getATMIV, getDVOL, getFundingRate, getOpenInterest, getRealizedVol, getSpot, getInstruments } from '../../utils/api.js'
import { deribitWs, createBatchProcessor } from '../../utils/deribitWs.js'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const MAX_POINTS = 200
const MIN_POINT_INTERVAL_MS = 1000
const LS_KEY = 'iv_tracker_history'

function fmtD(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
}

function pickFrontAtmInstruments(spot, instruments) {
  if (!spot || !instruments?.length) return null
  const now = Date.now()
  const expiries = [...new Set(instruments.map(i => i.expiration_timestamp).filter(ts => ts > now))].sort((a, b) => a - b)
  if (!expiries.length) return null
  const frontTs = expiries[0]
  const frontInstruments = instruments.filter(i => i.expiration_timestamp === frontTs)
  const strikes = [...new Set(frontInstruments.map(i => i.strike))].sort((a, b) => a - b)
  if (!strikes.length) return null
  const atmStrike = strikes.reduce((prev, curr) => (Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev), strikes[0])
  const callInstrument = frontInstruments.find(i => i.option_type === 'call' && i.strike === atmStrike)?.instrument_name
  const putInstrument = frontInstruments.find(i => i.option_type === 'put' && i.strike === atmStrike)?.instrument_name
  if (!callInstrument || !putInstrument) return null
  return { atmStrike, callInstrument, putInstrument }
}

export default function TrackerPage() {
  const [asset, setAsset] = useState('BTC')
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY + '_BTC') || '[]') } catch { return [] }
  })
  const [running, setRunning] = useState(false)
  const [intervalSec, setIntervalSec] = useState(30)
  const [countdown, setCountdown] = useState(0)
  const [alertThreshold, setAlertThreshold] = useState(() => parseFloat(localStorage.getItem('iv_alert_threshold') || '0'))
  const [alertTriggered, setAlertTriggered] = useState(false)
  const [showAlertConfig, setShowAlertConfig] = useState(false)
  const [context, setContext] = useState(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('tracker')
  const [wsStatus, setWsStatus] = useState('stopped')
  const timerRef = useRef(null)
  const countRef = useRef(null)
  const streamUnsubRef = useRef([])
  const batchRef = useRef(null)
  const bufferRef = useRef({ spot: null, callIV: null, putIV: null, atmStrike: null })
  const lastPushRef = useRef(0)

  const stopStream = () => {
    streamUnsubRef.current.forEach(unsub => {
      try { unsub() } catch (_) {}
    })
    streamUnsubRef.current = []
    if (batchRef.current) {
      batchRef.current.dispose()
      batchRef.current = null
    }
    bufferRef.current = { spot: null, callIV: null, putIV: null, atmStrike: null }
  }

  const pushPoint = ({ spot, iv, atmStrike }) => {
    if (!Number.isFinite(spot) || !Number.isFinite(iv)) return
    const now = Date.now()
    if (now - lastPushRef.current < MIN_POINT_INTERVAL_MS) return
    lastPushRef.current = now

    const point = { timestamp: new Date(now).toISOString(), spot, iv, atmStrike }
    setHistory(prev => {
      const next = [...prev, point].slice(-MAX_POINTS)
      saveHistory(next, asset)
      if (alertThreshold > 0 && iv >= alertThreshold) setAlertTriggered(true)
      return next
    })
  }

  const startStream = async (a) => {
    stopStream()
    setWsStatus('connecting')

    try {
      const [spotNow, instruments] = await Promise.all([
        getSpot(a).catch(() => null),
        getInstruments(a).catch(() => []),
      ])
      const target = pickFrontAtmInstruments(spotNow, instruments)
      if (!target) {
        setWsStatus('fallback-rest')
        return
      }

      const { atmStrike, callInstrument, putInstrument } = target
      bufferRef.current = { spot: spotNow, callIV: null, putIV: null, atmStrike }

      batchRef.current = createBatchProcessor((batch) => {
        const next = { ...bufferRef.current }
        batch.forEach(({ data, channel }) => {
          if (channel.startsWith('ticker.')) {
            next.spot = data?.mark_price ?? data?.last_price ?? next.spot
            return
          }
          if (!channel.startsWith('book.')) return
          const channelParts = channel.split('.')
          const instrumentName = channelParts[1]
          if (instrumentName === callInstrument) next.callIV = data?.mark_iv ?? next.callIV
          if (instrumentName === putInstrument) next.putIV = data?.mark_iv ?? next.putIV
        })

        bufferRef.current = next
        const iv = (Number.isFinite(next.callIV) && Number.isFinite(next.putIV))
          ? (next.callIV + next.putIV) / 2
          : (next.callIV ?? next.putIV)

        if (Number.isFinite(iv) && Number.isFinite(next.spot)) {
          pushPoint({ spot: next.spot, iv, atmStrike: next.atmStrike })
        }
      }, 150)

      const channels = [
        `ticker.${a}-PERPETUAL.100ms`,
        `book.${callInstrument}.100ms`,
        `book.${putInstrument}.100ms`,
      ]

      const unsub = deribitWs.subscribe(channels, (data, channel) => {
        batchRef.current?.push({ data, channel })
      })
      streamUnsubRef.current = [unsub]
      setWsStatus('connected')
    } catch (_) {
      setWsStatus('fallback-rest')
    }
  }

  const saveHistory = (h, a) => localStorage.setItem(LS_KEY + '_' + a, JSON.stringify(h.slice(-MAX_POINTS)))

  const fetchAndRecord = async (a) => {
    try {
      const data = await getATMIV(a)
      const point = { timestamp: new Date().toISOString(), ...data }
      setHistory(prev => {
        const next = [...prev, point].slice(-MAX_POINTS)
        saveHistory(next, a)
        if (alertThreshold > 0 && data.iv >= alertThreshold) setAlertTriggered(true)
        return next
      })
    } catch(e) { console.warn('Tracker error:', e.message) }
  }

  const loadContext = async (a) => {
    setContextLoading(true)
    try {
      const [dvol, funding, oi, rv] = await Promise.all([
        getDVOL(a).catch(() => null),
        getFundingRate(a).catch(() => null),
        getOpenInterest(a).catch(() => null),
        getRealizedVol(a).catch(() => null),
      ])
      setContext({ dvol, funding, oi, rv, loadedAt: Date.now() })
    } catch(e) { console.warn('Context error:', e.message) }
    setContextLoading(false)
  }

  const start = () => {
    setRunning(true)
    setAlertTriggered(false)
    startStream(asset)
    fetchAndRecord(asset)
    timerRef.current = setInterval(() => fetchAndRecord(asset), intervalSec * 1000)
    setCountdown(intervalSec)
    countRef.current = setInterval(() => setCountdown(c => c <= 1 ? intervalSec : c - 1), 1000)
  }

  const stop = () => {
    setRunning(false)
    clearInterval(timerRef.current)
    clearInterval(countRef.current)
    timerRef.current = null
    setCountdown(0)
    stopStream()
    setWsStatus('stopped')
  }

  const switchAsset = (a) => {
    stop()
    setAsset(a)
    setAlertTriggered(false)
    setContext(null)
    try { setHistory(JSON.parse(localStorage.getItem(LS_KEY + '_' + a) || '[]')) } catch { setHistory([]) }
  }

  const saveAlert = (val) => {
    setAlertThreshold(val)
    localStorage.setItem('iv_alert_threshold', val)
    setAlertTriggered(false)
  }

  useEffect(() => () => { clearInterval(timerRef.current); clearInterval(countRef.current) }, [])

  useEffect(() => {
    const off = deribitWs.onStatus(status => {
      if (!running) return
      if (status === 'reconnecting') setWsStatus('reconnecting')
      if (status === 'connected') setWsStatus('connected')
    })
    return () => off()
  }, [running])

  useEffect(() => () => {
    clearInterval(timerRef.current)
    clearInterval(countRef.current)
    stopStream()
  }, [])

  const last      = history[history.length - 1]
  const ivs       = history.map(r => r.iv).filter(Boolean)
  const ivMin     = ivs.length ? Math.min(...ivs).toFixed(2) : '—'
  const ivMax     = ivs.length ? Math.max(...ivs).toFixed(2) : '—'
  const ivAvg     = ivs.length ? (ivs.reduce((a,b)=>a+b,0)/ivs.length).toFixed(2) : '—'
  const ivNow     = last?.iv ?? null
  const ivAvgNum  = ivs.length ? ivs.reduce((a,b)=>a+b,0)/ivs.length : null
  const isSpiking = ivNow && ivAvgNum && ivNow > ivAvgNum * 1.1

  // Signal global marché
  const getMarketSignal = () => {
    if (!context) return null
    const { dvol, funding, rv } = context
    let score = 0, reasons = []
    if (dvol) {
      if (dvol.current > dvol.weekAgo * 1.1) { score++; reasons.push('DVOL en hausse') }
      else if (dvol.current < dvol.weekAgo * 0.9) { score--; reasons.push('DVOL en baisse') }
      const pct = (dvol.current - dvol.monthMin) / (dvol.monthMax - dvol.monthMin) * 100
      if (pct > 70) { score++; reasons.push('DVOL haut du range') }
      else if (pct < 30) { score--; reasons.push('DVOL bas du range') }
    }
    if (funding) {
      if (funding.avgAnn7d > 20) { score++; reasons.push('Funding élevé (marché long)') }
      else if (funding.avgAnn7d < 0) { score--; reasons.push('Funding négatif (marché short)') }
    }
    if (rv && dvol) {
      const ivPremium = dvol.current - rv.current
      if (ivPremium > 10) { score++; reasons.push(`IV premium +${ivPremium.toFixed(1)}pts`) }
      else if (ivPremium < 0) { score--; reasons.push('IV sous RV — vol sous-pricée') }
    }
    const label = score >= 2 ? '🔥 Excellent moment DI' : score === 1 ? '✓ Bon contexte' : score === 0 ? '~ Contexte neutre' : '↓ Contexte défavorable'
    const cls   = score >= 2 ? 'var(--call)' : score === 1 ? 'var(--atm)' : score === 0 ? 'var(--accent2)' : 'var(--put)'
    return { label, cls, score, reasons }
  }

  const signal = getMarketSignal()

  const chartData = {
    labels: history.map(r => fmtD(r.timestamp)),
    datasets: [
      {
        label: 'IV ATM',
        data: history.map(r => r.iv),
        borderColor: '#ffd700',
        backgroundColor: 'rgba(255,215,0,.08)',
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3,
      },
      ...(alertThreshold > 0 ? [{
        label: 'Seuil',
        data: history.map(() => alertThreshold),
        borderColor: 'rgba(255,77,109,.6)',
        borderWidth: 1, borderDash: [4,4], pointRadius: 0, fill: false,
      }] : [])
    ]
  }

  const chartOptions = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor:'#0d1520', borderColor:'#1e3a5f', borderWidth:1, callbacks: { label: ctx => ctx.parsed.y?.toFixed(2)+'%' } }
    },
    scales: {
      x: { ticks: { color:'#3a5570', font:{ size:9 }, maxTicksLimit:6 }, grid: { color:'rgba(30,58,95,.3)' } },
      y: { ticks: { color:'#6a8aaa', font:{ size:9 }, callback: v => v.toFixed(1)+'%' }, grid: { color:'rgba(30,58,95,.3)' } }
    }
  }

  const exportCSV = () => {
    if (!history.length) return
    const fields = ['timestamp','spot','iv','atmStrike']
    const csv = [fields.join(','), ...history.map(r => fields.map(k=>r[k]??'').join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    const a = document.createElement('a')
    a.href=url; a.download=`iv_live_${asset}_${new Date().toISOString().slice(0,16).replace('T','_')}.csv`
    a.click()
  }

  const fmt2 = n => n != null ? n.toFixed(2) : '—'
  const fmtK = n => n != null ? (n >= 1000 ? (n/1000).toFixed(1)+'K' : n.toFixed(0)) : '—'

  return (
    <div className="page-wrap">

      {alertTriggered && (
        <div style={{ background:'rgba(255,77,109,.15)', border:'1px solid var(--put)', borderRadius:10, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ color:'var(--put)', fontFamily:'var(--sans)', fontWeight:800, fontSize:14 }}>🚨 IV Spike !</div>
            <div style={{ color:'var(--text-dim)', fontSize:11, marginTop:2 }}>IV {ivNow?.toFixed(2)}% ≥ seuil {alertThreshold}% — Bon moment DI</div>
          </div>
          <button onClick={() => setAlertTriggered(false)} style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>
      )}

      {isSpiking && !alertTriggered && (
        <div style={{ background:'rgba(255,215,0,.08)', border:'1px solid rgba(255,215,0,.3)', borderRadius:10, padding:'10px 16px', marginBottom:16 }}>
          <div style={{ color:'var(--atm)', fontFamily:'var(--sans)', fontWeight:700, fontSize:13 }}>⚡ IV spike — {ivNow?.toFixed(2)}% vs moy. {ivAvgNum?.toFixed(2)}%</div>
          <div style={{ color:'var(--text-muted)', fontSize:11, marginTop:2 }}>Taux DI potentiellement attractifs</div>
        </div>
      )}

      <div className="page-header">
        <div className="page-title">IV <span>Live</span></div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div className={`dot-live${running?'':' off'}`} />
          <span className="status-text">{running ? `${countdown}s · ${wsStatus}` : 'Arrêté'}</span>
        </div>
      </div>

      <div className="asset-toggle" style={{ marginBottom:12 }}>
        <button className={`asset-btn${asset==='BTC'?' active-btc':''}`} onClick={() => switchAsset('BTC')}>₿ BTC</button>
        <button className={`asset-btn${asset==='ETH'?' active-eth':''}`} onClick={() => switchAsset('ETH')}>Ξ ETH</button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', marginBottom:14, borderBottom:'1px solid var(--border)' }}>
        {[['tracker','IV Live'],['context','Contexte marché']].map(([id,label]) => (
          <button key={id} onClick={() => { setActiveTab(id); if(id==='context' && !context) loadContext(asset) }} style={{
            padding:'8px 18px', background:'none', border:'none', cursor:'pointer',
            fontFamily:'var(--sans)', fontSize:12, fontWeight:700,
            color: activeTab===id ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab===id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom:-1, transition:'all .2s'
          }}>{label}</button>
        ))}
      </div>

      {/* ── TAB IV LIVE ── */}
      {activeTab === 'tracker' && (
        <>
          <div className="controls-row">
            <select style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', padding:'7px 10px', borderRadius:8, fontSize:11, outline:'none' }}
              value={intervalSec} onChange={e => setIntervalSec(parseInt(e.target.value))}>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={300}>5min</option>
            </select>
            <button className="icon-btn"
              style={{ background:running?'rgba(255,77,109,.1)':'rgba(0,229,160,.1)', borderColor:running?'var(--put)':'var(--call)', color:running?'var(--put)':'var(--call)' }}
              onClick={running ? stop : start}>
              {running ? '⏸ Pause' : '▶ Start'}
            </button>
            <button className="icon-btn" onClick={exportCSV}>↓ CSV</button>
          </div>

          <div className="stats-grid">
            <div className="stat-card" style={isSpiking?{borderColor:'rgba(255,215,0,.4)',background:'rgba(255,215,0,.04)'}:{}}>
              <div className="stat-label">IV ATM</div>
              <div className="stat-value gold">{ivNow?.toFixed(2) ?? '—'}%</div>
              {isSpiking && <div className="stat-sub" style={{ color:'var(--atm)' }}>⚡ spike</div>}
            </div>
            <div className="stat-card">
              <div className="stat-label">Spot</div>
              <div className="stat-value blue">{last?.spot ? '$'+last.spot.toLocaleString('en-US',{maximumFractionDigits:0}) : '—'}</div>
            </div>
            <div className="stat-card"><div className="stat-label">IV Min</div><div className="stat-value green">{ivMin !== '—' ? ivMin+'%' : '—'}</div></div>
            <div className="stat-card"><div className="stat-label">IV Max</div><div className="stat-value red">{ivMax !== '—' ? ivMax+'%' : '—'}</div></div>
            <div className="stat-card"><div className="stat-label">IV Moy.</div><div className="stat-value">{ivAvg !== '—' ? ivAvg+'%' : '—'}</div></div>
            <div className="stat-card"><div className="stat-label">Points</div><div className="stat-value">{history.length}</div></div>
          </div>

          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header" style={{ cursor:'pointer' }} onClick={() => setShowAlertConfig(v => !v)}>
              <span>🔔 Alerte IV spike</span>
              <span style={{ fontSize:11, color:alertThreshold>0?'var(--call)':'var(--text-muted)' }}>
                {alertThreshold > 0 ? `Seuil : ${alertThreshold}%` : 'Non configuré'} {showAlertConfig?'▲':'▼'}
              </span>
            </div>
            {showAlertConfig && (
              <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                  Alerte quand IV ATM dépasse le seuil — signal que les taux DI sont exceptionnellement attractifs.
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input type="number" step="1" min="0" max="500" placeholder="Ex: 80"
                    defaultValue={alertThreshold||''}
                    style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', color:'var(--text)', padding:'8px 12px', borderRadius:8, fontFamily:'var(--mono)', fontSize:12, outline:'none' }}
                    onChange={e => saveAlert(parseFloat(e.target.value)||0)} />
                  <span style={{ fontSize:12, color:'var(--text-muted)' }}>%</span>
                  <button className="icon-btn" style={{ color:'var(--put)', borderColor:'rgba(255,77,109,.3)' }} onClick={() => saveAlert(0)}>OFF</button>
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {[60,70,80,90,100].map(v => (
                    <button key={v} onClick={() => saveAlert(v)} style={{
                      padding:'4px 10px', borderRadius:20, fontSize:10, cursor:'pointer',
                      border: alertThreshold===v?'1px solid var(--accent)':'1px solid var(--border)',
                      background: alertThreshold===v?'rgba(0,212,255,.1)':'transparent',
                      color: alertThreshold===v?'var(--accent)':'var(--text-muted)',
                    }}>{v}%</button>
                  ))}
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)' }}>💡 IV BTC oscille souvent entre 50-70%. Un spike &gt;80% est exceptionnel.</div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom:12 }}>
            <div className="card-header">
              <span>Flux temps réel</span>
              <span style={{ fontSize:10, color:wsStatus === 'connected' ? 'var(--call)' : 'var(--text-muted)' }}>
                {running ? wsStatus : 'inactif'}
              </span>
            </div>
            <div style={{ padding:'10px 14px', fontSize:11, color:'var(--text-muted)', lineHeight:1.6 }}>
              WebSocket singleton + heartbeat + reconnexion exponentielle. Les ticks sont regroupés et flushés toutes les 150ms pour limiter les rerenders; un snapshot REST périodique reste actif en fallback.
            </div>
          </div>

          {history.length > 1 && (
            <div className="card" style={{ marginBottom:12 }}>
              <div className="card-header">IV ATM — {asset}</div>
              <div style={{ padding:'0 4px 12px', height:180 }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          )}

          {history.length === 0 && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Aucune donnée</h3><p>Appuyez sur Start</p></div>
          )}

          {history.length > 0 && (
            <div className="card">
              <div className="card-header">
                <span>Historique</span>
                <button className="icon-btn" style={{ fontSize:10, padding:'3px 8px' }}
                  onClick={() => { setHistory([]); localStorage.removeItem(LS_KEY+'_'+asset) }}>Effacer</button>
              </div>
              <div style={{ maxHeight:250, overflowY:'auto' }}>
                {[...history].reverse().slice(0,50).map((p,i) => (
                  <div key={i} style={{
                    padding:'8px 14px', borderBottom:'1px solid rgba(30,58,95,.3)',
                    display:'flex', justifyContent:'space-between', fontSize:11,
                    background: alertThreshold>0&&p.iv>=alertThreshold?'rgba(255,77,109,.06)':undefined
                  }}>
                    <span style={{ color:'var(--text-muted)' }}>{fmtD(p.timestamp)}</span>
                    <span style={{ color:alertThreshold>0&&p.iv>=alertThreshold?'var(--put)':'var(--atm)', fontWeight:alertThreshold>0&&p.iv>=alertThreshold?700:400 }}>
                      {p.iv?.toFixed(2)}%{alertThreshold>0&&p.iv>=alertThreshold?' 🚨':''}
                    </span>
                    <span style={{ color:'var(--text-dim)' }}>${p.spot?.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
                    <span style={{ color:'var(--text-muted)', fontSize:10 }}>Strike {p.atmStrike?.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB CONTEXTE MARCHÉ ── */}
      {activeTab === 'context' && (
        <div className="fade-in">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>
              {context?.loadedAt ? 'Mis à jour ' + new Date(context.loadedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : ''}
            </span>
            <button className={`icon-btn${contextLoading?' loading':''}`} onClick={() => loadContext(asset)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Actualiser
            </button>
          </div>

          {contextLoading && (
            <div className="card"><div style={{ padding:24, textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>Chargement des données marché…</div></div>
          )}

          {/* Signal global */}
          {signal && (
            <div className="card" style={{ marginBottom:12, borderColor: signal.cls === 'var(--call)' ? 'rgba(0,229,160,.3)' : signal.cls === 'var(--put)' ? 'rgba(255,77,109,.3)' : 'rgba(255,215,0,.3)' }}>
              <div className="card-header">Signal global DI</div>
              <div style={{ padding:'14px 16px' }}>
                <div style={{ fontFamily:'var(--sans)', fontWeight:800, fontSize:18, color: signal.cls, marginBottom:10 }}>{signal.label}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {signal.reasons.map((r,i) => (
                    <div key={i} style={{ fontSize:11, color:'var(--text-dim)', display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ color: signal.cls, fontSize:9 }}>●</span>{r}
                    </div>
                  ))}
                  {signal.reasons.length === 0 && <div style={{ fontSize:11, color:'var(--text-muted)' }}>Aucun signal fort détecté</div>}
                </div>
              </div>
            </div>
          )}

          {context && !contextLoading && (
            <>
              {/* DVOL */}
              {context.dvol && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">
                    <span>DVOL — Indice de volatilité {asset}</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>≈ VIX crypto</span>
                  </div>
                  <div style={{ padding:'12px 16px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10, marginBottom:12 }}>
                      <div>
                        <div className="stat-label">DVOL actuel</div>
                        <div className="stat-value gold">{fmt2(context.dvol.current)}</div>
                      </div>
                      <div>
                        <div className="stat-label">Il y a 7 jours</div>
                        <div className="stat-value" style={{ color: context.dvol.current > context.dvol.weekAgo ? 'var(--put)' : 'var(--call)' }}>
                          {fmt2(context.dvol.weekAgo)}
                          <span style={{ fontSize:11, marginLeft:4 }}>
                            {context.dvol.current > context.dvol.weekAgo ? '▲' : '▼'}
                            {Math.abs(context.dvol.current - context.dvol.weekAgo).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="stat-label">Min 30j</div>
                        <div className="stat-value green">{fmt2(context.dvol.monthMin)}</div>
                      </div>
                      <div>
                        <div className="stat-label">Max 30j</div>
                        <div className="stat-value red">{fmt2(context.dvol.monthMax)}</div>
                      </div>
                    </div>
                    {/* Barre position dans le range */}
                    {(() => {
                      const pct = (context.dvol.current - context.dvol.monthMin) / (context.dvol.monthMax - context.dvol.monthMin) * 100
                      return (
                        <div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:5, display:'flex', justifyContent:'space-between' }}>
                            <span>Position dans le range 30j</span>
                            <span style={{ color: pct > 70 ? 'var(--call)' : pct < 30 ? 'var(--put)' : 'var(--accent2)' }}>{pct.toFixed(0)}%</span>
                          </div>
                          <div style={{ height:8, background:'rgba(255,255,255,.06)', borderRadius:4, overflow:'hidden', position:'relative' }}>
                            <div style={{ position:'absolute', left:0, top:0, height:'100%', width:`${pct}%`, background: pct > 70 ? 'var(--call)' : pct < 30 ? 'var(--put)' : 'var(--accent2)', borderRadius:4, transition:'width .4s' }} />
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:5 }}>
                            {pct > 70 ? '🔥 Volatilité élevée — taux DI attractifs' : pct < 30 ? '↓ Volatilité basse — taux DI faibles' : '~ Volatilité dans la moyenne'}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Funding rate */}
              {context.funding && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">
                    <span>Funding Rate — {asset}-PERPETUAL</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>Sentiment directionnel</span>
                  </div>
                  <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
                    <div>
                      <div className="stat-label">Funding actuel (ann.)</div>
                      <div className="stat-value" style={{ color: context.funding.current > 0 ? 'var(--call)' : 'var(--put)' }}>
                        {context.funding.current != null ? (context.funding.current > 0 ? '+' : '') + fmt2(context.funding.current) + '%' : '—'}
                      </div>
                      <div className="stat-sub">{context.funding.current > 20 ? 'Marché très long (haussier)' : context.funding.current > 0 ? 'Marché légèrement long' : 'Marché short (baissier)'}</div>
                    </div>
                    <div>
                      <div className="stat-label">Moy. 7j (ann.)</div>
                      <div className="stat-value" style={{ color: context.funding.avgAnn7d > 0 ? 'var(--call)' : 'var(--put)' }}>
                        {context.funding.avgAnn7d != null ? (context.funding.avgAnn7d > 0 ? '+' : '') + fmt2(context.funding.avgAnn7d) + '%' : '—'}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding:'0 16px 12px', fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                    💡 Funding élevé = marché leveragé haussier = IV tend à monter = meilleur moment pour vendre de la vol via DI
                  </div>
                </div>
              )}

              {/* Open Interest */}
              {context.oi && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">
                    <span>Open Interest Options</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>Liquidité marché</span>
                  </div>
                  <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
                    <div>
                      <div className="stat-label">OI Calls</div>
                      <div className="stat-value green">{fmtK(context.oi.callOI)}</div>
                    </div>
                    <div>
                      <div className="stat-label">OI Puts</div>
                      <div className="stat-value red">{fmtK(context.oi.putOI)}</div>
                    </div>
                    <div>
                      <div className="stat-label">Put/Call Ratio</div>
                      <div className="stat-value" style={{ color: context.oi.putCallRatio > 1 ? 'var(--put)' : 'var(--call)' }}>
                        {context.oi.putCallRatio?.toFixed(2) ?? '—'}
                      </div>
                      <div className="stat-sub">{context.oi.putCallRatio > 1 ? 'Biais baissier' : 'Biais haussier'}</div>
                    </div>
                    <div>
                      <div className="stat-label">OI Total</div>
                      <div className="stat-value">{fmtK(context.oi.total)}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* IV vs RV */}
              {context.dvol && context.rv && (
                <div className="card" style={{ marginBottom:12 }}>
                  <div className="card-header">
                    <span>IV vs Volatilité Réalisée</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)' }}>Premium vendu</span>
                  </div>
                  <div style={{ padding:'12px 16px' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:12 }}>
                      <div>
                        <div className="stat-label">IV (DVOL)</div>
                        <div className="stat-value gold">{fmt2(context.dvol.current)}</div>
                      </div>
                      <div>
                        <div className="stat-label">RV actuelle</div>
                        <div className="stat-value blue">{fmt2(context.rv.current)}</div>
                      </div>
                      <div>
                        <div className="stat-label">Premium</div>
                        <div className="stat-value" style={{ color: context.dvol.current > context.rv.current ? 'var(--call)' : 'var(--put)' }}>
                          {(context.dvol.current > context.rv.current ? '+' : '') + (context.dvol.current - context.rv.current).toFixed(1)}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.7 }}>
                      {context.dvol.current > context.rv.current
                        ? `✓ IV > RV de ${(context.dvol.current - context.rv.current).toFixed(1)} pts — le marché paie une prime de vol. Favorable pour vendre de la vol via DI.`
                        : `⚠ IV < RV — la vol est sous-pricée. Moins favorable pour les contrats DI.`}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!context && !contextLoading && (
            <div className="empty-state"><div className="empty-icon">◇</div><h3>Prêt à charger</h3><p>Appuyez sur Actualiser pour charger le contexte marché</p></div>
          )}
        </div>
      )}
    </div>
  )
}
