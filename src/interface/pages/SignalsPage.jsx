import { useState, useEffect, useCallback } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getFutures, getFuturePrice, getSpot } from '../../utils/api.js'
import { computeSignal, saveSignal, hashMarketState } from '../../signals/signal_engine.js'
import { interpretSignal }    from '../../signals/signal_interpreter.js'
import { getOnChainSnapshot } from '../../data/providers/onchain.js'
import { normalizeOnChain }   from '../../data/normalizers/format_data.js'
import * as binanceProvider   from '../../data/providers/binance.js'
import * as deribitProvider   from '../../data/providers/deribit.js'
import { generateInsight }    from '../../signals/insight_generator.js'

// ── Sous-composants ──────────────────────────────────────────────────────────

function ScoreBar({ label, score, color }) {
  if (score == null) return null
  const pct = Math.min(100, Math.max(0, score))
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color }}>
          {score}/100
        </span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .5s' }} />
      </div>
    </div>
  )
}

function scoreColor(s) {
  if (s == null) return 'var(--text-muted)'
  return s >= 70 ? 'var(--call)' : s >= 40 ? 'var(--atm)' : 'var(--put)'
}

function Skeleton({ width = '100%', height = 14, style }) {
  return (
    <div style={{
      width, height, borderRadius: 6,
      background: 'linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.05) 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      ...style,
    }} />
  )
}

// ── InsightChip — commentaire Claude court ────────────────────────────────────

const BIAS_STYLE = {
  bullish: { color: 'var(--call)',      bg: 'rgba(0,200,150,.07)',   border: 'rgba(0,200,150,.22)',  left: 'var(--call)'    },
  bearish: { color: 'var(--put)',       bg: 'rgba(240,71,107,.07)',  border: 'rgba(240,71,107,.22)', left: 'var(--put)'     },
  neutral: { color: 'var(--text-muted)', bg: 'rgba(255,255,255,.03)', border: 'rgba(255,255,255,.1)', left: 'var(--border-bright)' },
}

function InsightChip({ text, bias = 'neutral', loading = false, style }) {
  const s = BIAS_STYLE[bias] ?? BIAS_STYLE.neutral
  if (loading) return (
    <div style={{
      height: 30, background: s.bg, border: `1px solid ${s.border}`,
      borderLeft: `3px solid ${s.left}`, borderRadius: '0 8px 8px 0',
      marginTop: 8, animation: 'shimmer 1.4s infinite',
      backgroundSize: '200% 100%',
      backgroundImage: 'linear-gradient(90deg, transparent 25%, rgba(255,255,255,.04) 50%, transparent 75%)',
      ...style,
    }} />
  )
  if (!text) return null
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 7,
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderLeft: `3px solid ${s.left}`,
      borderRadius: '0 8px 8px 0',
      padding: '6px 10px',
      marginTop: 8,
      ...style,
    }}>
      <span style={{ fontSize: 9, color: s.color, fontFamily: 'var(--mono)', fontWeight: 700, marginTop: 1, flexShrink: 0, letterSpacing: '0.5px' }}>AI</span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, fontStyle: 'italic' }}>{text}</span>
    </div>
  )
}

// Hook — charge un insight via generateInsight
function useInsight(metric, value, context, deps = []) {
  const [insight, setInsight] = useState(null)
  const [loadingI, setLoadingI] = useState(false)
  useEffect(() => {
    if (value == null) { setInsight(null); return }
    setLoadingI(true)
    generateInsight({ metric, value, context })
      .then(r => { setInsight(r); setLoadingI(false) })
      .catch(() => setLoadingI(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, value, ...deps])
  return { insight, loadingI }
}

// Bouton copie rapide
function CopyButton({ getText, style }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }
  return (
    <button
      onClick={handleCopy}
      title="Copier"
      style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 7,
        color: copied ? 'var(--call)' : 'var(--text-muted)', fontSize: 13,
        padding: '4px 8px', cursor: 'pointer', lineHeight: 1, transition: 'color .2s',
        ...style,
      }}
    >
      {copied ? '✓' : '📋'}
    </button>
  )
}

// Bloc recommandation marché
function RecoBlock({ icon, title, signal, action, timeframe, stopLoss, accentColor }) {
  const signalColor = {
    'Vendre la vol': 'var(--call)', 'Actif': 'var(--call)', 'Attentif': 'var(--atm)',
    'Spreads vendeurs': 'var(--atm)', 'Modéré': 'var(--atm)', 'Neutre': 'var(--text-muted)',
    'Achats sélectifs': 'var(--accent)', 'Prudent': 'var(--accent2)',
    'Acheter la vol': 'var(--accent)', 'Long vol': 'var(--accent)',
    'Cash': 'var(--put)', 'Défavorable': 'var(--put)',
  }[signal] ?? 'var(--text-muted)'

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden', marginBottom: 10,
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>
            {title}
          </span>
        </div>
        <span style={{
          fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 10,
          color: signalColor, background: `${signalColor}18`,
          border: `1px solid ${signalColor}40`,
          borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          {signal}
        </span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 10 }}>
          {action}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {timeframe && timeframe !== 'N/A' && (
            <span style={{
              fontSize: 10, color: 'var(--text-muted)',
              background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '3px 8px',
            }}>
              ⏱ {timeframe}
            </span>
          )}
          {stopLoss && stopLoss !== 'N/A' && (
            <span style={{
              fontSize: 10, color: 'var(--accent2)',
              background: 'rgba(255,107,53,.06)', border: '1px solid rgba(255,107,53,.2)',
              borderRadius: 6, padding: '3px 8px',
            }}>
              🛡 {stopLoss}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function SignalsPage({ asset }) {
  // Signal data
  const [result,      setResult]      = useState(null)
  const [interpreted, setInterpreted] = useState(null)
  const [rawData,     setRawData]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [lastUpdate,  setLastUpdate]  = useState(null)
  const [history,     setHistory]     = useState([])

  // Positioning
  const [positioning, setPositioning] = useState(null)

  // ── Chargement du signal ──────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dvol, funding, rv, spot, futures, onchainRaw, sentiment, dOI] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getFundingRate(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
        getSpot(asset).catch(() => null),
        getFutures(asset).catch(() => []),
        getOnChainSnapshot(asset).catch(() => null),
        binanceProvider.getLongShortRatio(asset).catch(() => null),
        deribitProvider.getOpenInterest(asset).catch(() => null),
      ])

      const onChainScore = onchainRaw ? (normalizeOnChain(onchainRaw)?.composite?.onChainScore ?? null) : null
      const lsRatio      = sentiment?.ratio ?? null
      const pcRatio      = dOI?.putCallRatio ?? null

      let basisAvg = null
      if (spot && futures.length) {
        const prices = await Promise.all(
          futures
            .filter(f => !f.instrument_name.includes('PERPETUAL'))
            .map(async f => {
              const price = await getFuturePrice(f.instrument_name).catch(() => null)
              if (!price) return null
              const days = Math.max(1, Math.round((f.expiration_timestamp - Date.now()) / 86400000))
              const basis = (price - spot) / spot * 100
              return basis / days * 365
            })
        )
        const valid = prices.filter(p => p != null)
        if (valid.length) basisAvg = valid.reduce((s, v) => s + v, 0) / valid.length
      }

      const raw = { dvol, funding, rv, basisAvg, spot, asset }
      setRawData(raw)

      const sig = computeSignal({ dvol, funding, rv, basisAvg, spot, asset, onChainScore, lsRatio, pcRatio })
      setResult(sig)
      setPositioning(sig?.positioning ?? null)

      if (sig?.global != null) {
        saveSignal({
          asset,
          score:          sig.global,
          conditions:     sig.scores,
          recommendation: sig.signal?.label ?? '—',
          marketHash:     hashMarketState({ dvol, funding, rv, basisAvg }),
        }).catch(() => {})
      }

      const interp = interpretSignal(sig, raw)
      setInterpreted(interp)

      if (sig?.global != null) {
        setHistory(prev => [...prev.slice(-19), { score: sig.global, ts: Date.now() }])
      }

      setLastUpdate(new Date())
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [asset])

  useEffect(() => { load() }, [asset])

  // ── Variables UI ──────────────────────────────────────────────────────────

  const signal  = result?.signal
  const scores  = result?.scores
  const global  = result?.global
  const expert  = interpreted?.expert
  const recos   = expert?.recommendations
  const gColor  = scoreColor(global)

  // Insights Claude
  const { insight: insightScore,   loadingI: loadingScore }   = useInsight('global_score', global,                     { asset }, [asset, global])
  const { insight: insightFunding, loadingI: loadingFunding } = useInsight('funding',       rawData?.funding?.rateAnn, { asset }, [asset, rawData?.funding?.rateAnn])
  const { insight: insightIV,      loadingI: loadingIV }      = useInsight('iv_rank',       scores?.s1,                { asset }, [asset, scores?.s1])

  // Texte pour copie synthesis
  const getSynthesisText = () => {
    if (!expert) return ''
    const lines = [
      `Signal ${asset} — ${expert.label} (${expert.score}/100)`,
      `Situation : ${expert.situation}`,
      '',
      `📈 Spot [${recos?.spot?.signal}] : ${recos?.spot?.action}`,
      `📊 Futures [${recos?.futures?.signal}] : ${recos?.futures?.action}`,
      `⚡ Options [${recos?.options?.signal}] : ${recos?.options?.action}`,
    ]
    return lines.join('\n')
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-title">Signaux <span style={{ color: 'var(--accent)' }}>{asset}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <div className="dot-live" />}
          <button
            onClick={load} disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px',
              cursor: 'pointer', fontFamily: 'var(--sans)', fontWeight: 600,
            }}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(255,77,109,.08)', border: '1px solid rgba(255,77,109,.25)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--put)',
        }}>
          {error}
        </div>
      )}

      {/* ── Score global ── */}
      <div style={{
        background: signal?.bg || 'var(--surface)',
        border: `1px solid ${signal?.border || 'var(--border)'}`,
        borderRadius: 16, padding: '20px 16px', marginBottom: 14, textAlign: 'center',
        position: 'relative',
      }}>
        {global != null && (
          <div style={{ position: 'absolute', top: 12, right: 12 }}>
            <CopyButton getText={getSynthesisText} />
          </div>
        )}
        {global != null ? (
          <>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12 }}>
              <svg width="110" height="110" viewBox="0 0 110 110">
                <circle cx="55" cy="55" r="46" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="8"/>
                <circle
                  cx="55" cy="55" r="46" fill="none"
                  stroke={gColor} strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 46 * global / 100} ${2 * Math.PI * 46}`}
                  strokeLinecap="round"
                  transform="rotate(-90 55 55)"
                  style={{ transition: 'stroke-dasharray .5s' }}
                />
              </svg>
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                fontFamily: 'var(--sans)', fontWeight: 900, fontSize: 26,
                color: gColor, lineHeight: 1,
              }}>
                {global}
              </div>
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 17, color: 'var(--text)', marginBottom: 4 }}>
              {signal?.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{signal?.action}</div>
            <InsightChip text={insightScore?.text} bias={insightScore?.bias} loading={loadingScore} style={{ marginTop: 12, textAlign: 'left' }} />
          </>
        ) : (
          <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            {loading ? 'Calcul du signal...' : 'Appuie sur Refresh pour charger'}
          </div>
        )}
      </div>

      {/* ══════════════════ ANALYSE EXPERT ══════════════════ */}
      {global != null && (
        <>
          {/* Score breakdown */}
          {scores && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12,
              }}>
                Décomposition du score
              </div>
              <ScoreBar label="Volatilité IV — 30%"        score={scores.s1} color={scoreColor(scores.s1)} />
              <InsightChip text={insightIV?.text} bias={insightIV?.bias} loading={loadingIV} style={{ marginBottom: 10 }} />
              <ScoreBar label="Funding Rate — 20%"         score={scores.s2} color={scoreColor(scores.s2)} />
              <InsightChip text={insightFunding?.text} bias={insightFunding?.bias} loading={loadingFunding} style={{ marginBottom: 10 }} />
              <ScoreBar label="Basis Futures — 20%"        score={scores.s3} color={scoreColor(scores.s3)} />
              <ScoreBar label="Prime IV/RV — 15%"          score={scores.s4} color={scoreColor(scores.s4)} />
              <ScoreBar label={`On-Chain — ${scores.s6 != null ? '10' : '15'}%`} score={scores.s5} color={scoreColor(scores.s5)} />
              {scores.s6 != null && (
                <ScoreBar label="Positionnement — 15%" score={scores.s6} color={scoreColor(scores.s6)} />
              )}
              {scores.s6 == null && scores.s5 == null && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  On-Chain &amp; Positionnement : données non disponibles
                </div>
              )}
            </div>
          )}

          {/* Tableau positionnement croisé — Expert uniquement */}
          {positioning && (positioning.lsRatio != null || positioning.pcRatio != null) && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12,
              }}>
                Positionnement croisé
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Source', 'Ratio', 'Signal'].map((h, i) => (
                      <th key={h} style={{
                        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                        fontWeight: 600, textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right',
                        paddingBottom: 8, width: i === 0 ? '40%' : '30%',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Retail */}
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0', fontSize: 12, color: 'var(--text)' }}>
                      Retail <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(Binance)</span>
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                      {positioning.lsRatio != null ? positioning.lsRatio.toFixed(2) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {positioning.lsRatio != null ? (
                        <span style={{
                          fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700,
                          borderRadius: 6, padding: '2px 8px',
                          background: positioning.lsRatio > 1.2 ? 'rgba(240,71,107,.12)'
                            : positioning.lsRatio < 0.8 ? 'rgba(0,200,150,.12)'
                            : 'rgba(255,255,255,.06)',
                          color: positioning.lsRatio > 1.2 ? 'var(--put)'
                            : positioning.lsRatio < 0.8 ? 'var(--call)'
                            : 'var(--text-muted)',
                        }}>
                          {positioning.lsRatio > 1.2 ? 'Long 🔴'
                            : positioning.lsRatio < 0.8 ? 'Short 🟢'
                            : 'Neutre'}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>N/A</span>}
                    </td>
                  </tr>
                  {/* Institutionnels */}
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0', fontSize: 12, color: 'var(--text)' }}>
                      Instit. <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(Deribit)</span>
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                      {positioning.pcRatio != null ? `${positioning.pcRatio.toFixed(2)} P/C` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {positioning.pcRatio != null ? (
                        <span style={{
                          fontSize: 11, fontFamily: 'var(--sans)', fontWeight: 700,
                          borderRadius: 6, padding: '2px 8px',
                          background: positioning.pcRatio > 1.15 ? 'rgba(240,71,107,.12)'
                            : positioning.pcRatio < 0.85 ? 'rgba(0,200,150,.12)'
                            : 'rgba(255,255,255,.06)',
                          color: positioning.pcRatio > 1.15 ? 'var(--put)'
                            : positioning.pcRatio < 0.85 ? 'var(--call)'
                            : 'var(--text-muted)',
                        }}>
                          {positioning.pcRatio > 1.15 ? 'Défensif 🔴'
                            : positioning.pcRatio < 0.85 ? 'Offensif 🟢'
                            : 'Neutre'}
                        </span>
                      ) : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>N/A</span>}
                    </td>
                  </tr>
                  {/* Divergence */}
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>
                      Divergence
                    </td>
                    <td />
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
                        color: positioning.signal === 'bearish' ? 'var(--put)'
                          : positioning.signal === 'bullish' ? 'var(--call)'
                          : 'var(--text-muted)',
                      }}>
                        {positioning.divergenceType === 'retail_bullish_instit_bearish' ? 'Contrarian ⚠'
                          : positioning.divergenceType === 'retail_bearish_instit_bullish' ? 'Contrarian ✓'
                          : positioning.divergenceType === 'consensus_bullish' ? 'Haussier ✓'
                          : positioning.divergenceType === 'consensus_bearish' ? 'Baissier ⚠'
                          : 'Neutre'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              {positioning.expertAction && (
                <div style={{
                  marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
                  fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6,
                }}>
                  <span style={{ fontFamily: 'var(--sans)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.5px' }}>Action </span>
                  {positioning.expertAction}
                </div>
              )}
            </div>
          )}

          {/* Situation marché */}
          {expert?.situation && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8,
              }}>
                Contexte marché
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                {expert.situation}
              </div>
            </div>
          )}

          {/* 3 blocs recommandations */}
          {recos && (
            <div style={{ marginBottom: 4 }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10,
              }}>
                Recommandations par marché
              </div>
              <RecoBlock
                icon="📈" title="Spot"
                signal={recos.spot.signal}
                action={recos.spot.action}
                timeframe={recos.spot.timeframe}
                stopLoss={recos.spot.stopLoss}
              />
              <RecoBlock
                icon="📊" title="Futures / Perp"
                signal={recos.futures.signal}
                action={recos.futures.action}
                timeframe={recos.futures.timeframe}
                stopLoss={recos.futures.stopLoss}
              />
              <RecoBlock
                icon="⚡" title="Options"
                signal={recos.options.signal}
                action={recos.options.action}
                timeframe={recos.options.timeframe}
                stopLoss={recos.options.stopLoss}
              />
            </div>
          )}

          {/* Données sources */}
          {rawData && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, overflow: 'hidden', marginBottom: 14,
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                  fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                }}>
                  Données sources
                </div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                {[
                  { label: 'DVOL actuel',   value: rawData.dvol?.current?.toFixed(1)  != null ? rawData.dvol.current.toFixed(1) + '%' : '—', sub: `Moy 30j: ${rawData.dvol ? ((rawData.dvol.monthMin + rawData.dvol.monthMax) / 2).toFixed(1) : '—'}%` },
                  { label: 'Funding /an',   value: rawData.funding?.rateAnn?.toFixed(2) != null ? rawData.funding.rateAnn.toFixed(2) + '%' : '—', sub: `Moy 7j: ${rawData.funding?.avgAnn7d?.toFixed(2) ?? '—'}%` },
                  { label: 'Basis moy /an', value: rawData.basisAvg != null ? (rawData.basisAvg > 0 ? '+' : '') + rawData.basisAvg.toFixed(2) + '%' : '—', sub: 'Moyenne futures datés' },
                  { label: 'RV actuelle',   value: rawData.rv?.current?.toFixed(1) != null ? rawData.rv.current.toFixed(1) + '%' : '—', sub: `Moy 30j: ${rawData.rv?.avg30?.toFixed(1) ?? '—'}%` },
                ].map((r, i, arr) => (
                  <div key={r.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    paddingBottom: i < arr.length - 1 ? 10 : 0,
                    marginBottom: i < arr.length - 1 ? 10 : 0,
                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.label}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{r.value}</div>
                      {r.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mini chart historique */}
          {history.length > 1 && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10,
              }}>
                Historique session
              </div>
              <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ width: '100%', height: 36 }}>
                <polyline
                  points={history.map((h, i) => `${(i / (history.length - 1)) * 300},${36 - (h.score / 100) * 36}`).join(' ')}
                  fill="none" stroke="var(--accent)" strokeWidth="2"
                />
              </svg>
            </div>
          )}
        </>
      )}

      {lastUpdate && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5, marginTop: 4, marginBottom: 8 }}>
          Mis à jour {lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  )
}
