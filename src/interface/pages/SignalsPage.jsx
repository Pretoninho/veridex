import { useState, useEffect } from 'react'
import * as deribit from '../../data/providers/deribit.js'
import {
  computeSignal,
  computeSignalMultiTimeframe,
  hashMarketState,
  saveSignal as persistSignal,
} from '../../signals/signal_engine.js'
import {
  interpretSignal,
  interpretMultiTimeframeSignal,
} from '../../signals/signal_interpreter.js'

function pickDvolForTimeframe(dvolBundle, timeframe) {
  if (!dvolBundle) return null
  if (timeframe === '4h') return dvolBundle.dvol_4h ?? dvolBundle.dvol_1h ?? dvolBundle.dvol_1d ?? null
  if (timeframe === '5min') return dvolBundle.dvol_1h ?? dvolBundle.dvol_4h ?? dvolBundle.dvol_1d ?? null
  return dvolBundle.dvol_1h ?? dvolBundle.dvol_4h ?? dvolBundle.dvol_1d ?? null
}

function buildExecutionPayload(interpretedMultiTimeframe) {
  const action = interpretedMultiTimeframe?.action ?? 'WAIT'
  const position =
    action === 'BUY_BREAKOUT' ? 'LONG' :
    action === 'SELL_REVERSION' ? 'SHORT' :
    'WAIT'

  return {
    action,
    position,
    reason: interpretedMultiTimeframe?.reason ?? '',
  }
}

function buildRuleTrace(multiTimeframe, interpretedMultiTimeframe) {
  return [
    {
      rule: '4H regime detected',
      passed: (multiTimeframe?.regime4h?.type ?? 'NEUTRAL') !== 'NEUTRAL',
      detail: `4H=${multiTimeframe?.regime4h?.type ?? 'N/A'} · confiance ${Math.round((multiTimeframe?.regime4h?.confidence ?? 0) * 100)}%`,
    },
    {
      rule: '4H -> 1H alignment',
      passed: multiTimeframe?.alignment?.htf_mtf ?? false,
      detail: `${multiTimeframe?.regime4h?.type ?? 'N/A'} -> ${multiTimeframe?.setup1h?.type ?? 'N/A'}`,
    },
    {
      rule: '1H -> 5M alignment',
      passed: multiTimeframe?.alignment?.mtf_ltf ?? false,
      detail: `${multiTimeframe?.setup1h?.type ?? 'N/A'} -> ${multiTimeframe?.entry5min?.signal ?? 'N/A'}`,
    },
    {
      rule: 'Execution readiness',
      passed: (multiTimeframe?.ready_to_trade ?? false) || (multiTimeframe?.entry5min?.action === 'EXECUTE'),
      detail: interpretedMultiTimeframe?.reason ?? 'En attente de validation multi-timeframe',
    },
  ]
}

async function loadFrontSignal(asset) {
  const assetCode = asset.toUpperCase()

  const [snapshotResult, instrumentsResult] = await Promise.allSettled([
    deribit.getMarketSnapshot(assetCode),
    deribit.getInstruments(assetCode, 'option'),
  ])

  const snapshot = snapshotResult.status === 'fulfilled' ? (snapshotResult.value ?? {}) : {}
  const instruments = instrumentsResult.status === 'fulfilled' ? (instrumentsResult.value ?? []) : []

  const spot = snapshot?.spot?.price ?? null
  const basisAvg = await deribit.getBasisAvg(assetCode, spot).catch(() => null)

  const dvol1h = pickDvolForTimeframe(snapshot?.dvol, '1h')
  const dvol4h = pickDvolForTimeframe(snapshot?.dvol, '4h')
  const dvol5min = pickDvolForTimeframe(snapshot?.dvol, '5min')

  const marketInputs = {
    asset: assetCode,
    spot,
    dvol: dvol1h,
    funding: snapshot?.funding ?? null,
    rv: snapshot?.rv ?? null,
    basisAvg,
    instruments,
  }

  const signal = computeSignal(marketInputs)

  const multiTimeframeRaw = computeSignalMultiTimeframe({
    asset: assetCode,
    data_4h: { ...marketInputs, dvol: dvol4h },
    data_1h: { ...marketInputs, dvol: dvol1h },
    data_5min: { ...marketInputs, dvol: dvol5min },
    funding: snapshot?.funding?.rateAnn ?? snapshot?.funding?.avgAnn7d ?? null,
  })

  const interpreted = interpretSignal(signal, {
    dvol: dvol1h,
    funding: snapshot?.funding ?? null,
    rv: snapshot?.rv ?? null,
    basisAvg,
    spot,
    asset: assetCode,
  })

  const interpretedMultiTimeframe = interpretMultiTimeframeSignal(multiTimeframeRaw)
  const marketHash = hashMarketState(marketInputs)

  return {
    asset: assetCode,
    ...signal,
    spot,
    timestamp: Date.now(),
    marketHash,
    multi_timeframe: {
      regime_4h: multiTimeframeRaw.regime4h,
      setup_1h: multiTimeframeRaw.setup1h,
      entry_5min: multiTimeframeRaw.entry5min,
      alignment: multiTimeframeRaw.alignment,
      execution: buildExecutionPayload(interpretedMultiTimeframe),
      options_overlay: {
        strategy: interpreted?.expert?.recommendations?.options?.signal ?? null,
        action: interpreted?.expert?.recommendations?.options?.action ?? null,
      },
      rule_trace: buildRuleTrace(multiTimeframeRaw, interpretedMultiTimeframe),
    },
  }
}

function RegimeCard({ regime }) {
  if (!regime || !regime.type) return null
  const iconMap = {
    'BREAKOUT': '📈',
    'MEAN_REVERSION': '📉',
    'NEUTRAL': '➡️'
  }
  const icon = iconMap[regime.type] || '❓'
  const confidencePct = Math.round((regime.confidence ?? 0) * 100)

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
        4H RÉGIME {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
        {regime.type === 'BREAKOUT' ? '🔓 Compression → Attend Cassure' :
         regime.type === 'MEAN_REVERSION' ? '⚖️ Excès → Attend Reversion' :
         '⏸️ Neutre'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Confiance: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{confidencePct}%</span>
      </div>
    </div>
  )
}

function SetupCard({ setup }) {
  if (!setup || !setup.type) return null
  const iconMap = {
    'COMPRESSION': '📦',
    'SPIKE': '⚡',
    'NEUTRAL': '➡️'
  }
  const icon = iconMap[setup.type] || '❓'
  const confidencePct = Math.round((setup.confidence ?? 0) * 100)

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
        1H SETUP {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
        {setup.type === 'COMPRESSION' ? '📦 Compression Détectée' :
         setup.type === 'SPIKE' ? '⚡ Spike Détecté' :
         '⏸️ Neutre'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Confiance: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{confidencePct}%</span>
      </div>
    </div>
  )
}

function EntryCard({ entry }) {
  if (!entry || !entry.signal) return null
  const isExecutable = entry.action === 'EXECUTE'
  const iconMap = {
    'BREAKOUT': '🔥',
    'REJECTION': '❄️',
    'WAIT': '⏳'
  }
  const icon = iconMap[entry.signal] || '❓'
  const confidencePct = Math.round((entry.confidence ?? 0) * 100)

  return (
    <div style={{
      background: isExecutable ? 'rgba(34,197,94,.08)' : 'rgba(255,255,255,.03)',
      border: isExecutable ? '1px solid rgba(34,197,94,.3)' : '1px solid rgba(255,255,255,.08)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
        5MIN ENTRY {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
        {entry.signal === 'BREAKOUT' ? '🔥 Cassure Détectée' :
         entry.signal === 'REJECTION' ? '❄️ Rejet Détecté' :
         '⏳ Attend Signal'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
        Action: <span style={{
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          color: isExecutable ? 'var(--call)' : 'var(--text-muted)'
        }}>
          {entry.action === 'EXECUTE' ? '✓ EXÉCUTER' : 'ATTENDRE'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Confiance: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{confidencePct}%</span>
      </div>
    </div>
  )
}

function AlignmentCard({ alignment }) {
  if (!alignment || typeof alignment.all_aligned !== 'boolean') return null
  const allAligned = alignment.all_aligned

  return (
    <div style={{
      background: allAligned ? 'rgba(34,197,94,.08)' : 'rgba(255,165,0,.08)',
      border: allAligned ? '1px solid rgba(34,197,94,.3)' : '1px solid rgba(255,165,0,.3)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
        ALIGNEMENT HTF→MTF→LTF
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        fontSize: 12,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>4H→1H</div>
          <div style={{ fontWeight: 700, color: (alignment.htf_mtf ?? false) ? 'var(--call)' : 'var(--put)' }}>
            {(alignment.htf_mtf ?? false) ? '✓' : '✗'}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>1H→5M</div>
          <div style={{ fontWeight: 700, color: (alignment.mtf_ltf ?? false) ? 'var(--call)' : 'var(--put)' }}>
            {(alignment.mtf_ltf ?? false) ? '✓' : '✗'}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>ALL</div>
          <div style={{ fontWeight: 700, color: alignment.all_aligned ? 'var(--call)' : 'var(--put)' }}>
            {alignment.all_aligned ? '✓' : '✗'}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExecutionPlanCard({ multiTimeframe }) {
  const execution = multiTimeframe?.execution
  const risk = multiTimeframe?.risk
  const optionsOverlay = multiTimeframe?.options_overlay

  if (!execution && !risk && !optionsOverlay) return null

  const position = execution?.position ?? 'WAIT'
  const positionColor =
    position === 'LONG' ? 'var(--call)' :
    position === 'SHORT' ? 'var(--put)' :
    'var(--text-muted)'

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
        EXECUTION PLAN
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
        Position:{' '}
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: positionColor }}>
          {position}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
        Leverage:{' '}
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>
          x{risk?.leverage ?? '—'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
        TP / SL:{' '}
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>
          {risk?.tp != null ? `${risk.tp}%` : '—'} / {risk?.sl != null ? `${risk.sl}%` : '—'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Options overlay:{' '}
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>
          {optionsOverlay?.strategy ?? '—'}
        </span>
      </div>
    </div>
  )
}

function RuleTraceCard({ trace }) {
  if (!Array.isArray(trace) || trace.length === 0) return null

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 8,
      padding: '12px',
      marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
        RULE TRACE
      </div>
      {trace.map((item, idx) => (
        <div key={`${item.rule}-${idx}`} style={{ marginBottom: idx < trace.length - 1 ? 8 : 0, fontSize: 12 }}>
          <div style={{ color: item.passed ? 'var(--call)' : 'var(--put)', fontWeight: 700 }}>
            {item.passed ? '✓' : '✗'} {item.rule}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            {item.detail}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Affiche le score composite de 4 composantes simplifiées:
 * s1 IV (35%), s2 Funding (25%), s3 Basis (25%), s4 IV/RV (15%)
 */
function ScoreBar({ label, score, weight }) {
  const pct = score != null ? Math.min(100, Math.max(0, score)) : 0
  const colors = {
    s1: 'var(--call)',      // Green-ish
    s2: '#FF9500',          // Orange
    s3: '#FF6B6B',          // Red-ish
    s4: '#7C3AED',          // Purple
  }
  const color = colors[label] || 'var(--text-muted)'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {label === 's1' ? `IV (${weight}%)` :
           label === 's2' ? `Funding (${weight}%)` :
           label === 's3' ? `Basis (${weight}%)` :
           `IV/RV (${weight}%)`}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color }}>
          {score != null ? `${score}/100` : 'N/A'}
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
            transition: 'width .4s ease',
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
    </div>
  )
}

export default function SignalsPage({ asset }) {
  const [signal, setSignal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedAsset, setSelectedAsset] = useState(asset || 'BTC')
  const refreshInterval = 10000 // 10 secondes

  // Charge le signal au montage et à chaque rafraîchissement
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await loadFrontSignal(selectedAsset)
        if (result) {
          setSignal(result)
          await persistSignal({
            asset: result.asset,
            score: result.global,
            conditions: result.scores,
            recommendation: result.signal?.label ?? 'N/A',
            marketHash: result.marketHash,
          }).catch(() => {})
        }
      } catch (err) {
        console.warn('[SignalsPage] Fetch error:', err)
        setError(err instanceof Error ? err.message : 'Erreur de chargement des signaux.')
      } finally {
        setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, refreshInterval)
    return () => clearInterval(timer)
  }, [selectedAsset])

  if (!signal && loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Chargement des signaux...
      </div>
    )
  }

  if (error && !signal) {
    return (
      <div style={{ padding: '20px', color: 'var(--put)', fontSize: 12 }}>
        Erreur: {error}
      </div>
    )
  }

  if (!signal) {
    return (
      <div style={{ padding: '20px', color: 'var(--text-muted)' }}>
        Aucune donnée de signal disponible
      </div>
    )
  }

  const { scores, global, signal: signalInfo, timestamp, spot, multi_timeframe, noviceData, maxPain } = signal
  const getGlobalColor = (g) => {
    if (g == null) return 'var(--text-muted)'
    if (g >= 70) return 'var(--call)'
    if (g >= 40) return '#FF9500'
    return 'var(--put)'
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>

      {error && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--put)',
          border: '1px solid rgba(255,77,109,.35)',
          background: 'rgba(255,77,109,.08)',
        }}>
          Mise a jour temporairement indisponible: {error}
        </div>
      )}

      {/* Asset selector */}
      <div style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        {['BTC', 'ETH'].map(a => (
          <button
            key={a}
            onClick={() => setSelectedAsset(a)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: selectedAsset === a ? '1px solid var(--text-bright)' : '1px solid rgba(255,255,255,.2)',
              background: selectedAsset === a ? 'rgba(255,255,255,.1)' : 'transparent',
              color: selectedAsset === a ? 'var(--text-bright)' : 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .2s ease',
            }}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Titre et refresh status */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--sans)', fontWeight: 700 }}>
            Score Composite
          </h2>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Mis à jour: {new Date(timestamp).toLocaleTimeString('fr-FR')}
          </span>
        </div>
      </div>

      {/* Score global principal */}
      <div style={{
        background: 'rgba(255,255,255,.03)',
        border: '1px solid rgba(255,255,255,.08)',
        borderRadius: 10,
        padding: '16px',
        marginBottom: 20,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Score Global</div>
        <div style={{
          fontSize: 48,
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          color: getGlobalColor(global),
          textShadow: global != null ? `0 0 16px ${getGlobalColor(global)}40` : 'none',
          marginBottom: 12,
        }}>
          {global != null ? global : '—'}
        </div>
        <div style={{ fontSize: 11, color: getGlobalColor(global), fontWeight: 600 }}>
          {signalInfo?.label ?? 'N/A'}
        </div>
        {spot != null && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            Prix: ${spot.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        )}
      </div>

      {/* Multi-Timeframe Analysis */}
      {multi_timeframe && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 0', fontWeight: 700, letterSpacing: '0.5px' }}>
            ANALYSE MULTI-TIMEFRAME
          </h3>
          <RegimeCard regime={multi_timeframe.regime_4h} />
          <SetupCard setup={multi_timeframe.setup_1h} />
          <EntryCard entry={multi_timeframe.entry_5min} />
          <AlignmentCard alignment={multi_timeframe.alignment} />
          <ExecutionPlanCard multiTimeframe={multi_timeframe} />
          <RuleTraceCard trace={multi_timeframe.rule_trace} />
        </div>
      )}

      {/* Composantes détaillées */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px 0', fontWeight: 700, letterSpacing: '0.5px' }}>
          COMPOSANTES
        </h3>
        <ScoreBar label="s1" score={scores?.s1} weight="35" />
        <ScoreBar label="s2" score={scores?.s2} weight="25" />
        <ScoreBar label="s3" score={scores?.s3} weight="25" />
        <ScoreBar label="s4" score={scores?.s4} weight="15" />
      </div>

      {/* Info novice */}
      {noviceData && (
        <div style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: 8,
          padding: '12px',
          fontSize: 11,
          color: 'var(--text-dim)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-bright)' }}>
            Contexte
          </div>
          {noviceData.funding != null && (
            <div>
              Funding: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-bright)' }}>
                {noviceData.funding.toFixed(2)}%
              </span>
            </div>
          )}
          {noviceData.estimatedGain != null && (
            <div>
              Gain estimé: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-bright)' }}>
                {noviceData.estimatedGain.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Max Pain si disponible */}
      {maxPain && (
        <div style={{
          background: 'rgba(255,255,255,.02)',
          border: '1px solid rgba(255,255,255,.06)',
          borderRadius: 8,
          padding: '12px',
          marginTop: 12,
          fontSize: 11,
          color: 'var(--text-dim)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>Max Pain</div>
          <div>
            Prix: ${maxPain.price?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '—'}
          </div>
          <div>
            Prochaine échéance: {maxPain.expiry || '—'}
          </div>
        </div>
      )}

    </div>
  )
}
