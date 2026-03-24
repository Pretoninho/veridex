/**
 * OptionsDataPage — Vue options multi-source
 * Onglets : Analyse · Signaux · Journal
 *
 * Sources : Deribit (référence) | Binance European
 *
 * Données affichées :
 *   - DVOL + IV Rank Deribit
 *   - Funding rate perpetuel Deribit
 *   - Structure à terme ATM IV
 *   - Greeks ATM (Deribit)
 *   - OI comparaison 2 sources
 *   - IV spread Deribit / Binance
 *   - Signaux options dérivés des données chargées
 *   - Journal de snapshots persisté en localStorage
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as deribit from '../../data/providers/deribit.js'
import * as binance from '../../data/providers/binance.js'
import { analyzeIV } from '../../core/volatility/iv_rank.js'
import { calcOptionGreeks } from '../../core/volatility/greeks.js'
import { recordSnapshot as saveMetricSnapshot } from '../../core/history/metric_history.js'
import MaxPainChart              from '../components/MaxPainChart.jsx'
import { calculateMaxPainByExpiry, interpretMaxPain } from '../../core/volatility/max_pain.js'
import { getSettlementHistory } from '../../signals/settlement_tracker.js'

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

function SectionTitle({ children, badge, badgeColor }) {
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
          background: 'rgba(255,255,255,.06)', color: badgeColor ?? 'var(--text-muted)',
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

// Clé localStorage pour le journal des snapshots
const journalKey = (asset) => `options_journal_${asset}`

// Nombre maximum de snapshots conservés dans le journal
const MAX_SNAPSHOTS = 50

// Seuils de scoring pour l'onglet Signaux
const IV_PREMIUM_SCORE_DIVISOR = 30
const PCR_SCORE_MULTIPLIER     = 50
const FUNDING_SCORE_OFFSET     = 50
const FUNDING_SCORE_DIVISOR    = 2

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

// Ligne cliquable pour un settlement récent
function SettlementRow({ settlement: s, asset, isLast }) {
  const [expanded, setExpanded] = useState(false)
  const price = s.settlementPrice != null
    ? '$' + Number(s.settlementPrice).toLocaleString('en-US', { maximumFractionDigits: asset === 'ETH' ? 2 : 0 })
    : '—'
  const deltaColor = (s.spotDeltaPct ?? 0) > 0 ? 'var(--call)' : (s.spotDeltaPct ?? 0) < 0 ? 'var(--put)' : 'var(--text-muted)'
  const dateLabel  = s.dateKey ? s.dateKey.slice(5).replace('-', ' ') : '—'

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.04)' }}>
      {/* Ligne principale */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)', minWidth: 36 }}>{dateLabel}</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)' }}>{price}</span>
        <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: deltaColor }}>
          {s.spotDeltaLabel ?? '—'}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {/* Détail expansible */}
      {expanded && (
        <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            ['vs Max Pain', s.maxPainDeltaLabel ? `${s.maxPainDeltaLabel}${s.maxPainStrike ? ` ($${Number(s.maxPainStrike).toLocaleString('en-US')})` : ''}` : null],
            ['IV Rank',     s.ivRank != null ? `${s.ivRank}` : null],
            ['Date Deribit', s.settlementDate ?? null],
            ['Hash',        s.hash],
            ['Capture',     s.isLate ? 'Différée ⚠' : 'À l\'heure ✓'],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>{label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: label === 'Capture' ? (s.isLate ? 'var(--neutral)' : 'var(--call)') : 'var(--text)', fontSize: label === 'Hash' ? 10 : 11 }}>
                {val ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Barre de signal pour l'onglet Signaux
function SignalBar({ label, score, detail, color }) {
  const pct = Math.min(100, Math.max(0, score ?? 0))
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color: color || 'var(--text)' }}>
          {detail}
        </span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color || 'var(--accent)', transition: 'width .5s' }} />
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function OptionsDataPage({ asset }) {
  const [activeTab,   setActiveTab]   = useState('analyse')
  const [spot,        setSpot]        = useState(null)
  const [dvol,        setDvol]        = useState(null)
  const [rv,          setRv]          = useState(null)
  const [funding,     setFunding]     = useState(null)
  const [ivAnalysis,  setIvAnalysis]  = useState(null)
  const [greeks,      setGreeks]      = useState(null)
  // Options chains par source
  const [dChain,      setDChain]      = useState(null)  // Deribit ATM IV per expiry
  const [bChain,      setBChain]      = useState(null)  // Binance options
  // OI
  const [dOI,         setDOI]         = useState(null)
  const [bOI,         setBOI]         = useState(null)
  const [bFunding,    setBFunding]    = useState(null)  // Binance funding rate
  const [deliveries,  setDeliveries]  = useState(null)  // Settlement prices
  const [selectedMaxPainExpiry, setSelectedMaxPainExpiry] = useState(null)
  const [recentSettlements, setRecentSettlements] = useState([])
  const [loading,     setLoading]     = useState(false)
  const [lastUpdate,  setLastUpdate]  = useState(null)
  // Journal
  const [snapshots,   setSnapshots]   = useState([])
  const isMounted     = useRef(true)

  // Charger le journal depuis localStorage quand l'asset change
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(journalKey(asset)) ?? '[]')
      setSnapshots(Array.isArray(stored) ? stored : [])
    } catch (e) { console.warn('Journal load error:', e); setSnapshots([]) }
  }, [asset])

  // Charger les settlements récents depuis IndexedDB
  useEffect(() => {
    let active = true
    getSettlementHistory(asset, 7).then(history => {
      if (active) setRecentSettlements(history)
    }).catch(() => {})
    return () => { active = false }
  }, [asset])

  useEffect(() => {
    isMounted.current = true
    load()
    const timer = setInterval(() => { if (isMounted.current) load() }, 90_000)
    return () => { isMounted.current = false; clearInterval(timer) }
  }, [asset])

  // ── Chargement ────────────────────────────────────────────────────────────

  const load = async () => {
    if (!isMounted.current) return
    setLoading(true)
    try {
      // ── Phase 1 : données de base ──────────────────────────────────────────
      const [spotRes, dvolRes, rvRes, fundingRes, bOptRes, bOIRes, dOIRes, bFundRes, delivRes] =
        await Promise.allSettled([
          deribit.getSpot(asset),
          deribit.getDVOL(asset),
          deribit.getRealizedVol(asset),
          deribit.getFundingRate(asset),
          binance.getOptionsChain(asset),
          binance.getOpenInterest(asset),   // futures OI (fiable) — eapi options trop peu liquides
          deribit.getOpenInterest(asset),
          binance.getFundingRate(asset),
          deribit.getDeliveryPrices(asset),
        ])

      if (!isMounted.current) return

      const spotData = spotRes.status  === 'fulfilled' ? spotRes.value  : null
      const dvolData = dvolRes.status  === 'fulfilled' ? dvolRes.value  : null
      const rvData   = rvRes.status    === 'fulfilled' ? rvRes.value    : null
      const spotPrice = safe(spotData?.price)

      const dFundData = fundingRes.status === 'fulfilled' ? fundingRes.value : null
      const bFundData = bFundRes.status  === 'fulfilled' ? bFundRes.value  : null

      setSpot(spotData)
      setDvol(dvolData)
      setRv(rvData)
      setFunding(dFundData)
      setBChain(bOptRes.status === 'fulfilled' ? bOptRes.value : null)
      setBOI(bOIRes.status === 'fulfilled' ? bOIRes.value : null)
      setDOI(dOIRes.status === 'fulfilled' ? dOIRes.value : null)
      setBFunding(bFundData)
      setDeliveries(delivRes.status === 'fulfilled' ? delivRes.value : null)

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

      // ── recordSnapshot ─────────────────────────────────────────────────────
      if (isMounted.current) {
        try {
          saveMetricSnapshot(asset, {
            dvol:          safe(dvolData?.current),
            ivRank:        safe(dvolData ? analyzeIV(dvolData)?.ivRank : null),
            rv:            safe(rvData?.current),
            dFundingRate:  safe(dFundData?.rate),
            bFundingRate:  safe(bFundData?.rate),
            dPutCallRatio: safe(dOIRes.status === 'fulfilled' ? dOIRes.value?.putCallRatio : null),
          })
        } catch (_) {}
      }

      if (isMounted.current) setLastUpdate(new Date())
    } catch (err) {
      console.warn('OptionsDataPage load error:', err)
    }
    if (isMounted.current) setLoading(false)
  }

  // Enregistre un snapshot de la situation actuelle dans le journal
  const recordSnapshot = () => {
    if (!spot && !dvol) return
    const snap = {
      id:      Date.now(),
      ts:      new Date().toISOString(),
      asset,
      spot:    spot?.price ?? null,
      dvol:    dvol?.current ?? null,
      ivRank:  ivAnalysis?.ivRank != null ? Math.round(ivAnalysis.ivRank) : null,
      funding: funding?.rateAnn ?? null,
      pcr:     dOI?.putCallRatio ?? null,
      rv:      rv?.current ?? null,
    }
    const updated = [snap, ...snapshots].slice(0, MAX_SNAPSHOTS)
    setSnapshots(updated)
    try { localStorage.setItem(journalKey(asset), JSON.stringify(updated)) } catch (e) { console.warn('Snapshot save error:', e) }
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

  // ── Max Pain par échéance ─────────────────────────────────────────────────
  // Calculé depuis dOI.raw (données déjà en cache, aucun appel API supplémentaire)
  const maxPainByExpiry = useMemo(() => {
    const rawInstruments = dOI?.raw ?? []
    if (!rawInstruments.length || !spotPrice) return []
    try {
      const results = calculateMaxPainByExpiry(rawInstruments, spotPrice)
      return results.map(mp => ({
        ...mp,
        interpretation: interpretMaxPain(mp, spotPrice),
      }))
    } catch (err) {
      console.warn('[OptionsDataPage] Max Pain error:', err)
      return []
    }
  }, [dOI, spotPrice])

  // ── Signaux options dérivés ────────────────────────────────────────────────
  const ivRankVal  = safe(ivAnalysis?.ivRank)
  const fundingAnn = safe(funding?.rateAnn)
  const signalItems = [
    {
      label:  'IV Rank (30j)',
      value:  ivRankVal != null ? Math.round(ivRankVal) + '/100' : '—',
      detail: ivRankVal > 70 ? 'Vendre vol' : ivRankVal < 30 ? 'Acheter vol' : 'Neutre',
      color:  ivRankVal > 70 ? 'var(--put)' : ivRankVal < 30 ? 'var(--call)' : 'var(--text-muted)',
      score:  ivRankVal,
    },
    {
      label:  'Prime IV / RV',
      value:  ivPremium != null ? fmtSigned(ivPremium, 1) + ' pts' : '—',
      detail: safe(ivPremium) > 15 ? 'Short Vega' : safe(ivPremium) < 2 ? 'Long Vega' : 'Neutre',
      color:  safe(ivPremium) > 15 ? 'var(--put)' : safe(ivPremium) < 2 ? 'var(--call)' : 'var(--text-muted)',
      score:  ivPremium != null ? Math.min(100, Math.max(0, (safe(ivPremium) / IV_PREMIUM_SCORE_DIVISOR) * 100)) : null,
    },
    {
      label:  'Put/Call Ratio',
      value:  dPCR != null ? dPCR.toFixed(3) : '—',
      detail: dPCR > 1.2 ? 'Baissier' : dPCR < 0.7 ? 'Haussier' : 'Neutre',
      color:  dPCR > 1.2 ? 'var(--put)' : dPCR < 0.7 ? 'var(--call)' : 'var(--text-muted)',
      score:  dPCR != null ? Math.min(100, Math.max(0, dPCR * PCR_SCORE_MULTIPLIER)) : null,
    },
    {
      label:  'Funding /an',
      value:  fundingAnn != null ? fmtSigned(fundingAnn, 2) + '%' : '—',
      detail: fundingAnn > 50 ? 'Suracheté' : fundingAnn < 0 ? 'Pression baissière' : 'Neutre',
      color:  fundingAnn > 50 ? 'var(--put)' : fundingAnn < 0 ? 'var(--call)' : 'var(--text-muted)',
      score:  fundingAnn != null ? Math.min(100, Math.max(0, FUNDING_SCORE_OFFSET + fundingAnn / FUNDING_SCORE_DIVISOR)) : null,
    },
  ]

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

      {/* Onglets internes */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 18,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4,
      }}>
        {[
          { id: 'analyse', label: 'Analyse' },
          { id: 'signaux', label: 'Signaux' },
          { id: 'journal', label: 'Journal' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: '7px 0', border: 'none', borderRadius: 7, cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
              background: activeTab === t.id ? 'var(--accent)' : 'transparent',
              color: activeTab === t.id ? '#000' : 'var(--text-muted)',
              transition: 'all .2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════ ONGLET ANALYSE ═══════════════════════════ */}
      {activeTab === 'analyse' && (
        <>
          {/* Cards DVOL + Funding */}
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
            <MetricCard
              label="Funding /an"
              value={funding?.rateAnn != null ? fmtSigned(funding.rateAnn, 2) + '%' : '—'}
              sub={`8h: ${funding?.rate8h != null ? fmtSigned(funding.rate8h, 4) + '%' : '—'}`}
              color={safe(funding?.rateAnn) > 50 ? 'var(--put)' : safe(funding?.rateAnn) < 0 ? 'var(--call)' : 'var(--atm)'}
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
                  {row.putOI != null ? Number(row.putOI).toFixed(0) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: safe(row.pcr) > 1 ? 'var(--put)' : safe(row.pcr) !== null ? 'var(--call)' : 'var(--text-muted)' }}>
                  {safe(row.pcr) !== null ? Number(row.pcr).toFixed(3) : '—'}
                </div>
              </div>
            ))}
          </div>

          {/* ── Prix de règlement Deribit ── */}
          {deliveries?.deliveries?.length > 0 && (
            <>
              <SectionTitle badge="Deribit · Settlement">Prix de règlement</SectionTitle>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {deliveries.deliveries.slice(-10).reverse().map((d, i, arr) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 16px',
                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>{d.date}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--sans)' }}>
                      {'$' + Number(d.price).toLocaleString('en-US', { maximumFractionDigits: asset === 'ETH' ? 2 : 0 })}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Max Pain par échéance ── */}
          {maxPainByExpiry.length > 0 && (() => {
            const activeExpiry = selectedMaxPainExpiry
              ? maxPainByExpiry.find(mp => mp.expiryStr === selectedMaxPainExpiry) ?? maxPainByExpiry[0]
              : maxPainByExpiry[0]
            const mp = activeExpiry

            const mpBadgeColor = mp.direction === 'above' ? 'var(--call)'
              : mp.direction === 'below' ? 'var(--put)'
              : 'var(--text-muted)'

            return (
              <>
                <SectionTitle
                  badge={`$${mp.maxPainStrike.toLocaleString('en-US')} · ${mp.distancePct > 0 ? '+' : ''}${mp.distancePct.toFixed(1)}%`}
                  badgeColor={mpBadgeColor}
                >
                  Max Pain
                </SectionTitle>

                {/* Sélecteur d'échéance */}
                <div style={{
                  display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10,
                  scrollbarWidth: 'none',
                }}>
                  {maxPainByExpiry.map(entry => {
                    const isActive   = (selectedMaxPainExpiry ?? maxPainByExpiry[0]?.expiryStr) === entry.expiryStr
                    const tabColor   = entry.daysToExpiry < 3 ? 'var(--put)'
                      : entry.daysToExpiry < 7 ? 'var(--atm)'
                      : 'var(--text-muted)'
                    return (
                      <button
                        key={entry.expiryStr}
                        onClick={() => setSelectedMaxPainExpiry(entry.expiryStr)}
                        style={{
                          flexShrink: 0, padding: '5px 10px',
                          border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 8, cursor: 'pointer',
                          background: isActive ? 'rgba(0,200,150,0.12)' : 'var(--surface)',
                          color: isActive ? 'var(--accent)' : tabColor,
                          fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700,
                          whiteSpace: 'nowrap',
                          transition: 'all .15s',
                        }}
                      >
                        {entry.expiryStr} · {Math.round(entry.daysToExpiry)}j
                      </button>
                    )
                  })}
                </div>

                <MaxPainChart
                  data={mp}
                  asset={asset}
                  expiryStr={mp.expiryStr}
                  daysToExpiry={mp.daysToExpiry}
                />
              </>
            )
          })()}

          {/* ── Settlements récents ── */}
          {recentSettlements.length > 0 && (() => {
            const validDeltas = recentSettlements
              .map(s => s.spotDeltaPct)
              .filter(d => d != null)
            const avgDelta  = validDeltas.length > 0
              ? validDeltas.reduce((a, b) => a + b, 0) / validDeltas.length
              : null
            const maxDeltaEntry = validDeltas.length > 0
              ? recentSettlements.reduce((best, s) =>
                  s.spotDeltaPct != null &&
                  Math.abs(s.spotDeltaPct) > Math.abs(best?.spotDeltaPct ?? 0)
                    ? s : best
                , recentSettlements[0])
              : null

            return (
              <>
                <SectionTitle badge={`Deribit · ${asset} · 7j`}>
                  Settlements récents
                </SectionTitle>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  {recentSettlements.map((s, i) => (
                    <SettlementRow key={s.dateKey ?? i} settlement={s} asset={asset} isLast={i === recentSettlements.length - 1} />
                  ))}
                </div>
                {/* Statistiques */}
                {(avgDelta != null || maxDeltaEntry) && (
                  <div style={{
                    marginTop: 8, padding: '10px 14px',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, display: 'flex', gap: 16, flexWrap: 'wrap',
                  }}>
                    {avgDelta != null && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>
                          Moy. écart spot
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: avgDelta > 0 ? 'var(--call)' : avgDelta < 0 ? 'var(--put)' : 'var(--text-muted)' }}>
                          {avgDelta > 0 ? '+' : ''}{avgDelta.toFixed(2)}%
                        </div>
                      </div>
                    )}
                    {maxDeltaEntry?.spotDeltaLabel && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>
                          Écart max
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: (maxDeltaEntry.spotDeltaPct ?? 0) > 0 ? 'var(--call)' : 'var(--put)' }}>
                          {maxDeltaEntry.spotDeltaLabel}
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                            ({maxDeltaEntry.dateKey?.slice(5)})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()}

          {/* Hint si pas de données */}
          {!dvol && !dChain?.length && !loading && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Appuie sur Refresh pour charger les données
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════ ONGLET SIGNAUX ═══════════════════════════ */}
      {activeTab === 'signaux' && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px', marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 16 }}>
                  Signaux options — données chargées
                </div>
                {signalItems.map(s => (
                  <SignalBar key={s.label} label={s.label} score={s.score} detail={`${s.value} · ${s.detail}`} color={s.color} />
                ))}
                {signalItems.every(s => s.score == null) && !loading && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                    Appuie sur Refresh pour charger les signaux
                  </div>
                )}
              </div>

              {signalItems.some(s => s.score != null) && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                    Interprétation
                  </div>
                  {[
                    { label: 'IV Rank > 70', note: 'Vol chère → Vendre des options (straddle, strangle, covered call)' },
                    { label: 'IV Rank < 30', note: 'Vol bon marché → Acheter des spreads ou calendrier' },
                    { label: 'Prime IV/RV > 15 pts', note: 'Sell vega : le marché sur-évalue la volatilité future' },
                    { label: 'PCR > 1.2', note: 'Hedging actif → possible support sur une baisse' },
                    { label: 'Funding > 50%/an', note: 'Longs paient cher → risque de long squeeze' },
                  ].map((r, i, arr) => (
                    <div key={r.label} style={{
                      paddingBottom: i < arr.length - 1 ? 10 : 0,
                      marginBottom: i < arr.length - 1 ? 10 : 0,
                      borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                    }}>
                      <div style={{ fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700, color: 'var(--text-dim)', marginBottom: 2 }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{r.note}</div>
                    </div>
                  ))}
                </div>
              )}
        </>
      )}

      {/* ═══════════════════════════ ONGLET JOURNAL ═══════════════════════════ */}
      {activeTab === 'journal' && (
        <>
          {/* Bouton enregistrer snapshot */}
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <button
              onClick={recordSnapshot}
              disabled={!spot && !dvol}
              style={{
                flex: 1, padding: '11px 0',
                background: (!spot && !dvol) ? 'rgba(255,255,255,.04)' : 'rgba(0,212,255,.12)',
                border: '1px solid ' + ((!spot && !dvol) ? 'var(--border)' : 'rgba(0,212,255,.35)'),
                borderRadius: 10, cursor: (!spot && !dvol) ? 'not-allowed' : 'pointer',
                color: (!spot && !dvol) ? 'var(--text-muted)' : 'var(--accent)',
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13,
              }}
            >
              📸 Enregistrer snapshot
            </button>
            {snapshots.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Vider le journal ?')) {
                    setSnapshots([])
                    try { localStorage.removeItem(journalKey(asset)) } catch (e) { console.warn('Journal clear error:', e) }
                  }
                }}
                style={{
                  padding: '11px 14px', background: 'none',
                  border: '1px solid var(--border)', borderRadius: 10,
                  cursor: 'pointer', color: 'var(--text-muted)',
                  fontFamily: 'var(--sans)', fontSize: 12,
                }}
              >
                Vider
              </button>
            )}
          </div>

          {/* Liste des snapshots */}
          {snapshots.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>
                Journal vide
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                Charge les données (Refresh) puis appuie sur<br />
                « Enregistrer snapshot » pour sauvegarder la situation.
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <TableHead cols={['Heure', 'DVOL', 'IV Rank', 'PCR', 'Funding']} />
              {snapshots.map((s, i) => {
                const dt   = new Date(s.ts)
                const time = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                const date = dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
                return (
                  <div key={s.id} style={{
                    display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr',
                    gap: 2, padding: '10px 16px', alignItems: 'center',
                    borderBottom: i < snapshots.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)' }}>{time}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{date}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                      {s.dvol != null ? s.dvol.toFixed(1) : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: s.ivRank > 70 ? 'var(--put)' : s.ivRank < 30 ? 'var(--call)' : 'var(--text)' }}>
                      {s.ivRank != null ? s.ivRank + '/100' : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: s.pcr > 1.2 ? 'var(--put)' : s.pcr < 0.7 ? 'var(--call)' : 'var(--text-muted)' }}>
                      {s.pcr != null ? Number(s.pcr).toFixed(3) : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: s.funding > 50 ? 'var(--put)' : s.funding < 0 ? 'var(--call)' : 'var(--text-muted)' }}>
                      {s.funding != null ? fmtSigned(s.funding, 1) + '%' : '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}


      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12, marginBottom: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
