/**
 * CalibrationProfileSelector.jsx
 *
 * Sélecteur de profil de calibration des signaux.
 * Persiste la sélection dans localStorage et applique immédiatement
 * le profil via setActiveCalibrationProfile().
 *
 * Props :
 *   - onChange : callback appelé après changement de profil (ex. refresh des données)
 */

import { useState } from 'react'
import { CALIBRATION_PROFILES } from '../../signals/calibration_profiles.js'
import {
  getActiveCalibrationProfileName,
  setActiveCalibrationProfile,
} from '../../signals/signal_calibration.js'

export default function CalibrationProfileSelector({ onChange }) {
  const [active, setActive] = useState(getActiveCalibrationProfileName)

  function handleChange(name) {
    if (name === active) return
    setActiveCalibrationProfile(name)
    setActive(name)
    onChange?.()
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
      }}>
        Profil
      </span>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.entries(CALIBRATION_PROFILES).map(([key, profile]) => {
          const isActive = key === active
          return (
            <button
              key={key}
              onClick={() => handleChange(key)}
              title={profile.description}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? '#000' : 'var(--text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                fontWeight: isActive ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {profile.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
