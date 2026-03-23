import { useState, useEffect } from 'react'
import { getDVOL, getATMIV, getRealizedVol, getInstruments, getOrderBook, getAllExpiries } from '../../utils/api.js'
import { analyzeIV } from '../../core/volatility/iv_rank.js'
import { calcSkew25d, interpretSkew } from '../../core/volatility/skew.js'
import { calcOptionGreeks } from '../../core/volatility/greeks.js'

function MetricCard({ label, value, sub, color, bar, barColor }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: color || 'var(--text)' }}>
        {value}
      </div>
      {bar != null && (
        <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, bar))}%`, background: barColor || color || 'var(--accent)', borderRadius: 2, transition: 'width .4s' }} />
        </div>
      )}
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
          {title}
        </div>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {children}
      </div>
    </div>
  )
}

function DataRow({ label, value, color, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 14, color: color || 'var(--text)' }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </div>
  )
}

// Mini sparkline SVG
function Sparkline({ data, color = 'var(--accent)', height = 40 }) {
  if (!data?.length) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 300, h = height
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

export default function VolatilityPage({ asset }) {
  const [dvol, setDvol] = useState(null)
  const [iv, setIv] = useState(null)
  const [rv, setRv] = useState(null)
  const [skewData, setSkewData] = useState(null)
  const [greeksData, setGreeksData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    load()
  }, [asset])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [dvolData, ivData, rvData] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getATMIV(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
      ])
      setDvol(dvolData)
      setIv(ivData)
      setRv(rvData)

      // Skew 25d — find 25-delta options
      try {
        const instruments = await getInstruments(asset)
        const expiries = getAllExpiries(instruments)
        if (expiries.length && ivData?.spot) {
          const sp = ivData.spot
          // Use first expiry > 7 days
          const targetExp = expiries.find(ts => (ts - Date.now()) / 86400000 > 7) || expiries[0]
          const forExp = instruments.filter(i => i.expiration_timestamp === targetExp)
          const strikes = [...new Set(forExp.map(i => i.strike))].sort((a, b) => a - b)

          // ATM strike
          const atmS = strikes.reduce((p, c) => Math.abs(c - sp) < Math.abs(p - sp) ? c : p)
          const atmIdx = strikes.indexOf(atmS)

          // 25d call ≈ 10% OTM call, 25d put ≈ 10% OTM put (approximation)
          const callStrike25 = strikes[Math.min(atmIdx + Math.max(1, Math.round(strikes.length * 0.08)), strikes.length - 1)]
          const putStrike25  = strikes[Math.max(atmIdx - Math.max(1, Math.round(strikes.length * 0.08)), 0)]

          const callInst = forExp.find(x => x.option_type === 'call' && x.strike === callStrike25)
          const putInst  = forExp.find(x => x.option_type === 'put'  && x.strike === putStrike25)

          const [cb, pb] = await Promise.all([
            callInst ? getOrderBook(callInst.instrument_name).catch(() => null) : Promise.resolve(null),
            putInst  ? getOrderBook(putInst.instrument_name).catch(() => null)  : Promise.resolve(null),
          ])

          const callIV25 = cb?.mark_iv ?? null
          const putIV25  = pb?.mark_iv ?? null

          if (callIV25 && putIV25) {
            const skew = calcSkew25d(callIV25, putIV25)
            const interp = interpretSkew(skew?.skew)
            setSkewData({ skew, interp, call25: { strike: callStrike25, iv: callIV25 }, put25: { strike: putStrike25, iv: putIV25 } })
          }

          // ATM Greeks
          if (ivData?.iv && atmS) {
            const T = Math.max(0.01, (targetExp - Date.now()) / (365 * 86400000))
            const greeks = calcOptionGreeks({ type: 'call', S: sp, K: atmS, T, sigma: ivData.iv / 100, r: 0 })
            if (greeks) {
              setGreeksData({ ...greeks, strike: atmS, T: Math.round(T * 365), iv: ivData.iv })
            }
          }
        }
      } catch (_) {}

      setLastUpdate(new Date())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const ivAnalysis = analyzeIV(dvol)
  const ivColor = dvol?.current > 70 ? 'var(--put)' : dvol?.current > 50 ? 'var(--accent2)' : dvol?.current > 35 ? 'var(--atm)' : 'var(--call)'
  const ivPremium = (dvol?.current != null && rv?.current != null) ? dvol.current - rv.current : null

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Volatilité <span>{asset}</span></div>
        <div className="status-row">
          {loading && <div className="dot-live" />}
          <button
            onClick={load}
            disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px', cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 600,
            }}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,77,109,.1)', border: '1px solid rgba(255,77,109,.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--put)' }}>
          {error}
        </div>
      )}

      {/* Top metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <MetricCard
          label="DVOL"
          value={dvol?.current != null ? dvol.current.toFixed(1) + '%' : '—'}
          sub={dvol ? `Min 30j: ${dvol.monthMin.toFixed(1)}% · Max: ${dvol.monthMax.toFixed(1)}%` : null}
          color={ivColor}
        />
        <MetricCard
          label="IV Rank"
          value={ivAnalysis?.ivRank != null ? ivAnalysis.ivRank + '/100' : '—'}
          sub={ivAnalysis?.interpretation?.label}
          color={ivAnalysis?.interpretation?.color}
          bar={ivAnalysis?.ivRank}
          barColor={ivAnalysis?.interpretation?.color}
        />
        <MetricCard
          label="IV Percentile"
          value={ivAnalysis?.ivPercentile != null ? ivAnalysis.ivPercentile + '%' : '—'}
          sub={ivAnalysis?.spike?.isSpike ? '⚡ Spike détecté' : 'des 30 derniers jours'}
          color={ivAnalysis?.ivPercentile > 70 ? 'var(--put)' : ivAnalysis?.ivPercentile > 40 ? 'var(--atm)' : 'var(--call)'}
        />
        <MetricCard
          label="IV vs RV"
          value={ivPremium != null ? (ivPremium > 0 ? '+' : '') + ivPremium.toFixed(1) + '%' : '—'}
          sub={ivPremium > 0 ? 'IV > RV — prime vendeur' : ivPremium < 0 ? 'IV < RV — vol bon marché' : null}
          color={ivPremium > 5 ? 'var(--call)' : ivPremium > 0 ? 'var(--atm)' : 'var(--put)'}
        />
      </div>

      {/* DVOL sparkline */}
      {dvol?.history?.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
            DVOL — 30 jours
          </div>
          <Sparkline data={dvol.history} color={ivColor} height={48} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>il y a 30j</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Aujourd'hui</span>
          </div>
        </div>
      )}

      {/* Realized vol detail */}
      {rv && (
        <Section title="Volatilité Réalisée">
          <DataRow label="RV actuelle" value={rv.current?.toFixed(1) + '%'} color="var(--accent2)" />
          <DataRow
            label="RV moy 30j"
            value={rv.avg30?.toFixed(1) + '%'}
            sub="Volatilité historique"
          />
          {ivPremium != null && (
            <div style={{ background: ivPremium > 0 ? 'rgba(0,229,160,.08)' : 'rgba(255,77,109,.08)', border: `1px solid ${ivPremium > 0 ? 'rgba(0,229,160,.2)' : 'rgba(255,77,109,.2)'}`, borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ fontSize: 12, color: ivPremium > 0 ? 'var(--call)' : 'var(--put)', fontWeight: 700 }}>
                {ivPremium > 0
                  ? `Prime de vol : +${ivPremium.toFixed(1)}% — Favorable pour vendre de la vol`
                  : `Discount de vol : ${ivPremium.toFixed(1)}% — Vol bon marché`}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* Skew 25d */}
      {skewData && (
        <Section title="Skew 25-Delta">
          <DataRow
            label="Call 25Δ"
            value={skewData.call25.iv.toFixed(1) + '%'}
            sub={`Strike ${skewData.call25.strike.toLocaleString('en-US')}`}
            color="var(--call)"
          />
          <DataRow
            label="Put 25Δ"
            value={skewData.put25.iv.toFixed(1) + '%'}
            sub={`Strike ${skewData.put25.strike.toLocaleString('en-US')}`}
            color="var(--put)"
          />
          <DataRow
            label="Skew (Call − Put)"
            value={(skewData.skew?.skew > 0 ? '+' : '') + skewData.skew?.skew?.toFixed(2) + '%'}
            sub={skewData.skew?.label}
            color={skewData.interp?.color}
          />
          <div style={{ background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ fontSize: 12, color: skewData.interp?.color, fontWeight: 700 }}>
              {skewData.interp?.sentiment}
            </span>
          </div>
        </Section>
      )}

      {/* ATM Greeks */}
      {greeksData && (
        <Section title={`Greeks ATM — Strike ${greeksData.strike?.toLocaleString('en-US')} · ${greeksData.T}j · IV ${greeksData.iv?.toFixed(1)}%`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Delta', value: greeksData.delta?.toFixed(3), desc: 'Exposition directionnelle', color: 'var(--accent)' },
              { label: 'Gamma', value: greeksData.gamma?.toFixed(5), desc: 'Convexité du delta', color: 'var(--atm)' },
              { label: 'Theta', value: greeksData.theta?.toFixed(3), desc: 'Décroissance /jour', color: 'var(--put)' },
              { label: 'Vega', value: greeksData.vega?.toFixed(3), desc: 'Sensibilité à la vol', color: 'var(--accent2)' },
            ].map(g => (
              <div key={g.label} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.5px', marginBottom: 4 }}>{g.label}</div>
                <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 18, color: g.color }}>{g.value ?? '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{g.desc}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
