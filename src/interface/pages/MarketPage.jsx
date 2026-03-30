/**
 * MarketPage — Vue marché Deribit
 *
 * Index spot Deribit et données on-chain.
 * Les dérivés sont dans l'onglet Derivés.
 */
import { useState, useEffect, useRef } from 'react'
import * as deribit  from '../../data/providers/deribit.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(n) {
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

function fmtPrice(n, asset) {
  const v = safe(n)
  if (v === null) return '—'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: asset === 'ETH' ? 2 : 0 })
}

function fmtVol(n) {
  const v = safe(n)
  if (v === null || v === 0) return '—'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(0) + 'M'
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function pctColor(v) {
  const n = safe(v)
  if (n === null) return 'var(--text-muted)'
  if (n > 0) return 'var(--call)'
  if (n < 0) return 'var(--put)'
  return 'var(--text-muted)'
}

// ── Composants ────────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
      fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
      marginBottom: 8, marginTop: 20,
    }}>
      {children}
    </div>
  )
}

function ExchangeRow({ name, color, note, price, asset, bid, ask, volume24h, change24h }) {
  const spread = (safe(bid) !== null && safe(ask) !== null && safe(ask) > 0)
    ? ((ask - bid) / ask * 100)
    : null
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr',
      alignItems: 'center', gap: 6, padding: '11px 16px',
      borderBottom: '1px solid rgba(255,255,255,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div>
          <span style={{ fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700, color: 'var(--text)' }}>
            {name}
          </span>
          {note && <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>{note}</div>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>
          {fmtPrice(price, asset)}
        </div>
        {safe(change24h) !== null && (
          <div style={{ fontSize: 9, color: pctColor(change24h), fontWeight: 700 }}>
            {change24h > 0 ? '+' : ''}{Number(change24h).toFixed(2)}%
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {fmtVol(volume24h)}
        </div>
        {spread !== null && (
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            sprd {spread.toFixed(3)}%
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        {safe(bid) !== null && safe(ask) !== null ? (
          <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <span style={{ color: 'var(--call)' }}>{fmtPrice(bid, asset)}</span>
            {' / '}
            <span style={{ color: 'var(--put)' }}>{fmtPrice(ask, asset)}</span>
          </div>
        ) : (
          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>—</div>
        )}
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function MarketPage({ asset }) {
  const [spots,      setSpots]      = useState({})
  const [loading,    setLoading]    = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    load()
    const timer = setInterval(() => { if (isMounted.current) load() }, 10_000)
    return () => { isMounted.current = false; clearInterval(timer) }
  }, [asset])

  const load = async () => {
    if (!isMounted.current) return
    setLoading(true)
    try {
      const [dSpot] = await Promise.allSettled([
        deribit.getSpot(asset),
      ])
      if (!isMounted.current) return
      setSpots({
        deribit:  dSpot.status  === 'fulfilled' ? dSpot.value  : null,
      })
      setLastUpdate(new Date())
    } catch (_) {}
    if (isMounted.current) setLoading(false)
  }

  // Données Deribit uniquement
  const spotData = spots.deribit
  const spotPrice = safe(spotData?.price)

  const exchanges = [
    { key: 'deribit',  name: 'Deribit',  color: 'var(--accent)', note: 'Index' },
  ]

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Market <span>{asset}</span></div>
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

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            Spot {asset}
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: 'var(--accent)' }}>
            {fmtPrice(spotPrice, asset)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Deribit Index</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            Volume 24h
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>
            {fmtVol(spotData?.volume24h)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Deribit</div>
        </div>
      </div>

      {/* Tableau spot Deribit */}
      <SectionTitle>Spot — Deribit Index</SectionTitle>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header colonnes */}
        <div style={{
          display: 'grid', gridTemplateColumns: '80px 1fr 1fr 1fr',
          gap: 6, padding: '8px 16px',
          background: 'rgba(255,255,255,.02)', borderBottom: '1px solid var(--border)',
        }}>
          {['Exchange', 'Prix', 'Vol 24h', 'Bid / Ask'].map((h, i) => (
            <div key={h} style={{
              fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
              fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase',
              textAlign: i === 0 ? 'left' : 'right',
            }}>{h}</div>
          ))}
        </div>

        {exchanges.map(ex => {
          const s = spots[ex.key]
          return (
            <ExchangeRow
              key={ex.key}
              name={ex.name} color={ex.color} note={ex.note}
              price={s?.price} asset={asset}
              bid={s?.bid} ask={s?.ask}
              volume24h={s?.volume24h}
              change24h={s?.change24h}
            />
          )
        })}
      </div>

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12, marginBottom: 4 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
