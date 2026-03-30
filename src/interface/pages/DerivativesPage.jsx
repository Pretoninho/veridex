/**
 * DerivativesPage — Vue dérivés Deribit
 *
 * Futures Deribit (structure à terme), perpétuels funding Deribit,
 * OI Deribit, prix règlement.
 *
 * Source : Deribit uniquement
 */
import { useState, useEffect, useRef } from 'react'
import * as deribit  from '../../data/providers/deribit.js'

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


export default function DerivativesPage({ asset }) {
  const [state, setState] = useState({
    spot:         null,
    dFunding:     null,
    dFundingHist: null,
    dOI:          null,
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
        spotRes, dFundRes, dFundHistRes, dOIRes, instrRes,
      ] = await Promise.allSettled([
        deribit.getSpot(asset),
        deribit.getFundingRate(asset),
        deribit.getFundingRateHistory(asset, 30),
        deribit.getOpenInterest(asset),
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
        dFunding:     dFundRes.status     === 'fulfilled' ? dFundRes.value     : null,
        dFundingHist: dFundHistRes.status === 'fulfilled' ? dFundHistRes.value : null,
        dOI:          dOIRes.status       === 'fulfilled' ? dOIRes.value       : null,
        futures:      futureRows,
      })
      setLastUpdate(new Date())
    } catch (err) {
      console.warn('DerivativesPage load error:', err)
    }
    if (isMounted.current) setLoading(false)
  }

  const { spot, dFunding, dFundingHist, dOI, futures } = state

  const avgFunding30 = dFundingHist?.history?.length
    ? dFundingHist.history.reduce((s, r) => s + (safe(r.rateAnn) ?? 0), 0) / dFundingHist.history.length
    : null

  const bestBasisAnn = futures
    .filter(r => !r.isPerp && safe(r.basisAnn) !== null)
    .reduce((best, r) => (best === null || r.basisAnn > best ? r.basisAnn : best), null)

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
      </div>

      {/* ── Funding Perpétuel ── */}
      <SectionTitle>Funding Perpétuel Deribit</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <TableHead cols={['Taux 8h', 'Ann.', 'Moy.30p']} />
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          alignItems: 'center', gap: 4, padding: '10px 16px',
        }}>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctColor(dFunding?.rate8h) }}>
            {dFunding?.rate8h != null ? fmtPct(dFunding.rate8h, 4) : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctColor(dFunding?.rateAnn) }}>
            {dFunding?.rateAnn != null ? fmtPct(dFunding.rateAnn) : '—'}
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: pctColor(avgFunding30) }}>
            {avgFunding30 != null ? fmtPct(avgFunding30) : '—'}
          </div>
        </div>
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

      </div>


      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12, marginBottom: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
