/**
 * OptionsDataPage — Vue options multi-source
 *
 * Sources : Deribit (référence) | Binance European
 *
 * Données affichées :
 *   - DVOL + IV Rank Deribit
 *   - Structure à terme ATM IV
 *   - Greeks ATM (Deribit)
 *   - OI comparaison 2 sources
 *   - IV spread Deribit / Binance
 */
import { useState, useEffect, useRef } from 'react'
import * as deribit from '../data_core/providers/deribit.js'
import * as binance from '../data_core/providers/binance.js'
import { analyzeIV } from '../data_processing/volatility/iv_rank.js'
import { calcOptionGreeks } from '../data_processing/volatility/greeks.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

function fmtPct(n, d = 2) {
  const v = safe(n)
  if (v === null) return '—'
  return v.toFixed(d) + '%'
}

function fmtSigned(n, d = 2) {
  const v = safe(n)
  if (v === null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(d)
}

function pctColor(v) {
  const n = safe(v)
  if (n === null) return 'var(--text-muted)'
  if (n > 0) return 'var(--call)'
  if (n < 0) return 'var(--put)'
  return 'var(--text-muted)'
}

// Trouve l'option ATM la plus proche du spot dans une liste
function findATM(opts, spot) {
  if (!opts?.length || !spot) return null
  return opts.reduce((best, o) => {
    if (!best) return o
    return Math.abs(o.strike - spot) < Math.abs(best.strike - spot) ? o : best
  }, null)
}

// Groupe options par expiry
function groupByExpiry(options) {
  const map = new Map()
  for (const o of (options ?? [])) {
    if (!map.has(o.expiry)) {
      map.set(o.expiry, { expiry: o.expiry, daysToExpiry: o.daysToExpiry, calls: [], puts: [] })
    }
    const g = map.get(o.expiry)
    if (o.optionType === 'call') g.calls.push(o)
    else g.puts.push(o)
  }
  return [...map.values()].sort((a, b) => a.expiry - b.expiry)
}

// À partir de options groupées, calcule ATM IV pour un spot donné
function calcATMIV(groups, spot) {
  return groups
    .filter(g => g.daysToExpiry > 0.5)
    .slice(0, 8)
    .map(g => {
      const atmCall = findATM(g.calls, spot)
      const atmPut  = findATM(g.puts,  spot)
      const callIV  = safe(atmCall?.markIV)
      const putIV   = safe(atmPut?.markIV)
      const atmIV   = (callIV && putIV) ? (callIV + putIV) / 2 : callIV ?? putIV
      return { expiry: g.expiry, daysToExpiry: g.daysToExpiry, atmIV, callIV, putIV }
    })
    .filter(r => r.atmIV !== null)
}

// ── Composants ────────────────────────────────────────────────────────────────

function SectionTitle({ children, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 20 }}>
      <div style={{
        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
        fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
      }}>
        {children}
      </div>
      {badge && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
          background: 'rgba(255,255,255,.06)', color: 'var(--text-muted)',
        }}>
          {badge}
        </span>
      )}
    </div>
  )
}

function MetricCard({ label, value, sub, color, bar }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: color || 'var(--text)' }}>
        {value}
      </div>
      {bar != null && (
        <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, bar))}%`, background: color || 'var(--accent)', borderRadius: 2, transition: 'width .4s' }} />
        </div>
      )}
      {sub != null && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function TableHead({ cols }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols.map(() => '1fr').join(' '),
      gap: 4, padding: '8px 16px',
      background: 'rgba(255,255,255,.02)', borderBottom: '1px solid var(--border)',
    }}>
      {cols.map((h, i) => (
        <div key={h} style={{
          fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
          fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase',
          textAlign: i === 0 ? 'left' : 'right',
        }}>
          {h}
        </div>
      ))}
    </div>
  )
}

// Sparkline DVOL
function DvolSparkline({ history }) {
  if (!history?.length) return null
  const W = 260, H = 36, pad = 4
  const vals = history.map(h => h[1]).filter(v => safe(v) !== null)
  if (vals.length < 2) return null
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  const range = maxV - minV || 1
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v - minV) / range) * (H - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block', maxWidth: '100%' }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function OptionsDataPage({ asset }) {
  const [spot,        setSpot]        = useState(null)
  const [dvol,        setDvol]        = useState(null)
  const [rv,          setRv]          = useState(null)
  const [ivAnalysis,  setIvAnalysis]  = useState(null)
  const [greeks,      setGreeks]      = useState(null)
  // Options chains par source
  const [dChain,      setDChain]      = useState(null)  // Deribit ATM IV per expiry
  const [bChain,      setBChain]      = useState(null)  // Binance options
  // OI
  const [dOI,         setDOI]         = useState(null)
  const [bOI,         setBOI]         = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [lastUpdate,  setLastUpdate]  = useState(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    load()
    const timer = setInterval(() => { if (isMounted.current) load() }, 90_000)
    return () => { isMounted.current = false; clearInterval(timer) }
  }, [asset])

  const load = async () => {
    if (!isMounted.current) return
    setLoading(true)
    try {
      // ── Phase 1 : données de base ──────────────────────────────────────────
      const [spotRes, dvolRes, rvRes, bOptRes, bOIRes, dOIRes] =
        await Promise.allSettled([
          deribit.getSpot(asset),
          deribit.getDVOL(asset),
          deribit.getRealizedVol(asset),
          binance.getOptionsChain(asset),
          binance.getOpenInterest(asset),   // futures OI (fiable) — eapi options trop peu liquides
          deribit.getOpenInterest(asset),
        ])

      if (!isMounted.current) return

      const spotData = spotRes.status  === 'fulfilled' ? spotRes.value  : null
      const dvolData = dvolRes.status  === 'fulfilled' ? dvolRes.value  : null
      const rvData   = rvRes.status    === 'fulfilled' ? rvRes.value    : null
      const spotPrice = safe(spotData?.price)

      setSpot(spotData)
      setDvol(dvolData)
      setRv(rvData)
      setBChain(bOptRes.status === 'fulfilled' ? bOptRes.value : null)
      setBOI(bOIRes.status === 'fulfilled' ? bOIRes.value : null)
      setDOI(dOIRes.status === 'fulfilled' ? dOIRes.value : null)

      // IV Rank / Percentile
      if (dvolData) {
        try { setIvAnalysis(analyzeIV(dvolData)) } catch (_) {}
      }

      // ── Phase 2 : structure à terme Deribit ───────────────────────────────
      if (spotPrice) {
        try {
          const instruments = await deribit.getInstruments(asset, 'option')
          const expiries = deribit.extractExpiries(instruments)
            .filter(ts => ts > Date.now())
            .slice(0, 5)

          const termRows = []
          for (const expiryTs of expiries) {
            try {
              const days = Math.max(0.01, (expiryTs - Date.now()) / 86400000)
              const expInstr = instruments.filter(i => i.expiration_timestamp === expiryTs)

              // Strikes disponibles pour cet expiry, triés par distance au spot
              const strikes = [...new Set(expInstr.map(i => Number(i.instrument_name.split('-')[2])))]
                .filter(s => s > 0)
                .sort((a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice))

              const atmStrike = strikes[0]
              if (!atmStrike) continue

              // Format date Deribit : récupérer via instrument listing
              const atmCallInst = expInstr.find(i => i.instrument_name.split('-')[2] === String(atmStrike) && i.instrument_name.endsWith('-C'))
              const atmPutInst  = expInstr.find(i => i.instrument_name.split('-')[2] === String(atmStrike) && i.instrument_name.endsWith('-P'))

              const [callTick, putTick] = await Promise.allSettled([
                atmCallInst ? deribit.getTicker(atmCallInst.instrument_name) : Promise.resolve(null),
                atmPutInst  ? deribit.getTicker(atmPutInst.instrument_name)  : Promise.resolve(null),
              ])

              const callIV = callTick.status === 'fulfilled' ? safe(callTick.value?.markIV) : null
              const putIV  = putTick.status  === 'fulfilled' ? safe(putTick.value?.markIV)  : null
              const atmIV  = (callIV && putIV) ? (callIV + putIV) / 2 : callIV ?? putIV

              if (atmIV === null) continue
              termRows.push({ expiry: expiryTs, daysToExpiry: days, atmIV, callIV, putIV, strike: atmStrike })

              // Greeks ATM (premier expiry uniquement)
              if (termRows.length === 1 && atmIV && spotPrice) {
                try {
                  const g = calcOptionGreeks({ type: 'call', S: spotPrice, K: atmStrike, T: days / 365, sigma: atmIV / 100, r: 0 })
                  setGreeks({ ...g, expiry: days, iv: atmIV, strike: atmStrike })
                } catch (_) {}
              }
            } catch (_) {}
          }
          setDChain(termRows)
        } catch (_) {}
      }

      if (isMounted.current) setLastUpdate(new Date())
    } catch (err) {
      console.warn('OptionsDataPage load error:', err)
    }
    if (isMounted.current) setLoading(false)
  }

  // ── Calculs cross-exchange ─────────────────────────────────────────────────
  const spotPrice = safe(spot?.price)

  // ATM IV par expiry pour Binance
  const bGroups = groupByExpiry(bChain?.options)
  const bATM    = spotPrice ? calcATMIV(bGroups, spotPrice) : []

  // Cross-exchange IV par expiry (matching approx par daysToExpiry)
  const allExpiries = new Map()
  ;(dChain ?? []).forEach(r => {
    const bucket = Math.round(r.daysToExpiry)
    if (!allExpiries.has(bucket)) allExpiries.set(bucket, { days: bucket })
    allExpiries.get(bucket).deribit = r.atmIV
  })
  bATM.forEach(r => {
    const bucket = Math.round(r.daysToExpiry)
    if (!allExpiries.has(bucket)) allExpiries.set(bucket, { days: bucket })
    allExpiries.get(bucket).binance = r.atmIV
  })
  const crossTable = [...allExpiries.values()]
    .filter(r => r.deribit || r.binance)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6)

  // IV spread : pour chaque ligne avec 2 sources, calcule spread Deribit − Binance
  const ivArbSignals = crossTable
    .map(r => {
      const ivs = [r.deribit, r.binance].filter(v => v != null)
      if (ivs.length < 2) return null
      const maxIV = Math.max(...ivs)
      const minIV = Math.min(...ivs)
      const spread = maxIV - minIV
      return { days: r.days, spread, maxIV, minIV, ...r }
    })
    .filter(Boolean)
    .sort((a, b) => b.spread - a.spread)

  const dvolChange = safe(dvol?.current) !== null && safe(dvol?.weekAgo) !== null
    ? dvol.current - dvol.weekAgo : null
  const ivPremium = safe(dvol?.current) !== null && safe(rv?.current) !== null
    ? dvol.current - rv.current : null

  // OI agrégé multi-source
  const dTotalOI = dOI?.callOI != null ? (dOI.callOI + dOI.putOI) : null
  const dPCR     = safe(dOI?.putCallRatio)
  const bPCR     = safe(bOI?.putCallRatio)

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Options <span>{asset}</span></div>
        <div className="status-row">
          {loading && <div className="dot-live" />}
          <button onClick={load} disabled={loading} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px',
            cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 600,
          }}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Cards DVOL */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MetricCard
          label="DVOL Deribit"
          value={dvol?.current != null ? dvol.current.toFixed(1) : '—'}
          sub={dvolChange != null ? `7j: ${fmtSigned(dvolChange, 1)}` : `${fmtPct(dvol?.monthMin, 1)}–${fmtPct(dvol?.monthMax, 1)}`}
          color={safe(dvol?.current) > 80 ? 'var(--put)' : safe(dvol?.current) > 60 ? 'var(--atm)' : 'var(--call)'}
          bar={dvol ? (dvol.current - dvol.monthMin) / (dvol.monthMax - dvol.monthMin) * 100 : null}
        />
        <MetricCard
          label="IV Rank (30j)"
          value={ivAnalysis?.ivRank != null ? Math.round(ivAnalysis.ivRank) + '/100' : '—'}
          sub={`IV pct: ${ivAnalysis?.ivPercentile != null ? Math.round(ivAnalysis.ivPercentile) : '—'}`}
          color={safe(ivAnalysis?.ivRank) > 70 ? 'var(--put)' : safe(ivAnalysis?.ivRank) > 30 ? 'var(--atm)' : 'var(--call)'}
          bar={ivAnalysis?.ivRank}
        />
        <MetricCard
          label="Vol réalisée 30j"
          value={rv?.current != null ? fmtPct(rv.current, 1) : '—'}
          sub={`Moy: ${fmtPct(rv?.avg30, 1)}`}
        />
        <MetricCard
          label="Prime IV / RV"
          value={ivPremium != null ? fmtSigned(ivPremium, 1) + ' pts' : '—'}
          sub="DVOL − Vol Réalisée"
          color={safe(ivPremium) > 10 ? 'var(--put)' : safe(ivPremium) > 0 ? 'var(--atm)' : 'var(--call)'}
        />
      </div>

      {/* DVOL sparkline */}
      {dvol?.history?.length > 0 && (
        <>
          <SectionTitle>DVOL — 72 dernières heures</SectionTitle>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
            <DvolSparkline history={dvol.history} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Min: {fmtPct(dvol.monthMin, 1)}</span>
              <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>Act: {fmtPct(dvol.current, 1)}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Max: {fmtPct(dvol.monthMax, 1)}</span>
            </div>
          </div>
        </>
      )}

      {/* ── IV Cross-Exchange ── */}
      {ivArbSignals.length > 0 && (
        <>
          <SectionTitle>IV Cross-Exchange — Deribit vs Binance</SectionTitle>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <TableHead cols={['Jours', 'Deribit', 'Binance', 'Spread']} />
            {ivArbSignals.map((r, i) => (
              <div key={r.days} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
                gap: 4, padding: '10px 16px', alignItems: 'center',
                borderBottom: i < ivArbSignals.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                background: r.spread > 5 ? 'rgba(255,193,7,.04)' : 'transparent',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.days}j</div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  {r.deribit != null ? fmtPct(r.deribit, 1) : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#F0B90B' }}>
                  {r.binance != null ? fmtPct(r.binance, 1) : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 800, color: r.spread > 5 ? 'var(--atm)' : 'var(--text-muted)' }}>
                  {fmtPct(r.spread, 1)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Structure à terme Deribit ── */}
      {dChain?.length > 0 && (
        <>
          <SectionTitle badge="Deribit">Structure à terme — IV ATM</SectionTitle>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <TableHead cols={['Jours', 'Strike ATM', 'IV Call', 'IV Put', 'IV moyen']} />
            {dChain.map((row, i) => (
              <div key={row.expiry} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr',
                gap: 4, padding: '10px 16px', alignItems: 'center',
                borderBottom: i < dChain.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.daysToExpiry.toFixed(0)}j</div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                  ${row.strike?.toLocaleString('en-US')}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--call)' }}>
                  {row.callIV != null ? fmtPct(row.callIV, 1) : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--put)' }}>
                  {row.putIV != null ? fmtPct(row.putIV, 1) : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: 'var(--atm)' }}>
                  {row.atmIV != null ? fmtPct(row.atmIV, 1) : '—'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Greeks ATM ── */}
      {greeks && (
        <>
          <SectionTitle badge="Deribit">Greeks ATM — Échéance proche</SectionTitle>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
              {[
                { label: 'Delta', value: greeks.delta != null ? greeks.delta.toFixed(3) : '—', color: 'var(--accent)' },
                { label: 'Gamma', value: greeks.gamma != null ? greeks.gamma.toExponential(2) : '—', color: 'var(--atm)' },
                { label: 'Vega',  value: greeks.vega  != null ? greeks.vega.toFixed(2)  : '—', color: 'var(--call)' },
                { label: 'Theta', value: greeks.theta != null ? greeks.theta.toFixed(2) : '—', color: 'var(--put)' },
              ].map(g => (
                <div key={g.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>{g.label}</div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, color: g.color }}>{g.value}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
              ATM Call · Strike ${greeks.strike?.toLocaleString('en-US')} · IV {fmtPct(greeks.iv, 1)} · {greeks.expiry?.toFixed(0)}j
            </div>
          </div>
        </>
      )}

      {/* ── OI multi-source ── */}
      <SectionTitle>Open Interest — Options</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <TableHead cols={['Source', 'Call OI', 'Put OI', 'P/C Ratio']} />
        {[
          { name: 'Deribit', type: 'Options', color: 'var(--accent)', callOI: dOI?.callOI, putOI: dOI?.putOI, pcr: dOI?.putCallRatio, total: null },
          { name: 'Binance', type: 'Futures', color: '#F0B90B',       callOI: null,         putOI: null,        pcr: null,              total: bOI?.total },
        ].map((row, i) => (
          <div key={row.name} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 4, padding: '10px 16px', alignItems: 'center',
            borderBottom: i < 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700 }}>{row.name}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 12 }}>{row.type}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--call)' }}>
              {row.callOI != null
                ? Number(row.callOI).toFixed(0)
                : row.total != null
                  ? <span style={{ color: 'var(--text-muted)' }}>{Number(row.total).toFixed(0)}</span>
                  : '—'}
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--put)' }}>
              {row.putOI != null ? Number(row.putOI).toFixed(0) : <span style={{ color: 'var(--text-muted)' }}>{row.total != null ? 'total' : '—'}</span>}
            </div>
            <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: safe(row.pcr) > 1 ? 'var(--put)' : safe(row.pcr) !== null ? 'var(--call)' : 'var(--text-muted)' }}>
              {safe(row.pcr) !== null ? Number(row.pcr).toFixed(3) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Hint si pas de données */}
      {!dvol && !dChain?.length && !loading && (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
          Appuie sur Refresh pour charger les données
        </div>
      )}

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12, marginBottom: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
