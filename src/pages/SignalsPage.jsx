import { useState, useEffect, useCallback } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getFutures, getFuturePrice, getSpot } from '../utils/api.js'
import { computeSignal }         from '../data_processing/signals/signal_engine.js'
import { interpretSignal }       from '../data_processing/signals/signal_interpreter.js'
import { generateNoviceContent } from '../data_processing/signals/novice_generator.js'
import { DEFAULT_TONE }          from '../data_processing/signals/tone_config.js'
import ToneSelector              from '../components/ToneSelector.jsx'

const LS_TONE_KEY = 'selected_tone'

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

// Skeleton pour une ligne de texte
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

function NoviceSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
      <Skeleton width="60%" height={20} />
      <Skeleton width="90%" />
      <Skeleton width="80%" />
      <div style={{ marginTop: 6 }}>
        <Skeleton width="40%" height={11} style={{ marginBottom: 6 }} />
        {[1, 2, 3].map(i => <Skeleton key={i} width={`${70 + i * 5}%`} height={13} style={{ marginBottom: 5 }} />)}
      </div>
      <Skeleton width="85%" height={13} />
      <Skeleton width="75%" height={13} />
      <Skeleton width="50%" height={34} style={{ borderRadius: 10, marginTop: 4 }} />
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function SignalsPage({ asset }) {
  // Signal data
  const [result,      setResult]      = useState(null)    // computeSignal output
  const [interpreted, setInterpreted] = useState(null)    // { expert, noviceData }
  const [rawData,     setRawData]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [lastUpdate,  setLastUpdate]  = useState(null)
  const [history,     setHistory]     = useState([])

  // Novice layer
  const [selectedTone,     setSelectedTone]     = useState(() => localStorage.getItem(LS_TONE_KEY) ?? DEFAULT_TONE)
  const [noviceContent,    setNoviceContent]    = useState(null)
  const [isGenerating,     setIsGenerating]     = useState(false)
  const [generationError,  setGenerationError]  = useState(null)

  // UI
  const [mode, setMode] = useState('expert') // 'expert' | 'novice'

  // ── Chargement du signal ──────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dvol, funding, rv, spot, futures] = await Promise.all([
        getDVOL(asset).catch(() => null),
        getFundingRate(asset).catch(() => null),
        getRealizedVol(asset).catch(() => null),
        getSpot(asset).catch(() => null),
        getFutures(asset).catch(() => []),
      ])

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

      const sig = computeSignal({ dvol, funding, rv, basisAvg, spot, asset })
      setResult(sig)

      const interp = interpretSignal(sig, raw)
      setInterpreted(interp)

      if (sig?.global != null) {
        setHistory(prev => [...prev.slice(-19), { score: sig.global, ts: Date.now() }])
      }

      setLastUpdate(new Date())

      // Générer la couche novice automatiquement
      if (interp?.noviceData) {
        generateNovice(interp.noviceData, selectedTone)
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [asset, selectedTone])

  // ── Génération couche novice ──────────────────────────────────────────────

  const generateNovice = useCallback(async (noviceData, toneId) => {
    if (!noviceData) return
    setIsGenerating(true)
    setGenerationError(null)
    try {
      const content = await generateNoviceContent(noviceData, toneId)
      setNoviceContent(content)
      if (content.is_fallback) {
        setGenerationError('Version simplifiée (analyse IA indisponible)')
      }
    } catch {
      setGenerationError('Génération indisponible')
    }
    setIsGenerating(false)
  }, [])

  // ── Changement de ton ─────────────────────────────────────────────────────

  const handleToneChange = useCallback((toneId) => {
    setSelectedTone(toneId)
    localStorage.setItem(LS_TONE_KEY, toneId)
    if (interpreted?.noviceData) {
      generateNovice(interpreted.noviceData, toneId)
    }
  }, [interpreted, generateNovice])

  // ── Regénération ──────────────────────────────────────────────────────────

  const regenerate = useCallback(() => {
    if (interpreted?.noviceData) {
      generateNovice(interpreted.noviceData, selectedTone)
    }
  }, [interpreted, selectedTone, generateNovice])

  useEffect(() => { load() }, [asset])

  // ── Variables UI ──────────────────────────────────────────────────────────

  const signal     = result?.signal
  const scores     = result?.scores
  const global     = result?.global
  const expert     = interpreted?.expert
  const gColor     = scoreColor(global)

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
      }}>
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
          </>
        ) : (
          <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            {loading ? 'Calcul du signal...' : 'Appuie sur Refresh pour charger'}
          </div>
        )}
      </div>

      {/* ── Toggle Expert / Novice ── */}
      {global != null && (
        <div style={{
          display: 'flex', gap: 0, marginBottom: 14,
          background: 'rgba(255,255,255,.04)', borderRadius: 12, padding: 3,
        }}>
          {[
            { id: 'expert', label: '⚡ Expert' },
            { id: 'novice', label: '👤 Simple' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              style={{
                flex: 1, padding: '8px 0', border: 'none', borderRadius: 10,
                fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 13,
                cursor: 'pointer',
                background: mode === id ? 'var(--accent)' : 'transparent',
                color: mode === id ? 'var(--bg)' : 'var(--text-muted)',
                transition: 'background .18s, color .18s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════ MODE EXPERT ══════════════════ */}
      {mode === 'expert' && (
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
                Décomposition
              </div>
              <ScoreBar label="Volatilité IV — 30%"    score={scores.s1} color={scoreColor(scores.s1)} />
              <ScoreBar label="Funding Rate — 20%"     score={scores.s2} color={scoreColor(scores.s2)} />
              <ScoreBar label="Basis Futures — 20%"    score={scores.s3} color={scoreColor(scores.s3)} />
              <ScoreBar label="Prime IV/RV — 15%"      score={scores.s4} color={scoreColor(scores.s4)} />
              <ScoreBar label="On-Chain — 15%"         score={scores.s5} color={scoreColor(scores.s5)} />
            </div>
          )}

          {/* Expert action */}
          {expert && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, marginBottom: 14, overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                  fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                }}>
                  Analyse Technique
                </div>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7, marginBottom: 12 }}>
                  {expert.situation}
                </div>
                <div style={{
                  background: `${expert.bg}`, border: `1px solid ${expert.border}`,
                  borderRadius: 10, padding: '12px 14px', marginBottom: 12,
                }}>
                  <div style={{
                    fontSize: 10, fontFamily: 'var(--sans)', fontWeight: 700,
                    color: expert.color, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6,
                  }}>
                    Action recommandée
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
                    {expert.action}
                  </div>
                </div>
                {[
                  { label: 'Durée cible',  val: expert.duration },
                  { label: 'Stop / sortie', val: expert.stopLoss },
                ].map(({ label, val }) => val && (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,.04)',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginRight: 10 }}>{label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>{val}</span>
                  </div>
                ))}
              </div>
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

      {/* ══════════════════ MODE NOVICE ══════════════════ */}
      {mode === 'novice' && global != null && (
        <>
          {/* Sélecteur de ton */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '14px 16px', marginBottom: 14,
          }}>
            <ToneSelector
              selectedTone={selectedTone}
              onToneChange={handleToneChange}
              isGenerating={isGenerating}
            />
          </div>

          {/* Contenu novice */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px', marginBottom: 14,
          }}>
            {isGenerating ? (
              <NoviceSkeleton />
            ) : noviceContent ? (
              <>
                {/* Headline */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{noviceContent.emoji}</span>
                  <div style={{ fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 16, color: 'var(--text)', lineHeight: 1.2 }}>
                    {noviceContent.headline}
                  </div>
                </div>

                {/* Métaphore */}
                <div style={{
                  fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic',
                  lineHeight: 1.6, marginBottom: 14, paddingLeft: 12,
                  borderLeft: '2px solid var(--border-bright)',
                }}>
                  {noviceContent.metaphor}
                </div>

                {/* Situation */}
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 14 }}>
                  {noviceContent.situation}
                </div>

                {/* Étapes */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{
                    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8,
                  }}>
                    Quoi faire
                  </div>
                  {(noviceContent.steps ?? []).map((step, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 6, background: 'rgba(0,212,255,.12)',
                        color: 'var(--accent)', fontFamily: 'var(--sans)', fontWeight: 800,
                        fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {i + 1}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{step}</span>
                    </div>
                  ))}
                </div>

                {/* Gain + Risque */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14,
                }}>
                  <div style={{
                    background: 'rgba(0,229,160,.06)', border: '1px solid rgba(0,229,160,.2)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--call)', fontFamily: 'var(--sans)', fontWeight: 700, marginBottom: 4 }}>
                      💰 Potentiel
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      {noviceContent.gain}
                    </div>
                  </div>
                  <div style={{
                    background: 'rgba(255,107,53,.06)', border: '1px solid rgba(255,107,53,.2)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--accent2)', fontFamily: 'var(--sans)', fontWeight: 700, marginBottom: 4 }}>
                      ⚠️ Risque
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      {noviceContent.risk}
                    </div>
                  </div>
                </div>

                {/* Appel à l'action */}
                <div style={{
                  background: 'rgba(0,212,255,.07)', border: '1px solid rgba(0,212,255,.25)',
                  borderRadius: 10, padding: '12px 14px', marginBottom: 14,
                  fontSize: 13, color: 'var(--accent)', lineHeight: 1.6, fontFamily: 'var(--sans)', fontWeight: 600,
                }}>
                  {noviceContent.action} →
                </div>

                {/* Message fallback discret */}
                {noviceContent.is_fallback && generationError && (
                  <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', opacity: .5 }}>
                    {generationError}
                  </div>
                )}

                {/* Bouton Regénérer */}
                <button
                  onClick={regenerate}
                  disabled={isGenerating}
                  style={{
                    width: '100%', padding: '10px 0', border: '1px solid var(--border)',
                    borderRadius: 10, background: 'none', cursor: 'pointer',
                    fontFamily: 'var(--sans)', fontWeight: 700, fontSize: 12,
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6,
                  }}
                >
                  <span style={{
                    display: 'inline-block',
                    animation: isGenerating ? 'spin .7s linear infinite' : 'none',
                  }}>🔄</span>
                  Regénérer (nouvelle métaphore)
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '20px 0' }}>
                {generationError ?? 'Chargement de l\'analyse...'}
              </div>
            )}
          </div>
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
