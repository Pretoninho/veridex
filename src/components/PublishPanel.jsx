/**
 * components/PublishPanel.jsx
 *
 * Panneau de publication Twitter — affiché en overlay bas de page.
 * Montre 5 tweets générés par twitter_generator.js, avec :
 *   - Badge coloré par type de trigger
 *   - Copie individuelle par tweet
 *   - Copie du thread complet (tweets numérotés)
 *   - Bouton Regénérer / Fermer
 *   - Skeleton loader pendant la génération
 */

import { useState } from 'react'
import { TRIGGER_META } from '../data_processing/signals/publish_trigger.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function charCount(text) {
  return text?.length ?? 0
}

function charColor(count) {
  if (count > 280) return '#FF4D6D'
  if (count > 240) return '#FFD700'
  return 'var(--text-muted)'
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyBtn({ getText, label = '📋', style }) {
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
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: 7,
        color: copied ? 'var(--call)' : 'var(--text-muted)',
        fontSize: 12,
        padding: '3px 8px',
        cursor: 'pointer',
        lineHeight: 1,
        transition: 'color .2s',
        flexShrink: 0,
        ...style,
      }}
    >
      {copied ? '✓' : label}
    </button>
  )
}

// ── Skeleton tweet ────────────────────────────────────────────────────────────

function TweetSkeleton() {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
    }}>
      {[80, 60, 90].map((w, i) => (
        <div key={i} style={{
          height: 12,
          width: `${w}%`,
          borderRadius: 6,
          marginBottom: i < 2 ? 8 : 0,
          background: 'linear-gradient(90deg, rgba(255,255,255,.05) 25%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.05) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.4s infinite',
        }} />
      ))}
    </div>
  )
}

// ── TweetCard ─────────────────────────────────────────────────────────────────

function TweetCard({ index, text, triggerColor }) {
  const count = charCount(text)

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: `1px solid ${index === 0 ? triggerColor + '50' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '10px 12px',
      position: 'relative',
    }}>

      {/* Numéro + compteur + copie */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{
          width: 20, height: 20,
          borderRadius: 6,
          background: index === 0 ? triggerColor + '22' : 'rgba(255,255,255,.06)',
          color: index === 0 ? triggerColor : 'var(--text-muted)',
          fontFamily: 'var(--sans)', fontWeight: 800, fontSize: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {index + 1}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 10,
          color: charColor(count),
          fontFamily: 'var(--sans)',
          fontWeight: 700,
        }}>
          {count}/280
        </span>
        <CopyBtn getText={() => text ?? ''} />
      </div>

      {/* Texte du tweet */}
      <div style={{
        fontSize: 13,
        color: 'var(--text)',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
      </div>
    </div>
  )
}

// ── PublishPanel ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   trigger: object,
 *   tweets: string[]|null,
 *   isGenerating: boolean,
 *   onRegenerate: () => void,
 *   onDismiss: () => void,
 * }} props
 */
export default function PublishPanel({ trigger, tweets, isGenerating, onRegenerate, onDismiss }) {
  const meta  = TRIGGER_META[trigger?.type] ?? { label: 'Publication', color: 'var(--accent)' }
  const color = trigger?.color ?? meta.color

  const getFullThread = () => {
    if (!tweets?.length) return ''
    return tweets.map((t, i) => `${i + 1}/${tweets.length} ${t}`).join('\n\n')
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      background: 'var(--bg)',
      borderTop: `2px solid ${color}60`,
      borderRadius: '20px 20px 0 0',
      padding: '0 0 env(safe-area-inset-bottom)',
      maxHeight: '75vh',
      overflowY: 'auto',
      boxShadow: `0 -8px 32px ${color}18`,
    }}>

      {/* Handle + Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        background: 'var(--bg)',
        padding: '14px 16px 10px',
        borderBottom: '1px solid var(--border)',
        zIndex: 1,
      }}>

        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'rgba(255,255,255,.15)',
          margin: '0 auto 12px',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

          {/* Badge trigger */}
          <span style={{
            fontFamily: 'var(--sans)',
            fontWeight: 800,
            fontSize: 10,
            color,
            background: `${color}18`,
            border: `1px solid ${color}40`,
            borderRadius: 6,
            padding: '3px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            flexShrink: 0,
          }}>
            {meta.label}
          </span>

          <span style={{
            fontFamily: 'var(--sans)',
            fontWeight: 700,
            fontSize: 13,
            color: 'var(--text)',
            flex: 1,
          }}>
            Thread Twitter · {trigger?.asset}
          </span>

          {/* Copie thread complet */}
          {tweets?.length > 0 && !isGenerating && (
            <CopyBtn
              getText={getFullThread}
              label="Tout copier"
              style={{ fontSize: 11, padding: '4px 10px' }}
            />
          )}

          {/* Fermer */}
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 7,
              color: 'var(--text-muted)',
              fontSize: 14,
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Corps : tweets */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {isGenerating ? (
          <>
            {[1, 2, 3, 4, 5].map(i => <TweetSkeleton key={i} />)}
          </>
        ) : tweets?.length > 0 ? (
          <>
            {tweets.map((text, i) => (
              <TweetCard
                key={i}
                index={i}
                text={text}
                triggerColor={color}
              />
            ))}

            {/* Bouton Regénérer */}
            <button
              onClick={onRegenerate}
              style={{
                width: '100%',
                padding: '11px 0',
                marginTop: 4,
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--sans)',
                fontWeight: 700,
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              🔄 Regénérer le thread
            </button>
          </>
        ) : (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
            padding: '20px 0',
          }}>
            Génération du thread…
          </div>
        )}
      </div>
    </div>
  )
}
