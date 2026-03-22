/**
 * components/ToneSelector.jsx
 *
 * Sélecteur de ton pour la couche novice.
 * Grille 3×2 sur mobile, persistance localStorage.
 *
 * Props :
 *   selectedTone  : string
 *   onToneChange  : (toneId: string) => void
 *   isGenerating  : boolean
 */

import { TONES_LIST } from '../data_processing/signals/tone_config.js'

export default function ToneSelector({ selectedTone, onToneChange, isGenerating }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--sans)',
        fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        Ton de l'analyse
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
      }}>
        {TONES_LIST.map(tone => {
          const isActive = selectedTone === tone.id
          const isDisabled = isGenerating

          return (
            <button
              key={tone.id}
              onClick={() => !isDisabled && onToneChange(tone.id)}
              disabled={isDisabled}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '10px 6px',
                borderRadius: 10,
                border: isActive
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border)',
                background: isActive
                  ? 'rgba(0,212,255,.08)'
                  : 'rgba(255,255,255,.03)',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled && !isActive ? 0.5 : isActive ? 1 : 0.7,
                transition: 'all .18s ease',
                outline: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{tone.emoji}</span>
              <span style={{
                fontSize: 10,
                fontFamily: 'var(--sans)',
                fontWeight: isActive ? 700 : 600,
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                letterSpacing: '0.3px',
              }}>
                {tone.label}
              </span>
              {isActive && isGenerating && (
                <span style={{
                  width: 14, height: 14,
                  border: '2px solid transparent',
                  borderTopColor: 'var(--accent)',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin .7s linear infinite',
                  flexShrink: 0,
                }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
