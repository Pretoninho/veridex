/**
 * DerivativesPage — Vue dérivés cross-exchange
 *
 * Futures Deribit (structure à terme), perpétuels funding (Deribit / Binance),
 * sentiment Binance, liquidations, OI multi-source, prix règlement.
 *
 * Sources : Deribit + Binance + Coinbase (spot référence fiat)
 */
import { useState, useEffect, useRef } from 'react'
import * as deribit  from '../data_core/providers/deribit.js'
import * as binance  from '../data_core/providers/binance.js'
import * as coinbase from '../data_core/providers/coinbase.js'
import { getNextFundingTime } from '../data_core/providers/clock_sync.js'
import { calcPositioningScore, interpretPositioning } from '../data_processing/signals/positioning_score.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(n) {
  return Number.isFinite(Number(n)) ? Number(n) : null
}

function fmtPct(n, d = 2) {
  const v = safe(n)
  if (v === null) return '—'
  return (v > 0 ? '+' : '') + v.toFixed(d) + '%'
}

function fmtNum(n, d = 2) {
  const v = safe(n)
  if (v === null) return '—'
  return v.toFixed(d)
}

function fmtUSD(n) {
  const v = safe(n)
  if (v === null || v === 0) return '—'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
}

function fmtPrice(n, asset) {
  const v = safe(n)
  if (v === null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: asset === 'ETH' ? 2 : 0 })
}

function fmtExpiry(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: '2-digit',
  }).toUpperCase()
}

function daysUntil(ts) {
  return Math.max(1, Math.round((ts - Date.now()) / 86400000))
}

function pctColor(v) {
  const n = safe(v)
  if (n === null) return 'var(--text-muted)'
  if (n > 0) return 'var(--call)'
  if (n < 0) return 'var(--put)'
  return 'var(--text-muted)'
}

// ── Sous-composants ───────────────────────────────────────────────────────────

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

function Card({ label, value, sub, color, badge }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
        fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: color || 'var(--text)' }}>
          {value}
        </div>
        {badge && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: badge === 'BULL' ? 'rgba(0,255,127,.12)' : badge === 'BEAR' ? 'rgba(255,77,109,.12)' : 'rgba(255,255,255,.06)',
            color: badge === 'BULL' ? 'var(--call)' : badge === 'BEAR' ? 'var(--put)' : 'var(--text-muted)',
          }}>
            {badge}
          </span>
        )}
      </div>
      {sub != null && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function TableHead({ cols, firstLeft = true }) {
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
          textAlign: (i === 0 && firstLeft) ? 'left' : 'right',
        }}>
          {h}
        </div>
      ))}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

// ── Hook countdown funding ────────────────────────────────────────────────────

function useFundingCountdown() {
  const [countdown, setCountdown] = useState(() => getNextFundingTime())
  useEffect(() => {
    const timer = setInterval(() => setCountdown(getNextFundingTime()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return countdown
}

function countdownColor(msRemaining) {
  if (msRemaining < 15 * 60_000)       return '#ff4d6d'  // < 15 min → rouge
  if (msRemaining < 60 * 60_000)       return '#ffa800'  // < 1 h    → orange
  if (msRemaining < 2 * 60 * 60_000)   return '#ffa800'  // < 2 h    → orange
  return 'var(--call)'                                    // > 2 h    → vert
}

export default function DerivativesPage({ asset }) {
  const [state, setState] = useState({
    spot:         null,
    cSpot:        null,   // Coinbase spot fiat
    dFunding:     null,
    bFunding:     null,
    dFundingHist: null,
    sentiment:    null,
    takerVol:     null,
    dOI:          null,
    bOI:          null,
    liquidations: null,
    futures:      [],
  })
  const [loading,    setLoading]    = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    load()
    const timer = setInterval(() => { if (isMounted.current) load() }, 30_000)
    return () => { isMounted.current = false; clearInterval(timer) }
  }, [asset])

  const load = async () => {
    if (!isMounted.current) return
    setLoading(true)
    try {
      const [
        spotRes, cSpotRes, dFundRes, bFundRes, dFundHistRes,
        sentRes, tvRes, dOIRes, bOIRes, liqRes, instrRes,
      ] = await Promise.allSettled([
        deribit.getSpot(asset),
        coinbase.getSpot(asset),
        deribit.getFundingRate(asset),
        binance.getPremiumIndex(asset),
        deribit.getFundingRateHistory(asset, 30),
        binance.getLongShortRatio(asset),
        binance.getTakerVolume(asset),
        deribit.getOpenInterest(asset),
        binance.getOpenInterest(asset),
        binance.getLiquidations(asset),
        deribit.getInstruments(asset, 'future'),
      ])

      if (!isMounted.current) return

      const spotPrice   = spotRes.status === 'fulfilled' ? spotRes.value?.price : null
      const instruments = instrRes.status === 'fulfilled' ? (instrRes.value ?? []) : []

      // ── Structure à terme futures Deribit ────────────────────────────────
      const futureRows = []
      if (instruments.length > 0 && spotPrice) {
        const tickerResults = await Promise.allSettled(
          instruments.slice(0, 10).map(f => deribit.getTicker(f.instrument_name))
        )
        instruments.slice(0, 10).forEach((f, idx) => {
          try {
            const ticker = tickerResults[idx]?.status === 'fulfilled' ? tickerResults[idx].value : null
            if (!ticker?.price) return
            const isPerp   = f.instrument_name.includes('PERPETUAL')
            const days     = isPerp ? null : daysUntil(f.expiration_timestamp)
            const basis    = spotPrice ? (ticker.price - spotPrice) / spotPrice * 100 : null
            const basisAnn = (!isPerp && basis != null && days) ? basis / days * 365 : null
            futureRows.push({
              name: f.instrument_name,
              expiry: isPerp ? 'PERP' : fmtExpiry(f.expiration_timestamp),
              price: ticker.price, days, basis, basisAnn, isPerp,
            })
          } catch (_) {}
        })
        futureRows.sort((a, b) => {
          if (a.isPerp) return -1
          if (b.isPerp) return 1
          return (a.days ?? 9999) - (b.days ?? 9999)
        })
      }

      if (!isMounted.current) return

      setState({
        spot:         spotRes.status      === 'fulfilled' ? spotRes.value      : null,
        cSpot:        cSpotRes.status     === 'fulfilled' ? cSpotRes.value     : null,
        dFunding:     dFundRes.status     === 'fulfilled' ? dFundRes.value     : null,
        bFunding:     bFundRes.status     === 'fulfilled' ? bFundRes.value     : null,
        dFundingHist: dFundHistRes.status === 'fulfilled' ? dFundHistRes.value : null,
        sentiment:    sentRes.status      === 'fulfilled' ? sentRes.value      : null,
        takerVol:     tvRes.status        === 'fulfilled' ? tvRes.value        : null,
        dOI:          dOIRes.status       === 'fulfilled' ? dOIRes.value       : null,
        bOI:          bOIRes.status       === 'fulfilled' ? bOIRes.value       : null,
        liquidations: liqRes.status       === 'fulfilled' ? liqRes.value       : null,
        futures:      futureRows,
      })
      setLastUpdate(new Date())
    } catch (err) {
      console.warn('DerivativesPage load error:', err)
    }
    if (isMounted.current) setLoading(false)
  }

  const { spot, cSpot, dFunding, bFunding, dFundingHist, sentiment, takerVol,
          dOI, bOI, liquidations, futures } = state

  const { hoursRemaining, minutesRemaining, msRemaining } = useFundingCountdown()
  const fundingCountdown = hoursRemaining > 0
    ? `${hoursRemaining}h ${minutesRemaining}m`
    : `${minutesRemaining}m`
  const fundingColor = countdownColor(msRemaining)

  const avgFunding30 = dFundingHist?.history?.length
    ? dFundingHist.history.reduce((s, r) => s + (safe(r.rateAnn) ?? 0), 0) / dFundingHist.history.length
    : null

  const bestBasisAnn = futures
    .filter(r => !r.isPerp && safe(r.basisAnn) !== null)
    .reduce((best, r) => (best === null || r.basisAnn > best ? r.basisAnn : best), null)

  // Exchanges pour le tableau funding
  const fundingRows = [
    { name: 'Deribit', color: 'var(--accent)', rate8h: dFunding?.rate8h, rateAnn: dFunding?.rateAnn, avg: avgFunding30 },
    { name: 'Binance', color: '#F0B90B',       rate8h: bFunding?.rate8h, rateAnn: bFunding?.rateAnn, avg: null },
  ]

  // Exchanges pour le tableau OI
  const oiRows = [
    { name: 'Deribit', type: 'Options', color: 'var(--accent)', callOI: dOI?.callOI, putOI: dOI?.putOI, pcr: dOI?.putCallRatio, total: null },
    { name: 'Binance', type: 'Futures', color: '#F0B90B',       callOI: null,         putOI: null,        pcr: null,              total: bOI?.total },
  ]

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Derivés <span>{asset}</span></div>
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

      {/* Cards résumé */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Card
          label="Long/Short ratio"
          value={sentiment?.ratio != null ? fmtNum(sentiment.ratio, 3) : '—'}
          sub={`L ${fmtNum(sentiment?.longPct, 1)}% · S ${fmtNum(sentiment?.shortPct, 1)}%`}
          color={sentiment?.bullish == null ? 'var(--text)' : sentiment.bullish ? 'var(--call)' : 'var(--put)'}
          badge={sentiment?.bullish == null ? null : sentiment.bullish ? 'BULL' : 'BEAR'}
        />
        <Card
          label="Taker Buy/Sell"
          value={takerVol?.ratio != null ? fmtNum(takerVol.ratio, 3) : '—'}
          sub="Ratio acheteurs / vendeurs"
          color={takerVol?.bullish == null ? 'var(--text)' : takerVol.bullish ? 'var(--call)' : 'var(--put)'}
          badge={takerVol?.bullish == null ? null : takerVol.bullish ? 'BULL' : 'BEAR'}
        />
        <Card
          label="Basis max /an"
          value={bestBasisAnn != null ? fmtPct(bestBasisAnn) : '—'}
          sub="Meilleure échéance Deribit"
          color={safe(bestBasisAnn) > 5 ? 'var(--call)' : safe(bestBasisAnn) > 0 ? 'var(--atm)' : 'var(--text-muted)'}
        />
        <Card
          label={`Spot ${asset}`}
          value={spot?.price != null ? fmtPrice(spot.price, asset) : '—'}
          sub="Deribit index"
          color="var(--accent)"
        />
        <Card
          label={`${asset} / USD`}
          value={cSpot?.price != null ? fmtPrice(cSpot.price, asset) : '—'}
          sub="Coinbase fiat"
          color="var(--text)"
        />
      </div>

      {/* ── Funding Perpétuel — 3 exchanges ── */}
      <SectionTitle>Funding Perpétuel</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <TableHead cols={['Exchange', 'Taux 8h', 'Ann.', 'Moy.30p']} />
        {fundingRows.map((row, i) => (
          <div key={row.name} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            alignItems: 'center', gap: 4, padding: '10px 16px',
            borderBottom: i < fundingRows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700 }}>{row.name}</span>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctColor(row.rate8h) }}>
              {row.rate8h != null ? fmtPct(row.rate8h, 4) : '—'}
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctColor(row.rateAnn) }}>
              {row.rateAnn != null ? fmtPct(row.rateAnn) : '—'}
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: pctColor(row.avg) }}>
              {row.avg != null ? fmtPct(row.avg) : '—'}
            </div>
          </div>
        ))}
        {/* Prochaine fenêtre Binance */}
        {fundingCountdown && (
          <div style={{ padding: '7px 16px', borderTop: '1px solid rgba(255,255,255,.04)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Prochain funding Binance</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: fundingColor }}>{fundingCountdown}</span>
          </div>
        )}
        {/* Spread Deribit − Binance */}
        {safe(dFunding?.rateAnn) !== null && safe(bFunding?.rateAnn) !== null && (
          <div style={{ padding: '7px 16px', borderTop: '1px solid rgba(255,255,255,.04)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Spread Deribit − Binance</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: pctColor(dFunding.rateAnn - bFunding.rateAnn) }}>
              {fmtPct(dFunding.rateAnn - bFunding.rateAnn)}
            </span>
          </div>
        )}
      </div>

      {/* ── Structure à terme futures Deribit ── */}
      <SectionTitle badge="Deribit">Structure à terme — Futures</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <TableHead cols={['Échéance', 'Prix', 'Basis', 'Basis/an']} />
        {futures.length === 0 && !loading && (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Appuie sur Refresh pour charger
          </div>
        )}
        {futures.map((r, i) => (
          <div key={r.name} style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: 4, padding: '11px 16px', alignItems: 'center',
            borderBottom: i < futures.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
            background: r.isPerp ? 'rgba(0,212,255,.03)' : 'transparent',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11, fontWeight: 600, color: r.isPerp ? 'var(--accent)' : 'var(--text)' }}>
                {r.expiry}
              </div>
              {r.days && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.days}j</div>}
            </div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
              {fmtPrice(r.price, asset)}
            </div>
            <div style={{ textAlign: 'right' }}>
              {r.basis != null
                ? <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(r.basis) }}>{fmtPct(r.basis)}</span>
                : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {r.basisAnn != null
                ? <span style={{ fontSize: 12, fontWeight: 700, color: safe(r.basisAnn) > 5 ? 'var(--call)' : safe(r.basisAnn) > 0 ? 'var(--atm)' : 'var(--put)' }}>
                    {fmtPct(r.basisAnn, 1)}</span>
                : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Open Interest — 3 sous-sections ── */}
      <SectionTitle>Open Interest</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>

        {/* ── Deribit · Options ── */}
        <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
          Deribit · Options
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          {[
            { label: 'Call OI', value: dOI?.callOI != null ? `${fmtNum(dOI.callOI, 0)} ₿` : '—', color: 'var(--call)' },
            { label: 'Put OI',  value: dOI?.putOI  != null ? `${fmtNum(dOI.putOI,  0)} ₿` : '—', color: 'var(--put)'  },
            { label: 'P/C',     value: dOI?.putCallRatio != null ? fmtNum(dOI.putCallRatio, 2) : '—',
              color: safe(dOI?.putCallRatio) > 1 ? 'var(--put)' : safe(dOI?.putCallRatio) !== null ? 'var(--call)' : 'var(--text-muted)' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color }}>{value}</div>
            </div>
          ))}
        </div>
        {(dOI?.callOI != null || dOI?.putOI != null) && (() => {
          const total = (dOI.callOI ?? 0) + (dOI.putOI ?? 0)
          const callPct = total > 0 ? Math.min(95, Math.max(5, (dOI.callOI / total) * 100)) : 50
          const putPct  = total > 0 ? Math.min(95, Math.max(5, (dOI.putOI  / total) * 100)) : 50
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${callPct}%`, background: 'var(--call)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--call)', width: 54, textAlign: 'right' }}>Calls {Math.round(callPct)}%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${putPct}%`, background: 'var(--put)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--put)', width: 54, textAlign: 'right' }}>Puts {Math.round(putPct)}%</span>
              </div>
            </div>
          )
        })()}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          {dOI?.putCallRatio != null
            ? dOI.putCallRatio < 0.85
              ? 'Institutionnels offensifs → Plus de calls que de puts'
              : dOI.putCallRatio > 1.15
              ? 'Institutionnels défensifs → Plus de puts que de calls'
              : 'Positionnement institutionnel neutre'
            : 'Données Deribit non disponibles'}
        </div>

        {/* ── Binance · Perpétuels ── */}
        <div style={{ fontSize: 10, color: '#F0B90B', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
          Binance · Perpétuels
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          {[
            { label: 'Long OI',   value: sentiment?.longPct  != null ? `${fmtNum(sentiment.longPct,  1)}%` : '—', color: 'var(--call)' },
            { label: 'Short OI',  value: sentiment?.shortPct != null ? `${fmtNum(sentiment.shortPct, 1)}%` : '—', color: 'var(--put)'  },
            { label: 'L/S Ratio', value: sentiment?.ratio    != null ? fmtNum(sentiment.ratio, 2)        : '—',
              color: sentiment?.bullish == null ? 'var(--text-muted)' : sentiment.bullish ? 'var(--call)' : 'var(--put)' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color }}>{value}</div>
            </div>
          ))}
        </div>
        {(sentiment?.longPct != null || sentiment?.shortPct != null) && (() => {
          const lPct = Math.min(95, Math.max(5, sentiment?.longPct  ?? 50))
          const sPct = Math.min(95, Math.max(5, sentiment?.shortPct ?? 50))
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${lPct}%`, background: 'var(--call)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--call)', width: 54, textAlign: 'right' }}>Longs {Math.round(lPct)}%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${sPct}%`, background: 'var(--put)', borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--put)', width: 54, textAlign: 'right' }}>Shorts {Math.round(sPct)}%</span>
              </div>
            </div>
          )
        })()}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          {sentiment?.ratio != null
            ? sentiment.ratio > 1.5
              ? 'Retail massivement long → Risque de squeeze'
              : sentiment.ratio < 0.7
              ? 'Retail massivement short → Potentiel short squeeze'
              : 'Positionnement retail neutre'
            : 'Données Binance non disponibles'}
        </div>

        {/* ── Signal Combiné ── */}
        {(() => {
          const lsR  = sentiment?.ratio ?? null
          const pcR  = dOI?.putCallRatio ?? null
          if (lsR == null && pcR == null) return null
          const s6   = calcPositioningScore(lsR, pcR)
          const pos  = interpretPositioning(lsR, pcR, s6)
          if (!pos) return null

          const bgColor     = pos.signal === 'bearish' ? 'rgba(240,71,107,.08)'   : pos.signal === 'bullish' ? 'rgba(0,200,150,.08)' : 'rgba(255,255,255,.03)'
          const borderColor = pos.signal === 'bearish' ? 'rgba(240,71,107,.25)'   : pos.signal === 'bullish' ? 'rgba(0,200,150,.25)' : 'var(--border)'
          const icon        = pos.strength === 'strong' ? '⚠' : pos.divergenceType?.startsWith('consensus') ? '✓' : '~'
          const strengthFr  = { strong: 'Forte', moderate: 'Modérée', weak: 'Faible' }[pos.strength] ?? '—'

          return (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Signal combiné
              <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 13, color: 'var(--text)', textTransform: 'none' }}>
                    {icon} {pos.divergenceType === 'retail_bullish_instit_bearish' ? 'Divergence détectée'
                      : pos.divergenceType === 'retail_bearish_instit_bullish' ? 'Divergence détectée'
                      : pos.divergenceType === 'consensus_bullish' ? 'Consensus haussier'
                      : pos.divergenceType === 'consensus_bearish' ? 'Consensus baissier'
                      : 'Neutre'}
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'var(--sans)', fontWeight: 700, textTransform: 'none', color: 'var(--text-muted)' }}>
                    Intensité : {strengthFr}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'none', fontWeight: 400 }}>
                  Retail{' '}
                  <span style={{ color: pos.retailLabel.color === 'put' ? 'var(--put)' : pos.retailLabel.color === 'call' ? 'var(--call)' : 'var(--text-muted)', fontWeight: 700 }}>
                    {pos.retailLabel.label}
                  </span>
                  {' · '}Instit.{' '}
                  <span style={{ color: pos.institutLabel.color === 'put' ? 'var(--put)' : pos.institutLabel.color === 'call' ? 'var(--call)' : 'var(--text-muted)', fontWeight: 700 }}>
                    {pos.institutLabel.label}
                  </span>
                  {' · '}Signal contrarian{' '}
                  <span style={{ fontWeight: 700, color: pos.signal === 'bearish' ? 'var(--put)' : pos.signal === 'bullish' ? 'var(--call)' : 'var(--text-muted)' }}>
                    {pos.signal === 'bearish' ? 'baissier' : pos.signal === 'bullish' ? 'haussier' : 'neutre'}
                  </span>
                </div>
                {pos.expertAction && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, textTransform: 'none', fontWeight: 400, borderTop: `1px solid ${borderColor}`, paddingTop: 8 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.5px' }}>Action : </span>
                    {pos.expertAction}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Sentiment Binance ── */}
      <SectionTitle badge="Binance Futures">Sentiment marché</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
            Long / Short
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--call)', fontWeight: 700 }}>Longs</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{sentiment?.longPct != null ? fmtNum(sentiment.longPct, 1) + '%' : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--put)', fontWeight: 700 }}>Shorts</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{sentiment?.shortPct != null ? fmtNum(sentiment.shortPct, 1) + '%' : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Ratio</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: sentiment?.bullish ? 'var(--call)' : sentiment?.bullish === false ? 'var(--put)' : 'var(--text)' }}>
                {sentiment?.ratio != null ? fmtNum(sentiment.ratio, 3) : '—'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
            Taker Volume
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--call)', fontWeight: 700 }}>Buy</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{takerVol?.buyVol != null ? fmtNum(takerVol.buyVol, 0) : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--put)', fontWeight: 700 }}>Sell</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{takerVol?.sellVol != null ? fmtNum(takerVol.sellVol, 0) : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Ratio</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: takerVol?.bullish ? 'var(--call)' : takerVol?.bullish === false ? 'var(--put)' : 'var(--text)' }}>
                {takerVol?.ratio != null ? fmtNum(takerVol.ratio, 3) : '—'}
              </span>
            </div>
          </div>
        </div>
        {bFunding?.markPrice != null && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Mark / Index Binance
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mark</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtPrice(bFunding.markPrice, asset)}</span>
              </div>
              {bFunding.indexPrice != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Index</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtPrice(bFunding.indexPrice, asset)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        {bOI?.total != null && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              OI Binance Futures
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--sans)' }}>
              {fmtNum(bOI.total, 0)} {asset}
            </div>
          </div>
        )}
      </div>

      {/* ── Liquidations ── */}
      <SectionTitle badge="Binance Futures">Liquidations récentes</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
        {liquidations ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Longs liq.</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--put)', fontFamily: 'var(--sans)' }}>
                  {fmtUSD(liquidations.longLiqUSD)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Shorts liq.</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--call)', fontFamily: 'var(--sans)' }}>
                  {fmtUSD(liquidations.shortLiqUSD)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Total</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--sans)' }}>
                  {fmtUSD(liquidations.total)}
                </div>
              </div>
            </div>
            {liquidations.recent?.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
                  Détail ({liquidations.recent.length})
                </div>
                {liquidations.recent.slice(0, 6).map((l, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '5px 0', borderBottom: i < 5 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: l.side === 'SELL' ? 'var(--put)' : 'var(--call)' }}>
                      {l.side === 'SELL' ? 'LONG LIQ' : 'SHORT LIQ'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text)' }}>{fmtPrice(l.price, asset)}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtUSD(l.value)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {loading ? 'Chargement...' : 'Aucune liquidation récente'}
          </div>
        )}
      </div>

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12, marginBottom: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
