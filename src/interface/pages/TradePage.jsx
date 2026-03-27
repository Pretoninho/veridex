import { useState, useEffect } from 'react'
import { getSpot } from '../../utils/api.js'

// ── Equity Chart ──────────────────────────────────────────────────────────────

/**
 * Graphique SVG de la performance cumulée (equity curve) basé sur l'historique
 * des trades settlés.
 */
function EquityChart({ history }) {
  const sorted = [...history]
    .filter(t => t.settledTs != null)
    .sort((a, b) => a.settledTs - b.settledTs)

  if (sorted.length < 2) return null

  const points = sorted.reduce((acc, t, i) => {
    const prev = i === 0 ? 0 : acc[i - 1].cum
    acc.push({ cum: prev + (t.pnl ?? 0), ts: t.settledTs })
    return acc
  }, [])

  const W = 300
  const H = 60
  const minV = Math.min(0, ...points.map(p => p.cum))
  const maxV = Math.max(0, ...points.map(p => p.cum))
  const range = maxV - minV || 1

  const toX = (i) => (i / (points.length - 1)) * W
  const toY = (v) => H - ((v - minV) / range) * (H - 4) - 2

  const polylinePoints = points.map((p, i) => `${toX(i)},${toY(p.cum)}`).join(' ')
  const finalCum = points[points.length - 1].cum
  const lineColor = finalCum >= 0 ? 'var(--call)' : 'var(--put)'

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{
        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
        fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4,
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Equity Curve</span>
        <span style={{ color: lineColor, fontFamily: 'var(--mono)' }}>
          {finalCum >= 0 ? '+' : ''}{finalCum.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60 }}>
        {/* Zero line */}
        {minV < 0 && maxV > 0 && (
          <line
            x1="0" y1={toY(0)} x2={W} y2={toY(0)}
            stroke="rgba(255,255,255,.12)" strokeWidth="1" strokeDasharray="4 3"
          />
        )}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Last point dot */}
        <circle
          cx={toX(points.length - 1)} cy={toY(finalCum)}
          r="3" fill={lineColor}
        />
      </svg>
    </div>
  )
}

const LS_POSITIONS = 'paper_di_positions'
const LS_HISTORY   = 'paper_di_history'

function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase()
}

function daysLeft(position) {
  if (!position.expiryTs) return null
  return Math.max(0, Math.round((position.expiryTs - Date.now()) / 86400000))
}

function calcAccruedPnl(pos, spot) {
  if (!spot) return null
  const elapsed = Math.max(0, (Date.now() - pos.entryTs) / 86400000)
  const progress = Math.min(1, elapsed / Math.max(pos.days, 0.01))
  const premium = pos.side === 'sell-high'
    ? pos.collateral * pos.apr / 100 * (pos.days / 365) * spot
    : pos.collateral * pos.apr / 100 * (pos.days / 365)
  return premium * progress
}

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(LS_POSITIONS) || '[]') } catch { return [] }
}

function savePositions(list) {
  localStorage.setItem(LS_POSITIONS, JSON.stringify(list))
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || '[]') } catch { return [] }
}

function saveHistory(list) {
  localStorage.setItem(LS_HISTORY, JSON.stringify(list))
}

const BLANK_FORM = { side: 'sell-high', strike: '', apr: '', collateral: '', days: '', note: '' }

export default function TradePage({ asset }) {
  const [positions, setPositions] = useState([])
  const [history, setHistory]     = useState([])
  const [spots, setSpots]         = useState({})
  const [activeTab, setActiveTab] = useState('positions')
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(BLANK_FORM)
  const [settleModal, setSettleModal] = useState(null)
  const [settleSpot, setSettleSpot]   = useState('')

  useEffect(() => {
    setPositions(loadPositions())
    setHistory(loadHistory())
    loadSpots()
  }, [])

  const loadSpots = async () => {
    try {
      const [btc, eth] = await Promise.all([
        getSpot('BTC').catch(() => null),
        getSpot('ETH').catch(() => null),
      ])
      setSpots({ BTC: btc, ETH: eth })
    } catch (_) {}
  }

  const submitForm = () => {
    const strike = Number(form.strike)
    const apr    = Number(form.apr)
    const coll   = Number(form.collateral)
    const days   = Number(form.days)
    if (!strike || !apr || !coll || !days) return

    const now = Date.now()
    const pos = {
      id: now,
      asset,
      side: form.side,
      strike, apr, days,
      collateral: coll,
      note: form.note,
      entryTs: now,
      expiryTs: now + days * 86400000,
      entrySpot: spots[asset] ?? null,
    }
    const updated = [...positions, pos]
    setPositions(updated)
    savePositions(updated)
    setForm(BLANK_FORM)
    setShowForm(false)
  }

  const settlePosition = (pos) => {
    const spot = Number(settleSpot)
    if (!spot) return

    const exercised = pos.side === 'sell-high' ? spot >= pos.strike : spot <= pos.strike
    const totalPremium = pos.side === 'sell-high'
      ? pos.collateral * pos.apr / 100 * (pos.days / 365) * (pos.entrySpot || spot)
      : pos.collateral * pos.apr / 100 * (pos.days / 365)

    const finalValue = exercised
      ? (pos.side === 'sell-high'
        ? pos.collateral * pos.strike + totalPremium
        : (pos.collateral / pos.strike) * spot + totalPremium)
      : (pos.side === 'sell-high'
        ? (pos.collateral + pos.collateral * pos.apr / 100 * (pos.days / 365)) * spot
        : pos.collateral + totalPremium)

    const pnl = pos.side === 'sell-high'
      ? finalValue - pos.collateral * (pos.entrySpot || spot)
      : finalValue - pos.collateral

    const record = {
      ...pos,
      settledTs: Date.now(),
      settleSpot: spot,
      exercised,
      pnl,
      totalPremium,
    }

    const updatedPos = positions.filter(p => p.id !== pos.id)
    const updatedHist = [record, ...loadHistory()].slice(0, 50)
    setPositions(updatedPos)
    setHistory(updatedHist)
    savePositions(updatedPos)
    saveHistory(updatedHist)
    setSettleModal(null)
    setSettleSpot('')
  }

  const removePosition = (id) => {
    const updated = positions.filter(p => p.id !== id)
    setPositions(updated)
    savePositions(updated)
  }

  const openPositions  = positions.filter(p => !p.asset || p.asset === asset)
  const recentHistory  = history.filter(p => !p.asset || p.asset === asset).slice(0, 20)
  const spot           = spots[asset]
  const totalPnlOpen   = openPositions.reduce((s, p) => s + (calcAccruedPnl(p, spot) ?? 0), 0)
  const totalPnlHistory = recentHistory.reduce((s, p) => s + (p.pnl ?? 0), 0)

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="page-header">
        <div className="page-title">Trade <span>{asset}</span></div>
        <div className="status-row">
          <button
            onClick={() => { setForm({ ...BLANK_FORM }); setShowForm(true) }}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 8,
              color: '#000', fontSize: 11, padding: '4px 12px', cursor: 'pointer',
              fontFamily: 'var(--sans)', fontWeight: 700,
            }}
          >
            + Nouvelle position
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>Positions ouvertes</div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: 'var(--accent)' }}>{openPositions.length}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>P&L accrué : <span style={{ color: totalPnlOpen >= 0 ? 'var(--call)' : 'var(--put)', fontWeight: 700 }}>{totalPnlOpen >= 0 ? '+' : ''}{fmtUsd(totalPnlOpen)}</span></div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>P&L historique</div>
          <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 20, color: totalPnlHistory >= 0 ? 'var(--call)' : 'var(--put)' }}>
            {totalPnlHistory >= 0 ? '+' : ''}{fmtUsd(totalPnlHistory)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{recentHistory.length} trades settlés</div>
        </div>
      </div>

      {/* Spot reference */}
      {spot && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Spot {asset} : <span style={{ color: 'var(--accent)', fontWeight: 700 }}>${spot?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        </div>
      )}

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 3 }}>
        {[{ id: 'positions', label: 'Ouvertes' }, { id: 'history', label: 'Historique' }].map(t => (
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

      {/* Open positions */}
      {activeTab === 'positions' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {openPositions.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Aucune position ouverte — crée-en une avec le bouton ci-dessus
            </div>
          ) : openPositions.map((p, i) => {
            const accrued = calcAccruedPnl(p, spot)
            const left = daysLeft(p)
            return (
              <div key={p.id} style={{ padding: '14px 16px', borderBottom: i < openPositions.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{
                      fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: p.side === 'sell-high' ? 'rgba(0,229,160,.15)' : 'rgba(255,77,109,.15)',
                      color: p.side === 'sell-high' ? 'var(--call)' : 'var(--put)',
                      border: `1px solid ${p.side === 'sell-high' ? 'rgba(0,229,160,.3)' : 'rgba(255,77,109,.3)'}`,
                    }}>
                      {p.side === 'sell-high' ? 'SELL HIGH' : 'BUY LOW'}
                    </span>
                    <span style={{ marginLeft: 8, fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                      {p.asset} @ ${p.strike?.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--call)' }}>
                    {p.apr?.toFixed(1)}% APR
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Expiry</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{fmtDate(p.expiryTs)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Restant</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: left <= 3 ? 'var(--put)' : 'var(--text)' }}>
                      {left != null ? left + 'j' : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>P&L accrué</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: accrued >= 0 ? 'var(--call)' : 'var(--put)' }}>
                      {accrued != null ? (accrued >= 0 ? '+' : '') + fmtUsd(accrued) : '—'}
                    </div>
                  </div>
                </div>

                {p.note && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontStyle: 'italic' }}>"{p.note}"</div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => { setSettleModal(p); setSettleSpot(spot?.toFixed(0) ?? '') }}
                    style={{
                      flex: 1, padding: '6px', borderRadius: 8, border: '1px solid rgba(0,212,255,.3)',
                      background: 'rgba(0,212,255,.08)', color: 'var(--accent)',
                      fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    Settle
                  </button>
                  <button
                    onClick={() => removePosition(p.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,77,109,.3)',
                      background: 'rgba(255,77,109,.08)', color: 'var(--put)',
                      fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      {activeTab === 'history' && (
        <>
          <EquityChart history={recentHistory} />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {recentHistory.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Aucun trade settlé pour l'instant
            </div>
          ) : recentHistory.map((p, i) => (
            <div key={p.id} style={{ padding: '12px 16px', borderBottom: i < recentHistory.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {p.asset} {p.side === 'sell-high' ? 'SELL HIGH' : 'BUY LOW'} @ ${p.strike?.toLocaleString('en-US')}
                </div>
                <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 14, color: p.pnl >= 0 ? 'var(--call)' : 'var(--put)' }}>
                  {p.pnl >= 0 ? '+' : ''}{fmtUsd(p.pnl)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>Entrée {fmtDate(p.entryTs)}</span>
                <span>Settlement {fmtDate(p.settledTs)}</span>
                <span style={{ color: p.exercised ? 'var(--put)' : 'var(--call)', fontWeight: 700 }}>
                  {p.exercised ? 'Exercé' : 'Expiré OTM'}
                </span>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {/* Add position form (modal-like) */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 200,
          display: 'flex', alignItems: 'flex-end',
        }}>
          <div style={{
            width: '100%', background: 'var(--bg)', borderRadius: '20px 20px 0 0',
            padding: '24px 20px', paddingBottom: 'calc(24px + var(--safe-bottom, 0px))',
            maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>Nouvelle position</div>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            {/* Side toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>Type</div>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: 3 }}>
                {[{ id: 'sell-high', label: 'Sell High (CALL)' }, { id: 'buy-low', label: 'Buy Low (PUT)' }].map(s => (
                  <button
                    key={s.id}
                    onClick={() => setForm(f => ({ ...f, side: s.id }))}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 11, transition: 'all .15s',
                      background: form.side === s.id ? (s.id === 'sell-high' ? 'var(--call)' : 'var(--put)') : 'transparent',
                      color: form.side === s.id ? '#000' : 'var(--text-muted)',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {[
              { key: 'strike', label: 'Strike ($)', placeholder: asset === 'BTC' ? '90000' : '3000', type: 'number' },
              { key: 'apr', label: 'APR (%)', placeholder: '25', type: 'number' },
              { key: 'collateral', label: `Collateral (${form.side === 'sell-high' ? asset : 'USDC'})`, placeholder: form.side === 'sell-high' ? (asset === 'BTC' ? '0.1' : '1') : '1000', type: 'number' },
              { key: 'days', label: 'Durée (jours)', placeholder: '7', type: 'number' },
              { key: 'note', label: 'Note (optionnel)', placeholder: 'ex: Nexo BTC 7j', type: 'text' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>{f.label}</div>
                <input
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    color: 'var(--text)', fontSize: 14, fontFamily: 'var(--sans)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            <button
              onClick={submitForm}
              style={{
                width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: '#000',
                fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15, marginTop: 4,
              }}
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Settle modal */}
      {settleModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 200,
          display: 'flex', alignItems: 'flex-end',
        }}>
          <div style={{
            width: '100%', background: 'var(--bg)', borderRadius: '20px 20px 0 0',
            padding: '24px 20px', paddingBottom: 'calc(24px + var(--safe-bottom, 0px))',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>
                Settle — {settleModal.asset} @ ${settleModal.strike?.toLocaleString('en-US')}
              </div>
              <button onClick={() => setSettleModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Prix spot à la settlement ($)
            </div>
            <input
              type="number"
              value={settleSpot}
              onChange={e => setSettleSpot(e.target.value)}
              placeholder={spot?.toFixed(0) ?? '0'}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 16, fontFamily: 'var(--sans)',
                outline: 'none', marginBottom: 16, boxSizing: 'border-box',
              }}
            />

            <button
              onClick={() => settlePosition(settleModal)}
              style={{
                width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: '#000',
                fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 15,
              }}
            >
              Confirmer le settlement
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
