/**
 * MaintenancePage — Écran de maintenance Veridex
 *
 * Affiché quand VITE_MAINTENANCE_MODE=true dans les variables d'environnement.
 * Remplace l'application entière le temps de la maintenance.
 */

import VLogo from '../components/VLogo.jsx'

// ── Couleurs (thème sombre, indépendant du reste de l'app) ────────────────────

const C = {
  bg:        '#0a0e14',
  text:      '#f0f2f5',
  muted:     'rgba(255,255,255,0.45)',
  ghost:     'rgba(255,255,255,0.18)',
  surface:   'rgba(255,255,255,0.04)',
  border:    'rgba(255,255,255,0.07)',
  accent:    '#1D9E75',
  warning:   '#EF9F27',
}

// ── Composant ─────────────────────────────────────────────────────────────────

export default function MaintenancePage() {
  const message  = import.meta.env.VITE_MAINTENANCE_MESSAGE ?? null
  const estimate = import.meta.env.VITE_MAINTENANCE_ESTIMATE ?? null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100dvh',
      background: C.bg, color: C.text,
      fontFamily: 'var(--sans, system-ui, sans-serif)',
      padding: '24px 20px', boxSizing: 'border-box',
      textAlign: 'center',
    }}>

      {/* Logo */}
      <div style={{ marginBottom: 32 }}>
        <VLogo size={48} />
      </div>

      {/* Icône maintenance */}
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: `rgba(239,159,39,0.10)`,
        border: `1.5px solid rgba(239,159,39,0.35)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, marginBottom: 28,
      }}>
        🔧
      </div>

      {/* Titre */}
      <h1 style={{
        margin: '0 0 12px',
        fontSize: 22, fontWeight: 800,
        letterSpacing: '-0.3px', lineHeight: 1.2,
      }}>
        Maintenance en cours
      </h1>

      {/* Sous-titre */}
      <p style={{
        margin: '0 0 24px',
        fontSize: 14, color: C.muted, lineHeight: 1.6,
        maxWidth: 320,
      }}>
        {message ?? "Veridex est temporairement indisponible le temps d'une mise à jour."}
      </p>

      {/* Estimation de retour */}
      {estimate && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 10,
          background: C.surface, border: `1px solid ${C.border}`,
          fontSize: 13, color: C.muted,
          marginBottom: 32,
        }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>⏱</span>
          Retour estimé : <strong style={{ color: C.text }}>{estimate}</strong>
        </div>
      )}

      {/* Séparateur */}
      <div style={{
        width: 40, height: 1,
        background: C.ghost, margin: '0 auto 28px',
      }} />

      {/* Note de bas de page */}
      <p style={{
        fontSize: 11, color: C.ghost, lineHeight: 1.5,
        maxWidth: 280, margin: 0,
      }}>
        Les données de marché continuent d'être collectées.
        Veridex sera de retour très prochainement.
      </p>

    </div>
  )
}
