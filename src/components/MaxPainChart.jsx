/**
 * MaxPainChart.jsx
 *
 * Affiche le Max Pain d'une échéance Deribit :
 *   - Strike + distance vs spot
 *   - Graphique Canvas 2D : barres OI Call/Put + courbe de douleur
 *   - Zone de tension + métriques OI
 *   - Interprétation expert / novice
 *
 * Props :
 *   data       : résultat de calculateMaxPain()
 *   asset      : 'BTC' | 'ETH'
 *   expiryStr  : ex. '29MAR25'
 *   daysToExpiry : number
 *   mode       : 'expert' | 'novice'
 */
import { useRef, useEffect } from 'react'

const FONT_MONO  = "'IBM Plex Mono', 'Courier New', monospace"
const FONT_SANS  = "var(--sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)"

const COLOR_CALL    = 'rgba(0,200,150,0.55)'
const COLOR_PUT     = 'rgba(240,71,107,0.55)'
const COLOR_PAIN    = 'rgba(245,166,35,0.85)'
const COLOR_SPOT    = 'rgba(240,242,245,0.35)'
const COLOR_MP      = '#00C896'
const COLOR_TENSION = 'rgba(0,200,150,0.07)'
const COLOR_TENSION_BORDER = 'rgba(0,200,150,0.2)'

// ── Canvas chart ──────────────────────────────────────────────────────────────

function drawChart(canvas, data, asset) {
  if (!canvas || !data) return

  const { strikes, byStrike, painCurve, maxPainStrike, spotPrice, nearestStrikes } = data
  if (!strikes?.length || !painCurve?.length) return

  const ctx    = canvas.getContext('2d')
  const dpr    = window.devicePixelRatio || 1
  const W      = canvas.offsetWidth
  const H      = canvas.offsetHeight
  canvas.width  = W * dpr
  canvas.height = H * dpr
  ctx.scale(dpr, dpr)

  ctx.clearRect(0, 0, W, H)

  // ── Sélection des strikes à afficher (10 autour du Max Pain) ──────────────
  const mpIdx = strikes.indexOf(maxPainStrike)
  const startIdx = Math.max(0, mpIdx - 5)
  const endIdx   = Math.min(strikes.length - 1, startIdx + 9)
  const visible  = strikes.slice(startIdx, endIdx + 1)

  if (!visible.length) return

  // ── Dimensions ──
  const PAD_L = 8, PAD_R = 8, PAD_T = 24, PAD_B = 32
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  const n         = visible.length
  const barWidth  = Math.max(4, (chartW / n) * 0.38)
  const stepW     = chartW / n

  // ── Échelles ──
  const maxOI = Math.max(
    ...visible.map(s => Math.max(byStrike[s]?.callOI ?? 0, byStrike[s]?.putOI ?? 0)),
    1
  )

  const visiblePain = painCurve.filter(p => visible.includes(p.strike))
  const maxPain_val = Math.max(...visiblePain.map(p => p.pain), 1)

  function xCenter(i) {
    return PAD_L + i * stepW + stepW / 2
  }
  function yOI(oi) {
    return PAD_T + chartH - (oi / maxOI) * chartH * 0.85
  }
  function yPain(pain) {
    return PAD_T + chartH - (pain / maxPain_val) * chartH * 0.75
  }

  // ── Zone de tension ──
  if (nearestStrikes?.below != null && nearestStrikes?.above != null) {
    const ib = visible.indexOf(nearestStrikes.below)
    const ia = visible.indexOf(nearestStrikes.above)
    if (ib >= 0 && ia >= 0) {
      const x1 = xCenter(ib) - stepW / 2
      const x2 = xCenter(ia) + stepW / 2
      ctx.fillStyle = COLOR_TENSION
      ctx.fillRect(x1, PAD_T, x2 - x1, chartH)
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = COLOR_TENSION_BORDER
      ctx.lineWidth = 1
      ctx.strokeRect(x1, PAD_T, x2 - x1, chartH)
      ctx.setLineDash([])
    }
  }

  // ── Barres OI ──
  visible.forEach((strike, i) => {
    const xc     = xCenter(i)
    const callOI = byStrike[strike]?.callOI ?? 0
    const putOI  = byStrike[strike]?.putOI  ?? 0

    // Call (gauche du centre)
    if (callOI > 0) {
      const h = Math.max(2, (callOI / maxOI) * chartH * 0.85)
      ctx.fillStyle = COLOR_CALL
      ctx.fillRect(xc - barWidth - 1, PAD_T + chartH - h, barWidth, h)
    }

    // Put (droite du centre)
    if (putOI > 0) {
      const h = Math.max(2, (putOI / maxOI) * chartH * 0.85)
      ctx.fillStyle = COLOR_PUT
      ctx.fillRect(xc + 1, PAD_T + chartH - h, barWidth, h)
    }
  })

  // ── Courbe de douleur ──
  ctx.beginPath()
  ctx.strokeStyle = COLOR_PAIN
  ctx.lineWidth   = 1.5
  let firstPoint  = true

  visible.forEach((strike, i) => {
    const entry = visiblePain.find(p => p.strike === strike)
    if (!entry) return
    const x = xCenter(i)
    const y = yPain(entry.pain)
    if (firstPoint) { ctx.moveTo(x, y); firstPoint = false }
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // ── Ligne Spot ──
  const spotIdx = visible.reduce((best, s, i) =>
    Math.abs(s - spotPrice) < Math.abs(visible[best] - spotPrice) ? i : best
  , 0)
  const xSpot = xCenter(spotIdx)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = COLOR_SPOT
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(xSpot, PAD_T)
  ctx.lineTo(xSpot, PAD_T + chartH)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = COLOR_SPOT
  ctx.font      = `8px ${FONT_MONO}`
  ctx.textAlign = 'center'
  ctx.fillText('Spot', xSpot, PAD_T - 4)

  // ── Ligne Max Pain ──
  const mpVisIdx = visible.indexOf(maxPainStrike)
  if (mpVisIdx >= 0) {
    const xMp = xCenter(mpVisIdx)
    ctx.strokeStyle = COLOR_MP
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(xMp, PAD_T)
    ctx.lineTo(xMp, PAD_T + chartH)
    ctx.stroke()
    ctx.fillStyle = COLOR_MP
    ctx.font      = `8px ${FONT_MONO}`
    ctx.textAlign = 'center'
    ctx.fillText('Max Pain', xMp, PAD_T - 4)
  }

  // ── Labels axe X ──
  ctx.fillStyle = 'rgba(160,170,190,0.7)'
  ctx.font      = `9px ${FONT_MONO}`
  ctx.textAlign = 'center'

  const isETH = asset === 'ETH'
  visible.forEach((strike, i) => {
    const xc  = xCenter(i)
    const lbl = isETH
      ? (strike >= 1000 ? (strike / 1000).toFixed(1) + 'k' : String(strike))
      : (strike >= 1000 ? Math.round(strike / 1000) + 'k' : String(strike))
    ctx.fillText(lbl, xc, PAD_T + chartH + 14)
  })

  // ── Axe X ligne ──
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(PAD_L, PAD_T + chartH)
  ctx.lineTo(W - PAD_R, PAD_T + chartH)
  ctx.stroke()
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function MaxPainChart({ data, asset, expiryStr, daysToExpiry, mode = 'expert' }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!data || !canvasRef.current) return
    // Petit délai pour que le DOM ait calculé les dimensions
    const id = requestAnimationFrame(() => {
      drawChart(canvasRef.current, data, asset)
    })
    return () => cancelAnimationFrame(id)
  }, [data, asset])

  if (!data) return null

  const {
    maxPainStrike,
    distancePct,
    direction,
    tensionZone,
    totalCallOI,
    totalPutOI,
    putCallRatio,
    maxCallStrike,
    maxPutStrike,
    interpretation,
    nearestStrikes,
  } = data

  const distColor = direction === 'above' ? 'var(--call)' : direction === 'below' ? 'var(--put)' : 'var(--text-muted)'
  const distSign  = distancePct > 0 ? '+' : ''

  const fmtK = (n) => {
    if (n == null) return '—'
    if (asset === 'ETH') return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  const fmtOI = (n) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'

  const expiryLabel = expiryStr
    ? expiryStr.replace(/(\d{2})([A-Z]{3})(\d{2})/, '$1 $2 \'$3')
    : '—'
  const daysLabel   = daysToExpiry != null ? `${Math.round(daysToExpiry)}j` : ''

  const canvasSupported = typeof HTMLCanvasElement !== 'undefined'

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: FONT_SANS, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
              MAX PAIN · {expiryLabel}{daysLabel ? ` · ${daysLabel}` : ''}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: COLOR_MP, fontFamily: FONT_MONO, letterSpacing: '-0.5px' }}>
              {fmtK(maxPainStrike)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 12, color: distColor, fontFamily: FONT_MONO, fontWeight: 700 }}>
                {distSign}{distancePct?.toFixed(1)}% vs spot
              </span>
              <span style={{ fontSize: 10, color: 'var(--call)', fontFamily: FONT_SANS, fontWeight: 600, background: 'rgba(0,200,150,0.1)', borderRadius: 4, padding: '1px 5px' }}>
                Strike réel Deribit ✓
              </span>
            </div>
          </div>
          {/* PCR badge */}
          {putCallRatio != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 2 }}>P/C Ratio</div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: FONT_MONO, color: putCallRatio > 1.2 ? 'var(--put)' : putCallRatio < 0.8 ? 'var(--call)' : 'var(--text)' }}>
                {putCallRatio.toFixed(2)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: FONT_SANS }}>
                {interpretation?.sentiment === 'fearful'   ? 'Craintif'
                : interpretation?.sentiment === 'cautious' ? 'Prudent'
                : interpretation?.sentiment === 'greedy'   ? 'Glouton'
                : interpretation?.sentiment === 'optimistic' ? 'Optimiste'
                : 'Neutre'}
              </div>
            </div>
          )}
        </div>

        {/* Zone de tension */}
        {tensionZone.low !== tensionZone.high && (
          <div style={{ marginTop: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 4 }}>
              Zone de tension
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>
                {fmtK(tensionZone.low)}
              </span>
              <div style={{ flex: 1, height: 2, background: 'rgba(0,200,150,0.25)', borderRadius: 1, position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: -3, left: '50%', transform: 'translateX(-50%)',
                  width: 8, height: 8, borderRadius: '50%', background: COLOR_MP,
                }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: FONT_MONO }}>
                {fmtK(tensionZone.high)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Graphique Canvas ── */}
      {canvasSupported ? (
        <div style={{ padding: '8px 8px 0', height: 140 }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>
      ) : null}

      {/* ── Légende canvas ── */}
      <div style={{ display: 'flex', gap: 12, padding: '4px 16px 0', flexWrap: 'wrap' }}>
        {[
          { color: COLOR_CALL, label: 'OI Call' },
          { color: COLOR_PUT,  label: 'OI Put' },
          { color: COLOR_PAIN, label: 'Courbe douleur' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 3, background: color, borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Métriques ── */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
          Métriques OI
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { label: 'OI Call total', value: fmtOI(totalCallOI), color: 'var(--call)' },
            { label: 'OI Put total',  value: fmtOI(totalPutOI),  color: 'var(--put)' },
            { label: 'Max OI Call',   value: fmtK(maxCallStrike), color: 'var(--call)' },
            { label: 'Max OI Put',    value: fmtK(maxPutStrike),  color: 'var(--put)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: FONT_MONO }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Interprétation ── */}
      {interpretation && (
        <div style={{ padding: '12px 16px 14px' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: FONT_SANS, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
            Interprétation
          </div>
          <p style={{
            fontSize: 12, color: 'var(--text)', fontFamily: FONT_SANS,
            lineHeight: 1.55, margin: 0,
          }}>
            {mode === 'expert' ? interpretation.expert : interpretation.novice}
          </p>
        </div>
      )}

      {/* ── Note de transparence ── */}
      <div style={{ padding: '0 16px 12px' }}>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: FONT_SANS, lineHeight: 1.4, margin: 0, opacity: 0.7 }}>
          Calculé à partir de l'OI réel Deribit · Strike {fmtK(maxPainStrike)} — contrat existant ✓
        </p>
      </div>
    </div>
  )
}
