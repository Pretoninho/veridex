import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchMarket }           from '../../api/backend.js'
import { analyzeIV }             from '../../core/volatility/iv_rank.js'
import { analyzeMarketPattern }  from '../../analytics/pattern_engine.js'
import { buildTrade }            from '../../analytics/decision_engine.js'
import { simulateTrade, getPortfolio, resetPortfolio, INIT_BAL, POSITION_PCT } from '../../analytics/portfolio_simulator.js'
import { detectMarketRegime } from '../../analytics/market_regime.js'
import { monteCarlo }         from '../../analytics/monte_carlo.js'
import { riskOfRuin }         from '../../analytics/risk.js'
import TradeDisplay           from '../components/TradeDisplay.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—'
  return '$' + fmt(n)
}

function signalColor(s) {
  if (s === 'LONG')  return 'var(--call)'
  if (s === 'SHORT') return 'var(--put)'
  return 'var(--text-muted)'
}

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)'
  if (s >= 65) return 'var(--call)'
  if (s <= 35) return 'var(--put)'
  return 'var(--atm)'
}

function pnlColor(n) {
  if (!Number.isFinite(n)) return 'var(--text-muted)'
  return n >= 0 ? 'var(--call)' : 'var(--put)'
}

// ── Equity Curve SVG ──────────────────────────────────────────────────────────

function EquityCurve({ trades }) {
  if (!trades || trades.length < 2) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 11, color: 'var(--text-muted)' }}>
        Pas encore assez de trades simulés
      </div>
    )
  }

  const W = 300
  const H = 80
  const pad = 8

  const balances = trades.map(t => t.balance)
  const minB = Math.min(...balances)
  const maxB = Math.max(...balances)
  const range = maxB - minB || 1

  const points = balances.map((b, i) => {
    const x = pad + (i / (balances.length - 1)) * (W - pad * 2)
    const y = H - pad - ((b - minB) / range) * (H - pad * 2)
    return `${x},${y}`
  }).join(' ')

  const lastB = balances[balances.length - 1]
  const firstB = balances[0]
  const lineColor = lastB >= firstB ? 'var(--call)' : 'var(--put)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80, display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  )
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, signal }) {
  const r  = 32
  const cx = 40
  const cy = 40
  const circ = 2 * Math.PI * r
  const dash = score != null ? (score / 100) * circ : 0
  const color = scoreColor(score)

  return (
    <svg width={80} height={80} viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={6} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .6s ease' }}
      />
      <text
        x={cx} y={cy - 4}
        textAnchor="middle"
        fill={color}
        fontSize="14"
        fontWeight="800"
        fontFamily="var(--sans)"
      >
        {score ?? '—'}
      </text>
      <text
        x={cx} y={cy + 12}
        textAnchor="middle"
        fill={signalColor(signal)}
        fontSize="8"
        fontWeight="700"
        fontFamily="var(--sans)"
        letterSpacing="0.5"
      >
        {signal ?? '—'}
      </text>
    </svg>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '16px 18px',
      ...style,
    }}>
      {children}
    </div>
  )
}

function CardTitle({ children }) {
  return (
    <div style={{
      fontSize: 10,
      fontFamily: 'var(--sans)',
      fontWeight: 700,
      letterSpacing: '1px',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssistantPage({ asset }) {
  const [loading,   setLoading]   = useState(true)
  const [signal,    setSignal]    = useState(null)
  const [trade,     setTrade]     = useState(null)
  const [portfolio, setPortfolio] = useState(getPortfolio())
  const [spot,      setSpot]      = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [regime,    setRegime]    = useState(null)
  const [mcAvg,     setMcAvg]     = useState(null)
  const [riskValue, setRiskValue] = useState(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const market = await fetchMarket(asset)
      if (!isMounted.current) return

      const ivAnalysis = analyzeIV(market.dvol)
      const marketInput = {
        ivRank:     ivAnalysis?.ivRank     ?? null,
        fundingPct: market.funding?.rate   ?? null,
        spreadPct:  null,
        lsRatio:    market.lsRatio         ?? null,
        basisPct:   market.basisAvg        ?? null,
      }

      // Market regime
      setRegime(detectMarketRegime({
        price: market.spot,
        dvol:  market.dvol?.current ?? null,
      }))

      const sig = await analyzeMarketPattern(marketInput)
      if (!isMounted.current) return

      const price = market.spot
      const tr    = buildTrade(sig, price)

      setSignal(sig)
      setTrade(tr)
      setSpot(price)
      setLastUpdate(Date.now())

      // Simulate the trade on each refresh (uses current price as exit)
      if (tr && price) {
        const updated = simulateTrade(tr, price)
        setPortfolio({ ...updated })

        // Monte Carlo & Risk of Ruin
        if (updated.trades.length >= 2) {
          const mc  = monteCarlo(updated.trades)
          setMcAvg(mc.reduce((a, b) => a + b, 0) / mc.length)

          const wins = updated.trades.filter(t => (t.pnl ?? 0) > 0).length
          const wr   = wins / updated.trades.length
          setRiskValue(riskOfRuin(wr, updated.balance * POSITION_PCT, updated.balance))
        }
      } else {
        setPortfolio({ ...getPortfolio() })
      }
    } catch (_) {
      if (isMounted.current) setPortfolio({ ...getPortfolio() })
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }, [asset])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const handleReset = () => {
    const fresh = resetPortfolio()
    setPortfolio({ ...fresh })
    setMcAvg(null)
    setRiskValue(null)
  }

  const totalPnl  = portfolio.trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const winTrades = portfolio.trades.filter(t => (t.pnl ?? 0) > 0).length
  const winRate   = portfolio.trades.length > 0
    ? Math.round((winTrades / portfolio.trades.length) * 100)
    : null

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-title">Assistant <span>{asset}</span></div>
        <div className="status-row">
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: loading ? 'var(--text-muted)' : 'var(--accent)',
              fontSize: 11,
              padding: '4px 12px',
              cursor: loading ? 'default' : 'pointer',
              fontFamily: 'var(--sans)',
              fontWeight: 700,
            }}
          >
            {loading ? '...' : '↻ Actualiser'}
          </button>
          {lastUpdate && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
              {new Date(lastUpdate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* ── Bloc Décision ── */}
      <Card style={{ marginBottom: 12 }}>
        <CardTitle>🧠 Décision</CardTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <ScoreRing score={signal?.score ?? null} signal={signal?.signal ?? null} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: 'var(--sans)',
              fontWeight: 800,
              fontSize: 22,
              color: signalColor(signal?.signal),
              marginBottom: 6,
              letterSpacing: '-0.5px',
            }}>
              {loading ? '...' : (signal?.signal ?? '—')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Score&nbsp;
                <span style={{ fontWeight: 700, color: scoreColor(signal?.score) }}>
                  {signal?.score ?? '—'}/100
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Confidence&nbsp;
                <span style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                  {signal?.confidence != null ? `${signal.confidence}%` : '—'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Spot&nbsp;
                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
                  {spot ? fmtUsd(spot) : '—'}
                </span>
              </div>
              {regime && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  Régime&nbsp;
                  <span style={{
                    fontWeight: 700,
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    color: regime.startsWith('bull') ? 'var(--call)'
                      : regime.startsWith('bear')    ? 'var(--put)'
                      : 'var(--atm)',
                  }}>
                    {regime}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        {signal?.confidence != null && (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${signal.confidence}%`,
                background: 'var(--accent)',
                borderRadius: 2,
                transition: 'width .5s',
              }} />
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
              Basé sur {signal?.occurrences ?? 0} occurrences de pattern
            </div>
          </div>
        )}
      </Card>

      {/* ── Bloc Trading ── */}
      <Card style={{ marginBottom: 12 }}>
        <CardTitle>💰 Plan de trade</CardTitle>
        {trade ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Entry</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14, color: 'var(--text-bright)' }}>{fmtUsd(trade.entry)}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Risk/Reward</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>1:{trade.rr}</div>
            </div>
            <div style={{ background: 'rgba(0,200,150,.05)', border: '1px solid rgba(0,200,150,.15)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--call)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Take Profit</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14, color: 'var(--call)' }}>{fmtUsd(trade.tp)}</div>
            </div>
            <div style={{ background: 'rgba(240,71,107,.05)', border: '1px solid rgba(240,71,107,.15)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--put)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Stop Loss</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14, color: 'var(--put)' }}>{fmtUsd(trade.sl)}</div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {loading ? 'Analyse en cours...' : 'Signal NEUTRAL — aucun trade recommandé'}
          </div>
        )}
      </Card>

      {/* ── Bloc Trade Structure ── */}
      {trade && (
        <Card style={{ marginBottom: 12 }}>
          <CardTitle>📋 Structure JSON</CardTitle>
          <TradeDisplay trade={trade} signal={signal} showJSON={true} />
        </Card>
      )}

      {/* ── Bloc Simulation ── */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <CardTitle style={{ marginBottom: 0 }}>📊 Simulation portefeuille</CardTitle>
          <button
            onClick={handleReset}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              fontSize: 10,
              padding: '3px 9px',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
              fontWeight: 700,
            }}
          >
            Reset
          </button>
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Balance</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: 'var(--accent)' }}>
              {fmtUsd(portfolio.balance)}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>P&L total</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: pnlColor(totalPnl) }}>
              {totalPnl >= 0 ? '+' : ''}{fmtUsd(totalPnl)}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Trades</div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: 'var(--text-bright)' }}>
              {portfolio.trades.length}
              {winRate != null && (
                <span style={{ fontSize: 11, fontWeight: 600, color: winRate >= 50 ? 'var(--call)' : 'var(--put)', marginLeft: 5 }}>
                  ({winRate}% win)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Equity curve */}
        <div style={{
          background: 'rgba(255,255,255,.02)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
            Equity curve
          </div>
          <EquityCurve trades={portfolio.trades} />
        </div>

        {/* Monte Carlo + Risk of Ruin */}
        {(mcAvg != null || riskValue != null) && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {mcAvg != null && (
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
                  🧪 Monte Carlo
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13, color: mcAvg >= INIT_BAL ? 'var(--call)' : 'var(--put)' }}>
                  {fmtUsd(mcAvg)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Moy. 1000 sim.</div>
              </div>
            )}
            {riskValue != null && (
              <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
                  ⚠️ Risque ruine
                </div>
                <div style={{
                  fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13,
                  color: riskValue < 0.01 ? 'var(--call)' : riskValue < 0.05 ? 'var(--atm)' : 'var(--put)',
                }}>
                  {(riskValue * 100).toFixed(4)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {riskValue < 0.01 ? 'Excellent' : riskValue < 0.05 ? 'Acceptable' : 'Attention'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Last trades */}
        {portfolio.trades.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Derniers trades
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {portfolio.trades.slice(-5).reverse().map((t, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  background: 'rgba(255,255,255,.02)',
                  borderRadius: 8,
                  fontSize: 11,
                }}>
                  <span style={{ color: signalColor(t.direction), fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {t.direction}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                    {fmtUsd(t.entry)} → {fmtUsd(t.exit)}
                  </span>
                  <span style={{ color: pnlColor(t.pnl), fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {t.pnl >= 0 ? '+' : ''}{fmtUsd(t.pnl)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
          Simulation uniquement · Capital initial {fmtUsd(INIT_BAL)} · Position {POSITION_PCT * 100}% par trade
        </div>
      </Card>

    </div>
  )
}
