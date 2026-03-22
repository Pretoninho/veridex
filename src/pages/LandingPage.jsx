/**
 * LandingPage — Splash screen Veridex
 *
 * Monoécran mobile (100dvh), 4 zones verticales :
 * badge live → hero → métriques → CTA
 *
 * Props :
 *   onEnter   : () => void
 *   btcPrice  : number | null
 *   ivRank    : number | null
 *   funding   : number | null
 */

function fmtPrice(v) {
  if (v == null) return '--'
  return '$' + Math.round(v).toLocaleString('en-US')
}

function fmtIV(v) {
  if (v == null) return '--'
  return v.toFixed(1) + '%'
}

function fmtFunding(v) {
  if (v == null) return '--'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%/an'
}

function metricColor(v, positiveIsGreen = true) {
  if (v == null) return 'var(--text-muted)'
  if (v > 0) return positiveIsGreen ? 'var(--call)' : 'var(--put)'
  if (v < 0) return positiveIsGreen ? 'var(--put)' : 'var(--call)'
  return 'var(--text)'
}

function ivColor(v) {
  if (v == null) return 'var(--text-muted)'
  if (v > 70) return 'var(--put)'
  if (v < 30) return 'var(--call)'
  return 'var(--text)'
}

export default function LandingPage({ onEnter, btcPrice, ivRank, funding }) {
  const metrics = [
    {
      label: 'BTC',
      value: fmtPrice(btcPrice),
      color: btcPrice != null ? 'var(--text)' : 'var(--text-muted)',
    },
    {
      label: 'IV Rank',
      value: fmtIV(ivRank),
      color: ivColor(ivRank),
    },
    {
      label: 'Funding',
      value: fmtFunding(funding),
      color: metricColor(funding),
    },
  ]

  return (
    <div style={{
      height: '100dvh',
      background: 'var(--bg-base)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'calc(env(safe-area-inset-top, 0px) + 28px) 24px calc(env(safe-area-inset-bottom, 0px) + 28px)',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Lueur émeraude subtile en arrière-plan */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        top: '-10%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        height: '55%',
        background: 'radial-gradient(ellipse at center, rgba(0,200,150,0.04) 0%, transparent 68%)',
        pointerEvents: 'none',
      }} />

      {/* ── Zone haute — Badge LIVE ─────────────────────────────── */}
      <div style={{
        opacity: 0,
        animation: 'landingFadeUp 400ms ease-out 0ms forwards',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 16px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--accent-border)',
          borderRadius: 20,
        }}>
          <span style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: '0 0 6px var(--accent)',
            animation: 'pulse 2s ease-in-out infinite',
            display: 'inline-block',
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-muted)',
            letterSpacing: '0.02em',
          }}>
            LIVE · Deribit · Binance · Coinbase
          </span>
        </div>
      </div>

      {/* ── Zone centrale — Hero ────────────────────────────────── */}
      <div style={{
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>

        {/* Symbole */}
        <div style={{
          fontSize: 32,
          color: 'var(--accent)',
          marginBottom: 16,
          lineHeight: 1,
          opacity: 0,
          animation: 'landingFadeUp 400ms ease-out 0ms forwards',
        }}>
          ◈
        </div>

        {/* Nom VERIDEX */}
        <div style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(36px, 10vw, 52px)',
          color: 'var(--text)',
          letterSpacing: '-0.03em',
          lineHeight: 1,
          opacity: 0,
          animation: 'landingFadeUp 400ms ease-out 100ms forwards',
        }}>
          VERIDEX
        </div>

        {/* Tagline */}
        <div style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 400,
          fontSize: 18,
          color: 'var(--text-dim)',
          marginTop: 12,
          opacity: 0,
          animation: 'landingFadeUp 400ms ease-out 200ms forwards',
        }}>
          Market intelligence. Verified.
        </div>

        {/* Sous-titre */}
        <div style={{
          fontFamily: 'var(--font-body)',
          fontWeight: 400,
          fontSize: 13,
          color: 'var(--text-muted)',
          marginTop: 16,
          lineHeight: 1.6,
          opacity: 0,
          animation: 'landingFadeUp 400ms ease-out 200ms forwards',
        }}>
          Signaux dérivés cross-exchange<br />
          Données vérifiées en temps réel
        </div>
      </div>

      {/* ── Zone métriques — 3 cards inline ────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
        width: '100%',
        opacity: 0,
        animation: 'landingFadeUp 400ms ease-out 300ms forwards',
      }}>
        {metrics.map(m => (
          <div key={m.label} style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '10px 14px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 6,
            }}>
              {m.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 700,
              color: m.color,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Zone CTA ────────────────────────────────────────────── */}
      <div style={{
        width: '100%',
        opacity: 0,
        animation: 'landingFadeUp 400ms ease-out 400ms forwards',
      }}>
        <button
          onClick={onEnter}
          style={{
            width: '100%',
            height: 52,
            background: 'var(--accent)',
            color: '#0F1117',
            border: 'none',
            borderRadius: 10,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 16,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            letterSpacing: '-0.01em',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--accent-hover)'
            e.currentTarget.style.boxShadow  = 'var(--shadow-accent)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--accent)'
            e.currentTarget.style.boxShadow  = 'none'
          }}
        >
          Accéder à l'analyse →
        </button>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          color: 'var(--text-ghost)',
          textAlign: 'center',
          marginTop: 12,
        }}>
          3 exchanges · Signaux temps réel · Audit intégré
        </div>
      </div>

    </div>
  )
}
