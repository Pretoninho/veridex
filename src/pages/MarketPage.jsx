/**
 * MarketPage — Vue marché multi-exchange
 *
 * Prix spot de toutes les plateformes côte à côte,
 * volume, spread, VWAP. Les futures sont dans l'onglet Derivés.
 */
import { useState, useEffect, useRef } from 'react'
import * as deribit  from '../data_core/providers/deribit.js'
import * as binance  from '../data_core/providers/binance.js'
import * as coinbase from '../data_core/providers/coinbase.js'
import * as okx      from '../data_core/providers/okx.js'

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
      const [dSpot, bSpot, cSpot, oSpot] = await Promise.allSettled([
        deribit.getSpot(asset),
        binance.getSpot(asset),
        coinbase.getSpot(asset),
        okx.getSpot(asset),
      ])
      if (!isMounted.current) return
      setSpots({
        deribit:  dSpot.status  === 'fulfilled' ? dSpot.value  : null,
        binance:  bSpot.status  === 'fulfilled' ? bSpot.value  : null,
        coinbase: cSpot.status  === 'fulfilled' ? cSpot.value  : null,
        okx:      oSpot.status  === 'fulfilled' ? oSpot.value  : null,
      })
      setLastUpdate(new Date())
    } catch (_) {}
    if (isMounted.current) setLoading(false)
  }

  // Calculs VWAP + prix individuels
  const allSpots = Object.values(spots).filter(s => s?.price != null)
  const prices   = allSpots.map(s => safe(s.price)).filter(v => v !== null)

  const totalVol = allSpots.reduce((s, t) => s + (safe(t.volume24h) ?? 0), 0)
  const vwap = totalVol > 0
    ? allSpots.reduce((s, t) => s + (safe(t.price) ?? 0) * (safe(t.volume24h) ?? 0), 0) / totalVol
    : prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null

  const minPrice = prices.length ? Math.min(...prices) : null
  const maxPrice = prices.length ? Math.max(...prices) : null
  const spread   = (minPrice && maxPrice && minPrice > 0) ? (maxPrice - minPrice) / minPrice * 100 : null

  const bRaw      = spots.binance?.raw
  const change24h = bRaw?.priceChangePercent != null ? safe(bRaw.priceChangePercent) : null

  const exchanges = [
    { key: 'deribit',  name: 'Deribit',  color: 'var(--accent)', note: 'Index' },
    { key: 'binance',  name: 'Binance',  color: '#F0B90B' },
    { key: 'okx',      name: 'OKX',      color: '#1A84FF' },
    { key: 'coinbase', name: 'Coinbase', color: '#0052FF' },
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
            VWAP {asset}
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: 'var(--accent)' }}>
            {fmtPrice(vwap, asset)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            {allSpots.length} exchange{allSpots.length > 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            24h Change
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: pctColor(change24h) }}>
            {change24h !== null ? (change24h > 0 ? '+' : '') + change24h.toFixed(2) + '%' : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Binance 24h</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            Spread cross-exchange
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: safe(spread) > 0.1 ? 'var(--put)' : 'var(--text-muted)' }}>
            {spread !== null ? spread.toFixed(3) + '%' : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            {fmtPrice(minPrice, asset)} — {fmtPrice(maxPrice, asset)}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            Volume total 24h
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: 'var(--text)' }}>
            {fmtVol(totalVol)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Tous exchanges</div>
        </div>
      </div>

      {/* Tableau spot multi-exchange */}
      <SectionTitle>Spot — Comparaison 4 exchanges</SectionTitle>
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
          const exChange = ex.key === 'binance'
            ? (bRaw?.priceChangePercent != null ? safe(bRaw.priceChangePercent) : null)
            : s?.change24h ?? null
          return (
            <ExchangeRow
              key={ex.key}
              name={ex.name} color={ex.color} note={ex.note}
              price={s?.price} asset={asset}
              bid={s?.bid} ask={s?.ask}
              volume24h={s?.volume24h}
              change24h={exChange}
            />
          )
        })}

        {/* Ligne spread résumé */}
        {allSpots.length >= 2 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,.02)' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Spread max cross-exchange</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: safe(spread) > 0.05 ? 'var(--atm)' : 'var(--call)' }}>
              {spread !== null ? spread.toFixed(4) + '%' : '—'}
            </span>
          </div>
        )}
      </div>

      {/* Prix par exchange (mini bar chart relatif) */}
      {allSpots.length >= 2 && vwap && (
        <>
          <SectionTitle>Prix relatif au VWAP</SectionTitle>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {exchanges.map(ex => {
              const s = spots[ex.key]
              if (!s?.price) return null
              const diff = (s.price - vwap) / vwap * 100
              const barW = Math.abs(diff) * 200  // échelle visuelle
              return (
                <div key={ex.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 60, fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{ex.name}</div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      height: 4, width: `${Math.min(barW, 50)}%`,
                      background: diff >= 0 ? 'var(--call)' : 'var(--put)',
                      borderRadius: 2,
                      marginLeft: diff >= 0 ? '50%' : `${50 - Math.min(barW, 50)}%`,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: pctColor(diff), width: 60, textAlign: 'right' }}>
                    {diff >= 0 ? '+' : ''}{diff.toFixed(4)}%
                  </div>
                </div>
              )
            }).filter(Boolean)}
          </div>
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
