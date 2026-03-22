import { useState, useEffect, useCallback, useRef } from 'react'
import { getDVOL, getFundingRate, getRealizedVol, getFutures, getFuturePrice, getSpot } from '../utils/api.js'
import { computeSignal, saveSignal, hashMarketState } from '../data_processing/signals/signal_engine.js'
import { interpretSignal }       from '../data_processing/signals/signal_interpreter.js'
import { generateNoviceContent } from '../data_processing/signals/novice_generator.js'
import { DEFAULT_TONE }          from '../data_processing/signals/tone_config.js'
import { detectTrigger, detectSettlementTrigger, markAsPublished } from '../data_processing/signals/publish_trigger.js'
import { generateTwitterThread } from '../data_processing/signals/twitter_generator.js'
import ToneSelector              from '../components/ToneSelector.jsx'
import PublishPanel              from '../components/PublishPanel.jsx'

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

  // Novice layer
  const [selectedTone,    setSelectedTone]    = useState(() => localStorage.getItem(LS_TONE_KEY) ?? DEFAULT_TONE)
  const [noviceContent,   setNoviceContent]   = useState(null)
  const [isGenerating,    setIsGenerating]    = useState(false)
  const [generationError, setGenerationError] = useState(null)

  // UI
  const [mode, setMode] = useState('expert')

  // Publication Twitter
  const [publishTrigger,    setPublishTrigger]    = useState(null)
  const [tweets,            setTweets]            = useState(null)
  const [isGeneratingThread, setIsGeneratingThread] = useState(false)

  // Refs pour éviter les stale closures
  const noviceDataRef    = useRef(null)
  const selectedToneRef  = useRef(selectedTone)
  useEffect(() => { selectedToneRef.current = selectedTone }, [selectedTone])

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

      // Stocker noviceData dans le ref pour éviter les stale closures
      noviceDataRef.current = interp?.noviceData ?? null

      if (sig?.global != null) {
        setHistory(prev => [...prev.slice(-19), { score: sig.global, ts: Date.now() }])
      }

      setLastUpdate(new Date())

      // Générer la couche novice automatiquement
      if (interp?.noviceData) {
        generateNovice(interp.noviceData, selectedToneRef.current)
      }

      // Détecter un trigger de publication Twitter
      const trigger = detectTrigger(sig, interp, raw, asset)
      if (trigger && !publishTrigger) {
        setPublishTrigger(trigger)
        setTweets(null)
        setIsGeneratingThread(true)
        generateTwitterThread(trigger, trigger.marketContext)
          .then(t => { setTweets(t); setIsGeneratingThread(false) })
          .catch(() => setIsGeneratingThread(false))
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [asset, generateNovice])

  // ── Changement de ton ─────────────────────────────────────────────────────

  const handleToneChange = useCallback((toneId) => {
    setSelectedTone(toneId)
    selectedToneRef.current = toneId
    localStorage.setItem(LS_TONE_KEY, toneId)
    const nd = noviceDataRef.current
    if (nd) generateNovice(nd, toneId)
  }, [generateNovice])

  // ── Regénération (correction bug stale closure) ───────────────────────────

  const regenerate = useCallback(() => {
    const nd = noviceDataRef.current
    if (nd) generateNovice(nd, selectedToneRef.current)
  }, [generateNovice])

  // ── Regénération thread Twitter ───────────────────────────────────────────

  const regenerateThread = useCallback(() => {
    if (!publishTrigger) return
    setTweets(null)
    setIsGeneratingThread(true)
    generateTwitterThread(publishTrigger, publishTrigger.marketContext)
      .then(t => { setTweets(t); setIsGeneratingThread(false) })
      .catch(() => setIsGeneratingThread(false))
  }, [publishTrigger])

  const dismissPanel = useCallback(() => {
    if (publishTrigger?.hash) markAsPublished(publishTrigger.hash)
    setPublishTrigger(null)
    setTweets(null)
  }, [publishTrigger])

  useEffect(() => { load() }, [asset])

  // Détecter un trigger settlement au montage et à chaque changement d'asset
  useEffect(() => {
    let active = true
    detectSettlementTrigger(asset).then(trigger => {
      if (!active || !trigger) return
      setPublishTrigger(trigger)
      setTweets(null)
      setIsGeneratingThread(true)
      generateTwitterThread(trigger, trigger.marketContext)
        .then(t => { if (active) { setTweets(t); setIsGeneratingThread(false) } })
        .catch(() => { if (active) setIsGeneratingThread(false) })
    }).catch(() => {})
    return () => { active = false }
  }, [asset])

  // ── Variables UI ──────────────────────────────────────────────────────────

  const signal  = result?.signal
  const scores  = result?.scores
  const global  = result?.global
  const expert  = interpreted?.expert
  const recos   = expert?.recommendations
  const gColor  = scoreColor(global)

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
                Décomposition du score
              </div>
              <ScoreBar label="Volatilité IV — 30%"  score={scores.s1} color={scoreColor(scores.s1)} />
              <ScoreBar label="Funding Rate — 20%"   score={scores.s2} color={scoreColor(scores.s2)} />
              <ScoreBar label="Basis Futures — 20%"  score={scores.s3} color={scoreColor(scores.s3)} />
              <ScoreBar label="Prime IV/RV — 15%"    score={scores.s4} color={scoreColor(scores.s4)} />
              <ScoreBar label="On-Chain — 15%"       score={scores.s5} color={scoreColor(scores.s5)} />
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
            borderRadius: 12, padding: '16px', marginBottom: 14, position: 'relative',
          }}>
            {isGenerating ? (
              <NoviceSkeleton />
            ) : noviceContent ? (
              <>
                {/* Bouton copie */}
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <CopyButton getText={() => {
                    const c = noviceContent
                    return [
                      `${c.emoji} ${c.headline}`,
                      '',
                      c.metaphor,
                      '',
                      c.situation,
                      '',
                      (c.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n'),
                      '',
                      `💰 ${c.gain}`,
                      `⚠️ ${c.risk}`,
                      '',
                      `→ ${c.action}`,
                    ].join('\n')
                  }} />
                </div>

                {/* Headline */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingRight: 36 }}>
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
                    Opportunités
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
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

      {/* Panel publication Twitter */}
      {publishTrigger && (
        <PublishPanel
          trigger={publishTrigger}
          tweets={tweets}
          isGenerating={isGeneratingThread}
          onRegenerate={regenerateThread}
          onDismiss={dismissPanel}
        />
      )}
    </div>
  )
}
