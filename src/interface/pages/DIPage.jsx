import { useState, useEffect } from 'react'
import { getBestDIOpportunities, getSpot, getFutures, getFuturePrice, getFundingRate } from '../../utils/api.js'
import { calcDIRateSimple, calcTermStructureSignal } from '../../core/market_structure/term_structure.js'

function daysUntil(ts) {
  return Math.max(1, Math.round((ts - Date.now()) / 86400000))
}

function fmtExpiry(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
}

function MetricCard({ label, value, sub, color }) {
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
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

const SIDE_LABELS = { all: 'Tout', 'buy-low': 'Buy Low (PUT)', 'sell-high': 'Sell High (CALL)' }

export default function DIPage({ asset }) {
  const [opps, setOpps] = useState([])
  const [basisRows, setBasisRows] = useState([])
  const [spot, setSpot] = useState(null)
  const [structureSignal, setStructureSignal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [filter, setFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('opps')

  useEffect(() => {
    load()
  }, [asset])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [opportunities, sp, futures, funding] = await Promise.all([
        getBestDIOpportunities(asset).catch(() => []),
        getSpot(asset).catch(() => null),
        getFutures(asset).catch(() => []),
        getFundingRate(asset).catch(() => null),
      ])

      setOpps(opportunities || [])
      setSpot(sp)

      // Build basis rows
      if (sp && futures.length) {
        const rows = []
        await Promise.all(futures.map(async f => {
          try {
            const price = await getFuturePrice(f.instrument_name)
            if (!price) return
            const isPerp = f.instrument_name.includes('PERPETUAL')
            if (isPerp) return
            const days = daysUntil(f.expiration_timestamp)
            const basis = (price - sp) / sp * 100
            const basisAnn = basis / days * 365
            const diRate = calcDIRateSimple(null, days)
            rows.push({
              expiry: fmtExpiry(f.expiration_timestamp),
              price, days, basis, basisAnn, diRate,
            })
          } catch (_) {}
        }))
        rows.sort((a, b) => a.days - b.days)
        setBasisRows(rows)

        // Term structure signal
        if (rows.length && funding) {
          const avg = rows.reduce((s, r) => s + r.basisAnn, 0) / rows.length
          const structure = avg > 0.5 ? 'contango' : avg < -0.5 ? 'backwardation' : 'flat'
          const sig = calcTermStructureSignal({ avgBasisAnn: avg, structure }, funding?.avgAnn7d ?? 0)
          setStructureSignal({ ...sig, structure, avg })
        }
      }

      setLastUpdate(new Date())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const filtered = opps.filter(o => filter === 'all' || o.type === filter)
  const bestAPR = opps.length ? Math.max(...opps.map(o => o.aprMarket ?? 0)) : null
  const bestBasis = basisRows.length ? Math.max(...basisRows.map(r => r.basisAnn)) : null

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">DI <span>{asset}</span></div>
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

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <MetricCard
          label="Meilleur APR"
          value={bestAPR != null ? bestAPR.toFixed(1) + '%' : '—'}
          sub={`Sur ${opps.length} opportunités`}
          color="var(--call)"
        />
        <MetricCard
          label="Basis max /an"
          value={bestBasis != null ? (bestBasis > 0 ? '+' : '') + bestBasis.toFixed(2) + '%' : '—'}
          sub={structureSignal ? (structureSignal.structure === 'contango' ? 'Contango' : structureSignal.structure === 'backwardation' ? 'Backwardation' : 'Flat') : null}
          color={bestBasis > 5 ? 'var(--call)' : bestBasis > 0 ? 'var(--atm)' : 'var(--put)'}
        />
      </div>

      {/* Structure signal */}
      {structureSignal && (
        <div style={{
          background: 'rgba(0,212,255,.05)', border: '1px solid rgba(0,212,255,.2)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
            Signal Structure
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, color: structureSignal.color, marginBottom: 4 }}>
            {structureSignal.signal}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{structureSignal.reason}</div>
        </div>
      )}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 3 }}>
        {[{ id: 'opps', label: 'Opportunités DI' }, { id: 'basis', label: 'Basis par expiry' }].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: '7px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, transition: 'all .15s',
              background: activeTab === t.id ? 'var(--accent)' : 'transparent',
              color: activeTab === t.id ? '#000' : 'var(--text-muted)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Opportunities tab */}
      {activeTab === 'opps' && (
        <>
          {/* Side filter */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {Object.entries(SIDE_LABELS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={{
                  padding: '5px 10px', borderRadius: 20, border: '1px solid',
                  fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 600, cursor: 'pointer',
                  background: filter === k ? (k === 'buy-low' ? 'rgba(255,77,109,.15)' : k === 'sell-high' ? 'rgba(0,229,160,.15)' : 'rgba(0,212,255,.15)') : 'transparent',
                  borderColor: filter === k ? (k === 'buy-low' ? 'rgba(255,77,109,.4)' : k === 'sell-high' ? 'rgba(0,229,160,.4)' : 'rgba(0,212,255,.4)') : 'var(--border)',
                  color: filter === k ? (k === 'buy-low' ? 'var(--put)' : k === 'sell-high' ? 'var(--call)' : 'var(--accent)') : 'var(--text-muted)',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {filtered.length === 0 && !loading && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                {opps.length === 0 ? 'Appuie sur Refresh pour charger' : 'Aucun résultat pour ce filtre'}
              </div>
            )}

            {filtered.map((o, i) => (
              <div key={`${o.strike}-${o.type}-${i}`} style={{
                padding: '12px 16px',
                borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <span style={{
                      fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: o.type === 'sell-high' ? 'rgba(0,229,160,.15)' : 'rgba(255,77,109,.15)',
                      color: o.type === 'sell-high' ? 'var(--call)' : 'var(--put)',
                      border: `1px solid ${o.type === 'sell-high' ? 'rgba(0,229,160,.3)' : 'rgba(255,77,109,.3)'}`,
                    }}>
                      {o.type === 'sell-high' ? 'SELL HIGH' : 'BUY LOW'}
                    </span>
                    <span style={{ marginLeft: 8, fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                      {o.strike?.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: 'var(--call)' }}>
                      {o.aprMarket?.toFixed(1) ?? '—'}%
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>APR marché</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Expiry</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--text)' }}>
                      {new Date(o.ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Jours</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--text)' }}>
                      {o.days ?? '—'}j
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>IV</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--accent2)' }}>
                      {o.iv?.toFixed(1) ?? '—'}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Distance</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--sans)', fontWeight: 600, color: Math.abs(o.distPct) < 5 ? 'var(--put)' : Math.abs(o.distPct) < 10 ? 'var(--atm)' : 'var(--call)' }}>
                      {o.distPct != null ? (o.distPct > 0 ? '+' : '') + o.distPct.toFixed(1) + '%' : '—'}
                    </div>
                  </div>
                </div>

                {/* Score bar */}
                {o.score != null && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Score</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>{o.score.toFixed(0)}/100</span>
                    </div>
                    <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${Math.min(100, o.score)}%`, background: o.score >= 70 ? 'var(--call)' : o.score >= 40 ? 'var(--atm)' : 'var(--put)', borderRadius: 2 }} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Basis tab */}
      {activeTab === 'basis' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {basisRows.length === 0 && !loading && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Appuie sur Refresh pour charger
            </div>
          )}

          {basisRows.map((r, i) => (
            <div key={r.expiry} style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 4, padding: '12px 16px', alignItems: 'center',
              borderBottom: i < basisRows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{r.expiry}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.days}j</div>
              </div>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 12, color: 'var(--text)', textAlign: 'right' }}>
                ${r.price?.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.basis > 0 ? 'var(--call)' : 'var(--put)' }}>
                  {r.basis > 0 ? '+' : ''}{r.basis.toFixed(2)}%
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.basisAnn > 5 ? 'var(--call)' : r.basisAnn > 0 ? 'var(--atm)' : 'var(--put)' }}>
                  {r.basisAnn > 0 ? '+' : ''}{r.basisAnn.toFixed(1)}%/an
                </span>
              </div>
            </div>
          ))}

          {basisRows.length > 0 && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 4, padding: '8px 16px', borderTop: '1px solid var(--border)',
              background: 'rgba(255,255,255,.02)',
            }}>
              {['Échéance', 'Prix', 'Basis', '/an'].map(h => (
                <div key={h} style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', textAlign: h === 'Échéance' ? 'left' : 'right' }}>
                  {h}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 12 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
