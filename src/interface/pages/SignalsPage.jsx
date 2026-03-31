import { useState, useEffect } from 'react'
import { fetchSignals } from '../../api/backend.js'
import { getSignalHistory, saveSignal } from '../../signals/signal_engine.js'

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

export default function SignalsPage({ asset, clockSync }) {
  const [signal, setSignal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const refreshInterval = 10000 // 10 secondes

  // Charge le signal au montage et à chaque rafraîchissement
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchSignals(asset)
        if (result) {
          setSignal(result)
          // Sauvegarde pour l'historique
          saveSignal({
            asset: result.asset,
            global: result.global,
            signal: result.signal,
            timestamp: result.timestamp,
            scores: result.scores,
          })
        }
      } catch (err) {
        console.warn('[SignalsPage] Fetch error:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, refreshInterval)
    return () => clearInterval(timer)
  }, [asset])

  if (!signal && loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Chargement des signaux...
      </div>
    )
  }

  if (error) {
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

  const { scores, global, signal: signalInfo, spot, timestamp } = signal
  const getGlobalColor = (g) => {
    if (g == null) return 'var(--text-muted)'
    if (g >= 70) return 'var(--call)'
    if (g >= 40) return '#FF9500'
    return 'var(--put)'
  }

  return (
    <div style={{ padding: '16px', height: '100%', overflowY: 'auto' }}>

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
      {signal.noviceData && (
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
          {signal.noviceData.funding != null && (
            <div>
              Funding: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-bright)' }}>
                {(signal.noviceData.funding * 100).toFixed(2)}%
              </span>
            </div>
          )}
          {signal.noviceData.estimatedGain != null && (
            <div>
              Gain estimé: <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-bright)' }}>
                {signal.noviceData.estimatedGain.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Max Pain si disponible */}
      {signal.maxPain && (
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
            Prix: ${signal.maxPain.price?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '—'}
          </div>
          <div>
            Prochaine échéance: {signal.maxPain.expiry || '—'}
          </div>
        </div>
      )}

    </div>
  )
}
