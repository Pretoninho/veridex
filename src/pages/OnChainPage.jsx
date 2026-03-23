import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getOnChainSnapshot,
  getFearGreedIndex,
  getHashRateHistory,
  getWhaleTransactions,
  getExchangeFlows,
} from '../data_core/providers/onchain.js'
import { normalizeOnChain } from '../data_core/normalizers/format_data.js'
import {
  detectExchangeFlowSignal,
  detectMempoolSignal,
  detectMinerSignal,
  compositeOnChainSignal,
  interpretMempoolExpert,
  interpretFearGreedExpert,
  interpretWhalesExpert,
  interpretHashRateExpert,
  interpretExchangeFlowsExpert,
} from '../data_processing/signals/onchain_signals.js'

const POLL_MAIN_MS   = 60_000
const POLL_WHALES_MS = 300_000
const POLL_FLOW_MS   = 300_000

function fmt(v, decimals = 0) {
  if (v == null) return '—'
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: decimals })
}

function ScoreRing({ score, size = 96 }) {
  if (score == null) return null
  const r = size * 0.4
  const cx = size / 2
  const circ = 2 * Math.PI * r
  const color = score >= 65 ? 'var(--call)' : score >= 45 ? 'var(--atm)' : 'var(--put)'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={size * 0.07} />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth={size * 0.07}
        strokeDasharray={`${circ * score / 100} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dasharray .6s' }}
      />
      <text
        x={cx} y={cx + 1} textAnchor="middle" dominantBaseline="middle"
        fill={color}
        style={{ fontFamily: 'var(--sans)', fontWeight: 900, fontSize: size * 0.22 }}
      >
        {score}
      </text>
    </svg>
  )
}

function FearGreedGauge({ value, size = 130 }) {
  if (value == null) return null
  const r = size * 0.37
  const cx = size / 2
  const cy = size * 0.56
  const semi = Math.PI * r
  const fill = semi * (value / 100)
  const color = value <= 25 ? '#ff4d6d'
    : value <= 45 ? '#ff9500'
    : value <= 55 ? '#ffd60a'
    : value <= 75 ? '#8ece6d'
    : '#00e5a0'

  return (
    <svg width={size} height={Math.round(cy + 12)} viewBox={`0 0 ${size} ${Math.round(cy + 12)}`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={r * 0.2} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none" stroke={color} strokeWidth={r * 0.2} strokeLinecap="round"
        strokeDasharray={`${fill} ${semi}`}
        style={{ transition: 'stroke-dasharray .6s ease' }}
      />
      <text x={cx} y={cy - r * 0.12} textAnchor="middle" dominantBaseline="middle"
        fill={color} style={{ fontFamily: 'var(--sans)', fontWeight: 900, fontSize: r * 0.55 }}>
        {value}
      </text>
    </svg>
  )
}

function HashRateSparkline({ history }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !history?.hashrates?.length) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (!rect.width) return

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const data = history.hashrates.slice(-30)
    if (data.length < 2) return

    const values = data.map(d => d.hashrate_ehs)
    const minV = Math.min(...values) * 0.99
    const maxV = Math.max(...values) * 1.01
    const range = maxV - minV || 1

    const px = i => (i / (data.length - 1)) * w
    const py = v => h * 0.9 - ((v - minV) / range) * h * 0.8

    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(0,212,255,.25)')
    grad.addColorStop(1, 'rgba(0,212,255,0)')

    ctx.beginPath()
    data.forEach((d, i) => {
      if (i === 0) ctx.moveTo(px(i), py(d.hashrate_ehs))
      else ctx.lineTo(px(i), py(d.hashrate_ehs))
    })
    ctx.lineTo(px(data.length - 1), h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    ctx.beginPath()
    data.forEach((d, i) => {
      if (i === 0) ctx.moveTo(px(i), py(d.hashrate_ehs))
      else ctx.lineTo(px(i), py(d.hashrate_ehs))
    })
    ctx.strokeStyle = 'rgba(0,212,255,.65)'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [history])

  return <canvas ref={canvasRef} style={{ width: '100%', height: 60, display: 'block', marginTop: 10 }} />
}

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .5s' }} />
    </div>
  )
}

const CONGESTION_COLOR = { low: 'var(--call)', medium: 'var(--atm)', high: 'var(--accent2)', critical: 'var(--put)' }
const CONGESTION_LABEL = { low: 'Calme', medium: 'Modéré', high: 'Élevé', critical: 'Critique' }
const FLOW_COLOR = { accumulation: 'var(--call)', neutral: 'var(--text-dim)', distribution: 'var(--put)' }
const FLOW_LABEL = { accumulation: 'Accumulation', neutral: 'Neutre', distribution: 'Distribution' }
const DIR_COLOR = { consolidation: 'var(--text-muted)', transfer: 'var(--atm)', distribution: 'var(--put)', unknown: 'var(--text-muted)' }
const DIR_LABEL = { consolidation: 'Consolidation', transfer: 'Transfert', distribution: 'Distribution', unknown: '—' }
const FG_LABEL_FR = { 'Extreme Fear': 'Peur Extrême', 'Fear': 'Peur', 'Neutral': 'Neutre', 'Greed': 'Avidité', 'Extreme Greed': 'Avidité Extrême' }

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children, style }) {
  return (
    <div style={{
      fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
      fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12,
      ...style,
    }}>
      {children}
    </div>
  )
}

function Badge({ label, color }) {
  return (
    <div style={{
      background: `${color}22`,
      border: `1px solid ${color}55`,
      borderRadius: 8, padding: '4px 10px',
      color, fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11,
    }}>
      {label}
    </div>
  )
}

export default function OnChainPage({ asset }) {
  const [data, setData] = useState(null)
  const [fgRaw, setFgRaw] = useState(null)
  const [hrRaw, setHrRaw] = useState(null)
  const [whalesRaw, setWhalesRaw] = useState(null)
  const [flowRaw, setFlowRaw] = useState(undefined)   // undefined = pas encore chargé
  const [signals, setSignals] = useState(null)
  const [expertSignals, setExpertSignals] = useState(null)
  const [composite, setComposite] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [error, setError] = useState(null)
  const mainTimerRef   = useRef(null)
  const whalesTimerRef = useRef(null)
  const flowTimerRef   = useRef(null)

  // ── Exchange Flows (CryptoQuant, 5 min) ──────────────────────────────────
  // flowRaw est partagé avec loadMain via ref pour éviter les stale closures
  const flowRawRef = useRef(null)

  const loadFlow = useCallback(async () => {
    const flow = await getExchangeFlows(asset).catch(() => null)
    flowRawRef.current = flow
    setFlowRaw(flow)
  }, [asset])

  const loadWhales = useCallback(async () => {
    try {
      const w = await getWhaleTransactions(100)
      setWhalesRaw(w)
    } catch (_) {}
  }, [])

  const loadMain = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [raw, fg, hr] = await Promise.all([
        getOnChainSnapshot(asset),
        getFearGreedIndex(),
        getHashRateHistory(),
      ])

      // Injecter les exchange flows disponibles dans la normalisation
      const normalized = normalizeOnChain({
        ...raw,
        fearGreed:      fg,
        hashRateHistory: hr,
        exchangeFlows:  flowRawRef.current,
      })

      const flowSig    = detectExchangeFlowSignal(normalized.exchangeFlow)
      const mempoolSig = detectMempoolSignal(normalized.mempool)
      const minerSig   = detectMinerSignal(normalized.mining)
      const comp = compositeOnChainSignal(flowSig, mempoolSig, minerSig, normalized.composite.onChainScore)

      const mempoolExp = interpretMempoolExpert(normalized.mempool)
      const fgExp      = interpretFearGreedExpert(fg)
      const hrExp      = interpretHashRateExpert(hr, hr)

      setData(normalized)
      setFgRaw(fg)
      setHrRaw(hr)
      setSignals({ flow: flowSig, mempool: mempoolSig, miner: minerSig })
      setExpertSignals({ mempool: mempoolExp, fg: fgExp, hr: hrExp })
      setComposite(comp)
      setLastUpdate(new Date())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [asset])

  useEffect(() => {
    // Charger les exchange flows en premier (clé absente → null immédiat)
    loadFlow()
    loadMain()
    loadWhales()
    mainTimerRef.current   = setInterval(loadMain,   POLL_MAIN_MS)
    whalesTimerRef.current = setInterval(loadWhales, POLL_WHALES_MS)
    flowTimerRef.current   = setInterval(loadFlow,   POLL_FLOW_MS)
    return () => {
      clearInterval(mainTimerRef.current)
      clearInterval(whalesTimerRef.current)
      clearInterval(flowTimerRef.current)
    }
  }, [asset, loadMain, loadWhales, loadFlow])

  const whalesExp = interpretWhalesExpert(whalesRaw, null)

  const score = composite?.score ?? null
  const scoreColor = score == null ? 'var(--text-muted)' : score >= 65 ? 'var(--call)' : score >= 45 ? 'var(--atm)' : 'var(--put)'
  const biasLabel = data?.composite?.bias === 'bullish' ? 'Haussier'
    : data?.composite?.bias === 'bearish' ? 'Baissier'
    : 'Neutre'

  return (
    <div className="page-wrap fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">
          On-Chain <span style={{ color: 'var(--accent)', fontSize: 14 }}>{asset}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <div className="dot-live" />}
          <button
            onClick={() => { loadMain(); loadWhales() }}
            disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px',
              cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 600,
            }}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(255,77,109,.08)', border: '1px solid rgba(255,77,109,.25)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: 'var(--put)',
        }}>
          {error}
        </div>
      )}

      {/* Score global */}
      <Card style={{ textAlign: 'center', padding: '22px 16px' }}>
        <ScoreRing score={score} size={100} />
        <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 17, color: scoreColor, marginTop: 10 }}>
          {biasLabel}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Confiance : {data?.composite?.confidence ?? '—'} &nbsp;·&nbsp;
          {lastUpdate ? `màj ${lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'chargement...'}
        </div>
      </Card>

      {/* Section Sentiment */}
      <SectionTitle>Sentiment</SectionTitle>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
              Fear & Greed Index
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              {fgRaw ? FG_LABEL_FR[fgRaw.label] ?? fgRaw.label : '—'}
              {fgRaw?.deltaLabel && (
                <span style={{ color: fgRaw.delta > 0 ? 'var(--put)' : 'var(--call)', marginLeft: 6 }}>
                  {fgRaw.deltaLabel}
                </span>
              )}
            </div>
            {expertSignals?.fg && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {expertSignals.fg.action}
              </div>
            )}
          </div>
          <FearGreedGauge value={fgRaw?.value ?? null} size={120} />
        </div>
      </Card>

      {/* Section Indicateurs réseau */}
      <SectionTitle style={{ marginTop: 4 }}>Indicateurs Réseau</SectionTitle>

      {/* Mempool */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
              Mempool Bitcoin
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {fmt(data?.mempool?.txCount)} tx en attente
            </div>
          </div>
          <Badge label={data?.mempool?.congestion ? CONGESTION_LABEL[data.mempool.congestion] : '—'} color={data?.mempool?.congestion ? CONGESTION_COLOR[data.mempool.congestion] : 'var(--border)'} />
        </div>
        <ProgressBar value={data?.mempool?.txCount ?? 0} max={100_000} color={data?.mempool?.congestion ? CONGESTION_COLOR[data.mempool.congestion] : 'var(--border)'} />
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {[{ label: 'Rapide', val: data?.mempool?.fastFee }, { label: '1 heure', val: data?.mempool?.hourFee }].map(({ label, val }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--atm)' }}>
                {val != null ? `${val} sat/vB` : '—'}
              </div>
            </div>
          ))}
        </div>
        {expertSignals?.mempool && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {expertSignals.mempool.action}
          </div>
        )}
      </Card>

      {/* Hash Rate */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
              Hash Rate
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 17, color: 'var(--accent)' }}>
              {hrRaw?.currentHashrate != null ? `${hrRaw.currentHashrate.toFixed(1)} EH/s` : '—'}
            </div>
          </div>
          {expertSignals?.hr?.variation7d != null && (
            <Badge
              label={`${expertSignals.hr.variation7d > 0 ? '+' : ''}${expertSignals.hr.variation7d.toFixed(1)}% 7j`}
              color={expertSignals.hr.bias === 'bullish' ? 'var(--call)' : expertSignals.hr.bias === 'bearish' ? 'var(--put)' : 'var(--text-muted)'}
            />
          )}
        </div>
        <HashRateSparkline history={hrRaw} />
        {expertSignals?.hr && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
            {expertSignals.hr.action}
          </div>
        )}
      </Card>

      {/* Section Flux */}
      <SectionTitle style={{ marginTop: 4 }}>Flux & Positions</SectionTitle>

      {/* Exchange Flows */}
      {flowRaw === null ? (
        /* Clé absente — card explicative grisée */
        <Card style={{ opacity: 0.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text-muted)', marginBottom: 3 }}>
                Exchange Flows · {asset}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source : CryptoQuant</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 10 }}>
            Fonctionnalité désactivée.
          </div>
          <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, fontFamily: 'var(--mono, monospace)' }}>
            Ajouter dans .env :<br />
            VITE_CRYPTOQUANT_API_KEY=ta_clé
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Clé gratuite sur{' '}
            <span style={{ color: 'var(--accent)' }}>cryptoquant.com</span>
          </div>
        </Card>
      ) : flowRaw !== undefined ? (
        /* Données disponibles */
        (() => {
          const flowExp = interpretExchangeFlowsExpert(flowRaw)
          const flowColor = flowRaw.signal === 'bullish' ? 'var(--call)'
            : flowRaw.signal === 'bearish' ? 'var(--put)'
            : 'var(--text-muted)'
          const signalLabel = flowRaw.signal === 'bullish' ? 'Haussier'
            : flowRaw.signal === 'bearish' ? 'Baissier'
            : 'Neutre'
          return (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
                    Exchange Flows · {asset}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source : CryptoQuant</div>
                </div>
                <Badge label={signalLabel} color={flowColor} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Dernière heure</div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: flowColor }}>
                    {flowRaw.netflow != null ? `${flowRaw.netflow > 0 ? '+' : ''}${Number(flowRaw.netflow).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: flowColor, marginTop: 2 }}>
                    {flowRaw.direction === 'outflow' ? 'Outflow ↓' : flowRaw.direction === 'inflow' ? 'Inflow ↑' : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Cumul 24h</div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: flowColor }}>
                    {flowRaw.netflow24h != null ? `${flowRaw.netflow24h > 0 ? '+' : ''}${Number(flowRaw.netflow24h).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}` : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: flowColor, marginTop: 2 }}>
                    {flowRaw.netflow24h != null && flowRaw.netflow24h < 0 ? 'Outflow ↓' : flowRaw.netflow24h != null && flowRaw.netflow24h > 0 ? 'Inflow ↑' : '—'}
                  </div>
                </div>
              </div>
              {flowExp.available && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <span style={{ fontFamily: 'var(--sans)', fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', display: 'block', marginBottom: 4 }}>Action Expert</span>
                  {flowExp.action}
                </div>
              )}
            </Card>
          )
        })()
      ) : (
        /* Chargement initial */
        <Card>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '10px 0' }}>
            Exchange Flows · {asset} — chargement…
          </div>
        </Card>
      )}

      {/* Whale Transactions */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
              Whale Transactions
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Transactions &gt;100 BTC dans le mempool</div>
          </div>
          <Badge label={whalesRaw ? `${whalesRaw.count} tx` : '—'} color={whalesExp?.bias === 'bearish' ? 'var(--put)' : 'var(--text-muted)'} />
        </div>
        {whalesRaw?.transactions?.length > 0 ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {whalesRaw.transactions.slice(0, 6).map((tx, i) => (
                <div key={tx.txid ?? i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {tx.txid ? `${tx.txid.slice(0, 8)}…` : `tx#${i + 1}`}
                  </div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>
                    {fmt(tx.totalBTC, 1)} BTC
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--sans)', fontWeight: 700, color: DIR_COLOR[tx.direction] ?? 'var(--text-muted)' }}>
                    {DIR_LABEL[tx.direction] ?? '—'}
                  </div>
                </div>
              ))}
            </div>
            {whalesExp && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {whalesExp.action}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
            {whalesRaw === null ? 'Chargement...' : 'Aucune whale tx détectée'}
          </div>
        )}
      </Card>

      {/* Section Mining */}
      <SectionTitle style={{ marginTop: 4 }}>Mining</SectionTitle>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
              Mining
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hash rate & difficulté</div>
          </div>
          <Badge label={signals?.miner?.signal ?? '—'} color={signals?.miner?.signal === 'BULLISH' ? 'var(--call)' : signals?.miner?.signal === 'BEARISH' ? 'var(--put)' : 'var(--text-muted)'} />
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Hash Rate (blockchain.info)</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
              {data?.mining?.hashRate != null ? `${(data.mining.hashRate / 1e18).toFixed(1)} EH/s` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Difficulté</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
              {data?.mining?.difficulty != null ? `${(data.mining.difficulty / 1e12).toFixed(1)}T` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Tendance</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
              {signals?.miner?.trend === 'up' ? '↑' : signals?.miner?.trend === 'down' ? '↓' : '→'}
            </div>
          </div>
        </div>
      </Card>

      {/* Section Signal Composite */}
      <SectionTitle style={{ marginTop: 4 }}>Signal Composite</SectionTitle>

      {composite ? (
        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 14 }}>
            {composite.expert}
          </div>
          <div style={{ background: 'rgba(0,212,255,.06)', border: '1px solid rgba(0,212,255,.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--accent)', lineHeight: 1.6 }}>
            <span style={{ fontFamily: 'var(--sans)', fontWeight: 700 }}>Action : </span>
            {composite.action_expert}
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '16px 0' }}>
            {loading ? 'Chargement des données on-chain...' : 'Appuie sur Refresh pour charger'}
          </div>
        </Card>
      )}
    </div>
  )
}
